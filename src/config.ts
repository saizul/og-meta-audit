// Audit options and the JSON config file.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateRuleSettings } from './rules/index.js';
import type { FetchLike, RuleSetting, Severity } from './types.js';
import { VERSION } from './version.js';

/** Options accepted by the config file and by `audit()`. */
export interface AuditConfig {
  /** Maximum pages fetched at the same time. Default 5. */
  concurrency?: number;
  /** Timeout per request in milliseconds. Default 15000. */
  timeoutMs?: number;
  /** User-Agent header. */
  userAgent?: string;
  /** Extra request headers, for example a staging password header. */
  headers?: Record<string, string>;
  /** Download og:image, twitter:image and JSON-LD images. Default true. */
  checkImages?: boolean;
  /** `get` (default) reads the image to measure it; `head` only checks that it loads. */
  imageMethod?: 'get' | 'head';
  /** Maximum HTML bytes read per page. Default 5 MB. */
  maxHtmlBytes?: number;
  /** Maximum bytes read per image. Default 15 MB. */
  maxImageBytes?: number;
  /** Maximum URLs taken from a sitemap. Default 500. */
  sitemapLimit?: number;
  /** Lowest severity that makes the CLI exit with code 1. Default `error`. */
  failOn?: Severity | 'never';
  /** Rule overrides: `"rule-id": "off" | "info" | "warn" | "error"` or `[severity, options]`. */
  rules?: Record<string, RuleSetting>;
}

export interface AuditOptions extends AuditConfig {
  /** Fetch implementation. Defaults to the global `fetch`. */
  fetch?: FetchLike;
  /** Called after each page is audited. */
  onPage?: (done: number, total: number, url: string) => void;
}

export const DEFAULT_USER_AGENT = `og-meta-audit/${VERSION} (+https://github.com/saizul/og-meta-audit)`;

export const DEFAULTS = {
  concurrency: 5,
  timeoutMs: 15_000,
  userAgent: DEFAULT_USER_AGENT,
  checkImages: true,
  imageMethod: 'get' as const,
  maxHtmlBytes: 5 * 1024 * 1024,
  maxImageBytes: 15 * 1024 * 1024,
  sitemapLimit: 500,
  failOn: 'error' as const,
};

/** File names looked up in the working directory when no config path is given. */
export const CONFIG_FILES = ['og-meta-audit.config.json', '.og-meta-auditrc.json', '.og-meta-auditrc'];

export class ConfigError extends Error {
  override name = 'ConfigError';
}

const KNOWN_KEYS = new Set([
  '$schema',
  'concurrency',
  'timeoutMs',
  'userAgent',
  'headers',
  'checkImages',
  'imageMethod',
  'maxHtmlBytes',
  'maxImageBytes',
  'sitemapLimit',
  'failOn',
  'rules',
]);

function positiveInt(value: unknown, key: string, problems: string[]): void {
  if (value !== undefined && (typeof value !== 'number' || !Number.isInteger(value) || value < 1)) {
    problems.push(`"${key}" must be a positive integer`);
  }
}

/** Checks a parsed config object and throws a ConfigError listing every problem. */
export function validateConfig(config: unknown, source = 'config'): AuditConfig {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new ConfigError(`${source}: expected a JSON object`);
  }
  const c = config as Record<string, unknown>;
  const problems: string[] = [];
  for (const key of Object.keys(c)) if (!KNOWN_KEYS.has(key)) problems.push(`Unknown option "${key}"`);
  for (const key of ['concurrency', 'timeoutMs', 'maxHtmlBytes', 'maxImageBytes', 'sitemapLimit']) {
    positiveInt(c[key], key, problems);
  }
  if (c.userAgent !== undefined && typeof c.userAgent !== 'string')
    problems.push('"userAgent" must be a string');
  if (c.checkImages !== undefined && typeof c.checkImages !== 'boolean')
    problems.push('"checkImages" must be a boolean');
  if (c.imageMethod !== undefined && c.imageMethod !== 'get' && c.imageMethod !== 'head') {
    problems.push('"imageMethod" must be "get" or "head"');
  }
  if (c.failOn !== undefined && !['error', 'warn', 'info', 'never'].includes(c.failOn as string)) {
    problems.push('"failOn" must be error, warn, info or never');
  }
  if (c.headers !== undefined) {
    if (typeof c.headers !== 'object' || c.headers === null || Array.isArray(c.headers)) {
      problems.push('"headers" must be an object');
    } else if (Object.values(c.headers).some((v) => typeof v !== 'string')) {
      problems.push('"headers" values must be strings');
    }
  }
  if (c.rules !== undefined) {
    if (typeof c.rules !== 'object' || c.rules === null || Array.isArray(c.rules)) {
      problems.push('"rules" must be an object');
    } else {
      problems.push(...validateRuleSettings(c.rules as Record<string, RuleSetting>));
    }
  }
  if (problems.length > 0) throw new ConfigError(`${source}:\n  - ${problems.join('\n  - ')}`);
  const { $schema: _ignored, ...rest } = c;
  return rest as AuditConfig;
}

/**
 * Loads a config file. With an explicit path the file must exist. Without
 * one, the first of CONFIG_FILES found in `cwd` is used, or `{}`.
 */
export function loadConfig(path?: string, cwd = process.cwd()): { config: AuditConfig; path?: string } {
  let file: string | undefined;
  if (path) {
    file = resolve(cwd, path);
    if (!existsSync(file)) throw new ConfigError(`Config file not found: ${file}`);
  } else {
    file = CONFIG_FILES.map((f) => resolve(cwd, f)).find((f) => existsSync(f));
    if (!file) return { config: {} };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new ConfigError(`${file}: invalid JSON (${err instanceof Error ? err.message : err})`);
  }
  return { config: validateConfig(parsed, file), path: file };
}

/** Merges configs: later ones win, and `rules` and `headers` are merged key by key. */
export function mergeConfig(...configs: (AuditConfig | undefined)[]): AuditConfig {
  const out: AuditConfig = {};
  for (const c of configs) {
    if (!c) continue;
    const { rules, headers, ...rest } = c;
    for (const [k, v] of Object.entries(rest)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
    if (rules) out.rules = { ...out.rules, ...rules };
    if (headers) out.headers = { ...out.headers, ...headers };
  }
  return out;
}
