# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Open Graph article rules: `article-published-time-missing` (info), `article-time-invalid` (warn: published,
  modified or expiration time is not ISO 8601), `article-time-order` (warn: modified before published, or
  expiration not after it; offsets are compared in UTC) and `article-meta-without-article-type` (info: `article:*`
  properties on a page whose `og:type` is not article).
- `PageMeta.article` holds every `article:*` property; `parseIsoDateTime()` is exported.
- A code of conduct, issue forms and a pull request template.

## [0.1.0] - 2026-11-16

### Added

- `audit()` for many URLs with a concurrency limit, per-request timeouts,
  byte limits, a custom User-Agent and extra headers; `auditHtml()` for a
  single HTML string.
- Input from URL arguments, URL list files or stdin, and sitemaps (urlset,
  sitemap index, gzip).
- A forgiving HTML scanner and `extractMeta()`: title, meta description,
  canonical, robots meta and `X-Robots-Tag`, `<html lang>`, Open Graph,
  Twitter cards, hreflang, favicon, apple-touch-icon and `<base href>`.
- JSON-LD parsing of every block, with `@graph`, nested nodes and `@id`
  merging; Person and Organization extraction with name, url, image, logo
  and sameAs.
- Image probing with status, Content-Type, byte size, SHA-256 and pixel
  dimensions parsed from PNG, JPEG, GIF, WebP, AVIF, BMP, ICO and SVG
  headers; one download per image per run.
- 82 rules with IDs, severities and options, including og:image size,
  aspect ratio and declared-versus-actual dimensions, duplicate titles and
  descriptions, hreflang validation and return links, and consistency of
  Person images, Organization logos, sameAs, names and `og:site_name`
  across pages.
- JSON config file with rule overrides and `prefix-*` patterns.
- Terminal, JSON, Markdown and HTML reports.
- CLI with `--fail-on`, `--min-severity`, `--list-rules`, `--disable`,
  `--rule` and exit codes 0, 1 and 2.
- ESM and CommonJS builds with type declarations; no runtime dependencies.

[Unreleased]: https://github.com/saizul/og-meta-audit/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/saizul/og-meta-audit/releases/tag/v0.1.0
