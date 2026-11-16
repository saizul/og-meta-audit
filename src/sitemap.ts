// Sitemap loading: <urlset> and <sitemapindex> documents, gzip-compressed
// sitemaps, and nested indexes up to a depth and URL limit.

import { gunzipSync } from 'node:zlib';
import { decodeEntities } from './html/entities.js';
import { type FetchOptions, fetchBytes } from './fetcher.js';
import { isAbsoluteHttpUrl } from './url.js';

export interface SitemapDocument {
  kind: 'urlset' | 'sitemapindex' | 'unknown';
  locs: string[];
}

/** Parses the <loc> entries of a sitemap or sitemap index. */
export function parseSitemap(xml: string): SitemapDocument {
  const kind = /<(?:\w+:)?sitemapindex[\s>]/i.test(xml)
    ? 'sitemapindex'
    : /<(?:\w+:)?urlset[\s>]/i.test(xml)
      ? 'urlset'
      : 'unknown';
  const locs: string[] = [];
  const re = /<(?:(\w+):)?loc>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/(?:\w+:)?loc>/gi;
  // Only the <loc> of <url> or <sitemap> itself, not image:loc or video:loc.
  const blockRe = /<((?:\w+:)?)(url|sitemap)>([\s\S]*?)<\/\1\2>/gi;
  for (let block = blockRe.exec(xml); block !== null; block = blockRe.exec(xml)) {
    const prefix = block[1]!.replace(':', '');
    re.lastIndex = 0;
    for (let m = re.exec(block[3]!); m !== null; m = re.exec(block[3]!)) {
      if ((m[1] ?? '') !== prefix) continue;
      const loc = decodeEntities(m[2]!.trim());
      if (loc) locs.push(loc);
      break;
    }
  }
  return { kind, locs };
}

export interface LoadSitemapOptions extends FetchOptions {
  /** Maximum number of page URLs to return. */
  limit: number;
  /** Maximum nesting depth of sitemap indexes. */
  maxDepth?: number;
  /** Maximum bytes per sitemap file (after decompression). */
  maxBytes?: number;
}

function isGzip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/**
 * Downloads a sitemap and returns page URLs. Sitemap indexes are followed
 * breadth first. Throws when the top-level sitemap cannot be loaded.
 */
export async function loadSitemap(url: string, opts: LoadSitemapOptions): Promise<string[]> {
  const maxDepth = opts.maxDepth ?? 3;
  const maxBytes = opts.maxBytes ?? 50 * 1024 * 1024;
  const pages: string[] = [];
  const seenPages = new Set<string>();
  const seenMaps = new Set<string>();
  let queue: string[] = [url];

  for (let depth = 0; depth <= maxDepth && queue.length > 0 && pages.length < opts.limit; depth++) {
    const nextQueue: string[] = [];
    for (const mapUrl of queue) {
      if (seenMaps.has(mapUrl) || pages.length >= opts.limit) continue;
      seenMaps.add(mapUrl);
      let doc: SitemapDocument;
      try {
        const res = await fetchBytes(mapUrl, opts, maxBytes);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        let bytes = res.bytes;
        if (isGzip(bytes)) bytes = new Uint8Array(gunzipSync(bytes, { maxOutputLength: maxBytes }));
        doc = parseSitemap(new TextDecoder().decode(bytes));
      } catch (err) {
        if (depth === 0) {
          throw new Error(`Could not load sitemap ${mapUrl}: ${err instanceof Error ? err.message : err}`);
        }
        continue;
      }
      for (const loc of doc.locs) {
        if (!isAbsoluteHttpUrl(loc)) continue;
        if (doc.kind === 'sitemapindex') nextQueue.push(loc);
        else if (!seenPages.has(loc)) {
          seenPages.add(loc);
          pages.push(loc);
          if (pages.length >= opts.limit) break;
        }
      }
    }
    queue = nextQueue;
  }
  return pages;
}
