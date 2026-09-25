jest.mock('../../auth/auth.server', () => ({ auth: { api: { getSession: jest.fn() } } }));
jest.mock('@trycompai/auth', () => ({
  statement: { integration: ['create', 'read', 'update', 'delete'] },
  BUILT_IN_ROLE_PERMISSIONS: {},
}));
jest.mock('@db', () => ({ db: {} }));

import { ForbiddenException } from '@nestjs/common';
import { ConnectionsController } from '../controllers/connections.controller';
import { VariablesController } from '../controllers/variables.controller';
import { resolveMappingForConnection } from './halopsa-connection';
import {
  assertCustomerMayCreateConnection,
  assertCustomerMayUpdateVariables,
  HALO_MANAGED_MESSAGE,
} from './halopsa-managed-connection';

const haloConnection = {
  id: 'icn_halo',
  organizationId: 'org_attacker',
  provider: { slug: 'halopsa', name: 'HaloPSA' },
  metadata: { halopsaBinding: { haloClientId: 7 } },
  variables: { alert_enabled_triggers: ['weekly_digest'] },
  status: 'active',
};

const connectionService = {
  getConnectionForOrg: jest.fn().mockResolvedValue(haloConnection),
  createConnection: jest.fn(),
  updateConnectionMetadata: jest.fn(),
  activateConnection: jest.fn(),
};
const vault = { storeApiKeyCredentials: jest.fn(), getDecryptedCredentials: jest.fn() };
const autoChecks = { tryAutoRunChecks: jest.fn().mockResolvedValue(false) };
const providers = { upsert: jest.fn() };
const connectionRepository = {
  findById: jest.fn().mockResolvedValue(haloConnection),
  update: jest.fn(),
};

const connections = new ConnectionsController(
  connectionService as never,
  vault as never,
  {} as never,
  autoChecks as never,
  providers as never,
  connectionRepository as never,
);
const variables = new VariablesController(
  connectionRepository as never,
  providers as never,
  vault as never,
  autoChecks as never,
  connectionService as never,
);

async function expectForbidden(promise: Promise<unknown>) {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ForbiddenException);
  expect((error as ForbiddenException).message).toContain('managed by your MSP');
}

describe('HaloPSA connections are admin-managed (org admins cannot bind)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refuses creating a halopsa connection with an arbitrary Halo client id', async () => {
    await expectForbidden(
      connections.createConnection('org_attacker', {
        providerSlug: 'halopsa',
        credentials: { haloClientId: '42' },
      }),
    );
    expect(connectionService.createConnection).not.toHaveBeenCalled();
    expect(vault.storeApiKeyCredentials).not.toHaveBeenCalled();
  });

  it('refuses changing halopsa credentials', async () => {
    await expectForbidden(
      connections.updateCredentials('icn_halo', 'org_attacker', { credentials: { haloClientId: '42' } }),
    );
    expect(vault.storeApiKeyCredentials).not.toHaveBeenCalled();
  });

  it('refuses writing halopsa metadata (binding or webhook token hash)', async () => {
    await expectForbidden(
      connections.updateConnection('icn_halo', 'org_attacker', {
        metadata: { halopsaBinding: { haloClientId: 42 } },
      }),
    );
    await expectForbidden(
      connections.updateConnection('icn_halo', 'org_attacker', {
        metadata: { halopsaWebhookTokenHash: 'x' },
      }),
    );
    expect(connectionService.updateConnectionMetadata).not.toHaveBeenCalled();
  });

  it.each([['haloClientId'], ['haloSiteId'], ['halopsaBinding']])(
    'refuses setting the %s variable',
    async (key) => {
      await expectForbidden(
        variables.saveConnectionVariables('icn_halo', { variables: { [key]: 42 } }, 'org_attacker'),
      );
      expect(connectionRepository.update).not.toHaveBeenCalled();
    },
  );

  it('still lets org admins tune their alert_* settings', async () => {
    const result = await variables.saveConnectionVariables(
      'icn_halo',
      { variables: { alert_enabled_triggers: ['finding_created'], alert_team_id: 3 } },
      'org_attacker',
    );
    expect(result.success).toBe(true);
    expect(connectionRepository.update).toHaveBeenCalledWith('icn_halo', {
      variables: { alert_enabled_triggers: ['finding_created'], alert_team_id: 3 },
    });
  });
});

describe('guard helpers', () => {
  it('ignores other providers', () => {
    expect(() => assertCustomerMayCreateConnection('github')).not.toThrow();
    expect(() =>
      assertCustomerMayUpdateVariables({ providerSlug: 'aws', variables: { haloClientId: 1 } }),
    ).not.toThrow();
  });

  it('refuses undeclared halopsa variables', () => {
    expect(() =>
      assertCustomerMayUpdateVariables({ providerSlug: 'halopsa', variables: { something_else: 1 } }),
    ).toThrow(HALO_MANAGED_MESSAGE);
  });
});

describe('Halo consumers read the admin binding only', () => {
  it('ignores legacy top-level metadata ids (possibly customer-written)', () => {
    expect(resolveMappingForConnection({ metadata: { haloClientId: 5, haloSiteId: 6 } })).toBeNull();
  });

  it('reads the admin-written binding', () => {
    expect(
      resolveMappingForConnection({ metadata: { halopsaBinding: { haloClientId: 5, haloSiteId: 6 } } }),
    ).toEqual({ haloClientId: 5, haloSiteId: 6 });
  });
});
