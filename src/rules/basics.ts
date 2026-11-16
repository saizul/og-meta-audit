// Fetch, title, description, canonical, robots and language rules.

import { hostOf, isAbsoluteHttpUrl, normalizeForCompare, resolveUrl } from '../url.js';
import { type FetchRule, type PageRule, num } from './types.js';

/** Length in Unicode code points, which is closer to what people count than UTF-16 units. */
export function textLength(text: string): number {
  let n = 0;
  for (const _ of text) n++;
  return n;
}

export const fetchRules: FetchRule[] = [
  {
    id: 'fetch-failed',
    scope: 'fetch',
    category: 'fetch',
    severity: 'error',
    description: 'The page could not be fetched (network error, DNS failure or timeout).',
    check({ page, report }) {
      if (page.error && page.status === undefined) report(`Could not fetch the page: ${page.error}`);
    },
  },
  {
    id: 'http-status',
    scope: 'fetch',
    category: 'fetch',
    severity: 'error',
    description: 'The page answered with a 4xx or 5xx status code.',
    check({ page, report }) {
      if (page.status !== undefined && page.status >= 400) {
        report(`The page returned HTTP ${page.status}`, { status: page.status });
      }
    },
  },
  {
    id: 'not-html',
    scope: 'fetch',
    category: 'fetch',
    severity: 'warn',
    description: 'The response is not an HTML document.',
    check({ page, report }) {
      if (
        page.status !== undefined &&
        page.status < 400 &&
        page.contentType &&
        !/html/.test(page.contentType)
      ) {
        report(`Expected HTML but got "${page.contentType}"`, { contentType: page.contentType });
      }
    },
  },
  {
    id: 'redirected',
    scope: 'fetch',
    category: 'fetch',
    severity: 'info',
    description: 'The URL redirects. Share links and sitemaps should use the final URL.',
    check({ page, url, report }) {
      if (
        page.redirected &&
        page.finalUrl &&
        normalizeForCompare(page.finalUrl) !== normalizeForCompare(url)
      ) {
        report(`Redirects to ${page.finalUrl}`, { finalUrl: page.finalUrl });
      }
    },
  },
  {
    id: 'slow-response',
    scope: 'fetch',
    category: 'fetch',
    severity: 'info',
    description: 'The HTML took longer than `maxMs` to download. Some crawlers give up on slow pages.',
    defaults: { maxMs: 3000 },
    check({ page, options, report }) {
      const max = num(options, 'maxMs', 3000);
      if (page.timeMs !== undefined && page.timeMs > max) {
        report(`The page took ${page.timeMs} ms (limit ${max} ms)`, { timeMs: page.timeMs });
      }
    },
  },
];

