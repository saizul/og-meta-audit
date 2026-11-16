// Terminal output: a summary table of pages, then findings per page.

import type { AuditReport, Finding, Severity } from '../types.js';
import { countBySeverity, formatDuration, headline, type ReportOptions, visible } from './common.js';

export interface TextReportOptions extends ReportOptions {
  /** Use ANSI colors. Default false. */
  color?: boolean;
  /** Maximum line width. Long URLs and messages are shortened. Default 120. */
  width?: number;
}

const CODES = { red: 31, yellow: 33, cyan: 36, green: 32, gray: 90, bold: 1 } as const;
type ColorName = keyof typeof CODES;

function painter(enabled: boolean) {
  return (color: ColorName, text: string) => (enabled ? `\u001b[${CODES[color]}m${text}\u001b[0m` : text);
}

const SEVERITY_COLOR: Record<Severity, ColorName> = { error: 'red', warn: 'yellow', info: 'cyan' };
const SEVERITY_LABEL: Record<Severity, string> = { error: 'error', warn: 'warn ', info: 'info ' };

/** Shortens text to `max` characters with an ellipsis in the middle (for URLs) or at the end. */
export function shorten(text: string, max: number, middle = false): string {
  const chars = [...text];
  if (chars.length <= max) return text;
  if (max <= 1) return '\u2026';
  if (!middle) return `${chars.slice(0, max - 1).join('')}\u2026`;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${chars.slice(0, head).join('')}\u2026${chars.slice(chars.length - tail).join('')}`;
}

function pad(text: string, width: number): string {
  const len = [...text].length;
  return len >= width ? text : text + ' '.repeat(width - len);
}

/** Renders a plain table. Each row is an array of cells; the last column takes the remaining width. */
export function table(rows: string[][], maxWidth: number): string[] {
  if (rows.length === 0) return [];
  const cols = rows[0]!.length;
  const widths = Array.from({ length: cols }, (_, c) =>
    Math.max(...rows.map((r) => [...(r[c] ?? '')].length)),
  );
  const fixed = widths.slice(0, -1).reduce((a, b) => a + b + 2, 0);
  widths[cols - 1] = Math.max(10, Math.min(widths[cols - 1]!, maxWidth - fixed));
  return rows.map((r) =>
    r
      .map((cell, c) => (c === cols - 1 ? shorten(cell, widths[c]!, true) : pad(cell, widths[c]!)))
      .join('  ')
      .trimEnd(),
  );
}

function findingLines(findings: Finding[], paint: ReturnType<typeof painter>, width: number): string[] {
  const ruleWidth = Math.min(32, Math.max(...findings.map((f) => f.rule.length)));
  return findings.map((f) => {
    const label = paint(SEVERITY_COLOR[f.severity], SEVERITY_LABEL[f.severity]);
    const rule = paint('gray', pad(f.rule, ruleWidth));
    const room = Math.max(20, width - ruleWidth - 12);
    let line = `  ${label}  ${rule}  ${shorten(f.message, room)}`;
    if (f.related && f.related.length > 0) {
      const more = f.related
        .map((r) => `\n      ${paint('gray', '+')} ${shorten(r, width - 8, true)}`)
        .join('');
      line += more;
    }
    return line;
  });
}

/** Formats a report for a terminal. */
export function formatText(report: AuditReport, options: TextReportOptions = {}): string {
  const paint = painter(options.color ?? false);
  const width = Math.max(60, options.width ?? 120);
  const min = options.minSeverity ?? 'info';
  const out: string[] = [];

  out.push(paint('bold', `${report.tool.name} ${report.tool.version}`));
  out.push('');

  const rows = [['Status', 'Err', 'Warn', 'Info', 'URL']];
  for (const p of report.pages) {
    const c = countBySeverity(p.findings);
    rows.push([
      p.status === undefined ? 'fail' : String(p.status),
      String(c.error),
      String(c.warn),
      String(c.info),
      p.url,
    ]);
  }
  const lines = table(rows, width);
  out.push(paint('bold', lines[0]!));
  for (let i = 1; i < lines.length; i++) {
    const p = report.pages[i - 1]!;
    const c = countBySeverity(p.findings);
    const color: ColorName = !p.ok || c.error > 0 ? 'red' : c.warn > 0 ? 'yellow' : 'green';
    out.push(paint(color, lines[i]!));
  }

  for (const p of report.pages) {
    const shown = visible(p.findings, min);
    if (shown.length === 0) continue;
    out.push('');
    out.push(paint('bold', shorten(p.url, width, true)));
    if (p.finalUrl && p.finalUrl !== p.url)
      out.push(paint('gray', `  -> ${shorten(p.finalUrl, width - 5, true)}`));
    out.push(...findingLines(shown, paint, width));
  }

  const site = visible(report.siteFindings, min);
  if (site.length > 0) {
    out.push('');
    out.push(paint('bold', 'Across pages'));
    // List every page involved under the finding, starting with the first one.
    out.push(
      ...findingLines(
        site.map((f) => ({ ...f, related: [f.url, ...(f.related ?? [])] })),
        paint,
        width,
      ),
    );
  }

  out.push('');
  const s = report.summary;
  const color: ColorName = s.errors > 0 ? 'red' : s.warnings > 0 ? 'yellow' : 'green';
  out.push(paint(color, `${headline(report)} in ${formatDuration(report.durationMs)}`));
  return `${out.join('\n')}\n`;
}
