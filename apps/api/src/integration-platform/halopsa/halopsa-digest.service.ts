import { Injectable, Logger } from '@nestjs/common';
import { db } from '@db';
import { parseHaloAlertSettings } from '@trycompai/integration-platform';
import { loadHaloOrgConnection, toVariableValues } from './halopsa-connection';
import { buildDigestTicket, collectDigestItems, digestItemCount, isoWeekLabel } from './halopsa-digest';
import { generateRefToken } from './halopsa-ref-token';
import { buildNote } from './halopsa-ticket-content';
import { HALOPSA_PROVIDER_SLUG } from './halopsa.constants';

export type DigestOutcome = 'trigger_disabled' | 'no_connection' | 'already_sent' | 'no_items' | 'created';

/**
 * Weekly due-items digest (plan 5.2). Per org with the `weekly_digest`
 * trigger: close last week's digest ticket, then open this week's only when
 * there is something due. Runs in UTC (no per-org timezone is stored).
 */
@Injectable()
export class HaloDigestService {
  private readonly logger = new Logger(HaloDigestService.name);

  /** Organizations whose halopsa connection has `weekly_digest` enabled. */
  async listDigestOrganizations(): Promise<string[]> {
    const connections = await db.integrationConnection.findMany({
      where: { status: 'active', provider: { slug: HALOPSA_PROVIDER_SLUG } },
      select: { organizationId: true, variables: true },
    });
    const orgIds = connections
      .filter((c) => {
        return parseHaloAlertSettings(toVariableValues(c.variables)).enabledTriggers.includes(
          'weekly_digest',
        );
      })
      .map((c) => c.organizationId);
    return [...new Set(orgIds)];
  }

  async runForOrganization({
    organizationId,
    now = new Date(),
  }: {
    organizationId: string;
    now?: Date;
  }): Promise<DigestOutcome> {
    const halo = await loadHaloOrgConnection(organizationId);
    if (!halo) return 'no_connection';
    const { connection, settings } = halo;
    if (!settings.enabledTriggers.includes('weekly_digest')) return 'trigger_disabled';

    const weekLabel = isoWeekLabel(now);
    const dedupKey = `digest:${weekLabel}`;
    const existing = await db.haloTicketLink.findUnique({
      where: { organizationId_dedupKey: { organizationId, dedupKey } },
      select: { id: true },
    });
    if (existing) return 'already_sent';

    const items = await collectDigestItems({ organizationId, now });
    const total = digestItemCount(items);
    const org = await db.organization.findUnique({ where: { id: organizationId }, select: { name: true } });

    return db.$transaction(async (tx) => {
      // Close every earlier digest ticket that is still open.
      const previous = await tx.haloTicketLink.findMany({
        where: { organizationId, entityType: 'digest', state: { in: ['open', 'pending_create'] } },
      });
      for (const link of previous) {
        await tx.haloTicketLink.update({
          where: { id: link.id },
          data: { state: 'resolved', resolvedAt: now, lastEventAt: now },
        });
        if (link.state === 'pending_create') {
          await tx.haloOutboxEvent.updateMany({
            where: { linkId: link.id, status: 'pending', kind: 'create_ticket' },
            data: { status: 'done', lastError: 'cancelled: superseded by a newer digest' },
          });
          continue;
        }
        const note = buildNote([`Superseded by the ${weekLabel} digest.`]);
        await tx.haloOutboxEvent.create({
          data: settings.resolvedStatusId
            ? { organizationId, linkId: link.id, kind: 'set_status', payload: { note, statusId: settings.resolvedStatusId } }
            : { organizationId, linkId: link.id, kind: 'add_note', payload: { note } },
        });
      }

      if (total === 0) return 'no_items' as const;

      const refToken = generateRefToken();
      const content = buildDigestTicket({
        refToken,
        organizationId,
        organizationName: org?.name ?? organizationId,
        items,
        weekLabel,
      });
      const link = await tx.haloTicketLink.create({
        data: {
          organizationId,
          connectionId: connection.id,
          entityType: 'digest',
          entityId: weekLabel,
          dedupKey,
          refToken,
          lastEventAt: now,
        },
      });
      await tx.haloOutboxEvent.create({
        data: {
          organizationId,
          linkId: link.id,
          kind: 'create_ticket',
          payload: {
            summary: content.summary,
            details: content.details,
            priorityId: settings.priorityMap.low,
            ...(settings.ticketTypeId ? { ticketTypeId: settings.ticketTypeId } : {}),
            ...(settings.teamId ? { teamId: settings.teamId } : {}),
            ...(settings.agentId ? { agentId: settings.agentId } : {}),
          },
        },
      });
      return 'created' as const;
    });
  }
}
