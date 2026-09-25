import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { redactSecrets } from '../utils/redact-secrets';
import type { MonthlyReportData, ReportListItem } from './halopsa-monthly-report-data';

type Rgb = [number, number, number];
const INK: Rgb = [33, 33, 33];
const MUTED: Rgb = [110, 110, 110];
const ACCENT: Rgb = [0, 77, 61];
const HAIRLINE: Rgb = [223, 223, 223];

interface JsPdfWithAutoTable extends jsPDF {
  lastAutoTable?: { finalY: number };
}

/** jsPDF's built-in fonts are Latin-1 only; drop anything else. */
function pdfText(value: string): string {
  return redactSecrets(value)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
}

/** Render the monthly posture report. Returns the PDF bytes. */
export function renderMonthlyReportPdf(data: MonthlyReportData): Buffer {
  const pdf: JsPdfWithAutoTable = new jsPDF({ unit: 'mm', format: 'a4' });
  const margin = 16;
  const width = pdf.internal.pageSize.getWidth() - margin * 2;
  let y = 22;
  const finalY = () => pdf.lastAutoTable?.finalY ?? y;

  pdf.setTextColor(...ACCENT);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(18);
  pdf.text('Monthly compliance report', margin, y);
  y += 8;
  pdf.setTextColor(...INK);
  pdf.setFontSize(12);
  pdf.text(pdfText(`${data.organizationName} - ${data.monthLabel}`), margin, y);
  y += 6;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(...MUTED);
  pdf.text(`Generated ${data.generatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`, margin, y);
  y += 8;

  const table = (title: string, head: string[], body: string[][]) => {
    if (y > 260) {
      pdf.addPage();
      y = 20;
    }
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.setTextColor(...INK);
    pdf.text(title, margin, y);
    y += 2;
    autoTable(pdf, {
      startY: y,
      margin: { left: margin, right: margin, bottom: 16 },
      theme: 'grid',
      head: [head],
      body: body.length ? body : [[`None`, ...head.slice(1).map(() => '')]],
      headStyles: { fillColor: ACCENT, textColor: [255, 255, 255], fontSize: 9 },
      styles: { fontSize: 9, cellPadding: 2, lineColor: HAIRLINE, lineWidth: 0.1, overflow: 'linebreak' },
      tableWidth: width,
    });
    y = finalY() + 8;
  };

  const latest = data.latest;
  table(
    'Summary',
    ['Metric', 'Value'],
    [
      ['Overall score', latest ? `${latest.overallScore}%` : 'No snapshot yet'],
      ['Failing checks', String(latest?.failingChecks ?? data.failingChecks.length)],
      ['Overdue tasks', String(latest?.overdueTasks ?? data.overdueTasks.length)],
      ['Open findings', String(latest?.openFindings ?? data.openFindings.length)],
      ['Evidence expiring in 30 days', String(latest?.evidenceExpiring30d ?? data.expiringEvidence.length)],
    ],
  );
  table(
    'Framework scores',
    ['Framework', 'Score'],
    (latest?.frameworkScores ?? []).map((f) => [pdfText(f.name), `${f.score}%`]),
  );
  table(
    '30-day trend',
    ['Date', 'Overall score'],
    data.trend.map((point) => [point.date, `${point.overallScore}%`]),
  );

  const list = (items: ReportListItem[]) => items.map((i) => [pdfText(i.title), pdfText(i.detail ?? '')]);
  table('Failing checks', ['Task', 'Last run'], list(data.failingChecks));
  table('Overdue tasks', ['Task', 'Due'], list(data.overdueTasks));
  table('Open findings', ['Finding', 'Severity'], list(data.openFindings));
  table('Evidence expiring in 30 days', ['Task', 'Review date'], list(data.expiringEvidence));

  return Buffer.from(pdf.output('arraybuffer'));
}
