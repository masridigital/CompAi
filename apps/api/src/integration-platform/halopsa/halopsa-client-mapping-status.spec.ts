jest.mock('@db', () => ({ db: {} }));

import { clientMappingStatus } from './halopsa-client-mapping-status';

const bound = (haloClientId: number) => ({ halopsaBinding: { haloClientId } });

describe('clientMappingStatus', () => {
  it('counts only active connections as mapped', () => {
    const status = clientMappingStatus({
      clients: [{ id: 1 }, { id: 2 }, { id: 3 }],
      connections: [
        { status: 'active', metadata: bound(1) },
        { status: 'paused', metadata: bound(2) },
        { status: 'error', metadata: bound(3) },
      ],
    });
    expect(status).toEqual({ activeClients: 3, mappedClients: 1, unmappedClients: 2 });
  });

  it('ignores unbound or legacy connections', () => {
    const status = clientMappingStatus({
      clients: [{ id: 1 }],
      connections: [{ status: 'active', metadata: { haloClientId: 1 } }],
    });
    expect(status).toEqual({ activeClients: 1, mappedClients: 0, unmappedClients: 1 });
  });
});
