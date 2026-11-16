import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { run } from '../src/cli/run.js';
import { ConfigError, loadConfig, mergeConfig, validateConfig } from '../src/index.js';
import { fakeFetch, fixture, html, image, pngBytes } from './helpers.js';

const E = 'https://example.com';
const dir = mkdtempSync(join(tmpdir(), 'og-meta-audit-'));
after(() => rmSync(dir, { recursive: true, force: true }));

function routes() {
  return fakeFetch({
    [`${E}/`]: html(fixture('home.html')),
    [`${E}/broken`]: html(fixture('broken.html')),
    [`${E}/info`]: html(fixture('home.html').replace('<html lang="en">', '<html>')),
    [`${E}/img/og-home.png`]: image(pngBytes(1200, 630), 'image/png'),
    [`${E}/img/saizul.jpg`]: image(pngBytes(800, 800), 'image/png'),
    [`${E}/img/logo.png`]: image(pngBytes(512, 512), 'image/png'),
    [`${E}/sitemap.xml`]: {
      headers: { 'content-type': 'application/xml' },
      body: `<urlset><url><loc>${E}/</loc></url></urlset>`,
    },
  });
}

async function cli(args: string[], extra: { stdin?: string } = {}) {
  let stdout = '';
  let stderr = '';
  const fetch = routes();
  const code = await run(args, {
    stdout: (t) => {
      stdout += t;
    },
    stderr: (t) => {
      stderr += t;
    },
    fetch,
    cwd: dir,
    readStdin: async () => extra.stdin ?? '',
    env: {},
  });
  return { code, stdout, stderr, fetch };
}

describe('cli', () => {
  it('prints help and version', async () => {
    const help = await cli(['--help']);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /^Usage: og-meta-audit/);
    const v = await cli(['-v']);
    assert.equal(v.stdout, '0.1.0\n');
  });

  it('lists rules', async () => {
    const r = await cli(['--list-rules']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /og-image-aspect-ratio\s+warn\s+page/);
    assert.match(r.stdout, /duplicate-title\s+warn\s+site/);
  });

  it('exits 0 for a clean page and 1 when errors are found', async () => {
    const ok = await cli([`${E}/`]);
    assert.equal(ok.code, 0, ok.stderr);
    assert.match(ok.stdout, /1 page, 0 errors, 0 warnings/);
    const bad = await cli([`${E}/broken`]);
    assert.equal(bad.code, 1);
  });

  it('--fail-on warn and never change the exit code', async () => {
    assert.equal((await cli([`${E}/info`])).code, 0);
    assert.equal((await cli([`${E}/info`, '--fail-on', 'warn'])).code, 0);
    assert.equal((await cli([`${E}/info`, '--fail-on', 'info'])).code, 1);
    assert.equal((await cli([`${E}/broken`, '--fail-on', 'never'])).code, 0);
  });

  it('writes JSON, Markdown and HTML', async () => {
    const json = await cli([`${E}/`, '-f', 'json']);
    assert.equal(JSON.parse(json.stdout).summary.pages, 1);
    const md = await cli([`${E}/`, '--format', 'markdown']);
    assert.match(md.stdout, /^# Social metadata audit/);
    const out = join(dir, 'report.html');
    const h = await cli([`${E}/`, '-f', 'html', '-o', out]);
    assert.equal(h.stdout, '');
    assert.match(readFileSync(out, 'utf8'), /<!DOCTYPE html>/);
    assert.match(h.stderr, /wrote html report/);
  });

  it('reads URLs from a file, stdin and a sitemap', async () => {
    const list = join(dir, 'urls.txt');
    writeFileSync(list, `# list\n${E}/\nnot-a-url\n`);
    const f = await cli(['-i', list, '-f', 'json']);
    assert.equal(JSON.parse(f.stdout).pages.length, 1);
    assert.match(f.stderr, /skipping line 3/);
    const s = await cli(['-i', '-', '-f', 'json'], { stdin: `${E}/broken\n` });
    assert.equal(JSON.parse(s.stdout).pages[0].url, `${E}/broken`);
    const m = await cli(['--sitemap', `${E}/sitemap.xml`, '-f', 'json']);
    assert.equal(JSON.parse(m.stdout).pages[0].url, `${E}/`);
  });

  it('disables rules from flags and from a config file', async () => {
    const base = await cli([`${E}/broken`, '-f', 'json']);
    const all = JSON.parse(base.stdout).summary.byRule;
    assert.ok(all['hreflang-invalid']);
    const flags = await cli([
      `${E}/broken`,
      '-f',
      'json',
      '--disable',
      'hreflang-*,canonical-multiple',
      '--rule',
      'og-image-relative=info',
    ]);
    const byRule = JSON.parse(flags.stdout).summary.byRule;
    assert.equal(byRule['hreflang-invalid'], undefined);
    assert.equal(byRule['canonical-multiple'], undefined);
    const cfg = join(dir, 'og-meta-audit.config.json');
    writeFileSync(cfg, JSON.stringify({ rules: { 'jsonld-*': 'off' }, failOn: 'never' }));
    const c = await cli([`${E}/broken`, '-f', 'json']);
    rmSync(cfg);
    assert.equal(JSON.parse(c.stdout).summary.byRule['jsonld-parse-error'], undefined);
    assert.equal(c.code, 0);
  });

  it('skips images with --no-images and sends headers', async () => {
    const r = await cli([`${E}/`, '--no-images', '-H', 'X-Preview: yes']);
    assert.equal(r.fetch.calls.length, 1);
    assert.equal(r.fetch.calls[0]!.headers['x-preview'], 'yes');
  });

  it('exits 2 on usage and config errors', async () => {
    assert.equal((await cli([])).code, 2);
    assert.equal((await cli(['not-a-url'])).code, 2);
    assert.equal((await cli([`${E}/`, '--format', 'xml'])).code, 2);
    assert.equal((await cli([`${E}/`, '--concurrency', '0'])).code, 2);
    assert.equal((await cli([`${E}/`, '--rule', 'nope=off'])).code, 2);
    assert.equal((await cli([`${E}/`, '--bogus'])).code, 2);
    assert.equal((await cli([`${E}/`, '-c', 'missing.json'])).code, 2);
    const r = await cli([`${E}/`, '-H', 'no colon']);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /Name: value/);
  });
});

