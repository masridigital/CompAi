import { createTokenProvider, type FetchLike, type HaloTokenProvider } from './auth';
import { getClient, listClients, listSites } from './clients';
import { loadHaloConfig, type HaloConfig, type HaloEnv } from './config';
import { updateClientCustomFields, type HaloCustomFieldValue } from './custom-fields';
import { createHaloHttp, type HaloHttp, type SleepFn } from './http';
import { listAgents, listPriorities, listStatuses, listTeams, listTicketTypes } from './meta';
import type {
  HaloAction,
  HaloAgent,
  HaloClientRecord,
  HaloPriority,
  HaloSite,
  HaloStatus,
  HaloTeam,
  HaloTicket,
  HaloTicketType,
  HaloUser,
} from './schemas';
import {
  addAction,
  createTicket,
  getTicket,
  listActions,
  searchTickets,
  setStatus,
  type AddActionInput,
  type CreateTicketInput,
  type SearchTicketsInput,
} from './tickets';
import { listClientUsers } from './users';
import { attachToTicket, type AttachToTicketInput } from './attachments';

export interface HaloClientOptions {
  /** Explicit config. Defaults to {@link loadHaloConfig} over `env`. */
  config?: HaloConfig;
  /** Environment to read HALOPSA_* from. Defaults to `process.env`. */
  env?: HaloEnv;
  /** Custom fetch (tests). When omitted, global fetch and a process-wide token cache are used. */
  fetchImpl?: FetchLike;
  sleep?: SleepFn;
  now?: () => number;
  /** Retries for 429 / 5xx / network errors. Default 3. */
  maxRetries?: number;
}

export interface HaloClient {
  readonly config: HaloConfig;
  readonly http: HaloHttp;

  listClients: (params?: { search?: string }) => Promise<HaloClientRecord[]>;
  getClient: (clientId: number) => Promise<HaloClientRecord>;
  listSites: (clientId: number) => Promise<HaloSite[]>;
  /** Client contacts (end users), including inactive ones. */
  listClientUsers: (clientId: number) => Promise<HaloUser[]>;
  attachToTicket: (input: AttachToTicketInput) => Promise<number>;

  createTicket: (input: CreateTicketInput) => Promise<number>;
  getTicket: (ticketId: number) => Promise<HaloTicket>;
  searchTickets: (input: SearchTicketsInput) => Promise<HaloTicket[]>;
  addAction: (input: AddActionInput) => Promise<number>;
  listActions: (ticketId: number) => Promise<HaloAction[]>;
  setStatus: (params: { ticketId: number; statusId: number }) => Promise<void>;

  listTicketTypes: () => Promise<HaloTicketType[]>;
  listStatuses: () => Promise<HaloStatus[]>;
  listTeams: () => Promise<HaloTeam[]>;
  listAgents: () => Promise<HaloAgent[]>;
  listPriorities: () => Promise<HaloPriority[]>;

  updateClientCustomFields: (params: {
    clientId: number;
    fields: Record<string, HaloCustomFieldValue>;
  }) => Promise<void>;
}

/** Process-wide token cache so separate client instances share one token. */
const sharedTokenProviders = new Map<string, HaloTokenProvider>();

const globalFetch: FetchLike = (input, init) => globalThis.fetch(input, init);

function tokenCacheKey(config: HaloConfig): string {
  return [config.authUrl, config.tenant ?? '', config.clientId, config.scope].join('|');
}

/** Clear the shared token cache (tests, or after rotating the secret). */
export function resetHaloTokenCache(): void {
  sharedTokenProviders.clear();
}

function resolveTokenProvider({
  config,
  fetchImpl,
  now,
}: {
  config: HaloConfig;
  fetchImpl?: FetchLike;
  now?: () => number;
}): HaloTokenProvider {
  if (fetchImpl) return createTokenProvider({ config, fetchImpl, now });

  const key = tokenCacheKey(config);
  const existing = sharedTokenProviders.get(key);
  if (existing) return existing;

  const provider = createTokenProvider({ config, fetchImpl: globalFetch, now });
  sharedTokenProviders.set(key, provider);
  return provider;
}

/**
 * Create a HaloPSA API client. Throws `HaloConfigError` when the HALOPSA_*
 * environment is incomplete and no explicit `config` is given.
 */
export function createHaloClient(options: HaloClientOptions = {}): HaloClient {
  const config = options.config ?? loadHaloConfig(options.env);
  const tokens = resolveTokenProvider({ config, fetchImpl: options.fetchImpl, now: options.now });
  const http = createHaloHttp({
    config,
    tokens,
    fetchImpl: options.fetchImpl ?? globalFetch,
    sleep: options.sleep,
    maxRetries: options.maxRetries,
    now: options.now,
  });

  return {
    config,
    http,
    listClients: (params) => listClients({ http, search: params?.search }),
    getClient: (clientId) => getClient({ http, clientId }),
    listSites: (clientId) => listSites({ http, clientId }),
    listClientUsers: (clientId) => listClientUsers({ http, clientId }),
    attachToTicket: (input) => attachToTicket({ http, input }),
    createTicket: (input) => createTicket({ http, input }),
    getTicket: (ticketId) => getTicket({ http, ticketId }),
    searchTickets: (input) => searchTickets({ http, input }),
    addAction: (input) => addAction({ http, input }),
    listActions: (ticketId) => listActions({ http, ticketId }),
    setStatus: ({ ticketId, statusId }) => setStatus({ http, ticketId, statusId }),
    listTicketTypes: () => listTicketTypes({ http }),
    listStatuses: () => listStatuses({ http }),
    listTeams: () => listTeams({ http }),
    listAgents: () => listAgents({ http }),
    listPriorities: () => listPriorities({ http }),
    updateClientCustomFields: ({ clientId, fields }) =>
      updateClientCustomFields({ http, clientId, fields }),
  };
}

export { buildTokenUrl, createTokenProvider, HaloAuthError, TOKEN_REFRESH_SKEW_MS } from './auth';
export type { FetchLike, HaloTokenProvider } from './auth';
export { DEFAULT_HALOPSA_SCOPE, HaloConfigError, isHaloConfigured, loadHaloConfig } from './config';
export type { HaloConfig, HaloEnv } from './config';
export { buildClientCustomFieldsPayload } from './custom-fields';
export type { HaloCustomFieldEntry, HaloCustomFieldValue } from './custom-fields';
export { computeRetryDelay, createHaloHttp, HALO_PAGE_SIZE, HaloApiError } from './http';
export type { HaloHttp, HaloPageRequest, HaloQuery, HaloRequest, SleepFn } from './http';
export * from './schemas';
export { buildAddActionPayload, buildCreateTicketPayload, buildSetStatusPayload } from './tickets';
export type { AddActionInput, CreateTicketInput, SearchTicketsInput } from './tickets';
export { listClientUsers } from './users';
export {
  base64DecodedBytes,
  buildAttachmentPayload,
  HALO_MAX_ATTACHMENT_BYTES,
  HaloAttachmentTooLargeError,
} from './attachments';
export type { AttachToTicketInput } from './attachments';
