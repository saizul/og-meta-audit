// Rules that compare pages with each other: duplicates and consistency of the
// person or brand identity across a site.

import { first, ogImageUrl } from '../extract.js';
import { clusterImages } from '../image/compare.js';
import { entityKey } from '../jsonld.js';
import type { ImageInfo, JsonLdEntity, PageResult } from '../types.js';
import { normalizeForCompare, resolveUrl, siteOf } from '../url.js';
import { isProfilePage } from './images.js';
import { type SiteRule, bool } from './types.js';

function pageUrl(p: PageResult): string {
  return p.finalUrl ?? p.url;
}

function isNoindex(p: PageResult): boolean {
  const tokens = [...(p.meta?.robots ?? []), ...(p.robotsHeader ?? '').toLowerCase().split(/[,\s]+/)];
  return tokens.includes('noindex') || tokens.includes('none');
}

/** Pages with parsed HTML. */
function auditable(pages: PageResult[]): (PageResult & { meta: NonNullable<PageResult['meta']> })[] {
  return pages.filter((p): p is PageResult & { meta: NonNullable<PageResult['meta']> } => !!p.meta && p.ok);
}

function allImages(pages: PageResult[]): Record<string, ImageInfo> {
  const out: Record<string, ImageInfo> = {};
  for (const p of pages) Object.assign(out, p.images);
  return out;
}

function groupBy<T>(items: T[], key: (item: T) => string | undefined): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (k === undefined) continue;
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

function duplicateRule(
  id: string,
  label: string,
  pick: (p: PageResult & { meta: NonNullable<PageResult['meta']> }) => string | undefined,
): SiteRule {
  return {
    id,
    scope: 'site',
    category: 'duplicates',
    severity: 'warn',
    description: `Two or more audited pages share the same ${label}. Pages marked noindex and pages that canonicalize to another page are skipped unless \`includeNoindex\` is true.`,
    defaults: { includeNoindex: false },
    check({ pages, options, report }) {
      const includeNoindex = bool(options, 'includeNoindex', false);
      const candidates = auditable(pages).filter((p) => {
        if (includeNoindex) return true;
        if (isNoindex(p)) return false;
        const c = p.meta.canonical ? resolveUrl(p.meta.canonical, pageUrl(p)) : undefined;
        return !c || normalizeForCompare(c) === normalizeForCompare(pageUrl(p));
      });
      const groups = groupBy(candidates, (p) => {
        const v = pick(p);
        return v ? v.trim().toLowerCase().replace(/\s+/g, ' ') : undefined;
      });
      for (const group of groups.values()) {
        const urls = [...new Set(group.map(pageUrl))];
        if (urls.length < 2) continue;
        const text = pick(group[0]!)!;
        report(urls[0]!, `${urls.length} pages share the ${label} "${text}"`, urls.slice(1), {
          value: text,
          urls,
        });
      }
    },
  };
}

interface EntityUse {
  page: string;
  entity: JsonLdEntity;
}

function entityUses(pages: PageResult[], type: JsonLdEntity['type']): Map<string, EntityUse[]> {
  const uses: EntityUse[] = [];
  for (const p of auditable(pages)) {
    for (const e of p.meta.entities) if (e.type === type) uses.push({ page: pageUrl(p), entity: e });
  }
  return groupBy(uses, (u) => {
    const key = entityKey(u.entity);
    return key ? `${siteOf(u.page)}|${key}` : undefined;
  });
}

function imageConsistencyRule(
  id: string,
  type: JsonLdEntity['type'],
  label: string,
  pick: (e: JsonLdEntity) => string | undefined,
): SiteRule {
  return {
    id,
    scope: 'site',
    category: 'entity',
    severity: 'warn',
    description: `The same ${type} (matched by @id, or by name) uses a different ${label} on different pages of a site. Images that redirect to the same file or have identical bytes count as the same.`,
    check({ pages, report }) {
      const images = allImages(pages);
      for (const uses of entityUses(pages, type).values()) {
        const withImage = uses.filter((u) => pick(u.entity));
        const clusters = clusterImages(
          withImage.map((u) => pick(u.entity)!),
          images,
        );
        if (clusters.length < 2) continue;
        const name = uses[0]!.entity.name ?? uses[0]!.entity.id ?? type;
        const variants = clusters.map((c) => ({
          image: c[0],
          pages: [...new Set(withImage.filter((u) => c.includes(pick(u.entity)!)).map((u) => u.page))],
        }));
        const pagesInvolved = [...new Set(withImage.map((u) => u.page))];
        report(
          pagesInvolved[0]!,
          `${type} "${name}" uses ${clusters.length} different ${label}s across ${pagesInvolved.length} pages`,
          pagesInvolved.slice(1),
          { entity: name, variants },
        );
      }
    },
  };
}

