/**
 * WP35: offline proof of the IMPACT FX (overexpose flash, saturation glow pop, money punch-in, black-and-white spans) and the framed-card exit (white border + 3D fly-out). No live render, no model, no network
 * (except the bundled font fetch).
 * Usage (from remotion/): npm run preview:wp35   (uses the checked-in public/wp30-fixtures stills + server/src/stages/broll/fixtures/wp35-vo-words.json)
 * Steps: (1) plan with the REAL server planners (voCutGrammar.ts cuts / holds / chapter card, polishAccumulateCaptions.ts captions, polishImpactFx.ts effects),
 * (2) render the faceless montage with the PRODUCTION ImpactFxTrack / ImpactPunch / AccumulateCaptions and the PRODUCTION ImageRun (borderPx + exit="fly_out"),
 * (3) cut the evidence: a contact strip (one row per effect, frame by frame), the card fly-out strip (new vs the old hard cut) and the measurements (frame luminance / saturation of the rendered stills).
 * Output (out/phase36-readiness/): wp35-impact-fx.mp4, wp35-contact-strip.jpg, wp35-flyout-strip.jpg, wp35-plan.json, wp35-measured.json, wp35-strip/*.png.
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

const FPS = 30;
const CARD_HOLD = 40;
const outDir = path.join(root, 'out/phase36-readiness');
const stripDir = path.join(outDir, 'wp35-strip');
fs.mkdirSync(stripDir, {recursive: true});
for (const name of fs.readdirSync(stripDir)) fs.rmSync(path.join(stripDir, name));
const mp4 = path.join(outDir, 'wp35-impact-fx.mp4');
const contactSheet = path.join(outDir, 'wp35-contact-strip.jpg');
const flyoutSheet = path.join(outDir, 'wp35-flyout-strip.jpg');
const planFile = path.join(outDir, 'wp35-plan.json');
const measuredFile = path.join(outDir, 'wp35-measured.json');

if (!fs.existsSync(path.join(root, 'public/wp30-fixtures/a1-startup-office.jpg'))) throw new Error('missing public/wp30-fixtures: run node scripts/wp30/fetch-fixtures.mjs');

function run(args, label) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args]);
  if (r.status !== 0) throw new Error(`ffmpeg ${label} failed: ${r.stderr}`);
}

// 1) the plan comes from the REAL planners (the modules the polish path calls), from the hardcoded fixture word timeline
const script = `
import {readFileSync} from 'node:fs';
import {ctaWindowsOf, moneyWindowsOf, planVoCutGrammar} from ${JSON.stringify(path.resolve(root, '../server/src/stages/broll/voCutGrammar.ts'))};
import {polishAccumulateCaptions} from ${JSON.stringify(path.resolve(root, '../server/src/lib/polishAccumulateCaptions.ts'))};
import {planImpactFx} from ${JSON.stringify(path.resolve(root, '../server/src/lib/polishImpactFx.ts'))};
const fixture = JSON.parse(readFileSync(${JSON.stringify(path.resolve(root, '../server/src/stages/broll/fixtures/wp35-vo-words.json'))}, 'utf8'));
const flags = {moneyWindows: moneyWindowsOf(fixture.words), ctaWindows: ctaWindowsOf(fixture.words, fixture.durationSec)};
const plan = planVoCutGrammar({words: fixture.words, durationSec: fixture.durationSec, flags});
let sentence = 0;
const words = fixture.words.map(word => {
  const out = {text: word.text, start: word.start, end: word.end, sentenceIndex: sentence};
  if (/[.!?]["')]*$/.test(word.text)) sentence += 1;
  return out;
});
const bare = {position: 'bottom', bottomFrac: 0.2, textColor: '#FFFFFF', highlightColor: '#FFFFFF', boxColor: null, template: 'karaoke', animation: 'scale', fontScale: 1.4, maxWords: 2, glow: false, activeStyle: 'fill'};
const accumulate = polishAccumulateCaptions(bare, {plan, words: fixture.words, durationSec: fixture.durationSec});
const impact = planImpactFx({words: fixture.words, plan, durationSec: fixture.durationSec});
process.stdout.write(JSON.stringify({durationSec: fixture.durationSec, flags, ...plan, words, direction: accumulate.caption, fx: impact.fx, fxWarnings: impact.warnings, fxStats: impact.stats}));
`;
const gen = spawnSync('node', ['--experimental-strip-types', '--input-type=module', '-e', script], {encoding: 'utf8', maxBuffer: 1 << 26});
if (gen.status !== 0) throw new Error(`could not plan the impact fx: ${gen.stderr}`);
const plan = JSON.parse(gen.stdout);

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
console.log(`plan: ${plan.stats.shotCount} shots; fx ${plan.fxWarnings.join(' ')}`);

const frameOfSec = sec => Math.round(sec * FPS);
const serveUrl = await bundle({entryPoint: path.join(here, 'wp35/entry.tsx'), outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'wp35-bundle-')), publicDir: path.join(root, 'public')});
const browser = await openBrowser('chrome');
const stills = {};
const WIDTH = 200;
async function still(id, frame, tag, width = WIDTH) {
  const key = `${id}-${frame}`;
  if (!stills[key]) {
    const composition = await selectComposition({serveUrl, id, puppeteerInstance: browser});
    const full = path.join(os.tmpdir(), `wp35-${id}-${frame}.png`);
    await renderStill({composition, serveUrl, frame: Math.min(composition.durationInFrames - 1, Math.max(0, frame)), output: full, puppeteerInstance: browser, imageFormat: 'png', scale: 1});
    stills[key] = full;
  }
  const small = path.join(stripDir, `${tag}.png`);
  run(['-i', stills[key], '-vf', `scale=${width}:-1`, small], `strip ${tag}`);
  return {file: small, full: stills[key], frame};
}
const blank = path.join(stripDir, '_blank.png');
run(['-f', 'lavfi', '-i', `color=c=black:s=${WIDTH}x${Math.round((WIDTH * 1920) / 1080)}`, '-frames:v', '1', blank], 'blank');
function sheet(rows, out, label) {
  const columns = Math.max(...rows.map(row => row.length));
  const files = rows.flatMap(row => [...row.map(item => item.file), ...Array(columns - row.length).fill(blank)]);
  const list = path.join(os.tmpdir(), `wp35-list-${path.basename(out)}.txt`);
  fs.writeFileSync(list, files.map(file => `file '${file}'\nduration 1`).join('\n') + `\nfile '${files[files.length - 1]}'\n`);
  run(['-f', 'concat', '-safe', '0', '-i', list, '-vf', `tile=${columns}x${rows.length}:padding=4:color=black`, '-frames:v', '1', out], label);
}
// mean luma + mean saturation of a rendered frame (the numbers the proof is judged on besides the eye)
function measure(file) {
  const out = spawnSync('ffmpeg', ['-v', 'info', '-i', file, '-vf', 'scale=108:-1,format=rgb24,signalstats,metadata=print:file=-', '-f', 'null', '-'], {encoding: 'utf8', maxBuffer: 1 << 26});
  const text = `${out.stdout}\n${out.stderr}`;
  const pick = key => Number((text.match(new RegExp(`lavfi\\.signalstats\\.${key}=([\\d.]+)`)) ?? [])[1]);
  return {yavg: Math.round(pick('YAVG') * 10) / 10, satavg: Math.round(pick('SATAVG') * 10) / 10};
}

try {
  const fx = plan.fx;
  const rowsMeta = {};
  const measured = {};

  // row 1: flashes (hook word + major reveal): frame before, the 2 flash frames, the frame after
  const flashRow = [];
  rowsMeta.flash = [];
  for (const [index, flash] of fx.flashes.entries()) {
    const f0 = frameOfSec(flash.startSec);
    for (const offset of [-1, 0, 1, 2]) {
      const item = await still('WP35Impact', f0 + offset, `flash-${index}-${offset + 1}`);
      flashRow.push(item);
      rowsMeta.flash.push({reason: flash.reason, frame: item.frame, offset});
      measured[`flash-${index}-${offset}`] = {frame: item.frame, ...measure(item.full)};
    }
  }
  // row 2: saturation glow pop on the name (frame before, the 3 pop frames, then settled), with the same frames WITHOUT the fx for contrast
  const satRow = [];
  const sat = fx.satPops[0];
  rowsMeta.satPop = [];
  if (sat) {
    const f0 = frameOfSec(sat.startSec);
    for (const offset of [-1, 0, 1, 2, 3, 5]) {
      const item = await still('WP35Impact', f0 + offset, `sat-${offset + 1}`);
      satRow.push(item);
      rowsMeta.satPop.push({frame: item.frame, offset});
      measured[`sat-${offset}`] = {frame: item.frame, ...measure(item.full)};
    }
  }
  // row 3: the punch-in on the money hold: scale 1 -> 1.10 over 7 frames, held, reset on the next cut
  const punchRow = [];
  const punch = fx.punchIns[0];
  rowsMeta.punch = [];
  if (punch) {
    const f0 = frameOfSec(punch.startSec);
    const fEnd = frameOfSec(punch.endSec);
    for (const frame of [f0, f0 + 2, f0 + 4, f0 + 7, f0 + 14, fEnd - 1, fEnd]) {
      const item = await still('WP35Impact', frame, `punch-${frame}`);
      punchRow.push(item);
      rowsMeta.punch.push({frame});
    }
  }
  // row 4: black-and-white spans: the frame before the flip, the first frame in, mid, the last frame in, the frame after
  const bwRow = [];
  rowsMeta.bw = [];
  for (const [index, span] of fx.bwSpans.entries()) {
    const f0 = frameOfSec(span.startSec);
    const f1 = frameOfSec(span.endSec);
    const picks = index === 0 ? [f0 + 1, Math.round((f0 + f1) / 2), f1] : [f0 - 1, f0, Math.round((f0 + f1) / 2), f1 - 1, f1];
    for (const frame of picks) {
      const item = await still('WP35Impact', frame, `bw-${index}-${frame}`);
      bwRow.push(item);
      rowsMeta.bw.push({span: index, frame});
      measured[`bw-${index}-${frame}`] = {frame, ...measure(item.full)};
    }
  }
  sheet([flashRow, satRow, punchRow, bwRow.slice(0, 8)], contactSheet, 'contact strip');
  console.log('contact strip', contactSheet, JSON.stringify(rowsMeta));

  // the card fly-out: the cut at frame CARD_HOLD: the last held frame, then the 6 exit frames + the first settled one (new = bordered + fly-out, old = plain hard cut)
  const flyFrames = [CARD_HOLD - 2, CARD_HOLD - 1, CARD_HOLD, CARD_HOLD + 1, CARD_HOLD + 2, CARD_HOLD + 3, CARD_HOLD + 4, CARD_HOLD + 5, CARD_HOLD + 6];
  const newRow = [];
  const oldRow = [];
  for (const frame of flyFrames) {
    newRow.push(await still('WP35Cards', frame, `fly-new-${frame}`, 180));
    oldRow.push(await still('WP35CardsPlain', frame, `fly-old-${frame}`, 180));
  }
  sheet([newRow, oldRow], flyoutSheet, 'fly-out strip');
  console.log('fly-out strip', flyoutSheet);

  // the video: the 20.6 s impact montage + the 5.3 s framed-card run
  const started = Date.now();
  const parts = [];
  for (const id of ['WP35Impact', 'WP35Cards']) {
    const composition = await selectComposition({serveUrl, id, puppeteerInstance: browser});
    const full = path.join(os.tmpdir(), `wp35-${id}.mp4`);
    await renderMedia({composition, serveUrl, codec: 'h264', outputLocation: full, puppeteerInstance: browser, scale: 1, muted: true, onProgress: p => { if (p.renderedFrames % 100 === 0) console.log(id, 'frames', p.renderedFrames); }});
    const small = path.join(os.tmpdir(), `wp35-${id}-small.mp4`);
    run(['-i', full, '-vf', 'scale=540:-2,fps=30', '-c:v', 'libx264', '-crf', '23', '-pix_fmt', 'yuv420p', '-an', small], `shrink ${id}`);
    parts.push(small);
  }
  run(['-i', parts[0], '-i', parts[1], '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', '-crf', '23', '-pix_fmt', 'yuv420p', mp4], 'concat');
  console.log('wrote', mp4, `${((Date.now() - started) / 1000).toFixed(1)}s`);

  const out = {
    durationSec: plan.durationSec,
    fx: plan.fx,
    fxStats: plan.fxStats,
    rows: rowsMeta,
    frames: measured,
    cardRun: {holdFrames: CARD_HOLD, exitFrames: 6, borderPx: 5, exitStartFrame: CARD_HOLD, stripFrames: flyFrames},
    note: 'yavg = mean luma, satavg = mean saturation (signalstats on the 108 px render of the frame). Flash frames read far brighter than the frame before; the sat pop raises satavg; B&W frames drop satavg to ~0.',
  };
  fs.writeFileSync(measuredFile, JSON.stringify(out, null, 1));
  console.log('measured', measuredFile);
} finally {
  await browser.close({silent: true});
}
