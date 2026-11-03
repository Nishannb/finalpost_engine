/**
 * WP25: render the local open preview MP4 (and a 1 fps frame strip as a fallback / quick look). Offline: local bundle + the headless Chrome Remotion already has; no Lambda, no network, no paid API.
 * Usage (from remotion/): node scripts/wp25-preview.mjs   (npm run preview:wp25)
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
const stripDir = path.join(outDir, 'wp25-strip');
fs.mkdirSync(stripDir, {recursive: true});
const mp4 = path.join(outDir, 'wp25-open-preview.mp4');

// NOTE: render at scale 1 and shrink with ffmpeg. Chromium's headless backdrop-filter (used by the smash / whip / dissolve layers) folds and mirrors the picture when Remotion renders with scale != 1.
function shrink(from, to, width) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', from, '-vf', `scale=${width}:-1`, to]);
  if (r.status !== 0) throw new Error(`ffmpeg shrink failed: ${r.stderr}`);
}
function shrinkVideo(from, to, width) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', from, '-vf', `scale=${width}:-2`, '-c:v', 'libx264', '-crf', '23', '-pix_fmt', 'yuv420p', '-an', to]);
  if (r.status !== 0) throw new Error(`ffmpeg shrink failed: ${r.stderr}`);
}

const serveUrl = await bundle({entryPoint: path.join(here, 'wp25/entry.tsx'), outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'wp25-bundle-'))});
const browser = await openBrowser('chrome');
try {
  const composition = await selectComposition({serveUrl, id: 'WP25Open', puppeteerInstance: browser});
  // 1 fps strip first (cheap, and the fallback if the MP4 cannot be encoded here)
  for (let sec = 0; sec * composition.fps < composition.durationInFrames; sec += 1) {
    const full = path.join(os.tmpdir(), `wp25-strip-${sec}.png`);
    await renderStill({composition, serveUrl, frame: sec * composition.fps, output: full, puppeteerInstance: browser, imageFormat: 'png', scale: 1});
    shrink(full, path.join(stripDir, `t${String(sec).padStart(2, '0')}s.png`), 270);
  }
  console.log('strip written');
  const started = Date.now();
  const full = path.join(os.tmpdir(), 'wp25-full.mp4');
  await renderMedia({composition, serveUrl, codec: 'h264', outputLocation: full, puppeteerInstance: browser, scale: 1, muted: true, onProgress: p => { if (p.renderedFrames % 60 === 0) console.log('frames', p.renderedFrames); }});
  shrinkVideo(full, mp4, 540);
  console.log('wrote', mp4, `${((Date.now() - started) / 1000).toFixed(1)}s`);
} finally {
  await browser.close({silent: true});
}
