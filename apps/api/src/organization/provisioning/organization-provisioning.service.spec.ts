const mockDb = {
  $transaction: jest.fn(),
  frameworkEditorFramework: { findMany: jest.fn() },
  organization: { create: jest.fn() },
  onboarding: { create: jest.fn() },
};

jest.mock('@db', () => ({ db: mockDb }));
jest.mock('../../frameworks/frameworks.service', () => ({ FrameworksService: class {} }));

import { BadRequestException } from '@nestjs/common';
import type { FrameworksService } from '../../frameworks/frameworks.service';
import { OrganizationProvisioningService } from './organization-provisioning.service';

describe('OrganizationProvisioningService', () => {
  const frameworks = { addFrameworks: jest.fn() };
  const service = new OrganizationProvisioningService(frameworks as unknown as FrameworksService);

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.$transaction.mockImplementation((fn: (tx: typeof mockDb) => unknown) => fn(mockDb));
    mockDb.organization.create.mockResolvedValue({ id: 'org_new' });
    mockDb.frameworkEditorFramework.findMany.mockResolvedValue([{ name: 'SOC 2' }]);
  });

  it('creates the org with the admin as owner, onboarding record and frameworks', async () => {
    await expect(
      service.provision({ name: ' Acme ', website: 'acme.com', ownerUserId: 'usr_1', frameworkIds: ['frk_soc2'] }),
    ).resolves.toEqual({ organizationId: 'org_new' });

    const data = mockDb.organization.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      name: 'Acme',
      website: 'https://acme.com/',
      hasAccess: true,
      onboardingCompleted: false,
      members: { create: { userId: 'usr_1', role: 'owner' } },
    });
    expect(data.context.createMany.data[0].answer).toBe('SOC 2');
    expect(mockDb.onboarding.create).toHaveBeenCalledWith({
      data: { organizationId: 'org_new', triggerJobCompleted: false },
    });
    expect(frameworks.addFrameworks).toHaveBeenCalledWith('org_new', ['frk_soc2']);
  });

  it('keeps the org when framework setup fails', async () => {
    frameworks.addFrameworks.mockRejectedValue(new Error('no visible frameworks'));
    await expect(
      service.provision({ name: 'Acme', ownerUserId: 'usr_1', frameworkIds: ['bad'] }),
    ).resolves.toEqual({ organizationId: 'org_new' });
  });

  it('skips frameworks when none are given', async () => {
    await service.provision({ name: 'Acme', ownerUserId: 'usr_1' });
    expect(frameworks.addFrameworks).not.toHaveBeenCalled();
    expect(mockDb.organization.create.mock.calls[0][0].data.context).toBeUndefined();
  });

  it('rejects a too-short name', async () => {
    await expect(service.provision({ name: 'A', ownerUserId: 'usr_1' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
