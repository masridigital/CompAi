import { normalizeDomain, normalizeName, suggestOrgsForClient } from './halopsa-mapping-suggestions';

describe('normalizeName', () => {
  it('drops punctuation, case and company suffixes', () => {
    expect(normalizeName('Acme, Inc.')).toBe('acme');
    expect(normalizeName('ACME LLC')).toBe('acme');
    expect(normalizeName('Café & Co Ltd')).toBe('cafe and');
    expect(normalizeName('Inc')).toBe('inc');
  });
});

describe('normalizeDomain', () => {
  it('extracts the bare host', () => {
    expect(normalizeDomain('https://www.Acme.com/about')).toBe('acme.com');
    expect(normalizeDomain('acme.com')).toBe('acme.com');
    expect(normalizeDomain('')).toBeNull();
    expect(normalizeDomain('not a url')).toBeNull();
  });
});

describe('suggestOrgsForClient', () => {
  const orgs = [
    { id: 'org_1', name: 'Acme Incorporated', website: 'https://acme.com' },
    { id: 'org_2', name: 'Acme', website: null },
    { id: 'org_3', name: 'Globex', website: 'globex.io' },
  ];

  it('puts domain matches first, then name matches, without duplicates', () => {
    const suggestions = suggestOrgsForClient({
      client: { id: 1, name: 'ACME, Inc.', website: 'www.acme.com' },
      orgs,
    });
    expect(suggestions).toEqual([
      { organizationId: 'org_1', organizationName: 'Acme Incorporated', reason: 'domain' },
      { organizationId: 'org_2', organizationName: 'Acme', reason: 'name' },
    ]);
  });

  it('returns nothing when nothing matches', () => {
    expect(suggestOrgsForClient({ client: { id: 2, name: 'Initech' }, orgs })).toEqual([]);
  });
});
