import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { db, Prisma } from '@db';
import { createHaloClient, halopsaManifest, type HaloClient } from '@trycompai/integration-platform';
import { ProviderRepository } from '../repositories/provider.repository';
import { ConnectionService } from '../services/connection.service';
import { CredentialVaultService } from '../services/credential-vault.service';
import { asRecord, resolveMappingForConnection } from './halopsa-connection';
import { suggestOrgsForClient } from './halopsa-mapping-suggestions';
import { HALO_WEBHOOK_TOKEN_HASH_KEY, HALOPSA_PROVIDER_SLUG } from './halopsa.constants';

export interface HaloConnectionSummary {
  connectionId: string;
  organizationId: string;
  organizationName: string;
  status: string;
  haloClientId: number | null;
  haloSiteId: number | null;
  hasWebhookToken: boolean;
}

@Injectable()
export class HaloMappingService {
  private readonly logger = new Logger(HaloMappingService.name);

  constructor(
    private readonly connectionService: ConnectionService,
    private readonly credentialVaultService: CredentialVaultService,
    private readonly providerRepository: ProviderRepository,
  ) {}

  protected haloClient(): HaloClient {
    return createHaloClient();
  }

  async getHaloClient(haloClientId: number) {
    return this.haloClient().getClient(haloClientId);
  }

  private async lookupClientName(haloClientId: number): Promise<string | undefined> {
    try {
      return (await this.getHaloClient(haloClientId)).name;
    } catch (error) {
      this.logger.warn(`Could not fetch Halo client ${haloClientId} name: ${String(error)}`);
      return undefined;
    }
  }

  async getConnection(connectionId: string): Promise<{ connectionId: string; organizationId: string }> {
    const connection = await db.integrationConnection.findFirst({
      where: { id: connectionId, provider: { slug: HALOPSA_PROVIDER_SLUG } },
      select: { id: true, organizationId: true },
    });
    if (!connection) throw new NotFoundException(`HaloPSA connection ${connectionId} not found`);
    return { connectionId: connection.id, organizationId: connection.organizationId };
  }

  async listConnections(): Promise<HaloConnectionSummary[]> {
    const connections = await db.integrationConnection.findMany({
      where: { provider: { slug: HALOPSA_PROVIDER_SLUG } },
      include: { organization: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return Promise.all(
      connections.map(async (connection) => {
        const mapping = await resolveMappingForConnection(connection).catch((error: unknown) => {
          this.logger.warn(`Could not resolve Halo mapping for ${connection.id}: ${String(error)}`);
          return null;
        });
        return {
          connectionId: connection.id,
          organizationId: connection.organizationId,
          organizationName: connection.organization.name,
          status: connection.status,
          haloClientId: mapping?.haloClientId ?? null,
          haloSiteId: mapping?.haloSiteId ?? null,
          hasWebhookToken: typeof asRecord(connection.metadata)[HALO_WEBHOOK_TOKEN_HASH_KEY] === 'string',
        };
      }),
    );
  }

  /** Active Halo clients with their mapping status and auto-match suggestions. */
  async listClients() {
    const [clients, connections, orgs] = await Promise.all([
      this.haloClient().listClients(),
      this.listConnections(),
      db.organization.findMany({ select: { id: true, name: true, website: true }, orderBy: { name: 'asc' } }),
    ]);

    const byClientId = new Map<number, HaloConnectionSummary>();
    for (const connection of connections) {
      if (connection.haloClientId !== null) byClientId.set(connection.haloClientId, connection);
    }
    const mappedOrgIds = new Set(connections.map((c) => c.organizationId));
    const unmappedOrgs = orgs.filter((org) => !mappedOrgIds.has(org.id));

    return {
      clients: clients.map((client) => {
        const mapped = byClientId.get(client.id) ?? null;
        return {
          id: client.id,
          name: client.name,
          website: client.website ?? null,
          mapping: mapped
            ? {
                organizationId: mapped.organizationId,
                organizationName: mapped.organizationName,
                connectionId: mapped.connectionId,
              }
            : null,
          suggestions: mapped ? [] : suggestOrgsForClient({ client, orgs: unmappedOrgs }),
        };
      }),
      unmappedOrganizations: unmappedOrgs,
      connections,
    };
  }

  /**
   * Bind a Halo client to an org: create or update the org's `halopsa`
   * connection. The mapping goes through the credential vault (like the
   * normal connect flow) and is mirrored in metadata for quick lookup.
   */
  async bind({
    haloClientId,
    organizationId,
    haloSiteId,
    haloClientName,
  }: {
    haloClientId: number;
    organizationId: string;
    haloSiteId?: number;
    /** Cached in metadata for admin lists; fetched from Halo when omitted. */
    haloClientName?: string;
  }) {
    const org = await db.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
    if (!org) throw new NotFoundException(`Organization ${organizationId} not found`);

    const conflict = (await this.listConnections()).find(
      (c) => c.haloClientId === haloClientId && c.organizationId !== organizationId,
    );
    if (conflict) {
      throw new ConflictException(
        `Halo client ${haloClientId} is already bound to ${conflict.organizationName}`,
      );
    }

    await this.providerRepository.upsert({
      slug: halopsaManifest.id,
      name: halopsaManifest.name,
      category: halopsaManifest.category,
      capabilities: halopsaManifest.capabilities,
      isActive: halopsaManifest.isActive,
    });

    const clientName = haloClientName ?? (await this.lookupClientName(haloClientId));
    const mappingMeta = {
      haloClientId,
      ...(haloSiteId ? { haloSiteId } : {}),
      ...(clientName ? { haloClientName: clientName } : {}),
    };
    const existing = await this.connectionService.getConnectionByProviderSlug(
      HALOPSA_PROVIDER_SLUG,
      organizationId,
    );
    const connection =
      existing ??
      (await this.connectionService.createConnection({
        providerSlug: HALOPSA_PROVIDER_SLUG,
        organizationId,
        authStrategy: 'custom',
        metadata: mappingMeta,
      }));

    if (existing) {
      const { haloSiteId: _oldSite, haloClientName: _oldName, ...rest } = asRecord(existing.metadata);
      const metadata: Prisma.InputJsonObject = { ...(rest as Prisma.InputJsonObject), ...mappingMeta };
      await this.connectionService.updateConnectionMetadata(existing.id, metadata);
    }

    await this.credentialVaultService.storeApiKeyCredentials(connection.id, {
      haloClientId: String(haloClientId),
      ...(haloSiteId ? { haloSiteId: String(haloSiteId) } : {}),
    });
    await this.connectionService.activateConnection(connection.id);

    this.logger.log(`Bound Halo client ${haloClientId} to org ${organizationId} (${connection.id})`);
    return { connectionId: connection.id, organizationId, haloClientId, haloSiteId: haloSiteId ?? null };
  }
}
