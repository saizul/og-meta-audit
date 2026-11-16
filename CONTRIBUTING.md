# Contributing

Thanks for helping improve og-meta-audit. The most useful reports are pages
where the auditor gets something wrong: a false positive, a missed problem,
or metadata it fails to read.

## Reporting a bug

Open an issue with:

- the command or code you ran and the output you expected
- the smallest HTML that reproduces the problem (a few `<meta>` tags are
  usually enough), or the public URL if you are allowed to share it
- for image problems, the image URL or the first bytes of the file
  (`xxd image.jpg | head -20`)
- your Node version (`node --version`)

Please do not paste private pages, staging passwords or tokens.

## Development setup

You need Node 20 or newer.

```console
$ git clone https://github.com/saizul/og-meta-audit.git
$ cd og-meta-audit
$ npm ci
$ npm test              # builds ESM + CJS, compiles the tests and runs node:test
$ npm run lint          # biome lint + tsc --noEmit
$ npm run format        # biome format --write
$ npm run format:check  # what CI runs
```

Try the CLI from the build with `node dist/esm/cli.js https://example.com/`.

## Guidelines

- **Zero runtime dependencies.** Only the Node standard library and the
  global `fetch`. Development tools go in `devDependencies`.
- **No network in tests.** Use `fakeFetch()` and the fixtures in
  `test/fixtures/`. Image tests build file headers byte by byte in
  `test/helpers.ts`; add a builder there for a new format.
- **New rules** go in the matching file in `src/rules/`, need a unique
  kebab-case ID, a default severity, a one-sentence description that says
  why it matters, and defaults for any options. Add a test that triggers the
  rule and one that shows a correct page does not. Then regenerate the rule
  table in the README from `node dist/esm/cli.js --list-rules`.
- **Rule IDs are public API.** People disable rules by ID in their configs,
  so do not rename or remove a rule outside a major release.
- **Cite the platform documentation** in the pull request when a rule is
  based on a platform limit (image size, format, card type).
- Every change comes with a test and a line in the `Unreleased` section of
  `CHANGELOG.md`.

## Project layout

```text
src/
  audit.ts          pipeline: fetch pages, probe images, run rules
  cli.ts, cli/      command-line interface
  config.ts         options, config file loading and validation
  extract.ts        PageMeta from HTML
  fetcher.ts        fetch with timeout, byte limit, charset decoding
  html/             HTML scanner and entity decoding
  image/            header parsing, probing, image comparison
  jsonld.ts         JSON-LD blocks and Person / Organization entities
  report/           text, JSON, Markdown and HTML reporters
  rules/            rule definitions and the rules engine
  sitemap.ts        sitemap and sitemap index loading
test/               node:test suites, fixtures and the fake fetch
examples/           runnable scripts and sample config
```