describe('config', () => {
  it('validates options and lists every problem', () => {
    assert.deepEqual(validateConfig({ concurrency: 2, rules: { 'title-length': ['warn', { max: 70 }] } }), {
      concurrency: 2,
      rules: { 'title-length': ['warn', { max: 70 }] },
    });
    assert.throws(
      () =>
        validateConfig({
          concurrency: 0,
          nope: 1,
          imageMethod: 'post',
          rules: { x: 'off' },
          headers: { a: 1 },
        }),
      (err: Error) =>
        err instanceof ConfigError &&
        /concurrency/.test(err.message) &&
        /Unknown option "nope"/.test(err.message) &&
        /imageMethod/.test(err.message) &&
        /Unknown rule "x"/.test(err.message) &&
        /headers/.test(err.message),
    );
    assert.throws(() => validateConfig([]), ConfigError);
  });

  it('loads JSON files and reports invalid JSON', () => {
    const p = join(dir, 'c.json');
    writeFileSync(p, '{"timeoutMs": 5000, "$schema": "x"}');
    assert.deepEqual(loadConfig('c.json', dir).config, { timeoutMs: 5000 });
    writeFileSync(p, '{ nope');
    assert.throws(() => loadConfig('c.json', dir), /invalid JSON/);
    assert.deepEqual(loadConfig(undefined, join(dir, 'nowhere')).config, {});
  });

  it('merges configs with rules and headers combined', () => {
    assert.deepEqual(
      mergeConfig(
        { concurrency: 2, rules: { a: 'off' }, headers: { x: '1' } },
        { rules: { b: 'warn' }, headers: { y: '2' } },
      ),
      { concurrency: 2, rules: { a: 'off', b: 'warn' }, headers: { x: '1', y: '2' } },
    );
  });
});
