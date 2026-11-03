/**
 * WP30: render the offline editorial still montage (real Pexels stills from public/wp30-fixtures, no network): a 1 fps frame strip, a contact sheet and the MP4.
 * Usage (from remotion/): npm run preview:wp30   (first run: node scripts/wp30/fetch-fixtures.mjs to fetch the stills; they are checked in)
 * Output: out/phase36-readiness/wp30-editorial-montage.mp4 + wp30-strip/ + wp30-contact-sheet.jpg
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
const stripDir = path.join(outDir, 'wp30-strip');
fs.mkdirSync(stripDir, {recursive: true});
const mp4 = path.join(outDir, 'wp30-editorial-montage.mp4');
const sheet = path.join(outDir, 'wp30-contact-sheet.jpg');

if (!fs.existsSync(path.join(root, 'public/wp30-fixtures/a1-startup-office.jpg'))) throw new Error('missing public/wp30-fixtures: run node scripts/wp30/fetch-fixtures.mjs');

// NOTE: render at scale 1 and shrink with ffmpeg (headless backdrop-filter folds the picture when scale != 1; see wp25-preview.mjs).
function run(args, label) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args]);
  if (r.status !== 0) throw new Error(`ffmpeg ${label} failed: ${r.stderr}`);
}

const serveUrl = await bundle({entryPoint: path.join(here, 'wp30/entry.tsx'), outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'wp30-bundle-')), publicDir: path.join(root, 'public')});
const browser = await openBrowser('chrome');
try {
  const composition = await selectComposition({serveUrl, id: 'WP30Montage', puppeteerInstance: browser});
  // 2 frames per second strip (a still every 0.5 s is the density the ref lives at), then the contact sheet
  const step = composition.fps / 2;
  const frames = [];
  for (let index = 0; index * step < composition.durationInFrames; index += 1) {
    const full = path.join(os.tmpdir(), `wp30-strip-${index}.png`);
    await renderStill({composition, serveUrl, frame: Math.min(composition.durationInFrames - 1, Math.round(index * step)), output: full, puppeteerInstance: browser, imageFormat: 'png', scale: 1});
    const small = path.join(stripDir, `t${String(index).padStart(2, '0')}.png`);
    run(['-i', full, '-vf', 'scale=270:-1', small], 'strip');
    frames.push(small);
  }
  console.log('strip written', frames.length);
  // contact sheet: 12 columns x N rows of the half-second frames
  run(['-framerate', '1', '-i', path.join(stripDir, 't%02d.png'), '-vf', 'tile=12x3:padding=4:color=black', '-frames:v', '1', sheet], 'sheet');
  console.log('sheet', sheet);
  const started = Date.now();
  const full = path.join(os.tmpdir(), 'wp30-full.mp4');
  await renderMedia({composition, serveUrl, codec: 'h264', outputLocation: full, puppeteerInstance: browser, scale: 1, muted: true, onProgress: p => { if (p.renderedFrames % 60 === 0) console.log('frames', p.renderedFrames); }});
  run(['-i', full, '-vf', 'scale=540:-2', '-c:v', 'libx264', '-crf', '23', '-pix_fmt', 'yuv420p', '-an', mp4], 'shrink');
  console.log('wrote', mp4, `${((Date.now() - started) / 1000).toFixed(1)}s`);
} finally {
  await browser.close({silent: true});
}
