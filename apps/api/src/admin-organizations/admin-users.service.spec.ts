import { BadRequestException, NotFoundException } from '@nestjs/common';

const mockDb = {
  user: { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() },
  member: { findMany: jest.fn(), updateMany: jest.fn(), findFirst: jest.fn() },
  auditLog: { create: jest.fn() },
  $transaction: jest.fn(),
};
jest.mock('@db', () => ({
  db: mockDb,
  AuditLogEntityType: { people: 'people' },
}));
jest.mock('../roles/msp-tech-role', () => ({ MSP_TECH_ROLE: 'msp_tech' }));

import { AdminUsersService } from './admin-users.service';
import type { SettableGlobalRole } from './dto/msp-staff.dto';

describe('AdminUsersService', () => {
  const service = new AdminUsersService();

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.$transaction.mockImplementation((fn: (tx: typeof mockDb) => unknown) => fn(mockDb));
    mockDb.member.findMany.mockResolvedValue([]);
    mockDb.member.findFirst.mockResolvedValue({ organizationId: 'org_admin' });
    mockDb.auditLog.create.mockResolvedValue({});
  });

  it('deactivates msp_tech memberships when demoting msp_staff to user, in the transaction', async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: 'u1', role: 'msp_staff' });
    mockDb.user.update.mockResolvedValue({ id: 'u1', role: 'user' });
    mockDb.member.findMany.mockResolvedValue([
      { id: 'mem_tech', role: 'msp_tech', organizationId: 'org_a' },
      { id: 'mem_mixed', role: 'employee, msp_tech', organizationId: 'org_b' },
      { id: 'mem_client', role: 'employee', organizationId: 'org_c' },
      { id: 'mem_lookalike', role: 'msp_tech_lead', organizationId: 'org_d' },
    ]);

    await service.setGlobalRole({ userId: 'u1', role: 'user', adminUserId: 'adm' });

    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
    expect(mockDb.member.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1', deactivated: false },
      select: { id: true, role: true, organizationId: true },
    });
    expect(mockDb.member.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['mem_tech', 'mem_mixed'] } },
      data: { deactivated: true, isActive: false },
    });
  });

  it('does not touch memberships when promoting user to msp_staff', async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: 'u1', role: 'user' });
    mockDb.user.update.mockResolvedValue({ id: 'u1', role: 'msp_staff' });
    await service.setGlobalRole({ userId: 'u1', role: 'msp_staff', adminUserId: 'adm' });
    expect(mockDb.member.findMany).not.toHaveBeenCalled();
    expect(mockDb.member.updateMany).not.toHaveBeenCalled();
  });

  it('skips updateMany when a demoted user has no msp_tech memberships', async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: 'u1', role: 'msp_staff' });
    mockDb.user.update.mockResolvedValue({ id: 'u1', role: 'user' });
    mockDb.member.findMany.mockResolvedValue([{ id: 'mem_client', role: 'admin' }]);
    await service.setGlobalRole({ userId: 'u1', role: 'user', adminUserId: 'adm' });
    expect(mockDb.member.updateMany).not.toHaveBeenCalled();
  });

  it('sets msp_staff on a regular user', async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: 'u1', role: 'user' });
    mockDb.user.update.mockResolvedValue({ id: 'u1', role: 'msp_staff' });

    await service.setGlobalRole({ userId: 'u1', role: 'msp_staff', adminUserId: 'adm' });

    expect(mockDb.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u1' }, data: { role: 'msp_staff' } }),
    );
  });

  it('rejects admin as a target role even if validation is bypassed', async () => {
    const role = 'admin' as unknown as SettableGlobalRole;
    await expect(
      service.setGlobalRole({ userId: 'u1', role, adminUserId: 'adm' }),
    ).rejects.toThrow(BadRequestException);
    expect(mockDb.user.update).not.toHaveBeenCalled();
  });

  it('refuses to change a current platform admin', async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: 'u2', role: 'admin' });
    await expect(
      service.setGlobalRole({ userId: 'u2', role: 'user', adminUserId: 'adm' }),
    ).rejects.toThrow(BadRequestException);
    expect(mockDb.user.update).not.toHaveBeenCalled();
  });

  it('refuses self-changes', async () => {
    await expect(
      service.setGlobalRole({ userId: 'adm', role: 'user', adminUserId: 'adm' }),
    ).rejects.toThrow('You cannot change your own role');
  });

  it('404s for an unknown user', async () => {
    mockDb.user.findUnique.mockResolvedValue(null);
    await expect(
      service.setGlobalRole({ userId: 'ghost', role: 'user', adminUserId: 'adm' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('lists only msp_staff/admin users', async () => {
    mockDb.user.findMany.mockResolvedValue([{ id: 'u1' }]);
    const result = await service.listMspStaffUsers({ search: ' ann ' });
    expect(result.count).toBe(1);
    const where = mockDb.user.findMany.mock.calls[0][0].where;
    expect(where.role).toEqual({ in: ['msp_staff', 'admin'] });
    expect(where.OR[0]).toEqual({ email: { contains: 'ann', mode: 'insensitive' } });
  });

  describe('audit trail', () => {
    it('writes one row for the role change and one per deactivated membership, in the transaction', async () => {
      mockDb.user.findUnique.mockResolvedValue({ id: 'u1', role: 'msp_staff' });
      mockDb.user.update.mockResolvedValue({ id: 'u1', role: 'user' });
      mockDb.member.findMany.mockResolvedValue([
        { id: 'mem_tech', role: 'msp_tech', organizationId: 'org_a' },
        { id: 'mem_mixed', role: 'employee,msp_tech', organizationId: 'org_b' },
        { id: 'mem_client', role: 'employee', organizationId: 'org_c' },
      ]);

      await service.setGlobalRole({ userId: 'u1', role: 'user', adminUserId: 'adm' });

      const rows = mockDb.auditLog.create.mock.calls.map((c) => c[0].data);
      expect(rows).toHaveLength(3);
      expect(rows[0]).toEqual(
        expect.objectContaining({
          organizationId: 'org_admin',
          userId: 'adm',
          memberId: null,
          entityType: 'people',
          entityId: 'u1',
          data: expect.objectContaining({
            method: 'PATCH',
            path: '/v1/admin/users/u1/role',
            resource: 'admin',
            permission: 'platform-admin',
            changes: { role: { previous: 'msp_staff', current: 'user' } },
            deactivatedMemberIds: ['mem_tech', 'mem_mixed'],
          }),
        }),
      );
      expect(rows.slice(1).map((r) => [r.organizationId, r.entityId])).toEqual([
        ['org_a', 'mem_tech'],
        ['org_b', 'mem_mixed'],
      ]);
      expect(mockDb.member.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'adm', deactivated: false } }),
      );
    });

    it('writes a single row on promotion', async () => {
      mockDb.user.findUnique.mockResolvedValue({ id: 'u1', role: 'user' });
      mockDb.user.update.mockResolvedValue({ id: 'u1', role: 'msp_staff' });
      await service.setGlobalRole({ userId: 'u1', role: 'msp_staff', adminUserId: 'adm' });
      expect(mockDb.auditLog.create).toHaveBeenCalledTimes(1);
      expect(mockDb.auditLog.create.mock.calls[0][0].data.data.changes).toEqual({
        role: { previous: 'user', current: 'msp_staff' },
      });
    });

    it("falls back to the target user's organization when the admin has none", async () => {
      mockDb.user.findUnique.mockResolvedValue({ id: 'u1', role: 'user' });
      mockDb.user.update.mockResolvedValue({ id: 'u1', role: 'msp_staff' });
      mockDb.member.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ organizationId: 'org_target' });
      await service.setGlobalRole({ userId: 'u1', role: 'msp_staff', adminUserId: 'adm' });
      expect(mockDb.auditLog.create.mock.calls[0][0].data.organizationId).toBe('org_target');
    });

    it('fails (rolling back the transaction) when no organization can hold the audit row', async () => {
      mockDb.user.findUnique.mockResolvedValue({ id: 'u1', role: 'user' });
      mockDb.user.update.mockResolvedValue({ id: 'u1', role: 'msp_staff' });
      mockDb.member.findFirst.mockResolvedValue(null);
      await expect(
        service.setGlobalRole({ userId: 'u1', role: 'msp_staff', adminUserId: 'adm' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockDb.auditLog.create).not.toHaveBeenCalled();
    });
  });
});
