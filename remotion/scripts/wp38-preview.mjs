/**
 * WP38: offline proof of Skill A TOOLS ON CLASSIC TALKING-HEAD POLISH. One ~39 s MP4: the speaker stand-in is the primary picture; accumulate captions at the face-safe y (~58 %), a few editorial still runs
 * in the gaps (tighter caps: <= 25 % of the runtime), a chapter card, and the WP35 impact FX (flash / sat pop / punch-in / B&W). NOT faceless (the face is on screen most of the time), NOT the explainer.
 * The plan comes from the REAL pure planners the polish path calls (voCutGrammar, polishAccumulateCaptions, talkingHeadSkillA, polishImpactFx, editorialStillMontage with the talking-head caps) on the fixture VO
 * (server/src/stages/broll/fixtures/wp38-vo-words.json); the stock lookup is a fixed fake that maps a query onto the checked-in public/wp30-fixtures stills (no network, no model, no audio, no SFX).
 * Usage (from remotion/): npm run preview:wp38      (WP38_REUSE_MP4=1 re-measures / re-cuts the evidence without re-rendering the video)
 * Output (out/phase36-readiness/): wp38-talking-head-skill-a.mp4, wp38-contact-sheet.jpg, wp38-caption-y.jpg (face-safe vs pre-WP38 y), wp38-plan.json, wp38-measured.json.
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
const FULL_W = 1080;
const FULL_H = 1920;
const SMALL_W = 540;
const outDir = path.join(root, 'out/phase36-readiness');
fs.mkdirSync(outDir, {recursive: true});
const mp4 = path.join(outDir, 'wp38-talking-head-skill-a.mp4');
const contactSheet = path.join(outDir, 'wp38-contact-sheet.jpg');
const captionSheet = path.join(outDir, 'wp38-caption-y.jpg');
const planFile = path.join(outDir, 'wp38-plan.json');
const measuredFile = path.join(outDir, 'wp38-measured.json');
const planTmp = path.join(os.tmpdir(), 'wp38-plan-raw.json');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp38-'));
// the stand-in speaker's head (scripts/wp23/shared.tsx Footage): left 340, top 520, 400 x 520 px in the 1080 x 1920 frame
const FACE = {x1: 340, x2: 740, y1: 520, y2: 1040};

if (!fs.existsSync(path.join(root, 'public/wp30-fixtures/a1-startup-office.jpg'))) throw new Error('missing public/wp30-fixtures: run node scripts/wp30/fetch-fixtures.mjs');

function run(args, label) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args]);
  if (r.status !== 0) throw new Error(`ffmpeg ${label} failed: ${r.stderr}`);
}

// 1) the plan comes from the REAL planners
const script = `
import {readFileSync, writeFileSync} from 'node:fs';
const server = ${JSON.stringify(path.resolve(root, '../server/src'))};
const {ctaWindowsOf, moneyWindowsOf, planVoCutGrammar} = await import(server + '/stages/broll/voCutGrammar.ts');
const {polishAccumulateCaptions} = await import(server + '/lib/polishAccumulateCaptions.ts');
const {planImpactFx} = await import(server + '/lib/polishImpactFx.ts');
const {planEditorialStillMontage} = await import(server + '/stages/broll/editorialStillMontage.ts');
const th = await import(server + '/stages/broll/talkingHeadSkillA.ts');
const fixture = JSON.parse(readFileSync(server + '/stages/broll/fixtures/wp38-vo-words.json', 'utf8'));
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
const faceSafe = th.talkingHeadCaption(accumulate.caption);
const impact = planImpactFx({words: fixture.words, plan, durationSec: fixture.durationSec});
// the stock library stand-in: a query -> one of the eight checked-in stills (nouns first, then rotation), unique per still
const LITERAL = {
  'a2-counting-cash': ['billion', 'dollars', 'cash', 'money', 'million', 'bills'],
  'a1-startup-office': ['startup', 'office', 'founder', 'company', 'studio'],
  'a3-newspaper': ['headlines', 'newspaper', 'press', 'genius'],
  'a4-city-crowd': ['crowd', 'people', 'everyone', 'investors'],
  'b1-laptop-desk': ['numbers', 'laptop', 'spreadsheet', 'desk', 'perfect'],
  'b2-empty-desk': ['collapsed', 'empty', 'fired', 'email'],
  'b3-subway': ['subway', 'morning', 'cold', 'years'],
  'c1-press': ['press', 'media', 'follow'],
};
const names = Object.keys(LITERAL);
const asked = [];
const resolver = async (query, options) => {
  asked.push(query);
  const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const free = names.filter(name => !options.excludeKeys.has('pexels:' + names.indexOf(name)));
  const pick = free.find(name => LITERAL[name].some(noun => tokens.includes(noun))) ?? free[asked.length % Math.max(1, free.length)];
  if (!pick) return null;
  return {assetUrl: 'https://stock.example.com/' + pick + '.jpg', provider: 'pexels', providerId: names.indexOf(pick)};
};
const cardRanges = plan.chapterCards.map(card => ({start: card.at, end: Math.round((card.at + card.duration) * 1000) / 1000}));
const coveredSec = cardRanges.reduce((sum, range) => sum + (range.end - range.start), 0);
const options = th.talkingHeadStillOptions(fixture.durationSec, coveredSec);
const stills = await planEditorialStillMontage({words: fixture.words, outputDurationSec: fixture.durationSec, blockedRanges: cardRanges, resolver, ...options});
const legacyStills = await planEditorialStillMontage({words: fixture.words, outputDurationSec: fixture.durationSec, blockedRanges: cardRanges, resolver});
const stillSec = stills.runs.reduce((sum, run) => sum + (run.end - run.start), 0);
const legacyStillSec = legacyStills.runs.reduce((sum, run) => sum + (run.end - run.start), 0);
const summary = {
  cutPlanned: true, cuts: plan.cuts.length, chapterCards: plan.chapterCards.length, accumulate: faceSafe.caption.mode === 'word_by_word_accumulate',
  fx: {flashes: impact.fx.flashes.length, satPops: impact.fx.satPops.length, punchIns: impact.fx.punchIns.length, bwSpans: impact.fx.bwSpans.length},
  stills: stills.stills, stillSec, durationSec: fixture.durationSec,
};
writeFileSync(${JSON.stringify(planTmp)}, JSON.stringify({
  durationSec: fixture.durationSec, flags, ...plan, words, direction: faceSafe.caption, legacyDirection: accumulate.caption, captionWarnings: [...accumulate.warnings, ...faceSafe.warnings],
  fx: impact.fx, fxWarnings: impact.warnings, fxStats: impact.stats,
  stills: {options, runs: stills.runs, items: stills.items, stills: stills.stills, lookups: stills.lookups, misses: stills.misses, warnings: stills.warnings, stillSec},
  legacyStills: {runs: legacyStills.runs.length, stills: legacyStills.stills, stillSec: legacyStillSec},
  summary, warnings: th.talkingHeadSkillAWarnings(summary),
}));
`;
const gen = spawnSync('node', ['--experimental-strip-types', '--input-type=module', '-e', script], {encoding: 'utf8', maxBuffer: 1 << 26, cwd: root});
if (gen.status !== 0) throw new Error(`could not plan the talking-head skill A edit: ${gen.stderr}`);
const plan = JSON.parse(fs.readFileSync(planTmp, 'utf8'));
fs.writeFileSync(planFile, JSON.stringify(plan, null, 1));
console.log(`plan: ${plan.stats.shotCount} shots; ${plan.stills.stills} stills in ${plan.stills.runs.length} runs (${plan.stills.stillSec.toFixed(1)}s of ${plan.durationSec}s; pre-WP38 caps would be ${plan.legacyStills.stills} stills / ${plan.legacyStills.stillSec.toFixed(1)}s); ${plan.warnings.join(' ')}`);

const frameOfSec = sec => Math.round(sec * FPS);
const runs = plan.stills.runs;
const cards = plan.chapterCards.map(card => ({start: card.at, end: card.at + card.duration}));
const fx = plan.fx;
const inRanges = (sec, ranges, pad = 0) => ranges.some(range => sec >= range.start - pad && sec < range.end + pad);
const stillRanges = runs.map(item => ({start: item.start, end: item.end}));
const fxBusy = sec =>
  fx.flashes.some(flash => sec >= flash.startSec - 0.1 && sec < flash.startSec + 0.4) ||
  fx.satPops.some(pop => sec >= pop.startSec - 0.1 && sec < pop.startSec + 0.4) ||
  fx.punchIns.some(punch => sec >= punch.startSec && sec < punch.endSec) ||
  fx.bwSpans.some(span => sec >= span.startSec && sec < span.endSec);

// caption samples ON THE FACE: a caption group (accumulate line) that is fully on the face (no still, no card, no fx), >= 0.45 s on screen, spread over the runtime
const facePicks = plan.groups
  .map(group => ({sec: group.start + 0.4, group}))
  .filter(item => item.sec < plan.durationSec - 0.3 && !inRanges(item.sec, stillRanges, 0.2) && !inRanges(item.sec, cards, 0.2) && !fxBusy(item.sec))
  .filter((item, index, all) => index % Math.max(1, Math.floor(all.length / 5)) === 0)
  .slice(0, 5);
if (facePicks.length < 3) throw new Error('not enough clean face caption samples');

const serveUrl = await bundle({entryPoint: path.join(here, 'wp38/entry.tsx'), outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'wp38-bundle-')), publicDir: path.join(root, 'public')});
const reuse = process.env.WP38_REUSE_MP4 === '1' && fs.existsSync(mp4);
const browser = await openBrowser('chrome');
const sampleStills = [];
try {
  if (!reuse) {
    const started = Date.now();
    const props = {captions: true, faceSafe: true, fx: true, tags: false};
    const composition = await selectComposition({serveUrl, id: 'WP38Th', puppeteerInstance: browser, inputProps: props});
    const full = path.join(tmpDir, 'wp38-full.mp4');
    await renderMedia({composition, serveUrl, codec: 'h264', outputLocation: full, puppeteerInstance: browser, scale: 0.5, muted: true, inputProps: props, onProgress: p => { if (p.renderedFrames % 200 === 0) console.log('frames', p.renderedFrames); }});
    run(['-i', full, '-vf', `scale=${SMALL_W}:-2,fps=30`, '-c:v', 'libx264', '-crf', '23', '-pix_fmt', 'yuv420p', '-an', mp4], 'shrink');
    console.log('wrote', mp4, `${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
  // caption bbox by DIFF at full res (fx off so a flash never covers the line): the same frame with and without captions, face-safe (WP38) and the pre-WP38 y 46 %
  const variant = async (id, props) => selectComposition({serveUrl, id, puppeteerInstance: browser, inputProps: props});
  const off = await variant('WP38Th', {captions: false, faceSafe: true, fx: false});
  const onSafe = await variant('WP38Th', {captions: true, faceSafe: true, fx: false});
  const onLegacy = await variant('WP38Th', {captions: true, faceSafe: false, fx: false});
  for (const [index, pick] of facePicks.entries()) {
    const frame = frameOfSec(pick.sec);
    const files = {off: path.join(tmpDir, `off-${index}.png`), safe: path.join(tmpDir, `safe-${index}.png`), legacy: path.join(tmpDir, `legacy-${index}.png`)};
    await renderStill({composition: off, serveUrl, output: files.off, frame, puppeteerInstance: browser, inputProps: {captions: false, faceSafe: true, fx: false}});
    await renderStill({composition: onSafe, serveUrl, output: files.safe, frame, puppeteerInstance: browser, inputProps: {captions: true, faceSafe: true, fx: false}});
    await renderStill({composition: onLegacy, serveUrl, output: files.legacy, frame, puppeteerInstance: browser, inputProps: {captions: true, faceSafe: false, fx: false}});
    sampleStills.push({index, pick, ...files});
  }
} finally {
  await browser.close({silent: true});
}

// 2) measure
const bboxOf = (onFile, offFile) => {
  const r = spawnSync('ffmpeg', ['-v', 'info', '-i', onFile, '-i', offFile, '-filter_complex', '[0:v][1:v]blend=all_mode=difference,format=gray,bbox=min_val=70', '-f', 'null', '-'], {encoding: 'utf8'});
  const hits = [...r.stderr.matchAll(/x1:(\d+)\s+x2:(\d+)\s+y1:(\d+)\s+y2:(\d+)/g)];
  return hits.length ? hits[hits.length - 1].slice(1, 5).map(Number) : null; // [x1, x2, y1, y2]
};
const overlapWithFace = box => {
  if (!box) return null;
  const w = Math.max(0, Math.min(box[1], FACE.x2) - Math.max(box[0], FACE.x1));
  const h = Math.max(0, Math.min(box[3], FACE.y2) - Math.max(box[2], FACE.y1));
  return Math.round((w * h) / Math.max(1, (box[1] - box[0] + 1) * (box[3] - box[2] + 1)) * 1000) / 1000;
};
const captionRows = sampleStills.map(item => {
  const safe = bboxOf(item.safe, item.off);
  const legacy = bboxOf(item.legacy, item.off);
  const row = box => (box ? {bbox: box, centerYFrac: Math.round(((box[2] + box[3]) / 2 / FULL_H) * 1000) / 1000, centerXFrac: Math.round(((box[0] + box[1]) / 2 / FULL_W) * 1000) / 1000, topPx: box[2], bottomPx: box[3], faceOverlap: overlapWithFace(box)} : null);
  return {atSec: Math.round(item.pick.sec * 100) / 100, words: item.pick.group.words.join(' '), faceSafe: row(safe), preWp38: row(legacy)};
});

const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate:format=duration', '-of', 'json', mp4], {encoding: 'utf8'});
const info = JSON.parse(probe.stdout);
const duration = Number(info.format.duration);

const frameStats = sec => {
  const out = spawnSync('ffmpeg', ['-v', 'info', '-ss', String(Math.min(duration - 0.05, Math.max(0, sec))), '-i', mp4, '-frames:v', '1', '-vf', 'scale=108:-1,format=rgb24,signalstats,metadata=print:file=-', '-f', 'null', '-'], {encoding: 'utf8', maxBuffer: 1 << 26});
  const text = `${out.stdout}\n${out.stderr}`;
  const pick = key => Number((text.match(new RegExp(`lavfi\\.signalstats\\.${key}=([\\d.]+)`)) ?? [])[1]);
  return {yavg: Math.round(pick('YAVG') * 10) / 10, satavg: Math.round(pick('SATAVG') * 10) / 10};
};
const faceCenterPixel = sec => {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(Math.min(duration - 0.05, Math.max(0, sec))), '-i', mp4, '-frames:v', '1', '-vf', `crop=8:8:${(FACE.x1 + FACE.x2) / 4 - 4}:${(FACE.y1 + FACE.y2) / 4 - 4}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {maxBuffer: 1 << 20});
  const b = r.stdout;
  let rr = 0;
  let gg = 0;
  let bb = 0;
  const n = b.length / 3;
  for (let i = 0; i < b.length; i += 3) { rr += b[i]; gg += b[i + 1]; bb += b[i + 2]; }
  return [rr / n, gg / n, bb / n];
};
// face presence on the FILE: every 0.5 s, the stand-in's head colour (warm: r - b >= 30) at the head centre, ignoring B&W spans / flashes / punch-ins (the grade changes the colour there)
const faceSamples = [];
for (let sec = 0.25; sec < plan.durationSec - 0.2; sec += 0.5) {
  if (fx.bwSpans.some(span => sec >= span.startSec - 0.05 && sec < span.endSec + 0.05) || fx.flashes.some(flash => Math.abs(sec - flash.startSec) < 0.3) || fx.satPops.some(pop => Math.abs(sec - pop.startSec) < 0.3)) continue;
  const [r, , b] = faceCenterPixel(sec);
  faceSamples.push({sec, warm: r - b >= 30, planned: !inRanges(sec, stillRanges, 0) && !inRanges(sec, cards, 0)});
}
const faceOnFileShare = faceSamples.filter(s => s.warm).length / faceSamples.length;
const facePlannedShare = faceSamples.filter(s => s.planned).length / faceSamples.length;
const agree = faceSamples.filter(s => s.warm === s.planned).length / faceSamples.length;

const coveredSec = plan.stills.stillSec + cards.reduce((sum, range) => sum + (range.end - range.start), 0);
const facePrimaryShare = 1 - coveredSec / plan.durationSec;
const bwFrame = fx.bwSpans[0] ? frameStats((fx.bwSpans[0].startSec + fx.bwSpans[0].endSec) / 2) : null;
const faceFrame = frameStats(facePicks[0].sec);
const flashFrame = fx.flashes[0] ? frameStats(fx.flashes[0].startSec + 0.01) : null;
const flashBefore = fx.flashes[0] ? frameStats(fx.flashes[0].startSec - 0.1) : null;

const ys = captionRows.map(row => row.faceSafe?.centerYFrac);
const legacyYs = captionRows.map(row => row.preWp38?.centerYFrac);
const measured = {
  mp4: path.basename(mp4),
  video: {width: info.streams[0].width, height: info.streams[0].height, fps: info.streams[0].r_frame_rate, durationSec: Math.round(duration * 100) / 100},
  planner: {
    cuts: plan.stats.shotCount, chapterCards: plan.chapterCards.length, accumulateMode: plan.direction.mode, faceSafeYFrac: plan.direction.faceSafeYFrac,
    fx: plan.fxStats, stills: plan.stills.stills, stillRuns: runs.map(item => ({start: item.start, end: item.end, items: item.items.length})), stillSec: Math.round(plan.stills.stillSec * 100) / 100,
    stillCaps: plan.stills.options, preWp38Caps: plan.legacyStills, warnings: plan.warnings,
  },
  faceShare: {
    plannedPrimary: Math.round(facePrimaryShare * 1000) / 1000,
    fileSamples: faceSamples.length,
    fileFaceVisibleShare: Math.round(faceOnFileShare * 1000) / 1000,
    filePlannedFaceShare: Math.round(facePlannedShare * 1000) / 1000,
    filePlanAgreement: Math.round(agree * 1000) / 1000,
  },
  captions: {samples: captionRows, faceSafeYRange: [Math.min(...ys), Math.max(...ys)], preWp38YRange: [Math.min(...legacyYs), Math.max(...legacyYs)]},
  fxFrames: {face: faceFrame, bw: bwFrame, flashBefore, flash: flashFrame, note: 'yavg = mean luma, satavg = mean saturation (signalstats on a 108 px frame). A B&W frame drops satavg to ~0; the flash frame reads brighter than the frame before.'},
  checks: {
    notFaceless: facePrimaryShare >= 0.7, // the planner targets >= 0.72
    notExplainer: !plan.warnings.some(w => w.includes('explainer')) && plan.direction.mode === 'word_by_word_accumulate',
    stillsAFew: plan.stills.stills >= 3 && plan.stills.stills <= 10 && runs.length >= 1,
    stillsCapped: plan.stills.stillSec <= plan.durationSec * 0.25 + 1e-6 && plan.stills.stillSec < plan.legacyStills.stillSec + 1e-6,
    accumulateOn: plan.direction.mode === 'word_by_word_accumulate' && plan.direction.cutTimes.length > 0,
    captionFaceSafeY: captionRows.length >= 3 && captionRows.every(row => row.faceSafe && row.faceSafe.centerYFrac >= 0.54 && row.faceSafe.centerYFrac <= 0.62 && Math.abs(row.faceSafe.centerXFrac - 0.5) <= 0.2), // x: a line is laid out whole from its first frame, so a half-revealed line's ink sits left of centre (WP34 behaviour, unchanged)
    captionClearOfFace: captionRows.every(row => row.faceSafe && row.faceSafe.faceOverlap === 0),
    preWp38CaptionHitsFace: captionRows.some(row => row.preWp38 && row.preWp38.faceOverlap > 0),
    flashPresent: fx.flashes.length >= 1 && Boolean(flashFrame && flashBefore && flashFrame.yavg > flashBefore.yavg + 15),
    bwPresent: fx.bwSpans.length >= 1 && Boolean(bwFrame && bwFrame.satavg < 5 && faceFrame.satavg > bwFrame.satavg + 5),
    chapterCard: plan.chapterCards.length >= 1,
    faceOnFileMatchesPlan: agree >= 0.9,
  },
};
fs.writeFileSync(measuredFile, JSON.stringify(measured, null, 1));
console.log('measured', JSON.stringify({duration: measured.video.durationSec, faceShare: measured.faceShare, captionY: measured.captions.faceSafeYRange, preWp38Y: measured.captions.preWp38YRange, checks: measured.checks}));

// 3) evidence
const cell = (sec, name, width = 270) => {
  const small = path.join(tmpDir, `${name}.png`);
  run(['-ss', String(Math.min(duration - 0.05, Math.max(0, sec))), '-i', mp4, '-frames:v', '1', '-vf', `scale=${width}:-2`, small], name);
  return small;
};
const tile = (cells, file, columns, rows) => {
  const dir = fs.mkdtempSync(path.join(tmpDir, 'strip-'));
  cells.forEach((item, index) => fs.copyFileSync(item, path.join(dir, `c-${String(index).padStart(3, '0')}.png`)));
  run(['-framerate', '1', '-i', path.join(dir, 'c-%03d.png'), '-vf', `tile=${columns}x${rows}:padding=6:color=black`, '-frames:v', '1', file], path.basename(file));
};
const sheet = [];
sheet.push(cell(facePicks[0].sec, 'face-1'));
sheet.push(cell(facePicks[Math.min(2, facePicks.length - 1)].sec, 'face-2'));
for (const item of runs.slice(0, 2)) {
  sheet.push(cell(item.start + (item.end - item.start) * 0.25, `run-${item.start}-a`));
  sheet.push(cell(item.start + (item.end - item.start) * 0.8, `run-${item.start}-b`));
}
if (cards[0]) sheet.push(cell(cards[0].start + 0.5, 'card'));
if (fx.flashes[0]) sheet.push(cell(fx.flashes[0].startSec + 0.01, 'flash'));
if (fx.satPops[0]) sheet.push(cell(fx.satPops[0].startSec + 0.05, 'sat-pop'));
if (fx.punchIns[0]) sheet.push(cell(fx.punchIns[0].startSec + 0.5, 'punch'));
if (fx.bwSpans[0]) sheet.push(cell((fx.bwSpans[0].startSec + fx.bwSpans[0].endSec) / 2, 'bw'));
tile(sheet, contactSheet, Math.min(5, sheet.length), Math.ceil(sheet.length / 5));
// before / after caption y: the same face frame with the pre-WP38 y 46 % (over the face) and the WP38 face-safe y 58 % (below the chin); full frames scaled down
const pair = [];
for (const item of sampleStills.slice(0, 2)) {
  for (const key of ['legacy', 'safe']) {
    const small = path.join(tmpDir, `pair-${item.index}-${key}.png`);
    run(['-i', item[key], '-vf', 'scale=300:-2', small], `pair ${item.index} ${key}`);
    pair.push(small);
  }
}
tile(pair, captionSheet, 4, 1);
console.log('evidence', contactSheet, captionSheet);
