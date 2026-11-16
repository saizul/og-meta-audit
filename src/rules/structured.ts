// JSON-LD rules.

import { nodeTypes } from '../jsonld.js';
import { isAbsoluteHttpUrl } from '../url.js';
import { type PageRule, bool } from './types.js';

export const jsonLdRules: PageRule[] = [
  {
    id: 'jsonld-missing',
    scope: 'page',
    category: 'jsonld',
    severity: 'info',
    description: 'The page has no JSON-LD structured data.',
    check({ meta, report }) {
      if (meta.jsonld.length === 0) report('No JSON-LD blocks');
    },
  },
  {
    id: 'jsonld-parse-error',
    scope: 'page',
    category: 'jsonld',
    severity: 'error',
    description: 'A JSON-LD block is not valid JSON. Search engines ignore the whole block.',
    check({ meta, report }) {
      for (const block of meta.jsonld) {
        if (block.error)
          report(`JSON-LD block ${block.index + 1} is invalid: ${block.error}`, { block: block.index });
      }
    },
  },
  {
    id: 'jsonld-context-missing',
    scope: 'page',
    category: 'jsonld',
    severity: 'warn',
    description: 'A JSON-LD block does not reference schema.org in @context.',
    check({ meta, report }) {
      for (const block of meta.jsonld) {
        if (block.error || block.nodes.length === 0) continue;
        if (!/schema\.org/i.test(block.raw))
          report(`JSON-LD block ${block.index + 1} has no schema.org @context`);
      }
    },
  },
  {
    id: 'jsonld-type-missing',
    scope: 'page',
    category: 'jsonld',
    severity: 'warn',
    description: 'A top-level JSON-LD node has no @type.',
    check({ meta, report }) {
      for (const block of meta.jsonld) {
        if (block.error) continue;
        const top = block.nodes[0];
        if (top && nodeTypes(top).length === 0 && !('@graph' in top) && Object.keys(top).length > 2) {
          report(`JSON-LD block ${block.index + 1} has a node without @type`);
        }
      }
    },
  },
  {
    id: 'entity-name-missing',
    scope: 'page',
    category: 'entity',
    severity: 'warn',
    description: 'A Person or Organization node has no name.',
    check({ meta, report }) {
      for (const e of meta.entities) if (!e.name) report(`${e.type}${e.id ? ` ${e.id}` : ''} has no name`);
    },
  },
  {
    id: 'entity-image-missing',
    scope: 'page',
    category: 'entity',
    severity: 'warn',
    description:
      'A Person has no image, or an Organization has no logo. Knowledge panels and rich results use them.',
    check({ meta, report }) {
      for (const e of meta.entities) {
        const label = e.name ?? e.id ?? e.type;
        if (e.type === 'Person' && e.images.length === 0) report(`Person "${label}" has no image`);
        if (e.type === 'Organization' && e.logos.length === 0) report(`Organization "${label}" has no logo`);
      }
    },
  },
  {
    id: 'entity-sameas-missing',
    scope: 'page',
    category: 'entity',
    severity: 'info',
    description: 'A Person or Organization has no sameAs links to its profiles.',
    check({ meta, report }) {
      for (const e of meta.entities) {
        if (e.sameAs.length === 0 && (e.name || e.id))
          report(`${e.type} "${e.name ?? e.id}" has no sameAs links`);
      }
    },
  },
  {
    id: 'entity-sameas-invalid',
    scope: 'page',
    category: 'entity',
    severity: 'warn',
    description: 'A sameAs value is not an absolute http(s) URL, or is listed twice.',
    defaults: { requireHttps: false },
    check({ meta, options, report }) {
      const requireHttps = bool(options, 'requireHttps', false);
      for (const e of meta.entities) {
        const seen = new Set<string>();
        for (const s of e.sameAs) {
          if (!isAbsoluteHttpUrl(s)) report(`sameAs "${s}" of ${e.name ?? e.type} is not an absolute URL`);
          else if (requireHttps && s.startsWith('http:')) report(`sameAs "${s}" uses http`);
          const key = s.toLowerCase().replace(/\/$/, '');
          if (seen.has(key)) report(`sameAs "${s}" of ${e.name ?? e.type} is listed twice`);
          seen.add(key);
        }
      }
    },
  },
  {
    id: 'entity-image-relative',
    scope: 'page',
    category: 'entity',
    severity: 'warn',
    description: 'A Person image or Organization logo is not an absolute URL in the JSON-LD source.',
    check({ meta, report }) {
      for (const block of meta.jsonld) {
        if (block.error) continue;
        for (const m of block.raw.matchAll(/"(?:image|logo)"\s*:\s*"([^"]*)"/g)) {
          if (m[1] && !isAbsoluteHttpUrl(m[1])) report(`JSON-LD image "${m[1]}" is not an absolute URL`);
        }
      }
    },
  },
];
