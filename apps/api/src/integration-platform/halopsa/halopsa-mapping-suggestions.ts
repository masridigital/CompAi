/** Auto-match suggestions between Halo clients and CompAI orgs (plan 5.4). */

const COMPANY_SUFFIXES = new Set([
  'inc',
  'incorporated',
  'llc',
  'ltd',
  'limited',
  'corp',
  'corporation',
  'co',
  'company',
  'plc',
  'gmbh',
  'pty',
  'lp',
  'llp',
]);

/** "Acme, Inc." -> "acme"; "The Acme Group LLC" -> "the acme group". */
export function normalizeName(name: string | null | undefined): string {
  const words = (name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  while (words.length > 1 && COMPANY_SUFFIXES.has(words[words.length - 1])) words.pop();
  return words.join(' ');
}

/** "https://www.Acme.com/about" -> "acme.com"; garbage -> null. */
export function normalizeDomain(website: string | null | undefined): string | null {
  const raw = (website ?? '').trim();
  if (!raw) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    return host.includes('.') ? host : null;
  } catch {
    return null;
  }
}

export interface MatchableClient {
  id: number;
  name: string;
  website?: string | null;
}

export interface MatchableOrg {
  id: string;
  name: string;
  website?: string | null;
}

export interface MappingSuggestion {
  organizationId: string;
  organizationName: string;
  reason: 'domain' | 'name';
}

/** Suggestions for one Halo client, domain matches first. */
export function suggestOrgsForClient({
  client,
  orgs,
}: {
  client: MatchableClient;
  orgs: MatchableOrg[];
}): MappingSuggestion[] {
  const clientDomain = normalizeDomain(client.website);
  const clientName = normalizeName(client.name);
  const suggestions: MappingSuggestion[] = [];
  const seen = new Set<string>();

  for (const org of orgs) {
    if (clientDomain && normalizeDomain(org.website) === clientDomain) {
      suggestions.push({ organizationId: org.id, organizationName: org.name, reason: 'domain' });
      seen.add(org.id);
    }
  }
  for (const org of orgs) {
    if (seen.has(org.id)) continue;
    if (clientName && normalizeName(org.name) === clientName) {
      suggestions.push({ organizationId: org.id, organizationName: org.name, reason: 'name' });
    }
  }
  return suggestions;
}
