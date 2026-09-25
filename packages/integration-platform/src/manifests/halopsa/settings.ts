import { z } from 'zod';
import type { CheckVariableValues, FindingSeverity } from '../../types';
import {
  DEFAULT_INCIDENT_SLA_HOURS,
  DEFAULT_JOINER_LEAVER_MAX_HOURS,
  DEFAULT_PRIORITY_MAP,
  HALO_ALERT_TRIGGERS,
  HALO_SEVERITIES,
  type HaloAlertTrigger,
} from './variables';

/** "12, 14" | 12 | ["12"] -> [12, 14] (invalid entries dropped). */
export function parseIdList(value: unknown): number[] {
  const raw: unknown[] = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,\s]+/)
      : typeof value === 'number'
        ? [value]
        : [];
  return raw
    .map((entry) => (typeof entry === 'number' ? entry : Number(String(entry).trim())))
    .filter((id) => Number.isInteger(id) && id > 0);
}

/** Optional positive integer; '' / null / garbage -> undefined. */
const optionalPositiveInt = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return undefined;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) && num > 0 ? Math.trunc(num) : undefined;
}, z.number().int().positive().optional());

const positiveNumberWithDefault = (fallback: number) =>
  z.preprocess((value) => {
    const num = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(num) && num > 0 ? num : fallback;
  }, z.number().positive());

export interface HaloCheckSettings {
  incidentTicketTypeIds: number[];
  accessReviewTicketTypeIds: number[];
  joinerLeaverTicketTypeIds: number[];
  changeTicketTypeIds: number[];
  incidentSlaHours: number;
  joinerLeaverMaxHours: number;
}

export function parseHaloCheckSettings(variables: CheckVariableValues): HaloCheckSettings {
  return {
    incidentTicketTypeIds: parseIdList(variables.incident_ticket_type_ids),
    accessReviewTicketTypeIds: parseIdList(variables.access_review_ticket_type_ids),
    joinerLeaverTicketTypeIds: parseIdList(variables.joiner_leaver_ticket_type_ids),
    changeTicketTypeIds: parseIdList(variables.change_ticket_type_ids),
    incidentSlaHours: positiveNumberWithDefault(DEFAULT_INCIDENT_SLA_HOURS).parse(
      variables.incident_sla_hours,
    ),
    joinerLeaverMaxHours: positiveNumberWithDefault(DEFAULT_JOINER_LEAVER_MAX_HOURS).parse(
      variables.joiner_leaver_max_hours,
    ),
  };
}

export type HaloAlertSeverity = (typeof HALO_SEVERITIES)[number];

export interface HaloAlertSettings {
  enabledTriggers: HaloAlertTrigger[];
  ticketTypeId?: number;
  teamId?: number;
  agentId?: number;
  priorityMap: Record<HaloAlertSeverity, number>;
  resolvedStatusId?: number;
  minSeverity: HaloAlertSeverity;
  /** Push posture to client custom fields (plan 5.3). Default true. */
  pushPosture: boolean;
}

const TriggerSchema = z.enum(HALO_ALERT_TRIGGERS);
const SeveritySchema = z.enum(HALO_SEVERITIES);

/** Missing / '' -> true; false, 'false', '0', 'no', 'off' -> false. */
export function parseBooleanDefaultTrue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (typeof value === 'boolean') return value;
  return !['false', '0', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

/** Reassemble the alert settings object from the flat `alert_*` variables. */
export function parseHaloAlertSettings(variables: CheckVariableValues): HaloAlertSettings {
  const rawTriggers = variables.alert_enabled_triggers;
  const triggerList = Array.isArray(rawTriggers)
    ? rawTriggers
    : typeof rawTriggers === 'string'
      ? rawTriggers.split(',').map((t) => t.trim())
      : [];
  const enabledTriggers = triggerList.flatMap((trigger) => {
    const parsed = TriggerSchema.safeParse(trigger);
    return parsed.success ? [parsed.data] : [];
  });

  const minSeverity = SeveritySchema.safeParse(variables.alert_min_severity);

  const priority = (key: HaloAlertSeverity) =>
    optionalPositiveInt.parse(variables[`alert_priority_${key}`]) ?? DEFAULT_PRIORITY_MAP[key];

  return {
    enabledTriggers: [...new Set(enabledTriggers)],
    ticketTypeId: optionalPositiveInt.parse(variables.alert_ticket_type_id),
    teamId: optionalPositiveInt.parse(variables.alert_team_id),
    agentId: optionalPositiveInt.parse(variables.alert_agent_id),
    priorityMap: {
      critical: priority('critical'),
      high: priority('high'),
      medium: priority('medium'),
      low: priority('low'),
    },
    resolvedStatusId: optionalPositiveInt.parse(variables.alert_resolved_status_id),
    minSeverity: minSeverity.success ? minSeverity.data : 'low',
    pushPosture: parseBooleanDefaultTrue(variables.alert_push_posture),
  };
}

const SEVERITY_RANK: Record<FindingSeverity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/** True when `severity` is at or above the configured minimum. */
export function meetsMinSeverity({
  severity,
  minSeverity,
}: {
  severity: FindingSeverity;
  minSeverity: HaloAlertSeverity;
}): boolean {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[minSeverity];
}
