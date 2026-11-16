import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { gzipSync } from 'node:zlib';
import {
  dedupe,
  hostOf,
  isAbsoluteHttpUrl,
  loadSitemap,
  normalizeForCompare,
  parseSitemap,
  parseUrlList,
  resolveUrl,
  siteOf,
} from '../src/index.js';
import { fakeFetch } from './helpers.js';

const E = 'https://example.com';
const xml = (body: string) => ({ headers: { 'content-type': 'application/xml' }, body });

const urlset = (locs: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${locs.map((l) => `<url><loc>${l}</loc><image:image><image:loc>${l}cover.jpg</image:loc></image:image></url>`).join('\n')}
</urlset>`;

const opts = { timeoutMs: 1000, userAgent: 'test', limit: 100 };

describe('parseSitemap', () => {
  it('reads urlset locations and ignores image:loc', () => {
    const doc = parseSitemap(urlset([`${E}/a`, `${E}/b?x=1&amp;y=2`]));
    assert.equal(doc.kind, 'urlset');
    assert.deepEqual(doc.locs, [`${E}/a`, `${E}/b?x=1&y=2`]);
  });

  it('reads sitemap indexes, CDATA and prefixed namespaces', () => {
    const doc = parseSitemap(
      `<sm:sitemapindex xmlns:sm="http://www.sitemaps.org/schemas/sitemap/0.9"><sm:sitemap><sm:loc><![CDATA[${E}/s1.xml]]></sm:loc></sm:sitemap></sm:sitemapindex>`,
    );
    assert.equal(doc.kind, 'sitemapindex');
    assert.deepEqual(doc.locs, [`${E}/s1.xml`]);
  });

  it('returns unknown for other documents', () => {
    assert.deepEqual(parseSitemap('<html></html>'), { kind: 'unknown', locs: [] });
  });
});

describe('loadSitemap', () => {
  it('follows indexes, gunzips and removes duplicates', async () => {
    const fetch = fakeFetch({
      [`${E}/sitemap.xml`]: xml(
        `<sitemapindex><sitemap><loc>${E}/posts.xml.gz</loc></sitemap><sitemap><loc>${E}/pages.xml</loc></sitemap><sitemap><loc>${E}/missing.xml</loc></sitemap></sitemapindex>`,
      ),
      [`${E}/posts.xml.gz`]: {
        headers: { 'content-type': 'application/gzip' },
        body: gzipSync(urlset([`${E}/p1`, `${E}/p2`])),
      },
      [`${E}/pages.xml`]: xml(urlset([`${E}/`, `${E}/p1`, 'not a url'])),
    });
    const urls = await loadSitemap(`${E}/sitemap.xml`, { fetch, ...opts });
    assert.deepEqual(urls, [`${E}/p1`, `${E}/p2`, `${E}/`]);
  });

  it('stops at the limit', async () => {
    const fetch = fakeFetch({ [`${E}/s.xml`]: xml(urlset([1, 2, 3, 4, 5].map((n) => `${E}/${n}`))) });
    assert.equal((await loadSitemap(`${E}/s.xml`, { fetch, ...opts, limit: 2 })).length, 2);
  });

  it('does not loop on self-referencing indexes', async () => {
    const fetch = fakeFetch({
      [`${E}/s.xml`]: xml(`<sitemapindex><sitemap><loc>${E}/s.xml</loc></sitemap></sitemapindex>`),
    });
    assert.deepEqual(await loadSitemap(`${E}/s.xml`, { fetch, ...opts }), []);
  });

  it('throws when the top-level sitemap fails', async () => {
    const fetch = fakeFetch({});
    await assert.rejects(
      loadSitemap(`${E}/nope.xml`, { fetch, ...opts }),
      /Could not load sitemap .*HTTP 404/,
    );
  });
});

describe('URL lists', () => {
  it('parses lines, comments, CSV-style rows and reports bad lines', () => {
    const list = parseUrlList(`\ufeff# pages
${E}/a
${E}/b  # trailing comment
"${E}/c",Home page
${E}/a

ftp://example.com/x
just text
`);
    assert.deepEqual(list.urls, [`${E}/a`, `${E}/b`, `${E}/c`]);
    assert.deepEqual(
      list.invalid.map((i) => i.line),
      [7, 8],
    );
    assert.deepEqual(dedupe(['a', 'b', 'a']), ['a', 'b']);
  });
});

describe('URL helpers', () => {
  it('checks absolute http URLs', () => {
    assert.ok(isAbsoluteHttpUrl('https://e.com'));
    assert.ok(!isAbsoluteHttpUrl('/x'));
    assert.ok(!isAbsoluteHttpUrl('mailto:a@b.c'));
    assert.ok(!isAbsoluteHttpUrl('javascript:alert(1)'));
  });

  it('resolves and refuses non-http results', () => {
    assert.equal(resolveUrl('../a.png', 'https://e.com/x/y/'), 'https://e.com/x/a.png');
    assert.equal(resolveUrl('//cdn.e.com/a.png', 'https://e.com/'), 'https://cdn.e.com/a.png');
    assert.equal(resolveUrl('data:image/png;base64,AAAA', 'https://e.com/'), undefined);
    assert.equal(resolveUrl('   ', 'https://e.com/'), undefined);
  });

  it('normalizes for comparison', () => {
    assert.equal(normalizeForCompare('HTTPS://E.com:443/a/#top'), 'https://e.com/a');
    assert.equal(normalizeForCompare('https://e.com/'), 'https://e.com/');
    assert.equal(normalizeForCompare('https://e.com/a?b=1'), 'https://e.com/a?b=1');
    assert.equal(hostOf('nonsense'), '');
    assert.equal(siteOf('https://www.Example.com/x'), 'example.com');
  });
});
