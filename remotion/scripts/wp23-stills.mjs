/**
 * WP23: render local PNG stills of the Metromedia-open comps with fixture props. Offline: local bundle + the headless Chrome Remotion already downloaded; no Lambda, no network, no paid API.
 * Usage (from remotion/): node scripts/wp23-stills.mjs
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
const {openBrowser, renderStill, selectComposition} = require('@remotion/renderer');

const outDir = path.join(root, process.env.WP_STILLS_DIR ?? 'out/phase36-readiness/wp23-stills'); // WP24: WP_STILLS_DIR=out/phase36-readiness/wp24-stills re-renders the same frames after the craft fixes
fs.mkdirSync(outDir, {recursive: true});

// [composition, frame, file]. Transition frames are the MIDDLE of each window (transitionWindow: from = at - 0.35 * duration, 15 frames long); the WP23 first pass sat on their tails (frames 20 / 68 / 112 / 158).
const SHOTS = [
  ['WP23Flash', 4, 'flash_card_f04_slam-in.png'],
  ['WP23Flash', 14, 'flash_card_f14_settled.png'],
  ['WP23Cloud', 3, 'logo_cloud_f03_entrance.png'],
  ['WP23Cloud', 40, 'logo_cloud_f40_hold.png'],
  ['WP23Cloud', 68, 'logo_cloud_f68_hero-repop.png'],
  ['WP23Sequence', 8, 'image_run_sequence_f08_item1-logo_slam.png'],
  ['WP23Sequence', 38, 'image_run_sequence_f38_item2-card_tilt.png'],
  ['WP23Sequence', 70, 'image_run_sequence_f70_item3.png'],
  ['WP23Transitions', 17, 'transition_whip_blur_right_mid.png'],
  ['WP23Transitions', 62, 'transition_smash_zoom_mid.png'],
  ['WP23Transitions', 107, 'transition_dip_color_mid.png'],
  ['WP23Transitions', 152, 'transition_flash_white_mid.png'],
  ['WP23Tilt', 2, 'card_tilt_in_f02.png'],
  ['WP23Tilt', 6, 'card_tilt_in_f06.png'],
  ['WP23Tilt', 12, 'card_tilt_in_f12.png'],
  ['WP23Tilt', 40, 'card_tilt_in_f40_settled.png'],
];

const serveUrl = await bundle({entryPoint: path.join(here, 'wp23/entry.tsx'), outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'wp23-bundle-'))});
const browser = await openBrowser('chrome');
try {
  for (const [id, frame, file] of SHOTS) {
    const composition = await selectComposition({serveUrl, id, puppeteerInstance: browser});
    // render at scale 1 and shrink with ffmpeg: headless Chromium folds backdrop-filter layers (smash / whip / dissolve) when Remotion renders with scale != 1
    const full = path.join(os.tmpdir(), `wp23-${id}-${frame}.png`);
    await renderStill({composition, serveUrl, frame, output: full, puppeteerInstance: browser, imageFormat: 'png', scale: 1});
    const shrink = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', full, '-vf', 'scale=540:-1', path.join(outDir, file)]);
    if (shrink.status !== 0) throw new Error(`ffmpeg shrink failed: ${shrink.stderr}`);
    console.log('wrote', file);
  }
} finally {
  await browser.close({silent: true});
}
