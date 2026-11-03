/**
 * WP30: download the offline proof's Pexels stills ONCE into remotion/public/wp30-fixtures/ (small landscape crops, ~100-200 KB each) plus a credits manifest. The preview render itself is then fully offline.
 * The queries are visible 2-4 word scenes in the same vocabulary as server/src/stages/broll/editorialStillMontage.ts (no abstract words, no emoji / affect icons).
 * Usage (from remotion/): node scripts/wp30/fetch-fixtures.mjs   (needs PEXELS_API_KEY in ../.env; skips files that already exist)
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const outDir = path.join(root, 'public/wp30-fixtures');
fs.mkdirSync(outDir, {recursive: true});
try {
  process.loadEnvFile(path.join(root, '../.env'));
} catch {
  // the key may already be in the environment
}
const key = process.env.PEXELS_API_KEY;
if (!key) throw new Error('PEXELS_API_KEY missing (../.env)');

/** file -> query. Run A (4 stills), run B (3 stills), then the tilted card still. */
export const FIXTURES = [
  ['a1-startup-office', 'startup office team'],
  ['a2-counting-cash', 'counting cash hands'],
  ['a3-newspaper', 'newspaper headline closeup'],
  ['a4-city-crowd', 'city street crowd'],
  ['b1-laptop-desk', 'typing laptop desk'],
  ['b2-empty-desk', 'empty office desk'],
  ['b3-subway', 'subway platform commuters'],
  ['c1-press', 'press conference reporters'],
];

const manifestPath = path.join(outDir, 'credits.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
const used = new Set(Object.values(manifest).map(item => item.id));

for (const [name, query] of FIXTURES) {
  const file = path.join(outDir, `${name}.jpg`);
  if (fs.existsSync(file) && manifest[name]) continue;
  const url = `https://api.pexels.com/v1/search?${new URLSearchParams({query, per_page: '10', orientation: 'landscape'})}`;
  const response = await fetch(url, {headers: {Authorization: key}});
  if (!response.ok) throw new Error(`Pexels ${response.status} for "${query}"`);
  const body = await response.json();
  const photo = (body.photos ?? []).find(item => !used.has(item.id) && item.src?.landscape);
  if (!photo) throw new Error(`no photo for "${query}"`);
  const image = await fetch(photo.src.landscape);
  if (!image.ok) throw new Error(`download ${image.status} for ${photo.src.landscape}`);
  fs.writeFileSync(file, Buffer.from(await image.arrayBuffer()));
  used.add(photo.id);
  manifest[name] = {query, id: photo.id, photographer: photo.photographer, photographerUrl: photo.photographer_url, pexelsUrl: photo.url, license: 'Pexels License (free to use, no attribution required)'};
  console.log('saved', name, `${query} -> pexels:${photo.id} by ${photo.photographer}`);
}
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log('credits', manifestPath);
