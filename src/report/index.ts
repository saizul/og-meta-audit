import type { AuditReport } from '../types.js';
import type { ReportOptions } from './common.js';
import { formatHtml } from './html.js';
import { formatMarkdown } from './markdown.js';
import { formatText, type TextReportOptions } from './text.js';

export type { ReportOptions } from './common.js';
export { escapeHtml, formatHtml } from './html.js';
export { escapeMarkdown, formatMarkdown } from './markdown.js';
export { formatText, type TextReportOptions } from './text.js';

export type ReportFormat = 'text' | 'json' | 'markdown' | 'html';

export const REPORT_FORMATS: readonly ReportFormat[] = ['text', 'json', 'markdown', 'html'];

/** Formats a report as JSON. The structure is the AuditReport type. */
export function formatJson(report: AuditReport, options: { pretty?: boolean } = {}): string {
  return `${JSON.stringify(report, null, options.pretty === false ? undefined : 2)}\n`;
}

/** Formats a report in any of the supported formats. */
export function formatReport(
  report: AuditReport,
  format: ReportFormat,
  options: TextReportOptions = {},
): string {
  switch (format) {
    case 'json':
      return formatJson(report);
    case 'markdown':
      return formatMarkdown(report, options as ReportOptions);
    case 'html':
      return formatHtml(report, options as ReportOptions);
    default:
      return formatText(report, options);
  }
}
