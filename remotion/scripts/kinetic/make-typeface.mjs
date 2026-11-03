/**
 * One-off font -> three.js typeface JSON (for the kinetic 3D presets). Usage (from remotion/):
 *   node scripts/kinetic/make-typeface.mjs <in.woff|ttf> <out.typeface.json>
 * Uses three's own TTFLoader (opentype.js inside three/examples/jsm/libs). WOFF1 / TTF only (not woff2). The output is a derivative of an SIL OFL font; keep the matching LICENSE in public/fonts.
 * Only printable ASCII glyphs are kept to keep the file small.
 */
import fs from 'node:fs';
import {TTFLoader} from 'three/examples/jsm/loaders/TTFLoader.js';

const [inPath, outPath] = process.argv.slice(2);
if (!inPath || !outPath) { console.error('usage: make-typeface.mjs <in.woff|ttf> <out.json>'); process.exit(2); }
const buf = fs.readFileSync(inPath);
const json = new TTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const keep = {};
for (let c = 32; c < 127; c += 1) { const ch = String.fromCharCode(c); if (json.glyphs[ch]) keep[ch] = json.glyphs[ch]; }
json.glyphs = keep;
fs.writeFileSync(outPath, JSON.stringify(json));
console.log(`wrote ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(0)} KB, ${Object.keys(keep).length} glyphs)`);
