import { beforeEach, describe, expect, it } from 'bun:test';
import { createHaloClient, HALO_PAGE_SIZE, resetHaloTokenCache } from '../index';
import { HaloUserSchema } from '../schemas';
import { createMockFetch, jsonResponse, noSleep, TEST_CONFIG } from './test-utils';

beforeEach(() => resetHaloTokenCache());

const makeUsers = ({ start, count }: { start: number; count: number }) =>
  Array.from({ length: count }, (_, i) => ({
    id: start + i,
    name: `User ${start + i}`,
    emailaddress: `user${start + i}@acme.test`,
  }));

describe('HaloUserSchema', () => {
  it('coerces ids, keeps unknown fields and tolerates missing name/email', () => {
    const parsed = HaloUserSchema.parse({ id: '9', site_id: '3', phonenumber: '555' });
    expect(parsed.id).toBe(9);
    expect(parsed.site_id).toBe(3);
    expect(parsed.phonenumber).toBe('555');
    expect(parsed.name).toBeUndefined();
    expect(parsed.emailaddress).toBeUndefined();
  });

  it('rejects users without an id', () => {
    expect(HaloUserSchema.safeParse({ name: 'x' }).success).toBe(false);
  });
});

describe('listClientUsers', () => {
  it('GETs /Users for the client with pageinate and follows pages', async () => {
    const total = HALO_PAGE_SIZE + 5;
    const mock = createMockFetch((url) => {
      const page = Number(url.searchParams.get('page_no'));
      const users =
        page === 1
          ? makeUsers({ start: 1, count: HALO_PAGE_SIZE })
          : makeUsers({ start: HALO_PAGE_SIZE + 1, count: 5 });
      return jsonResponse({ record_count: total, users });
    });
    const halo = createHaloClient({ config: TEST_CONFIG, fetchImpl: mock.fetch, sleep: noSleep });

    const users = await halo.listClientUsers(42);

    expect(users).toHaveLength(total);
    expect(users[0]).toMatchObject({ id: 1, emailaddress: 'user1@acme.test' });
    const calls = mock.apiCalls().map((c) => new URL(c.url));
    expect(calls).toHaveLength(2);
    expect(calls[0].pathname).toBe('/api/Users');
    expect(calls[0].searchParams.get('client_id')).toBe('42');
    expect(calls[0].searchParams.get('pageinate')).toBe('true');
    expect(calls[0].searchParams.get('includeinactive')).toBe('true');
    expect(calls[0].searchParams.get('page_no')).toBe('1');
    expect(calls[1].searchParams.get('page_no')).toBe('2');
  });

  it('accepts a bare array response', async () => {
    const mock = createMockFetch(() =>
      jsonResponse([{ id: 1, name: 'A', emailaddress: 'a@acme.test', inactive: true }]),
    );
    const halo = createHaloClient({ config: TEST_CONFIG, fetchImpl: mock.fetch, sleep: noSleep });

    const users = await halo.listClientUsers(1);

    expect(users).toEqual([{ id: 1, name: 'A', emailaddress: 'a@acme.test', inactive: true }]);
  });
});
