/**
 * WP31: offline proof that polish captions are bare video type, not glossy pills (no network, no live render).
 * Usage (from remotion/): npm run preview:wp31
 * Output (out/phase36-readiness/): wp31-bare-type.mp4 (the polish look), wp31-contact-sheet.jpg (polish, a frame every 0.5 s),
 *   wp31-before-after.jpg (top = WP28 glossy pill, bottom = WP31 polish, same frames), wp31-strip/*.png, wp31-directions.json (the real server output used).
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
const stripDir = path.join(outDir, 'wp31-strip');
fs.mkdirSync(stripDir, {recursive: true});
const mp4 = path.join(outDir, 'wp31-bare-type.mp4');
const sheet = path.join(outDir, 'wp31-contact-sheet.jpg');
const beforeAfter = path.join(outDir, 'wp31-before-after.jpg');
const directionsFile = path.join(outDir, 'wp31-directions.json');

function run(args, label) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args]);
  if (r.status !== 0) throw new Error(`ffmpeg ${label} failed: ${r.stderr}`);
}

// The directions come from the REAL server helper (polishBareCaption), not a copy: the WP28 default is shineCaptionDirection() verbatim (karaoke + highlight).
const script = `
import {polishBareCaption} from ${JSON.stringify(path.resolve(root, '../server/src/lib/polishBareCaption.ts'))};
const legacy = {position: 'bottom', bottomFrac: 0.16, textColor: '#FFFFFF', highlightColor: '#F5B942', boxColor: null, template: 'karaoke', animation: 'highlight', fontScale: 1, uppercase: false};
const polish = polishBareCaption(legacy, {lookId: 'clean_mono', templateLocked: false});
process.stdout.write(JSON.stringify({legacy, polish: polish.caption, warnings: polish.warnings}));
`;
const gen = spawnSync('node', ['--experimental-strip-types', '--input-type=module', '-e', script], {encoding: 'utf8'});
if (gen.status !== 0) throw new Error(`could not derive the polish direction: ${gen.stderr}`);
fs.writeFileSync(directionsFile, gen.stdout);
console.log('directions', gen.stdout);

const serveUrl = await bundle({entryPoint: path.join(here, 'wp31/entry.tsx'), outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'wp31-bundle-')), publicDir: path.join(root, 'public')});
const browser = await openBrowser('chrome');
try {
  const polish = await selectComposition({serveUrl, id: 'WP31Polish', puppeteerInstance: browser});
  const legacy = await selectComposition({serveUrl, id: 'WP31Legacy', puppeteerInstance: browser});
  const step = polish.fps / 2;
  const count = Math.floor(polish.durationInFrames / step);
  const polishFrames = [];
  const legacyFrames = [];
  const shrink = (full, small) => run(['-i', full, '-vf', 'scale=270:-1', small], 'strip');
  for (let index = 0; index < count; index += 1) {
    const frame = Math.min(polish.durationInFrames - 1, Math.round(index * step));
    for (const [composition, tag, list] of [[polish, 'polish', polishFrames], [legacy, 'legacy', legacyFrames]]) {
      const full = path.join(os.tmpdir(), `wp31-${tag}-${index}.png`);
      await renderStill({composition, serveUrl, frame, output: full, puppeteerInstance: browser, imageFormat: 'png', scale: 1});
      const small = path.join(stripDir, `${tag}-t${String(index).padStart(2, '0')}.png`);
      shrink(full, small);
      list.push(small);
    }
  }
  console.log('strip written', polishFrames.length);
  // polish contact sheet: 9 columns of the half-second frames
  run(['-framerate', '1', '-i', path.join(stripDir, 'polish-t%02d.png'), '-vf', 'tile=9x3:padding=4:color=black', '-frames:v', '1', sheet], 'sheet');
  // before / after: only the frames where a caption is up (karaoke segments), top row legacy, bottom row polish
  const picks = [8, 10, 12, 14, 18, 20, 22, 24].filter(i => i < count);
  const rows = ['legacy', 'polish'].map(tag => {
    const out = path.join(os.tmpdir(), `wp31-row-${tag}.jpg`);
    const inputs = picks.flatMap(i => ['-i', path.join(stripDir, `${tag}-t${String(i).padStart(2, '0')}.png`)]);
    run([...inputs, '-filter_complex', `${picks.map((_, k) => `[${k}:v]`).join('')}hstack=inputs=${picks.length}`, '-frames:v', '1', out], `row-${tag}`);
    return out;
  });
  run(['-i', rows[0], '-i', rows[1], '-filter_complex', 'vstack=inputs=2', '-frames:v', '1', beforeAfter], 'before-after');
  console.log('sheets', sheet, beforeAfter);
  const started = Date.now();
  const full = path.join(os.tmpdir(), 'wp31-full.mp4');
  await renderMedia({composition: polish, serveUrl, codec: 'h264', outputLocation: full, puppeteerInstance: browser, scale: 1, muted: true, onProgress: p => { if (p.renderedFrames % 60 === 0) console.log('frames', p.renderedFrames); }});
  run(['-i', full, '-vf', 'scale=540:-2', '-c:v', 'libx264', '-crf', '23', '-pix_fmt', 'yuv420p', '-an', mp4], 'shrink');
  console.log('wrote', mp4, `${((Date.now() - started) / 1000).toFixed(1)}s`);
} finally {
  await browser.close({silent: true});
}
