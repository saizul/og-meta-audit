# Security policy

## Supported versions

Only the latest release receives fixes.

## Reporting a vulnerability

Please do **not** open a public issue for security problems. Use GitHub's
private vulnerability reporting ("Report a vulnerability" under the
repository's **Security** tab). You will get an answer within a week.

## Scope

og-meta-audit fetches URLs that you give it, plus the image URLs it finds in
those pages and the URLs listed in sitemaps. Keep this in mind:

- **Untrusted pages choose follow-up requests.** A page can point og:image or
  JSON-LD images at any URL, including internal addresses. If you run the
  auditor inside a private network on URLs you do not control, an audited
  page can make it request internal services (server-side request forgery).
  Run it where that is harmless, or pass a custom `fetch` that blocks private
  address ranges.
- **Resource limits.** Every request has a timeout and a byte limit
  (`maxHtmlBytes`, `maxImageBytes`, and a 50 MB limit for sitemaps after
  decompression). Reports of inputs that bypass these limits, or make the
  HTML scanner or sitemap parser take far more than linear time, are in
  scope.
- **Report injection.** The HTML report escapes all page content and contains
  no scripts, and only http(s) URLs become links. Markdown output escapes
  table syntax. Please report any way to get markup or a script executed by
  opening a report.
- **Secrets.** Headers given with `--header` or in the config are sent to
  every audited host and image host. Do not put credentials in a config file
  that is committed; read them from environment variables instead.
