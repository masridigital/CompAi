import { describe, expect, it } from 'bun:test';
import { haloMappingFromMetadata, hasReservedHaloBindingKey, resolveHaloBinding } from '../../binding';
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

describe('resolveHaloBinding', () => {
  it('reads the admin binding from metadata', () => {
    const metadata = { halopsaBinding: { haloClientId: 42, haloSiteId: 6, haloClientName: 'Acme' } };
    expect(resolveHaloBinding(metadata)).toEqual({
      success: true,
      data: { haloClientId: 42, haloSiteId: 6, haloClientName: 'Acme' },
    });
    expect(haloMappingFromMetadata(metadata)).toEqual({ haloClientId: 42, haloSiteId: 6 });
  });

  it('ignores legacy top-level ids and string ids', () => {
    expect(haloMappingFromMetadata({ haloClientId: 5 })).toBeNull();
    expect(haloMappingFromMetadata({ halopsaBinding: { haloClientId: '5' } })).toBeNull();
    expect(haloMappingFromMetadata(null)).toBeNull();
    expect(resolveHaloBinding({}).success).toBe(false);
  });

  it('flags reserved binding keys', () => {
    expect(hasReservedHaloBindingKey({ haloClientId: 1 })).toBe(true);
    expect(hasReservedHaloBindingKey({ halopsaBinding: {} })).toBe(true);
    expect(hasReservedHaloBindingKey({ alert_team_id: 3 })).toBe(false);
    expect(hasReservedHaloBindingKey(undefined)).toBe(false);
  });
});

describe('testHaloConnection', () => {
  it('only checks server configuration without a client id', async () => {
    expect(await testHaloConnection()).toBe(true);
    expect(halo.requests).toHaveLength(0);
  });

  it('succeeds when GET /Client/{id} returns an active client', async () => {
    halo.setRoutes({ '/api/Client/42': () => ({ id: 42, name: 'Acme' }) });
    expect(await testHaloConnection({ haloClientId: 42 })).toBe(true);
    expect(halo.requests.some((u) => u.pathname === '/api/Client/42')).toBe(true);
  });

  it('explains a missing client', async () => {
    halo.setRoutes({});
    await expect(testHaloConnection({ haloClientId: 43 })).rejects.toThrow(
      'Halo client 43 was not found in HaloPSA.',
    );
  });

  it('gives a generic message for missing server env', async () => {
    delete process.env.HALOPSA_BASE_URL;
    const error = await testHaloConnection().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('not configured');
    expect((error as Error).message).not.toContain('HALOPSA_');
  });

  it('hides Halo response bodies', async () => {
    halo.setRoutes({ '/api/Client/42': () => new Response('secret body', { status: 500 }) });
    const error = await testHaloConnection({ haloClientId: 42 }).catch((e: unknown) => e);
    expect((error as Error).message).not.toContain('secret body');
  });
});
