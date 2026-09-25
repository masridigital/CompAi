import { TASK_TEMPLATES } from '../../../task-mappings';
import type { IntegrationCheck } from '../../../types';
import { ticketClosedAt, ticketOpenedAt } from '../client';
import { incidentSlaHoursVariable, incidentTicketTypeIdsVariable } from '../variables';
import {
  EVIDENCE_WINDOW_DAYS,
  hasResolutionNote,
  hoursBetween,
  missingTicketTypesFinding,
  runHaloCheck,
  ticketEvidence,
  ticketsInWindow,
} from './shared';

export const incidentResponseCheck: IntegrationCheck = {
  id: 'halopsa_incident_response',
  name: 'Security incidents resolved within SLA',
  description: `Security-incident tickets logged in HaloPSA in the last ${EVIDENCE_WINDOW_DAYS} days have a resolution note and were closed within the incident SLA.`,
  taskMapping: TASK_TEMPLATES.incidentResponse,
  defaultSeverity: 'high',
  variables: [incidentTicketTypeIdsVariable, incidentSlaHoursVariable],

  run: (ctx) =>
    runHaloCheck({
      ctx,
      body: async (run) => {
        const { incidentTicketTypeIds, incidentSlaHours } = run.settings;
        if (incidentTicketTypeIds.length === 0) {
          missingTicketTypesFinding({
            ctx,
            resourceId: run.resourceId,
            variableLabel: incidentTicketTypeIdsVariable.label,
          });
          return;
        }

        ctx.log('Fetching HaloPSA security incident tickets', {
          clientId: run.mapping.haloClientId,
          ticketTypeIds: incidentTicketTypeIds,
        });
        const tickets = await ticketsInWindow({ run, ticketTypeIds: incidentTicketTypeIds });

        if (tickets.length === 0) {
          ctx.pass({
            title: 'No security incidents in the last 90 days',
            description: `HaloPSA has no security-incident tickets for this client since ${run.windowStart.toISOString().slice(0, 10)}.`,
            resourceType: 'halopsa-client',
            resourceId: run.resourceId,
            evidence: {
              haloClientId: run.mapping.haloClientId,
              ticketTypeIds: incidentTicketTypeIds,
              windowStart: run.windowStart.toISOString(),
              checkedAt: run.now.toISOString(),
              incidentCount: 0,
            },
          });
          return;
        }

        for (const ticket of tickets) {
          const openedAt = ticketOpenedAt(ticket) ?? run.now;
          const closedAt = ticketClosedAt(ticket);
          const evidence = { ...ticketEvidence(ticket), slaHours: incidentSlaHours };
          const resourceId = `halo-ticket-${ticket.id}`;

          if (!closedAt) {
            const ageHours = hoursBetween({ from: openedAt, to: run.now });
            if (ageHours <= incidentSlaHours) {
              ctx.pass({
                title: `Incident #${ticket.id} is open and within SLA`,
                description: `Logged ${Math.round(ageHours)}h ago; SLA is ${incidentSlaHours}h.`,
                resourceType: 'halopsa-ticket',
                resourceId,
                evidence: { ...evidence, ageHours: Math.round(ageHours) },
              });
              continue;
            }
            ctx.fail({
              title: `Incident #${ticket.id} is open past its SLA`,
              description: `"${ticket.summary ?? ''}" was logged ${Math.round(ageHours)}h ago and is still open (SLA ${incidentSlaHours}h).`,
              resourceType: 'halopsa-ticket',
              resourceId,
              severity: 'high',
              remediation: `Resolve Halo ticket #${ticket.id}, add a resolution note describing root cause and containment, then close it.`,
              evidence: { ...evidence, ageHours: Math.round(ageHours) },
            });
            continue;
          }

          const resolutionHours = hoursBetween({ from: openedAt, to: closedAt });
          const actions = await run.halo.listActions(ticket.id);
          const noted = hasResolutionNote({ ticket, actions });
          const withinSla = resolutionHours <= incidentSlaHours;
          const result = {
            ...evidence,
            resolutionHours: Math.round(resolutionHours),
            hasResolutionNote: noted,
          };

          if (noted && withinSla) {
            ctx.pass({
              title: `Incident #${ticket.id} resolved within SLA`,
              description: `Closed after ${Math.round(resolutionHours)}h (SLA ${incidentSlaHours}h) with a resolution note.`,
              resourceType: 'halopsa-ticket',
              resourceId,
              evidence: result,
            });
            continue;
          }

          const problems = [
            !withinSla
              ? `closed after ${Math.round(resolutionHours)}h (SLA ${incidentSlaHours}h)`
              : null,
            !noted ? 'has no resolution note' : null,
          ].filter(Boolean);
          ctx.fail({
            title: `Incident #${ticket.id} did not meet the incident process`,
            description: `"${ticket.summary ?? ''}" ${problems.join(' and ')}.`,
            resourceType: 'halopsa-ticket',
            resourceId,
            severity: withinSla ? 'medium' : 'high',
            remediation: noted
              ? `Review why Halo ticket #${ticket.id} exceeded the SLA and record the lessons learned in a post-incident review.`
              : `Add a resolution note (outcome "Resolved") to Halo ticket #${ticket.id} describing root cause, containment and follow-up.`,
            evidence: result,
          });
        }
      },
    }),
};
