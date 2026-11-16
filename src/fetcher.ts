// HTTP helpers: timeouts, byte limits and charset-aware decoding on top of a
// fetch implementation (the global fetch by default, or one passed in tests).

import type { FetchLike } from './types.js';

export interface FetchOptions {
  fetch: FetchLike;
  timeoutMs: number;
  userAgent: string;
  headers?: Record<string, string>;
}

export interface FetchedBody {
  url: string;
  finalUrl: string;
  status: number;
  ok: boolean;
  redirected: boolean;
  headers: Headers;
  contentType: string;
  bytes: Uint8Array;
  /** True when the body was cut at the byte limit. */
  truncated: boolean;
  timeMs: number;
}

export class FetchError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly code: 'timeout' | 'network' | 'invalid-url',
  ) {
    super(message);
    this.name = 'FetchError';
  }
}

/** Reads at most `limit` bytes from a response body, then cancels the stream. */
export async function readLimited(
  response: Response,
  limit: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const body = response.body;
  if (!body) {
    const buf = new Uint8Array(await response.arrayBuffer());
    return buf.length > limit
      ? { bytes: buf.subarray(0, limit), truncated: true }
      : { bytes: buf, truncated: false };
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (total + value.length > limit) {
        chunks.push(value.subarray(0, limit - total));
        total = limit;
        truncated = true;
        break;
      }
      chunks.push(value);
      total += value.length;
    }
  } finally {
    if (truncated) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return { bytes: out, truncated };
}

/** Sends a request with a timeout and reads up to `maxBytes` of the body. */
export async function fetchBytes(
  url: string,
  opts: FetchOptions,
  maxBytes: number,
  method: 'GET' | 'HEAD' = 'GET',
): Promise<FetchedBody> {
  try {
    new URL(url);
  } catch {
    throw new FetchError(`Invalid URL: ${url}`, url, 'invalid-url');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  const started = Date.now();
  try {
    const response = await opts.fetch(url, {
      method,
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': opts.userAgent, accept: '*/*', ...opts.headers },
    });
    const { bytes, truncated } =
      method === 'HEAD'
        ? { bytes: new Uint8Array(0), truncated: false }
        : await readLimited(response, maxBytes);
    return {
      url,
      finalUrl: response.url || url,
      status: response.status,
      ok: response.ok,
      redirected: response.redirected || (!!response.url && response.url !== url),
      headers: response.headers,
      contentType: (response.headers.get('content-type') ?? '').toLowerCase(),
      bytes,
      truncated,
      timeMs: Date.now() - started,
    };
  } catch (err) {
    if (controller.signal.aborted) {
      throw new FetchError(`Timed out after ${opts.timeoutMs} ms`, url, 'timeout');
    }
    const cause =
      err instanceof Error ? ((err.cause as Error | undefined)?.message ?? err.message) : String(err);
    throw new FetchError(cause, url, 'network');
  } finally {
    clearTimeout(timer);
  }
}

/** Finds the charset in a Content-Type header or in the first bytes of an HTML document. */
export function detectCharset(contentType: string, bytes: Uint8Array): string {
  const header = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType);
  if (header) return header[1]!.toLowerCase();
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 2048));
  const meta = /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(head);
  return meta ? meta[1]!.toLowerCase() : 'utf-8';
}

/** Decodes bytes using the detected charset, falling back to UTF-8 for unknown labels. */
export function decodeText(bytes: Uint8Array, contentType: string): string {
  const charset = detectCharset(contentType, bytes);
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}
