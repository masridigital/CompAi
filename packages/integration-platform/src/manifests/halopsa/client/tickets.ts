import type { HaloCustomFieldEntry } from './custom-fields';
import type { HaloHttp, HaloQuery } from './http';
import {
  HaloActionSchema,
  HaloTicketSchema,
  idFromWriteResult,
  type HaloAction,
  type HaloTicket,
} from './schemas';

export interface CreateTicketInput {
  clientId: number;
  siteId?: number;
  userId?: number;
  summary: string;
  details: string;
  ticketTypeId?: number;
  teamId?: number;
  agentId?: number;
  priorityId?: number;
  statusId?: number;
  customFields?: HaloCustomFieldEntry[];
}

export interface SearchTicketsInput {
  clientId?: number;
  search?: string;
  /** true = open tickets only, false = closed only, undefined = both. */
  open?: boolean;
  /** Restrict to these ticket types (also filtered client-side). */
  ticketTypeIds?: number[];
  /** Only tickets logged on/after this date (also filtered client-side). */
  since?: Date;
  maxPages?: number;
}

export interface AddActionInput {
  ticketId: number;
  note: string;
  /** Halo action outcome name. Default "Private Note". */
  outcome?: string;
  /** Default true: notes from CompAI are internal. */
  hiddenFromUser?: boolean;
}

export function buildCreateTicketPayload(input: CreateTicketInput): Array<Record<string, unknown>> {
  const ticket: Record<string, unknown> = {
    client_id: input.clientId,
    summary: input.summary,
    details: input.details,
  };
  if (input.siteId !== undefined) ticket.site_id = input.siteId;
  if (input.userId !== undefined) ticket.user_id = input.userId;
  if (input.ticketTypeId !== undefined) ticket.tickettype_id = input.ticketTypeId;
  if (input.teamId !== undefined) ticket.team_id = input.teamId;
  if (input.agentId !== undefined) ticket.agent_id = input.agentId;
  if (input.priorityId !== undefined) ticket.priority_id = input.priorityId;
  if (input.statusId !== undefined) ticket.status_id = input.statusId;
  if (input.customFields?.length) ticket.customfields = input.customFields;
  return [ticket];
}

export function buildAddActionPayload(input: AddActionInput): Array<Record<string, unknown>> {
  return [
    {
      ticket_id: input.ticketId,
      note: input.note,
      outcome: input.outcome ?? 'Private Note',
      hiddenfromuser: input.hiddenFromUser ?? true,
      sendemail: false,
    },
  ];
}

export function buildSetStatusPayload({
  ticketId,
  statusId,
}: {
  ticketId: number;
  statusId: number;
}): Array<Record<string, unknown>> {
  return [{ id: ticketId, status_id: statusId }];
}

/** Create a ticket. Returns the new Halo ticket id. */
export async function createTicket({
  http,
  input,
}: {
  http: HaloHttp;
  input: CreateTicketInput;
}): Promise<number> {
  const data = await http.post('/Tickets', buildCreateTicketPayload(input));
  return idFromWriteResult(data);
}

export async function getTicket({
  http,
  ticketId,
}: {
  http: HaloHttp;
  ticketId: number;
}): Promise<HaloTicket> {
  const data = await http.get(`/Tickets/${ticketId}`, { includedetails: true });
  return HaloTicketSchema.parse(data);
}

export async function searchTickets({
  http,
  input,
}: {
  http: HaloHttp;
  input: SearchTicketsInput;
}): Promise<HaloTicket[]> {
  const query: HaloQuery = {
    client_id: input.clientId,
    search: input.search,
    open_only: input.open === true ? true : undefined,
    closed_only: input.open === false ? true : undefined,
    requesttype: input.ticketTypeIds?.length ? input.ticketTypeIds.join(',') : undefined,
    datesearch: input.since ? 'dateoccurred' : undefined,
    startdate: input.since?.toISOString(),
  };

  const tickets = await http.getAllPages({
    path: '/Tickets',
    query,
    itemsKey: 'tickets',
    schema: HaloTicketSchema,
    maxPages: input.maxPages,
  });

  const typeFilter = input.ticketTypeIds?.length ? new Set(input.ticketTypeIds) : null;
  return tickets.filter((ticket) => {
    if (
      input.clientId !== undefined &&
      ticket.client_id != null &&
      ticket.client_id !== input.clientId
    ) {
      return false;
    }
    if (typeFilter && (ticket.tickettype_id == null || !typeFilter.has(ticket.tickettype_id))) {
      return false;
    }
    return true;
  });
}

/** Add a note (action) to a ticket. Returns the action id. */
export async function addAction({
  http,
  input,
}: {
  http: HaloHttp;
  input: AddActionInput;
}): Promise<number> {
  const data = await http.post('/Actions', buildAddActionPayload(input));
  return idFromWriteResult(data);
}

export async function listActions({
  http,
  ticketId,
}: {
  http: HaloHttp;
  ticketId: number;
}): Promise<HaloAction[]> {
  return http.getAllPages({
    path: '/Actions',
    query: { ticket_id: ticketId },
    itemsKey: 'actions',
    schema: HaloActionSchema,
  });
}

export async function setStatus({
  http,
  ticketId,
  statusId,
}: {
  http: HaloHttp;
  ticketId: number;
  statusId: number;
}): Promise<void> {
  await http.post('/Tickets', buildSetStatusPayload({ ticketId, statusId }));
}
