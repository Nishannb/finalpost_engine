/**
 * Text-behind readability proof: the environmental hero SWEEPS behind the presenter (every letter clear for a stretch); small word-pop type is never behind. LOCAL render only (no Lambda, no network, no model run: the cutout is the existing Phase 3 RVM WebM).
 * Usage (from remotion/):  node scripts/kinetic-led-rvm-proof.mjs     (not an npm script)
 * Output (out/kinetic-led-rvm/): hero-readable.mp4 (ATTENTION, big, scrolling) + hero-readable-{early,mid,late}.png (early = beginning of the word clear of the head, late = its ending, mid = in transit behind the person), hero-legacy-static.png (the old bug, for comparison),
 *   wordpop-beside.mp4 + wordpop-beside.png (stale occlusion request, still beside the presenter).
 * Refuses to start under 1.5 GiB free; the temp bundle and the temp public dir (a copy of public/ + the cutout) are removed at the end.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const engine = path.resolve(root, '..');
const require = createRequire(path.join(root, 'package.json'));
const CUTOUT = path.join(engine, 'subjectmatte/out/phase3/hi-first48.webm');
const outDir = path.join(root, 'out/kinetic-led-rvm');

const stat = fs.statfsSync(root);
const free = stat.bavail * stat.bsize;
if (free < 1.5 * 1024 ** 3) {
  console.error(`STOP: ${(free / 1024 ** 3).toFixed(2)} GiB free, need 1.5. Nothing was bundled.`);
  process.exit(2);
}
// the RVM cutout is optional here: without a valid one (matte deferred) the hero still renders in the matte (sweep) layout, just without the presenter drawn on top; the safe-zone check does not depend on it
const hasCutout = fs.existsSync(CUTOUT) && fs.statSync(CUTOUT).size > 0;
if (!hasCutout) console.warn(`WARN: no valid cutout at ${CUTOUT}: rendering without the presenter foreground`);
for (const p of [path.join(root, 'public/hi.mp4'), path.join(root, 'public/fonts')]) if (!fs.existsSync(p)) throw new Error(`missing ${p}`);

const {bundle} = require('@remotion/bundler');
const {openBrowser, renderMedia, renderStill, selectComposition} = require('@remotion/renderer');
fs.mkdirSync(outDir, {recursive: true});
const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kled-bundle-'));
const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kled-public-'));
fs.cpSync(path.join(root, 'public'), publicDir, {recursive: true});
fs.mkdirSync(path.join(publicDir, 'rvm-kled'), {recursive: true});
if (hasCutout) fs.copyFileSync(CUTOUT, path.join(publicDir, 'rvm-kled/cutout.webm'));

let browser;
const written = [];
try {
  const serveUrl = await bundle({entryPoint: path.join(here, 'kinetic-led-rvm/entry.tsx'), outDir: bundleDir, publicDir});
  browser = await openBrowser('chrome');
  const still = async (id, matte, frame, name) => {
    const inputProps = {matte, noFg: !hasCutout};
    const composition = await selectComposition({serveUrl, id, puppeteerInstance: browser, inputProps});
    const output = path.join(outDir, name);
    await renderStill({composition, serveUrl, frame, output, puppeteerInstance: browser, imageFormat: 'png', inputProps, logLevel: 'warn'});
    written.push(output);
  };
  const video = async (id, name) => {
    const inputProps = {matte: true, noFg: !hasCutout};
    const composition = await selectComposition({serveUrl, id, puppeteerInstance: browser, inputProps});
    const output = path.join(outDir, name);
    await renderMedia({composition, serveUrl, codec: 'h264', outputLocation: output, puppeteerInstance: browser, muted: true, imageFormat: 'png', crf: 18, inputProps, logLevel: 'warn'});
    written.push(output);
  };
  // marquee timeline (48 frames @ 25 fps): rest at the start (beginning of the word clear) ~ frames 0-9, scroll ~ 10-43, rest at the end (ending of the word clear) ~ frames 44-47
  await still('KledHero', true, 4, 'hero-readable-early.png');
  await still('KledHero', true, 24, 'hero-readable-mid.png');
  await still('KledHero', true, 46, 'hero-readable-late.png');
  await still('KledHeroLegacy', true, 28, 'hero-legacy-static.png');
  await still('KledWordPop', true, 14, 'wordpop-beside.png');
  await video('KledHero', 'hero-readable.mp4');
  await video('KledWordPop', 'wordpop-beside.mp4');
} finally {
  if (browser) await browser.close({silent: true});
  fs.rmSync(bundleDir, {recursive: true, force: true});
  fs.rmSync(publicDir, {recursive: true, force: true});
}
console.log('wrote:\n' + written.map(f => '  ' + f).join('\n'));
