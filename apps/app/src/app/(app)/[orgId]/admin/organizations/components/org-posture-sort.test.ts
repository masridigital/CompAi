import { describe, expect, it } from 'vitest';
import type { AdminOrg, ClientPosture } from './admin-org-types';
import { parseOrgSort, sortOrgs } from './org-posture-sort';

const posture = (overrides: Partial<ClientPosture> = {}): ClientPosture => ({
  capturedAt: '2026-09-25T05:30:00.000Z',
  frameworkScores: [],
  overallScore: 50,
  controlsPassing: 0,
  controlsTotal: 0,
  failingChecks: 0,
  overdueTasks: 0,
  openFindings: 0,
  evidenceExpiring30d: 0,
  policiesUnpublished: 0,
  integrationErrors: 0,
  lastActivityAt: null,
  ...overrides,
});

const org = (name: string, p: ClientPosture | null): AdminOrg => ({
  id: `org_${name}`,
  name,
  slug: name,
  logo: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  hasAccess: true,
  onboardingCompleted: true,
  memberCount: 1,
  owner: null,
  posture: p,
});

describe('parseOrgSort', () => {
  it('accepts known sorts and falls back to name', () => {
    expect(parseOrgSort('score')).toBe('score');
    expect(parseOrgSort('bogus')).toBe('name');
    expect(parseOrgSort(null)).toBe('name');
  });
});

describe('sortOrgs', () => {
  const orgs = [
    org('Charlie', posture({ overallScore: 90, failingChecks: 1 })),
    org('Alpha', null),
    org('Bravo', posture({ overallScore: 20, failingChecks: 5 })),
    org('Delta', posture({ overallScore: 20, failingChecks: 0 })),
  ];

  it('sorts by name', () => {
    expect(sortOrgs({ orgs, sort: 'name' }).map((o) => o.name)).toEqual([
      'Alpha',
      'Bravo',
      'Charlie',
      'Delta',
    ]);
  });

  it('sorts by lowest score first, ties by name, missing posture last', () => {
    expect(sortOrgs({ orgs, sort: 'score' }).map((o) => o.name)).toEqual([
      'Bravo',
      'Delta',
      'Charlie',
      'Alpha',
    ]);
  });

  it('sorts count metrics descending', () => {
    expect(sortOrgs({ orgs, sort: 'failingChecks' }).map((o) => o.name)).toEqual([
      'Bravo',
      'Charlie',
      'Delta',
      'Alpha',
    ]);
  });

  it('does not mutate the input', () => {
    const copy = [...orgs];
    sortOrgs({ orgs, sort: 'score' });
    expect(orgs).toEqual(copy);
  });
});
