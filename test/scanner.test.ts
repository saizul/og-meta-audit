import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { collapseWhitespace, decodeEntities, parseAttributes, scanHtml } from '../src/index.js';

describe('decodeEntities', () => {
  it('decodes named, decimal and hex references', () => {
    assert.equal(
      decodeEntities('A &amp; B &ndash; C &#8217; &#x2014; &copy;'),
      'A & B \u2013 C \u2019 \u2014 \u00a9',
    );
  });

  it('leaves unknown names and bare ampersands alone', () => {
    assert.equal(decodeEntities('Tom & Jerry &unknown; &'), 'Tom & Jerry &unknown; &');
  });

  it('accepts references without a semicolon and rejects invalid code points', () => {
    assert.equal(decodeEntities('&amp &#65'), '& A');
    assert.equal(decodeEntities('&#0; &#xD800; &#x110000;'), '\ufffd \ufffd \ufffd');
  });

  it('collapses whitespace including no-break spaces', () => {
    assert.equal(collapseWhitespace('  a \n\t b\u00a0\u00a0c  '), 'a b c');
  });
});

describe('parseAttributes', () => {
  it('handles double, single, unquoted and bare attributes', () => {
    assert.deepEqual(parseAttributes(` a="1" b='2' c=3 d e = "five" `), {
      a: '1',
      b: '2',
      c: '3',
      d: '',
      e: 'five',
    });
  });

  it('lower-cases names, keeps the first duplicate and decodes values', () => {
    assert.deepEqual(parseAttributes(`CONTENT="Fish &amp; Chips" content="x"`), { content: 'Fish & Chips' });
  });
});

describe('scanHtml', () => {
  it('finds metadata elements in order and reads title text', () => {
    const els = scanHtml(
      '<html lang="bn"><head><title>Hi &amp; bye</title><meta name="a" content="b"></head></html>',
    );
    assert.deepEqual(
      els.map((e) => e.name),
      ['html', 'title', 'meta'],
    );
    assert.equal(els[1]!.text, 'Hi &amp; bye');
    assert.equal(els[0]!.attrs.lang, 'bn');
  });

  it('skips comments, doctype and processing instructions', () => {
    const els = scanHtml('<!DOCTYPE html><?xml x?><!-- <title>no</title> --><title>yes</title>');
    assert.equal(els.length, 1);
    assert.equal(els[0]!.text, 'yes');
  });

  it('ignores <title> inside SVG and MathML', () => {
    const els = scanHtml(
      '<body><svg><g><title>icon</title></g></svg><math><title>m</title></math><title>real</title>',
    );
    assert.deepEqual(
      els.map((e) => e.text),
      ['real'],
    );
  });

  it('handles self-closing svg', () => {
    const els = scanHtml('<svg/><title>t</title>');
    assert.equal(els[0]!.text, 't');
  });

  it('does not treat markup inside scripts and styles as tags', () => {
    const els = scanHtml(
      '<script>var s = "<meta name=x content=y>";</script><style>a>b{}</style><meta name="real" content="1">',
    );
    assert.equal(els.filter((e) => e.name === 'meta').length, 1);
    assert.equal(els[0]!.text, 'var s = "<meta name=x content=y>";');
  });

  it('keeps > inside quoted attribute values', () => {
    const els = scanHtml('<meta name="description" content="a > b">');
    assert.equal(els[0]!.attrs.content, 'a > b');
  });

  it('marks elements after the body starts', () => {
    const els = scanHtml('<head><meta name="a" content="1"></head><body><p>x</p><meta name="b" content="2">');
    assert.equal(els[0]!.inBody, false);
    assert.equal(els[1]!.inBody, true);
  });

  it('survives unterminated markup', () => {
    assert.doesNotThrow(() => scanHtml('<title>never closed'));
    assert.doesNotThrow(() => scanHtml('<meta name="x'));
    assert.doesNotThrow(() => scanHtml('<<<>>> < a'));
    assert.equal(scanHtml('<title>never closed')[0]!.text, 'never closed');
  });
});
