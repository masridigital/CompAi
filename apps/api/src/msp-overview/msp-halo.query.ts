import { Injectable } from '@nestjs/common';
import { db, type Prisma } from '@db';
import { z } from 'zod';
import {
  cursorParamSchema,
  decodeCursor,
  limitSchema,
  paginate,
} from './msp-cursor';
import { orgIdsWithRead, orgNameMap, type MspScope } from './msp-scope';

export const mspHaloTicketsQuerySchema = z.object({
  state: z
    .enum(['open', 'pending_create', 'resolved', 'closed_externally'])
    .default('open'),
  cursor: cursorParamSchema,
  limit: limitSchema,
});
export type MspHaloTicketsParams = z.infer<typeof mspHaloTicketsQuerySchema>;

export interface MspHaloTicketRow {
  organizationId: string;
  orgName: string;
  linkId: string;
  entityType: string;
  entityId: string;
  haloTicketId: number | null;
  refToken: string;
  state: string;
  /** Halo agent UI link; the format is unconfirmed, so the id is returned too. */
  url: string | null;
  createdAt: Date;
  lastEventAt: Date;
}

/**
 * Halo agent UI link for a ticket: `${HALOPSA_BASE_URL}/ticket?id={id}`.
 * Unconfirmed for every Halo version (see the halopsa README).
 */
export function haloTicketUrl({
  haloTicketId,
  env = process.env,
}: {
  haloTicketId: number | null;
  env?: NodeJS.ProcessEnv;
}): string | null {
  if (!haloTicketId) return null;
  const base = env.HALOPSA_BASE_URL?.trim().replace(/\/+$/, '');
  return base ? `${base}/ticket?id=${haloTicketId}` : null;
}

/** HaloTicketLink rows, bounded to orgs where the viewer has `integration:read`. */
@Injectable()
export class MspHaloTicketsQuery {
  async list({
    scope,
    query,
  }: {
    scope: MspScope;
    query: MspHaloTicketsParams;
  }): Promise<{ data: MspHaloTicketRow[]; nextCursor: string | null }> {
    const orgIds = orgIdsWithRead({ scope, resource: 'integration' });
    if (orgIds.length === 0) return { data: [], nextCursor: null };

    const cursor = decodeCursor(query.cursor);
    const and: Prisma.HaloTicketLinkWhereInput[] = [
      { organizationId: { in: orgIds }, state: query.state },
    ];
    if (cursor) {
      and.push({
        OR: [
          { createdAt: { lt: cursor.t } },
          { createdAt: cursor.t, id: { lt: cursor.i } },
        ],
      });
    }

    const rows = await db.haloTicketLink.findMany({
      where: { AND: and },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      select: {
        id: true,
        organizationId: true,
        entityType: true,
        entityId: true,
        haloTicketId: true,
        refToken: true,
        state: true,
        createdAt: true,
        lastEventAt: true,
      },
    });

    const { page, nextCursor } = paginate({
      rows,
      limit: query.limit,
      key: (row) => ({ t: row.createdAt, i: row.id }),
    });
    const names = orgNameMap(scope);
    return {
      data: page.map((row) => ({
        organizationId: row.organizationId,
        orgName: names.get(row.organizationId) ?? '',
        linkId: row.id,
        entityType: row.entityType,
        entityId: row.entityId,
        haloTicketId: row.haloTicketId,
        refToken: row.refToken,
        state: row.state,
        url: haloTicketUrl({ haloTicketId: row.haloTicketId }),
        createdAt: row.createdAt,
        lastEventAt: row.lastEventAt,
      })),
      nextCursor,
    };
  }
}
