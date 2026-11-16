// A self-contained HTML report: no scripts, no external assets. Images are
// shown with their URL only, so opening the report makes no requests.

import { first, ogImageUrl } from '../extract.js';
import type { AuditReport, Finding, PageResult } from '../types.js';
import { countBySeverity, formatDuration, headline, type ReportOptions, visible } from './common.js';

/** Escapes text for HTML element content and quoted attribute values. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only http(s) links become clickable. */
function link(url: string): string {
  const safe = /^https?:\/\//i.test(url);
  return safe
    ? `<a href="${escapeHtml(url)}" rel="noopener noreferrer">${escapeHtml(url)}</a>`
    : escapeHtml(url);
}

const STYLE = `
:root{color-scheme:light dark;--fg:#1d1d1f;--bg:#fff;--muted:#6e6e73;--line:#d2d2d7;--err:#c62828;--warn:#9a6700;--info:#0b62a4;--ok:#1b7f3b}
@media (prefers-color-scheme:dark){:root{--fg:#f5f5f7;--bg:#111;--muted:#a1a1a6;--line:#3a3a3c;--err:#ff6b6b;--warn:#f0b429;--info:#5eb1ff;--ok:#4cd07d}}
body{font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--fg);background:var(--bg);margin:0 auto;max-width:1100px;padding:24px}
h1{font-size:24px;margin:0 0 4px}h2{font-size:17px;margin:32px 0 8px;word-break:break-all}
.muted{color:var(--muted)}table{border-collapse:collapse;width:100%;margin:8px 0}
th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
th{font-weight:600}td.num{text-align:right;font-variant-numeric:tabular-nums}
.sev{font-weight:600;text-transform:uppercase;font-size:12px;white-space:nowrap}
.error{color:var(--err)}.warn{color:var(--warn)}.info{color:var(--info)}.ok{color:var(--ok)}
code{font:13px ui-monospace,SFMono-Regular,Menlo,monospace}a{color:inherit}
.cards{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}.card{border:1px solid var(--line);border-radius:10px;padding:10px 16px;min-width:110px}
.card b{display:block;font-size:22px}dl{display:grid;grid-template-columns:max-content 1fr;gap:2px 16px;margin:8px 0}
dt{color:var(--muted)}dd{margin:0;word-break:break-word}
`;

function findingTable(findings: Finding[], withPage = false): string {
  const rows = findings
    .map((f) => {
      const related = f.related?.length
        ? `<div class="muted">also: ${f.related.map(link).join(', ')}</div>`
        : '';
      const page = withPage ? `<div class="muted">${link(f.url)}</div>` : '';
      return `<tr><td class="sev ${f.severity}">${f.severity}</td><td><code>${escapeHtml(f.rule)}</code></td><td>${escapeHtml(f.message)}${page}${related}</td></tr>`;
    })
    .join('\n');
  return `<table><thead><tr><th>Severity</th><th>Rule</th><th>Message</th></tr></thead><tbody>\n${rows}\n</tbody></table>`;
}

function pageDetails(p: PageResult): string {
  if (!p.meta) return '';
  const base = p.finalUrl ?? p.url;
  const og = ogImageUrl(p.meta, base);
  const img = og ? p.images[og] : undefined;
  const items: [string, string][] = [
    ['Title', escapeHtml(p.meta.title ?? '-')],
    ['Description', escapeHtml(p.meta.description ?? '-')],
    ['Canonical', p.meta.canonical ? link(p.meta.canonical) : '-'],
    ['og:title', escapeHtml(first(p.meta.og, 'og:title') ?? '-')],
    ['og:image', og ? link(og) : '-'],
  ];
  if (img) {
    const parts = [
      img.ok ? 'loads' : `fails (${escapeHtml(img.error ?? 'error')})`,
      img.contentType ? escapeHtml(img.contentType) : '',
      img.width && img.height ? `${img.width}x${img.height}` : '',
      img.bytes ? `${Math.round(img.bytes / 1024)} KB` : '',
    ].filter(Boolean);
    items.push(['Image check', parts.join(', ')]);
  }
  items.push(['twitter:card', escapeHtml(first(p.meta.twitter, 'twitter:card') ?? '-')]);
  if (p.meta.entities.length > 0) {
    items.push([
      'JSON-LD entities',
      p.meta.entities.map((e) => `${e.type}: ${escapeHtml(e.name ?? e.id ?? 'unnamed')}`).join('<br>'),
    ]);
  }
  return `<dl>${items.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
}

/** Formats a report as a standalone HTML document. */
export function formatHtml(report: AuditReport, options: ReportOptions = {}): string {
  const min = options.minSeverity ?? 'info';
  const s = report.summary;
  const summaryRows = report.pages
    .map((p) => {
      const c = countBySeverity(p.findings);
      const cls = !p.ok || c.error > 0 ? 'error' : c.warn > 0 ? 'warn' : 'ok';
      return `<tr><td class="${cls}">${p.status ?? 'failed'}</td><td>${link(p.url)}</td><td class="num">${c.error}</td><td class="num">${c.warn}</td><td class="num">${c.info}</td></tr>`;
    })
    .join('\n');

  const sections = report.pages
    .map((p) => {
      const shown = visible(p.findings, min);
      return `<section><h2>${link(p.url)}</h2>${pageDetails(p)}${shown.length ? findingTable(shown) : '<p class="ok">No findings.</p>'}</section>`;
    })
    .join('\n');

  const site = visible(report.siteFindings, min);
  const siteSection = site.length
    ? `<section><h2>Across pages</h2>${findingTable(site, true)}</section>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Social metadata audit: ${escapeHtml(headline(report))}</title>
<style>${STYLE}</style>
</head>
<body>
<h1>Social metadata audit</h1>
<p class="muted">${escapeHtml(report.tool.name)} ${escapeHtml(report.tool.version)}, ${escapeHtml(report.startedAt)}, ${formatDuration(report.durationMs)}</p>
<div class="cards">
<div class="card"><b>${s.pages}</b>pages</div>
<div class="card error"><b>${s.errors}</b>errors</div>
<div class="card warn"><b>${s.warnings}</b>warnings</div>
<div class="card info"><b>${s.infos}</b>info</div>
</div>
<table><thead><tr><th>Status</th><th>URL</th><th>Errors</th><th>Warnings</th><th>Info</th></tr></thead><tbody>
${summaryRows}
</tbody></table>
${siteSection}
${sections}
</body>
</html>
`;
}
