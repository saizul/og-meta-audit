// HTML character reference decoding. Covers numeric references and the named
// references that show up in titles and descriptions in practice. Unknown
// names are left as they are, which is what browsers do for most of them.

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  ensp: '\u2002',
  emsp: '\u2003',
  thinsp: '\u2009',
  zwnj: '\u200c',
  zwj: '\u200d',
  lrm: '\u200e',
  rlm: '\u200f',
  ndash: '\u2013',
  mdash: '\u2014',
  lsquo: '\u2018',
  rsquo: '\u2019',
  sbquo: '\u201a',
  ldquo: '\u201c',
  rdquo: '\u201d',
  bdquo: '\u201e',
  laquo: '\u00ab',
  raquo: '\u00bb',
  lsaquo: '\u2039',
  rsaquo: '\u203a',
  hellip: '\u2026',
  middot: '\u00b7',
  bull: '\u2022',
  copy: '\u00a9',
  reg: '\u00ae',
  trade: '\u2122',
  deg: '\u00b0',
  plusmn: '\u00b1',
  times: '\u00d7',
  divide: '\u00f7',
  para: '\u00b6',
  sect: '\u00a7',
  euro: '\u20ac',
  pound: '\u00a3',
  yen: '\u00a5',
  cent: '\u00a2',
  iexcl: '\u00a1',
  iquest: '\u00bf',
  shy: '\u00ad',
  aacute: '\u00e1',
  eacute: '\u00e9',
  iacute: '\u00ed',
  oacute: '\u00f3',
  uacute: '\u00fa',
  agrave: '\u00e0',
  egrave: '\u00e8',
  ograve: '\u00f2',
  auml: '\u00e4',
  euml: '\u00eb',
  ouml: '\u00f6',
  uuml: '\u00fc',
  Auml: '\u00c4',
  Ouml: '\u00d6',
  Uuml: '\u00dc',
  szlig: '\u00df',
  ccedil: '\u00e7',
  ntilde: '\u00f1',
  aring: '\u00e5',
  oslash: '\u00f8',
  aelig: '\u00e6',
};

const REF = /&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});?/g;

function fromCodePoint(cp: number): string {
  if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '\ufffd';
  return String.fromCodePoint(cp);
}

/** Decodes HTML character references such as `&amp;`, `&#8217;` and `&#x2014;`. */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(REF, (match, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const cp = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(cp) ? fromCodePoint(cp) : match;
    }
    const value = NAMED[body];
    if (value === undefined) return match;
    return value;
  });
}

/** Collapses runs of whitespace into one space and trims the ends. */
export function collapseWhitespace(text: string): string {
  return text.replace(/[\s\u00a0]+/g, ' ').trim();
}
