// Deciding whether two image URLs show the same picture.

import type { ImageInfo } from '../types.js';
import { normalizeForCompare } from '../url.js';

/**
 * Two image URLs are the same image when they normalize to the same URL, end
 * at the same URL after redirects, or were both downloaded and have the same
 * content hash.
 */
export function sameImage(a: string, b: string, images: Record<string, ImageInfo>): boolean {
  if (normalizeForCompare(a) === normalizeForCompare(b)) return true;
  const ia = images[a];
  const ib = images[b];
  if (ia?.finalUrl && ib?.finalUrl && normalizeForCompare(ia.finalUrl) === normalizeForCompare(ib.finalUrl)) {
    return true;
  }
  return !!(ia?.hash && ib?.hash && ia.hash === ib.hash);
}

/**
 * Groups image URLs into clusters of the same image. Each cluster lists the
 * URLs it contains, in first-seen order.
 */
export function clusterImages(urls: readonly string[], images: Record<string, ImageInfo>): string[][] {
  const clusters: string[][] = [];
  for (const url of urls) {
    const cluster = clusters.find((c) => sameImage(c[0]!, url, images));
    if (cluster) {
      if (!cluster.includes(url)) cluster.push(url);
    } else {
      clusters.push([url]);
    }
  }
  return clusters;
}
