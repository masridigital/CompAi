jest.mock('@trycompai/auth', () =>
  jest.requireActual('./msp-auth.test-fixture'),
);
const mockMemberFindMany = jest.fn();
const mockOrgRoleFindMany = jest.fn();
const mockTaskFindMany = jest.fn();
const mockFindingFindMany = jest.fn();
const mockHaloFindMany = jest.fn();

jest.mock('@db', () => ({
  db: {
    member: { findMany: (...a: unknown[]) => mockMemberFindMany(...a) },
    organizationRole: {
      findMany: (...a: unknown[]) => mockOrgRoleFindMany(...a),
    },
    task: { findMany: (...a: unknown[]) => mockTaskFindMany(...a) },
    finding: { findMany: (...a: unknown[]) => mockFindingFindMany(...a) },
    haloTicketLink: { findMany: (...a: unknown[]) => mockHaloFindMany(...a) },
  },
}));

import { BadRequestException } from '@nestjs/common';
import { decodeCursor, encodeCursor, parseQuery } from './msp-cursor';
import { MspFindingsQuery, mspFindingsQuerySchema } from './msp-findings.query';
import {
  haloTicketUrl,
  MspHaloTicketsQuery,
  mspHaloTicketsQuerySchema,
} from './msp-halo.query';
import { MspScopeService } from './msp-scope.service';
import { MspTasksQuery, mspTasksQuerySchema } from './msp-tasks.query';

const NOW = new Date('2026-09-25T12:00:00Z');

function member(orgId: string, role: string) {
  return {
    organizationId: orgId,
    role,
    organization: { id: orgId, name: `Org ${orgId}`, logo: null },
  };
}

/** Collect every organizationId constraint from a Prisma `where`. */
function orgIdsIn(where: unknown): string[] {
  const json = JSON.stringify(where);
  const match = json.match(/"organizationId":\{"in":(\[[^\]]*\])\}/);
  return match ? (JSON.parse(match[1]) as string[]) : [];
}

async function staffScope() {
  // org_a: built-in admin (everything). org_b: custom role with app + finding
  // only (no task:read, no integration:read). org_c exists but the staff user
  // has NO membership, so the member query never returns it.
  mockMemberFindMany.mockResolvedValue([
    member('org_a', 'admin'),
    member('org_b', 'finding_only'),
  ]);
  mockOrgRoleFindMany.mockResolvedValue([
    { permissions: { app: ['read'], finding: ['read'] } },
  ]);
  return new MspScopeService().resolve({
    userId: 'usr_staff',
    role: 'msp_staff',
  });
}

describe('MSP cross-org queries: tenant isolation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTaskFindMany.mockResolvedValue([]);
    mockFindingFindMany.mockResolvedValue([]);
    mockHaloFindMany.mockResolvedValue([]);
  });

  it('tasks: bounded to member orgs with task:read (never org_b without task:read, never non-member org_c)', async () => {
    const scope = await staffScope();
    const query = parseQuery({ schema: mspTasksQuerySchema, query: {} });
    await new MspTasksQuery().list({ scope, query, now: NOW });

    const where = mockTaskFindMany.mock.calls[0][0].where;
    expect(orgIdsIn(where)).toEqual(['org_a']);
    expect(JSON.stringify(where)).not.toContain('org_b');
    expect(JSON.stringify(where)).not.toContain('org_c');
  });

  it('tasks: a member without task:read anywhere gets no tasks and no query runs', async () => {
    mockMemberFindMany.mockResolvedValue([member('org_b', 'finding_only')]);
    mockOrgRoleFindMany.mockResolvedValue([
      { permissions: { app: ['read'], finding: ['read'] } },
    ]);
    const scope = await new MspScopeService().resolve({
      userId: 'usr_staff',
      role: 'msp_staff',
    });
    const query = parseQuery({ schema: mspTasksQuerySchema, query: {} });
    const result = await new MspTasksQuery().list({ scope, query, now: NOW });

    expect(result).toEqual({ data: [], nextCursor: null });
    expect(mockTaskFindMany).not.toHaveBeenCalled();
  });

  it('findings: bounded to orgs with finding:read (org_a + org_b, not org_c)', async () => {
    const scope = await staffScope();
    const query = parseQuery({ schema: mspFindingsQuerySchema, query: {} });
    await new MspFindingsQuery().list({ scope, query });
    const where = mockFindingFindMany.mock.calls[0][0].where;
    expect(orgIdsIn(where).sort()).toEqual(['org_a', 'org_b']);
    expect(JSON.stringify(where)).toContain('"status":{"not":"closed"}');
  });

  it('halo tickets: bounded to orgs with integration:read', async () => {
    const scope = await staffScope();
    const query = parseQuery({ schema: mspHaloTicketsQuerySchema, query: {} });
    await new MspHaloTicketsQuery().list({ scope, query });
    const where = mockHaloFindMany.mock.calls[0][0].where;
    expect(orgIdsIn(where)).toEqual(['org_a']);
  });

  it('a staff user with no memberships gets nothing and runs no data queries', async () => {
    mockMemberFindMany.mockResolvedValue([]);
    const scope = await new MspScopeService().resolve({
      userId: 'usr_new',
      role: 'msp_staff',
    });
    const tasks = await new MspTasksQuery().list({
      scope,
      query: parseQuery({ schema: mspTasksQuerySchema, query: {} }),
    });
    const findings = await new MspFindingsQuery().list({
      scope,
      query: parseQuery({ schema: mspFindingsQuerySchema, query: {} }),
    });
    expect(tasks.data).toEqual([]);
    expect(findings.data).toEqual([]);
    expect(mockTaskFindMany).not.toHaveBeenCalled();
    expect(mockFindingFindMany).not.toHaveBeenCalled();
  });
});

