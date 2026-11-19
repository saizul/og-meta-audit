import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type AuditOptions,
  auditHtml,
  getRule,
  isValidHreflang,
  listRules,
  parseIsoDateTime,
  resolveRules,
  rules,
  textLength,
  validateRuleSettings,
} from '../src/index.js';
import { fixture } from './helpers.js';

const URL_ = 'https://example.com/page';

async function ruleIds(html: string, options: AuditOptions = {}, url = URL_): Promise<string[]> {
  const page = await auditHtml(html, url, { checkImages: false, ...options });
  return page.findings.map((f) => f.rule);
}

async function findings(html: string, rule: string, url = URL_) {
  const page = await auditHtml(html, url, { checkImages: false });
  return page.findings.filter((f) => f.rule === rule);
}

const head = (inner: string) => `<!DOCTYPE html><html lang="en"><head>${inner}</head><body></body></html>`;

describe('rule registry', () => {
  it('has unique ids in kebab-case with a description', () => {
    const ids = rules.map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const r of rules) {
      assert.match(r.id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
      assert.ok(r.description.length > 10, r.id);
    }
    assert.ok(rules.length >= 70, `only ${rules.length} rules`);
  });

  it('lists rules with their defaults', () => {
    const t = listRules().find((r) => r.id === 'title-length')!;
    assert.deepEqual(t.defaults, { min: 30, max: 60 });
    assert.equal(getRule('nope'), undefined);
  });

  it('turns rules off, changes severity, merges options and supports prefixes', () => {
    const resolved = resolveRules({
      'hreflang-*': 'off',
      'hreflang-invalid': 'warn',
      'title-length': ['error', { max: 70 }],
      'og-*': 'info',
    });
    const byId = new Map(resolved.map((r) => [r.rule.id, r]));
    assert.equal(byId.has('hreflang-duplicate'), false);
    assert.equal(byId.get('hreflang-invalid')!.severity, 'warn');
    assert.equal(byId.get('title-length')!.severity, 'error');
    assert.deepEqual(byId.get('title-length')!.options, { min: 30, max: 70 });
    assert.equal(byId.get('og-image-missing')!.severity, 'info');
  });

  it('validates settings', () => {
    assert.deepEqual(validateRuleSettings({ 'title-length': 'warn', 'og-*': 'off' }), []);
    assert.equal(validateRuleSettings({ 'no-such-rule': 'off' }).length, 1);
    assert.equal(validateRuleSettings({ 'title-length': 'fatal' as never }).length, 1);
    assert.equal(validateRuleSettings({ 'title-length': ['warn', 5 as never] }).length, 1);
  });
});

describe('basics', () => {
  it('reports missing and multiple titles and descriptions', async () => {
    const ids = await ruleIds(head(''));
    assert.ok(ids.includes('title-missing'));
    assert.ok(ids.includes('description-missing'));
    const ids2 = await ruleIds(
      head(
        '<title>One title that is long enough here</title><title>Two</title><meta name="description" content="a"><meta name="description" content="b">',
      ),
    );
    assert.ok(ids2.includes('title-multiple'));
    assert.ok(ids2.includes('description-multiple'));
  });

  it('checks title and description length in code points', async () => {
    const [short] = await findings(head('<title>Short</title>'), 'title-length');
    assert.equal(short!.message, 'Title is 5 characters (minimum 30)');
    const bangla = 'বাংলা ক্যালেন্ডার ও তারিখ রূপান্তর';
    assert.equal(textLength(bangla), [...bangla].length);
    const long = await findings(head(`<title>${'x'.repeat(61)}</title>`), 'title-length');
    assert.match(long[0]!.message, /maximum 60/);
    const desc = await findings(
      head(`<meta name="description" content="${'d'.repeat(161)}">`),
      'description-length',
    );
    assert.match(desc[0]!.message, /161 characters \(maximum 160\)/);
  });

  it('respects rule options from config', async () => {
    const ids = await ruleIds(head(`<title>${'x'.repeat(65)}</title>`), {
      rules: { 'title-length': ['warn', { max: 70 }] },
    });
    assert.ok(!ids.includes('title-length'));
  });

  it('flags canonical problems', async () => {
    const ids = await ruleIds(fixture('broken.html'), {}, 'https://example.com/broken');
    for (const id of ['canonical-multiple', 'canonical-relative', 'lang-missing'])
      assert.ok(ids.includes(id), id);
    assert.ok((await ruleIds(head(''))).includes('canonical-missing'));
    const cross = await ruleIds(head('<link rel="canonical" href="http://other.com/page">'));
    assert.ok(cross.includes('canonical-cross-host'));
    assert.ok(cross.includes('canonical-insecure'));
    assert.ok(cross.includes('canonical-mismatch'));
    const same = await ruleIds(head('<link rel="canonical" href="https://example.com/page/">'));
    assert.ok(!same.includes('canonical-mismatch'));
  });

  it('detects noindex, nofollow and nosnippet', async () => {
    const ids = await ruleIds(head('<meta name="robots" content="noindex, nofollow, nosnippet">'));
    for (const id of ['robots-noindex', 'robots-nofollow', 'robots-nosnippet'])
      assert.ok(ids.includes(id), id);
    assert.ok((await ruleIds(head('<meta name="robots" content="none">'))).includes('robots-noindex'));
  });
});

