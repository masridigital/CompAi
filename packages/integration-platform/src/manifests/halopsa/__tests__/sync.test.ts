import { describe, expect, it } from 'bun:test';
import { makeCtx, useHaloMock } from '../checks/__tests__/check-harness';
import type { HaloUser } from '../client';
import { halopsaManifest } from '../index';
import {
  DEFAULT_SYNC_EXCLUDE_PATTERNS,
  isExcludedHaloContact,
  mapHaloUsersToEmployees,
  parseSyncExcludePatterns,
  syncHaloEmployees,
} from '../sync';

const defaults = [...DEFAULT_SYNC_EXCLUDE_PATTERNS];

const user = (fields: Partial<HaloUser> & { id: number }): HaloUser => ({ ...fields });

describe('parseSyncExcludePatterns', () => {
  it('falls back to the defaults when unset or blank', () => {
    expect(parseSyncExcludePatterns(undefined)).toEqual(defaults);
    expect(parseSyncExcludePatterns('  ')).toEqual(defaults);
  });

  it('parses a comma-separated override', () => {
    expect(parseSyncExcludePatterns('Scanner, alerts@')).toEqual(['scanner', 'alerts@']);
  });
});

describe('isExcludedHaloContact', () => {
  it.each([
    ['noreply@acme.test', 'Mailer'],
    ['no-reply@acme.test', 'Mailer'],
    ['support@acme.test', 'Support'],
    ['info@acme.test', 'Info'],
    ['admin@acme.test', 'Admin'],
    ['desk@acme.test', 'Acme Helpdesk'],
  ])('excludes %s (%s)', (email, name) => {
    expect(isExcludedHaloContact({ email, name, patterns: defaults })).toBe(true);
  });

  it('keeps real people', () => {
    expect(
      isExcludedHaloContact({ email: 'jane.doe@acme.test', name: 'Jane Doe', patterns: defaults }),
    ).toBe(false);
    // "info@" only matches the local part, not words like "information".
    expect(
      isExcludedHaloContact({
        email: 'information.officer@acme.test',
        name: 'Info Officer',
        patterns: defaults,
      }),
    ).toBe(false);
  });
});

describe('mapHaloUsersToEmployees', () => {
  it('maps email (lowercased), name and active = !inactive', () => {
    const { employees } = mapHaloUsersToEmployees({
      users: [
        user({ id: 1, name: ' Jane Doe ', emailaddress: 'Jane.Doe@Acme.test' }),
        user({ id: 2, name: 'Old Timer', emailaddress: 'old@acme.test', inactive: true }),
      ],
      excludePatterns: defaults,
    });

    expect(employees).toEqual([
      { email: 'jane.doe@acme.test', name: 'Jane Doe', externalId: '1', status: 'active' },
      { email: 'old@acme.test', name: 'Old Timer', externalId: '2', status: 'inactive' },
    ]);
  });

  it('skips users without an email and excluded mailboxes', () => {
    const result = mapHaloUsersToEmployees({
      users: [
        user({ id: 1, name: 'No Email' }),
        user({ id: 2, name: 'Blank', emailaddress: '  ' }),
        user({ id: 3, name: 'Helpdesk', emailaddress: 'help@acme.test' }),
        user({ id: 4, name: 'Mailer', emailaddress: 'noreply@acme.test' }),
        user({ id: 5, name: null, emailaddress: 'bob@acme.test' }),
      ],
      excludePatterns: defaults,
    });

    expect(result.skippedNoEmail).toBe(2);
    expect(result.excluded).toEqual(['help@acme.test', 'noreply@acme.test']);
    expect(result.employees).toEqual([
      { email: 'bob@acme.test', externalId: '5', status: 'active' },
    ]);
  });

  it('keeps the active record when an email appears twice', () => {
    const { employees } = mapHaloUsersToEmployees({
      users: [
        user({ id: 1, name: 'A', emailaddress: 'a@acme.test', inactive: true }),
        user({ id: 2, name: 'A', emailaddress: 'a@acme.test' }),
        user({ id: 3, name: 'A', emailaddress: 'A@acme.test', inactive: true }),
      ],
      excludePatterns: defaults,
    });

    expect(employees).toEqual([
      { email: 'a@acme.test', name: 'A', externalId: '2', status: 'active' },
    ]);
  });
});

describe('syncHaloEmployees', () => {
  const halo = useHaloMock();

  it('lists the mapped client users and applies sync_exclude_patterns', async () => {
    halo.setRoutes({
      '/api/Users': () => ({
        record_count: 3,
        users: [
          { id: 1, name: 'Jane', emailaddress: 'jane@acme.test' },
          { id: 2, name: 'Scanner', emailaddress: 'scanner@acme.test' },
          { id: 3, name: 'Support', emailaddress: 'support@acme.test' },
        ],
      }),
    });
    const { ctx } = makeCtx({ variables: { sync_exclude_patterns: 'scanner' } });

    const employees = await syncHaloEmployees({ ctx });

    // Override replaces the defaults, so support@ is kept here.
    expect(employees.map((e) => e.email)).toEqual(['jane@acme.test', 'support@acme.test']);
    const usersCall = halo.requests.find((u) => u.pathname === '/api/Users');
    expect(usersCall?.searchParams.get('client_id')).toBe('7');
  });

  it('throws when the connection is not mapped to a Halo client', async () => {
    const { ctx } = makeCtx({ credentials: {} });
    await expect(syncHaloEmployees({ ctx })).rejects.toThrow(/haloClientId/);
  });

  it('propagates Halo API errors so nobody is deactivated', async () => {
    halo.setRoutes({ '/api/Users': () => new Response('denied', { status: 403 }) });
    const { ctx } = makeCtx();
    await expect(syncHaloEmployees({ ctx })).rejects.toThrow(/403/);
  });
});

describe('halopsa manifest sync wiring', () => {
  it('declares opt-in code employee sync as a directory source', () => {
    expect(halopsaManifest.capabilities).toContain('sync');
    expect(halopsaManifest.isDirectorySource).toBe(true);
    expect(halopsaManifest.employeeSync?.listOnlyWhenConnected).toBe(true);
    expect(typeof halopsaManifest.employeeSync?.run).toBe('function');
    const variable = halopsaManifest.variables?.find((v) => v.id === 'sync_exclude_patterns');
    expect(variable?.default).toBe('noreply,no-reply,helpdesk,support@,info@,admin@');
  });
});
