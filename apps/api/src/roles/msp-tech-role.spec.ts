const mockUpsert = jest.fn();
jest.mock('@db', () => ({
  db: { organizationRole: { upsert: (...args: unknown[]) => mockUpsert(...args) } },
}));

// The real @trycompai/auth pulls ESM-only better-auth; mirror the admin shape.
jest.mock('@trycompai/auth', () => ({
  BUILT_IN_ROLE_PERMISSIONS: {
    admin: {
      organization: ['read', 'update', 'delete'],
      member: ['create', 'read', 'update', 'delete'],
      ac: ['create', 'read', 'update', 'delete'],
      control: ['create', 'read', 'update', 'delete'],
      apiKey: ['create', 'read', 'delete'],
      secret: ['create', 'read', 'update', 'delete'],
      app: ['read'],
    },
  },
}));

import { BUILT_IN_ROLE_PERMISSIONS } from '@trycompai/auth';
import {
  MSP_TECH_ROLE,
  buildMspTechPermissions,
  ensureMspTechRole,
} from './msp-tech-role';

describe('msp_tech role', () => {
  beforeEach(() => jest.clearAllMocks());

  it('excludes organization:delete, apiKey:*, secret:* and ac:*', () => {
    const perms = buildMspTechPermissions();
    expect(perms.ac).toBeUndefined();
    expect(perms.organization).toEqual(['read', 'update']);
    expect(perms.apiKey).toBeUndefined();
    expect(perms.secret).toBeUndefined();
  });

  it('keeps every other admin permission', () => {
    const perms = buildMspTechPermissions();
    const admin = BUILT_IN_ROLE_PERMISSIONS.admin;
    for (const [resource, actions] of Object.entries(admin)) {
      if (['apiKey', 'secret', 'ac'].includes(resource)) continue;
      const expected = actions.filter(
        (a) => !(resource === 'organization' && a === 'delete'),
      );
      if (expected.length === 0) continue;
      expect(perms[resource]).toEqual(expected);
    }
    expect(perms.app).toEqual(['read']);
    expect(perms.control).toEqual(['create', 'read', 'update', 'delete']);
  });

  it('upserts the role scoped to the organization', async () => {
    mockUpsert.mockResolvedValue({ id: 'rol_1' });
    await ensureMspTechRole('org_1');

    const args = mockUpsert.mock.calls[0][0];
    expect(args.where).toEqual({
      organizationId_name: { organizationId: 'org_1', name: MSP_TECH_ROLE },
    });
    expect(args.create.organizationId).toBe('org_1');
    expect(args.create.name).toBe('msp_tech');
    expect(JSON.parse(args.create.permissions)).toEqual(buildMspTechPermissions());
    expect(JSON.parse(args.create.obligations)).toEqual({});
    expect(JSON.parse(args.update.permissions)).toEqual(buildMspTechPermissions());
  });
});
