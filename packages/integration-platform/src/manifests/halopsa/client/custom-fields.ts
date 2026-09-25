import type { HaloHttp } from './http';

export type HaloCustomFieldValue = string | number;

export interface HaloCustomFieldEntry {
  name: string;
  value: HaloCustomFieldValue;
}

/** Build the `POST /Client` body that sets client-level custom fields. */
export function buildClientCustomFieldsPayload({
  clientId,
  fields,
}: {
  clientId: number;
  fields: Record<string, HaloCustomFieldValue>;
}): Array<{ id: number; customfields: HaloCustomFieldEntry[] }> {
  const customfields = Object.entries(fields).map(([name, value]) => ({ name, value }));
  return [{ id: clientId, customfields }];
}

/**
 * Set client custom fields (e.g. CFCompAIScore). Requires the `edit:customers`
 * scope on the Halo API application.
 */
export async function updateClientCustomFields({
  http,
  clientId,
  fields,
}: {
  http: HaloHttp;
  clientId: number;
  fields: Record<string, HaloCustomFieldValue>;
}): Promise<void> {
  if (Object.keys(fields).length === 0) return;
  await http.post('/Client', buildClientCustomFieldsPayload({ clientId, fields }));
}
