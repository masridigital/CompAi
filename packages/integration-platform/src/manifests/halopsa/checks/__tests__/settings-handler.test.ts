import { describe, expect, it } from 'bun:test';
import { resolveHaloConnectionMapping } from '../../credentials';
import { testHaloConnection } from '../../handler';
import {
  meetsMinSeverity,
  parseHaloAlertSettings,
  parseHaloCheckSettings,
  parseIdList,
} from '../../settings';
import { useHaloMock } from './check-harness';

const halo = useHaloMock();

describe('parseHaloAlertSettings', () => {
  it('returns safe defaults for empty variables', () => {
    expect(parseHaloAlertSettings({})).toEqual({
      enabledTriggers: [],
      ticketTypeId: undefined,
      teamId: undefined,
      agentId: undefined,
      priorityMap: { critical: 1, high: 2, medium: 3, low: 4 },
      resolvedStatusId: undefined,
      minSeverity: 'low',
      pushPosture: true,
    });
  });

  it('reads alert_push_posture with a default of true', () => {
    expect(parseHaloAlertSettings({ alert_push_posture: false }).pushPosture).toBe(false);
    expect(parseHaloAlertSettings({ alert_push_posture: 'false' }).pushPosture).toBe(false);
    expect(parseHaloAlertSettings({ alert_push_posture: true }).pushPosture).toBe(true);
    expect(parseHaloAlertSettings({ alert_enabled_triggers: ['monthly_report'] }).enabledTriggers).toEqual([
      'monthly_report',
    ]);
  });

  it('reassembles the object from flat variables and drops unknown triggers', () => {
    const settings = parseHaloAlertSettings({
      alert_enabled_triggers: ['finding_created', 'bogus', 'finding_created'],
      alert_ticket_type_id: '31',
      alert_team_id: 4,
      alert_agent_id: '',
      alert_priority_critical: '5',
      alert_resolved_status_id: 9,
      alert_min_severity: 'high',
    });
    expect(settings.enabledTriggers).toEqual(['finding_created']);
    expect(settings.ticketTypeId).toBe(31);
    expect(settings.teamId).toBe(4);
    expect(settings.agentId).toBeUndefined();
    expect(settings.priorityMap.critical).toBe(5);
    expect(settings.resolvedStatusId).toBe(9);
    expect(settings.minSeverity).toBe('high');
  });

  it('compares severities', () => {
    expect(meetsMinSeverity({ severity: 'critical', minSeverity: 'high' })).toBe(true);
    expect(meetsMinSeverity({ severity: 'medium', minSeverity: 'high' })).toBe(false);
    expect(meetsMinSeverity({ severity: 'info', minSeverity: 'low' })).toBe(false);
  });
});

describe('parseHaloCheckSettings', () => {
  it('parses id lists and applies hour defaults', () => {
    const settings = parseHaloCheckSettings({
      incident_ticket_type_ids: '21, 22,x',
      incident_sla_hours: '',
    });
    expect(settings.incidentTicketTypeIds).toEqual([21, 22]);
    expect(settings.incidentSlaHours).toBe(72);
    expect(settings.joinerLeaverMaxHours).toBe(24);
    expect(parseIdList(['3', 4])).toEqual([3, 4]);
  });
});

describe('resolveHaloConnectionMapping', () => {
  it('parses numeric string ids and optional site', () => {
    expect(
      resolveHaloConnectionMapping({ credentials: { haloClientId: '42', haloSiteId: '' } }),
    ).toEqual({
      success: true,
      data: { haloClientId: 42, haloSiteId: undefined },
    });
  });

  it('falls back to variables', () => {
    const result = resolveHaloConnectionMapping({
      credentials: {},
      variables: { haloClientId: 5, haloSiteId: '6' },
    });
    expect(result).toEqual({ success: true, data: { haloClientId: 5, haloSiteId: 6 } });
  });

  it('rejects non-numeric ids', () => {
    const result = resolveHaloConnectionMapping({ credentials: { haloClientId: 'acme' } });
    expect(result.success).toBe(false);
  });
});

describe('testHaloConnection', () => {
  it('succeeds when GET /Client/{id} returns an active client', async () => {
    halo.setRoutes({ '/api/Client/42': () => ({ id: 42, name: 'Acme' }) });
    expect(await testHaloConnection({ credentials: { haloClientId: '42' } })).toBe(true);
    expect(halo.requests.some((u) => u.pathname === '/api/Client/42')).toBe(true);
  });

  it('explains a missing client', async () => {
    halo.setRoutes({});
    await expect(testHaloConnection({ credentials: { haloClientId: '43' } })).rejects.toThrow(
      'Halo client 43 was not found in HaloPSA.',
    );
  });

  it('explains missing server env', async () => {
    delete process.env.HALOPSA_BASE_URL;
    await expect(testHaloConnection({ credentials: { haloClientId: '42' } })).rejects.toThrow(
      'HALOPSA_BASE_URL',
    );
  });

  it('rejects an invalid client id before calling Halo', async () => {
    await expect(testHaloConnection({ credentials: { haloClientId: 'abc' } })).rejects.toThrow(
      'haloClientId',
    );
    expect(halo.requests).toHaveLength(0);
  });
});
