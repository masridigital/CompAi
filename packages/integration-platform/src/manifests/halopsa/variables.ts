/**
 * HaloPSA connection variables.
 *
 * Variables are flat (the platform stores `string | number | boolean | string[]`
 * per variable), so the alert settings object is spread across `alert_*`
 * variables and reassembled by `parseHaloAlertSettings` in ./settings.ts.
 */

import type { CheckVariable } from '../../types';

export const HALO_ALERT_TRIGGERS = [
  'integration_check_failed',
  'finding_created',
  'device_noncompliant',
  'weekly_digest',
  'monthly_report',
] as const;
export type HaloAlertTrigger = (typeof HALO_ALERT_TRIGGERS)[number];

export const HALO_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

export const DEFAULT_INCIDENT_SLA_HOURS = 72;
export const DEFAULT_JOINER_LEAVER_MAX_HOURS = 24;
export const DEFAULT_PRIORITY_MAP = { critical: 1, high: 2, medium: 3, low: 4 } as const;

const ticketTypeIdsHelp =
  'Comma-separated Halo ticket type IDs (Halo > Configuration > Tickets > Ticket Types).';

// ==================== Evidence check settings ====================

export const incidentTicketTypeIdsVariable: CheckVariable = {
  id: 'incident_ticket_type_ids',
  label: 'Security incident ticket type IDs',
  type: 'text',
  required: false,
  placeholder: '21',
  helpText: ticketTypeIdsHelp,
};

export const accessReviewTicketTypeIdsVariable: CheckVariable = {
  id: 'access_review_ticket_type_ids',
  label: 'Access review ticket type IDs',
  type: 'text',
  required: false,
  placeholder: '22',
  helpText: ticketTypeIdsHelp,
};

export const joinerLeaverTicketTypeIdsVariable: CheckVariable = {
  id: 'joiner_leaver_ticket_type_ids',
  label: 'Joiner / leaver ticket type IDs',
  type: 'text',
  required: false,
  placeholder: '23,24',
  helpText: ticketTypeIdsHelp,
};

export const changeTicketTypeIdsVariable: CheckVariable = {
  id: 'change_ticket_type_ids',
  label: 'Change request ticket type IDs',
  type: 'text',
  required: false,
  placeholder: '25',
  helpText: ticketTypeIdsHelp,
};

export const incidentSlaHoursVariable: CheckVariable = {
  id: 'incident_sla_hours',
  label: 'Security incident resolution SLA (hours)',
  type: 'number',
  required: false,
  default: DEFAULT_INCIDENT_SLA_HOURS,
  helpText: 'Incident tickets must be closed within this many hours of being logged.',
};

export const joinerLeaverMaxHoursVariable: CheckVariable = {
  id: 'joiner_leaver_max_hours',
  label: 'Joiner / leaver completion limit (hours)',
  type: 'number',
  required: false,
  default: DEFAULT_JOINER_LEAVER_MAX_HOURS,
  helpText: 'Joiner and leaver tickets must be closed within this many hours.',
};

// ==================== Alert settings ====================

const idVariable = ({
  id,
  label,
  helpText,
}: {
  id: string;
  label: string;
  helpText: string;
}): CheckVariable => ({
  id,
  label,
  type: 'number',
  required: false,
  helpText,
});

export const alertVariables: CheckVariable[] = [
  {
    id: 'alert_enabled_triggers',
    label: 'Raise Halo tickets for',
    type: 'multi-select',
    required: false,
    default: [],
    helpText: 'Nothing is sent to Halo until at least one trigger is enabled.',
    options: [
      { value: 'integration_check_failed', label: 'Failing integration checks' },
      { value: 'finding_created', label: 'New pentest and audit findings' },
      { value: 'device_noncompliant', label: 'Noncompliant devices' },
      { value: 'weekly_digest', label: 'Weekly due-items digest' },
      { value: 'monthly_report', label: 'Monthly posture report (PDF)' },
    ],
  },
  idVariable({
    id: 'alert_ticket_type_id',
    label: 'Alert ticket type ID',
    helpText: 'Halo ticket type for alert tickets.',
  }),
  idVariable({
    id: 'alert_team_id',
    label: 'Alert team ID',
    helpText: 'Halo team that receives alert tickets.',
  }),
  idVariable({
    id: 'alert_agent_id',
    label: 'Alert agent ID',
    helpText: 'Optional Halo agent to assign.',
  }),
  idVariable({
    id: 'alert_priority_critical',
    label: 'Priority ID for critical',
    helpText: 'Default 1 (P1).',
  }),
  idVariable({
    id: 'alert_priority_high',
    label: 'Priority ID for high',
    helpText: 'Default 2 (P2).',
  }),
  idVariable({
    id: 'alert_priority_medium',
    label: 'Priority ID for medium',
    helpText: 'Default 3 (P3).',
  }),
  idVariable({
    id: 'alert_priority_low',
    label: 'Priority ID for low',
    helpText: 'Default 4 (P4).',
  }),
  idVariable({
    id: 'alert_resolved_status_id',
    label: 'Resolved status ID',
    helpText: 'Halo status set when the underlying issue is fixed in CompAI.',
  }),
  {
    id: 'alert_push_posture',
    label: 'Push compliance posture to Halo client fields',
    type: 'boolean',
    required: false,
    default: true,
    helpText:
      'Nightly update of the CFCompAI* client custom fields (needs the edit:customers scope).',
  },
  {
    id: 'alert_min_severity',
    label: 'Minimum severity',
    type: 'select',
    required: false,
    default: 'low',
    helpText: 'Alerts below this severity are not sent to Halo.',
    options: HALO_SEVERITIES.map((severity) => ({ value: severity, label: severity })),
  },
];

export const halopsaVariables: CheckVariable[] = [
  incidentTicketTypeIdsVariable,
  accessReviewTicketTypeIdsVariable,
  joinerLeaverTicketTypeIdsVariable,
  changeTicketTypeIdsVariable,
  incidentSlaHoursVariable,
  joinerLeaverMaxHoursVariable,
  ...alertVariables,
];
