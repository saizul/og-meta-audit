// Open Graph and Twitter card rules that only need the HTML.

import { first, ogImageUrl } from '../extract.js';
import type { PageMeta } from '../types.js';
import { isAbsoluteHttpUrl, normalizeForCompare, resolveUrl } from '../url.js';
import { textLength } from './basics.js';
import { type PageRule, num } from './types.js';

const OG_TYPES = new Set([
  'website',
  'article',
  'profile',
  'book',
  'music.song',
  'music.album',
  'music.playlist',
  'music.radio_station',
  'video.movie',
  'video.episode',
  'video.tv_show',
  'video.other',
  'product',
  'business.business',
  'place',
]);

const TWITTER_CARDS = new Set(['summary', 'summary_large_image', 'app', 'player']);

function ogImageRaw(meta: PageMeta): string | undefined {
  return (
    first(meta.og, 'og:image') ?? first(meta.og, 'og:image:url') ?? first(meta.og, 'og:image:secure_url')
  );
}

function missing(id: string, key: string, severity: PageRule['severity'], why: string): PageRule {
  return {
    id,
    scope: 'page',
    category: 'opengraph',
    severity,
    description: `The page has no ${key} property. ${why}`,
    check({ meta, report }) {
      const value = first(meta.og, key);
      if (!value) report(value === '' ? `${key} is empty` : `No ${key}`);
    },
  };
}

export const openGraphRules: PageRule[] = [
  missing(
    'og-title-missing',
    'og:title',
    'warn',
    'Platforms fall back to the <title>, which is often longer.',
  ),
  missing(
    'og-description-missing',
    'og:description',
    'warn',
    'Previews may show no text or random page text.',
  ),
  missing('og-url-missing', 'og:url', 'info', 'Likes and shares may be split across URL variants.'),
  missing('og-type-missing', 'og:type', 'info', 'Facebook treats the page as "website".'),
  missing('og-site-name-missing', 'og:site_name', 'info', 'Previews will not show the site or brand name.'),
  {
    id: 'og-image-missing',
    scope: 'page',
    category: 'opengraph',
    severity: 'error',
    description: 'The page has no og:image. Shared links show no picture or a random one.',
    check({ meta, report }) {
      if (!ogImageRaw(meta)) report('No og:image');
    },
  },
  {
    id: 'og-image-relative',
    scope: 'page',
    category: 'opengraph',
    severity: 'error',
    description: 'og:image must be an absolute http(s) URL. Most platforms ignore relative paths.',
    check({ meta, report }) {
      const raw = ogImageRaw(meta);
      if (raw && !isAbsoluteHttpUrl(raw)) report(`og:image "${raw}" is not an absolute URL`, { value: raw });
    },
  },
  {
    id: 'og-image-insecure',
    scope: 'page',
    category: 'opengraph',
    severity: 'warn',
    description: 'og:image uses http. Some platforms refuse to load insecure images.',
    check({ meta, finalUrl, report }) {
      const url = ogImageUrl(meta, finalUrl);
      if (url?.startsWith('http:')) report('og:image uses http instead of https', { image: url });
    },
  },
  {
    id: 'og-image-multiple',
    scope: 'page',
    category: 'opengraph',
    severity: 'info',
    description: 'More than one og:image. Most platforms use the first one only.',
    check({ meta, report }) {
      const n = meta.og['og:image']?.length ?? 0;
      if (n > 1) report(`Found ${n} og:image values; the first is used`, { images: meta.og['og:image'] });
    },
  },
  {
    id: 'og-image-dimensions-missing',
    scope: 'page',
    category: 'opengraph',
    severity: 'info',
    description:
      'og:image:width and og:image:height are not declared. Facebook cannot render the image on the first share without them.',
    check({ meta, report }) {
      if (!ogImageRaw(meta)) return;
      const w = first(meta.og, 'og:image:width');
      const h = first(meta.og, 'og:image:height');
      if (!w || !h) report('og:image:width and og:image:height are not both declared');
      else if (!/^\d+$/.test(w) || !/^\d+$/.test(h)) {
        report(`og:image:width/height must be whole numbers (got "${w}" x "${h}")`);
      }
    },
  },
  {
    id: 'og-image-alt-missing',
    scope: 'page',
    category: 'opengraph',
    severity: 'info',
    description: 'og:image:alt is missing. Screen readers describe shared images with it.',
    check({ meta, report }) {
      if (ogImageRaw(meta) && !first(meta.og, 'og:image:alt')) report('No og:image:alt');
    },
  },
  {
    id: 'og-title-length',
    scope: 'page',
    category: 'opengraph',
    severity: 'info',
    description: 'og:title is longer than `max` characters and will be cut in most previews.',
    defaults: { max: 90 },
    check({ meta, options, report }) {
      const v = first(meta.og, 'og:title');
      const max = num(options, 'max', 90);
      if (v && textLength(v) > max) report(`og:title is ${textLength(v)} characters (maximum ${max})`);
    },
  },
  {
    id: 'og-description-length',
    scope: 'page',
    category: 'opengraph',
    severity: 'info',
    description: 'og:description is longer than `max` characters.',
    defaults: { max: 200 },
    check({ meta, options, report }) {
      const v = first(meta.og, 'og:description');
      const max = num(options, 'max', 200);
      if (v && textLength(v) > max) report(`og:description is ${textLength(v)} characters (maximum ${max})`);
    },
  },
  {
    id: 'og-url-mismatch',
    scope: 'page',
    category: 'opengraph',
    severity: 'warn',
    description: 'og:url differs from the canonical URL. Share counts get split between the two.',
    check({ meta, finalUrl, report }) {
      const og = first(meta.og, 'og:url');
      if (!og) return;
      const ogResolved = resolveUrl(og, finalUrl);
      const target = meta.canonical ? resolveUrl(meta.canonical, finalUrl) : finalUrl;
      if (ogResolved && target && normalizeForCompare(ogResolved) !== normalizeForCompare(target)) {
        report(`og:url ${ogResolved} differs from ${meta.canonical ? 'canonical' : 'page URL'} ${target}`, {
          ogUrl: ogResolved,
          expected: target,
        });
      }
    },
  },
  {
    id: 'og-type-unknown',
    scope: 'page',
    category: 'opengraph',
    severity: 'info',
    description: 'og:type is not a standard Open Graph type and has no namespace prefix.',
    check({ meta, report }) {
      const t = first(meta.og, 'og:type');
      if (t && !OG_TYPES.has(t.toLowerCase()) && !t.includes(':')) report(`Unknown og:type "${t}"`);
    },
  },
  {
    id: 'og-locale-invalid',
    scope: 'page',
    category: 'opengraph',
    severity: 'info',
    description: 'og:locale should look like language_TERRITORY, for example en_US or bn_BD.',
    check({ meta, report }) {
      for (const key of ['og:locale', 'og:locale:alternate']) {
        for (const v of meta.og[key] ?? []) {
          if (!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(v)) report(`${key} "${v}" is not in the form ll_TT`);
        }
      }
    },
  },
  {
    id: 'og-title-same-as-site-name',
    scope: 'page',
    category: 'opengraph',
    severity: 'info',
    description: 'og:title only repeats og:site_name, so previews do not say what the page is about.',
    check({ meta, report }) {
      const t = first(meta.og, 'og:title');
      const s = first(meta.og, 'og:site_name');
      if (t && s && t.trim().toLowerCase() === s.trim().toLowerCase()) report('og:title equals og:site_name');
    },
  },
];

