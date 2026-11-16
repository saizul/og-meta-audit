import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { allFindings, audit, auditHtml, exitCodeFor, mapLimit, probeImage } from '../src/index.js';
import {
  fakeFetch,
  fixture,
  gifBytes,
  html,
  image,
  jpegBytes,
  pngBytes,
  type Route,
  webpLossyBytes,
} from './helpers.js';

const E = 'https://example.com';

function site(overrides: Record<string, Route> = {}) {
  return fakeFetch({
    [`${E}/`]: html(fixture('home.html')),
    [`${E}/about/`]: html(fixture('about.html')),
    [`${E}/blog/migrate/`]: html(fixture('post.html')),
    [`${E}/blog/migrate-copy/`]: html(fixture('post-copy.html')),
    [`${E}/en/`]: html(fixture('en.html')),
    [`${E}/bn/`]: html(fixture('bn.html')),
    [`${E}/img/og-home.png`]: image(pngBytes(1200, 630), 'image/png'),
    [`${E}/img/og-about.png`]: image(pngBytes(1200, 630, 7), 'image/png'),
    [`${E}/img/saizul.jpg`]: image(jpegBytes(800, 800), 'image/jpeg'),
    [`${E}/img/saizul-old.jpg`]: image(jpegBytes(400, 400), 'image/jpeg'),
    [`${E}/img/logo.png`]: image(pngBytes(512, 512), 'image/png'),
    [`${E}/img/square.jpg`]: image(jpegBytes(800, 800, 0xc0, 1000), 'image/jpeg'),
    ...overrides,
  });
}

const pages = [
  `${E}/`,
  `${E}/about/`,
  `${E}/blog/migrate/`,
  `${E}/blog/migrate-copy/`,
  `${E}/en/`,
  `${E}/bn/`,
];

