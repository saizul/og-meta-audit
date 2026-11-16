/** Severity of a finding, from most to least serious. */
export type Severity = 'error' | 'warn' | 'info';

/** A rule setting in the config file: a severity, `off`, or a tuple with options. */
export type RuleSetting = Severity | 'off' | [Severity | 'off', Record<string, unknown>?];

/** The fetch signature the auditor needs. The global `fetch` satisfies it. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** A single problem found on a page or across pages. */
export interface Finding {
  /** Stable rule identifier, for example `og-image-missing`. */
  rule: string;
  severity: Severity;
  message: string;
  /** The page the finding belongs to. Site-level findings use the first affected page. */
  url: string;
  /** Other pages involved, for duplicate and consistency rules. */
  related?: string[];
  /** Extra machine-readable details. */
  data?: Record<string, unknown>;
}

/** A `<link rel="alternate" hreflang>` entry. */
export interface HreflangLink {
  lang: string;
  href: string;
  /** The href resolved against the page URL, or undefined when invalid. */
  resolved?: string;
}

/** An icon link (favicon, apple-touch-icon, mask-icon). */
export interface IconLink {
  rel: string;
  href: string;
  resolved?: string;
  sizes?: string;
  type?: string;
}

/** Person or Organization data found in JSON-LD. */
export interface JsonLdEntity {
  type: 'Person' | 'Organization';
  /** All types of the node, for example `['Organization', 'LocalBusiness']`. */
  types: string[];
  id?: string;
  name?: string;
  url?: string;
  /** Image URLs (Person `image`, or Organization `image`). */
  images: string[];
  /** Organization `logo` URLs. */
  logos: string[];
  sameAs: string[];
}

/** One `<script type="application/ld+json">` block. */
export interface JsonLdBlock {
  index: number;
  raw: string;
  /** Parse error message, when the block is not valid JSON. */
  error?: string;
  /** All nodes found, including nodes inside `@graph`. */
  nodes: Record<string, unknown>[];
}

/** Everything extracted from the HTML of one page. */
export interface PageMeta {
  lang?: string;
  titles: string[];
  title?: string;
  descriptions: string[];
  description?: string;
  canonicals: string[];
  canonical?: string;
  robots: string[];
  /** All `og:*` properties. Repeated properties keep every value in order. */
  og: Record<string, string[]>;
  /** All `twitter:*` metadata. */
  twitter: Record<string, string[]>;
  hreflang: HreflangLink[];
  icons: IconLink[];
  jsonld: JsonLdBlock[];
  entities: JsonLdEntity[];
}

/** Result of probing an image URL. */
export interface ImageInfo {
  url: string;
  ok: boolean;
  status?: number;
  error?: string;
  contentType?: string;
  /** Size in bytes, from Content-Length or the bytes read. */
  bytes?: number;
  /** Image format detected from the file header. */
  format?: ImageFormat;
  width?: number;
  height?: number;
  /** Hex digest of the bytes read, used to detect the same image behind different URLs. */
  hash?: string;
  /** Final URL after redirects. */
  finalUrl?: string;
}

export type ImageFormat = 'png' | 'jpeg' | 'gif' | 'webp' | 'bmp' | 'svg' | 'avif' | 'ico';

/** Result of fetching one page. */
export interface PageResult {
  url: string;
  finalUrl?: string;
  status?: number;
  ok: boolean;
  error?: string;
  contentType?: string;
  redirected: boolean;
  /** The X-Robots-Tag response header, when present. */
  robotsHeader?: string;
  /** Time spent fetching the HTML, in milliseconds. */
  timeMs?: number;
  meta?: PageMeta;
  /** Probe results for og:image, twitter:image and entity images on this page. */
  images: Record<string, ImageInfo>;
  findings: Finding[];
}

export interface AuditSummary {
  pages: number;
  failedPages: number;
  errors: number;
  warnings: number;
  infos: number;
  byRule: Record<string, number>;
}

export interface AuditReport {
  tool: { name: string; version: string };
  startedAt: string;
  durationMs: number;
  pages: PageResult[];
  /** Findings that span several pages (duplicates, consistency). */
  siteFindings: Finding[];
  summary: AuditSummary;
}
