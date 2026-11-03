/**
 * WP34: offline proof of the ACCUMULATE caption mode (no network except the bundled font fetch, no live render, no model).
 * Usage (from remotion/): npm run preview:wp34   (uses the checked-in public/wp30-fixtures stills + the WP33 fixture word timeline)
 * Steps: (1) plan with the REAL server planners (voCutGrammar.ts for the cuts / groups / chapter cards, polishAccumulateCaptions.ts for the caption direction) from server/src/stages/broll/fixtures/wp33-vo-words.json,
 * (2) render the WP33 faceless montage with the PRODUCTION AccumulateCaptions (and, for the comparison strip, the same montage with the old replace captions),
 * (3) cut the evidence: a reveal strip (frame-by-frame blur-fade of a 3-word line + the clear on the cut), a contact sheet (one frame per caption line, mid-build), an old-vs-new strip, then measure.
 * Output (out/phase36-readiness/): wp34-accumulate-captions.mp4, wp34-reveal-strip.jpg, wp34-contact-sheet.jpg, wp34-vs-replace.jpg, wp34-plan.json, wp34-measured.json, wp34-strip/*.png.
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
const outDir = path.join(root, 'out/phase36-readiness');
const stripDir = path.join(outDir, 'wp34-strip');
fs.mkdirSync(stripDir, {recursive: true});
for (const name of fs.readdirSync(stripDir)) fs.rmSync(path.join(stripDir, name));
const mp4 = path.join(outDir, 'wp34-accumulate-captions.mp4');
const revealSheet = path.join(outDir, 'wp34-reveal-strip.jpg');
const contactSheet = path.join(outDir, 'wp34-contact-sheet.jpg');
const compareSheet = path.join(outDir, 'wp34-vs-replace.jpg');
const planFile = path.join(outDir, 'wp34-plan.json');
const measuredFile = path.join(outDir, 'wp34-measured.json');

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
import {groupAccumulateLines} from ${JSON.stringify(path.resolve(root, 'src/lib/accumulateCaptions.ts'))};
const fixture = JSON.parse(readFileSync(${JSON.stringify(path.resolve(root, '../server/src/stages/broll/fixtures/wp33-vo-words.json'))}, 'utf8'));
const flags = {moneyWindows: moneyWindowsOf(fixture.words), ctaWindows: ctaWindowsOf(fixture.words, fixture.durationSec)};
const plan = planVoCutGrammar({words: fixture.words, durationSec: fixture.durationSec, flags});
// caption words as the blueprint carries them (a sentence index that steps after . ! ?)
let sentence = 0;
const words = fixture.words.map(word => {
  const out = {text: word.text, start: word.start, end: word.end, sentenceIndex: sentence};
  if (/[.!?]["')]*$/.test(word.text)) sentence += 1;
  return out;
});
// a polish-bare-like direction going in (bottom karaoke, white ink, no box), the accumulate grammar coming out
const bare = {position: 'bottom', bottomFrac: 0.2, textColor: '#FFFFFF', highlightColor: '#FFFFFF', boxColor: null, template: 'karaoke', animation: 'scale', fontScale: 1.4, maxWords: 2, glow: false, activeStyle: 'fill'};
const accumulate = polishAccumulateCaptions(bare, {plan, words: fixture.words, durationSec: fixture.durationSec});
const lines = groupAccumulateLines(words, {maxWords: accumulate.caption.maxWords, cutTimes: accumulate.caption.cutTimes});
process.stdout.write(JSON.stringify({durationSec: fixture.durationSec, flags, ...plan, words, direction: accumulate.caption, directionWarnings: accumulate.warnings, lines}));
`;
const gen = spawnSync('node', ['--experimental-strip-types', '--input-type=module', '-e', script], {encoding: 'utf8', maxBuffer: 1 << 26});
if (gen.status !== 0) throw new Error(`could not plan the accumulate captions: ${gen.stderr}`);
const plan = JSON.parse(gen.stdout);

// a literal noun -> still (as WP33); otherwise the rotation. Never the same still twice in a row.
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
console.log(`plan: ${plan.stats.shotCount} shots, ${plan.lines.length} accumulate lines (max ${Math.max(...plan.lines.map(line => line.words.length))} words), ${plan.direction.cutTimes.length} cut times; ${plan.directionWarnings.join(' ')}`);

const frameOfSec = sec => Math.round(sec * FPS);
const lineStartFrame = line => frameOfSec(line.start);
const lineClearFrame = line => frameOfSec(line.clearAt);

const serveUrl = await bundle({entryPoint: path.join(here, 'wp34/entry.tsx'), outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'wp34-bundle-')), publicDir: path.join(root, 'public')});
const browser = await openBrowser('chrome');
const stills = {};
async function still(id, frame, tag, width = 270) {
  const key = `${id}-${frame}`;
  if (stills[key]) return stills[key];
  const composition = await selectComposition({serveUrl, id, puppeteerInstance: browser});
  const full = path.join(os.tmpdir(), `wp34-${id}-${frame}.png`);
  await renderStill({composition, serveUrl, frame: Math.min(composition.durationInFrames - 1, Math.max(0, frame)), output: full, puppeteerInstance: browser, imageFormat: 'png', scale: 1});
  const small = path.join(stripDir, `${tag}.png`);
  run(['-i', full, '-vf', `scale=${width}:-1`, small], `strip ${tag}`);
  stills[key] = small;
  return small;
}
function tile(files, columns, out, label) {
  const list = path.join(os.tmpdir(), `wp34-list-${path.basename(out)}.txt`);
  fs.writeFileSync(list, files.map(file => `file '${file}'\nduration 1`).join('\n') + `\nfile '${files[files.length - 1]}'\n`);
  const rows = Math.ceil(files.length / columns);
  run(['-f', 'concat', '-safe', '0', '-i', list, '-vf', `tile=${columns}x${rows}:padding=4:color=black`, '-frames:v', '1', out], label);
}

try {
  const composition = await selectComposition({serveUrl, id: 'WP34Accumulate', puppeteerInstance: browser});

  // 2) the reveal strip: the first 3-word line (not on a chapter card) frame by frame: every word at onset +1 / +2 / +3 / +5 frames (blur 9 / 6 / 3 / sharp), then the last frame before the clear and the clear frame itself
  const cards = plan.chapterCards;
  const onCard = line => cards.some(card => line.start >= card.at - 1e-6 && line.start < card.at + card.duration);
  const target = plan.lines.find(line => line.words.length === 3 && !onCard(line)) ?? plan.lines.find(line => line.words.length >= 2 && !onCard(line));
  const reveal = [];
  const revealFrames = [];
  for (const [index, word] of target.words.entries()) {
    for (const offset of [1, 2, 3, 5]) {
      const frame = frameOfSec(word.start) + offset;
      revealFrames.push({word: index, offset, frame});
      reveal.push(await still('WP34Accumulate', frame, `reveal-w${index}-f${offset}`));
    }
  }
  const clearFrame = lineClearFrame(target);
  reveal.push(await still('WP34Accumulate', clearFrame - 1, 'reveal-before-clear'), await still('WP34Accumulate', clearFrame, 'reveal-at-clear'));
  while (reveal.length % 4 !== 0) reveal.push(reveal[reveal.length - 1]);
  tile(reveal, 4, revealSheet, 'reveal sheet');
  console.log('reveal strip', revealSheet, `line "${target.words.map(word => word.text).join(' ')}" frames ${revealFrames.map(item => item.frame).join(',')} clear ${clearFrame}`);

  // 3) contact sheet: one frame per caption line, taken when the line is fully built (the last word's onset + 6 frames, or just before the clear)
  const contact = [];
  for (const [index, line] of plan.lines.entries()) {
    const last = frameOfSec(line.words[line.words.length - 1].start) + 6;
    const frame = Math.min(last, lineClearFrame(line) - 1);
    contact.push(await still('WP34Accumulate', frame, `line-${String(index).padStart(2, '0')}`, 216));
  }
  tile(contact, 8, contactSheet, 'contact sheet');
  console.log('contact sheet', contactSheet, `${contact.length} lines`);

  // old vs new: the same six moments, top = old replace captions (WP32 bare karaoke, 2 words, 1.4 x), bottom = accumulate
  const picks = plan.lines.filter(line => !onCard(line) && line.words.length >= 2).filter((_, index) => index % 3 === 0).slice(0, 6);
  const top = [];
  const bottom = [];
  for (const [index, line] of picks.entries()) {
    const frame = frameOfSec(line.words[line.words.length - 1].start) + 6;
    top.push(await still('WP34Replace', frame, `old-${index}`, 216));
    bottom.push(await still('WP34Accumulate', frame, `new-${index}`, 216));
  }
  tile([...top, ...bottom], picks.length, compareSheet, 'compare sheet');
  console.log('old vs new', compareSheet);

  // 4) the video
  const started = Date.now();
  const full = path.join(os.tmpdir(), 'wp34-full.mp4');
  await renderMedia({composition, serveUrl, codec: 'h264', outputLocation: full, puppeteerInstance: browser, scale: 1, muted: true, onProgress: p => { if (p.renderedFrames % 100 === 0) console.log('frames', p.renderedFrames); }});
  run(['-i', full, '-vf', 'scale=540:-2', '-c:v', 'libx264', '-crf', '23', '-pix_fmt', 'yuv420p', '-an', mp4], 'shrink');
  console.log('wrote', mp4, `${((Date.now() - started) / 1000).toFixed(1)}s`);

  // 5) measure the plan the file was rendered from (the rendered frames above are the visual evidence)
  const fontPx = Math.round(composition.height * (plan.direction.sizePctFrameH / 100));
  const widest = Math.max(...plan.lines.map(line => line.words.length));
  const measured = {
    durationSec: plan.durationSec,
    composition: {width: composition.width, height: composition.height, fps: composition.fps},
    lines: plan.lines.length,
    maxWordsPerLine: widest,
    meanWordsPerLine: Math.round((plan.lines.reduce((sum, line) => sum + line.words.length, 0) / plan.lines.length) * 100) / 100,
    fontPx,
    fontPctFrameH: Math.round((fontPx / composition.height) * 1000) / 10,
    centerYPct: plan.direction.centerYFrac * 100,
    centerYPx: Math.round(composition.height * plan.direction.centerYFrac),
    revealStrip: {line: target.words.map(word => word.text).join(' '), frames: revealFrames, clearFrame},
    linesClearedOnACut: plan.lines.filter(line => plan.direction.cutTimes.some(cut => Math.abs(cut - line.clearAt) < 0.002)).length,
    linesClearedByHold: plan.lines.filter(line => !plan.direction.cutTimes.some(cut => Math.abs(cut - line.clearAt) < 0.002)).length,
    firstLines: plan.lines.slice(0, 6).map(line => ({text: line.words.map(word => word.text).join(' '), start: line.start, clearAt: line.clearAt})),
  };
  fs.writeFileSync(measuredFile, JSON.stringify(measured, null, 1));
  console.log('measured', JSON.stringify({...measured, firstLines: undefined}));
} finally {
  await browser.close({silent: true});
}
