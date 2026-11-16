import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import * as esm from '../src/index.js';

const require = createRequire(import.meta.url);

describe('package', () => {
  it('the CommonJS build exposes the same API', () => {
    const cjs = require('../cjs/index.js') as typeof esm;
    assert.deepEqual(Object.keys(cjs).sort(), Object.keys(esm).sort());
    assert.equal(cjs.textLength('abc'), 3);
    assert.equal(cjs.rules.length, esm.rules.length);
  });

  it('the CommonJS folder is marked as commonjs', () => {
    const pkg = JSON.parse(readFileSync(new URL('../cjs/package.json', import.meta.url), 'utf8'));
    assert.equal(pkg.type, 'commonjs');
  });

  it('has no runtime dependencies and versions agree', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    assert.equal(pkg.dependencies, undefined);
    assert.equal(pkg.version, esm.VERSION);
    assert.equal(pkg.bin['og-meta-audit'], './dist/esm/cli.js');
  });

  it('the CLI entry starts with a shebang', () => {
    const cli = readFileSync(new URL('../esm/cli.js', import.meta.url), 'utf8');
    assert.ok(cli.startsWith('#!/usr/bin/env node'));
  });
});
