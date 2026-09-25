import { z } from 'zod';

/**
 * Zod schemas for HaloPSA API responses.
 *
 * Every object is loose (unknown keys are kept) because Halo returns many more
 * fields than we use and renames some between versions. Confirm field names
 * against https://portal.masri.tech/apidoc.
 */

const haloId = z.coerce.number().int();
const optionalId = haloId.optional().nullable();
const optionalString = z.string().optional().nullable();
const optionalBool = z.boolean().optional().nullable();

export const HaloClientSchema = z.looseObject({
  id: haloId,
  name: z.string(),
  inactive: optionalBool,
  website: optionalString,
  toplevel_id: optionalId,
  customfields: z.array(z.looseObject({})).optional().nullable(),
});
export type HaloClientRecord = z.infer<typeof HaloClientSchema>;

export const HaloSiteSchema = z.looseObject({
  id: haloId,
  name: z.string(),
  client_id: optionalId,
  inactive: optionalBool,
});
export type HaloSite = z.infer<typeof HaloSiteSchema>;

/** Halo "User" = a client contact (end user), not an agent. */
export const HaloUserSchema = z.looseObject({
  id: haloId,
  name: optionalString,
  emailaddress: optionalString,
  client_id: optionalId,
  site_id: optionalId,
  inactive: optionalBool,
});
export type HaloUser = z.infer<typeof HaloUserSchema>;

export const HaloTicketSchema = z.looseObject({
  id: haloId,
  summary: z.string().optional().nullable().default(''),
  details: optionalString,
  client_id: optionalId,
  client_name: optionalString,
  site_id: optionalId,
  user_id: optionalId,
  tickettype_id: optionalId,
  status_id: optionalId,
  team_id: optionalId,
  team: optionalString,
  agent_id: optionalId,
  priority_id: optionalId,
  /** Date logged. */
  dateoccurred: optionalString,
  datecreated: optionalString,
  /** Date closed (name varies by Halo version; both are read). */
  dateclosed: optionalString,
  datecleared: optionalString,
  hasbeenclosed: optionalBool,
  closure_note: optionalString,
  resolution: optionalString,
});
export type HaloTicket = z.infer<typeof HaloTicketSchema>;

export const HaloActionSchema = z.looseObject({
  id: haloId,
  ticket_id: optionalId,
  note: optionalString,
  outcome: optionalString,
  outcome_id: optionalId,
  hiddenfromuser: optionalBool,
  datetime: optionalString,
  actiondatecreated: optionalString,
  who: optionalString,
});
export type HaloAction = z.infer<typeof HaloActionSchema>;

export const HaloTicketTypeSchema = z.looseObject({
  id: haloId,
  name: z.string(),
  inactive: optionalBool,
});
export type HaloTicketType = z.infer<typeof HaloTicketTypeSchema>;

export const HaloStatusSchema = z.looseObject({
  id: haloId,
  name: z.string(),
  /** Halo status type; closed statuses are typically type 4 ("Closed"). */
  type: z.union([z.number(), z.string()]).optional().nullable(),
});
export type HaloStatus = z.infer<typeof HaloStatusSchema>;

export const HaloTeamSchema = z.looseObject({
  id: haloId,
  name: z.string(),
  inactive: optionalBool,
});
export type HaloTeam = z.infer<typeof HaloTeamSchema>;

export const HaloAgentSchema = z.looseObject({
  id: haloId,
  name: z.string(),
  email: optionalString,
  inactive: optionalBool,
});
export type HaloAgent = z.infer<typeof HaloAgentSchema>;

/** Halo priorities are keyed by `priorityid` on some versions and `id` on others. */
export const HaloPrioritySchema = z.looseObject({
  id: optionalId,
  priorityid: optionalId,
  name: z.string(),
});
export type HaloPriority = z.infer<typeof HaloPrioritySchema>;

/** Response of a create/update POST: a single object or an array of objects. */
export const HaloWriteResultSchema = z.union([
  z.looseObject({ id: haloId }),
  z.array(z.looseObject({ id: haloId })).min(1),
]);

export function idFromWriteResult(data: unknown): number {
  const parsed = HaloWriteResultSchema.parse(data);
  return Array.isArray(parsed) ? parsed[0].id : parsed.id;
}

/** Halo uses 1900-01-01 as "no date" and often omits the timezone (UTC). */
export function parseHaloDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  const date = new Date(hasZone ? value : `${value}Z`);
  if (Number.isNaN(date.getTime())) return null;
  if (date.getUTCFullYear() < 1971) return null;
  return date;
}

export function ticketOpenedAt(ticket: HaloTicket): Date | null {
  return parseHaloDate(ticket.dateoccurred) ?? parseHaloDate(ticket.datecreated);
}

export function ticketClosedAt(ticket: HaloTicket): Date | null {
  return parseHaloDate(ticket.dateclosed) ?? parseHaloDate(ticket.datecleared);
}
