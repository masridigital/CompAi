import { BadRequestException, NotFoundException } from '@nestjs/common';

const mockDb = {
  user: { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() },
  member: { findMany: jest.fn(), updateMany: jest.fn() },
  $transaction: jest.fn(),
};
jest.mock('@db', () => ({ db: mockDb }));
jest.mock('../roles/msp-tech-role', () => ({ MSP_TECH_ROLE: 'msp_tech' }));

import { AdminUsersService } from './admin-users.service';
import type { SettableGlobalRole } from './dto/msp-staff.dto';

describe('AdminUsersService', () => {
  const service = new AdminUsersService();

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.$transaction.mockImplementation((fn: (tx: typeof mockDb) => unknown) => fn(mockDb));
    mockDb.member.findMany.mockResolvedValue([]);
  });

  it('deactivates msp_tech memberships when demoting msp_staff to user, in the transaction', async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: 'u1', role: 'msp_staff' });
    mockDb.user.update.mockResolvedValue({ id: 'u1', role: 'user' });
    mockDb.member.findMany.mockResolvedValue([
      { id: 'mem_tech', role: 'msp_tech' },
      { id: 'mem_mixed', role: 'employee, msp_tech' },
      { id: 'mem_client', role: 'employee' },
      { id: 'mem_lookalike', role: 'msp_tech_lead' },
    ]);

    await service.setGlobalRole({ userId: 'u1', role: 'user', adminUserId: 'adm' });

    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
    expect(mockDb.member.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1', deactivated: false },
      select: { id: true, role: true },
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
});
