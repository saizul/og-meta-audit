import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import {
  type AuditReport,
  audit,
  escapeHtml,
  escapeMarkdown,
  formatHtml,
  formatJson,
  formatMarkdown,
  formatReport,
  formatText,
} from '../src/index.js';
import { fakeFetch, fixture, html, image, pngBytes } from './helpers.js';

const E = 'https://example.com';
let report: AuditReport;

before(async () => {
  const fetch = fakeFetch({
    [`${E}/`]: html(fixture('home.html')),
    [`${E}/broken`]: html(
      fixture('broken.html').replace(
        '</head>',
        '<title>Fish & Chips <script>alert(1)</script></title></head>',
      ),
    ),
    [`${E}/a`]: html('<title>Same title for both pages here ok</title>'),
    [`${E}/b`]: html('<title>Same title for both pages here ok</title>'),
    [`${E}/img/og-home.png`]: image(pngBytes(1200, 630), 'image/png'),
  });
  report = await audit([`${E}/`, `${E}/broken`, `${E}/a`, `${E}/b`, `${E}/down`], { fetch });
});

describe('text report', () => {
  it('shows a table, findings per page and a summary line', () => {
    const out = formatText(report);
    assert.match(out, /^og-meta-audit 0\.1\.0/);
    assert.match(out, /Status\s+Err\s+Warn\s+Info\s+URL/);
    assert.match(out, /404\s+1\s+0\s+0\s+https:\/\/example\.com\/down/);
    assert.match(out, /error\s+canonical-multiple/);
    assert.match(out, /Across pages/);
    assert.match(out, /5 pages, \d+ errors, \d+ warnings, \d+ info in /);
    assert.doesNotMatch(out, /\u001b\[/);
  });

  it('uses colors only when asked', () => {
    assert.match(formatText(report, { color: true }), /\u001b\[31m/);
  });

  it('hides findings below the minimum severity', () => {
    const out = formatText(report, { minSeverity: 'error' });
    assert.doesNotMatch(out, /\binfo\s+lang-missing/);
    assert.match(out, /error\s+og-image-relative/);
  });

  it('shortens long URLs in the middle', () => {
    const long = {
      ...report,
      pages: [{ ...report.pages[0]!, url: `${E}/${'x'.repeat(300)}` }],
      siteFindings: [],
    };
    for (const line of formatText(long, { width: 80 }).split('\n')) assert.ok([...line].length <= 80, line);
  });
});

describe('JSON report', () => {
  it('round-trips the report', () => {
    const parsed = JSON.parse(formatJson(report));
    assert.equal(parsed.summary.pages, 5);
    assert.equal(parsed.pages[0].meta.title, report.pages[0]!.meta!.title);
    assert.equal(formatReport(report, 'json'), formatJson(report));
  });
});

describe('Markdown report', () => {
  it('has a summary table and escapes cells', () => {
    const out = formatMarkdown(report);
    assert.match(out, /^# Social metadata audit/);
    assert.match(out, /\| URL \| Status \| Title \| og:image \|/);
    assert.match(out, /yes \(1200x630\)/);
    assert.match(out, /Fish & Chips \\<script\\>/);
    assert.equal(escapeMarkdown('a|b*c_d\ne'), 'a\\|b\\*c\\_d e');
  });
});

describe('HTML report', () => {
  it('is a standalone document with escaped content and no scripts', () => {
    const out = formatHtml(report);
    assert.match(out, /^<!DOCTYPE html>/);
    assert.doesNotMatch(out, /<script/i);
    assert.match(out, /Fish &amp; Chips &lt;script&gt;/);
    assert.match(out, /1200x630/);
    assert.match(out, /<meta name="robots" content="noindex">/);
    assert.equal(formatReport(report, 'html'), out);
  });

  it('only links http(s) URLs', () => {
    const r = structuredClone(report);
    r.pages[0]!.url = 'javascript:alert(1)';
    assert.doesNotMatch(formatHtml(r), /href="javascript:/);
    assert.equal(escapeHtml(`<a href="x">'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&lt;/a&gt;');
  });
});
