/**
 * WP33: offline proof of the VO cut grammar (no network, no live render, no model).
 * Usage (from remotion/): npm run preview:wp33   (uses the checked-in public/wp30-fixtures stills + the hardcoded fixture word timeline)
 * Steps: (1) plan with the REAL server planner (voCutGrammar.ts) from server/src/stages/broll/fixtures/wp33-vo-words.json, (2) render a faceless still montage that hard-cuts on every caption group,
 * (3) measure the rendered MP4 for scene changes (ffmpeg) so the shot density is checked on the file, not just on the plan.
 * Output (out/phase36-readiness/): wp33-vo-cut-grammar.mp4, wp33-contact-sheet.jpg (one frame per shot), wp33-plan.json (the planner output + the still per shot), wp33-measured.json (scene-change count on the MP4), wp33-strip/*.png.
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
const stripDir = path.join(outDir, 'wp33-strip');
fs.mkdirSync(stripDir, {recursive: true});
for (const name of fs.readdirSync(stripDir)) fs.rmSync(path.join(stripDir, name));
const mp4 = path.join(outDir, 'wp33-vo-cut-grammar.mp4');
const sheet = path.join(outDir, 'wp33-contact-sheet.jpg');
const planFile = path.join(outDir, 'wp33-plan.json');
const measuredFile = path.join(outDir, 'wp33-measured.json');

if (!fs.existsSync(path.join(root, 'public/wp30-fixtures/a1-startup-office.jpg'))) throw new Error('missing public/wp30-fixtures: run node scripts/wp30/fetch-fixtures.mjs');

function run(args, label) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args]);
  if (r.status !== 0) throw new Error(`ffmpeg ${label} failed: ${r.stderr}`);
}

// 1) the plan comes from the REAL planner (the same module the polish path calls), from the hardcoded fixture word timeline
const script = `
import {readFileSync} from 'node:fs';
import {ctaWindowsOf, moneyWindowsOf, planVoCutGrammar} from ${JSON.stringify(path.resolve(root, '../server/src/stages/broll/voCutGrammar.ts'))};
const fixture = JSON.parse(readFileSync(${JSON.stringify(path.resolve(root, '../server/src/stages/broll/fixtures/wp33-vo-words.json'))}, 'utf8'));
const flags = {moneyWindows: moneyWindowsOf(fixture.words), ctaWindows: ctaWindowsOf(fixture.words, fixture.durationSec)};
const plan = planVoCutGrammar({words: fixture.words, durationSec: fixture.durationSec, flags});
process.stdout.write(JSON.stringify({durationSec: fixture.durationSec, flags, ...plan}));
`;
const gen = spawnSync('node', ['--experimental-strip-types', '--input-type=module', '-e', script], {encoding: 'utf8', maxBuffer: 1 << 26});
if (gen.status !== 0) throw new Error(`could not plan the cut grammar: ${gen.stderr}`);
const plan = JSON.parse(gen.stdout);

// a literal noun -> still (WP36 will make this the real noun-literal stock selection); otherwise the rotation. Never the same still twice in a row.
const LITERAL = {
  'a2-counting-cash': ['billion', 'dollars', 'investors', 'poured', 'six'],
  'a1-startup-office': ['startup', 'office', 'founder', 'company', 'tiny'],
  'a3-newspaper': ['headlines', 'called', 'genius', 'cheered'],
  'a4-city-crowd': ['crowd', 'growing', 'everyone'],
  'b1-laptop-desk': ['numbers', 'perfect', 'built', 'looked'],
  'b2-empty-desk': ['collapsed', 'fired', 'email', 'empty'],
  'b3-subway': ['morning', 'years', 'cold'],
  'c1-press': ['press', 'follow', 'part'],
};
const ROTATION = Object.keys(LITERAL);
const clean = word => word.toLowerCase().replace(/[^a-z0-9]+/g, '');
let spin = 0;
let previous = '';
plan.shots = plan.shots.map(shot => {
  const spoken = plan.groups.filter(group => group.start >= shot.start - 0.01 && group.start < shot.end - 0.01).flatMap(group => group.words.map(clean));
  let still = ROTATION.find(name => LITERAL[name].some(noun => spoken.includes(noun)) && name !== previous);
  if (!still) {
    do { still = ROTATION[spin % ROTATION.length]; spin += 1; } while (still === previous);
  }
  previous = still;
  return {...shot, still};
});
fs.writeFileSync(planFile, JSON.stringify(plan, null, 1));
const wanted = plan.durationSec / 0.85;
console.log(`plan: ${plan.stats.shotCount} shots in ${plan.durationSec}s (target ${wanted.toFixed(1)} = duration/0.85, mean ${plan.stats.meanShotSec}s), holds ${plan.holds.length}, chapter cards ${plan.chapterCards.length}`);
console.log(plan.warnings.join(' '));

const serveUrl = await bundle({entryPoint: path.join(here, 'wp33/entry.tsx'), outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'wp33-bundle-')), publicDir: path.join(root, 'public')});
const browser = await openBrowser('chrome');
try {
  const composition = await selectComposition({serveUrl, id: 'WP33Montage', puppeteerInstance: browser});
  // 2) contact sheet: the middle frame of every shot
  const frames = [];
  for (const [index, shot] of plan.shots.entries()) {
    const frame = Math.min(composition.durationInFrames - 1, Math.round(((shot.start + shot.end) / 2) * composition.fps));
    const full = path.join(os.tmpdir(), `wp33-shot-${index}.png`);
    await renderStill({composition, serveUrl, frame, output: full, puppeteerInstance: browser, imageFormat: 'png', scale: 1});
    const small = path.join(stripDir, `shot-${String(index).padStart(2, '0')}.png`);
    run(['-i', full, '-vf', 'scale=216:-1', small], 'strip');
    frames.push(small);
  }
  const columns = 8;
  const rows = Math.ceil(frames.length / columns);
  run(['-framerate', '1', '-i', path.join(stripDir, 'shot-%02d.png'), '-vf', `tile=${columns}x${rows}:padding=4:color=black`, '-frames:v', '1', sheet], 'sheet');
  console.log('contact sheet', sheet, `${frames.length} shots`);
  // 3) the video
  const started = Date.now();
  const full = path.join(os.tmpdir(), 'wp33-full.mp4');
  await renderMedia({composition, serveUrl, codec: 'h264', outputLocation: full, puppeteerInstance: browser, scale: 1, muted: true, onProgress: p => { if (p.renderedFrames % 100 === 0) console.log('frames', p.renderedFrames); }});
  run(['-i', full, '-vf', 'scale=540:-2', '-c:v', 'libx264', '-crf', '23', '-pix_fmt', 'yuv420p', '-an', mp4], 'shrink');
  console.log('wrote', mp4, `${((Date.now() - started) / 1000).toFixed(1)}s`);
} finally {
  await browser.close({silent: true});
}

// 4) measure the MP4: count scene changes (every cut changes the still; a push-in alone is far below the threshold)
const probe = spawnSync('ffmpeg', ['-v', 'info', '-i', mp4, '-vf', "select='gt(scene,0.2)',showinfo", '-an', '-f', 'null', '-'], {encoding: 'utf8', maxBuffer: 1 << 26});
const changes = [...probe.stderr.matchAll(/pts_time:([\d.]+)/g)].map(match => Number(match[1]));
const duration = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', mp4], {encoding: 'utf8'}).stdout.trim());
const measured = {durationSec: duration, plannedShots: plan.stats.shotCount, plannedCuts: plan.cuts.length, detectedSceneChanges: changes.length, detectedShots: changes.length + 1, meanShotSecMeasured: Math.round((duration / (changes.length + 1)) * 1000) / 1000, targetShots: Math.round((duration / 0.85) * 10) / 10, changes};
fs.writeFileSync(measuredFile, JSON.stringify(measured, null, 1));
console.log('measured', JSON.stringify({...measured, changes: undefined}));
