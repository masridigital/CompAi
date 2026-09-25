import { Injectable, Logger } from '@nestjs/common';
import { db } from '@db';
import { HALO_MAX_ATTACHMENT_BYTES, parseHaloAlertSettings } from '@trycompai/integration-platform';
import { loadHaloOrgConnection, toVariableValues } from './halopsa-connection';
import { collectMonthlyReportData, reportMonth, type MonthlyReportData } from './halopsa-monthly-report-data';
import { renderMonthlyReportPdf } from './halopsa-monthly-report-pdf';
import { generateRefToken } from './halopsa-ref-token';
import { buildDeepLink, buildNote, escapeHtml, safeText } from './halopsa-ticket-content';
import { HALOPSA_PROVIDER_SLUG } from './halopsa.constants';

export type MonthlyReportOutcome = 'no_connection' | 'trigger_disabled' | 'already_sent' | 'too_large' | 'queued';

export function monthlyReportFilename({ organizationName, monthKey }: { organizationName: string; monthKey: string }) {
  const slug = organizationName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  return `compai-compliance-report-${slug || 'client'}-${monthKey}.pdf`;
}

function ticketDetails({ data, refToken }: { data: MonthlyReportData; refToken: string }): string {
  const score = data.latest ? `${data.latest.overallScore}%` : 'not available';
  const url = buildDeepLink({ organizationId: data.organizationId, path: ['overview'] });
  return [
    `<p>Monthly compliance report for <strong>${safeText(data.organizationName)}</strong> (${escapeHtml(data.monthLabel)}) is attached as a PDF.</p>`,
    `<p>Overall score: <strong>${escapeHtml(score)}</strong></p>`,
    `<p><a href="${escapeHtml(url)}">Open CompAI</a></p>`,
    `<p>Reference: ${escapeHtml(refToken)}</p>`,
  ].join('');
}

/**
 * Plan 5.1 (P3): monthly posture PDF attached to a Halo ticket. Queues
 * create_ticket -> attach_file -> set_status (when a resolved status is
 * configured) on one link; the outbox keeps that order.
 */
@Injectable()
export class HaloMonthlyReportService {
  private readonly logger = new Logger(HaloMonthlyReportService.name);

  async listReportOrganizations(): Promise<string[]> {
    const connections = await db.integrationConnection.findMany({
      where: { status: 'active', provider: { slug: HALOPSA_PROVIDER_SLUG } },
      select: { organizationId: true, variables: true },
    });
    const ids = connections
      .filter((c) => parseHaloAlertSettings(toVariableValues(c.variables)).enabledTriggers.includes('monthly_report'))
      .map((c) => c.organizationId);
    return [...new Set(ids)];
  }

  async runForOrganization({
    organizationId,
    now = new Date(),
    render = renderMonthlyReportPdf,
  }: {
    organizationId: string;
    now?: Date;
    render?: (data: MonthlyReportData) => Buffer;
  }): Promise<MonthlyReportOutcome> {
    const halo = await loadHaloOrgConnection(organizationId);
    if (!halo) return 'no_connection';
    const { connection, settings } = halo;
    if (!settings.enabledTriggers.includes('monthly_report')) return 'trigger_disabled';

    const month = reportMonth(now);
    const dedupKey = `monthly_report:${month.key}`;
    const existing = await db.haloTicketLink.findUnique({
      where: { organizationId_dedupKey: { organizationId, dedupKey } },
      select: { id: true },
    });
    if (existing) return 'already_sent';

    const data = await collectMonthlyReportData({ organizationId, now });
    const pdf = render(data);
    if (pdf.length > HALO_MAX_ATTACHMENT_BYTES) {
      this.logger.warn(`Monthly report for ${organizationId} is ${pdf.length} bytes; over the 10 MB limit`);
      return 'too_large';
    }

    const refToken = generateRefToken();
    const summary = `[CompAI] Monthly compliance report ${month.label} [${refToken}]`;
    const filename = monthlyReportFilename({ organizationName: data.organizationName, monthKey: month.key });
    // Explicit, increasing createdAt so the drain sends create -> attach -> close.
    const at = (offsetMs: number) => new Date(now.getTime() + offsetMs);

    await db.$transaction(async (tx) => {
      const link = await tx.haloTicketLink.create({
        data: {
          organizationId,
          connectionId: connection.id,
          entityType: 'report',
          entityId: month.key,
          dedupKey,
          refToken,
          lastEventAt: now,
        },
      });
      const base = { organizationId, linkId: link.id, nextAttemptAt: now };
      await tx.haloOutboxEvent.create({
        data: {
          ...base,
          kind: 'create_ticket',
          createdAt: at(0),
          payload: {
            summary,
            details: ticketDetails({ data, refToken }),
            priorityId: settings.priorityMap.low,
            ...(settings.ticketTypeId ? { ticketTypeId: settings.ticketTypeId } : {}),
            ...(settings.teamId ? { teamId: settings.teamId } : {}),
            ...(settings.agentId ? { agentId: settings.agentId } : {}),
          },
        },
      });
      await tx.haloOutboxEvent.create({
        data: { ...base, kind: 'attach_file', createdAt: at(1), payload: { filename, base64: pdf.toString('base64') } },
      });
      if (settings.resolvedStatusId) {
        await tx.haloOutboxEvent.create({
          data: {
            ...base,
            kind: 'set_status',
            createdAt: at(2),
            payload: {
              statusId: settings.resolvedStatusId,
              note: buildNote([`Monthly report for ${month.label} delivered.`]),
              afterPrior: true,
              markLinkResolved: true,
            },
          },
        });
      }
    });
    return 'queued';
  }
}
