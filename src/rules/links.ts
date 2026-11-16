// hreflang and icon rules.

import { isAbsoluteHttpUrl, normalizeForCompare, resolveUrl } from '../url.js';
import type { PageRule } from './types.js';

const HREFLANG = /^(?:x-default|[a-z]{2,3}(?:-[a-z]{4})?(?:-(?:[a-z]{2}|\d{3}))?)$/i;

/** Validates an hreflang value: x-default, or language[-Script][-REGION]. */
export function isValidHreflang(value: string): boolean {
  if (!HREFLANG.test(value)) return false;
  // "UK" is not an ISO 3166-1 code; the United Kingdom is "GB".
  return !/-uk$/i.test(value);
}

export const hreflangRules: PageRule[] = [
  {
    id: 'hreflang-invalid',
    scope: 'page',
    category: 'hreflang',
    severity: 'error',
    description: 'An hreflang value is not a valid language[-Script][-REGION] code or x-default.',
    check({ meta, report }) {
      for (const link of meta.hreflang) {
        if (!isValidHreflang(link.lang)) {
          const hint = /_/.test(link.lang)
            ? ' (use a hyphen, not an underscore)'
            : /-uk$/i.test(link.lang)
              ? ' (the region code for the United Kingdom is GB)'
              : '';
          report(`Invalid hreflang "${link.lang}"${hint}`, { hreflang: link.lang, href: link.href });
        }
      }
    },
  },
  {
    id: 'hreflang-relative',
    scope: 'page',
    category: 'hreflang',
    severity: 'warn',
    description: 'hreflang alternates should use absolute URLs.',
    check({ meta, report }) {
      for (const link of meta.hreflang) {
        if (!isAbsoluteHttpUrl(link.href))
          report(`hreflang "${link.lang}" uses a relative URL "${link.href}"`);
      }
    },
  },
  {
    id: 'hreflang-duplicate',
    scope: 'page',
    category: 'hreflang',
    severity: 'error',
    description: 'The same hreflang value points to more than one URL.',
    check({ meta, report }) {
      const byLang = new Map<string, Set<string>>();
      for (const link of meta.hreflang) {
        const key = link.lang.toLowerCase();
        const set = byLang.get(key) ?? new Set<string>();
        set.add(normalizeForCompare(link.resolved ?? link.href));
        byLang.set(key, set);
      }
      for (const [lang, set] of byLang) {
        if (set.size > 1)
          report(`hreflang "${lang}" points to ${set.size} different URLs`, { urls: [...set] });
      }
    },
  },
  {
    id: 'hreflang-self-missing',
    scope: 'page',
    category: 'hreflang',
    severity: 'warn',
    description: 'The hreflang set does not include the page itself (or its canonical).',
    check({ meta, finalUrl, report }) {
      if (meta.hreflang.length === 0) return;
      const self = new Set([normalizeForCompare(finalUrl)]);
      const canonical = meta.canonical ? resolveUrl(meta.canonical, finalUrl) : undefined;
      if (canonical) self.add(normalizeForCompare(canonical));
      const hasSelf = meta.hreflang.some((l) => l.resolved && self.has(normalizeForCompare(l.resolved)));
      if (!hasSelf) report('No hreflang entry points back to this page');
    },
  },
  {
    id: 'hreflang-x-default-missing',
    scope: 'page',
    category: 'hreflang',
    severity: 'info',
    description: 'The hreflang set has no x-default entry.',
    check({ meta, report }) {
      if (meta.hreflang.length > 0 && !meta.hreflang.some((l) => l.lang.toLowerCase() === 'x-default')) {
        report('No x-default hreflang');
      }
    },
  },
];

export const iconRules: PageRule[] = [
  {
    id: 'favicon-missing',
    scope: 'page',
    category: 'icons',
    severity: 'warn',
    description:
      'No <link rel="icon">. Browsers request /favicon.ico, and search results may show a generic icon.',
    check({ meta, report }) {
      if (!meta.icons.some((i) => i.rel.split(' ').includes('icon'))) report('No favicon link');
    },
  },
  {
    id: 'apple-touch-icon-missing',
    scope: 'page',
    category: 'icons',
    severity: 'info',
    description: 'No apple-touch-icon. iOS home-screen shortcuts and some apps use it.',
    check({ meta, report }) {
      if (!meta.icons.some((i) => i.rel.startsWith('apple-touch-icon'))) report('No apple-touch-icon link');
    },
  },
];
