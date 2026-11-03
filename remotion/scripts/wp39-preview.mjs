/**
 * WP39: offline proof of the still-motion SPEED DIAL (Skill A polish). Renders the PRODUCTION `ImageRun` (full-bleed stills, 0.8 s hold) at motionSpeed slow / normal / fast and tiles the first / middle / last frame of
 * the hold: row 1 = fast (the WP36 push, "before"), row 2 = normal, row 3 = slow (the new default, "after"). Network: none (uses the cached public/wp36-fixtures stills). No live render, no SFX, no audio.
 * Usage (from remotion/): npm run preview:wp39
 * Output (out/phase36-readiness/): wp39-motion-speed.jpg, wp39-motion-speed.json, wp39-strip/*.png.  (wp36-faceless-doc.mp4 is NOT touched.)
 */
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(path.join(root, 'package.json'));
const {bundle} = require('@remotion/bundler');
const {openBrowser, renderStill, selectComposition} = require('@remotion/renderer');
const {bleedScaleAt, BLEED_PUSH_TO_BY_SPEED} = await import(pathToFileURL(path.join(root, 'src/lib/imageRunTiming.ts')).href); // node >= 22.18 strips the types natively (the same pure module the renderer uses)

const HOLD_FRAMES = 24;
const outDir = path.join(root, 'out/phase36-readiness');
const stripDir = path.join(outDir, 'wp39-strip');
fs.mkdirSync(stripDir, {recursive: true});
for (const name of fs.readdirSync(stripDir)) fs.rmSync(path.join(stripDir, name));
const sheet = path.join(outDir, 'wp39-motion-speed.jpg');
const measuredFile = path.join(outDir, 'wp39-motion-speed.json');

const fixtures = fs.readdirSync(path.join(root, 'public/wp36-fixtures')).filter(name => /\.jpg$/.test(name)).sort();
if (fixtures.length < 2) throw new Error('need >= 2 cached stills in public/wp36-fixtures (run npm run preview:wp36 once)');
const files = fixtures.slice(0, 2);

const speeds = [
  {speed: 'fast', label: 'before (WP36) fast 1.08'},
  {speed: 'normal', label: 'normal 1.06'},
  {speed: 'slow', label: 'after: slow DEFAULT 1.04'},
];
const frames = [0, HOLD_FRAMES / 2, HOLD_FRAMES - 1];

const serveUrl = await bundle({entryPoint: path.join(here, 'wp39/entry.tsx'), outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'wp39-bundle-')), publicDir: path.join(root, 'public')});
const browser = await openBrowser('chrome');
const cells = [];
try {
  for (const {speed} of speeds) {
    const inputProps = {motionSpeed: speed, files};
    const composition = await selectComposition({serveUrl, id: 'WP39Motion', inputProps, puppeteerInstance: browser});
    for (const frame of frames) {
      const raw = path.join(stripDir, `raw-${speed}-${frame}.png`);
      await renderStill({composition, serveUrl, output: raw, frame, inputProps, puppeteerInstance: browser});
      const small = path.join(stripDir, `${speed}-${String(frame).padStart(2, '0')}.png`);
      const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', raw, '-vf', 'scale=270:-2', small]);
      if (r.status !== 0) throw new Error(`ffmpeg scale failed: ${r.stderr}`);
      fs.rmSync(raw);
      cells.push(small);
    }
  }
} finally {
  await browser.close({silent: true});
}
const list = path.join(os.tmpdir(), 'wp39-list.txt');
fs.writeFileSync(list, cells.map(file => `file '${file}'\nduration 1`).join('\n') + `\nfile '${cells[cells.length - 1]}'\n`);
const tile = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-vf', `tile=${frames.length}x${speeds.length}:padding=6:color=black`, '-frames:v', '1', sheet]);
if (tile.status !== 0) throw new Error(`ffmpeg tile failed: ${tile.stderr}`);

const endScale = Object.fromEntries(speeds.map(({speed}) => [speed, bleedScaleAt(HOLD_FRAMES, HOLD_FRAMES, speed)]));
const perFrameZoom = Object.fromEntries(speeds.map(({speed}) => [speed, Math.round(((bleedScaleAt(HOLD_FRAMES, HOLD_FRAMES, speed) - 1) / HOLD_FRAMES) * 100000) / 100000]));
fs.writeFileSync(measuredFile, JSON.stringify({holdFrames: HOLD_FRAMES, fps: 30, rows: speeds.map(item => item.label), columns: ['frame 0', `frame ${HOLD_FRAMES / 2}`, `frame ${HOLD_FRAMES - 1}`], endScale, perFrameZoom, scaleBySpeed: BLEED_PUSH_TO_BY_SPEED, files}, null, 1));
console.log('wrote', sheet, JSON.stringify({endScale, perFrameZoom}));
