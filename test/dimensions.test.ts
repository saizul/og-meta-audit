import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatMimeType, imageDimensions } from '../src/index.js';
import {
  avifBytes,
  bmpBytes,
  gifBytes,
  icoBytes,
  jpegBytes,
  pngBytes,
  webpExtendedBytes,
  webpLosslessBytes,
  webpLossyBytes,
} from './helpers.js';

const svg = (s: string) => new TextEncoder().encode(s);

describe('imageDimensions', () => {
  it('reads PNG', () => {
    assert.deepEqual(imageDimensions(pngBytes(1200, 630)), { format: 'png', width: 1200, height: 630 });
    assert.deepEqual(imageDimensions(pngBytes(70000, 1)), { format: 'png', width: 70000, height: 1 });
  });

  it('reads GIF', () => {
    assert.deepEqual(imageDimensions(gifBytes(640, 480)), { format: 'gif', width: 640, height: 480 });
  });

  it('reads baseline and progressive JPEG after large APP segments and fill bytes', () => {
    assert.deepEqual(imageDimensions(jpegBytes(1200, 630)), { format: 'jpeg', width: 1200, height: 630 });
    assert.deepEqual(imageDimensions(jpegBytes(800, 801, 0xc2, 5000)), {
      format: 'jpeg',
      width: 800,
      height: 801,
    });
  });

  it('reports a JPEG without size when the frame header is cut off', () => {
    assert.deepEqual(imageDimensions(jpegBytes(10, 10).subarray(0, 40)), { format: 'jpeg' });
  });

  it('reads all three WebP variants', () => {
    assert.deepEqual(imageDimensions(webpLossyBytes(1200, 630)), {
      format: 'webp',
      width: 1200,
      height: 630,
    });
    assert.deepEqual(imageDimensions(webpLosslessBytes(1200, 630)), {
      format: 'webp',
      width: 1200,
      height: 630,
    });
    assert.deepEqual(imageDimensions(webpExtendedBytes(4000, 2100)), {
      format: 'webp',
      width: 4000,
      height: 2100,
    });
    assert.deepEqual(imageDimensions(webpLosslessBytes(16384, 16384)), {
      format: 'webp',
      width: 16384,
      height: 16384,
    });
  });

  it('reads BMP with negative (top-down) height', () => {
    assert.deepEqual(imageDimensions(bmpBytes(300, 200)), { format: 'bmp', width: 300, height: 200 });
  });

  it('reads the largest ICO entry, where 0 means 256', () => {
    assert.deepEqual(imageDimensions(icoBytes([16, 32, 256])), { format: 'ico', width: 256, height: 256 });
  });

  it('reads AVIF from the ispe box', () => {
    assert.deepEqual(imageDimensions(avifBytes(1200, 630)), { format: 'avif', width: 1200, height: 630 });
  });

  it('reads SVG width/height, viewBox and partial sizes', () => {
    assert.deepEqual(
      imageDimensions(svg('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50px"></svg>')),
      {
        format: 'svg',
        width: 100,
        height: 50,
      },
    );
    assert.deepEqual(
      imageDimensions(svg('<?xml version="1.0"?>\n<!-- x -->\n<svg viewBox="0 0 1200 630">')),
      {
        format: 'svg',
        width: 1200,
        height: 630,
      },
    );
    assert.deepEqual(imageDimensions(svg('<svg width="600" viewBox="0,0,1200,630">')), {
      format: 'svg',
      width: 600,
      height: 315,
    });
    assert.deepEqual(imageDimensions(svg('<svg width="100%" height="100%">')), { format: 'svg' });
  });

  it('does not take HTML for SVG', () => {
    assert.equal(
      imageDimensions(svg('<!DOCTYPE html><html><body><svg width="1" height="1"></svg>')),
      undefined,
    );
  });

  it('returns undefined for unknown or empty data', () => {
    assert.equal(imageDimensions(new Uint8Array(0)), undefined);
    assert.equal(imageDimensions(svg('hello world')), undefined);
    assert.equal(imageDimensions(Uint8Array.from([0xff])), undefined);
  });

  it('maps formats to MIME types', () => {
    assert.equal(formatMimeType('jpeg'), 'image/jpeg');
    assert.equal(formatMimeType('svg'), 'image/svg+xml');
    assert.equal(formatMimeType('webp'), 'image/webp');
    assert.equal(formatMimeType('ico'), 'image/x-icon');
  });
});
