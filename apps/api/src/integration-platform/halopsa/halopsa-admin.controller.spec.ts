const mockDb = { auditLog: { create: jest.fn() } };

jest.mock('@db', () => ({ db: mockDb }));
jest.mock('../../auth/platform-admin.guard', () => ({ PlatformAdminGuard: class {} }));
jest.mock('../../organization/provisioning/organization-provisioning.service', () => ({
  OrganizationProvisioningService: class {},
}));

import { HaloAdminController } from './halopsa-admin.controller';
import { HaloWebhookController } from './halopsa-webhook.controller';

const mappingService = {
  bind: jest.fn(),
  getHaloClient: jest.fn(),
  getConnection: jest.fn(),
};
const outboxService = { retry: jest.fn(), list: jest.fn() };
const webhookService = { issueToken: jest.fn() };
const provisioningService = { provision: jest.fn() };

const controller = new HaloAdminController(
  mappingService as never,
  outboxService as never,
  webhookService as never,
  provisioningService as never,
);
const req = { userId: 'usr_admin' };

const auditRows = () => mockDb.auditLog.create.mock.calls.map((call) => call[0].data);

describe('HaloAdminController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mappingService.bind.mockImplementation(async ({ organizationId, haloClientId, haloSiteId }) => ({
      connectionId: 'icn_1',
      organizationId,
      haloClientId,
      haloSiteId: haloSiteId ?? null,
    }));
  });

  it('is tagged for the admin API docs and no longer uses the generic platform interceptor', () => {
    expect(Reflect.getMetadata('swagger/apiUseTags', HaloAdminController)).toEqual(['Admin - HaloPSA']);
    expect(Reflect.getMetadata('__interceptors__', HaloAdminController)).toBeUndefined();
  });

  it('binds with the acting admin and audits under the affected org', async () => {
    await controller.bind(42, { organizationId: 'org_client', haloSiteId: 5 }, req);
    expect(mappingService.bind).toHaveBeenCalledWith({
      haloClientId: 42,
      organizationId: 'org_client',
      haloSiteId: 5,
      actorUserId: 'usr_admin',
    });
    expect(auditRows()).toEqual([
      expect.objectContaining({
        userId: 'usr_admin',
        organizationId: 'org_client',
        entityType: 'integration',
        entityId: 'icn_1',
        description: '[Platform Admin] Bound HaloPSA client',
        data: expect.objectContaining({ action: 'bind_client', haloClientId: 42, haloSiteId: 5 }),
      }),
    ]);
  });

  it('creates the org without making the admin owner and forwards ownerEmail', async () => {
    mappingService.getHaloClient.mockResolvedValue({ id: 42, name: 'Acme', website: 'acme.com' });
    provisioningService.provision.mockResolvedValue({ organizationId: 'org_new', ownerInvitationId: 'inv_1' });

    const result = await controller.createOrg(42, { ownerEmail: 'owner@acme.com' }, req);

    expect(provisioningService.provision).toHaveBeenCalledWith({
      name: 'Acme',
      website: 'acme.com',
      actingAdminUserId: 'usr_admin',
      ownerEmail: 'owner@acme.com',
      frameworkIds: undefined,
    });
    expect(result).toMatchObject({ organizationId: 'org_new', ownerInvitationId: 'inv_1' });
    expect(auditRows().map((row) => [row.organizationId, row.data.action])).toEqual([
      ['org_new', 'create_org_from_client'],
      ['org_new', 'bind_client'],
    ]);
  });

  it('audits webhook token issue under the connection org', async () => {
    mappingService.getConnection.mockResolvedValue({ connectionId: 'icn_1', organizationId: 'org_client' });
    webhookService.issueToken.mockResolvedValue({ token: 't', url: 'u' });
    await expect(controller.issueWebhookToken('icn_1', req)).resolves.toEqual({ token: 't', url: 'u' });
    expect(auditRows()[0]).toMatchObject({
      organizationId: 'org_client',
      data: { action: 'issue_webhook_token' },
    });
    // The plain token never lands in the audit row.
    expect(JSON.stringify(auditRows()[0])).not.toContain('"t"');
  });

  it('audits outbox retry under the event org', async () => {
    outboxService.retry.mockResolvedValue({ id: 'hob_1', status: 'pending', organizationId: 'org_client' });
    await expect(controller.retryOutbox('hob_1', req)).resolves.toEqual({ id: 'hob_1', status: 'pending' });
    expect(auditRows()[0]).toMatchObject({ organizationId: 'org_client', entityId: 'hob_1' });
  });

  it('keeps the action when the audit write fails', async () => {
    mockDb.auditLog.create.mockRejectedValueOnce(new Error('db down'));
    await expect(controller.bind(42, { organizationId: 'org_client' }, req)).resolves.toMatchObject({
      connectionId: 'icn_1',
    });
  });
});

describe('HaloWebhookController', () => {
  it('has no customer route to rotate the MSP webhook token', () => {
    expect(Object.getOwnPropertyNames(HaloWebhookController.prototype)).not.toContain('issueWebhookToken');
  });
});
