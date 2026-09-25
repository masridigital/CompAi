import { ForbiddenException } from '@nestjs/common';

const mockMemberFindFirst = jest.fn();
jest.mock('@db', () => ({
  db: { member: { findFirst: (...a: unknown[]) => mockMemberFindFirst(...a) } },
}));

const mockAssert = jest.fn();
jest.mock('../roles/role-grant', () => ({
  assertCanGrantRoles: (...a: unknown[]) => mockAssert(...a),
}));

import { enforceOrgRoleGrant } from './org-role-grant.guard';

const base = {
  path: '/organization/update-member-role',
  body: { memberId: 'mem_2', role: ['admin'] },
  userId: 'usr_tech',
  userRole: 'msp_staff',
  activeOrganizationId: 'org_1',
};

describe('enforceOrgRoleGrant (better-auth org endpoints)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMemberFindFirst.mockResolvedValue({ role: 'msp_tech' });
    mockAssert.mockResolvedValue(undefined);
  });

  it('checks update-member-role against the caller roles in the active org', async () => {
    await enforceOrgRoleGrant(base);
    expect(mockMemberFindFirst).toHaveBeenCalledWith({
      where: { userId: 'usr_tech', organizationId: 'org_1', deactivated: false },
      select: { role: true },
    });
    expect(mockAssert).toHaveBeenCalledWith({
      organizationId: 'org_1',
      targetRoles: ['admin'],
      callerRoles: ['msp_tech'],
    });
  });

  it('checks invite-member and prefers the body organizationId', async () => {
    await enforceOrgRoleGrant({
      ...base,
      path: '/organization/invite-member',
      body: { email: 'x@y.com', role: 'admin', organizationId: 'org_2' },
    });
    expect(mockAssert).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org_2', targetRoles: 'admin' }),
    );
  });

  it('propagates the forbidden decision', async () => {
    mockAssert.mockRejectedValue(new ForbiddenException('nope'));
    await expect(enforceOrgRoleGrant(base)).rejects.toThrow(ForbiddenException);
  });

  it('ignores other paths and platform admins', async () => {
    await enforceOrgRoleGrant({ ...base, path: '/organization/set-active' });
    await enforceOrgRoleGrant({ ...base, userRole: 'admin' });
    expect(mockAssert).not.toHaveBeenCalled();
  });

  it('defers to better-auth when there is no role, org or membership', async () => {
    await enforceOrgRoleGrant({ ...base, body: { memberId: 'mem_2' } });
    await enforceOrgRoleGrant({ ...base, activeOrganizationId: null });
    mockMemberFindFirst.mockResolvedValue(null);
    await enforceOrgRoleGrant(base);
    expect(mockAssert).not.toHaveBeenCalled();
  });
});
