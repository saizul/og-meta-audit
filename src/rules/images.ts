// Rules that need the downloaded og:image, twitter:image and entity images.

import { first, ogImageUrl, twitterImageUrl } from '../extract.js';
import { formatMimeType } from '../image/dimensions.js';
import { sameImage } from '../image/compare.js';
import { nodeTypes } from '../jsonld.js';
import type { ImageInfo, PageMeta } from '../types.js';
import { normalizeForCompare, resolveUrl } from '../url.js';
import { type PageContext, type PageRule, bool, num, str } from './types.js';

const UNSUPPORTED_FORMATS = new Set(['svg', 'avif', 'ico', 'bmp']);

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/** The probed og:image of a page, when there is one and it was downloaded. */
function ogImage(ctx: PageContext): { url: string; info: ImageInfo } | undefined {
  const url = ogImageUrl(ctx.meta, ctx.finalUrl);
  const info = url ? ctx.images[url] : undefined;
  return url && info ? { url, info } : undefined;
}

/**
 * True for pages that present a person: og:type "profile", a ProfilePage or
 * AboutPage node, or a page whose URL is the Person's url.
 */
export function isProfilePage(meta: PageMeta, pageUrl: string): boolean {
  if ((first(meta.og, 'og:type') ?? '').toLowerCase() === 'profile') return true;
  const nodes = meta.jsonld.flatMap((b) => b.nodes);
  if (nodes.some((n) => nodeTypes(n).some((t) => t === 'ProfilePage' || t === 'AboutPage'))) return true;
  const here = normalizeForCompare(pageUrl);
  const canonical = meta.canonical ? resolveUrl(meta.canonical, pageUrl) : undefined;
  return meta.entities.some(
    (e) =>
      e.type === 'Person' &&
      e.url !== undefined &&
      (normalizeForCompare(e.url) === here ||
        (canonical && normalizeForCompare(e.url) === normalizeForCompare(canonical))),
  );
}

