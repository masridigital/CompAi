const mockDb = {
  integrationConnection: { findMany: jest.fn(), findFirst: jest.fn() },
  organization: { findUnique: jest.fn(), findMany: jest.fn() },
};

jest.mock('@db', () => ({ db: mockDb, Prisma: {} }));
jest.mock('./halopsa-connection', () => ({
  asRecord: (v: unknown) => (v && typeof v === 'object' ? v : {}),
  resolveMappingForConnection: jest.fn(async (c: { metadata: { haloClientId?: number } }) =>
    c.metadata?.haloClientId ? { haloClientId: c.metadata.haloClientId } : null,
  ),
}));

import { ConflictException, NotFoundException } from '@nestjs/common';
import type { HaloClient } from '@trycompai/integration-platform';
import type { ProviderRepository } from '../repositories/provider.repository';
import type { ConnectionService } from '../services/connection.service';
import type { CredentialVaultService } from '../services/credential-vault.service';
import { HaloMappingService } from './halopsa-mapping.service';

const connectionService = {
  getConnectionByProviderSlug: jest.fn(),
  createConnection: jest.fn(),
  updateConnectionMetadata: jest.fn(),
  activateConnection: jest.fn(),
};
const vault = { storeApiKeyCredentials: jest.fn() };
const providers = { upsert: jest.fn() };
const haloClient = {
  listClients: jest.fn(),
  getClient: jest.fn(),
};

class TestMappingService extends HaloMappingService {
  protected haloClient(): HaloClient {
    return haloClient as unknown as HaloClient;
  }
}

const service = new TestMappingService(
  connectionService as unknown as ConnectionService,
  vault as unknown as CredentialVaultService,
  providers as unknown as ProviderRepository,
);

describe('HaloMappingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.integrationConnection.findMany.mockResolvedValue([
      {
        id: 'icn_a',
        organizationId: 'org_a',
        status: 'active',
        metadata: { haloClientId: 10, halopsaWebhookTokenHash: 'x' },
        variables: {},
        organization: { id: 'org_a', name: 'Alpha' },
      },
    ]);
    mockDb.organization.findMany.mockResolvedValue([
      { id: 'org_a', name: 'Alpha', website: null },
      { id: 'org_b', name: 'Beta LLC', website: 'https://beta.io' },
    ]);
    mockDb.organization.findUnique.mockResolvedValue({ id: 'org_b' });
  });

  it('lists clients with mapping status and suggestions for unmapped ones', async () => {
    haloClient.listClients.mockResolvedValue([
      { id: 10, name: 'Alpha' },
      { id: 11, name: 'Beta', website: 'www.beta.io' },
    ]);
    const result = await service.listClients();
    expect(result.clients[0].mapping).toEqual({
      organizationId: 'org_a',
      organizationName: 'Alpha',
      connectionId: 'icn_a',
    });
    expect(result.clients[1].mapping).toBeNull();
    expect(result.clients[1].suggestions).toEqual([
      { organizationId: 'org_b', organizationName: 'Beta LLC', reason: 'domain' },
    ]);
    expect(result.unmappedOrganizations.map((o) => o.id)).toEqual(['org_b']);
    expect(result.connections[0].hasWebhookToken).toBe(true);
  });

  it('refuses to bind a client that belongs to another org', async () => {
    await expect(service.bind({ haloClientId: 10, organizationId: 'org_b' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(connectionService.createConnection).not.toHaveBeenCalled();
  });

  it('404s for an unknown org', async () => {
    mockDb.organization.findUnique.mockResolvedValue(null);
    await expect(service.bind({ haloClientId: 11, organizationId: 'nope' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('creates a custom-auth connection through the vault', async () => {
    connectionService.getConnectionByProviderSlug.mockResolvedValue(null);
    connectionService.createConnection.mockResolvedValue({ id: 'icn_b' });

    await expect(service.bind({ haloClientId: 11, organizationId: 'org_b', haloSiteId: 3 })).resolves.toEqual({
      connectionId: 'icn_b',
      organizationId: 'org_b',
      haloClientId: 11,
      haloSiteId: 3,
    });
    expect(providers.upsert).toHaveBeenCalledWith(expect.objectContaining({ slug: 'halopsa' }));
    expect(connectionService.createConnection).toHaveBeenCalledWith({
      providerSlug: 'halopsa',
      organizationId: 'org_b',
      authStrategy: 'custom',
      metadata: { haloClientId: 11, haloSiteId: 3 },
    });
    expect(vault.storeApiKeyCredentials).toHaveBeenCalledWith('icn_b', { haloClientId: '11', haloSiteId: '3' });
    expect(connectionService.activateConnection).toHaveBeenCalledWith('icn_b');
  });

  it('updates an existing connection, dropping a stale site id', async () => {
    connectionService.getConnectionByProviderSlug.mockResolvedValue({
      id: 'icn_b',
      metadata: { haloClientId: 5, haloSiteId: 9, halopsaWebhookTokenHash: 'h' },
    });
    await service.bind({ haloClientId: 11, organizationId: 'org_b' });
    expect(connectionService.createConnection).not.toHaveBeenCalled();
    expect(connectionService.updateConnectionMetadata).toHaveBeenCalledWith('icn_b', {
      haloClientId: 11,
      halopsaWebhookTokenHash: 'h',
    });
    expect(vault.storeApiKeyCredentials).toHaveBeenCalledWith('icn_b', { haloClientId: '11' });
  });
});
