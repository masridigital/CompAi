import { generateRefToken, REF_TOKEN_PATTERN } from './halopsa-ref-token';
import {
  buildCheckTicket,
  buildDeepLink,
  buildFindingTicket,
  buildResourceTable,
  escapeHtml,
  safeSummaryText,
} from './halopsa-ticket-content';

const base = {
  refToken: 'CAI-7Q2K9M4D',
  organizationId: 'org_abc123',
  organizationName: 'Acme <Corp>',
  frameworks: ['SOC 2', 'ISO 27001'],
};

describe('generateRefToken', () => {
  it('produces short unique Crockford tokens', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateRefToken()));
    expect(tokens.size).toBe(200);
    for (const token of tokens) expect(token).toMatch(REF_TOKEN_PATTERN);
  });
});

describe('escapeHtml', () => {
  it('escapes all HTML metacharacters', () => {
    expect(escapeHtml(`<script>alert("x")</script>&'`)).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;',
    );
  });
});

describe('buildCheckTicket', () => {
  it('escapes every interpolated value', () => {
    const { summary, details } = buildCheckTicket({
      ...base,
      checkName: 'MFA <img src=x onerror=alert(1)>',
      taskId: 'tsk_1',
      failingResources: [{ title: '<b>user</b>', resourceId: 'u"1', resourceType: "a'b" }],
      remediation: 'Enable <MFA> & retry',
    });
    expect(details).not.toContain('<img');
    expect(details).not.toContain('<b>user');
    expect(details).toContain('&lt;b&gt;user&lt;/b&gt;');
    expect(details).toContain('u&quot;1');
    expect(details).toContain('a&#39;b');
    expect(details).toContain('Enable &lt;MFA&gt; &amp; retry');
    expect(details).toContain('Acme &lt;Corp&gt;');
    expect(summary).toBe('[CompAI] MFA <img src=x onerror=alert(1)> failing (1 resource) [CAI-7Q2K9M4D]');
  });

  it('links to the task and keeps the ref token', () => {
    const { details } = buildCheckTicket({
      ...base,
      checkName: 'MFA',
      taskId: 'tsk_cm1abcdefghijklmnopqrstuvwx',
      failingResources: [],
    });
    expect(details).toContain('/org_abc123/tasks/tsk_cm1abcdefghijklmnopqrstuvwx');
    expect(details).toContain('CAI-7Q2K9M4D');
  });

  it('redacts secrets from resource text', () => {
    const { details } = buildCheckTicket({
      ...base,
      checkName: 'Keys',
      taskId: 'tsk_1',
      failingResources: [{ title: 'token=supersecretvalue', resourceId: 'admin@acme.com' }],
    });
    expect(details).not.toContain('supersecretvalue');
    expect(details).not.toContain('admin@acme.com');
  });
});

describe('buildResourceTable', () => {
  it('lists the first 50 resources then a count', () => {
    const resources = Array.from({ length: 73 }, (_, i) => ({ title: `res-${i}` }));
    const html = buildResourceTable(resources);
    expect(html.match(/<tr><td>/g)).toHaveLength(50);
    expect(html).toContain('res-49');
    expect(html).not.toContain('res-50<');
    expect(html).toContain('and 23 more failing resources');
  });

  it('returns nothing for no resources', () => {
    expect(buildResourceTable([])).toBe('');
  });
});

describe('buildFindingTicket', () => {
  it('includes severity and escapes the title', () => {
    const { summary, details } = buildFindingTicket({
      ...base,
      findingId: 'fnd_1',
      title: 'Missing <policy>',
      severity: 'high',
    });
    expect(summary).toContain('(high)');
    expect(details).toContain('Missing &lt;policy&gt;');
    expect(details).toContain('/org_abc123/overview/findings');
  });
});

describe('safeSummaryText / buildDeepLink', () => {
  it('collapses whitespace and truncates', () => {
    expect(safeSummaryText('a\n\nb   c')).toBe('a b c');
    expect(safeSummaryText('x'.repeat(200), 10)).toHaveLength(10);
  });

  it('drops unsafe path segments', () => {
    expect(buildDeepLink({ organizationId: 'org_1', path: ['tasks', '../x'], baseUrl: 'https://a.b' })).toBe(
      'https://a.b/org_1/tasks',
    );
  });
});
