// Image header parsing. Reads the pixel dimensions of PNG, JPEG, GIF, WebP,
// BMP, ICO, AVIF and SVG files from their first bytes, without decoding.

import type { ImageFormat } from '../types.js';

export interface ImageDimensions {
  format: ImageFormat;
  width?: number;
  height?: number;
}

function u16be(b: Uint8Array, o: number): number {
  return (b[o]! << 8) | b[o + 1]!;
}
function u16le(b: Uint8Array, o: number): number {
  return b[o]! | (b[o + 1]! << 8);
}
function u24le(b: Uint8Array, o: number): number {
  return b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16);
}
function u32be(b: Uint8Array, o: number): number {
  return ((b[o]! << 24) >>> 0) + ((b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!);
}
function i32le(b: Uint8Array, o: number): number {
  return b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24);
}
function ascii(b: Uint8Array, o: number, n: number): string {
  let s = '';
  for (let i = o; i < o + n && i < b.length; i++) s += String.fromCharCode(b[i]!);
  return s;
}

function png(b: Uint8Array): ImageDimensions | undefined {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 8 || sig.some((v, i) => b[i] !== v)) return undefined;
  if (b.length < 24 || ascii(b, 12, 4) !== 'IHDR') return { format: 'png' };
  return { format: 'png', width: u32be(b, 16), height: u32be(b, 20) };
}

function gif(b: Uint8Array): ImageDimensions | undefined {
  const head = ascii(b, 0, 6);
  if (head !== 'GIF87a' && head !== 'GIF89a') return undefined;
  if (b.length < 10) return { format: 'gif' };
  return { format: 'gif', width: u16le(b, 6), height: u16le(b, 8) };
}

function webp(b: Uint8Array): ImageDimensions | undefined {
  if (ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') return undefined;
  const chunk = ascii(b, 12, 4);
  if (chunk === 'VP8 ' && b.length >= 30) {
    // Frame tag (3 bytes) then the start code 9d 01 2a, then 14-bit sizes.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return { format: 'webp' };
    return { format: 'webp', width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  if (chunk === 'VP8L' && b.length >= 25) {
    if (b[20] !== 0x2f) return { format: 'webp' };
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
    return { format: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X' && b.length >= 30) {
    return { format: 'webp', width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  }
  return { format: 'webp' };
}

function jpeg(b: Uint8Array): ImageDimensions | undefined {
  if (b.length < 3 || b[0] !== 0xff || b[1] !== 0xd8) return undefined;
  let o = 2;
  while (o < b.length) {
    // Skip to the next marker, allowing fill bytes.
    if (b[o] !== 0xff) {
      o++;
      continue;
    }
    while (o < b.length && b[o] === 0xff) o++;
    if (o >= b.length) break;
    const marker = b[o]!;
    o++;
    // Standalone markers have no length.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9 || marker === 0xda) break;
    if (o + 2 > b.length) break;
    const len = u16be(b, o);
    if (len < 2) break;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (o + 7 > b.length) break;
      return { format: 'jpeg', height: u16be(b, o + 3), width: u16be(b, o + 5) };
    }
    o += len;
  }
  return { format: 'jpeg' };
}

function bmp(b: Uint8Array): ImageDimensions | undefined {
  if (ascii(b, 0, 2) !== 'BM' || b.length < 26) return undefined;
  const headerSize = i32le(b, 14);
  if (headerSize < 12 || headerSize > 256) return undefined;
  if (headerSize === 12) return { format: 'bmp', width: u16le(b, 18), height: u16le(b, 20) };
  return { format: 'bmp', width: Math.abs(i32le(b, 18)), height: Math.abs(i32le(b, 22)) };
}

function ico(b: Uint8Array): ImageDimensions | undefined {
  if (b.length < 8 || b[0] !== 0 || b[1] !== 0 || b[2] !== 1 || b[3] !== 0) return undefined;
  const count = u16le(b, 4);
  if (count === 0 || count > 256) return undefined;
  // Report the largest entry of the directory we have bytes for.
  let width = 0;
  let height = 0;
  for (let i = 0; i < count && 6 + i * 16 + 2 <= b.length; i++) {
    const w = b[6 + i * 16] || 256;
    const h = b[7 + i * 16] || 256;
    if (w * h > width * height) {
      width = w;
      height = h;
    }
  }
  return width ? { format: 'ico', width, height } : { format: 'ico' };
}

function avif(b: Uint8Array): ImageDimensions | undefined {
  if (ascii(b, 4, 4) !== 'ftyp') return undefined;
  const boxSize = u32be(b, 0);
  const brands = ascii(b, 8, Math.min(Math.max(boxSize - 8, 4), 64));
  if (!/avi[fs]/.test(brands)) return undefined;
  // The ispe property holds the image size: size(4) 'ispe' version/flags(4) width(4) height(4).
  for (let i = 8; i + 16 <= b.length; i++) {
    if (b[i] === 0x69 && ascii(b, i, 4) === 'ispe') {
      return { format: 'avif', width: u32be(b, i + 8), height: u32be(b, i + 12) };
    }
  }
  return { format: 'avif' };
}

function svgLength(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const m = /^\s*([0-9]*\.?[0-9]+)\s*(px)?\s*$/.exec(value);
  return m ? Math.round(Number(m[1])) : undefined;
}

function svg(b: Uint8Array): ImageDimensions | undefined {
  const text = new TextDecoder().decode(b.subarray(0, Math.min(b.length, 4096)));
  const start = /<svg[\s>]/i.exec(text.replace(/^\ufeff/, ''));
  if (!start) return undefined;
  const head = text.slice(0, start.index).trim();
  if (head && !/^(<\?xml[^>]*\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>|\s)*$/i.test(head)) return undefined;
  const tagEnd = text.indexOf('>', start.index);
  const tag = text.slice(start.index, tagEnd === -1 ? undefined : tagEnd);
  const attr = (name: string) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1];
  let width = svgLength(attr('width'));
  let height = svgLength(attr('height'));
  const viewBox = attr('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (viewBox && viewBox.length === 4 && viewBox.every(Number.isFinite)) {
    const [, , vw, vh] = viewBox as [number, number, number, number];
    if (width === undefined && height === undefined) {
      width = Math.round(vw);
      height = Math.round(vh);
    } else if (width === undefined && height !== undefined && vh > 0) {
      width = Math.round((height * vw) / vh);
    } else if (height === undefined && width !== undefined && vw > 0) {
      height = Math.round((width * vh) / vw);
    }
  }
  const out: ImageDimensions = { format: 'svg' };
  if (width !== undefined) out.width = width;
  if (height !== undefined) out.height = height;
  return out;
}

const PARSERS = [png, jpeg, gif, webp, bmp, ico, avif, svg];

/**
 * Detects the image format and pixel size from the start of a file. A few
 * hundred bytes are enough for PNG, GIF, WebP and BMP; JPEG may need more when
 * large EXIF or ICC blocks come before the frame header. Returns undefined
 * when the bytes are not a known image format.
 */
export function imageDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  for (const parse of PARSERS) {
    const result = parse(bytes);
    if (result) return result;
  }
  return undefined;
}

/** Maps a detected format to its usual MIME type. */
export function formatMimeType(format: ImageFormat): string {
  switch (format) {
    case 'jpeg':
      return 'image/jpeg';
    case 'svg':
      return 'image/svg+xml';
    case 'ico':
      return 'image/x-icon';
    default:
      return `image/${format}`;
  }
}