export const twitterRules: PageRule[] = [
  {
    id: 'twitter-card-missing',
    scope: 'page',
    category: 'twitter',
    severity: 'warn',
    description: 'No twitter:card. X shows a small summary card or none at all.',
    check({ meta, report }) {
      if (!first(meta.twitter, 'twitter:card')) report('No twitter:card');
    },
  },
  {
    id: 'twitter-card-invalid',
    scope: 'page',
    category: 'twitter',
    severity: 'error',
    description: 'twitter:card must be summary, summary_large_image, app or player.',
    check({ meta, report }) {
      const card = first(meta.twitter, 'twitter:card');
      if (card && !TWITTER_CARDS.has(card)) report(`Invalid twitter:card "${card}"`, { card });
    },
  },
  {
    id: 'twitter-title-missing',
    scope: 'page',
    category: 'twitter',
    severity: 'info',
    description: 'Neither twitter:title nor og:title is present.',
    check({ meta, report }) {
      if (!first(meta.twitter, 'twitter:title') && !first(meta.og, 'og:title')) {
        report('No twitter:title and no og:title fallback');
      }
    },
  },
  {
    id: 'twitter-description-missing',
    scope: 'page',
    category: 'twitter',
    severity: 'info',
    description: 'Neither twitter:description nor og:description is present.',
    check({ meta, report }) {
      if (!first(meta.twitter, 'twitter:description') && !first(meta.og, 'og:description')) {
        report('No twitter:description and no og:description fallback');
      }
    },
  },
  {
    id: 'twitter-image-missing',
    scope: 'page',
    category: 'twitter',
    severity: 'warn',
    description: 'A summary_large_image card has no twitter:image and no og:image fallback.',
    check({ meta, report }) {
      if (first(meta.twitter, 'twitter:card') !== 'summary_large_image') return;
      if (
        !first(meta.twitter, 'twitter:image') &&
        !first(meta.twitter, 'twitter:image:src') &&
        !ogImageRaw(meta)
      ) {
        report('summary_large_image without any image');
      }
    },
  },
  {
    id: 'twitter-image-relative',
    scope: 'page',
    category: 'twitter',
    severity: 'error',
    description: 'twitter:image must be an absolute URL.',
    check({ meta, report }) {
      const raw = first(meta.twitter, 'twitter:image') ?? first(meta.twitter, 'twitter:image:src');
      if (raw && !isAbsoluteHttpUrl(raw)) report(`twitter:image "${raw}" is not an absolute URL`);
    },
  },
  {
    id: 'twitter-site-invalid',
    scope: 'page',
    category: 'twitter',
    severity: 'info',
    description: 'twitter:site and twitter:creator should be @handles.',
    check({ meta, report }) {
      for (const key of ['twitter:site', 'twitter:creator']) {
        const v = first(meta.twitter, key);
        if (v && !/^@\w{1,15}$/.test(v)) report(`${key} "${v}" is not an @handle`);
      }
    },
  },
];

