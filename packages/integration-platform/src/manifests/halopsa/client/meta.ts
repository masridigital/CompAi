import type { z } from 'zod';
import { extractItems, type HaloHttp } from './http';
import {
  HaloAgentSchema,
  HaloPrioritySchema,
  HaloStatusSchema,
  HaloTeamSchema,
  HaloTicketTypeSchema,
  type HaloAgent,
  type HaloPriority,
  type HaloStatus,
  type HaloTeam,
  type HaloTicketType,
} from './schemas';

/** Lookup endpoints return a bare array on most versions; tolerate a keyed object too. */
async function listLookup<T>({
  http,
  path,
  itemsKey,
  schema,
}: {
  http: HaloHttp;
  path: string;
  itemsKey: string;
  schema: z.ZodType<T>;
}): Promise<T[]> {
  const data = await http.get(path);
  return extractItems({ data, itemsKey }).map((item) => schema.parse(item));
}

export function listTicketTypes({ http }: { http: HaloHttp }): Promise<HaloTicketType[]> {
  return listLookup({
    http,
    path: '/TicketType',
    itemsKey: 'tickettypes',
    schema: HaloTicketTypeSchema,
  });
}

export function listStatuses({ http }: { http: HaloHttp }): Promise<HaloStatus[]> {
  return listLookup({ http, path: '/Status', itemsKey: 'statuses', schema: HaloStatusSchema });
}

export function listTeams({ http }: { http: HaloHttp }): Promise<HaloTeam[]> {
  return listLookup({ http, path: '/Team', itemsKey: 'teams', schema: HaloTeamSchema });
}

export function listAgents({ http }: { http: HaloHttp }): Promise<HaloAgent[]> {
  return listLookup({ http, path: '/Agent', itemsKey: 'agents', schema: HaloAgentSchema });
}

export function listPriorities({ http }: { http: HaloHttp }): Promise<HaloPriority[]> {
  return listLookup({
    http,
    path: '/Priority',
    itemsKey: 'priorities',
    schema: HaloPrioritySchema,
  });
}
