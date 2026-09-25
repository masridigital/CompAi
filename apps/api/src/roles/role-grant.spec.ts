import { ForbiddenException } from '@nestjs/common';

const FULL = ['create', 'read', 'update', 'delete'];

// Realistic subset of the built-in roles (the real package pulls ESM-only
// better-auth, which Jest cannot load here).
jest.mock('@trycompai/auth', () => {
  const full = ['create', 'read', 'update', 'delete'];
  const admin = {
    organization: ['read', 'update'],
    member: full,
    invitation: ['create', 'read', 'delete'],
    ac: full,
    control: full,
    apiKey: ['create', 'read', 'delete'],
    secret: full,
    app: ['read'],
  };
  return {
    BUILT_IN_ROLE_PERMISSIONS: {
      owner: { ...admin, organization: ['read', 'update', 'delete'] },
      admin,
      auditor: { organization: ['read'], control: ['read'], finding: ['create', 'read'], app: ['read'] },
      employee: { policy: ['read'], portal: ['read', 'update'] },
      contractor: { policy: ['read'], portal: ['read', 'update'] },
    },
    isRestrictedRole: (r: string) => r === 'employee' || r === 'contractor',
    parseRolePermissions: (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v),
  };
});

const mockRoleFindMany = jest.fn();
jest.mock('@db', () => ({
  db: {
    organizationRole: { findMany: (...a: unknown[]) => mockRoleFindMany(...a) },
  },
}));

import { buildMspTechPermissions } from './msp-tech-role';
import {
  assertCallerCanGrantRoles,
  assertCanGrantRoles,
  missingPermissions,
  toRoleList,
} from './role-grant';

const CUSTOM_ROLES: Record<string, Record<string, string[]>> = {
  msp_tech: buildMspTechPermissions(),
  secret_reader: { secret: ['read'], app: ['read'] },
  control_viewer: { control: ['read'], app: ['read'] },
};

const grant = (callerRoles: string[], targetRoles: string | string[]) =>
  assertCanGrantRoles({ organizationId: 'org_1', callerRoles, targetRoles });

describe('role-grant: cannot grant more than you have', () => {
  beforeEach(() => {
    mockRoleFindMany.mockImplementation(
      async ({ where }: { where: { name: { in: string[] } } }) =>
        where.name.in
          .filter((n) => CUSTOM_ROLES[n])
          .map((name) => ({ name, permissions: JSON.stringify(CUSTOM_ROLES[name]) })),
    );
  });

  it('msp_tech has no ac, secret or apiKey permissions to hand out', () => {
    expect(CUSTOM_ROLES.msp_tech.ac).toBeUndefined();
    expect(CUSTOM_ROLES.msp_tech.secret).toBeUndefined();
    expect(CUSTOM_ROLES.msp_tech.apiKey).toBeUndefined();
    expect(CUSTOM_ROLES.msp_tech.member).toEqual(FULL);
  });

  describe('msp_tech caller', () => {
    it('cannot assign admin', async () => {
      await expect(grant(['msp_tech'], 'admin')).rejects.toThrow(/secret:read/);
    });

    it('cannot assign owner', async () => {
      await expect(grant(['msp_tech'], 'owner')).rejects.toThrow(ForbiddenException);
    });

    it('cannot assign a custom role with secret:read', async () => {
      await expect(grant(['msp_tech'], 'secret_reader')).rejects.toThrow(
        'You cannot grant the role "secret_reader": it includes secret:read',
      );
    });

    it('checks every role in a comma-separated list', async () => {
      await expect(grant(['msp_tech'], 'employee,admin')).rejects.toThrow(ForbiddenException);
      await expect(grant(['msp_tech'], ['control_viewer', 'secret_reader'])).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('can assign roles within its permissions', async () => {
      await expect(grant(['msp_tech'], 'employee,control_viewer')).resolves.toBeUndefined();
      await expect(grant(['msp_tech'], 'msp_tech')).resolves.toBeUndefined();
    });
  });

  describe('admin caller', () => {
    it('can assign admin and a custom role with secret:read', async () => {
      await expect(grant(['admin'], 'admin')).resolves.toBeUndefined();
      await expect(grant(['admin'], 'secret_reader,msp_tech')).resolves.toBeUndefined();
    });

    it('cannot assign owner or a role with permissions it lacks', async () => {
      await expect(grant(['admin'], 'owner')).rejects.toThrow(ForbiddenException);
      await expect(grant(['admin'], 'auditor')).rejects.toThrow(/finding:create/);
    });
  });

  describe('owner caller', () => {
    it('can assign anything, including owner and admin', async () => {
      await expect(grant(['owner'], 'owner')).resolves.toBeUndefined();
      await expect(grant(['owner'], 'admin,secret_reader')).resolves.toBeUndefined();
    });
  });

  it('rejects unknown roles', async () => {
    await expect(grant(['admin'], 'ghost')).rejects.toThrow('Unknown role "ghost"');
  });

  it('allows restricted roles for any member manager', async () => {
    await expect(grant(['auditor'], 'employee,contractor')).resolves.toBeUndefined();
  });

  describe('assertCallerCanGrantRoles', () => {
    it('trusts platform admins, service tokens and API keys', async () => {
      for (const caller of [
        { userRoles: null, isPlatformAdmin: true },
        { userRoles: null, isServiceToken: true },
        { userRoles: null, isApiKey: true },
      ]) {
        await expect(
          assertCallerCanGrantRoles({ organizationId: 'org_1', caller, targetRoles: 'owner' }),
        ).resolves.toBeUndefined();
      }
    });

    it('checks session members by their roles', async () => {
      await expect(
        assertCallerCanGrantRoles({
          organizationId: 'org_1',
          caller: { userRoles: ['msp_tech'] },
          targetRoles: 'admin',
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  it('helpers', () => {
    expect(toRoleList(' a, b ,a,')).toEqual(['a', 'b']);
    expect(missingPermissions({ caller: { x: ['read'] }, target: { x: ['read', 'update'] } })).toEqual([
      'x:update',
    ]);
  });
});
