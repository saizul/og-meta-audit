# og-meta-audit

[![CI](https://github.com/saizul/og-meta-audit/actions/workflows/ci.yml/badge.svg)](https://github.com/saizul/og-meta-audit/actions/workflows/ci.yml)
![Node 20+](https://img.shields.io/badge/node-20%2B-blue)
![Zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
![License: MIT](https://img.shields.io/badge/license-MIT-green)

Audit the metadata that decides how your pages look when they are shared or
shown in search: title, meta description, canonical, robots, Open Graph,
Twitter cards, hreflang, favicons and JSON-LD Person / Organization data.
It runs across many URLs at once, downloads every `og:image` to check that it
loads and has the right type, file size and **real pixel dimensions**, and
compares pages with each other to find duplicate titles and a person or brand
that uses a different photo or logo on different pages.

It is a library and a CLI, has **zero runtime dependencies**, uses the global
`fetch` of Node 20+, and ships ESM, CommonJS and type declarations.

```console
$ og-meta-audit --sitemap https://example.com/sitemap.xml --min-severity warn
og-meta-audit 0.1.0

Status  Err  Warn  Info  URL
200     0    0     1     https://example.com/
200     1    2     0     https://example.com/about/
200     0    3     2     https://example.com/blog/migrate/

https://example.com/about/
  error  og-image-entity-mismatch  og:image differs from the image of Person "Saizul Amin"
  warn   og-image-aspect-ratio     og:image aspect ratio is 1.00:1 (800x800); 1.91:1 is recommended
  warn   description-length        Description is 48 characters (minimum 70)

Across pages
  warn   entity-image-inconsistent  Person "Saizul Amin" uses 2 different images across 3 pages
      + https://example.com/
      + https://example.com/about/
      + https://example.com/blog/migrate/

3 pages, 1 error, 5 warnings, 3 info in 2.4 s
```

## Why

Share previews break quietly. Nobody notices that the `og:image` of the about
page is a 404, that a CMS update made every blog post use the same
description, or that the JSON-LD on the home page still points to last year's
headshot while the about page uses the new one. Search engines and social
platforms then pick whatever they find, and the person or brand looks
different depending on which page was shared.

Most tools check one URL at a time and stop at "the tag exists".
og-meta-audit fetches the images, parses their headers to get the actual size,
and looks across all pages of a site.

## Features

- **Input**: URLs as arguments, a file of URLs (or stdin), and sitemaps,
  including sitemap indexes and gzip-compressed sitemaps.
- **Extraction** with a forgiving HTML scanner: `<title>` (never an SVG
  title), meta description, canonical, robots (meta and `X-Robots-Tag`),
  `<html lang>`, all `og:*` and `twitter:*` properties, hreflang alternates,
  favicon / apple-touch-icon / mask-icon, `<base href>`, and every JSON-LD
  block, with `@graph`, nested nodes and `@id` references resolved.
- **Entities**: Person and Organization (and subtypes such as LocalBusiness)
  with name, url, image, logo and sameAs.
- **Image checks**: status, Content-Type, byte size, format sniffed from the
  file, and pixel dimensions parsed from PNG, JPEG, GIF, WebP (lossy,
  lossless, extended), AVIF, BMP, ICO and SVG headers. Declared
  `og:image:width` / `og:image:height` are compared with the real size, and
  the 1.91:1 (1200 x 630) recommendation is checked.
- **Consistency**: the same Person image and Organization logo across pages,
  `og:image` versus the Person image on profile and about pages, sameAs lists,
  entity names and `og:site_name`. Different URLs count as the same image when
  they redirect to the same file or have identical bytes (SHA-256).
- **Article metadata**: on `og:type` article pages, `article:published_time`,
  `article:modified_time` and `article:expiration_time` must be ISO 8601 and
  in order (offsets are compared in UTC), and `article:*` properties on other
  page types are flagged because platforms ignore them.
- **Duplicates** of titles, meta descriptions and `og:title` across pages.
- **hreflang** code validation (`en_US` and `en-UK` are caught), duplicates,
  self references, `x-default`, and missing return links between audited
  pages.
- **86 rules** with stable IDs, three severities and options. A JSON config
  file turns rules off, changes severities and sets thresholds; `prefix-*`
  patterns work.
- **Output**: a terminal table, JSON, Markdown (for pull requests and job
  summaries) and a self-contained HTML report.
- **CI friendly**: exit code 1 when findings reach `--fail-on`, exit code 2
  for usage errors; concurrency limit, timeouts and byte limits on every
  request; each image is downloaded once per run.

## Install

The package is published to GitHub Packages as `@saizul/og-meta-audit`. Tell
npm where to find the `@saizul` scope by adding this line to an `.npmrc` file
in your project (or in your home directory):

```ini
@saizul:registry=https://npm.pkg.github.com
```

GitHub Packages needs a token to install, even for public packages. Create a
personal access token with the `read:packages` scope and expose it as
`NODE_AUTH_TOKEN`, then reference it from `.npmrc`:

```ini
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

```bash
npm install --save-dev @saizul/og-meta-audit   # in a project
npm install --global @saizul/og-meta-audit     # for the CLI everywhere
npx @saizul/og-meta-audit https://example.com/  # without installing
```

Requires Node 20 or newer.

## Usage

### CLI

```bash
# A few pages
og-meta-audit https://example.com/ https://example.com/about/

# Every URL in a sitemap (indexes are followed), up to 300 pages
og-meta-audit --sitemap https://example.com/sitemap.xml --limit 300

# A list of URLs, one per line; "-" reads stdin
og-meta-audit --input urls.txt
cat urls.txt | og-meta-audit -i -

# Reports
og-meta-audit -i urls.txt --format json --output audit.json
og-meta-audit -i urls.txt --format markdown >> "$GITHUB_STEP_SUMMARY"
og-meta-audit -i urls.txt --format html --output audit.html

# Only show what matters, fail CI on warnings too
og-meta-audit -i urls.txt --min-severity warn --fail-on warn

# Rules
og-meta-audit --list-rules
og-meta-audit -i urls.txt --disable hreflang-*,apple-touch-icon-missing --rule title-length=error

# Network
og-meta-audit -i urls.txt --concurrency 10 --timeout 8000 -H "Authorization: Basic $STAGING_AUTH"
og-meta-audit -i urls.txt --no-images            # skip image downloads
og-meta-audit -i urls.txt --image-method head    # only check that images load
```

### Library

```js
import { audit, formatMarkdown, exitCodeFor } from '@saizul/og-meta-audit';

const report = await audit(['https://example.com/', 'https://example.com/about/'], {
  concurrency: 4,
  timeoutMs: 10_000,
  rules: {
    'apple-touch-icon-missing': 'off',
    'title-length': ['warn', { max: 65 }],
  },
});

for (const page of report.pages) {
  console.log(page.url, page.meta?.title, page.findings.length);
}
console.log(report.siteFindings); // duplicates and consistency problems
console.log(formatMarkdown(report));
process.exitCode = exitCodeFor(report, 'error');
```

Only the HTML of one page, without fetching it:

```js
import { auditHtml, extractMeta } from '@saizul/og-meta-audit';

const page = await auditHtml(html, 'https://example.com/post/'); // images are not downloaded
const meta = extractMeta(html, 'https://example.com/post/'); // just the extracted data
meta.og['og:image']; // ['https://example.com/cover.png']
meta.entities; // [{ type: 'Person', name: 'Saizul Amin', images: [...], sameAs: [...] }]
```

Image dimensions from bytes you already have:

```js
import { imageDimensions } from '@saizul/og-meta-audit';

imageDimensions(bytes); // { format: 'webp', width: 1200, height: 630 }
```

## Configuration

The CLI reads `og-meta-audit.config.json` (or `.og-meta-auditrc.json`) from the
working directory, or the file given with `--config`. Command-line flags win
over the file. The same keys can be passed to `audit()`.

```json
{
  "concurrency": 4,
  "timeoutMs": 10000,
  "failOn": "error",
  "sitemapLimit": 200,
  "userAgent": "my-site-audit/1.0",
  "headers": { "X-Preview": "1" },
  "checkImages": true,
  "imageMethod": "get",
  "maxHtmlBytes": 5242880,
  "maxImageBytes": 15728640,
  "rules": {
    "apple-touch-icon-missing": "off",
    "hreflang-*": "off",
    "title-length": ["warn", { "min": 25, "max": 65 }],
    "og-image-aspect-ratio": ["warn", { "tolerance": 0.1 }],
    "og-image-entity-mismatch": ["error", { "scope": "all" }],
    "duplicate-title": "error"
  }
}
```

| Key | Default | Meaning |
| --- | --- | --- |
| `concurrency` | `5` | Pages fetched at the same time. |
| `timeoutMs` | `15000` | Timeout per request, including reading the body. |
| `userAgent` | `og-meta-audit/<version> (+repo URL)` | User-Agent header. |
| `headers` | `{}` | Extra request headers. Do not commit secrets; pass them with `-H` from an environment variable. |
| `checkImages` | `true` | Download og:image, twitter:image and JSON-LD images. |
| `imageMethod` | `get` | `head` checks only that images load, without dimensions or hashes. |
| `maxHtmlBytes` | 5 MB | HTML read per page. |
| `maxImageBytes` | 15 MB | Bytes read per image. Larger images are measured from their header and sized from `Content-Length`. |
| `sitemapLimit` | `500` | URLs taken from sitemaps. |
| `failOn` | `error` | `error`, `warn`, `info` or `never`. |
| `rules` | `{}` | `"id": "off" \| "info" \| "warn" \| "error"` or `[severity, options]`. Keys ending in `*` match by prefix; exact IDs win. |

Unknown keys, unknown rule IDs and wrong types are reported with exit code 2,
so a typo in a rule ID never goes unnoticed.

## Rules

`og-meta-audit --list-rules` prints this list. Scope `fetch` and `page` rules
look at one page; `site` rules compare pages.

| Rule | Severity | Scope | What it checks |
| --- | --- | --- | --- |
| `fetch-failed` | error | fetch | The page could not be fetched (network error, DNS failure or timeout). |
| `http-status` | error | fetch | The page answered with a 4xx or 5xx status code. |
| `not-html` | warn | fetch | The response is not an HTML document. |
| `redirected` | info | fetch | The URL redirects. Share links and sitemaps should use the final URL. |
| `slow-response` | info | fetch | The HTML took longer than `maxMs` to download. Some crawlers give up on slow pages. Options: `maxMs` (3000). |
| `title-missing` | error | page | The page has no <title> or an empty one. |
| `title-multiple` | warn | page | The page has more than one <title> element. |
| `title-length` | warn | page | The title is shorter than `min` or longer than `max` characters. Options: `min` (30), `max` (60). |
| `description-missing` | warn | page | The page has no meta description or an empty one. |
| `description-multiple` | warn | page | The page has more than one meta description. |
| `description-length` | warn | page | The meta description is shorter than `min` or longer than `max` characters. Options: `min` (70), `max` (160). |
| `lang-missing` | info | page | The <html> element has no lang attribute. |
| `canonical-missing` | warn | page | The page has no <link rel="canonical">. |
| `canonical-multiple` | error | page | The page declares more than one canonical URL. Search engines may ignore all of them. |
| `canonical-relative` | warn | page | The canonical URL is relative. Use an absolute URL. |
| `canonical-mismatch` | info | page | The canonical URL points to a different URL than the audited page. |
| `canonical-cross-host` | warn | page | The canonical URL is on another host than the page. |
| `canonical-insecure` | warn | page | An https page declares an http canonical URL. |
| `robots-noindex` | warn | page | The robots meta tag or X-Robots-Tag header contains noindex (or none). |
| `robots-nofollow` | info | page | The robots meta tag contains nofollow. |
| `robots-nosnippet` | info | page | nosnippet or max-image-preview:none limits how the page is shown in previews. |
| `og-title-missing` | warn | page | The page has no og:title property. Platforms fall back to the <title>, which is often longer. |
| `og-description-missing` | warn | page | The page has no og:description property. Previews may show no text or random page text. |
| `og-url-missing` | info | page | The page has no og:url property. Likes and shares may be split across URL variants. |
| `og-type-missing` | info | page | The page has no og:type property. Facebook treats the page as "website". |
| `og-site-name-missing` | info | page | The page has no og:site_name property. Previews will not show the site or brand name. |
| `og-image-missing` | error | page | The page has no og:image. Shared links show no picture or a random one. |
| `og-image-relative` | error | page | og:image must be an absolute http(s) URL. Most platforms ignore relative paths. |
| `og-image-insecure` | warn | page | og:image uses http. Some platforms refuse to load insecure images. |
| `og-image-multiple` | info | page | More than one og:image. Most platforms use the first one only. |
| `og-image-dimensions-missing` | info | page | og:image:width and og:image:height are not declared. Facebook cannot render the image on the first share without them. |
| `og-image-alt-missing` | info | page | og:image:alt is missing. Screen readers describe shared images with it. |
| `og-title-length` | info | page | og:title is longer than `max` characters and will be cut in most previews. Options: `max` (90). |
| `og-description-length` | info | page | og:description is longer than `max` characters. Options: `max` (200). |
| `og-url-mismatch` | warn | page | og:url differs from the canonical URL. Share counts get split between the two. |
| `og-type-unknown` | info | page | og:type is not a standard Open Graph type and has no namespace prefix. |
| `og-locale-invalid` | info | page | og:locale should look like language_TERRITORY, for example en_US or bn_BD. |
| `og-title-same-as-site-name` | info | page | og:title only repeats og:site_name, so previews do not say what the page is about. |
| `article-published-time-missing` | info | page | An og:type article page has no article:published_time. Facebook, LinkedIn and news aggregators show and sort by it. |
| `article-time-invalid` | warn | page | article:published_time, article:modified_time or article:expiration_time is not an ISO 8601 date or date-time (2026-11-19T10:30:00+06:00). |
| `article-time-order` | warn | page | article:modified_time is earlier than article:published_time, or article:expiration_time is not after it. |
| `article-meta-without-article-type` | info | page | The page has article:* properties but og:type is not article, so platforms ignore them. Set og:type to article. |
| `twitter-card-missing` | warn | page | No twitter:card. X shows a small summary card or none at all. |
| `twitter-card-invalid` | error | page | twitter:card must be summary, summary_large_image, app or player. |
| `twitter-title-missing` | info | page | Neither twitter:title nor og:title is present. |
| `twitter-description-missing` | info | page | Neither twitter:description nor og:description is present. |
| `twitter-image-missing` | warn | page | A summary_large_image card has no twitter:image and no og:image fallback. |
| `twitter-image-relative` | error | page | twitter:image must be an absolute URL. |
| `twitter-site-invalid` | info | page | twitter:site and twitter:creator should be @handles. |
| `og-image-unreachable` | error | page | The og:image URL does not load (error status, network error or timeout). |
| `og-image-content-type` | error | page | The og:image is not served with an image/* Content-Type, or the type does not match the file. |
| `og-image-format` | warn | page | The og:image format (SVG, AVIF, ICO or BMP) is not rendered by most social platforms. Use JPEG or PNG. |
| `og-image-too-large` | warn | page | The og:image file is larger than `maxBytes` (default 5 MB, the X limit; Facebook allows 8 MB). Options: `maxBytes` (5242880). |
| `og-image-too-small` | error | page | The og:image is smaller than `minWidth` x `minHeight` (default 200 x 200, the Facebook minimum). Options: `minWidth` (200), `minHeight` (200). |
| `og-image-below-recommended` | warn | page | The og:image is smaller than the recommended `width` x `height` (default 1200 x 630). Options: `width` (1200), `height` (630). |
| `og-image-aspect-ratio` | warn | page | The og:image aspect ratio is far from `ratio` (default 1.91:1, as in 1200 x 630). Platforms crop it. `tolerance` is relative; `skipSummaryCards` skips pages with a square summary card. Options: `ratio` (1.91), `tolerance` (0.08), `skipSummaryCards` (false). |
| `og-image-dimension-mismatch` | warn | page | og:image:width / og:image:height do not match the actual pixel size of the image. |
| `twitter-image-unreachable` | error | page | twitter:image differs from og:image and does not load. |
| `entity-image-unreachable` | warn | page | A JSON-LD Person image or Organization logo does not load. |
| `og-image-entity-mismatch` | warn | page | On a profile or about page, og:image is a different picture than the JSON-LD Person image. Set `scope` to "all" to check every page with a Person. Options: `scope` ("profile"). |
| `hreflang-invalid` | error | page | An hreflang value is not a valid language[-Script][-REGION] code or x-default. |
| `hreflang-relative` | warn | page | hreflang alternates should use absolute URLs. |
| `hreflang-duplicate` | error | page | The same hreflang value points to more than one URL. |
| `hreflang-self-missing` | warn | page | The hreflang set does not include the page itself (or its canonical). |
| `hreflang-x-default-missing` | info | page | The hreflang set has no x-default entry. |
| `favicon-missing` | warn | page | No <link rel="icon">. Browsers request /favicon.ico, and search results may show a generic icon. |
| `apple-touch-icon-missing` | info | page | No apple-touch-icon. iOS home-screen shortcuts and some apps use it. |
| `jsonld-missing` | info | page | The page has no JSON-LD structured data. |
| `jsonld-parse-error` | error | page | A JSON-LD block is not valid JSON. Search engines ignore the whole block. |
| `jsonld-context-missing` | warn | page | A JSON-LD block does not reference schema.org in @context. |
| `jsonld-type-missing` | warn | page | A top-level JSON-LD node has no @type. |
| `entity-name-missing` | warn | page | A Person or Organization node has no name. |
| `entity-image-missing` | warn | page | A Person has no image, or an Organization has no logo. Knowledge panels and rich results use them. |
| `entity-sameas-missing` | info | page | A Person or Organization has no sameAs links to its profiles. |
| `entity-sameas-invalid` | warn | page | A sameAs value is not an absolute http(s) URL, or is listed twice. Options: `requireHttps` (false). |
| `entity-image-relative` | warn | page | A Person image or Organization logo is not an absolute URL in the JSON-LD source. |
| `duplicate-title` | warn | site | Two or more audited pages share the same title. Pages marked noindex and pages that canonicalize to another page are skipped unless `includeNoindex` is true. Options: `includeNoindex` (false). |
| `duplicate-description` | warn | site | Two or more audited pages share the same meta description. Pages marked noindex and pages that canonicalize to another page are skipped unless `includeNoindex` is true. Options: `includeNoindex` (false). |
| `duplicate-og-title` | warn | site | Two or more audited pages share the same og:title. Pages marked noindex and pages that canonicalize to another page are skipped unless `includeNoindex` is true. Options: `includeNoindex` (false). |
| `entity-image-inconsistent` | warn | site | The same Person (matched by @id, or by name) uses a different image on different pages of a site. Images that redirect to the same file or have identical bytes count as the same. |
| `entity-logo-inconsistent` | warn | site | The same Organization (matched by @id, or by name) uses a different logo on different pages of a site. Images that redirect to the same file or have identical bytes count as the same. |
| `entity-name-inconsistent` | warn | site | The same @id has different names on different pages. |
| `entity-sameas-inconsistent` | info | site | The same Person or Organization lists different sameAs profiles on different pages. |
| `profile-og-image-inconsistent` | info | site | Profile and about pages of the same site use different og:image pictures, so the person or brand looks different depending on the shared page. |
| `og-site-name-inconsistent` | warn | site | Pages of the same site use different og:site_name values. |
| `hreflang-return-link-missing` | warn | site | Page A lists page B as an hreflang alternate, B was audited, but B does not link back to A. Search engines ignore one-way hreflang. |

### How images are compared

Two image URLs are treated as the same picture when they are equal after
normalization (scheme and host case, default port, fragment, trailing slash),
when both redirect to the same final URL, or when both were downloaded in full
and have the same SHA-256 hash. So `https://cdn.example.com/me.jpg?v=2` and
`https://example.com/img/me.jpg` count as one image if the bytes are
identical.

Entities are matched across pages by `@id`, or by type and name when there is
no `@id`. Pages count as profile pages when `og:type` is `profile`, the JSON-LD
has a `ProfilePage` or `AboutPage` node, or the page URL is the Person's `url`.

## API

| Export | Description |
| --- | --- |
| `audit(urls, options?)` | Audits pages and returns an `AuditReport` (`pages`, `siteFindings`, `summary`). |
| `auditHtml(html, url, options?)` | Audits an HTML string as if it were served at `url`. |
| `exitCodeFor(report, failOn?)` | `1` when any finding reaches `failOn` (default `error`), else `0`. |
| `allFindings(report)` | Page and site findings in one list. |
| `extractMeta(html, url)` | `PageMeta`: titles, descriptions, canonicals, robots, `og`, `twitter`, `article`, hreflang, icons, JSON-LD blocks, entities. |
| `ogImageUrl(meta, url)`, `twitterImageUrl(meta, url)` | The resolved image URLs of a page. |
| `parseJsonLdBlocks(sources)`, `extractEntities(blocks, url)` | JSON-LD parsing with `@graph` and `@id` merging. |
| `imageDimensions(bytes)` | `{ format, width?, height? }` from the first bytes of PNG, JPEG, GIF, WebP, AVIF, BMP, ICO or SVG. |
| `probeImage(url, options)`, `ImageCache` | Download and measure one image; cached per URL. |
| `sameImage(a, b, images)`, `clusterImages(urls, images)` | The comparison described above. |
| `loadSitemap(url, options)`, `parseSitemap(xml)` | Sitemaps and sitemap indexes, gzip included. |
| `parseUrlList(text)` | URL lists with comments; reports invalid lines. |
| `rules`, `listRules()`, `getRule(id)` | The rule registry. |
| `resolveRules(settings)`, `runPageRules(page, resolved)`, `runSiteRules(pages, resolved)` | The rules engine, for custom pipelines. |
| `loadConfig(path?, cwd?)`, `validateConfig(obj)`, `mergeConfig(...configs)` | Config files. |
| `formatText`, `formatJson`, `formatMarkdown`, `formatHtml`, `formatReport(report, format)` | Reporters. |
| `isValidHreflang(code)`, `textLength(text)`, `normalizeForCompare(url)`, `parseIsoDateTime(value)` | Helpers. |

All types (`AuditReport`, `PageResult`, `PageMeta`, `Finding`, `ImageInfo`,
`JsonLdEntity`, `RuleSetting`, ...) are exported.

`options.fetch` accepts any function with the signature of `fetch`. Use it to
add caching, a proxy agent, authentication, or to run the auditor against
fixtures in tests.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | No finding at or above `--fail-on` (default `error`). |
| `1` | At least one finding at or above `--fail-on`. |
| `2` | Usage error, invalid config, unreadable input or a sitemap that could not be loaded. |

## Examples

The [`examples`](examples) folder has:

- [`offline.mjs`](examples/offline.mjs): an audit with a fake fetch, no network needed
- [`audit-site.mjs`](examples/audit-site.mjs): audit URLs from the command line and write an HTML report
- [`commonjs.cjs`](examples/commonjs.cjs): `require()` usage
- [`og-meta-audit.config.json`](examples/og-meta-audit.config.json): a config file
- [`urls.txt`](examples/urls.txt): a URL list
- [`github-workflow.yml`](examples/github-workflow.yml): a nightly sitemap audit in GitHub Actions that writes the Markdown report to the job summary

## Testing

```bash
npm ci
npm test              # builds ESM + CJS, compiles the tests, runs node:test
npm run lint          # biome lint + tsc --noEmit
npm run format:check  # biome format, no changes
```

The tests never touch the network. A fake `fetch` serves fixture HTML from
`test/fixtures/` and image headers built byte by byte in `test/helpers.ts`, and
covers redirects, HTTP errors, network errors, timeouts, legacy charsets,
sitemaps (gzip and indexes) and the CLI with all output formats. CI runs on
Node 20 and 22.

## Limitations

- **No JavaScript rendering.** Pages are read as served. Metadata injected by
  client-side JavaScript is not seen, which matches what most social
  crawlers see.
- **Not a full HTML5 parser.** The scanner handles real-world markup
  (comments, raw-text elements, SVG and MathML, unquoted attributes), but
  exotic broken markup may be read differently than a browser would.
- **Lengths are counted in characters**, not in pixels. Search engines cut
  titles by width, so the defaults (30 to 60 for titles, 70 to 160 for
  descriptions) are a rule of thumb. Adjust them with rule options.
- **Image dimensions** come from file headers. JPEG EXIF orientation is not
  applied, so a rotated photo reports its stored width and height. SVG sizes
  are only known when `width`/`height` or `viewBox` are set.
- **Identical-image detection** needs the full file. Images larger than
  `maxImageBytes`, and `--image-method head`, are compared by URL only.
- **Platform rules change.** The size and format checks follow the published
  Open Graph and X card guidance at the time of writing (minimum 200 x 200,
  1200 x 630 recommended, 5 MB for X). Tune them in the config when a
  platform changes its limits.
- **No robots.txt handling.** The auditor fetches the URLs you give it. Use it
  on sites you own or are allowed to audit, and keep `--concurrency` modest.
- **Sitemaps** are read up to `--limit` URLs, three levels of indexes deep.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [code of conduct](CODE_OF_CONDUCT.md).
Security issues: see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) (c) 2026 Saizul Amin
