// Audits the URLs given on the command line and prints a short summary per
// page, then writes an HTML report. Run after `npm run build`:
//   node examples/audit-site.mjs https://example.com/ https://example.com/about/
import { writeFileSync } from 'node:fs';
import { audit, exitCodeFor, formatHtml } from '../dist/esm/index.js';

const urls = process.argv.slice(2);
if (urls.length === 0) {
  console.error('usage: node examples/audit-site.mjs <url> [url ...]');
  process.exit(2);
}

const report = await audit(urls, {
  concurrency: 4,
  timeoutMs: 10_000,
  rules: { 'apple-touch-icon-missing': 'off', 'title-length': ['warn', { max: 65 }] },
});

for (const page of report.pages) {
  const errors = page.findings.filter((f) => f.severity === 'error').length;
  console.log(`${page.status ?? 'fail'}  ${errors} errors  ${page.url}`);
}
writeFileSync('og-report.html', formatHtml(report));
console.log('Wrote og-report.html');
process.exitCode = exitCodeFor(report, 'error');