describe('MSP tasks query: shape and pagination', () => {
  beforeEach(() => jest.clearAllMocks());

  it('maps rows, filters overdue by reviewDate and returns a keyset cursor', async () => {
    const scope = await staffScope();
    const due = new Date('2026-09-01T00:00:00Z');
    mockTaskFindMany.mockResolvedValue([
      {
        id: 'tsk_1',
        title: 'T1',
        status: 'todo',
        reviewDate: due,
        organizationId: 'org_a',
        assignee: { user: { name: 'Ann' } },
      },
      {
        id: 'tsk_2',
        title: 'T2',
        status: 'todo',
        reviewDate: due,
        organizationId: 'org_a',
        assignee: null,
      },
    ]);
    const query = parseQuery({
      schema: mspTasksQuerySchema,
      query: { limit: '1' },
    });
    const result = await new MspTasksQuery().list({ scope, query, now: NOW });

    const args = mockTaskFindMany.mock.calls[0][0];
    expect(args.take).toBe(2);
    expect(JSON.stringify(args.where)).toContain(
      '"notIn":["done","not_relevant"]',
    );
    expect(result.data).toEqual([
      {
        organizationId: 'org_a',
        orgName: 'Org org_a',
        taskId: 'tsk_1',
        title: 'T1',
        status: 'todo',
        assigneeName: 'Ann',
        reviewDate: due,
      },
    ]);
    expect(decodeCursor(result.nextCursor ?? undefined)).toEqual({
      t: due,
      i: 'tsk_1',
    });
  });

  it('applies the cursor as a keyset condition', async () => {
    const scope = await staffScope();
    mockTaskFindMany.mockResolvedValue([]);
    const cursor = encodeCursor({
      t: new Date('2026-09-01T00:00:00Z'),
      i: 'tsk_1',
    });
    await new MspTasksQuery().list({
      scope,
      query: parseQuery({
        schema: mspTasksQuerySchema,
        query: { view: 'due-soon', cursor },
      }),
      now: NOW,
    });
    const where = JSON.stringify(mockTaskFindMany.mock.calls[0][0].where);
    expect(where).toContain('"id":{"gt":"tsk_1"}');
    expect(where).toContain('"status":{"not":"not_relevant"}');
  });
});

describe('MSP query validation', () => {
  it('caps limit at 100 and rejects unknown views, severities and bad cursors', () => {
    expect(() =>
      parseQuery({ schema: mspTasksQuerySchema, query: { limit: '500' } }),
    ).toThrow(BadRequestException);
    expect(() =>
      parseQuery({ schema: mspTasksQuerySchema, query: { view: 'all' } }),
    ).toThrow(BadRequestException);
    expect(() =>
      parseQuery({
        schema: mspFindingsQuerySchema,
        query: { severity: 'huge' },
      }),
    ).toThrow(BadRequestException);
    expect(() => decodeCursor('not-a-cursor')).toThrow(BadRequestException);
  });

  it('builds the Halo ticket link only when a base URL and ticket id exist', () => {
    const env = { HALOPSA_BASE_URL: 'https://portal.masri.tech/' };
    expect(haloTicketUrl({ haloTicketId: 42, env })).toBe(
      'https://portal.masri.tech/ticket?id=42',
    );
    expect(haloTicketUrl({ haloTicketId: null, env })).toBeNull();
    expect(haloTicketUrl({ haloTicketId: 42, env: {} })).toBeNull();
  });
});