export const basicRules: PageRule[] = [
  {
    id: 'title-missing',
    scope: 'page',
    category: 'basics',
    severity: 'error',
    description: 'The page has no <title> or an empty one.',
    check({ meta, report }) {
      if (!meta.title) report(meta.titles.length > 0 ? 'The <title> is empty' : 'No <title> element');
    },
  },
  {
    id: 'title-multiple',
    scope: 'page',
    category: 'basics',
    severity: 'warn',
    description: 'The page has more than one <title> element.',
    check({ meta, report }) {
      if (meta.titles.length > 1)
        report(`Found ${meta.titles.length} <title> elements`, { titles: meta.titles });
    },
  },
  {
    id: 'title-length',
    scope: 'page',
    category: 'basics',
    severity: 'warn',
    description: 'The title is shorter than `min` or longer than `max` characters.',
    defaults: { min: 30, max: 60 },
    check({ meta, options, report }) {
      if (!meta.title) return;
      const min = num(options, 'min', 30);
      const max = num(options, 'max', 60);
      const len = textLength(meta.title);
      if (len < min) report(`Title is ${len} characters (minimum ${min})`, { length: len, min });
      else if (len > max) report(`Title is ${len} characters (maximum ${max})`, { length: len, max });
    },
  },
  {
    id: 'description-missing',
    scope: 'page',
    category: 'basics',
    severity: 'warn',
    description: 'The page has no meta description or an empty one.',
    check({ meta, report }) {
      if (!meta.description) {
        report(meta.descriptions.length > 0 ? 'The meta description is empty' : 'No meta description');
      }
    },
  },
  {
    id: 'description-multiple',
    scope: 'page',
    category: 'basics',
    severity: 'warn',
    description: 'The page has more than one meta description.',
    check({ meta, report }) {
      if (meta.descriptions.length > 1) {
        report(`Found ${meta.descriptions.length} meta descriptions`, { descriptions: meta.descriptions });
      }
    },
  },
  {
    id: 'description-length',
    scope: 'page',
    category: 'basics',
    severity: 'warn',
    description: 'The meta description is shorter than `min` or longer than `max` characters.',
    defaults: { min: 70, max: 160 },
    check({ meta, options, report }) {
      if (!meta.description) return;
      const min = num(options, 'min', 70);
      const max = num(options, 'max', 160);
      const len = textLength(meta.description);
      if (len < min) report(`Description is ${len} characters (minimum ${min})`, { length: len, min });
      else if (len > max) report(`Description is ${len} characters (maximum ${max})`, { length: len, max });
    },
  },
  {
    id: 'lang-missing',
    scope: 'page',
    category: 'basics',
    severity: 'info',
    description: 'The <html> element has no lang attribute.',
    check({ meta, report }) {
      if (!meta.lang) report('No lang attribute on <html>');
    },
  },
  {
    id: 'canonical-missing',
    scope: 'page',
    category: 'canonical',
    severity: 'warn',
    description: 'The page has no <link rel="canonical">.',
    check({ meta, report }) {
      if (meta.canonicals.length === 0) report('No canonical link');
    },
  },
  {
    id: 'canonical-multiple',
    scope: 'page',
    category: 'canonical',
    severity: 'error',
    description: 'The page declares more than one canonical URL. Search engines may ignore all of them.',
    check({ meta, report }) {
      const distinct = new Set(meta.canonicals.map((c) => c.trim()));
      if (distinct.size > 1)
        report(`Found ${distinct.size} different canonical links`, { canonicals: [...distinct] });
    },
  },
  {
    id: 'canonical-relative',
    scope: 'page',
    category: 'canonical',
    severity: 'warn',
    description: 'The canonical URL is relative. Use an absolute URL.',
    check({ meta, report }) {
      if (meta.canonical && !isAbsoluteHttpUrl(meta.canonical)) {
        report(`Canonical "${meta.canonical}" is not an absolute URL`, { canonical: meta.canonical });
      }
    },
  },
  {
    id: 'canonical-mismatch',
    scope: 'page',
    category: 'canonical',
    severity: 'info',
    description: 'The canonical URL points to a different URL than the audited page.',
    check({ meta, finalUrl, report }) {
      if (!meta.canonical) return;
      const resolved = resolveUrl(meta.canonical, finalUrl);
      if (resolved && normalizeForCompare(resolved) !== normalizeForCompare(finalUrl)) {
        report(`Canonical points to ${resolved}`, { canonical: resolved });
      }
    },
  },
  {
    id: 'canonical-cross-host',
    scope: 'page',
    category: 'canonical',
    severity: 'warn',
    description: 'The canonical URL is on another host than the page.',
    check({ meta, finalUrl, report }) {
      if (!meta.canonical) return;
      const resolved = resolveUrl(meta.canonical, finalUrl);
      if (resolved && hostOf(resolved) !== hostOf(finalUrl)) {
        report(`Canonical is on another host: ${hostOf(resolved)}`, { canonical: resolved });
      }
    },
  },
  {
    id: 'canonical-insecure',
    scope: 'page',
    category: 'canonical',
    severity: 'warn',
    description: 'An https page declares an http canonical URL.',
    check({ meta, finalUrl, report }) {
      if (!meta.canonical) return;
      const resolved = resolveUrl(meta.canonical, finalUrl);
      if (resolved?.startsWith('http:') && finalUrl.startsWith('https:')) {
        report('Canonical uses http on an https page', { canonical: resolved });
      }
    },
  },
  {
    id: 'robots-noindex',
    scope: 'page',
    category: 'robots',
    severity: 'warn',
    description: 'The robots meta tag or X-Robots-Tag header contains noindex (or none).',
    check({ meta, page, report }) {
      const header = page.robotsHeader ?? '';
      const tokens = [...meta.robots, ...header.toLowerCase().split(/[,\s]+/)];
      if (tokens.includes('noindex') || tokens.includes('none')) report('The page is marked noindex');
    },
  },
  {
    id: 'robots-nofollow',
    scope: 'page',
    category: 'robots',
    severity: 'info',
    description: 'The robots meta tag contains nofollow.',
    check({ meta, report }) {
      if (meta.robots.includes('nofollow')) report('The page is marked nofollow');
    },
  },
  {
    id: 'robots-nosnippet',
    scope: 'page',
    category: 'robots',
    severity: 'info',
    description: 'nosnippet or max-image-preview:none limits how the page is shown in previews.',
    check({ meta, report }) {
      if (meta.robots.includes('nosnippet')) report('The page is marked nosnippet');
      if (meta.robots.includes('max-image-preview:none')) report('max-image-preview is none');
    },
  },
];