const ARTICLE_TIMES = ['article:published_time', 'article:modified_time', 'article:expiration_time'] as const;

const ISO_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-](\d{2}):?(\d{2}))?)?$/i;

/**
 * Parses an ISO 8601 date (`2026-11-19`) or date-time
 * (`2026-11-19T10:30:00+06:00`, `2026-11-19T04:30Z`) as used by Open Graph
 * `article:*` times. Returns milliseconds since the epoch (UTC; a time without
 * an offset is read as UTC), or undefined when the value is not valid.
 */
export function parseIsoDateTime(value: string): number | undefined {
  const m = ISO_DATE_TIME.exec(value.trim());
  if (!m) return undefined;
  const [, y, mo, d, h = '0', mi = '0', s = '0', zone, oh = '0', om = '0'] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return undefined;
  if (Number(oh) > 23 || Number(om) > 59) return undefined;
  const utc = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCDate() !== day || check.getUTCMonth() !== month - 1) return undefined;
  const sign = zone && zone[0] === '-' ? -1 : 1;
  const offset = zone && zone.toUpperCase() !== 'Z' ? sign * (Number(oh) * 60 + Number(om)) : 0;
  return utc - offset * 60_000;
}

function isArticle(meta: PageMeta): boolean {
  return (first(meta.og, 'og:type') ?? '').trim().toLowerCase() === 'article';
}

export const articleRules: PageRule[] = [
  {
    id: 'article-published-time-missing',
    scope: 'page',
    category: 'opengraph',
    severity: 'info',
    description:
      'An og:type article page has no article:published_time. Facebook, LinkedIn and news aggregators show and sort by it.',
    check({ meta, report }) {
      if (isArticle(meta) && !first(meta.article, 'article:published_time')) {
        report('og:type is article but article:published_time is missing');
      }
    },
  },
  {
    id: 'article-time-invalid',
    scope: 'page',
    category: 'opengraph',
    severity: 'warn',
    description:
      'article:published_time, article:modified_time or article:expiration_time is not an ISO 8601 date or date-time (2026-11-19T10:30:00+06:00).',
    check({ meta, report }) {
      for (const key of ARTICLE_TIMES) {
        for (const value of meta.article[key] ?? []) {
          if (parseIsoDateTime(value) === undefined) {
            report(`${key} "${value}" is not an ISO 8601 date or date-time`, { property: key, value });
          }
        }
      }
    },
  },
  {
    id: 'article-time-order',
    scope: 'page',
    category: 'opengraph',
    severity: 'warn',
    description:
      'article:modified_time is earlier than article:published_time, or article:expiration_time is not after it.',
    check({ meta, report }) {
      const published = first(meta.article, 'article:published_time');
      const at = published === undefined ? undefined : parseIsoDateTime(published);
      if (at === undefined) return;
      const modified = first(meta.article, 'article:modified_time');
      const mod = modified === undefined ? undefined : parseIsoDateTime(modified);
      if (mod !== undefined && mod < at) {
        report(`article:modified_time ${modified} is before article:published_time ${published}`, {
          published,
          modified,
        });
      }
      const expires = first(meta.article, 'article:expiration_time');
      const exp = expires === undefined ? undefined : parseIsoDateTime(expires);
      if (exp !== undefined && exp <= at) {
        report(`article:expiration_time ${expires} is not after article:published_time ${published}`, {
          published,
          expires,
        });
      }
    },
  },
  {
    id: 'article-meta-without-article-type',
    scope: 'page',
    category: 'opengraph',
    severity: 'info',
    description:
      'The page has article:* properties but og:type is not article, so platforms ignore them. Set og:type to article.',
    check({ meta, report }) {
      const keys = Object.keys(meta.article);
      if (keys.length > 0 && !isArticle(meta)) {
        report(`${keys.join(', ')} set, but og:type is "${first(meta.og, 'og:type') ?? 'missing'}"`, {
          properties: keys,
        });
      }
    },
  },
];