export const siteRules: SiteRule[] = [
  duplicateRule('duplicate-title', 'title', (p) => p.meta.title),
  duplicateRule('duplicate-description', 'meta description', (p) => p.meta.description),
  duplicateRule('duplicate-og-title', 'og:title', (p) => first(p.meta.og, 'og:title')),
  imageConsistencyRule('entity-image-inconsistent', 'Person', 'image', (e) => e.images[0]),
  imageConsistencyRule('entity-logo-inconsistent', 'Organization', 'logo', (e) => e.logos[0]),
  {
    id: 'entity-name-inconsistent',
    scope: 'site',
    category: 'entity',
    severity: 'warn',
    description: 'The same @id has different names on different pages.',
    check({ pages, report }) {
      for (const type of ['Person', 'Organization'] as const) {
        for (const uses of entityUses(pages, type).values()) {
          const withId = uses.filter((u) => u.entity.id && u.entity.name);
          const names = [...new Set(withId.map((u) => u.entity.name!))];
          if (names.length < 2) continue;
          const urls = [...new Set(withId.map((u) => u.page))];
          report(
            urls[0]!,
            `${type} ${withId[0]!.entity.id} is named ${names.map((n) => `"${n}"`).join(', ')}`,
            urls.slice(1),
            {
              names,
            },
          );
        }
      }
    },
  },
  {
    id: 'entity-sameas-inconsistent',
    scope: 'site',
    category: 'entity',
    severity: 'info',
    description: 'The same Person or Organization lists different sameAs profiles on different pages.',
    check({ pages, report }) {
      for (const type of ['Person', 'Organization'] as const) {
        for (const uses of entityUses(pages, type).values()) {
          const withSameAs = uses.filter((u) => u.entity.sameAs.length > 0);
          const sets = groupBy(withSameAs, (u) =>
            [...new Set(u.entity.sameAs.map((s) => normalizeForCompare(s).toLowerCase()))].sort().join(' '),
          );
          if (sets.size < 2) continue;
          const urls = [...new Set(withSameAs.map((u) => u.page))];
          const name = uses[0]!.entity.name ?? uses[0]!.entity.id ?? type;
          report(urls[0]!, `${type} "${name}" has ${sets.size} different sameAs lists`, urls.slice(1), {
            variants: [...sets.keys()].map((k) => k.split(' ')),
          });
        }
      }
    },
  },
  {
    id: 'profile-og-image-inconsistent',
    scope: 'site',
    category: 'entity',
    severity: 'info',
    description:
      'Profile and about pages of the same site use different og:image pictures, so the person or brand looks different depending on the shared page.',
    check({ pages, report }) {
      const images = allImages(pages);
      const profiles = auditable(pages).filter((p) => isProfilePage(p.meta, pageUrl(p)));
      for (const group of groupBy(profiles, (p) => siteOf(pageUrl(p))).values()) {
        const withImage = group
          .map((p) => ({ page: pageUrl(p), image: ogImageUrl(p.meta, pageUrl(p)) }))
          .filter((x): x is { page: string; image: string } => !!x.image);
        const clusters = clusterImages(
          withImage.map((x) => x.image),
          images,
        );
        if (clusters.length < 2) continue;
        const urls = withImage.map((x) => x.page);
        report(
          urls[0]!,
          `${urls.length} profile pages use ${clusters.length} different og:image pictures`,
          urls.slice(1),
          {
            variants: clusters.map((c) => c[0]),
          },
        );
      }
    },
  },
  {
    id: 'og-site-name-inconsistent',
    scope: 'site',
    category: 'opengraph',
    severity: 'warn',
    description: 'Pages of the same site use different og:site_name values.',
    check({ pages, report }) {
      for (const group of groupBy(auditable(pages), (p) => siteOf(pageUrl(p))).values()) {
        const byName = groupBy(group, (p) => first(p.meta.og, 'og:site_name')?.trim());
        if (byName.size < 2) continue;
        const urls = group.filter((p) => first(p.meta.og, 'og:site_name')).map(pageUrl);
        report(
          urls[0]!,
          `og:site_name varies: ${[...byName.keys()].map((n) => `"${n}"`).join(', ')}`,
          urls.slice(1),
          {
            names: [...byName.keys()],
          },
        );
      }
    },
  },
  {
    id: 'hreflang-return-link-missing',
    scope: 'site',
    category: 'hreflang',
    severity: 'warn',
    description:
      'Page A lists page B as an hreflang alternate, B was audited, but B does not link back to A. Search engines ignore one-way hreflang.',
    check({ pages, report }) {
      const byUrl = new Map<string, PageResult & { meta: NonNullable<PageResult['meta']> }>();
      for (const p of auditable(pages)) {
        byUrl.set(normalizeForCompare(pageUrl(p)), p);
        byUrl.set(normalizeForCompare(p.url), p);
      }
      for (const a of auditable(pages)) {
        const aUrls = new Set([normalizeForCompare(pageUrl(a)), normalizeForCompare(a.url)]);
        const canonical = a.meta.canonical ? resolveUrl(a.meta.canonical, pageUrl(a)) : undefined;
        if (canonical) aUrls.add(normalizeForCompare(canonical));
        for (const link of a.meta.hreflang) {
          if (!link.resolved) continue;
          const target = normalizeForCompare(link.resolved);
          if (aUrls.has(target)) continue;
          const b = byUrl.get(target);
          if (!b || b === a) continue;
          const linksBack = b.meta.hreflang.some(
            (l) => l.resolved && aUrls.has(normalizeForCompare(l.resolved)),
          );
          if (!linksBack) {
            report(pageUrl(a), `${pageUrl(b)} (hreflang "${link.lang}") does not link back with hreflang`, [
              pageUrl(b),
            ]);
          }
        }
      }
    },
  },
];
