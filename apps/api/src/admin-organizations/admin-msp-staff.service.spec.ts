import { BadRequestException, NotFoundException } from '@nestjs/common';

const mockDb = {
  organization: { findUnique: jest.fn() },
  organizationRole: { findUnique: jest.fn() },
  user: { findMany: jest.fn() },
  member: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    upsert: jest.fn(),
  },
  $transaction: jest.fn(),
};
jest.mock('@db', () => ({ db: mockDb }));

const mockEnsureMspTechRole = jest.fn();
jest.mock('../roles/msp-tech-role', () => ({
  MSP_TECH_ROLE: 'msp_tech',
  ensureMspTechRole: (...args: unknown[]) => mockEnsureMspTechRole(...args),
}));

import { AdminMspStaffService } from './admin-msp-staff.service';

describe('AdminMspStaffService', () => {
  const service = new AdminMspStaffService();

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.organization.findUnique.mockResolvedValue({ id: 'org_1' });
    mockDb.member.upsert.mockImplementation((args: unknown) => args);
    mockDb.$transaction.mockImplementation((ops: unknown[]) => Promise.resolve(ops));
    mockDb.member.findMany.mockResolvedValue([]);
  });

  describe('addStaff', () => {
    it('ensures msp_tech and upserts members for msp_staff/admin users', async () => {
      mockDb.user.findMany.mockResolvedValue([
        { id: 'u1', role: 'msp_staff' },
        { id: 'u2', role: 'admin' },
      ]);
      mockDb.member.findMany.mockResolvedValue([
        { userId: 'u2', role: 'employee', deactivated: true, isActive: false },
      ]);

      const result = await service.addStaff({
        orgId: 'org_1',
        userIds: ['u1', 'u2'],
        orgRole: 'msp_tech',
      });

      expect(mockEnsureMspTechRole).toHaveBeenCalledWith('org_1');
      expect(mockDb.member.upsert).toHaveBeenCalledTimes(2);
      const reactivate = mockDb.member.upsert.mock.calls[1][0];
      expect(reactivate.where).toEqual({
        userId_organizationId: { userId: 'u2', organizationId: 'org_1' },
      });
      expect(reactivate.update).toMatchObject({
        role: 'msp_tech',
        deactivated: false,
        isActive: true,
      });
      expect(result.data.map((p) => p.action)).toEqual(['create', 'reactivate']);
    });

    it('rejects users whose global role is not msp_staff or admin', async () => {
      mockDb.user.findMany.mockResolvedValue([
        { id: 'u1', role: 'msp_staff' },
        { id: 'u3', role: 'user' },
      ]);
      await expect(
        service.addStaff({ orgId: 'org_1', userIds: ['u1', 'u3'], orgRole: 'msp_tech' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockDb.$transaction).not.toHaveBeenCalled();
    });

    it('rejects unknown user IDs', async () => {
      mockDb.user.findMany.mockResolvedValue([{ id: 'u1', role: 'msp_staff' }]);
      await expect(
        service.addStaff({ orgId: 'org_1', userIds: ['u1', 'ghost'], orgRole: 'msp_tech' }),
      ).rejects.toThrow('Users not found: ghost');
    });

    it('never grants owner', async () => {
      await expect(
        service.addStaff({ orgId: 'org_1', userIds: ['u1'], orgRole: 'owner' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a custom role that does not exist in the org', async () => {
      mockDb.organizationRole.findUnique.mockResolvedValue(null);
      await expect(
        service.addStaff({ orgId: 'org_1', userIds: ['u1'], orgRole: 'ghost_role' }),
      ).rejects.toThrow("Role 'ghost_role' does not exist");
    });

    it('404s for a missing organization', async () => {
      mockDb.organization.findUnique.mockResolvedValue(null);
      await expect(
        service.addStaff({ orgId: 'nope', userIds: ['u1'], orgRole: 'msp_tech' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('removeStaff', () => {
    it('deactivates an MSP staff membership', async () => {
      mockDb.member.findUnique.mockResolvedValue({
        id: 'mem_1',
        role: 'msp_tech',
        deactivated: false,
        user: { role: 'msp_staff' },
      });
      await expect(service.removeStaff({ orgId: 'org_1', userId: 'u1' })).resolves.toEqual({
        success: true,
        memberId: 'mem_1',
      });
      expect(mockDb.member.update).toHaveBeenCalledWith({
        where: { id: 'mem_1' },
        data: { deactivated: true, isActive: false },
      });
    });

    it('refuses to deactivate a regular client member', async () => {
      mockDb.member.findUnique.mockResolvedValue({
        id: 'mem_2',
        role: 'employee',
        deactivated: false,
        user: { role: 'user' },
      });
      await expect(service.removeStaff({ orgId: 'org_1', userId: 'u9' })).rejects.toThrow(
        BadRequestException,
      );
      expect(mockDb.member.update).not.toHaveBeenCalled();
    });

    it('404s when the user has no membership', async () => {
      mockDb.member.findUnique.mockResolvedValue(null);
      await expect(service.removeStaff({ orgId: 'org_1', userId: 'u1' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('listStaff', () => {
    it('lists active members with msp_staff/admin global roles', async () => {
      mockDb.member.findMany.mockResolvedValue([{ id: 'mem_1' }]);
      const result = await service.listStaff('org_1');
      expect(result).toEqual({ data: [{ id: 'mem_1' }], count: 1 });
      expect(mockDb.member.findMany.mock.calls[0][0].where).toEqual({
        organizationId: 'org_1',
        deactivated: false,
        user: { role: { in: ['msp_staff', 'admin'] } },
      });
    });
  });
});
