// better-auth ships ESM-only .mjs for this subpath; stand in with the same
// shape so the test asserts which role objects each global role maps to.
jest.mock('better-auth/plugins/admin/access', () => ({
  adminAc: { statements: { user: ['set-role', 'ban'], session: ['revoke'] } },
  userAc: { statements: { user: [], session: [] } },
}));

import { adminAc, userAc } from 'better-auth/plugins/admin/access';
import {
  ADMIN_PLUGIN_ADMIN_ROLES,
  GLOBAL_USER_ROLES,
  adminPluginOptions,
} from './global-roles';

describe('global user roles (better-auth admin plugin)', () => {
  it('allows user, admin and msp_staff', () => {
    expect([...GLOBAL_USER_ROLES].sort()).toEqual(['admin', 'msp_staff', 'user']);
    expect(Object.keys(adminPluginOptions.roles).sort()).toEqual([
      'admin',
      'msp_staff',
      'user',
    ]);
  });

  it('treats only admin as an admin role', () => {
    expect(ADMIN_PLUGIN_ADMIN_ROLES).toEqual(['admin']);
    expect(adminPluginOptions.adminRoles).not.toContain('msp_staff');
  });

  it('gives msp_staff no better-auth admin permissions', () => {
    expect(adminPluginOptions.roles.msp_staff).toBe(userAc);
    expect(adminPluginOptions.roles.msp_staff).not.toBe(adminAc);
    expect(adminPluginOptions.roles.admin).toBe(adminAc);
  });

  it('defaults new users to user', () => {
    expect(adminPluginOptions.defaultRole).toBe('user');
  });
});