describe('Open Graph and Twitter', () => {
  it('reports missing properties', async () => {
    const ids = await ruleIds(head('<title>Page</title>'));
    for (const id of [
      'og-title-missing',
      'og-description-missing',
      'og-image-missing',
      'og-url-missing',
      'og-type-missing',
      'og-site-name-missing',
      'twitter-card-missing',
    ]) {
      assert.ok(ids.includes(id), id);
    }
  });

  it('checks og:image form and declared size', async () => {
    const ids = await ruleIds(fixture('broken.html'), {}, 'https://example.com/broken');
    assert.ok(ids.includes('og-image-relative'));
    assert.ok(ids.includes('og-image-dimensions-missing'));
    assert.ok(ids.includes('og-image-alt-missing'));
    assert.ok(ids.includes('twitter-card-invalid'));
    assert.ok(ids.includes('og-type-unknown'));
    const bad = await findings(
      head(
        '<meta property="og:image" content="http://example.com/a.png"><meta property="og:image:width" content="1200px"><meta property="og:image:height" content="630">',
      ),
      'og-image-dimensions-missing',
    );
    assert.match(bad[0]!.message, /whole numbers/);
    assert.ok(
      (await ruleIds(head('<meta property="og:image" content="http://example.com/a.png">'))).includes(
        'og-image-insecure',
      ),
    );
  });

  it('compares og:url with the canonical', async () => {
    const [f] = await findings(
      head(
        '<link rel="canonical" href="https://example.com/a"><meta property="og:url" content="https://example.com/b">',
      ),
      'og-url-mismatch',
    );
    assert.match(f!.message, /differs from canonical/);
    const none = await findings(
      head(
        '<link rel="canonical" href="https://example.com/a"><meta property="og:url" content="https://example.com/a/">',
      ),
      'og-url-mismatch',
    );
    assert.equal(none.length, 0);
  });

  it('validates og:locale and twitter handles', async () => {
    const ids = await ruleIds(
      head(
        '<meta property="og:locale" content="en-US"><meta name="twitter:site" content="saizul"><meta name="twitter:creator" content="@ok_handle">',
      ),
    );
    assert.ok(ids.includes('og-locale-invalid'));
    assert.equal(ids.filter((i) => i === 'twitter-site-invalid').length, 1);
  });

  it('flags summary_large_image without any image and twitter fallbacks', async () => {
    const ids = await ruleIds(head('<meta name="twitter:card" content="summary_large_image">'));
    assert.ok(ids.includes('twitter-image-missing'));
    assert.ok(ids.includes('twitter-title-missing'));
    assert.ok(ids.includes('twitter-description-missing'));
    const ok = await ruleIds(
      head(
        '<meta name="twitter:card" content="summary_large_image"><meta property="og:image" content="https://e.com/a.png">',
      ),
    );
    assert.ok(!ok.includes('twitter-image-missing'));
  });

  it('flags og:title equal to og:site_name and multiple og:image', async () => {
    const ids = await ruleIds(
      head(
        '<meta property="og:title" content="Acme"><meta property="og:site_name" content="acme"><meta property="og:image" content="https://e.com/1.png"><meta property="og:image" content="https://e.com/2.png">',
      ),
    );
    assert.ok(ids.includes('og-title-same-as-site-name'));
    assert.ok(ids.includes('og-image-multiple'));
  });
});

describe('hreflang', () => {
  it('validates codes', () => {
    for (const ok of ['en', 'en-US', 'bn-BD', 'zh-Hant-TW', 'es-419', 'x-default', 'EN-gb'])
      assert.ok(isValidHreflang(ok), ok);
    for (const bad of ['en_US', 'en-UK', 'english', 'e', 'en-USA', '']) assert.ok(!isValidHreflang(bad), bad);
  });

  it('reports invalid, duplicate, self-missing and x-default issues', async () => {
    const f = (await auditHtml(fixture('broken.html'), 'https://example.com/broken', { checkImages: false }))
      .findings;
    const invalid = f.filter((x) => x.rule === 'hreflang-invalid');
    assert.equal(invalid.length, 2);
    assert.match(invalid[0]!.message, /hyphen/);
    assert.match(invalid[1]!.message, /GB/);
    assert.ok(f.some((x) => x.rule === 'hreflang-duplicate'));
    assert.ok(f.some((x) => x.rule === 'hreflang-self-missing'));
    assert.ok(f.some((x) => x.rule === 'hreflang-x-default-missing'));
  });

  it('accepts a complete set', async () => {
    const ids = await ruleIds(fixture('en.html'), {}, 'https://example.com/en/');
    assert.ok(!ids.some((i) => i.startsWith('hreflang-')), ids.join());
  });

  it('flags relative alternates', async () => {
    assert.ok(
      (await ruleIds(head('<link rel="alternate" hreflang="en" href="/en/">'))).includes('hreflang-relative'),
    );
  });
});

