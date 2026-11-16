import type { ImageInfo, PageMeta, PageResult, Severity } from '../types.js';

export type RuleCategory =
  | 'fetch'
  | 'basics'
  | 'canonical'
  | 'robots'
  | 'opengraph'
  | 'twitter'
  | 'image'
  | 'hreflang'
  | 'icons'
  | 'jsonld'
  | 'entity'
  | 'duplicates';

export interface RuleInfo {
  id: string;
  category: RuleCategory;
  severity: Severity;
  description: string;
  /** Default options. Config options are merged over these. */
  defaults?: Record<string, unknown>;
}

export type Reporter = (message: string, data?: Record<string, unknown>) => void;

export interface PageContext {
  /** The URL that was requested. */
  url: string;
  /** The URL after redirects. Relative metadata is resolved against it. */
  finalUrl: string;
  page: PageResult;
  meta: PageMeta;
  images: Record<string, ImageInfo>;
  options: Record<string, unknown>;
  report: Reporter;
}

export interface FetchContext {
  url: string;
  page: PageResult;
  options: Record<string, unknown>;
  report: Reporter;
}

export type SiteReporter = (
  url: string,
  message: string,
  related?: string[],
  data?: Record<string, unknown>,
) => void;

export interface SiteContext {
  pages: PageResult[];
  options: Record<string, unknown>;
  report: SiteReporter;
}

export interface PageRule extends RuleInfo {
  scope: 'page';
  check(ctx: PageContext): void;
}

export interface FetchRule extends RuleInfo {
  scope: 'fetch';
  check(ctx: FetchContext): void;
}

export interface SiteRule extends RuleInfo {
  scope: 'site';
  check(ctx: SiteContext): void;
}

export type Rule = PageRule | FetchRule | SiteRule;

/** Reads a numeric option with a fallback. */
export function num(options: Record<string, unknown>, key: string, fallback: number): number {
  const v = options[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Reads a boolean option with a fallback. */
export function bool(options: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const v = options[key];
  return typeof v === 'boolean' ? v : fallback;
}

/** Reads a string option with a fallback. */
export function str(options: Record<string, unknown>, key: string, fallback: string): string {
  const v = options[key];
  return typeof v === 'string' ? v : fallback;
}
