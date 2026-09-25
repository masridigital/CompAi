import {
  NON_PARTICIPANT_ROLES as AUTH_NON_PARTICIPANT_ROLES,
  PLATFORM_ADMIN_ROLE as AUTH_PLATFORM_ADMIN_ROLE,
  isOrgParticipant as authIsOrgParticipant,
} from '@trycompai/auth/participation';
import { describe, expect, it } from 'vitest';
import {
  isNonParticipantRole,
  isOrgParticipant,
  MSP_STAFF_ROLE,
  NON_PARTICIPANT_ROLES,
  orgParticipantMemberWhereForFlag,
  PLATFORM_ADMIN_ROLE,
} from './org-participation-rule';

describe('isOrgParticipant', () => {
  it('excludes platform admins in a customer org', () => {
    expect(isOrgParticipant(PLATFORM_ADMIN_ROLE, { orgIsInternal: false })).toBe(false);
  });

  it('includes platform admins in an internal org', () => {
    expect(isOrgParticipant(PLATFORM_ADMIN_ROLE, { orgIsInternal: true })).toBe(true);
  });

  it('includes non-admin roles in any org', () => {
    expect(isOrgParticipant('user', { orgIsInternal: false })).toBe(true);
    expect(isOrgParticipant('owner', { orgIsInternal: false })).toBe(true);
  });

  it('treats null/undefined roles as participants (not platform admins)', () => {
    expect(isOrgParticipant(null, { orgIsInternal: false })).toBe(true);
    expect(isOrgParticipant(undefined, { orgIsInternal: false })).toBe(true);
  });

  it('includes everyone in an internal org', () => {
    expect(isOrgParticipant('admin', { orgIsInternal: true })).toBe(true);
    expect(isOrgParticipant('user', { orgIsInternal: true })).toBe(true);
    expect(isOrgParticipant(null, { orgIsInternal: true })).toBe(true);
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

describe('orgParticipantMemberWhereForFlag', () => {
  it('returns an empty fragment for internal orgs', () => {
    expect(orgParticipantMemberWhereForFlag(true)).toEqual({});
  });

  it('excludes admin and msp_staff but keeps null roles for customer orgs', () => {
    expect(orgParticipantMemberWhereForFlag(false)).toEqual({
      AND: [{ user: { OR: [{ role: { notIn: ['admin', 'msp_staff'] } }, { role: null }] } }],
    });
  });
});

// Drift guard: this app-local rule is a deliberate dependency-free mirror of
// `@trycompai/auth/participation` (the app can't import the auth index from
// Trigger.dev-bundled files). Fail CI if the two ever diverge.
describe('org-participation rule stays in sync with @trycompai/auth', () => {
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