describe('icons and JSON-LD', () => {
  it('reports missing icons', async () => {
    const ids = await ruleIds(head(''));
    assert.ok(ids.includes('favicon-missing'));
    assert.ok(ids.includes('apple-touch-icon-missing'));
    assert.ok(ids.includes('jsonld-missing'));
  });

  it('reports parse errors, missing images and bad sameAs', async () => {
    const f = (await auditHtml(fixture('broken.html'), 'https://example.com/broken', { checkImages: false }))
      .findings;
    assert.ok(f.some((x) => x.rule === 'jsonld-parse-error' && /block 1/.test(x.message)));
    assert.ok(f.some((x) => x.rule === 'entity-image-missing' && /No Image/.test(x.message)));
    const sameAs = f.filter((x) => x.rule === 'entity-sameas-invalid');
    assert.equal(sameAs.length, 2);
  });

  it('reports missing @context and Organization logo, and relative images', async () => {
    const ids = await ruleIds(
      head(
        '<script type="application/ld+json">{"@type":"Organization","name":"Acme","image":"/a.png"}</script>',
      ),
    );
    assert.ok(ids.includes('jsonld-context-missing'));
    assert.ok(ids.includes('entity-image-missing'));
    assert.ok(ids.includes('entity-image-relative'));
    assert.ok(ids.includes('entity-sameas-missing'));
  });

  it('a clean page has no errors or warnings', async () => {
    const page = await auditHtml(fixture('home.html'), 'https://example.com/', { checkImages: false });
    const serious = page.findings.filter((f) => f.severity !== 'info');
    assert.deepEqual(serious, []);
  });
});

describe('article rules', () => {
  const article = (inner: string) => head(`<meta property="og:type" content="article">${inner}`);

  it('accepts complete, ordered article times', async () => {
    const ids = await ruleIds(
      article(
        '<meta property="article:published_time" content="2026-11-19T10:30:00+06:00">' +
          '<meta property="article:modified_time" content="2026-11-19T05:00Z">' +
          '<meta property="article:expiration_time" content="2027-01-01">',
      ),
    );
    assert.ok(!ids.some((id) => id.startsWith('article-')), ids.join(', '));
  });

  it('reports a missing published time on articles only', async () => {
    assert.ok((await ruleIds(article(''))).includes('article-published-time-missing'));
    assert.ok(
      !(await ruleIds(head('<meta property="og:type" content="website">'))).includes(
        'article-published-time-missing',
      ),
    );
  });

  it('reports invalid times', async () => {
    const found = await findings(
      article(
        '<meta property="article:published_time" content="19/11/2026">' +
          '<meta property="article:modified_time" content="2026-02-30">',
      ),
      'article-time-invalid',
    );
    assert.equal(found.length, 2);
    assert.match(found[0]!.message, /19\/11\/2026/);
    assert.equal(found[1]!.data?.property, 'article:modified_time');
  });

  it('reports times in the wrong order, comparing offsets', async () => {
    const found = await findings(
      article(
        '<meta property="article:published_time" content="2026-11-19T10:00:00+06:00">' +
          '<meta property="article:modified_time" content="2026-11-19T03:59:00Z">' +
          '<meta property="article:expiration_time" content="2026-11-19T04:00:00Z">',
      ),
      'article-time-order',
    );
    assert.equal(found.length, 2);
    assert.match(found[0]!.message, /modified_time/);
    assert.match(found[1]!.message, /expiration_time/);
  });

  it('reports article properties on non-article pages', async () => {
    const found = await findings(
      head(
        '<meta property="og:type" content="website"><meta property="article:author" content="https://example.com/me">',
      ),
      'article-meta-without-article-type',
    );
    assert.equal(found.length, 1);
    assert.deepEqual(found[0]!.data?.properties, ['article:author']);
  });
});

describe('parseIsoDateTime', () => {
  it('parses dates and date-times with offsets', () => {
    assert.equal(parseIsoDateTime('2026-11-19'), Date.UTC(2026, 10, 19));
    assert.equal(parseIsoDateTime('2026-11-19T10:30:00+06:00'), Date.UTC(2026, 10, 19, 4, 30));
    assert.equal(parseIsoDateTime('2026-11-19T10:30-0130'), Date.UTC(2026, 10, 19, 12, 0));
    assert.equal(parseIsoDateTime('2026-11-19T10:30:15.250Z'), Date.UTC(2026, 10, 19, 10, 30, 15));
    assert.equal(parseIsoDateTime(' 2024-02-29T00:00Z '), Date.UTC(2024, 1, 29));
  });

  it('rejects invalid values', () => {
    for (const bad of [
      '',
      '2026-13-01',
      '2026-02-29',
      '2026-11-19T24:00',
      '19 Nov 2026',
      '2026-11-19T10:30+25:00',
    ]) {
      assert.equal(parseIsoDateTime(bad), undefined, bad);
    }
  });
});
