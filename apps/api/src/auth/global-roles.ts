import { adminAc, userAc } from 'better-auth/plugins/admin/access';

/**
 * Global `User.role` values managed by the better-auth `admin()` plugin.
 *
 * - `admin`: platform admin (Comp AI / MSP owner). The ONLY admin role.
 * - `msp_staff`: MSP technician. Holds normal `Member` rows in the client orgs
 *   they support, is excluded from org participation (see
 *   `@trycompai/auth/participation`), and has NO platform-admin privileges:
 *   same better-auth permissions as `user`, and not listed in `adminRoles`.
 * - `user`: everyone else.
 */
export const GLOBAL_USER_ROLES = ['user', 'admin', 'msp_staff'] as const;
export type GlobalUserRole = (typeof GLOBAL_USER_ROLES)[number];

/** Roles better-auth treats as admin. Must stay `['admin']` only. */
export const ADMIN_PLUGIN_ADMIN_ROLES = ['admin'];

export const adminPluginOptions = {
  defaultRole: 'user',
  adminRoles: ADMIN_PLUGIN_ADMIN_ROLES,
  roles: {
    admin: adminAc,
    user: userAc,
    msp_staff: userAc,
  },
};
