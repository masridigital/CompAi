import type { HaloHttp } from './http';
import { HaloClientSchema, HaloSiteSchema, type HaloClientRecord, type HaloSite } from './schemas';

/** List active Halo clients (inactive ones are filtered out server- and client-side). */
export async function listClients({
  http,
  search,
}: {
  http: HaloHttp;
  search?: string;
}): Promise<HaloClientRecord[]> {
  const clients = await http.getAllPages({
    path: '/Client',
    query: { includeinactive: false, search },
    itemsKey: 'clients',
    schema: HaloClientSchema,
  });
  return clients.filter((client) => client.inactive !== true);
}

export async function getClient({
  http,
  clientId,
}: {
  http: HaloHttp;
  clientId: number;
}): Promise<HaloClientRecord> {
  const data = await http.get(`/Client/${clientId}`);
  return HaloClientSchema.parse(data);
}

export async function listSites({
  http,
  clientId,
}: {
  http: HaloHttp;
  clientId: number;
}): Promise<HaloSite[]> {
  return http.getAllPages({
    path: '/Site',
    query: { client_id: clientId },
    itemsKey: 'sites',
    schema: HaloSiteSchema,
  });
}
