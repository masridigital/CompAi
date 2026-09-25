import { describe, expect, it } from 'bun:test';
import {
  accessReviewCheck,
  changeManagementCheck,
  employeeAccessCheck,
  incidentResponseCheck,
} from '..';
import { getManifest } from '../../../../registry';
import { TASK_TEMPLATES } from '../../../../task-mappings';
import { hoursAgo, makeCtx, useHaloMock } from './check-harness';

const halo = useHaloMock();

const tickets = (list: Array<Record<string, unknown>>) => () => ({
  record_count: list.length,
  tickets: list,
});

describe('halopsa manifest', () => {
  it('is registered with checks and task mappings', () => {
    const manifest = getManifest('halopsa');
    expect(manifest?.category).toBe('ITSM');
    expect(manifest?.auth.type).toBe('custom');
    expect(manifest?.checks?.map((c) => c.id)).toEqual([
      'halopsa_incident_response',
      'halopsa_access_review',
      'halopsa_employee_access',
      'halopsa_change_management',
    ]);
    expect(incidentResponseCheck.taskMapping).toBe(TASK_TEMPLATES.incidentResponse);
    expect(accessReviewCheck.taskMapping).toBe(TASK_TEMPLATES.accessReviewLog);
    expect(employeeAccessCheck.taskMapping).toBe(TASK_TEMPLATES.employeeAccess);
    expect(changeManagementCheck.taskMapping).toBeUndefined();
  });
});

describe('shared setup failures', () => {
  it('fails clearly when HALOPSA env is missing', async () => {
    delete process.env.HALOPSA_CLIENT_SECRET;
    const { ctx, fails } = makeCtx({ variables: { incident_ticket_type_ids: '21' } });
    await incidentResponseCheck.run(ctx);
    expect(fails).toHaveLength(1);
    expect(fails[0].title).toBe('HaloPSA is not configured on this server');
    // Env var names stay in server logs, never in customer-visible findings.
    expect(fails[0].description).not.toContain('HALOPSA_');
    expect(fails[0].remediation).not.toContain('HALOPSA_');
  });

  it('fails when the connection has no admin binding', async () => {
    const { ctx, fails } = makeCtx({ metadata: {} });
    await accessReviewCheck.run(ctx);
    expect(fails[0].title).toContain('not bound');
  });

  it('ignores a Halo client id in credentials or variables', async () => {
    const { ctx, fails } = makeCtx({
      credentials: { haloClientId: '99' },
      variables: { haloClientId: 99, access_review_ticket_type_ids: '22' },
      metadata: {},
    });
    await accessReviewCheck.run(ctx);
    expect(fails).toHaveLength(1);
    expect(fails[0].title).toContain('not bound');
    expect(halo.requests).toHaveLength(0);
  });

  it('ignores a legacy top-level haloClientId in metadata', async () => {
    const { ctx, fails } = makeCtx({ metadata: { haloClientId: 99 } });
    await accessReviewCheck.run(ctx);
    expect(fails[0].title).toContain('not bound');
  });

  it('uses only the admin binding when credentials disagree', async () => {
    halo.setRoutes({ '/api/Tickets': () => ({ record_count: 0, tickets: [] }) });
    const { ctx } = makeCtx({
      credentials: { haloClientId: '99' },
      variables: { haloClientId: 99, incident_ticket_type_ids: '21' },
    });
    await incidentResponseCheck.run(ctx);
    const call = halo.requests.find((u) => u.pathname === '/api/Tickets');
    expect(call?.searchParams.get('client_id')).toBe('7');
  });

  it('fails when ticket types are not configured', async () => {
    const { ctx, fails } = makeCtx();
    await changeManagementCheck.run(ctx);
    expect(fails[0].severity).toBe('low');
    expect(fails[0].remediation).toContain('Change request ticket type IDs');
  });

  it('reports API permission errors with scope remediation', async () => {
    halo.setRoutes({ '/api/Tickets': () => new Response('denied', { status: 403 }) });
    const { ctx, fails } = makeCtx({ variables: { incident_ticket_type_ids: '21' } });
    await incidentResponseCheck.run(ctx);
    expect(fails[0].title).toBe('HaloPSA denied access');
    expect(fails[0].remediation).toContain('read:tickets');
    // Generic description: no Halo response body.
    expect(fails[0].description).toBe('HaloPSA request failed (status 403)');
  });
});

