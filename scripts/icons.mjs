// Renders the extension icons in icons/ to the PNG sizes the manifest lists.
// 16px comes from icon-16.svg when present: the full-size glyph turns to mush that small.
// Usage: npm run icons
import fs from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const SIZES = [16, 32, 48, 128];

function source(size) {
  const small = 'icons/icon-16.svg';
  return size === 16 && fs.existsSync(small) ? small : 'icons/icon.svg';
}

for (const size of SIZES) {
  const svg = fs.readFileSync(source(size), 'utf8');
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  fs.writeFileSync(`icons/icon-${size}.png`, png);
}
