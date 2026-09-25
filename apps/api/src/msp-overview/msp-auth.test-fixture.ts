/**
 * Minimal stand-in for `@trycompai/auth` in Jest (the real package pulls in
 * better-auth ESM, which ts-jest does not transform). Mirrors the relevant
 * built-in role grants from packages/auth/src/permissions.ts.
 */
const GRC_READ = {
  app: ['read'],
  task: ['read'],
  finding: ['read'],
  integration: ['read'],
  evidence: ['read'],
  framework: ['read'],
  policy: ['read'],
};

export const BUILT_IN_ROLE_PERMISSIONS: Record<
  string,
  Record<string, string[]>
> = {
  owner: GRC_READ,
  admin: GRC_READ,
  auditor: GRC_READ,
  employee: { policy: ['read'], portal: ['read', 'update'] },
  contractor: { policy: ['read'], portal: ['read', 'update'] },
};

export const RESTRICTED_ROLES = ['employee', 'contractor'];
export const PRIVILEGED_ROLES = ['owner', 'admin', 'auditor'];
