// The rule registry and the engine that runs rules with config overrides.

import type { Finding, PageResult, RuleSetting, Severity } from '../types.js';
import { basicRules, fetchRules } from './basics.js';
import { imageRules } from './images.js';
import { hreflangRules, iconRules } from './links.js';
import { siteRules } from './site.js';
import { openGraphRules, twitterRules } from './social.js';
import { jsonLdRules } from './structured.js';
import type { FetchRule, PageRule, Rule, RuleInfo, SiteRule } from './types.js';

export type { FetchRule, PageRule, Rule, RuleInfo, SiteRule } from './types.js';

/** Every built-in rule, in the order they run and are listed. */
export const rules: readonly Rule[] = [
  ...fetchRules,
  ...basicRules,
  ...openGraphRules,
  ...twitterRules,
  ...imageRules,
  ...hreflangRules,
  ...iconRules,
  ...jsonLdRules,
  ...siteRules,
];

const SEVERITIES = new Set(['error', 'warn', 'info', 'off']);

/** Looks up a rule by id. */
export function getRule(id: string): Rule | undefined {
  return rules.find((r) => r.id === id);
}

/** Lists rule metadata, for documentation and `--list-rules`. */
export function listRules(): (RuleInfo & { scope: Rule['scope'] })[] {
  return rules.map(({ id, category, severity, description, defaults, scope }) => {
    const info: RuleInfo & { scope: Rule['scope'] } = { id, category, severity, description, scope };
    if (defaults) info.defaults = defaults;
    return info;
  });
}

export interface ResolvedRule<R extends Rule = Rule> {
  rule: R;
  severity: Severity;
  options: Record<string, unknown>;
}

/** Validates rule settings. Returns a list of problems (unknown ids, bad severities). */
export function validateRuleSettings(settings: Record<string, RuleSetting>): string[] {
  const problems: string[] = [];
  for (const [id, setting] of Object.entries(settings)) {
    if (!getRule(id) && !id.endsWith('*')) problems.push(`Unknown rule "${id}"`);
    const sev = Array.isArray(setting) ? setting[0] : setting;
    if (typeof sev !== 'string' || !SEVERITIES.has(sev)) {
      problems.push(`Rule "${id}": severity must be error, warn, info or off`);
    }
    if (
      Array.isArray(setting) &&
      setting[1] !== undefined &&
      (typeof setting[1] !== 'object' || setting[1] === null)
    ) {
      problems.push(`Rule "${id}": options must be an object`);
    }
  }
  return problems;
}

/**
 * Applies config settings to the registry. A key ending in `*` matches rule
 * ids by prefix, for example `"hreflang-*": "off"`. Exact ids win over
 * prefixes.
 */
export function resolveRules(settings: Record<string, RuleSetting> = {}): ResolvedRule[] {
  const prefixes = Object.entries(settings)
    .filter(([k]) => k.endsWith('*'))
    .sort((a, b) => b[0].length - a[0].length);
  const out: ResolvedRule[] = [];
  for (const rule of rules) {
    const setting = settings[rule.id] ?? prefixes.find(([k]) => rule.id.startsWith(k.slice(0, -1)))?.[1];
    let severity: Severity | 'off' = rule.severity;
    let options: Record<string, unknown> = { ...rule.defaults };
    if (setting !== undefined) {
      if (Array.isArray(setting)) {
        severity = setting[0];
        options = { ...options, ...setting[1] };
      } else {
        severity = setting;
      }
    }
    if (severity === 'off') continue;
    out.push({ rule, severity, options });
  }
  return out;
}

/** Runs fetch and page rules for one page and returns the findings. */
export function runPageRules(page: PageResult, resolved: readonly ResolvedRule[]): Finding[] {
  const findings: Finding[] = [];
  const finalUrl = page.finalUrl ?? page.url;
  for (const { rule, severity, options } of resolved) {
    const report = (message: string, data?: Record<string, unknown>) => {
      const f: Finding = { rule: rule.id, severity, message, url: page.url };
      if (data) f.data = data;
      findings.push(f);
    };
    if (rule.scope === 'fetch') {
      (rule as FetchRule).check({ url: page.url, page, options, report });
    } else if (rule.scope === 'page' && page.meta && page.ok) {
      (rule as PageRule).check({
        url: page.url,
        finalUrl,
        page,
        meta: page.meta,
        images: page.images,
        options,
        report,
      });
    }
  }
  return findings;
}

/** Runs site rules across all pages. */
export function runSiteRules(pages: PageResult[], resolved: readonly ResolvedRule[]): Finding[] {
  const findings: Finding[] = [];
  // Map final URLs back to the URL that was requested, so findings line up with the input.
  const requested = new Map<string, string>();
  for (const p of pages) requested.set(p.finalUrl ?? p.url, p.url);
  for (const { rule, severity, options } of resolved) {
    if (rule.scope !== 'site') continue;
    (rule as SiteRule).check({
      pages,
      options,
      report(url, message, related, data) {
        const f: Finding = { rule: rule.id, severity, message, url: requested.get(url) ?? url };
        if (related && related.length > 0) f.related = related.map((r) => requested.get(r) ?? r);
        if (data) f.data = data;
        findings.push(f);
      },
    });
  }
  return findings;
}

const RANK: Record<Severity, number> = { error: 3, warn: 2, info: 1 };

/** Compares severities: positive when `a` is more serious than `b`. */
export function compareSeverity(a: Severity, b: Severity): number {
  return RANK[a] - RANK[b];
}

/** True when `severity` is at least as serious as `threshold`. */
export function atLeast(severity: Severity, threshold: Severity): boolean {
  return RANK[severity] >= RANK[threshold];
}
