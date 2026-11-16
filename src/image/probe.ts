// Fetches an image URL and reports status, type, size, pixel dimensions and a
// content hash. Results are cached per URL so an image shared by many pages
// is downloaded once.

import { createHash } from 'node:crypto';
import { type FetchOptions, fetchBytes } from '../fetcher.js';
import type { ImageInfo } from '../types.js';
import { imageDimensions } from './dimensions.js';

export interface ProbeOptions extends FetchOptions {
  /** `get` downloads the image (needed for dimensions), `head` only checks status and headers. */
  method: 'get' | 'head';
  /** Stop reading after this many bytes. Size then comes from Content-Length. */
  maxBytes: number;
}

/** Probes one image URL. Never throws: failures are reported in the result. */
export async function probeImage(url: string, opts: ProbeOptions): Promise<ImageInfo> {
  const info: ImageInfo = { url, ok: false };
  try {
    const res = await fetchBytes(url, opts, opts.maxBytes, opts.method === 'head' ? 'HEAD' : 'GET');
    info.status = res.status;
    info.ok = res.ok;
    info.finalUrl = res.finalUrl;
    if (res.contentType) info.contentType = res.contentType.split(';')[0]!.trim();
    const length = Number(res.headers.get('content-length'));
    if (Number.isFinite(length) && length > 0) info.bytes = length;
    if (!res.ok) {
      info.error = `HTTP ${res.status}`;
      return info;
    }
    if (res.bytes.length > 0) {
      if (!res.truncated) {
        info.bytes = res.bytes.length;
        info.hash = createHash('sha256').update(res.bytes).digest('hex');
      }
      const dims = imageDimensions(res.bytes);
      if (dims) {
        info.format = dims.format;
        if (dims.width !== undefined) info.width = dims.width;
        if (dims.height !== undefined) info.height = dims.height;
      }
    }
  } catch (err) {
    info.error = err instanceof Error ? err.message : String(err);
  }
  return info;
}

/** A per-audit cache so each image URL is probed once, even when requested concurrently. */
export class ImageCache {
  private readonly entries = new Map<string, Promise<ImageInfo>>();

  constructor(private readonly opts: ProbeOptions) {}

  get(url: string): Promise<ImageInfo> {
    let entry = this.entries.get(url);
    if (!entry) {
      entry = probeImage(url, this.opts);
      this.entries.set(url, entry);
    }
    return entry;
  }

  get size(): number {
    return this.entries.size;
  }
}
