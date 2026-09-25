import { Logger } from '@nestjs/common';
import { db, type CommentEntityType, type HaloTicketLink } from '@db';
import { redactSecrets } from '../utils/redact-secrets';

const logger = new Logger('HaloClosedHandler');
const MAX_COMMENT_LENGTH = 2000;

export type ClosedOutcome = 'not_open' | 'already_closed' | 'closed' | 'closed_no_comment';

/**
 * Comment author for integration-generated comments. There is no system user,
 * so the comment is attributed to the task assignee when there is one, then an
 * org owner, then any active member (plain text prefixed "[HaloPSA]").
 */
async function resolveAuthorMemberId({
  organizationId,
  taskId,
}: {
  organizationId: string;
  taskId?: string;
}): Promise<string | null> {
  if (taskId) {
    const task = await db.task.findFirst({
      where: { id: taskId, organizationId },
      select: { assignee: { select: { id: true, deactivated: true } } },
    });
    if (task?.assignee && !task.assignee.deactivated) return task.assignee.id;
  }
  const owner = await db.member.findFirst({
    where: { organizationId, deactivated: false, role: { contains: 'owner' } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (owner) return owner.id;
  const anyMember = await db.member.findFirst({
    where: { organizationId, deactivated: false },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  return anyMember?.id ?? null;
}

export function buildClosedComment({
  ticketId,
  agentName,
  resolution,
}: {
  ticketId: number;
  agentName?: string | null;
  resolution?: string | null;
}): string {
  const by = agentName ? ` by ${redactSecrets(agentName)}` : '';
  const text = redactSecrets(resolution ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const body = `[HaloPSA] Halo ticket #${ticketId} closed${by}: ${text || 'no resolution note'}`;
  return body.length > MAX_COMMENT_LENGTH ? `${body.slice(0, MAX_COMMENT_LENGTH - 1)}…` : body;
}

function commentTarget(link: HaloTicketLink): { entityType: CommentEntityType; entityId: string } | null {
  if (link.entityType === 'check') return { entityType: 'task', entityId: link.entityId };
  if (link.entityType === 'finding') return { entityType: 'finding', entityId: link.entityId };
  return null;
}

/**
 * A Halo ticket was closed (webhook or reconcile). Marks the link
 * `closed_externally` and leaves a comment on the linked task or finding.
 * A Halo close is a signal, not evidence: the task is never marked done here.
 *
 * Only links in state `open` are acted on: a ticket we resolved ourselves
 * (state `resolved`, e.g. after the check passed) closing in Halo is our own
 * auto-resolve, not an external close, and must not add a comment or flip
 * the link. The state guard is repeated in the update for races.
 */
export async function handleHaloTicketClosed({
  link,
  ticketId,
  resolution,
  agentName,
  now = new Date(),
}: {
  link: HaloTicketLink;
  ticketId: number;
  resolution?: string | null;
  agentName?: string | null;
  now?: Date;
}): Promise<ClosedOutcome> {
  if (link.state !== 'open') return 'not_open';
  const updated = await db.haloTicketLink.updateMany({
    where: { id: link.id, state: 'open' },
    data: { state: 'closed_externally', resolvedAt: link.resolvedAt ?? now, lastEventAt: now },
  });
  if (updated.count === 0) return 'already_closed';

  const target = commentTarget(link);
  if (!target) return 'closed_no_comment';

  const authorId = await resolveAuthorMemberId({
    organizationId: link.organizationId,
    taskId: target.entityType === 'task' ? target.entityId : undefined,
  });
  if (!authorId) {
    logger.warn(`No member to author the Halo close comment for link ${link.id}`);
    return 'closed_no_comment';
  }

  await db.comment.create({
    data: {
      content: buildClosedComment({ ticketId, agentName, resolution }),
      entityId: target.entityId,
      entityType: target.entityType,
      organizationId: link.organizationId,
      authorId,
    },
  });
  return 'closed';
}
