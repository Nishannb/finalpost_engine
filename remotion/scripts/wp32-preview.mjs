/**
 * WP32: offline proof of the photo-as-world ImageRun backdrop + chest-band bare type (no network, no live render).
 * Usage (from remotion/): npm run preview:wp32   (uses the checked-in public/wp30-fixtures stills)
 * Output (out/phase36-readiness/): wp32-photo-world.mp4 (the WP32 look), wp32-contact-sheet.jpg (new, a frame every 0.5 s),
 *   wp32-old-vs-new.jpg (top = WP30/31 framed card on a dim veil + template-size type, bottom = WP32, same frames), wp32-strip/*.png, wp32-directions.json (the real server output used).
 */
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(path.join(root, 'package.json'));
const {bundle} = require('@remotion/bundler');
const {openBrowser, renderMedia, renderStill, selectComposition} = require('@remotion/renderer');

const outDir = path.join(root, 'out/phase36-readiness');
const stripDir = path.join(outDir, 'wp32-strip');
fs.mkdirSync(stripDir, {recursive: true});
const mp4 = path.join(outDir, 'wp32-photo-world.mp4');
const sheet = path.join(outDir, 'wp32-contact-sheet.jpg');
const oldVsNew = path.join(outDir, 'wp32-old-vs-new.jpg');
const directionsFile = path.join(outDir, 'wp32-directions.json');

if (!fs.existsSync(path.join(root, 'public/wp30-fixtures/a1-startup-office.jpg'))) throw new Error('missing public/wp30-fixtures: run node scripts/wp30/fetch-fixtures.mjs');

function run(args, label) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args]);
  if (r.status !== 0) throw new Error(`ffmpeg ${label} failed: ${r.stderr}`);
}

// The directions come from the REAL server helper (polishBareCaption): `new` is what polish ships now; `old` is the same direction at the WP31 template size (no WP32 scale / word cap).
const script = `
import {polishBareCaption} from ${JSON.stringify(path.resolve(root, '../server/src/lib/polishBareCaption.ts'))};
const shine = {position: 'bottom', bottomFrac: 0.16, textColor: '#FFFFFF', highlightColor: '#F5B942', boxColor: null, template: 'karaoke', animation: 'highlight', fontScale: 1, uppercase: false};
const polish = polishBareCaption(shine, {lookId: 'clean_mono', templateLocked: false});
const {fontScale, maxWords, ...rest} = polish.caption;
process.stdout.write(JSON.stringify({new: polish.caption, old: {...rest, fontScale: 1}, warnings: polish.warnings}));
`;
const gen = spawnSync('node', ['--experimental-strip-types', '--input-type=module', '-e', script], {encoding: 'utf8'});
if (gen.status !== 0) throw new Error(`could not derive the polish direction: ${gen.stderr}`);
fs.writeFileSync(directionsFile, gen.stdout);
console.log('directions', gen.stdout);

const serveUrl = await bundle({entryPoint: path.join(here, 'wp32/entry.tsx'), outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'wp32-bundle-')), publicDir: path.join(root, 'public')});
const browser = await openBrowser('chrome');
try {
  const next = await selectComposition({serveUrl, id: 'WP32New', puppeteerInstance: browser});
  const old = await selectComposition({serveUrl, id: 'WP32Old', puppeteerInstance: browser});
  const step = next.fps / 2;
  const count = Math.floor(next.durationInFrames / step);
  const newFrames = [];
  const shrink = (full, small) => run(['-i', full, '-vf', 'scale=270:-1', small], 'strip');
  for (let index = 0; index < count; index += 1) {
    const frame = Math.min(next.durationInFrames - 1, Math.round(index * step));
    for (const [composition, tag] of [[next, 'new'], [old, 'old']]) {
      const full = path.join(os.tmpdir(), `wp32-${tag}-${index}.png`);
      await renderStill({composition, serveUrl, frame, output: full, puppeteerInstance: browser, imageFormat: 'png', scale: 1});
      const small = path.join(stripDir, `${tag}-t${String(index).padStart(2, '0')}.png`);
      shrink(full, small);
      if (tag === 'new') newFrames.push(small);
    }
  }
  console.log('strip written', newFrames.length);
  run(['-framerate', '1', '-i', path.join(stripDir, 'new-t%02d.png'), '-vf', 'tile=10x2:padding=4:color=black', '-frames:v', '1', sheet], 'sheet');
  // old vs new: frames where words are up on both halves of the timeline, top row old, bottom row new
  const picks = [1, 3, 5, 7, 9, 11, 13, 15, 17].filter(i => i < count);
  const rows = ['old', 'new'].map(tag => {
    const out = path.join(os.tmpdir(), `wp32-row-${tag}.jpg`);
    const inputs = picks.flatMap(i => ['-i', path.join(stripDir, `${tag}-t${String(i).padStart(2, '0')}.png`)]);
    run([...inputs, '-filter_complex', `${picks.map((_, k) => `[${k}:v]`).join('')}hstack=inputs=${picks.length}`, '-frames:v', '1', out], `row-${tag}`);
    return out;
  });
  run(['-i', rows[0], '-i', rows[1], '-filter_complex', 'vstack=inputs=2', '-frames:v', '1', oldVsNew], 'old-vs-new');
  console.log('sheets', sheet, oldVsNew);
  const started = Date.now();
  const full = path.join(os.tmpdir(), 'wp32-full.mp4');
  await renderMedia({composition: next, serveUrl, codec: 'h264', outputLocation: full, puppeteerInstance: browser, scale: 1, muted: true, onProgress: p => { if (p.renderedFrames % 60 === 0) console.log('frames', p.renderedFrames); }});
  run(['-i', full, '-vf', 'scale=540:-2', '-c:v', 'libx264', '-crf', '23', '-pix_fmt', 'yuv420p', '-an', mp4], 'shrink');
  console.log('wrote', mp4, `${((Date.now() - started) / 1000).toFixed(1)}s`);
} finally {
  await browser.close({silent: true});
}
