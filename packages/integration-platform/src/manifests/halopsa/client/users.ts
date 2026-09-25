import type { HaloHttp } from './http';
import { HaloUserSchema, type HaloUser } from './schemas';

/**
 * List a Halo client's contacts (end users): `GET /Users?client_id={id}`,
 * paged with `pageinate=true`. Inactive users are requested too
 * (`includeinactive=true`) so employee sync can deactivate them.
 * Confirm param names on https://portal.masri.tech/apidoc.
 */
export async function listClientUsers({
  http,
  clientId,
}: {
  http: HaloHttp;
  clientId: number;
}): Promise<HaloUser[]> {
  return http.getAllPages({
    path: '/Users',
    query: { client_id: clientId, includeinactive: true },
    itemsKey: 'users',
    schema: HaloUserSchema,
  });
}
