import { TASK_TEMPLATES } from '../../../task-mappings';
import type { IntegrationCheck } from '../../../types';
import { ticketClosedAt, ticketOpenedAt } from '../client';
import { joinerLeaverMaxHoursVariable, joinerLeaverTicketTypeIdsVariable } from '../variables';
import {
  EVIDENCE_WINDOW_DAYS,
  hoursBetween,
  missingTicketTypesFinding,
  runHaloCheck,
  ticketEvidence,
  ticketsInWindow,
} from './shared';

export const employeeAccessCheck: IntegrationCheck = {
  id: 'halopsa_employee_access',
  name: 'Joiner and leaver requests completed on time',
  description: `Joiner and leaver tickets logged in HaloPSA in the last ${EVIDENCE_WINDOW_DAYS} days were closed within the configured limit.`,
  taskMapping: TASK_TEMPLATES.employeeAccess,
  defaultSeverity: 'medium',
  variables: [joinerLeaverTicketTypeIdsVariable, joinerLeaverMaxHoursVariable],

  run: (ctx) =>
    runHaloCheck({
      ctx,
      body: async (run) => {
        const { joinerLeaverTicketTypeIds, joinerLeaverMaxHours } = run.settings;
        if (joinerLeaverTicketTypeIds.length === 0) {
          missingTicketTypesFinding({
            ctx,
            resourceId: run.resourceId,
            variableLabel: joinerLeaverTicketTypeIdsVariable.label,
          });
          return;
        }

        ctx.log('Fetching HaloPSA joiner / leaver tickets', {
          clientId: run.mapping.haloClientId,
          ticketTypeIds: joinerLeaverTicketTypeIds,
        });
        const tickets = await ticketsInWindow({ run, ticketTypeIds: joinerLeaverTicketTypeIds });

        if (tickets.length === 0) {
          ctx.pass({
            title: 'No joiner or leaver requests in the last 90 days',
            description: `HaloPSA has no joiner/leaver tickets for this client since ${run.windowStart.toISOString().slice(0, 10)}.`,
            resourceType: 'halopsa-client',
            resourceId: run.resourceId,
            evidence: {
              haloClientId: run.mapping.haloClientId,
              ticketTypeIds: joinerLeaverTicketTypeIds,
              windowStart: run.windowStart.toISOString(),
              checkedAt: run.now.toISOString(),
              ticketCount: 0,
            },
          });
          return;
        }

        for (const ticket of tickets) {
          const openedAt = ticketOpenedAt(ticket) ?? run.now;
          const closedAt = ticketClosedAt(ticket);
          const hours = hoursBetween({ from: openedAt, to: closedAt ?? run.now });
          const resourceId = `halo-ticket-${ticket.id}`;
          const evidence = {
            ...ticketEvidence(ticket),
            maxHours: joinerLeaverMaxHours,
            hoursTaken: Math.round(hours),
          };

          if (hours <= joinerLeaverMaxHours) {
            ctx.pass({
              title: closedAt
                ? `Request #${ticket.id} completed in ${Math.round(hours)}h`
                : `Request #${ticket.id} is open and within ${joinerLeaverMaxHours}h`,
              description: `"${ticket.summary ?? ''}" ${closedAt ? 'was closed' : 'is still open'} within the ${joinerLeaverMaxHours}h limit.`,
              resourceType: 'halopsa-ticket',
              resourceId,
              evidence,
            });
            continue;
          }

          ctx.fail({
            title: closedAt
              ? `Request #${ticket.id} took ${Math.round(hours)}h`
              : `Request #${ticket.id} is open past ${joinerLeaverMaxHours}h`,
            description: `"${ticket.summary ?? ''}" exceeded the ${joinerLeaverMaxHours}h limit for provisioning or removing access.`,
            resourceType: 'halopsa-ticket',
            resourceId,
            severity: 'medium',
            remediation: closedAt
              ? `Review why Halo ticket #${ticket.id} was late. Leaver access must be removed promptly; adjust staffing or automation so requests meet the ${joinerLeaverMaxHours}h target.`
              : `Complete Halo ticket #${ticket.id} now: provision or revoke the user's access and close the ticket.`,
            evidence,
          });
        }
      },
    }),
};
