import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

export const MSP_MAX_LIMIT = 100;
export const MSP_DEFAULT_LIMIT = 50;

/** Keyset cursor over (timestamp, id). Opaque base64url JSON to clients. */
const cursorSchema = z.object({
  t: z.string().datetime(),
  i: z.string().min(1).max(200),
});

export interface MspCursor {
  t: Date;
  i: string;
}

export function encodeCursor({ t, i }: MspCursor): string {
  return Buffer.from(JSON.stringify({ t: t.toISOString(), i })).toString(
    'base64url',
  );
}

export function decodeCursor(raw: string | undefined): MspCursor | null {
  if (!raw) return null;
  try {
    const json: unknown = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    );
    const parsed = cursorSchema.parse(json);
    return { t: new Date(parsed.t), i: parsed.i };
  } catch {
    throw new BadRequestException('Invalid cursor');
  }
}

/**
 * Split a `take: limit + 1` result into the page and the next cursor.
 * `key` returns the row's (timestamp, id) pair; rows with no timestamp end
 * the pagination (callers filter those out in SQL).
 */
export function paginate<T>({
  rows,
  limit,
  key,
}: {
  rows: T[];
  limit: number;
  key: (row: T) => MspCursor | null;
}): { page: T[]; nextCursor: string | null } {
  if (rows.length <= limit) return { page: rows, nextCursor: null };
  const page = rows.slice(0, limit);
  const last = key(page[page.length - 1]);
  return { page, nextCursor: last ? encodeCursor(last) : null };
}

export const limitSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(MSP_MAX_LIMIT)
  .default(MSP_DEFAULT_LIMIT);

export const cursorParamSchema = z.string().max(1000).optional();

/** Parse a query object with zod; failures become 400s. */
export function parseQuery<S extends z.ZodTypeAny>({
  schema,
  query,
}: {
  schema: S;
  query: unknown;
}): z.infer<S> {
  const result = schema.safeParse(query ?? {});
  if (!result.success) {
    throw new BadRequestException(
      result.error.issues.map((issue) => issue.message).join('; '),
    );
  }
  return result.data;
}
