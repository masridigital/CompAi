import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRedirect = vi.fn();
const mockServerApiGet = vi.fn();

vi.mock('@/lib/api-server', () => ({
  serverApi: { get: (...args: unknown[]) => mockServerApiGet(...args) },
}));

vi.mock('next/navigation', () => ({
  redirect: (...args: unknown[]) => {
    mockRedirect(...args);
    throw new Error('NEXT_REDIRECT');
  },
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('./components/MspMasterPane', () => ({
  MspMasterPane: () => null,
}));

const { default: MspPage } = await import('./page');

const overview = {
  totals: {
    clients: 1,
    avgScore: 90,
    failingChecks: 0,
    overdueTasks: 0,
    openFindings: 0,
    evidenceExpiring30d: 0,
    openHaloTickets: 0,
  },
  clients: [],
};

function meWithRole(role: string | null) {
  return { data: { user: { role } }, status: 200 };
}

describe('/msp page access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(['user', null, 'admin,user'])(
    'redirects non-staff (role %s) to / without fetching the overview',
    async (role) => {
      mockServerApiGet.mockResolvedValueOnce(meWithRole(role));
      await expect(MspPage()).rejects.toThrow('NEXT_REDIRECT');
      expect(mockRedirect).toHaveBeenCalledWith('/');
      expect(mockServerApiGet).toHaveBeenCalledTimes(1);
      expect(mockServerApiGet).toHaveBeenCalledWith('/v1/auth/me');
    },
  );

  it.each(['admin', 'msp_staff'])('renders the pane for %s with SSR data', async (role) => {
    mockServerApiGet
      .mockResolvedValueOnce(meWithRole(role))
      .mockResolvedValueOnce({ data: overview, status: 200 });

    const element = await MspPage();

    expect(mockServerApiGet).toHaveBeenLastCalledWith('/v1/msp/overview');
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(element.props.initialOverview).toEqual(overview);
  });

  it('redirects when the API refuses the overview (403)', async () => {
    mockServerApiGet
      .mockResolvedValueOnce(meWithRole('msp_staff'))
      .mockResolvedValueOnce({ data: undefined, error: 'Forbidden', status: 403 });

    await expect(MspPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(mockRedirect).toHaveBeenCalledWith('/');
  });
});