describe('audit', () => {
  it('audits a site and reports page and site findings', async () => {
    const fetch = site();
    const report = await audit(pages, { fetch, concurrency: 3 });
    assert.equal(report.summary.pages, 6);
    assert.equal(report.summary.failedPages, 0);
    assert.equal(report.tool.name, 'og-meta-audit');

    const home = report.pages[0]!;
    assert.deepEqual(home.images[`${E}/img/og-home.png`]!.width, 1200);
    assert.equal(home.images[`${E}/img/og-home.png`]!.format, 'png');
    assert.equal(home.findings.filter((f) => f.severity !== 'info').length, 0);

    const post = report.pages[2]!;
    const postRules = post.findings.map((f) => f.rule);
    assert.ok(postRules.includes('og-image-aspect-ratio'));
    assert.ok(postRules.includes('og-image-below-recommended'));
    assert.ok(postRules.includes('og-image-dimension-mismatch'));

    const siteRules = report.siteFindings.map((f) => f.rule);
    assert.ok(siteRules.includes('duplicate-title'));
    assert.ok(siteRules.includes('duplicate-description'));
    assert.ok(siteRules.includes('entity-image-inconsistent'));
    assert.ok(siteRules.includes('entity-sameas-inconsistent'));
    assert.ok(siteRules.includes('hreflang-return-link-missing'));

    const dup = report.siteFindings.find((f) => f.rule === 'duplicate-title')!;
    assert.equal(dup.url, `${E}/blog/migrate/`);
    assert.deepEqual(dup.related, [`${E}/blog/migrate-copy/`]);

    const inconsistent = report.siteFindings.find((f) => f.rule === 'entity-image-inconsistent')!;
    assert.match(inconsistent.message, /Person "Saizul Amin" uses 2 different images across 2 pages/);

    const about = report.pages[1]!;
    assert.ok(about.findings.some((f) => f.rule === 'og-image-entity-mismatch'));
    // The en/bn pages have no og:image, which is an error.
    assert.equal(exitCodeFor(report), 1);
    assert.equal(exitCodeFor({ ...report, pages: report.pages.slice(0, 1), siteFindings: [] }), 0);
    assert.equal(exitCodeFor(report, 'warn'), 1);
    assert.equal(exitCodeFor(report, 'never'), 0);
  });

  it('downloads an image shared by many pages only once', async () => {
    const fetch = site();
    await audit([`${E}/blog/migrate/`, `${E}/blog/migrate-copy/`], { fetch, concurrency: 2 });
    assert.equal(fetch.calls.filter((c) => c.url === `${E}/img/square.jpg`).length, 1);
  });

  it('treats different URLs with identical bytes as the same image', async () => {
    const fetch = site({ [`${E}/img/saizul-old.jpg`]: image(jpegBytes(800, 800), 'image/jpeg') });
    const report = await audit([`${E}/`, `${E}/about/`], { fetch });
    assert.ok(!report.siteFindings.some((f) => f.rule === 'entity-image-inconsistent'));
  });

  it('treats an image that redirects to the same file as the same image', async () => {
    const fetch = site({ [`${E}/img/saizul-old.jpg`]: { redirectTo: `${E}/img/saizul.jpg` } });
    const report = await audit([`${E}/`, `${E}/about/`], { fetch });
    assert.ok(!report.siteFindings.some((f) => f.rule === 'entity-image-inconsistent'));
  });

  it('reports unreachable, mistyped, oversized and unsupported images', async () => {
    const page = (img: string) =>
      html(`<html><head><title>t</title><meta property="og:image" content="${E}/img/${img}"></head></html>`);
    const fetch = fakeFetch({
      [`${E}/a`]: page('missing.png'),
      [`${E}/b`]: page('html.png'),
      [`${E}/c`]: page('big.png'),
      [`${E}/d`]: page('tiny.gif'),
      [`${E}/e`]: page('icon.svg'),
      [`${E}/f`]: page('wrong.webp'),
      [`${E}/img/html.png`]: html('<html></html>'),
      [`${E}/img/big.png`]: image(pngBytes(1200, 630, 6 * 1024 * 1024), 'image/png'),
      [`${E}/img/tiny.gif`]: image(gifBytes(100, 100), 'image/gif'),
      [`${E}/img/icon.svg`]: image(
        new TextEncoder().encode('<svg width="1200" height="630"></svg>'),
        'image/svg+xml',
      ),
      [`${E}/img/wrong.webp`]: image(webpLossyBytes(1200, 630), 'image/png'),
    });
    const report = await audit([`${E}/a`, `${E}/b`, `${E}/c`, `${E}/d`, `${E}/e`, `${E}/f`], { fetch });
    const rulesOf = (i: number) => report.pages[i]!.findings.map((f) => f.rule);
    assert.ok(rulesOf(0).includes('og-image-unreachable'));
    assert.ok(rulesOf(1).includes('og-image-content-type'));
    assert.ok(rulesOf(2).includes('og-image-too-large'));
    assert.ok(rulesOf(3).includes('og-image-too-small'));
    assert.ok(!rulesOf(3).includes('og-image-below-recommended'));
    assert.ok(rulesOf(4).includes('og-image-format'));
    const mismatch = report.pages[5]!.findings.find((f) => f.rule === 'og-image-content-type')!;
    assert.match(mismatch.message, /served as image\/png but the file is webp/);
  });

  it('handles HTTP errors, network errors, timeouts and redirects', async () => {
    const fetch = fakeFetch({
      [`${E}/gone`]: { status: 410, body: 'gone' },
      [`${E}/down`]: { error: 'getaddrinfo ENOTFOUND example.com' },
      [`${E}/slow`]: { delayMs: 500, ...html('<title>slow</title>') },
      [`${E}/old`]: { redirectTo: `${E}/` },
      [`${E}/`]: html(fixture('home.html')),
      [`${E}/pdf`]: { headers: { 'content-type': 'application/pdf' }, body: '%PDF' },
    });
    const report = await audit([`${E}/gone`, `${E}/down`, `${E}/slow`, `${E}/old`, `${E}/pdf`], {
      fetch,
      timeoutMs: 50,
      checkImages: false,
    });
    const [gone, down, slow, old, pdf] = report.pages;
    assert.equal(gone!.status, 410);
    assert.deepEqual(
      gone!.findings.map((f) => f.rule),
      ['http-status'],
    );
    assert.equal(down!.findings[0]!.rule, 'fetch-failed');
    assert.match(down!.findings[0]!.message, /ENOTFOUND/);
    assert.match(slow!.error!, /Timed out after 50 ms/);
    assert.equal(old!.finalUrl, `${E}/`);
    assert.ok(old!.findings.some((f) => f.rule === 'redirected'));
    assert.ok(pdf!.findings.some((f) => f.rule === 'not-html'));
    assert.equal(report.summary.failedPages, 3);
    assert.equal(exitCodeFor(report), 1);
  });

  it('reads the X-Robots-Tag header', async () => {
    const fetch = fakeFetch({
      [`${E}/x`]: {
        headers: { 'content-type': 'text/html', 'x-robots-tag': 'noindex' },
        body: '<title>x</title>',
      },
    });
    const report = await audit([`${E}/x`], { fetch, checkImages: false });
    assert.ok(report.pages[0]!.findings.some((f) => f.rule === 'robots-noindex'));
  });

  it('sends the user agent and extra headers', async () => {
    const fetch = site();
    await audit([`${E}/`], {
      fetch,
      checkImages: false,
      userAgent: 'test-agent',
      headers: { 'x-preview': '1' },
    });
    assert.equal(fetch.calls[0]!.headers['user-agent'], 'test-agent');
    assert.equal(fetch.calls[0]!.headers['x-preview'], '1');
    assert.match(fetch.calls[0]!.headers.accept!, /text\/html/);
  });

  it('decodes legacy charsets from the Content-Type header', async () => {
    const latin1 = Uint8Array.from(
      [...'<title>Caf']
        .map((c) => c.charCodeAt(0))
        .concat(
          [0xe9],
          [...'</title>'].map((c) => c.charCodeAt(0)),
        ),
    );
    const fetch = fakeFetch({
      [`${E}/l`]: { headers: { 'content-type': 'text/html; charset=iso-8859-1' }, body: latin1 },
    });
    const report = await audit([`${E}/l`], { fetch, checkImages: false });
    assert.equal(report.pages[0]!.meta!.title, 'Caf\u00e9');
  });

  it('removes duplicate input URLs and reports progress', async () => {
    const seen: string[] = [];
    const report = await audit([`${E}/`, `${E}/`], {
      fetch: site(),
      checkImages: false,
      onPage: (done, total) => seen.push(`${done}/${total}`),
    });
    assert.equal(report.pages.length, 1);
    assert.deepEqual(seen, ['1/1']);
  });

  it('can turn rules off for the whole audit', async () => {
    const report = await audit(pages, { fetch: site(), rules: { 'duplicate-*': 'off', 'entity-*': 'off' } });
    assert.ok(
      !allFindings(report).some((f) => f.rule.startsWith('duplicate-') || f.rule.startsWith('entity-')),
    );
  });

  it('checks every Person page when og-image-entity-mismatch scope is "all"', async () => {
    const post = `<html><head><title>t</title><meta property="og:image" content="${E}/img/og-home.png">
      <script type="application/ld+json">{"@type":"Person","name":"A","image":"${E}/img/saizul.jpg"}</script></head></html>`;
    const fetch = site({ [`${E}/p`]: html(post) });
    const def = await audit([`${E}/p`], { fetch });
    assert.ok(!def.pages[0]!.findings.some((f) => f.rule === 'og-image-entity-mismatch'));
    const all = await audit([`${E}/p`], {
      fetch,
      rules: { 'og-image-entity-mismatch': ['warn', { scope: 'all' }] },
    });
    assert.ok(all.pages[0]!.findings.some((f) => f.rule === 'og-image-entity-mismatch'));
  });

  it('auditHtml audits a string without fetching the page', async () => {
    const page = await auditHtml('<title>Only a title</title>', `${E}/x`);
    assert.equal(page.meta!.title, 'Only a title');
    assert.ok(page.findings.some((f) => f.rule === 'og-image-missing'));
  });

  it('flags slow pages with the configured limit', async () => {
    const fetch = fakeFetch({ [`${E}/s`]: { delayMs: 40, ...html('<title>s</title>') } });
    const report = await audit([`${E}/s`], {
      fetch,
      checkImages: false,
      rules: { 'slow-response': ['info', { maxMs: 10 }] },
    });
    assert.ok(report.pages[0]!.findings.some((f) => f.rule === 'slow-response'));
  });
});

