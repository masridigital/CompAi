const mockRoleFindMany = jest.fn();
jest.mock('@db', () => ({
  db: { organizationRole: { findMany: (...a: unknown[]) => mockRoleFindMany(...a) } },
}));

// better-auth ships ESM that Jest cannot parse; only built-in role data is needed.
jest.mock('@trycompai/auth', () => ({ BUILT_IN_ROLE_PERMISSIONS: {} }));

import type { AuthContext } from '../auth/types';
import {
  requireEvidenceDeleteAccess,
  requirePrivilegedEvidenceAccess,
} from './evidence-form-access';

const ctx = (userRoles: string[], extra: Partial<AuthContext> = {}): AuthContext =>
  ({
    organizationId: 'org_1',
    authType: 'session',
    isApiKey: false,
    userId: 'usr_1',
    userRoles,
    ...extra,
  }) as AuthContext;

const customRole = (permissions: Record<string, string[]>) => [
  { permissions: JSON.stringify(permissions) },
];

describe('evidence form access', () => {
  beforeEach(() => {
    mockRoleFindMany.mockReset();
    mockRoleFindMany.mockResolvedValue([]);
  });

  it('keeps the built-in reviewer list unchanged', async () => {
    for (const role of ['owner', 'admin', 'auditor']) {
      await expect(
        requirePrivilegedEvidenceAccess({ organizationId: 'org_1', authContext: ctx([role]) }),
      ).resolves.toBe('usr_1');
    }
    await expect(
      requirePrivilegedEvidenceAccess({ organizationId: 'org_1', authContext: ctx(['employee']) }),
    ).rejects.toThrow('Required one of roles');
    expect(mockRoleFindMany).not.toHaveBeenCalled();
  });

  it('lets a custom role with evidence:read view submissions', async () => {
    mockRoleFindMany.mockResolvedValue(customRole({ evidence: ['read'] }));
    await expect(
      requirePrivilegedEvidenceAccess({ organizationId: 'org_1', authContext: ctx(['msp_tech']) }),
    ).resolves.toBe('usr_1');
    expect(mockRoleFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org_1', name: { in: ['msp_tech'] } } }),
    );
  });

  it('requires evidence:update for a custom role to review', async () => {
    mockRoleFindMany.mockResolvedValue(customRole({ evidence: ['read'] }));
    await expect(
      requirePrivilegedEvidenceAccess({
        organizationId: 'org_1',
        authContext: ctx(['msp_tech']),
        customRoleAction: 'update',
      }),
    ).rejects.toThrow('Required one of roles');

    mockRoleFindMany.mockResolvedValue(customRole({ evidence: ['read', 'update'] }));
    await expect(
      requirePrivilegedEvidenceAccess({
        organizationId: 'org_1',
        authContext: ctx(['msp_tech']),
        customRoleAction: 'update',
      }),
    ).resolves.toBe('usr_1');
  });

  it('denies a custom role without evidence permissions', async () => {
    mockRoleFindMany.mockResolvedValue(customRole({ policy: ['read'] }));
    await expect(
      requirePrivilegedEvidenceAccess({ organizationId: 'org_1', authContext: ctx(['viewer']) }),
    ).rejects.toThrow('Required one of roles');
  });

  it('limits delete to owner/admin or custom evidence:delete', async () => {
    await expect(
      requireEvidenceDeleteAccess({ organizationId: 'org_1', authContext: ctx(['auditor']) }),
    ).rejects.toThrow('Delete denied');
    mockRoleFindMany.mockResolvedValue(customRole({ evidence: ['read', 'update', 'delete'] }));
    await expect(
      requireEvidenceDeleteAccess({ organizationId: 'org_1', authContext: ctx(['msp_tech']) }),
    ).resolves.toBe('usr_1');
  });

  it('still rejects API keys and missing users', async () => {
    await expect(
      requirePrivilegedEvidenceAccess({
        organizationId: 'org_1',
        authContext: ctx(['owner'], { isApiKey: true, authType: 'api-key' }),
      }),
    ).rejects.toThrow('does not support API key');
    await expect(
      requirePrivilegedEvidenceAccess({
        organizationId: 'org_1',
        authContext: ctx(['owner'], { userId: undefined }),
      }),
    ).rejects.toThrow('Authenticated user session is required');
  });
});
