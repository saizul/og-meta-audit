// Audits two pages without touching the network: a fake fetch serves the HTML
// and a PNG header built in code. Run after `npm run build`:
//   node examples/offline.mjs
import { audit, formatText } from '../dist/esm/index.js';

function png(width, height) {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

const pages = {
  'https://shop.example/': `<!doctype html><html lang="en"><head>
    <title>Handmade jute bags from Bangladesh</title>
    <meta name="description" content="Jute bags, baskets and rugs made by artisans in Rangpur. Free shipping inside Dhaka.">
    <link rel="canonical" href="https://shop.example/">
    <meta property="og:title" content="Handmade jute bags">
    <meta property="og:image" content="https://shop.example/og.png">
    <meta name="twitter:card" content="summary_large_image">
  </head></html>`,
  'https://shop.example/about': `<!doctype html><html lang="en"><head>
    <title>Handmade jute bags from Bangladesh</title>
    <meta property="og:image" content="/og-small.png">
  </head></html>`,
};

const fakeFetch = async (url) => {
  if (pages[url]) return new Response(pages[url], { headers: { 'content-type': 'text/html' } });
  if (url === 'https://shop.example/og.png')
    return new Response(png(1200, 630), { headers: { 'content-type': 'image/png' } });
  return new Response('not found', { status: 404 });
};

const report = await audit(Object.keys(pages), { fetch: fakeFetch });
process.stdout.write(formatText(report, { minSeverity: 'warn' }));
