jest.mock('@trycompai/auth', () =>
  jest.requireActual('./msp-auth.test-fixture'),
);
const mockMemberFindMany = jest.fn();
const mockOrgFindMany = jest.fn();
const mockOrgRoleFindMany = jest.fn();

jest.mock('@db', () => ({
  db: {
    member: { findMany: (...a: unknown[]) => mockMemberFindMany(...a) },
    organization: { findMany: (...a: unknown[]) => mockOrgFindMany(...a) },
    organizationRole: {
      findMany: (...a: unknown[]) => mockOrgRoleFindMany(...a),
    },
  },
}));

import { canReadInOrg, orgIdsWithRead, parseMspRole } from './msp-scope';
import { MspScopeService } from './msp-scope.service';

function member(orgId: string, role: string) {
  return {
    organizationId: orgId,
    role,
    organization: { id: orgId, name: `Org ${orgId}`, logo: null },
  };
}

describe('parseMspRole', () => {
  it('maps exact admin and msp_staff; rejects everything else', () => {
    expect(parseMspRole('admin')).toBe('admin');
    expect(parseMspRole('msp_staff')).toBe('msp_staff');
    expect(parseMspRole('user,msp_staff')).toBe('msp_staff');
    expect(parseMspRole('user')).toBeNull();
    expect(parseMspRole('admin,user')).toBeNull();
    expect(parseMspRole(null)).toBeNull();
    expect(parseMspRole('')).toBeNull();
  });
});

describe('MspScopeService', () => {
  const service = new MspScopeService();

  beforeEach(() => {
    jest.clearAllMocks();
    mockOrgRoleFindMany.mockResolvedValue([]);
  });

  it('admin: all orgs with hasAccess or onboardingCompleted, full read', async () => {
    mockOrgFindMany.mockResolvedValue([{ id: 'org_a', name: 'A', logo: null }]);
    const scope = await service.resolve({ userId: 'usr_1', role: 'admin' });

    expect(mockOrgFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ hasAccess: true }, { onboardingCompleted: true }] },
      }),
    );
    expect(mockMemberFindMany).not.toHaveBeenCalled();
    expect(scope.isPlatformAdmin).toBe(true);
    expect(
      canReadInOrg({ scope, organizationId: 'org_a', resource: 'task' }),
    ).toBe(true);
    // Out-of-scope org is never readable, even for admins.
    expect(
      canReadInOrg({ scope, organizationId: 'org_x', resource: 'task' }),
    ).toBe(false);
  });

  it('msp_staff: only active, non-deactivated memberships of this user', async () => {
    mockMemberFindMany.mockResolvedValue([member('org_a', 'admin')]);
    const scope = await service.resolve({ userId: 'usr_2', role: 'msp_staff' });

    expect(mockMemberFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'usr_2', isActive: true, deactivated: false },
      }),
    );
    expect(mockOrgFindMany).not.toHaveBeenCalled();
    expect(scope.orgs.map((o) => o.id)).toEqual(['org_a']);
    expect(orgIdsWithRead({ scope, resource: 'task' })).toEqual(['org_a']);
  });

  it('msp_staff: excludes portal-only memberships (no app:read)', async () => {
    mockMemberFindMany.mockResolvedValue([
      member('org_a', 'auditor'),
      member('org_b', 'employee'),
    ]);
    const scope = await service.resolve({ userId: 'usr_2', role: 'msp_staff' });
    expect(scope.orgs.map((o) => o.id)).toEqual(['org_a']);
  });

  it('msp_staff: resolves custom roles via organization_role (same resolver as PermissionGuard)', async () => {
    mockMemberFindMany.mockResolvedValue([member('org_c', 'msp_tech_lite')]);
    mockOrgRoleFindMany.mockResolvedValue([
      { permissions: { app: ['read'], finding: ['read'] } },
    ]);
    const scope = await service.resolve({ userId: 'usr_2', role: 'msp_staff' });

    expect(mockOrgRoleFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org_c', name: { in: ['msp_tech_lite'] } },
      }),
    );
    expect(orgIdsWithRead({ scope, resource: 'finding' })).toEqual(['org_c']);
    expect(orgIdsWithRead({ scope, resource: 'task' })).toEqual([]);
  });
});
