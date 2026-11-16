// Test helpers: a fake fetch backed by a route table, fixture loading, and
// builders for minimal but valid image file headers.

import { readFileSync } from 'node:fs';
import type { FetchLike } from '../src/index.js';

export function fixture(name: string): string {
  return readFileSync(new URL(`../../test/fixtures/${name}`, import.meta.url), 'utf8');
}

export interface Route {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  /** Respond as if the request was redirected to this URL. */
  redirectTo?: string;
  /** Wait this long before answering. */
  delayMs?: number;
  /** Reject with this error message (a network failure). */
  error?: string;
}

export interface FakeFetch extends FetchLike {
  calls: { url: string; method: string; headers: Record<string, string> }[];
}

/** Builds a fetch that answers from `routes` and returns 404 for anything else. */
export function fakeFetch(routes: Record<string, Route | (() => Route)>): FakeFetch {
  const calls: FakeFetch['calls'] = [];
  const impl = async (input: string, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    calls.push({ url: input, method: init?.method ?? 'GET', headers });
    const entry = routes[input];
    const route = typeof entry === 'function' ? entry() : entry;
    if (route?.delayMs) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, route.delayMs);
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(t);
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    }
    if (route?.error) throw new TypeError('fetch failed', { cause: new Error(route.error) });
    const target = route?.redirectTo ? routes[route.redirectTo] : route;
    const final = typeof target === 'function' ? target() : target;
    const status = final?.status ?? (final ? 200 : 404);
    const body =
      init?.method === 'HEAD' || status === 204 || status === 304 ? null : (final?.body ?? 'Not found');
    const res = new Response(body as ConstructorParameters<typeof Response>[0], {
      status,
      headers: final?.headers ?? { 'content-type': 'text/plain' },
    });
    Object.defineProperty(res, 'url', { value: route?.redirectTo ?? input });
    Object.defineProperty(res, 'redirected', { value: !!route?.redirectTo });
    return res;
  };
  return Object.assign(impl, { calls });
}

export const html = (body: string): Route => ({
  headers: { 'content-type': 'text/html; charset=utf-8' },
  body,
});

export const image = (bytes: Uint8Array, type: string): Route => ({
  headers: { 'content-type': type, 'content-length': String(bytes.length) },
  body: bytes,
});

function bytes(...parts: (number[] | Uint8Array | string)[]): Uint8Array {
  const arrays = parts.map((p) =>
    typeof p === 'string' ? new TextEncoder().encode(p) : p instanceof Uint8Array ? p : Uint8Array.from(p),
  );
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrays) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const be16 = (n: number) => [(n >>> 8) & 255, n & 255];
const le16 = (n: number) => [n & 255, (n >>> 8) & 255];
const le24 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];
const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];

/** A PNG signature and IHDR chunk, plus `padding` filler bytes to vary the hash or size. */
export function pngBytes(width: number, height: number, padding = 0): Uint8Array {
  return bytes(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    be32(13),
    'IHDR',
    be32(width),
    be32(height),
    [8, 6, 0, 0, 0],
    [0, 0, 0, 0],
    new Uint8Array(padding),
  );
}

export function gifBytes(width: number, height: number): Uint8Array {
  return bytes('GIF89a', le16(width), le16(height), [0xf7, 0, 0]);
}

/** A JPEG with an APP0 segment, a large APP1 (EXIF-like) segment and a SOF frame. */
export function jpegBytes(width: number, height: number, sof = 0xc0, exifSize = 600): Uint8Array {
  const app1 = new Uint8Array(exifSize);
  return bytes(
    [0xff, 0xd8],
    [0xff, 0xe0],
    be16(16),
    'JFIF\0',
    [1, 1, 0, 0, 1, 0, 1, 0, 0],
    [0xff, 0xe1],
    be16(exifSize + 2),
    app1,
    [0xff, 0xff, sof],
    be16(17),
    [8],
    be16(height),
    be16(width),
    [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1],
    [0xff, 0xd9],
  );
}

export function webpLossyBytes(width: number, height: number): Uint8Array {
  return bytes(
    'RIFF',
    le32(30),
    'WEBP',
    'VP8 ',
    le32(18),
    [0, 0, 0],
    [0x9d, 0x01, 0x2a],
    le16(width),
    le16(height),
    [0, 0],
  );
}

export function webpLosslessBytes(width: number, height: number): Uint8Array {
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  return bytes('RIFF', le32(26), 'WEBP', 'VP8L', le32(5), [0x2f], le32(bits), [0, 0, 0]);
}

export function webpExtendedBytes(width: number, height: number): Uint8Array {
  return bytes(
    'RIFF',
    le32(30),
    'WEBP',
    'VP8X',
    le32(10),
    [0, 0, 0, 0],
    le24(width - 1),
    le24(height - 1),
    [0, 0],
  );
}

export function bmpBytes(width: number, height: number): Uint8Array {
  return bytes(
    'BM',
    le32(54),
    [0, 0, 0, 0],
    le32(54),
    le32(40),
    le32(width),
    le32(-height >>> 0),
    [1, 0, 24, 0],
  );
}

export function icoBytes(sizes: number[]): Uint8Array {
  const entries = sizes.flatMap((s) => [
    s >= 256 ? 0 : s,
    s >= 256 ? 0 : s,
    0,
    0,
    1,
    0,
    32,
    0,
    ...le32(0),
    ...le32(0),
  ]);
  return bytes([0, 0, 1, 0], le16(sizes.length), entries);
}

export function avifBytes(width: number, height: number): Uint8Array {
  return bytes(
    be32(24),
    'ftyp',
    'avif',
    be32(0),
    'mif1',
    'miaf',
    be32(20),
    'ispe',
    be32(0),
    be32(width),
    be32(height),
  );
}
