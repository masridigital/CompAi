const mockDb = { integrationConnection: { findMany: jest.fn() } };
jest.mock('@db', () => ({ db: mockDb }));

import {
  haloClientRefFromMetadata,
  haloClientUrl,
  loadHaloClientsForOrganizations,
} from './halopsa-admin-client-lookup';

describe('halopsa admin client lookup', () => {
  const originalBase = process.env.HALOPSA_BASE_URL;
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.HALOPSA_BASE_URL = 'https://portal.masri.tech/';
  });
  afterAll(() => {
    process.env.HALOPSA_BASE_URL = originalBase;
  });

  it('builds the Halo customer URL only when the base URL is set', () => {
    expect(haloClientUrl(42)).toBe('https://portal.masri.tech/customers?clientid=42');
    expect(haloClientUrl(42, {})).toBeNull();
  });

  it('reads the admin-written binding from metadata', () => {
    expect(
      haloClientRefFromMetadata({ halopsaBinding: { haloClientId: 42, haloClientName: 'Acme' } }),
    ).toEqual({
      id: 42,
      name: 'Acme',
      url: 'https://portal.masri.tech/customers?clientid=42',
    });
    expect(haloClientRefFromMetadata({ halopsaBinding: { haloClientId: 'x' } })).toBeNull();
    // Legacy top-level keys are not trusted (only the admin binding is).
    expect(haloClientRefFromMetadata({ haloClientId: 42 })).toBeNull();
    expect(haloClientRefFromMetadata(null)).toBeNull();
  });

  it('loads all orgs in one query and keeps the first connection per org', async () => {
    mockDb.integrationConnection.findMany.mockResolvedValue([
      { organizationId: 'org_a', metadata: { halopsaBinding: { haloClientId: 1 } } },
      { organizationId: 'org_a', metadata: { halopsaBinding: { haloClientId: 2 } } },
      { organizationId: 'org_b', metadata: {} },
    ]);
    const result = await loadHaloClientsForOrganizations(['org_a', 'org_b']);
    expect(mockDb.integrationConnection.findMany).toHaveBeenCalledTimes(1);
    expect(result.get('org_a')?.id).toBe(1);
    expect(result.has('org_b')).toBe(false);
    await expect(loadHaloClientsForOrganizations([])).resolves.toEqual(new Map());
  });
});
