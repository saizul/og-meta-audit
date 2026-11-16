// Turns scanned HTML elements into PageMeta.

import { collapseWhitespace, decodeEntities } from './html/entities.js';
import { scanHtml } from './html/scanner.js';
import { extractEntities, parseJsonLdBlocks } from './jsonld.js';
import type { HreflangLink, IconLink, PageMeta } from './types.js';
import { resolveUrl } from './url.js';

const ICON_RELS = new Set([
  'icon',
  'shortcut',
  'apple-touch-icon',
  'apple-touch-icon-precomposed',
  'mask-icon',
]);

function relTokens(rel: string | undefined): string[] {
  return (rel ?? '').toLowerCase().split(/\s+/).filter(Boolean);
}

function push(map: Record<string, string[]>, key: string, value: string): void {
  const list = map[key];
  if (list) list.push(value);
  else map[key] = [value];
}

/**
 * Extracts title, description, canonical, robots, Open Graph, Twitter,
 * hreflang, icons and JSON-LD from an HTML document. Relative URLs are
 * resolved against `<base href>` when present, otherwise against `pageUrl`.
 */
export function extractMeta(html: string, pageUrl: string): PageMeta {
  const elements = scanHtml(html);
  const baseEl = elements.find((e) => e.name === 'base' && e.attrs.href);
  const base = (baseEl && resolveUrl(baseEl.attrs.href!, pageUrl)) || pageUrl;

  const meta: PageMeta = {
    titles: [],
    descriptions: [],
    canonicals: [],
    robots: [],
    og: {},
    twitter: {},
    hreflang: [],
    icons: [],
    jsonld: [],
    entities: [],
  };
  const jsonldSources: string[] = [];

  for (const el of elements) {
    const a = el.attrs;
    switch (el.name) {
      case 'html':
        if (a.lang !== undefined && meta.lang === undefined) meta.lang = a.lang.trim();
        break;
      case 'title':
        meta.titles.push(collapseWhitespace(decodeEntities(el.text ?? '')));
        break;
      case 'meta': {
        const content = a.content === undefined ? undefined : collapseWhitespace(a.content);
        if (content === undefined) break;
        const prop = (a.property ?? '').trim().toLowerCase();
        const name = (a.name ?? '').trim().toLowerCase();
        if (name === 'description') meta.descriptions.push(content);
        else if (name === 'robots' || name === 'googlebot') {
          for (const token of content.toLowerCase().split(',')) {
            const t = token.trim();
            if (t) meta.robots.push(t);
          }
        }
        const key = prop || name;
        if (key.startsWith('og:')) push(meta.og, key, content);
        else if (key.startsWith('twitter:')) push(meta.twitter, key, content);
        break;
      }
      case 'link': {
        const rels = relTokens(a.rel);
        const href = a.href;
        if (href === undefined) break;
        if (rels.includes('canonical')) meta.canonicals.push(href.trim());
        if (rels.includes('alternate') && a.hreflang !== undefined) {
          const link: HreflangLink = { lang: a.hreflang.trim(), href: href.trim() };
          const resolved = resolveUrl(href, base);
          if (resolved) link.resolved = resolved;
          meta.hreflang.push(link);
        }
        if (rels.some((r) => ICON_RELS.has(r)) && (rels.includes('icon') || !rels.includes('shortcut'))) {
          const icon: IconLink = { rel: rels.join(' '), href: href.trim() };
          const resolved = resolveUrl(href, base);
          if (resolved) icon.resolved = resolved;
          if (a.sizes) icon.sizes = a.sizes;
          if (a.type) icon.type = a.type;
          meta.icons.push(icon);
        }
        break;
      }
      case 'script':
        if ((a.type ?? '').trim().toLowerCase().split(';')[0] === 'application/ld+json') {
          jsonldSources.push(el.text ?? '');
        }
        break;
      default:
        break;
    }
  }

  if (meta.titles.length > 0) meta.title = meta.titles[0];
  if (meta.descriptions.length > 0) meta.description = meta.descriptions[0];
  if (meta.canonicals.length > 0) meta.canonical = meta.canonicals[0];
  meta.jsonld = parseJsonLdBlocks(jsonldSources);
  meta.entities = extractEntities(meta.jsonld, base);
  return meta;
}

/** The first value of an Open Graph or Twitter property. */
export function first(map: Record<string, string[]>, key: string): string | undefined {
  const v = map[key];
  return v && v.length > 0 ? v[0] : undefined;
}

/**
 * The og:image URL (also accepting og:image:url and og:image:secure_url),
 * resolved against the page URL.
 */
export function ogImageUrl(meta: PageMeta, pageUrl: string): string | undefined {
  const raw =
    first(meta.og, 'og:image') ?? first(meta.og, 'og:image:url') ?? first(meta.og, 'og:image:secure_url');
  return raw ? (resolveUrl(raw, pageUrl) ?? undefined) : undefined;
}

/** The twitter:image URL (or twitter:image:src), resolved against the page URL. */
export function twitterImageUrl(meta: PageMeta, pageUrl: string): string | undefined {
  const raw = first(meta.twitter, 'twitter:image') ?? first(meta.twitter, 'twitter:image:src');
  return raw ? (resolveUrl(raw, pageUrl) ?? undefined) : undefined;
}
