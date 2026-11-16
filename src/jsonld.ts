// JSON-LD extraction. Parses every ld+json block, flattens @graph and nested
// nodes, resolves @id references inside the page, and pulls out the Person and
// Organization data that matter for social and knowledge-panel previews.

import type { JsonLdBlock, JsonLdEntity } from './types.js';
import { resolveUrl } from './url.js';

type Node = Record<string, unknown>;

const ORG_TYPES = new Set([
  'Organization',
  'Corporation',
  'LocalBusiness',
  'NGO',
  'EducationalOrganization',
  'GovernmentOrganization',
  'NewsMediaOrganization',
  'OnlineBusiness',
  'OnlineStore',
  'MedicalOrganization',
  'SportsOrganization',
  'PerformingGroup',
  'Airline',
  'Consortium',
  'ProfessionalService',
  'Store',
  'Restaurant',
]);

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Removes a leading BOM, HTML comment wrappers and CDATA markers some CMSs add. */
function cleanBlock(raw: string): string {
  return raw
    .replace(/^\ufeff/, '')
    .trim()
    .replace(/^<!--/, '')
    .replace(/-->$/, '')
    .replace(/^\s*\/\/\s*<!\[CDATA\[/, '')
    .replace(/\/\/\s*\]\]>\s*$/, '')
    .trim();
}

/** Returns the types of a node without a schema.org prefix. */
export function nodeTypes(node: Node): string[] {
  const t = node['@type'];
  const list = Array.isArray(t) ? t : t === undefined ? [] : [t];
  return list
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.replace(/^(?:https?:\/\/)?schema\.org\//, '').replace(/^schema:/, ''));
}

/** Collects every node object in a parsed JSON-LD value, depth first. */
function collectNodes(value: unknown, out: Node[], depth = 0): void {
  if (depth > 32) return;
  if (Array.isArray(value)) {
    for (const item of value) collectNodes(item, out, depth + 1);
    return;
  }
  if (!isNode(value)) return;
  if ('@type' in value || '@id' in value) out.push(value);
  for (const [key, child] of Object.entries(value)) {
    if (key === '@context') continue;
    if (typeof child === 'object' && child !== null) collectNodes(child, out, depth + 1);
  }
}

/** Parses the text of `<script type="application/ld+json">` blocks. */
export function parseJsonLdBlocks(sources: string[]): JsonLdBlock[] {
  return sources.map((raw, index) => {
    const block: JsonLdBlock = { index, raw, nodes: [] };
    const text = cleanBlock(raw);
    if (!text) {
      block.error = 'empty block';
      return block;
    }
    try {
      const parsed: unknown = JSON.parse(text);
      collectNodes(parsed, block.nodes);
    } catch (err) {
      block.error = err instanceof Error ? err.message : String(err);
    }
    return block;
  });
}

function asStrings(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim());
}

/** Reads an image-like property: a URL string, an ImageObject, an @id reference or a list of these. */
function imageUrls(value: unknown, byId: Map<string, Node>, depth = 0): string[] {
  if (value === undefined || value === null || depth > 4) return [];
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap((v) => imageUrls(v, byId, depth + 1));
  if (isNode(value)) {
    const direct = asStrings(value.url ?? value.contentUrl);
    if (direct.length > 0) return direct;
    const id = typeof value['@id'] === 'string' ? value['@id'] : undefined;
    const target = id ? byId.get(id) : undefined;
    if (target && target !== value) return imageUrls(target, byId, depth + 1);
  }
  return [];
}

function firstString(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (Array.isArray(value)) {
    for (const v of value) {
      const s = firstString(v);
      if (s) return s;
    }
  }
  if (isNode(value) && typeof value['@value'] === 'string') return value['@value'].trim() || undefined;
  return undefined;
}

/** Merges nodes that share an @id, which is how @graph documents split data. */
function mergeById(nodes: Node[]): Map<string, Node> {
  const byId = new Map<string, Node>();
  for (const node of nodes) {
    const id = node['@id'];
    if (typeof id !== 'string') continue;
    const existing = byId.get(id);
    byId.set(id, existing ? { ...existing, ...node } : node);
  }
  return byId;
}

/**
 * Extracts Person and Organization entities. Nodes that only reference an @id
 * are merged with the full node, and relative image URLs are resolved against
 * the page URL.
 */
export function extractEntities(blocks: JsonLdBlock[], pageUrl: string): JsonLdEntity[] {
  const all = blocks.flatMap((b) => b.nodes);
  const byId = mergeById(all);
  const seen = new Set<Node>();
  const entities: JsonLdEntity[] = [];
  const seenIds = new Set<string>();

  for (const raw of all) {
    const id = typeof raw['@id'] === 'string' ? raw['@id'] : undefined;
    const node = id ? (byId.get(id) ?? raw) : raw;
    if (seen.has(node)) continue;
    seen.add(node);
    if (id) {
      if (seenIds.has(id)) continue;
      seenIds.add(id);
    }
    const types = nodeTypes(node);
    let kind: JsonLdEntity['type'] | undefined;
    if (types.includes('Person')) kind = 'Person';
    else if (types.some((t) => ORG_TYPES.has(t))) kind = 'Organization';
    if (!kind) continue;

    // A bare reference like {"@id": "#person"} carries no data of its own.
    const keys = Object.keys(node).filter((k) => k !== '@id' && k !== '@type' && k !== '@context');
    if (keys.length === 0) continue;

    const resolve = (u: string) => resolveUrl(u, pageUrl) ?? u;
    const entity: JsonLdEntity = {
      type: kind,
      types,
      images: imageUrls(node.image, byId).map(resolve),
      logos: imageUrls(node.logo, byId).map(resolve),
      sameAs: asStrings(node.sameAs),
    };
    if (id) entity.id = id;
    const name = firstString(node.name) ?? firstString(node.legalName);
    if (name) entity.name = name;
    const url = firstString(node.url);
    if (url) entity.url = resolve(url);
    entities.push(entity);
  }
  return entities;
}

/** A key that identifies the same entity across pages: its @id, or its type and name. */
export function entityKey(entity: JsonLdEntity): string | undefined {
  if (entity.id && !entity.id.startsWith('_:')) return `${entity.type}:${entity.id}`;
  if (entity.name) return `${entity.type}:name:${entity.name.toLowerCase()}`;
  return undefined;
}
