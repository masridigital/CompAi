import { redactSecrets } from '../utils/redact-secrets';
import { appBaseUrl, HALO_MAX_LISTED_RESOURCES } from './halopsa.constants';

/**
 * Halo ticket content (plan 6.5). Every interpolated value is redacted with
 * `redactSecrets` and then HTML-escaped; only the deep link (built from our
 * own IDs) bypasses redaction because the token pattern would mangle CUIDs.
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/** Redact, then escape. Use for every untrusted value placed into HTML. */
export function safeText(value: string | null | undefined): string {
  return escapeHtml(redactSecrets(value ?? ''));
}

/** Plain-text value for the ticket summary: redacted, single line, bounded. */
export function safeSummaryText(value: string | null | undefined, max = 120): string {
  const text = redactSecrets(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/** Deep link into the CompAI app. IDs are validated, never redacted. */
export function buildDeepLink({
  organizationId,
  path,
  baseUrl = appBaseUrl(),
}: {
  organizationId: string;
  path: Array<string>;
  baseUrl?: string;
}): string {
  const segments = [organizationId, ...path].filter((s) => SAFE_ID.test(s));
  return `${baseUrl}/${segments.map(encodeURIComponent).join('/')}`;
}

export interface FailingResource {
  title: string;
  resourceId?: string | null;
  resourceType?: string | null;
}

export function buildResourceTable(resources: FailingResource[]): string {
  if (resources.length === 0) return '';
  const listed = resources.slice(0, HALO_MAX_LISTED_RESOURCES);
  const rows = listed
    .map(
      (r) =>
        `<tr><td>${safeText(r.title)}</td><td>${safeText(r.resourceType)}</td><td>${safeText(r.resourceId)}</td></tr>`,
    )
    .join('');
  const remaining = resources.length - listed.length;
  const more =
    remaining > 0 ? `<p>…and ${remaining} more failing resource${remaining === 1 ? '' : 's'}.</p>` : '';
  return `<table><thead><tr><th>Resource</th><th>Type</th><th>ID</th></tr></thead><tbody>${rows}</tbody></table>${more}`;
}

function contextBlock({
  organizationName,
  frameworks,
}: {
  organizationName: string;
  frameworks: string[];
}): string {
  const frameworkText = frameworks.length ? frameworks.map(safeText).join(', ') : 'None';
  return `<p><strong>Client:</strong> ${safeText(organizationName)}<br/><strong>Frameworks affected:</strong> ${frameworkText}</p>`;
}

function linkBlock({ url, label }: { url: string; label: string }): string {
  return `<p><a href="${escapeHtml(url)}">${escapeHtml(label)}</a></p>`;
}

export interface TicketContent {
  summary: string;
  details: string;
}

export function buildCheckTicket(input: {
  refToken: string;
  organizationId: string;
  organizationName: string;
  frameworks: string[];
  checkName: string;
  taskId: string;
  failingResources: FailingResource[];
  remediation?: string | null;
}): TicketContent {
  const count = input.failingResources.length;
  const summary = `[CompAI] ${safeSummaryText(input.checkName)} failing (${count} resource${count === 1 ? '' : 's'}) [${input.refToken}]`;
  const url = buildDeepLink({ organizationId: input.organizationId, path: ['tasks', input.taskId] });
  const details = [
    `<p>The CompAI integration check <strong>${safeText(input.checkName)}</strong> is failing.</p>`,
    contextBlock(input),
    buildResourceTable(input.failingResources),
    input.remediation ? `<p><strong>Remediation:</strong> ${safeText(input.remediation)}</p>` : '',
    linkBlock({ url, label: 'Open the task in CompAI' }),
    `<p>Reference: ${escapeHtml(input.refToken)}</p>`,
  ].join('');
  return { summary, details };
}

export function buildFindingTicket(input: {
  refToken: string;
  organizationId: string;
  organizationName: string;
  frameworks: string[];
  findingId: string;
  title: string;
  severity: string;
  description?: string | null;
}): TicketContent {
  const summary = `[CompAI] Finding: ${safeSummaryText(input.title)} (${safeSummaryText(input.severity, 20)}) [${input.refToken}]`;
  const url = buildDeepLink({ organizationId: input.organizationId, path: ['overview', 'findings'] });
  const details = [
    `<p>A new <strong>${safeText(input.severity)}</strong> finding was raised in CompAI: <strong>${safeText(input.title)}</strong></p>`,
    contextBlock(input),
    input.description ? `<p>${safeText(input.description)}</p>` : '',
    linkBlock({ url, label: 'Open the finding in CompAI' }),
    `<p>Reference: ${escapeHtml(input.refToken)}</p>`,
  ].join('');
  return { summary, details };
}

export function buildDeviceTicket(input: {
  refToken: string;
  organizationId: string;
  organizationName: string;
  frameworks: string[];
  deviceName: string;
  nonCompliantSince: Date;
  failingChecks: string[];
}): TicketContent {
  const summary = `[CompAI] Device noncompliant: ${safeSummaryText(input.deviceName)} [${input.refToken}]`;
  const url = buildDeepLink({ organizationId: input.organizationId, path: ['people', 'devices'] });
  const checks = input.failingChecks.length
    ? `<ul>${input.failingChecks.map((c) => `<li>${safeText(c)}</li>`).join('')}</ul>`
    : '';
  const details = [
    `<p>Device <strong>${safeText(input.deviceName)}</strong> has been noncompliant since ${escapeHtml(input.nonCompliantSince.toISOString())}.</p>`,
    contextBlock(input),
    checks,
    linkBlock({ url, label: 'Open devices in CompAI' }),
    `<p>Reference: ${escapeHtml(input.refToken)}</p>`,
  ].join('');
  return { summary, details };
}

export function buildNote(lines: string[]): string {
  return lines.map((line) => `<p>${safeText(line)}</p>`).join('');
}
