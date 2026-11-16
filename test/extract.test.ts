import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  entityKey,
  extractEntities,
  extractMeta,
  first,
  nodeTypes,
  ogImageUrl,
  parseJsonLdBlocks,
  twitterImageUrl,
} from '../src/index.js';
import { fixture } from './helpers.js';

describe('extractMeta', () => {
  const meta = extractMeta(fixture('home.html'), 'https://example.com/');

  it('reads title, description, canonical, robots and lang', () => {
    assert.equal(meta.title, 'Saizul Amin \u2013 Web Developer and Technical SEO');
    assert.match(meta.description!, /^Saizul Amin builds fast websites/);
    assert.equal(meta.canonical, 'https://example.com/');
    assert.deepEqual(meta.robots, ['index', 'follow', 'max-image-preview:large']);
    assert.equal(meta.lang, 'en');
  });

  it('does not take the SVG title as page title', () => {
    assert.deepEqual(meta.titles, ['Saizul Amin \u2013 Web Developer and Technical SEO']);
  });

  it('collects Open Graph and Twitter properties', () => {
    assert.equal(first(meta.og, 'og:image:width'), '1200');
    assert.equal(first(meta.og, 'og:site_name'), 'Saizul Amin');
    assert.equal(first(meta.twitter, 'twitter:card'), 'summary_large_image');
    assert.equal(ogImageUrl(meta, 'https://example.com/'), 'https://example.com/img/og-home.png');
  });

  it('resolves icons', () => {
    assert.deepEqual(
      meta.icons.map((i) => [i.rel, i.resolved, i.sizes]),
      [
        ['icon', 'https://example.com/favicon.ico', '32x32'],
        ['apple-touch-icon', 'https://example.com/apple-touch-icon.png', undefined],
      ],
    );
  });

  it('extracts Person and Organization from @graph', () => {
    assert.equal(meta.entities.length, 2);
    const person = meta.entities.find((e) => e.type === 'Person')!;
    assert.equal(person.name, 'Saizul Amin');
    assert.deepEqual(person.images, ['https://example.com/img/saizul.jpg']);
    assert.deepEqual(person.sameAs, ['https://github.com/saizul', 'https://www.linkedin.com/in/saizul']);
    const org = meta.entities.find((e) => e.type === 'Organization')!;
    assert.deepEqual(org.types, ['Organization', 'ProfessionalService']);
    assert.deepEqual(org.logos, ['https://example.com/img/logo.png']);
    assert.deepEqual(org.sameAs, ['https://github.com/saizul']);
  });

  it('accepts og:* written with name= and twitter:* written with property=', () => {
    const m = extractMeta(
      '<meta name="og:title" content="A"><meta property="twitter:card" content="summary">',
      'https://e.com/',
    );
    assert.equal(first(m.og, 'og:title'), 'A');
    assert.equal(first(m.twitter, 'twitter:card'), 'summary');
  });

  it('keeps repeated properties in order', () => {
    const m = extractMeta(
      '<meta property="og:image" content="https://e.com/1.png"><meta property="og:image" content="https://e.com/2.png">',
      'https://e.com/',
    );
    assert.deepEqual(m.og['og:image'], ['https://e.com/1.png', 'https://e.com/2.png']);
  });

  it('resolves relative URLs against <base href>', () => {
    const m = extractMeta(
      '<base href="https://cdn.e.com/site/"><meta property="og:image" content="x.png"><link rel="icon" href="fav.png"><meta name="twitter:image" content="t.png">',
      'https://e.com/page',
    );
    assert.equal(m.icons[0]!.resolved, 'https://cdn.e.com/site/fav.png');
    assert.equal(twitterImageUrl(m, 'https://e.com/page'), 'https://e.com/t.png');
  });

  it('reads robots from googlebot too and splits tokens', () => {
    const m = extractMeta('<meta name="googlebot" content="NOINDEX,  nofollow">', 'https://e.com/');
    assert.deepEqual(m.robots, ['noindex', 'nofollow']);
  });

  it('treats "shortcut icon" as a favicon but not a lone "shortcut"', () => {
    const m = extractMeta(
      '<link rel="shortcut icon" href="/a.ico"><link rel="shortcut" href="/b.ico">',
      'https://e.com/',
    );
    assert.equal(m.icons.length, 1);
    assert.equal(m.icons[0]!.resolved, 'https://e.com/a.ico');
  });

  it('collects hreflang links and multiple canonicals from a broken page', () => {
    const m = extractMeta(fixture('broken.html'), 'https://example.com/broken');
    assert.equal(m.title, undefined);
    assert.deepEqual(m.canonicals, ['/one', 'https://example.com/two']);
    assert.deepEqual(
      m.hreflang.map((h) => h.lang),
      ['en_US', 'en-UK', 'bn', 'bn'],
    );
    assert.equal(m.jsonld.length, 2);
    assert.ok(m.jsonld[0]!.error);
    assert.equal(m.jsonld[1]!.error, undefined);
  });
});

