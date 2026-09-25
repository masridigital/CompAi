import { TASK_TEMPLATES } from '../../../task-mappings';
import type { IntegrationCheck } from '../../../types';
import { ticketClosedAt } from '../client';
import { accessReviewTicketTypeIdsVariable } from '../variables';
import {
  EVIDENCE_WINDOW_DAYS,
  missingTicketTypesFinding,
  runHaloCheck,
  ticketEvidence,
} from './shared';

export const accessReviewCheck: IntegrationCheck = {
  id: 'halopsa_access_review',
  name: 'Access review completed in the last 90 days',
  description: `A recurring access-review ticket for this client was closed in HaloPSA in the last ${EVIDENCE_WINDOW_DAYS} days.`,
  taskMapping: TASK_TEMPLATES.accessReviewLog,
  defaultSeverity: 'medium',
  variables: [accessReviewTicketTypeIdsVariable],

  run: (ctx) =>
    runHaloCheck({
      ctx,
      body: async (run) => {
        const ticketTypeIds = run.settings.accessReviewTicketTypeIds;
        if (ticketTypeIds.length === 0) {
          missingTicketTypesFinding({
            ctx,
            resourceId: run.resourceId,
            variableLabel: accessReviewTicketTypeIdsVariable.label,
          });
          return;
        }

        ctx.log('Fetching closed HaloPSA access review tickets', {
          clientId: run.mapping.haloClientId,
          ticketTypeIds,
        });
        // A quarterly review can be logged before the window and closed inside it,
        // so search by type only and filter on the close date.
        const tickets = await run.halo.searchTickets({
          clientId: run.mapping.haloClientId,
          ticketTypeIds,
          open: false,
          maxPages: 10,
        });
        const closedInWindow = tickets
          .map((ticket) => ({ ticket, closedAt: ticketClosedAt(ticket) }))
          .filter(({ closedAt }) => closedAt !== null && closedAt >= run.windowStart)
          .sort((a, b) => (b.closedAt?.getTime() ?? 0) - (a.closedAt?.getTime() ?? 0));

        const evidenceBase = {
          haloClientId: run.mapping.haloClientId,
          ticketTypeIds,
          windowStart: run.windowStart.toISOString(),
          checkedAt: run.now.toISOString(),
        };

        const latest = closedInWindow[0];
        if (!latest) {
          ctx.fail({
            title: 'No access review closed in the last 90 days',
            description: `HaloPSA has no closed access-review ticket for this client since ${run.windowStart.toISOString().slice(0, 10)}.`,
            resourceType: 'halopsa-client',
            resourceId: run.resourceId,
            severity: 'medium',
            remediation:
              'Run the user access review for this client, record the reviewed accounts and changes in a Halo access-review ticket, and close it. Consider a recurring Halo ticket so it is raised every quarter.',
            evidence: { ...evidenceBase, closedReviews: 0 },
          });
          return;
        }

        ctx.pass({
          title: `Access review #${latest.ticket.id} closed ${latest.closedAt?.toISOString().slice(0, 10)}`,
          description: `${closedInWindow.length} access-review ticket(s) closed in the last ${EVIDENCE_WINDOW_DAYS} days.`,
          resourceType: 'halopsa-client',
          resourceId: run.resourceId,
          evidence: {
            ...evidenceBase,
            closedReviews: closedInWindow.length,
            tickets: closedInWindow.map(({ ticket }) => ticketEvidence(ticket)),
          },
        });
      },
    }),
};
