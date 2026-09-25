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

const TITLE_MAX = 140;

export const mspFindingsQuerySchema = z.object({
  /**
   * `open` = every status except closed (same as the posture `openFindings`
   * count); the other values match one FindingStatus exactly.
   */
  status: z
    .enum(['open', 'ready_for_review', 'needs_revision', 'closed'])
    .default('open'),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  cursor: cursorParamSchema,
  limit: limitSchema,
});
export type MspFindingsParams = z.infer<typeof mspFindingsQuerySchema>;

export interface MspFindingRow {
  organizationId: string;
  orgName: string;
  findingId: string;
  title: string;
  severity: string;
  status: string;
  createdAt: Date;
}

export function findingTitle({
  templateTitle,
  content,
}: {
  templateTitle: string | null | undefined;
  content: string;
}): string {
  if (templateTitle) return templateTitle;
  const flat = content.replace(/\s+/g, ' ').trim();
  return flat.length > TITLE_MAX ? `${flat.slice(0, TITLE_MAX - 1)}…` : flat;
}

/** Cross-org findings, bounded to orgs where the viewer has `finding:read`. */
@Injectable()
export class MspFindingsQuery {
  async list({
    scope,
    query,
  }: {
    scope: MspScope;
    query: MspFindingsParams;
  }): Promise<{ data: MspFindingRow[]; nextCursor: string | null }> {
    const orgIds = orgIdsWithRead({ scope, resource: 'finding' });
    if (orgIds.length === 0) return { data: [], nextCursor: null };

    const cursor = decodeCursor(query.cursor);
    const and: Prisma.FindingWhereInput[] = [
      { organizationId: { in: orgIds } },
      query.status === 'open'
        ? { status: { not: 'closed' } }
        : { status: query.status },
    ];
    if (query.severity) and.push({ severity: query.severity });
    if (cursor) {
      and.push({
        OR: [
          { createdAt: { lt: cursor.t } },
          { createdAt: cursor.t, id: { lt: cursor.i } },
        ],
      });
    }

    const rows = await db.finding.findMany({
      where: { AND: and },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      select: {
        id: true,
        content: true,
        severity: true,
        status: true,
        createdAt: true,
        organizationId: true,
        template: { select: { title: true } },
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
        findingId: row.id,
        title: findingTitle({
          templateTitle: row.template?.title,
          content: row.content,
        }),
        severity: row.severity,
        status: row.status,
        createdAt: row.createdAt,
      })),
      nextCursor,
    };
  }
}
