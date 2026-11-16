// Markdown output, suitable for pull request comments and job summaries.

import { ogImageUrl } from '../extract.js';
import type { AuditReport, Finding } from '../types.js';
import { countBySeverity, formatDuration, headline, type ReportOptions, visible } from './common.js';

/** Escapes text for a Markdown table cell or inline text. */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/([*_`[\]<>])/g, '\\$1')
    .replace(/\r?\n/g, ' ');
}

const LABEL = { error: '**error**', warn: 'warn', info: 'info' } as const;

function findingRow(f: Finding): string {
  const related = f.related?.length ? `<br>also: ${f.related.map(escapeMarkdown).join(', ')}` : '';
  return `| ${LABEL[f.severity]} | \`${f.rule}\` | ${escapeMarkdown(f.message)}${related} |`;
}

/** Formats a report as GitHub-flavoured Markdown. */
export function formatMarkdown(report: AuditReport, options: ReportOptions = {}): string {
  const min = options.minSeverity ?? 'info';
  const out: string[] = [];
  out.push('# Social metadata audit');
  out.push('');
  out.push(`${headline(report)}. Checked in ${formatDuration(report.durationMs)} on ${report.startedAt}.`);
  out.push('');
  out.push('| URL | Status | Title | og:image | Errors | Warnings | Info |');
  out.push('| --- | --- | --- | --- | ---: | ---: | ---: |');
  for (const p of report.pages) {
    const c = countBySeverity(p.findings);
    const og = p.meta ? ogImageUrl(p.meta, p.finalUrl ?? p.url) : undefined;
    const img = og ? p.images[og] : undefined;
    const size = img?.width && img.height ? ` (${img.width}x${img.height})` : '';
    out.push(
      `| ${escapeMarkdown(p.url)} | ${p.status ?? 'failed'} | ${escapeMarkdown(p.meta?.title ?? '')} | ${og ? 'yes' : 'no'}${size} | ${c.error} | ${c.warn} | ${c.info} |`,
    );
  }

  for (const p of report.pages) {
    const shown = visible(p.findings, min);
    if (shown.length === 0) continue;
    out.push('');
    out.push(`## ${escapeMarkdown(p.url)}`);
    out.push('');
    out.push('| Severity | Rule | Message |');
    out.push('| --- | --- | --- |');
    out.push(...shown.map(findingRow));
  }

  const site = visible(report.siteFindings, min);
  if (site.length > 0) {
    out.push('');
    out.push('## Across pages');
    out.push('');
    out.push('| Severity | Rule | Message |');
    out.push('| --- | --- | --- |');
    out.push(...site.map((f) => findingRow({ ...f, related: [f.url, ...(f.related ?? [])] })));
  }
  return `${out.join('\n')}\n`;
}
