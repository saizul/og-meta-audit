// The command-line interface, written as a function so it can be tested
// without spawning a process.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { audit, exitCodeFor } from '../audit.js';
import { type AuditConfig, ConfigError, DEFAULTS, loadConfig, mergeConfig } from '../config.js';
import { parseUrlList } from '../input.js';
import { formatReport, REPORT_FORMATS, type ReportFormat } from '../report/index.js';
import { listRules, validateRuleSettings } from '../rules/index.js';
import { loadSitemap } from '../sitemap.js';
import type { FetchLike, RuleSetting, Severity } from '../types.js';
import { isAbsoluteHttpUrl } from '../url.js';
import { VERSION } from '../version.js';

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Reads standard input, for `--input -`. */
  readStdin?: () => Promise<string>;
  fetch?: FetchLike;
  cwd?: string;
  /** Whether stdout is a terminal (enables color and progress). */
  isTTY?: boolean;
  env?: Record<string, string | undefined>;
}

export const HELP = `Usage: og-meta-audit [options] [url ...]

Audit titles, descriptions, canonical, robots, Open Graph, Twitter cards,
hreflang, icons and JSON-LD (Person / Organization) across many pages, and
check that og:image files load, have the right type, size and dimensions.

Input (combine freely):
  url ...                      page URLs
  -i, --input <file>           file with one URL per line ("-" for stdin)
  -s, --sitemap <url>          sitemap or sitemap index URL (repeatable)
      --limit <n>              maximum URLs taken from sitemaps (default ${DEFAULTS.sitemapLimit})

Output:
  -f, --format <format>        text, json, markdown or html (default text)
  -o, --output <file>          write the report to a file instead of stdout
      --min-severity <level>   hide findings below error, warn or info (default info)
      --color / --no-color     force or disable ANSI colors
  -q, --quiet                  no progress output on stderr

Checks:
  -c, --config <file>          config file (default: og-meta-audit.config.json if present)
      --disable <rule>         turn a rule off; comma-separated or repeatable; "prefix-*" works
      --rule <rule=severity>   set a rule to error, warn, info or off (repeatable)
      --no-images              do not download images
      --image-method <m>       get (measure images, default) or head (only check they load)
      --fail-on <level>        exit 1 if a finding is at least error, warn or info; or never
      --list-rules             print all rules and exit

Network:
      --concurrency <n>        pages fetched at once (default ${DEFAULTS.concurrency})
      --timeout <ms>           timeout per request (default ${DEFAULTS.timeoutMs})
      --user-agent <ua>        User-Agent header
  -H, --header <name: value>   extra request header (repeatable)

  -h, --help                   show this help
  -v, --version                show the version

Exit codes: 0 no findings at the --fail-on level, 1 findings at that level,
2 usage, config or input error.
`;

class UsageError extends Error {}

const SEVERITIES = ['error', 'warn', 'info'];

function int(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new UsageError(`--${name} must be a positive integer`);
  return n;
}

function parseHeader(value: string): [string, string] {
  const i = value.indexOf(':');
  if (i <= 0) throw new UsageError(`--header must look like "Name: value", got "${value}"`);
  return [value.slice(0, i).trim(), value.slice(i + 1).trim()];
}

function formatRuleList(): string {
  const rules = listRules();
  const width = Math.max(...rules.map((r) => r.id.length));
  const lines = rules.map((r) => {
    const opts = r.defaults ? ` Options: ${JSON.stringify(r.defaults)}` : '';
    return `${r.id.padEnd(width)}  ${r.severity.padEnd(5)}  ${r.scope.padEnd(5)}  ${r.description}${opts}`;
  });
  return `${'rule'.padEnd(width)}  sev    scope  description\n${lines.join('\n')}\n`;
}

