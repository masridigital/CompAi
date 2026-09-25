import {
  NON_PARTICIPANT_ROLES as AUTH_NON_PARTICIPANT_ROLES,
  PLATFORM_ADMIN_ROLE as AUTH_PLATFORM_ADMIN_ROLE,
  isOrgParticipant as authIsOrgParticipant,
} from '@trycompai/auth/participation';
import {
  isNonParticipantRole,
  isOrgParticipant,
  MSP_STAFF_ROLE,
  NON_PARTICIPANT_ROLES,
  PLATFORM_ADMIN_ROLE,
} from './org-participation-rule';

describe('org-participation-rule (API mirror)', () => {
  it('excludes platform admins in a customer org', () => {
    expect(isOrgParticipant(PLATFORM_ADMIN_ROLE, { orgIsInternal: false })).toBe(
      false,
    );
  });

  it('includes platform admins in an internal org', () => {
    expect(isOrgParticipant(PLATFORM_ADMIN_ROLE, { orgIsInternal: true })).toBe(
      true,
    );
  });

  it('includes non-admin and null roles in a customer org', () => {
    expect(isOrgParticipant('user', { orgIsInternal: false })).toBe(true);
    expect(isOrgParticipant('owner', { orgIsInternal: false })).toBe(true);
    expect(isOrgParticipant(null, { orgIsInternal: false })).toBe(true);
    expect(isOrgParticipant(undefined, { orgIsInternal: false })).toBe(true);
  });
});

describe('MSP staff participation', () => {
  it('excludes msp_staff in a customer org', () => {
    expect(isOrgParticipant(MSP_STAFF_ROLE, { orgIsInternal: false })).toBe(false);
  });

  it('includes msp_staff in an internal org', () => {
    expect(isOrgParticipant(MSP_STAFF_ROLE, { orgIsInternal: true })).toBe(true);
  });

  it('flags only admin and msp_staff as non-participant roles', () => {
    expect(isNonParticipantRole('admin')).toBe(true);
    expect(isNonParticipantRole('msp_staff')).toBe(true);
    expect(isNonParticipantRole('user')).toBe(false);
    expect(isNonParticipantRole('msp_staff,user')).toBe(false);
    expect(isNonParticipantRole(null)).toBe(false);
    expect(isNonParticipantRole('')).toBe(false);
  });
});

// Drift guard: this API-local rule is a deliberate dependency-free mirror of
// `@trycompai/auth/participation` (files in the Trigger.dev bundle can't import
// the auth package — its dist isn't built in that deploy). Fail CI if the two
// ever diverge.
describe('API rule stays in sync with @trycompai/auth', () => {
  const roles: Array<string | null | undefined> = [
    'admin',
    'msp_staff',
    'owner',
    'user',
    'auditor',
    '',
    null,
    undefined,
  ];

  it('matches the canonical predicate for every role × internal flag', () => {
    expect(PLATFORM_ADMIN_ROLE).toBe(AUTH_PLATFORM_ADMIN_ROLE);
    expect([...NON_PARTICIPANT_ROLES]).toEqual([...AUTH_NON_PARTICIPANT_ROLES]);
    for (const role of roles) {
      for (const orgIsInternal of [true, false]) {
        expect(isOrgParticipant(role, { orgIsInternal })).toBe(
          authIsOrgParticipant(role, { orgIsInternal }),
        );
      }
    }
  });
});
