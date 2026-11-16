// The audit pipeline: fetch pages with a concurrency limit, extract metadata,
// probe images, run page rules, then run site rules over all pages.

import { type AuditOptions, DEFAULTS } from './config.js';
import { ogImageUrl, extractMeta, twitterImageUrl } from './extract.js';
import { decodeText, type FetchOptions, fetchBytes } from './fetcher.js';
import { ImageCache } from './image/probe.js';
import { mapLimit } from './pool.js';
import {
  atLeast,
  compareSeverity,
  type ResolvedRule,
  resolveRules,
  runPageRules,
  runSiteRules,
} from './rules/index.js';
import type { AuditReport, AuditSummary, FetchLike, Finding, PageResult, Severity } from './types.js';
import { VERSION } from './version.js';

function resolveFetch(fetchImpl: FetchLike | undefined): FetchLike {
  const f = fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
  if (!f) throw new Error('No fetch implementation available. Use Node 20+ or pass options.fetch.');
  return f;
}

/** Image URLs worth probing on a page: og:image, twitter:image, and the first entity image and logo. */
export function imageTargets(page: PageResult): string[] {
  if (!page.meta) return [];
  const base = page.finalUrl ?? page.url;
  const targets = new Set<string>();
  const og = ogImageUrl(page.meta, base);
  if (og) targets.add(og);
  const tw = twitterImageUrl(page.meta, base);
  if (tw) targets.add(tw);
  for (const e of page.meta.entities) {
    if (e.images[0]) targets.add(e.images[0]);
    if (e.logos[0]) targets.add(e.logos[0]);
  }
  return [...targets].filter((u) => /^https?:\/\//.test(u));
}

/** Fetches one page and extracts its metadata. Never throws. */
export async function fetchPage(url: string, opts: FetchOptions, maxBytes: number): Promise<PageResult> {
  const page: PageResult = { url, ok: false, redirected: false, images: {}, findings: [] };
  try {
    const res = await fetchBytes(
      url,
      { ...opts, headers: { accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', ...opts.headers } },
      maxBytes,
    );
    page.status = res.status;
    page.ok = res.ok;
    page.finalUrl = res.finalUrl;
    page.redirected = res.redirected;
    page.timeMs = res.timeMs;
    if (res.contentType) page.contentType = res.contentType;
    const robots = res.headers.get('x-robots-tag');
    if (robots) page.robotsHeader = robots;
    if (!res.ok) {
      page.error = `HTTP ${res.status}`;
      return page;
    }
    if (!res.contentType || /html|xml/.test(res.contentType)) {
      page.meta = extractMeta(decodeText(res.bytes, res.contentType), res.finalUrl);
    }
  } catch (err) {
    page.error = err instanceof Error ? err.message : String(err);
  }
  return page;
}

/** Counts findings by severity and rule. */
export function summarize(pages: PageResult[], siteFindings: Finding[]): AuditSummary {
  const summary: AuditSummary = {
    pages: pages.length,
    failedPages: pages.filter((p) => !p.ok).length,
    errors: 0,
    warnings: 0,
    infos: 0,
    byRule: {},
  };
  for (const f of [...pages.flatMap((p) => p.findings), ...siteFindings]) {
    if (f.severity === 'error') summary.errors++;
    else if (f.severity === 'warn') summary.warnings++;
    else summary.infos++;
    summary.byRule[f.rule] = (summary.byRule[f.rule] ?? 0) + 1;
  }
  return summary;
}

function sortFindings(findings: Finding[]): Finding[] {
  return findings.sort((a, b) => compareSeverity(b.severity, a.severity) || a.rule.localeCompare(b.rule));
}

/**
 * Audits a list of page URLs and returns a report. Pages are fetched with at
 * most `concurrency` requests at a time; images shared between pages are
 * downloaded once.
 */
export async function audit(urls: readonly string[], options: AuditOptions = {}): Promise<AuditReport> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const resolved: ResolvedRule[] = resolveRules(options.rules);
  const fetchOpts: FetchOptions = {
    fetch: resolveFetch(options.fetch),
    timeoutMs: options.timeoutMs ?? DEFAULTS.timeoutMs,
    userAgent: options.userAgent ?? DEFAULTS.userAgent,
  };
  if (options.headers) fetchOpts.headers = options.headers;
  const checkImages = options.checkImages ?? DEFAULTS.checkImages;
  const images = new ImageCache({
    ...fetchOpts,
    method: options.imageMethod ?? DEFAULTS.imageMethod,
    maxBytes: options.maxImageBytes ?? DEFAULTS.maxImageBytes,
  });
  const unique = [...new Set(urls)];
  let done = 0;

  const pages = await mapLimit(unique, options.concurrency ?? DEFAULTS.concurrency, async (url) => {
    const page = await fetchPage(url, fetchOpts, options.maxHtmlBytes ?? DEFAULTS.maxHtmlBytes);
    if (checkImages && page.meta) {
      const targets = imageTargets(page);
      const infos = await Promise.all(targets.map((t) => images.get(t)));
      targets.forEach((t, i) => {
        page.images[t] = infos[i]!;
      });
    }
    page.findings = sortFindings(runPageRules(page, resolved));
    done++;
    options.onPage?.(done, unique.length, url);
    return page;
  });

  const siteFindings = sortFindings(runSiteRules(pages, resolved));
  return {
    tool: { name: 'og-meta-audit', version: VERSION },
    startedAt,
    durationMs: Date.now() - started,
    pages,
    siteFindings,
    summary: summarize(pages, siteFindings),
  };
}

/** Audits a single HTML string without any network access, except for images when `checkImages` is on. */
export async function auditHtml(html: string, url: string, options: AuditOptions = {}): Promise<PageResult> {
  const fake: FetchLike = async (input) => {
    if (input === url)
      return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    if (options.fetch) return options.fetch(input);
    return resolveFetch(undefined)(input);
  };
  const report = await audit([url], {
    ...options,
    fetch: fake,
    checkImages: options.checkImages ?? !!options.fetch,
  });
  return report.pages[0]!;
}

/** All findings of a report, page findings first. */
export function allFindings(report: AuditReport): Finding[] {
  return [...report.pages.flatMap((p) => p.findings), ...report.siteFindings];
}

/**
 * The process exit code for a report: 1 when any finding is at least as
 * serious as `failOn`, otherwise 0. `never` always gives 0.
 */
export function exitCodeFor(report: AuditReport, failOn: Severity | 'never' = 'error'): number {
  if (failOn === 'never') return 0;
  return allFindings(report).some((f) => atLeast(f.severity, failOn)) ? 1 : 0;
}