describe('halopsa_incident_response', () => {
  const variables = { incident_ticket_type_ids: '21', incident_sla_hours: 48 };

  it('passes with evidence when there are no incidents', async () => {
    halo.setRoutes({
      '/api/Tickets': tickets([
        { id: 1, client_id: 7, tickettype_id: 21, dateoccurred: hoursAgo(24 * 200) },
      ]),
    });
    const { ctx, passes, fails } = makeCtx({ variables });
    await incidentResponseCheck.run(ctx);
    expect(fails).toHaveLength(0);
    expect(passes[0].evidence.incidentCount).toBe(0);
    const url = halo.requests.find((u) => u.pathname === '/api/Tickets');
    expect(url?.searchParams.get('client_id')).toBe('7');
    expect(url?.searchParams.get('requesttype')).toBe('21');
  });

  it('passes resolved incidents and fails late / un-noted / overdue ones', async () => {
    halo.setRoutes({
      '/api/Tickets': tickets([
        {
          id: 10,
          client_id: 7,
          tickettype_id: 21,
          summary: 'Phish',
          dateoccurred: hoursAgo(100),
          dateclosed: hoursAgo(90),
        },
        {
          id: 11,
          client_id: 7,
          tickettype_id: 21,
          summary: 'Malware',
          dateoccurred: hoursAgo(200),
          dateclosed: hoursAgo(100),
        },
        { id: 12, client_id: 7, tickettype_id: 21, summary: 'Open', dateoccurred: hoursAgo(72) },
        { id: 13, client_id: 7, tickettype_id: 21, summary: 'Fresh', dateoccurred: hoursAgo(2) },
      ]),
      '/api/Actions': (url) => {
        const id = url.searchParams.get('ticket_id');
        const note =
          id === '10' ? [{ id: 1, ticket_id: 10, outcome: 'Resolved', note: 'Reset creds' }] : [];
        return { record_count: note.length, actions: note };
      },
    });
    const { ctx, passes, fails } = makeCtx({ variables });
    await incidentResponseCheck.run(ctx);

    expect(passes.map((p) => p.resourceId).sort()).toEqual(['halo-ticket-10', 'halo-ticket-13']);
    expect(passes.find((p) => p.resourceId === 'halo-ticket-10')?.evidence).toMatchObject({
      ticketId: 10,
      summary: 'Phish',
      hasResolutionNote: true,
    });
    const late = fails.find((f) => f.resourceId === 'halo-ticket-11');
    expect(late?.description).toContain('SLA 48h');
    expect(late?.description).toContain('no resolution note');
    expect(fails.find((f) => f.resourceId === 'halo-ticket-12')?.title).toContain(
      'open past its SLA',
    );
  });
});

describe('halopsa_access_review', () => {
  const variables = { access_review_ticket_type_ids: '22' };

  it('passes when a review closed in the window', async () => {
    halo.setRoutes({
      '/api/Tickets': tickets([
        {
          id: 30,
          client_id: 7,
          tickettype_id: 22,
          summary: 'Q3 review',
          dateoccurred: hoursAgo(24 * 120),
          dateclosed: hoursAgo(24 * 30),
        },
        {
          id: 31,
          client_id: 7,
          tickettype_id: 22,
          summary: 'Q1 review',
          dateclosed: hoursAgo(24 * 200),
        },
      ]),
    });
    const { ctx, passes, fails } = makeCtx({ variables });
    await accessReviewCheck.run(ctx);
    expect(fails).toHaveLength(0);
    expect(passes[0].evidence.closedReviews).toBe(1);
    expect(passes[0].title).toContain('#30');
  });

  it('fails when no review closed recently', async () => {
    halo.setRoutes({ '/api/Tickets': tickets([]) });
    const { ctx, passes, fails } = makeCtx({ variables });
    await accessReviewCheck.run(ctx);
    expect(passes).toHaveLength(0);
    expect(fails[0].title).toBe('No access review closed in the last 90 days');
    expect(fails[0].remediation.length).toBeGreaterThan(0);
  });
});

describe('halopsa_employee_access', () => {
  const variables = { joiner_leaver_ticket_type_ids: '23,24', joiner_leaver_max_hours: 24 };

  it('passes when there are no joiner/leaver tickets', async () => {
    halo.setRoutes({ '/api/Tickets': tickets([]) });
    const { ctx, passes } = makeCtx({ variables });
    await employeeAccessCheck.run(ctx);
    expect(passes[0].evidence.ticketCount).toBe(0);
  });

  it('evaluates closure time against the limit', async () => {
    halo.setRoutes({
      '/api/Tickets': tickets([
        {
          id: 40,
          client_id: 7,
          tickettype_id: 23,
          summary: 'Joiner',
          dateoccurred: hoursAgo(50),
          dateclosed: hoursAgo(40),
        },
        {
          id: 41,
          client_id: 7,
          tickettype_id: 24,
          summary: 'Leaver',
          dateoccurred: hoursAgo(100),
          dateclosed: hoursAgo(20),
        },
        {
          id: 42,
          client_id: 7,
          tickettype_id: 24,
          summary: 'Leaver open',
          dateoccurred: hoursAgo(30),
        },
      ]),
    });
    const { ctx, passes, fails } = makeCtx({ variables });
    await employeeAccessCheck.run(ctx);
    expect(passes.map((p) => p.resourceId)).toEqual(['halo-ticket-40']);
    expect(fails.map((f) => f.resourceId).sort()).toEqual(['halo-ticket-41', 'halo-ticket-42']);
    expect(fails.find((f) => f.resourceId === 'halo-ticket-41')?.evidence?.hoursTaken).toBe(80);
  });
});

describe('halopsa_change_management', () => {
  const variables = { change_ticket_type_ids: '25' };

  it('passes approved changes and fails unapproved ones', async () => {
    halo.setRoutes({
      '/api/Tickets': tickets([
        {
          id: 50,
          client_id: 7,
          tickettype_id: 25,
          summary: 'Firewall rule',
          dateoccurred: hoursAgo(10),
        },
        {
          id: 51,
          client_id: 7,
          tickettype_id: 25,
          summary: 'DNS change',
          dateoccurred: hoursAgo(10),
        },
      ]),
      '/api/Actions': (url) => {
        const actions =
          url.searchParams.get('ticket_id') === '50'
            ? [{ id: 5, ticket_id: 50, outcome: 'Approved', who: 'CAB' }]
            : [{ id: 6, ticket_id: 51, outcome: 'Approval Requested' }];
        return { record_count: actions.length, actions };
      },
    });
    const { ctx, passes, fails } = makeCtx({ variables });
    await changeManagementCheck.run(ctx);
    expect(passes.map((p) => p.resourceId)).toEqual(['halo-ticket-50']);
    expect(passes[0].evidence.approvals).toEqual([
      { actionId: 5, outcome: 'Approved', who: 'CAB', at: null },
    ]);
    expect(fails.map((f) => f.resourceId)).toEqual(['halo-ticket-51']);
  });
});
