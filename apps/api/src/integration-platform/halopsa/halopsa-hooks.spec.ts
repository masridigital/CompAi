jest.mock('@db', () => ({ db: {} }));
const mockLoadConnection = jest.fn();
jest.mock('./halopsa-connection', () => ({
  loadHaloOrgConnection: (organizationId: string) => mockLoadConnection(organizationId),
}));

import { HaloAlertService } from './halopsa-alert.service';
import { buildHaloCheckResults, haloOnTaskCheckRun } from './halopsa-check-hook';
import {
  clearDeviceMarkersForTests,
  deviceMarkerCountForTests,
  MAX_MEMORY_MARKERS,
  resolveNonCompliantSince,
} from './halopsa-device-tracker';
import {
  haloOnCheckResults,
  haloOnDeviceCompliance,
  haloOnFindingCreated,
  haloOnFindingStatusChanged,
  setHaloAlertServiceForTests,
} from './halopsa-hooks';
import { setHaloKvForTests, type HaloKv } from './halopsa-kv';

function failingService() {
  const boom = jest.fn().mockRejectedValue(new Error('halo down'));
  const service = {
    onCheckResult: boom,
    onFindingCreated: boom,
    onFindingClosed: boom,
    onDeviceCompliance: boom,
  } as unknown as HaloAlertService;
  return { service, boom };
}

const finding = { id: 'fnd_1', content: 'Missing MFA\nmore', severity: 'high' as const, task: null };

