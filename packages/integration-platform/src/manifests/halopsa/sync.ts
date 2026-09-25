/**
 * HaloPSA client contacts -> CompAI People (plan 5.1, off by default).
 *
 * Runs only when the org explicitly picks `halopsa` as its employee sync
 * provider. The API feeds the result into the shared employee-sync
 * processor, so import and deactivation rules match every other provider.
 */

import type { SyncEmployee } from '../../dsl/types';
import {
  matchesSyncFilterTerms,
  parseSyncFilterTerms,
} from '../../sync-filter/email-exclusion-terms';
import type { CheckContext, CheckVariable } from '../../types';
import { createHaloClient, type HaloClientOptions, type HaloUser } from './client';
import { resolveHaloConnectionMapping } from './credentials';

export const SYNC_EXCLUDE_PATTERNS_VARIABLE_ID = 'sync_exclude_patterns';

/** Shared / service mailboxes that should never become People. */
export const DEFAULT_SYNC_EXCLUDE_PATTERNS = [
  'noreply',
  'no-reply',
  'helpdesk',
  'support@',
  'info@',
  'admin@',
] as const;

export const syncExcludePatternsVariable: CheckVariable = {
  id: SYNC_EXCLUDE_PATTERNS_VARIABLE_ID,
  label: 'Employee sync: exclude contacts matching',
  type: 'text',
  required: false,
  default: DEFAULT_SYNC_EXCLUDE_PATTERNS.join(','),
  placeholder: DEFAULT_SYNC_EXCLUDE_PATTERNS.join(','),
  helpText:
    'Comma-separated patterns matched against Halo contact emails and names (e.g. noreply, support@). Only used when HaloPSA is the employee sync provider. Leave blank for the defaults.',
};

/**
 * Parse `sync_exclude_patterns`. Unset or blank falls back to the defaults so
 * a cleared field can never import shared mailboxes by accident.
 */
export function parseSyncExcludePatterns(value: unknown): string[] {
  const parsed = parseSyncFilterTerms(value);
  return parsed.length > 0 ? parsed : [...DEFAULT_SYNC_EXCLUDE_PATTERNS];
}

/** True when the contact looks like a shared or service mailbox. */
export function isExcludedHaloContact({
  email,
  name,
  patterns,
}: {
  email: string;
  name: string;
  patterns: string[];
}): boolean {
  if (matchesSyncFilterTerms(email, patterns)) return true;
  const lowerName = name.toLowerCase();
  if (!lowerName) return false;
  return patterns.some((pattern) => !pattern.includes('@') && lowerName.includes(pattern));
}

export interface HaloEmployeeMapping {
  employees: SyncEmployee[];
  skippedNoEmail: number;
  excluded: string[];
}

/**
 * Map Halo users to standardized employees: email (lowercased) is required,
 * `active = !inactive`, shared/service mailboxes are dropped. Duplicate
 * emails keep the active record.
 */
export function mapHaloUsersToEmployees({
  users,
  excludePatterns,
}: {
  users: HaloUser[];
  excludePatterns: string[];
}): HaloEmployeeMapping {
  const byEmail = new Map<string, SyncEmployee>();
  const excluded: string[] = [];
  let skippedNoEmail = 0;

  for (const user of users) {
    const email = user.emailaddress?.trim().toLowerCase() ?? '';
    if (!email || !email.includes('@')) {
      skippedNoEmail++;
      continue;
    }

    const name = user.name?.trim() ?? '';
    if (isExcludedHaloContact({ email, name, patterns: excludePatterns })) {
      excluded.push(email);
      continue;
    }

    const employee: SyncEmployee = {
      email,
      ...(name ? { name } : {}),
      externalId: String(user.id),
      status: user.inactive === true ? 'inactive' : 'active',
    };

    const existing = byEmail.get(email);
    if (existing?.status === 'active') continue;
    byEmail.set(email, employee);
  }

  return { employees: Array.from(byEmail.values()), skippedNoEmail, excluded };
}

/**
 * Employee sync run for the `halopsa` manifest. Throws on setup or API
 * failure so the sync run is recorded as failed and nobody is deactivated.
 */
export async function syncHaloEmployees({
  ctx,
  clientOptions,
}: {
  ctx: CheckContext;
  clientOptions?: HaloClientOptions;
}): Promise<SyncEmployee[]> {
  const mapping = resolveHaloConnectionMapping({
    credentials: ctx.credentials,
    variables: ctx.variables,
  });
  if (!mapping.success) throw new Error(mapping.error);

  const halo = createHaloClient(clientOptions);
  const clientId = mapping.data.haloClientId;
  ctx.log(`Fetching HaloPSA contacts for client ${clientId}`);
  const users = await halo.listClientUsers(clientId);

  const excludePatterns = parseSyncExcludePatterns(
    ctx.variables[SYNC_EXCLUDE_PATTERNS_VARIABLE_ID],
  );
  const result = mapHaloUsersToEmployees({ users, excludePatterns });

  ctx.log(`Mapped ${result.employees.length} HaloPSA contacts to employees`, {
    totalContacts: users.length,
    skippedNoEmail: result.skippedNoEmail,
    excludedCount: result.excluded.length,
    excludePatterns,
  });

  return result.employees;
}
