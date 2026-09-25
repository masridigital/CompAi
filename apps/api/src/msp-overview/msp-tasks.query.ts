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

const DAY_MS = 24 * 60 * 60 * 1000;
/** Same window as the posture snapshot's `evidenceExpiring30d`. */
export const DUE_SOON_WINDOW_DAYS = 30;

export const mspTasksQuerySchema = z.object({
  view: z.enum(['overdue', 'due-soon']).default('overdue'),
  cursor: cursorParamSchema,
  limit: limitSchema,
});
export type MspTasksParams = z.infer<typeof mspTasksQuerySchema>;

export interface MspTaskRow {
  organizationId: string;
  orgName: string;
  taskId: string;
  title: string;
  status: string;
  assigneeName: string | null;
  reviewDate: Date | null;
}

/**
 * Status/date filter for a view. Mirrors the posture snapshot definitions:
 * overdue = reviewDate passed and not done / not relevant; due-soon =
 * reviewDate within the next 30 days and not "not relevant".
 */
export function taskViewFilter({
  view,
  now,
}: {
  view: MspTasksParams['view'];
  now: Date;
}): Prisma.TaskWhereInput {
  if (view === 'overdue') {
    return {
      reviewDate: { lt: now },
      status: { notIn: ['done', 'not_relevant'] },
    };
  }
  return {
    reviewDate: {
      gte: now,
      lte: new Date(now.getTime() + DUE_SOON_WINDOW_DAYS * DAY_MS),
    },
    status: { not: 'not_relevant' },
  };
}

/** Cross-org task list, bounded to orgs where the viewer has `task:read`. */
@Injectable()
export class MspTasksQuery {
  async list({
    scope,
    query,
    now = new Date(),
  }: {
    scope: MspScope;
    query: MspTasksParams;
    now?: Date;
  }): Promise<{ data: MspTaskRow[]; nextCursor: string | null }> {
    const orgIds = orgIdsWithRead({ scope, resource: 'task' });
    if (orgIds.length === 0) return { data: [], nextCursor: null };

    const cursor = decodeCursor(query.cursor);
    const and: Prisma.TaskWhereInput[] = [
      { organizationId: { in: orgIds }, archivedAt: null },
      taskViewFilter({ view: query.view, now }),
    ];
    if (cursor) {
      and.push({
        OR: [
          { reviewDate: { gt: cursor.t } },
          { reviewDate: cursor.t, id: { gt: cursor.i } },
        ],
      });
    }

    const rows = await db.task.findMany({
      where: { AND: and },
      orderBy: [{ reviewDate: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      select: {
        id: true,
        title: true,
        status: true,
        reviewDate: true,
        organizationId: true,
        assignee: { select: { user: { select: { name: true } } } },
      },
    });

    const { page, nextCursor } = paginate({
      rows,
      limit: query.limit,
      key: (row) => (row.reviewDate ? { t: row.reviewDate, i: row.id } : null),
    });
    const names = orgNameMap(scope);
    return {
      data: page.map((row) => ({
        organizationId: row.organizationId,
        orgName: names.get(row.organizationId) ?? '',
        taskId: row.id,
        title: row.title,
        status: row.status,
        assigneeName: row.assignee?.user?.name ?? null,
        reviewDate: row.reviewDate,
      })),
      nextCursor,
    };
  }
}
