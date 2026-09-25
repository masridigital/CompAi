import type { IntegrationCheck } from '../../../types';
import { changeTicketTypeIdsVariable } from '../variables';
import {
  EVIDENCE_WINDOW_DAYS,
  hasApproval,
  missingTicketTypesFinding,
  runHaloCheck,
  ticketEvidence,
  ticketsInWindow,
} from './shared';

/**
 * No change-management task template exists in task-mappings.ts yet, so this
 * check has no `taskMapping`: it reports results but does not auto-complete a
 * task. Add the template in the framework editor, then set `taskMapping`.
 */
export const changeManagementCheck: IntegrationCheck = {
  id: 'halopsa_change_management',
  name: 'Change requests carry an approval',
  description: `Change tickets logged in HaloPSA in the last ${EVIDENCE_WINDOW_DAYS} days have a recorded approval.`,
  defaultSeverity: 'medium',
  variables: [changeTicketTypeIdsVariable],

  run: (ctx) =>
    runHaloCheck({
      ctx,
      body: async (run) => {
        const ticketTypeIds = run.settings.changeTicketTypeIds;
        if (ticketTypeIds.length === 0) {
          missingTicketTypesFinding({
            ctx,
            resourceId: run.resourceId,
            variableLabel: changeTicketTypeIdsVariable.label,
          });
          return;
        }

        ctx.log('Fetching HaloPSA change tickets', {
          clientId: run.mapping.haloClientId,
          ticketTypeIds,
        });
        const tickets = await ticketsInWindow({ run, ticketTypeIds });

        if (tickets.length === 0) {
          ctx.pass({
            title: 'No change requests in the last 90 days',
            description: `HaloPSA has no change tickets for this client since ${run.windowStart.toISOString().slice(0, 10)}.`,
            resourceType: 'halopsa-client',
            resourceId: run.resourceId,
            evidence: {
              haloClientId: run.mapping.haloClientId,
              ticketTypeIds,
              windowStart: run.windowStart.toISOString(),
              checkedAt: run.now.toISOString(),
              ticketCount: 0,
            },
          });
          return;
        }

        for (const ticket of tickets) {
          const actions = await run.halo.listActions(ticket.id);
          const approved = hasApproval({ ticket, actions });
          const resourceId = `halo-ticket-${ticket.id}`;
          const approvals = actions
            .filter((action) => /approv/i.test(action.outcome ?? ''))
            .map((action) => ({
              actionId: action.id,
              outcome: action.outcome ?? null,
              who: action.who ?? null,
              at: action.datetime ?? action.actiondatecreated ?? null,
            }));
          const evidence = { ...ticketEvidence(ticket), approved, approvals };

          if (approved) {
            ctx.pass({
              title: `Change #${ticket.id} was approved`,
              description: `"${ticket.summary ?? ''}" has a recorded approval.`,
              resourceType: 'halopsa-ticket',
              resourceId,
              evidence,
            });
            continue;
          }

          ctx.fail({
            title: `Change #${ticket.id} has no recorded approval`,
            description: `"${ticket.summary ?? ''}" has no approval action in HaloPSA.`,
            resourceType: 'halopsa-ticket',
            resourceId,
            severity: 'medium',
            remediation: `Obtain and record approval on Halo ticket #${ticket.id} (use the Halo approval process or an "Approved" action) before implementing the change.`,
            evidence,
          });
        }
      },
    }),
};
