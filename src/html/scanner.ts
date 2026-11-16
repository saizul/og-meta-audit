// A small, forgiving HTML scanner. It is not a full HTML5 parser: it walks the
// markup once, skips comments, doctype and raw-text elements, and reports the
// elements that carry page metadata. That is enough for <title>, <meta>,
// <link>, <html lang> and JSON-LD scripts, and it never throws on bad markup.

import { decodeEntities } from './entities.js';

export interface ScannedElement {
  /** Lower-case tag name. */
  name: string;
  /** Attributes with lower-case names and decoded values. The first occurrence wins. */
  attrs: Record<string, string>;
  /** Text content for `title` and `script` elements. */
  text?: string;
  /** True when the element appeared after the `<body>` start tag or body content. */
  inBody: boolean;
  /** Character offset of the start tag. */
  offset: number;
}

const INTERESTING = new Set(['html', 'title', 'meta', 'link', 'script', 'base']);
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'noscript', 'template', 'xmp', 'iframe']);
const HEAD_ONLY = new Set(['html', 'head', 'title', 'meta', 'link', 'base', 'script', 'style', 'noscript']);

const ATTR = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** Parses the attribute part of a start tag. */
export function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTR.lastIndex = 0;
  for (let m = ATTR.exec(source); m !== null; m = ATTR.exec(source)) {
    const name = m[1]!.toLowerCase();
    if (name in attrs) continue;
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    attrs[name] = decodeEntities(value);
  }
  return attrs;
}

/** Finds the end of a start tag, honouring quoted attribute values. Returns -1 when unterminated. */
function findTagEnd(html: string, from: number): number {
  let quote = '';
  for (let i = from; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      // Quotes only open a value right after `=` (possibly with spaces).
      let j = i - 1;
      while (j >= from && /\s/.test(html[j]!)) j--;
      if (html[j] === '=') quote = ch;
    } else if (ch === '>') {
      return i;
    }
  }
  return -1;
}

/**
 * Scans an HTML document and returns the metadata elements in document order.
 * Elements inside `<svg>` and `<math>` are ignored, so an SVG `<title>` is
 * never mistaken for the page title.
 */
export function scanHtml(html: string): ScannedElement[] {
  const out: ScannedElement[] = [];
  let i = 0;
  let inBody = false;
  let foreignDepth = 0;
  const len = html.length;

  while (i < len) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;
    if (!inBody && lt > i && /\S/.test(html.slice(i, lt))) inBody = true;

    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end === -1 ? len : end + 3;
      continue;
    }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') {
      const end = html.indexOf('>', lt + 2);
      i = end === -1 ? len : end + 1;
      continue;
    }

    const closing = html[lt + 1] === '/';
    const nameStart = closing ? lt + 2 : lt + 1;
    const nameMatch = /^[A-Za-z][A-Za-z0-9:-]*/.exec(html.slice(nameStart, nameStart + 64));
    if (!nameMatch) {
      if (!inBody) inBody = true;
      i = lt + 1;
      continue;
    }
    const name = nameMatch[0].toLowerCase();
    const end = findTagEnd(html, nameStart + nameMatch[0].length);
    if (end === -1) break;

    if (closing) {
      if ((name === 'svg' || name === 'math') && foreignDepth > 0) foreignDepth--;
      i = end + 1;
      continue;
    }

    const attrSource = html.slice(nameStart + nameMatch[0].length, end);
    const selfClosing = attrSource.trimEnd().endsWith('/');
    if (name === 'body') inBody = true;
    else if (!HEAD_ONLY.has(name) && name !== 'head') inBody = true;

    if (name === 'svg' || name === 'math') {
      if (!selfClosing) foreignDepth++;
      i = end + 1;
      continue;
    }

    let text: string | undefined;
    let next = end + 1;
    if (RAW_TEXT.has(name) && !(selfClosing && foreignDepth > 0)) {
      const closeRe = new RegExp(`</${name}[\\s>/]`, 'ig');
      closeRe.lastIndex = end + 1;
      const close = closeRe.exec(html);
      const textEnd = close ? close.index : len;
      text = html.slice(end + 1, textEnd);
      const closeEnd = close ? html.indexOf('>', close.index) : -1;
      next = closeEnd === -1 ? len : closeEnd + 1;
    }

    if (foreignDepth === 0 && INTERESTING.has(name)) {
      const el: ScannedElement = { name, attrs: parseAttributes(attrSource), inBody, offset: lt };
      if (text !== undefined) el.text = text;
      out.push(el);
    }
    i = next;
  }
  return out;
}