export const imageRules: PageRule[] = [
  {
    id: 'og-image-unreachable',
    scope: 'page',
    category: 'image',
    severity: 'error',
    description: 'The og:image URL does not load (error status, network error or timeout).',
    check(ctx) {
      const img = ogImage(ctx);
      if (img && !img.info.ok)
        ctx.report(`og:image does not load: ${img.info.error ?? 'unknown error'}`, { image: img.url });
    },
  },
  {
    id: 'og-image-content-type',
    scope: 'page',
    category: 'image',
    severity: 'error',
    description:
      'The og:image is not served with an image/* Content-Type, or the type does not match the file.',
    check(ctx) {
      const img = ogImage(ctx);
      if (!img?.info.ok) return;
      const type = img.info.contentType ?? '';
      if (!type.startsWith('image/')) {
        ctx.report(`og:image is served as "${type || 'no content type'}"`, {
          image: img.url,
          contentType: type,
        });
      } else if (img.info.format) {
        const expected = formatMimeType(img.info.format);
        const alias = type === 'image/jpg' || type === 'image/pjpeg' ? 'image/jpeg' : type;
        if (alias !== expected && !(img.info.format === 'ico' && type === 'image/vnd.microsoft.icon')) {
          ctx.report(`og:image is served as ${type} but the file is ${img.info.format}`, {
            image: img.url,
            contentType: type,
            format: img.info.format,
          });
        }
      }
    },
  },
  {
    id: 'og-image-format',
    scope: 'page',
    category: 'image',
    severity: 'warn',
    description:
      'The og:image format (SVG, AVIF, ICO or BMP) is not rendered by most social platforms. Use JPEG or PNG.',
    check(ctx) {
      const img = ogImage(ctx);
      if (img?.info.format && UNSUPPORTED_FORMATS.has(img.info.format)) {
        ctx.report(`og:image is ${img.info.format.toUpperCase()}; use JPEG or PNG`, { image: img.url });
      }
    },
  },
  {
    id: 'og-image-too-large',
    scope: 'page',
    category: 'image',
    severity: 'warn',
    description:
      'The og:image file is larger than `maxBytes` (default 5 MB, the X limit; Facebook allows 8 MB).',
    defaults: { maxBytes: 5 * 1024 * 1024 },
    check(ctx) {
      const img = ogImage(ctx);
      const max = num(ctx.options, 'maxBytes', 5 * 1024 * 1024);
      if (img?.info.bytes !== undefined && img.info.bytes > max) {
        ctx.report(`og:image is ${formatBytes(img.info.bytes)} (limit ${formatBytes(max)})`, {
          image: img.url,
          bytes: img.info.bytes,
        });
      }
    },
  },
  {
    id: 'og-image-too-small',
    scope: 'page',
    category: 'image',
    severity: 'error',
    description:
      'The og:image is smaller than `minWidth` x `minHeight` (default 200 x 200, the Facebook minimum).',
    defaults: { minWidth: 200, minHeight: 200 },
    check(ctx) {
      const img = ogImage(ctx);
      const { width, height } = img?.info ?? {};
      if (!img || width === undefined || height === undefined) return;
      const minW = num(ctx.options, 'minWidth', 200);
      const minH = num(ctx.options, 'minHeight', 200);
      if (width < minW || height < minH) {
        ctx.report(`og:image is ${width}x${height}, below the ${minW}x${minH} minimum`, {
          image: img.url,
          width,
          height,
        });
      }
    },
  },
  {
    id: 'og-image-below-recommended',
    scope: 'page',
    category: 'image',
    severity: 'warn',
    description: 'The og:image is smaller than the recommended `width` x `height` (default 1200 x 630).',
    defaults: { width: 1200, height: 630 },
    check(ctx) {
      const img = ogImage(ctx);
      const { width, height } = img?.info ?? {};
      if (!img || width === undefined || height === undefined) return;
      const w = num(ctx.options, 'width', 1200);
      const h = num(ctx.options, 'height', 630);
      const minW = 200;
      if (width < minW || height < minW) return; // og-image-too-small covers this
      if (width < w || height < h) {
        ctx.report(`og:image is ${width}x${height}; ${w}x${h} or larger is recommended`, {
          image: img.url,
          width,
          height,
        });
      }
    },
  },
  {
    id: 'og-image-aspect-ratio',
    scope: 'page',
    category: 'image',
    severity: 'warn',
    description:
      'The og:image aspect ratio is far from `ratio` (default 1.91:1, as in 1200 x 630). Platforms crop it. `tolerance` is relative; `skipSummaryCards` skips pages with a square summary card.',
    defaults: { ratio: 1.91, tolerance: 0.08, skipSummaryCards: false },
    check(ctx) {
      const img = ogImage(ctx);
      const { width, height } = img?.info ?? {};
      if (!img || !width || !height) return;
      const isSummary = first(ctx.meta.twitter, 'twitter:card') === 'summary';
      if (bool(ctx.options, 'skipSummaryCards', false) && isSummary) return;
      const target = num(ctx.options, 'ratio', 1.91);
      const tolerance = num(ctx.options, 'tolerance', 0.08);
      const ratio = width / height;
      if (Math.abs(ratio - target) / target > tolerance) {
        ctx.report(
          `og:image aspect ratio is ${ratio.toFixed(2)}:1 (${width}x${height}); ${target}:1 is recommended`,
          {
            image: img.url,
            ratio: Number(ratio.toFixed(3)),
          },
        );
      }
    },
  },
  {
    id: 'og-image-dimension-mismatch',
    scope: 'page',
    category: 'image',
    severity: 'warn',
    description: 'og:image:width / og:image:height do not match the actual pixel size of the image.',
    check(ctx) {
      const img = ogImage(ctx);
      const { width, height } = img?.info ?? {};
      if (!img || width === undefined || height === undefined) return;
      const dw = Number(first(ctx.meta.og, 'og:image:width'));
      const dh = Number(first(ctx.meta.og, 'og:image:height'));
      if (!Number.isFinite(dw) || !Number.isFinite(dh) || dw <= 0 || dh <= 0) return;
      if (dw !== width || dh !== height) {
        ctx.report(`og:image declares ${dw}x${dh} but is ${width}x${height}`, {
          image: img.url,
          declared: [dw, dh],
          actual: [width, height],
        });
      }
    },
  },
  {
    id: 'twitter-image-unreachable',
    scope: 'page',
    category: 'image',
    severity: 'error',
    description: 'twitter:image differs from og:image and does not load.',
    check(ctx) {
      const url = twitterImageUrl(ctx.meta, ctx.finalUrl);
      if (!url || url === ogImageUrl(ctx.meta, ctx.finalUrl)) return;
      const info = ctx.images[url];
      if (info && !info.ok)
        ctx.report(`twitter:image does not load: ${info.error ?? 'unknown error'}`, { image: url });
    },
  },
  {
    id: 'entity-image-unreachable',
    scope: 'page',
    category: 'entity',
    severity: 'warn',
    description: 'A JSON-LD Person image or Organization logo does not load.',
    check(ctx) {
      for (const e of ctx.meta.entities) {
        for (const url of [...e.images.slice(0, 1), ...e.logos.slice(0, 1)]) {
          const info = ctx.images[url];
          if (info && !info.ok) {
            ctx.report(`${e.type} image ${url} does not load: ${info.error ?? 'unknown error'}`, {
              image: url,
            });
          }
        }
      }
    },
  },
  {
    id: 'og-image-entity-mismatch',
    scope: 'page',
    category: 'entity',
    severity: 'warn',
    description:
      'On a profile or about page, og:image is a different picture than the JSON-LD Person image. Set `scope` to "all" to check every page with a Person.',
    defaults: { scope: 'profile' },
    check(ctx) {
      const og = ogImageUrl(ctx.meta, ctx.finalUrl);
      if (!og) return;
      if (str(ctx.options, 'scope', 'profile') !== 'all' && !isProfilePage(ctx.meta, ctx.finalUrl)) return;
      for (const e of ctx.meta.entities) {
        if (e.type !== 'Person' || e.images.length === 0) continue;
        if (!e.images.some((img) => sameImage(img, og, ctx.images))) {
          ctx.report(`og:image differs from the image of Person "${e.name ?? e.id ?? 'unnamed'}"`, {
            ogImage: og,
            entityImage: e.images[0],
          });
        }
      }
    },
  },
];
