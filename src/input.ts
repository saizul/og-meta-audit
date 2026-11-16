// Reading lists of URLs from text: one URL per line, with comments and
// blank lines allowed. Also accepts CSV-ish lines where the URL is the first
// field.

import { isAbsoluteHttpUrl } from './url.js';

export interface ParsedUrlList {
  urls: string[];
  /** Lines that were not blank or comments but did not contain a valid URL. */
  invalid: { line: number; text: string }[];
}

/** Parses a URL list. `#` starts a comment; duplicates are removed, keeping the first. */
export function parseUrlList(text: string): ParsedUrlList {
  const urls: string[] = [];
  const invalid: ParsedUrlList['invalid'] = [];
  const seen = new Set<string>();
  const lines = text.replace(/^\ufeff/, '').split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) return;
    const candidate = line.split(/[\s,;\t]/)[0]!.replace(/^["']|["']$/g, '');
    if (!isAbsoluteHttpUrl(candidate)) {
      invalid.push({ line: i + 1, text: raw });
      return;
    }
    if (!seen.has(candidate)) {
      seen.add(candidate);
      urls.push(candidate);
    }
  });
  return { urls, invalid };
}

/** Removes duplicate URLs, keeping order. */
export function dedupe(urls: readonly string[]): string[] {
  return [...new Set(urls)];
}