describe('probeImage', () => {
  it('uses HEAD when asked and then has no dimensions', async () => {
    const fetch = site();
    const info = await probeImage(`${E}/img/og-home.png`, {
      fetch,
      timeoutMs: 1000,
      userAgent: 'x',
      method: 'head',
      maxBytes: 1000,
    });
    assert.equal(info.ok, true);
    assert.equal(info.width, undefined);
    assert.equal(fetch.calls[0]!.method, 'HEAD');
  });

  it('stops reading at maxBytes but still reads dimensions from the header', async () => {
    const info = await probeImage(`${E}/img/og-home.png`, {
      fetch: site({ [`${E}/img/og-home.png`]: image(pngBytes(1200, 630, 100_000), 'image/png') }),
      timeoutMs: 1000,
      userAgent: 'x',
      method: 'get',
      maxBytes: 1024,
    });
    assert.equal(info.width, 1200);
    assert.equal(info.hash, undefined);
    assert.equal(info.bytes, 100_033);
  });
});

describe('mapLimit', () => {
  it('never runs more than the limit at once and keeps order', async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5 * (8 - n)));
      running--;
      return n * 2;
    });
    assert.deepEqual(out, [2, 4, 6, 8, 10, 12, 14]);
    assert.equal(peak, 3);
  });

  it('handles empty input and odd limits', async () => {
    assert.deepEqual(await mapLimit([], 4, async (x) => x), []);
    assert.deepEqual(await mapLimit([1, 2], 0, async (x) => x), [1, 2]);
  });
});
