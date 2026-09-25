const mockDb = {
  $transaction: jest.fn(),
  integrationConnection: { findMany: jest.fn() },
  haloTicketLink: { upsert: jest.fn() },
  haloOutboxEvent: { updateMany: jest.fn(), create: jest.fn() },
};

jest.mock('@db', () => ({ db: mockDb, Prisma: {} }));

import type { ClientPostureQueryService } from '../../client-posture/client-posture-query.service';
import {
  buildPostureFields,
  customFieldPrefix,
  formatFrameworkScores,
} from './halopsa-posture-fields';
import { HaloPostureService } from './halopsa-posture.service';

const NOW = new Date('2026-09-26T06:30:00.000Z');

const snapshot = (overrides: Record<string, unknown> = {}) => ({
  overallScore: 78,
  failingChecks: 3,
  openFindings: 2,
  capturedAt: new Date('2026-09-26T05:31:00.000Z'),
  frameworkScores: [
    { frameworkId: 'f1', name: 'SOC 2', score: 82 },
    { frameworkId: 'f2', name: 'ISO 27001', score: 64 },
  ],
  ...overrides,
});

describe('posture fields', () => {
  it('builds the six CFCompAI fields', () => {
    expect(
      buildPostureFields({ snapshot: snapshot(), organizationId: 'org_1', appUrl: 'https://compliance.masri.tech' }),
    ).toEqual({
      CFCompAIScore: 78,
      CFCompAIFrameworks: 'SOC 2 82%, ISO 27001 64%',
      CFCompAIFailingChecks: 3,
      CFCompAIOpenFindings: 2,
      CFCompAILastSync: '2026-09-26',
      CFCompAIUrl: 'https://compliance.masri.tech/org_1',
    });
  });

  it('honours HALOPSA_CUSTOM_FIELD_PREFIX and rejects unsafe prefixes', () => {
    expect(customFieldPrefix({ HALOPSA_CUSTOM_FIELD_PREFIX: 'CFMsp' })).toBe('CFMsp');
    expect(customFieldPrefix({ HALOPSA_CUSTOM_FIELD_PREFIX: 'bad prefix!' })).toBe('CFCompAI');
    expect(customFieldPrefix({})).toBe('CFCompAI');
    const fields = buildPostureFields({ snapshot: snapshot(), organizationId: 'o', appUrl: 'x', prefix: 'CFMsp' });
    expect(Object.keys(fields)).toContain('CFMspScore');
  });

  it('keeps the frameworks text within 250 characters on whole entries', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ name: `Framework number ${i}`, score: 50 }));
    const text = formatFrameworkScores(many);
    expect(text.length).toBeLessThanOrEqual(250);
    expect(text.endsWith('50%')).toBe(true);
    expect(formatFrameworkScores([{ name: 'x'.repeat(300), score: 1 }]).length).toBe(250);
  });
});

describe('HaloPostureService', () => {
  const getLatestForOrganizations = jest.fn();
  const service = new HaloPostureService({ getLatestForOrganizations } as unknown as ClientPostureQueryService);

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.$transaction.mockImplementation((fn: (tx: typeof mockDb) => unknown) => fn(mockDb));
    mockDb.haloTicketLink.upsert.mockResolvedValue({ id: 'htl_posture' });
    mockDb.integrationConnection.findMany.mockResolvedValue([
      { id: 'icn_1', organizationId: 'org_1', variables: {} },
      { id: 'icn_1b', organizationId: 'org_1', variables: {} },
      { id: 'icn_2', organizationId: 'org_2', variables: { alert_push_posture: false } },
      { id: 'icn_3', organizationId: 'org_3', variables: {} },
      { id: 'icn_4', organizationId: 'org_4', variables: {} },
    ]);
    getLatestForOrganizations.mockResolvedValue(
      new Map([
        ['org_1', snapshot()],
        ['org_4', snapshot({ capturedAt: new Date('2026-09-01T00:00:00Z') })],
      ]),
    );
  });

  it('enqueues one push per enabled org with a fresh snapshot, on the posture link', async () => {
    await expect(service.enqueueAll({ now: NOW })).resolves.toEqual({
      connections: 4,
      enqueued: 1,
      disabled: 1,
      noSnapshot: 1,
      stale: 1,
    });
    expect(getLatestForOrganizations).toHaveBeenCalledWith(['org_1', 'org_3', 'org_4']);
    expect(mockDb.haloTicketLink.upsert.mock.calls[0][0]).toMatchObject({
      where: { organizationId_dedupKey: { organizationId: 'org_1', dedupKey: 'posture' } },
      create: { entityType: 'posture', connectionId: 'icn_1', state: 'open' },
    });
    expect(mockDb.haloOutboxEvent.updateMany).toHaveBeenCalledWith({
      where: { linkId: 'htl_posture', kind: 'push_custom_fields', status: 'pending' },
      data: { status: 'done', lastError: 'superseded by a newer posture push' },
    });
    const event = mockDb.haloOutboxEvent.create.mock.calls[0][0].data;
    expect(event).toMatchObject({ organizationId: 'org_1', kind: 'push_custom_fields' });
    expect(event.payload.fields.CFCompAIScore).toBe(78);
  });
});