describe('HaloPSA hooks', () => {
  beforeEach(() => {
    setHaloKvForTests(null);
    clearDeviceMarkersForTests();
    mockLoadConnection.mockResolvedValue({
      connection: { id: 'icn_halo' },
      settings: { enabledTriggers: ['device_noncompliant'] },
    });
  });
  afterAll(() => {
    setHaloAlertServiceForTests(null);
    setHaloKvForTests(undefined);
  });

  it('swallow errors from the alert service', async () => {
    const { service, boom } = failingService();
    setHaloAlertServiceForTests(service);

    await expect(
      haloOnCheckResults([
        {
          organizationId: 'org_1',
          checkId: 'c',
          checkName: 'C',
          passed: false,
          severity: 'high',
          failingResources: [],
          taskId: 't',
        },
      ]),
    ).resolves.toBeUndefined();
    await expect(haloOnFindingCreated({ organizationId: 'org_1', finding })).resolves.toBeUndefined();
    await expect(
      haloOnFindingStatusChanged({ organizationId: 'org_1', finding, previousStatus: 'open', newStatus: 'closed' }),
    ).resolves.toBeUndefined();
    await expect(
      haloOnDeviceCompliance({ organizationId: 'org_1', deviceId: 'd', deviceName: 'D', compliant: false }),
    ).resolves.toBeUndefined();
    expect(boom).toHaveBeenCalledTimes(4);
  });

  it('swallows errors thrown while building check results', async () => {
    const exceptions = {
      has: () => {
        throw new Error('bad exceptions');
      },
    };
    await expect(
      haloOnTaskCheckRun({
        organizationId: 'org_1',
        taskId: 't',
        connectionId: 'icn',
        checks: [{ checkId: 'c', checkName: 'C', findings: [{ resourceId: 'r', title: 'R' }] }],
        exceptions,
      }),
    ).resolves.toBeUndefined();
  });

  it('routes finding transitions: closed resolves, reopened re-alerts, others ignored', async () => {
    const onFindingClosed = jest.fn().mockResolvedValue('resolve');
    const onFindingCreated = jest.fn().mockResolvedValue('reopen');
    setHaloAlertServiceForTests({ onFindingClosed, onFindingCreated } as unknown as HaloAlertService);

    await haloOnFindingStatusChanged({ organizationId: 'o', finding, previousStatus: 'open', newStatus: 'closed' });
    await haloOnFindingStatusChanged({ organizationId: 'o', finding, previousStatus: 'closed', newStatus: 'open' });
    await haloOnFindingStatusChanged({
      organizationId: 'o',
      finding,
      previousStatus: 'open',
      newStatus: 'ready_for_review',
    });

    expect(onFindingClosed).toHaveBeenCalledWith(
      expect.objectContaining({ findingId: 'fnd_1', title: 'Missing MFA' }),
    );
    expect(onFindingCreated).toHaveBeenCalledTimes(1);
  });

  it('tracks the start of a noncompliant streak for devices', async () => {
    const onDeviceCompliance = jest.fn().mockResolvedValue('grace_period');
    setHaloAlertServiceForTests({ onDeviceCompliance } as unknown as HaloAlertService);
    const input = { organizationId: 'o', deviceId: 'dev_1', deviceName: 'MBP', compliant: false };

    await haloOnDeviceCompliance(input);
    const first = onDeviceCompliance.mock.calls[0][0].nonCompliantSince as Date;
    await haloOnDeviceCompliance(input);
    expect(onDeviceCompliance.mock.calls[1][0].nonCompliantSince).toEqual(first);

    await haloOnDeviceCompliance({ ...input, compliant: true });
    expect(onDeviceCompliance.mock.calls[2][0].nonCompliantSince).toBeNull();
  });

  it('does no KV or marker work when the org has no halopsa connection', async () => {
    const kv = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
    setHaloKvForTests(kv as unknown as HaloKv);
    mockLoadConnection.mockResolvedValue(null);
    const onDeviceCompliance = jest.fn();
    setHaloAlertServiceForTests({ onDeviceCompliance } as unknown as HaloAlertService);

    await haloOnDeviceCompliance({ organizationId: 'o', deviceId: 'd', deviceName: 'MBP', compliant: false });
    await haloOnDeviceCompliance({ organizationId: 'o', deviceId: 'd', deviceName: 'MBP', compliant: true });
    expect(kv.set).not.toHaveBeenCalled();
    expect(kv.del).not.toHaveBeenCalled();
    expect(onDeviceCompliance).not.toHaveBeenCalled();
  });

  it('skips noncompliant devices when device_noncompliant is off but still resolves compliant ones', async () => {
    const kv = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
    setHaloKvForTests(kv as unknown as HaloKv);
    mockLoadConnection.mockResolvedValue({ connection: { id: 'icn_halo' }, settings: { enabledTriggers: [] } });
    const onDeviceCompliance = jest.fn();
    setHaloAlertServiceForTests({ onDeviceCompliance } as unknown as HaloAlertService);

    await haloOnDeviceCompliance({ organizationId: 'o', deviceId: 'd', deviceName: 'MBP', compliant: false });
    expect(kv.set).not.toHaveBeenCalled();
    expect(onDeviceCompliance).not.toHaveBeenCalled();

    await haloOnDeviceCompliance({ organizationId: 'o', deviceId: 'd', deviceName: 'MBP', compliant: true });
    expect(onDeviceCompliance).toHaveBeenCalledWith(expect.objectContaining({ compliant: true }));
  });

  it('bounds the in-memory markers by TTL and size', async () => {
    const start = new Date('2026-01-01T00:00:00.000Z');
    await resolveNonCompliantSince({ deviceId: 'old', compliant: false, now: start });
    const later = new Date(start.getTime() + 61 * 86_400_000);
    // Expired after 60 days: a new streak starts.
    await expect(resolveNonCompliantSince({ deviceId: 'old', compliant: false, now: later })).resolves.toEqual(later);

    for (let i = 0; i < MAX_MEMORY_MARKERS + 5; i++) {
      await resolveNonCompliantSince({ deviceId: `d${i}`, compliant: false, now: later });
    }
    expect(deviceMarkerCountForTests()).toBe(MAX_MEMORY_MARKERS);
  });
});

describe('buildHaloCheckResults', () => {
  it('excludes excepted findings and derives severity, pass state and remediation', () => {
    const results = buildHaloCheckResults({
      organizationId: 'org_1',
      taskId: 'tsk_1',
      connectionId: 'icn_1',
      checks: [
        {
          checkId: 'mfa',
          checkName: 'MFA',
          findings: [
            { resourceId: 'u1', title: 'alice', severity: 'medium', remediation: 'Enable MFA' },
            { resourceId: 'u2', title: 'bob', severity: 'critical' },
          ],
        },
        { checkId: 'ok', checkName: 'OK', findings: [{ resourceId: 'x', title: 'x', severity: 'high' }] },
      ],
      exceptions: { has: (_c, checkId, resourceId) => checkId === 'ok' || resourceId === 'u2' },
    });

    expect(results[0]).toMatchObject({
      checkId: 'mfa',
      connectionId: 'icn_1',
      passed: false,
      severity: 'medium',
      remediation: 'Enable MFA',
      failingResources: [{ title: 'alice', resourceId: 'u1' }],
    });
    expect(results[1]).toMatchObject({ checkId: 'ok', passed: true, severity: null, failingResources: [] });
  });
});