/** Runs the CLI and resolves with the exit code. */
export async function run(argv: string[], io: CliIo): Promise<number> {
  try {
    return await runInner(argv, io);
  } catch (err) {
    if (err instanceof UsageError || err instanceof ConfigError) {
      io.stderr(`og-meta-audit: ${err.message}\n`);
      if (err instanceof UsageError) io.stderr('Run og-meta-audit --help for usage.\n');
      return 2;
    }
    io.stderr(`og-meta-audit: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }
}

async function runInner(argv: string[], io: CliIo): Promise<number> {
  let parsed: ReturnType<typeof parseCliArgs>;
  try {
    parsed = parseCliArgs(argv);
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }
  const { values: v, positionals } = parsed;
  const cwd = io.cwd ?? process.cwd();
  const env = io.env ?? {};

  if (v.help) {
    io.stdout(HELP);
    return 0;
  }
  if (v.version) {
    io.stdout(`${VERSION}\n`);
    return 0;
  }
  if (v['list-rules']) {
    io.stdout(formatRuleList());
    return 0;
  }

  const format = (v.format ?? 'text') as ReportFormat;
  if (!REPORT_FORMATS.includes(format))
    throw new UsageError(`--format must be one of ${REPORT_FORMATS.join(', ')}`);
  if (v['min-severity'] && !SEVERITIES.includes(v['min-severity'])) {
    throw new UsageError('--min-severity must be error, warn or info');
  }
  if (v['fail-on'] && ![...SEVERITIES, 'never'].includes(v['fail-on'])) {
    throw new UsageError('--fail-on must be error, warn, info or never');
  }
  if (v['image-method'] && v['image-method'] !== 'get' && v['image-method'] !== 'head') {
    throw new UsageError('--image-method must be get or head');
  }

  const { config: fileConfig } = loadConfig(v.config, cwd);

  const ruleOverrides: Record<string, RuleSetting> = {};
  for (const entry of v.disable ?? []) {
    for (const id of entry
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean))
      ruleOverrides[id] = 'off';
  }
  for (const entry of v.rule ?? []) {
    const [id, sev] = entry.split('=').map((s) => s.trim());
    if (!id || !sev) throw new UsageError(`--rule must look like rule-id=severity, got "${entry}"`);
    ruleOverrides[id] = sev as RuleSetting;
  }
  const problems = validateRuleSettings(ruleOverrides);
  if (problems.length > 0) throw new UsageError(problems.join('; '));

  const headers: Record<string, string> = {};
  for (const h of v.header ?? []) {
    const [name, value] = parseHeader(h);
    headers[name] = value;
  }

  const cliConfig: AuditConfig = { rules: ruleOverrides, headers };
  const concurrency = int(v.concurrency, 'concurrency');
  if (concurrency) cliConfig.concurrency = concurrency;
  const timeout = int(v.timeout, 'timeout');
  if (timeout) cliConfig.timeoutMs = timeout;
  const limit = int(v.limit, 'limit');
  if (limit) cliConfig.sitemapLimit = limit;
  if (v['user-agent']) cliConfig.userAgent = v['user-agent'];
  if (v['no-images']) cliConfig.checkImages = false;
  if (v['image-method']) cliConfig.imageMethod = v['image-method'] as 'get' | 'head';
  if (v['fail-on']) cliConfig.failOn = v['fail-on'] as Severity | 'never';
  const config = mergeConfig(fileConfig, cliConfig);

  const fetchImpl = io.fetch ?? (globalThis.fetch as FetchLike);
  const urls: string[] = [];
  for (const p of positionals) {
    if (!isAbsoluteHttpUrl(p)) throw new UsageError(`Not an absolute http(s) URL: ${p}`);
    urls.push(p);
  }
  if (v.input) {
    let text: string;
    if (v.input === '-') {
      if (!io.readStdin) throw new UsageError('Reading URLs from stdin is not available');
      text = await io.readStdin();
    } else {
      try {
        text = readFileSync(resolve(cwd, v.input), 'utf8');
      } catch (err) {
        throw new UsageError(`Cannot read ${v.input}: ${err instanceof Error ? err.message : err}`);
      }
    }
    const list = parseUrlList(text);
    for (const bad of list.invalid)
      io.stderr(`og-meta-audit: skipping line ${bad.line}: ${bad.text.trim()}\n`);
    urls.push(...list.urls);
  }
  for (const sitemap of v.sitemap ?? []) {
    if (!isAbsoluteHttpUrl(sitemap)) throw new UsageError(`Not an absolute sitemap URL: ${sitemap}`);
    const fromMap = await loadSitemap(sitemap, {
      fetch: fetchImpl,
      timeoutMs: config.timeoutMs ?? DEFAULTS.timeoutMs,
      userAgent: config.userAgent ?? DEFAULTS.userAgent,
      limit: config.sitemapLimit ?? DEFAULTS.sitemapLimit,
    });
    if (fromMap.length === 0) io.stderr(`og-meta-audit: no URLs found in ${sitemap}\n`);
    urls.push(...fromMap);
  }
  const unique = [...new Set(urls)];
  if (unique.length === 0) throw new UsageError('No URLs to audit. Pass URLs, --input or --sitemap.');

  const showProgress = !v.quiet && io.isTTY === true && format === 'text' && !v.output;
  const report = await audit(unique, {
    ...config,
    fetch: fetchImpl,
    onPage: showProgress
      ? (done, total) => io.stderr(`\r${done}/${total} pages${done === total ? '\n' : ''}`)
      : undefined,
  });

  const color = v['no-color']
    ? false
    : (v.color ?? (io.isTTY === true && !v.output && env.NO_COLOR === undefined && env.TERM !== 'dumb'));
  const minSeverity = (v['min-severity'] ?? 'info') as Severity;
  const output = formatReport(report, format, { color, minSeverity, width: 120 });
  if (v.output) {
    writeFileSync(resolve(cwd, v.output), output);
    if (!v.quiet) io.stderr(`og-meta-audit: wrote ${format} report to ${v.output}\n`);
  } else {
    io.stdout(output);
  }
  return exitCodeFor(report, config.failOn ?? DEFAULTS.failOn);
}

function parseCliArgs(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      input: { type: 'string', short: 'i' },
      sitemap: { type: 'string', short: 's', multiple: true },
      limit: { type: 'string' },
      format: { type: 'string', short: 'f' },
      output: { type: 'string', short: 'o' },
      'min-severity': { type: 'string' },
      color: { type: 'boolean' },
      'no-color': { type: 'boolean' },
      quiet: { type: 'boolean', short: 'q' },
      config: { type: 'string', short: 'c' },
      disable: { type: 'string', multiple: true },
      rule: { type: 'string', multiple: true },
      'no-images': { type: 'boolean' },
      'image-method': { type: 'string' },
      'fail-on': { type: 'string' },
      'list-rules': { type: 'boolean' },
      concurrency: { type: 'string' },
      timeout: { type: 'string' },
      'user-agent': { type: 'string' },
      header: { type: 'string', short: 'H', multiple: true },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });
}
