// The package also works with require(). Run after `npm run build`:
//   node examples/commonjs.cjs
const { extractMeta, imageDimensions, isValidHreflang } = require('../dist/cjs/index.js');

const meta = extractMeta(
  '<title>Hello</title><meta property="og:image" content="https://e.com/a.png">',
  'https://e.com/',
);
console.log(meta.title, meta.og['og:image']);
console.log(isValidHreflang('en-UK'), isValidHreflang('bn-BD'));
console.log(imageDimensions(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x10, 0, 0x20, 0])));
