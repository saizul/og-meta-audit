// URL helpers built on the WHATWG URL class.

/** True when the string is an absolute http(s) URL. */
export function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Resolves `href` against `base`. Returns undefined for invalid input and non-http(s) results. */
export function resolveUrl(href: string, base: string): string | undefined {
  const trimmed = href.trim();
  if (!trimmed) return undefined;
  try {
    const u = new URL(trimmed, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
    return u.href;
  } catch {
    return undefined;
  }
}

/**
 * Normalizes a URL for comparison: lower-case scheme and host, no default
 * port, no fragment, and no trailing slash except for the root path.
 */
export function normalizeForCompare(value: string): string {
  try {
    const u = new URL(value);
    u.hash = '';
    let path = u.pathname;
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    return `${u.protocol}//${u.host}${path}${u.search}`;
  } catch {
    return value.trim();
  }
}

/** The host of a URL, or an empty string. */
export function hostOf(value: string): string {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return '';
  }
}

/** The registrable-ish site key used to group pages: host without a leading `www.`. */
export function siteOf(value: string): string {
  return hostOf(value).replace(/^www\./, '');
}
