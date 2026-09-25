import { BadRequestException, NotFoundException } from '@nestjs/common';

const mockDb = {
  user: { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() },
};
jest.mock('@db', () => ({ db: mockDb }));

import { AdminUsersService } from './admin-users.service';
import type { SettableGlobalRole } from './dto/msp-staff.dto';

describe('AdminUsersService', () => {
  const service = new AdminUsersService();

  beforeEach(() => jest.clearAllMocks());

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