describe('JSON-LD', () => {
  it('flattens nested nodes and merges nodes that share an @id', () => {
    const blocks = parseJsonLdBlocks([
      JSON.stringify({ '@context': 'https://schema.org', '@type': 'Article', author: { '@id': '#me' } }),
      JSON.stringify({ '@context': 'https://schema.org', '@id': '#me', '@type': 'Person', name: 'Rahim' }),
      JSON.stringify({ '@id': '#me', image: 'https://e.com/me.jpg' }),
    ]);
    const entities = extractEntities(blocks, 'https://e.com/');
    assert.equal(entities.length, 1);
    assert.equal(entities[0]!.name, 'Rahim');
    assert.deepEqual(entities[0]!.images, ['https://e.com/me.jpg']);
  });

  it('reads images from arrays, ImageObject contentUrl and @id references', () => {
    const blocks = parseJsonLdBlocks([
      JSON.stringify({
        '@graph': [
          { '@type': 'ImageObject', '@id': '#logo', url: '/logo.png' },
          {
            '@type': 'Organization',
            name: 'Acme',
            logo: { '@id': '#logo' },
            image: [{ contentUrl: 'https://e.com/a.jpg' }],
          },
        ],
      }),
    ]);
    const [org] = extractEntities(blocks, 'https://e.com/x/');
    assert.deepEqual(org!.logos, ['https://e.com/logo.png']);
    assert.deepEqual(org!.images, ['https://e.com/a.jpg']);
  });

  it('accepts schema.org-prefixed types and subtypes of Organization', () => {
    assert.deepEqual(nodeTypes({ '@type': ['schema:LocalBusiness', 'https://schema.org/Store'] }), [
      'LocalBusiness',
      'Store',
    ]);
    const [e] = extractEntities(
      parseJsonLdBlocks(['{"@type":"https://schema.org/Corporation","name":"C"}']),
      'https://e.com/',
    );
    assert.equal(e!.type, 'Organization');
  });

  it('strips HTML comment and CDATA wrappers', () => {
    const blocks = parseJsonLdBlocks([
      '<!-- {"@type":"Person","name":"A"} -->',
      '//<![CDATA[\n{"@type":"Person","name":"B"}\n//]]>',
    ]);
    assert.deepEqual(
      blocks.map((b) => b.error),
      [undefined, undefined],
    );
    assert.equal(extractEntities(blocks, 'https://e.com/').length, 2);
  });

  it('reports invalid and empty blocks', () => {
    const blocks = parseJsonLdBlocks(['{"a":', '  ']);
    assert.ok(blocks[0]!.error);
    assert.equal(blocks[1]!.error, 'empty block');
  });

  it('skips bare references and uses legalName when name is missing', () => {
    const blocks = parseJsonLdBlocks([
      '{"@type":"Article","author":{"@type":"Person","@id":"#p"}}',
      '{"@type":"Organization","legalName":"Acme Ltd"}',
    ]);
    const entities = extractEntities(blocks, 'https://e.com/');
    assert.equal(entities.length, 1);
    assert.equal(entities[0]!.name, 'Acme Ltd');
  });

  it('builds entity keys from @id or type and name', () => {
    assert.equal(
      entityKey({ type: 'Person', types: [], id: 'https://e.com/#p', images: [], logos: [], sameAs: [] }),
      'Person:https://e.com/#p',
    );
    assert.equal(
      entityKey({ type: 'Person', types: [], name: 'Ana', images: [], logos: [], sameAs: [] }),
      'Person:name:ana',
    );
    assert.equal(
      entityKey({ type: 'Person', types: [], id: '_:b0', images: [], logos: [], sameAs: [] }),
      undefined,
    );
  });
});
