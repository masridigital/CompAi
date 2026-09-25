import { db } from '@db';
import { syncEmployeesSchedule } from './sync-employees-schedule';

jest.mock('@db', () => ({
  db: {
    organization: { findMany: jest.fn() },
    integrationConnection: { findFirst: jest.fn() },
  },
}));

jest.mock('@trigger.dev/sdk', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  schedules: { task: (config: unknown) => config },
}));

type ScheduleRun = (payload: {
  timestamp: Date;
  lastTimestamp?: Date;
}) => Promise<{ syncsTriggered: number }>;

const run = (syncEmployeesSchedule as unknown as { run: ScheduleRun }).run;
const mockOrgFindMany = db.organization.findMany as jest.Mock;
const mockConnFindFirst = db.integrationConnection.findFirst as jest.Mock;

const okResponse = () =>
  new Response(
    JSON.stringify({
      success: true,
      imported: 1,
      reactivated: 0,
      deactivated: 0,
      skipped: 0,
    }),
    { status: 200 },
  );

describe('syncEmployeesSchedule provider selection', () => {
  const originalFetch = global.fetch;
  const mockFetch = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockImplementation(async () => okResponse());
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('only considers orgs that explicitly selected an employee sync provider', async () => {
    mockOrgFindMany.mockResolvedValue([]);

    const result = await run({ timestamp: new Date() });

    expect(mockOrgFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { employeeSyncProvider: { not: null } },
      }),
    );
    // A connected HaloPSA integration alone never triggers a sync.
    expect(mockConnFindFirst).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.syncsTriggered).toBe(0);
  });

  it('syncs the selected provider only, never halopsa when another provider is picked', async () => {
    mockOrgFindMany.mockResolvedValue([
      { id: 'org_1', name: 'Acme', employeeSyncProvider: 'google-workspace' },
    ]);
    mockConnFindFirst.mockResolvedValue({
      id: 'icn_gws',
      organizationId: 'org_1',
      provider: { slug: 'google-workspace' },
      organization: { id: 'org_1', name: 'Acme' },
    });

    await run({ timestamp: new Date() });

    expect(mockConnFindFirst).toHaveBeenCalledTimes(1);
    expect(mockConnFindFirst.mock.calls[0][0]).toMatchObject({
      where: {
        organizationId: 'org_1',
        provider: { slug: 'google-workspace' },
      },
    });
    const urls = mockFetch.mock.calls.map((call) => String(call[0]));
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain(
      '/v1/integrations/sync/google-workspace/employees',
    );
    expect(urls.some((u) => u.includes('halopsa'))).toBe(false);
  });

  it('routes an org that selected halopsa to the generic dynamic sync endpoint', async () => {
    mockOrgFindMany.mockResolvedValue([
      { id: 'org_2', name: 'Client Co', employeeSyncProvider: 'halopsa' },
    ]);
    mockConnFindFirst.mockResolvedValue({
      id: 'icn_halo',
      organizationId: 'org_2',
      provider: { slug: 'halopsa' },
      organization: { id: 'org_2', name: 'Client Co' },
    });

    const result = await run({ timestamp: new Date() });

    expect(mockConnFindFirst.mock.calls[0][0]).toMatchObject({
      where: {
        organizationId: 'org_2',
        status: 'active',
        provider: { slug: 'halopsa' },
      },
    });
    const url = new URL(String(mockFetch.mock.calls[0][0]));
    expect(url.pathname).toBe(
      '/v1/integrations/sync/dynamic/halopsa/employees',
    );
    expect(url.searchParams.get('connectionId')).toBe('icn_halo');
    expect(result.syncsTriggered).toBe(1);
  });

  it('skips an org that selected halopsa but has no active connection', async () => {
    mockOrgFindMany.mockResolvedValue([
      { id: 'org_3', name: 'Gone Co', employeeSyncProvider: 'halopsa' },
    ]);
    mockConnFindFirst.mockResolvedValue(null);

    const result = await run({ timestamp: new Date() });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.syncsTriggered).toBe(0);
  });
});
