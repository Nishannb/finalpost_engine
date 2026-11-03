/**
 * WP41: offline proof of Explainer Skill B captions + lime highlight + claim -> visual. One ~26 s MP4 on the WP40 layouts (A / B / C / D, hard cuts): CHUNK-SWAP captions (1-3 words replace each other, thick
 * black stroke, y 50 % on B / 75 % on A, C, D), a FAKE article on a layout-B claim beat with the LIME #BFFF00 L->R wipe on "$1.4 trillion" (the rest of the page dims to 0.28), and layout C logo chips that pop in on
 * the spoken name. The plan comes from the REAL pure planners (server explainerPacing + explainerClaims + polishExplainerCaptions) on the fixture VO (server/src/stages/broll/fixtures/wp41-vo-words.json).
 * Network: only the Google font fetch (Poppins / Inter / Playfair). No live render, no model, no audio, no SFX. Skill A files (wp36-*) and the WP40 proof (wp40-*) are NOT touched.
 * Usage (from remotion/): npm run preview:wp41      (WP41_REUSE_MP4=1 re-measures / re-cuts the evidence without re-rendering the video)
 * Output (out/phase36-readiness/): wp41-explainer-captions.mp4, wp41-contact-sheet.jpg, wp41-chunk-strip.jpg, wp41-lime-wipe-strip.jpg, wp41-lime-wipe-full.png, wp41-caption-full.png, wp41-plan.json, wp41-measured.json.
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
const SMALL_H = 960;
const outDir = path.join(root, 'out/phase36-readiness');
fs.mkdirSync(outDir, {recursive: true});
const mp4 = path.join(outDir, 'wp41-explainer-captions.mp4');
const contactSheet = path.join(outDir, 'wp41-contact-sheet.jpg');
const chunkStrip = path.join(outDir, 'wp41-chunk-strip.jpg');
const wipeStrip = path.join(outDir, 'wp41-lime-wipe-strip.jpg');
const wipeFull = path.join(outDir, 'wp41-lime-wipe-full.png');
const captionFull = path.join(outDir, 'wp41-caption-full.png');
const planFile = path.join(outDir, 'wp41-plan.json');
const measuredFile = path.join(outDir, 'wp41-measured.json');
const planTmp = path.join(os.tmpdir(), 'wp41-plan-raw.json');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp41-'));

function run(args, label) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args]);
  if (r.status !== 0) throw new Error(`ffmpeg ${label} failed: ${r.stderr}`);
}

// 1) the plan comes from the REAL pure planners
const script = `
import {readFileSync, writeFileSync} from 'node:fs';
const server = ${JSON.stringify(path.resolve(root, '../server/src'))};
const {planExplainerPacing} = await import(server + '/stages/broll/explainerPacing.ts');
const {planClaimVisuals} = await import(server + '/stages/broll/explainerClaims.ts');
const {polishExplainerCaptions} = await import(server + '/lib/polishExplainerCaptions.ts');
const {groupChunks} = await import(${JSON.stringify(path.resolve(root, 'src/lib/chunkSwapCaptions.ts'))});
const fixture = JSON.parse(readFileSync(server + '/stages/broll/fixtures/wp41-vo-words.json', 'utf8'));
const pacing = planExplainerPacing({durationSec: fixture.durationSec, words: fixture.words});
const claims = planClaimVisuals({segments: pacing.segments, words: fixture.words});
const polished = polishExplainerCaptions({position: 'center', bottomFrac: 0.2}, {layoutTrack: claims.layoutTrack});
const chunks = groupChunks(fixture.words, {maxWords: polished.caption.maxWords, cutTimes: polished.caption.cutTimes});
const words = fixture.words.map(word => ({...word, sentenceIndex: 0}));
writeFileSync(${JSON.stringify(planTmp)}, JSON.stringify({durationSec: fixture.durationSec, words, pacing, claims, direction: polished.caption, directionWarnings: polished.warnings, chunks}));
`;
const gen = spawnSync('node', ['--experimental-strip-types', '--input-type=module', '-e', script], {encoding: 'utf8', maxBuffer: 1 << 26, cwd: root});
if (gen.status !== 0) throw new Error(`could not plan the explainer captions: ${gen.stderr}`);
const plan = JSON.parse(fs.readFileSync(planTmp, 'utf8'));
const fixturesDir = path.join(root, 'public/wp36-fixtures');
plan.files = {broll: 'pexels-10004971.jpg', cutaway: 'pixabay-10363743.jpg'};
for (const file of Object.values(plan.files)) if (!fs.existsSync(path.join(fixturesDir, file))) throw new Error(`missing cached still ${file} (run npm run preview:wp36 once)`);
fs.writeFileSync(planFile, JSON.stringify(plan, null, 1));
const track = plan.claims.layoutTrack;
const beat = plan.claims.beats[0];
if (!beat) throw new Error('the fixture produced no claim beat');
console.log(`plan: ${track.map(s => `${s.layout.slice(-1).toUpperCase()}[${s.start.toFixed(1)}-${s.end.toFixed(1)}]`).join(' ')}; ${plan.chunks.length} chunks; claims ${plan.claims.stats.claims} (beats ${plan.claims.beats.length}, max delay ${plan.claims.stats.maxDelaySec}s); ${plan.direction.mode}`);

const frameOfSec = sec => Math.round(sec * FPS);
const serveUrl = await bundle({entryPoint: path.join(here, 'wp41/entry.tsx'), outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'wp41-bundle-')), publicDir: path.join(root, 'public')});
const reuse = process.env.WP41_REUSE_MP4 === '1' && fs.existsSync(mp4);
const browser = await openBrowser('chrome');
const wipeStartSec = beat.highlight.start;
const spanLayout = sec => track.find(span => sec >= span.start && sec < span.end);
// one caption sample per layout span: a chunk that starts >= 0.15 s into the span and is still on screen 0.4 s later
const samples = [];
for (const span of track) {
  const chunk = plan.chunks.find(item => item.start >= span.start + 0.15 && item.clearAt <= span.end + 1e-6 && item.clearAt - item.start >= 0.45);
  if (chunk) samples.push({span, chunk, sec: chunk.start + 0.3});
}
const stills = [];
try {
  const composition = await selectComposition({serveUrl, id: 'WP41Explainer', puppeteerInstance: browser, inputProps: {captions: true}});
  if (!reuse) {
    const started = Date.now();
    const full = path.join(tmpDir, 'wp41-full.mp4');
    await renderMedia({composition, serveUrl, codec: 'h264', outputLocation: full, puppeteerInstance: browser, scale: 1, muted: true, inputProps: {captions: true}, onProgress: p => { if (p.renderedFrames % 150 === 0) console.log('frames', p.renderedFrames); }});
    run(['-i', full, '-vf', `scale=${SMALL_W}:-2,fps=30`, '-c:v', 'libx264', '-crf', '23', '-pix_fmt', 'yuv420p', '-an', mp4], 'shrink');
    console.log('wrote', mp4, `${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
  // caption bbox by DIFF: the same frame with and without captions (full res); the differing pixels are the caption
  const compositionOff = await selectComposition({serveUrl, id: 'WP41Explainer', puppeteerInstance: browser, inputProps: {captions: false}});
  for (const [index, sample] of samples.entries()) {
    const frame = frameOfSec(sample.sec);
    const on = path.join(tmpDir, `on-${index}.png`);
    const off = path.join(tmpDir, `off-${index}.png`);
    await renderStill({composition, serveUrl, output: on, frame, puppeteerInstance: browser, inputProps: {captions: true}});
    await renderStill({composition: compositionOff, serveUrl, output: off, frame, puppeteerInstance: browser, inputProps: {captions: false}});
    stills.push({index, on, off});
  }
  // the lime wipe finished (full res) and a caption close-up (first A span sample)
  const wipeDoneFrame = frameOfSec(wipeStartSec) + 20;
  await renderStill({composition, serveUrl, output: wipeFull, frame: wipeDoneFrame, puppeteerInstance: browser, inputProps: {captions: true}});
  const aIndex = samples.findIndex(sample => sample.span.layout === 'explainer_a');
  if (aIndex >= 0) fs.copyFileSync(stills[aIndex].on, captionFull);
} finally {
  await browser.close({silent: true});
}

// 2) measure
const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate:format=duration', '-of', 'json', mp4], {encoding: 'utf8'});
const info = JSON.parse(probe.stdout);
const duration = Number(info.format.duration);

const captionRows = samples.map((sample, index) => {
  const r = spawnSync('ffmpeg', ['-v', 'info', '-i', stills[index].on, '-i', stills[index].off, '-filter_complex', '[0:v][1:v]blend=all_mode=difference,crop=1080:1400:0:200,format=gray,bbox=min_val=70', '-f', 'null', '-'], {encoding: 'utf8'});
  const hits = [...r.stderr.matchAll(/x1:(\d+)\s+x2:(\d+)\s+y1:(\d+)\s+y2:(\d+)/g)];
  const nums = hits.length ? hits[hits.length - 1].slice(1, 5).map(Number) : null; // [x1, x2, y1, y2]
  const expected = plan.direction.yTrack.find(entry => sample.sec >= entry.start && sample.sec < entry.end)?.yFrac ?? null;
  const centerY = nums ? (nums[2] + nums[3]) / 2 / FULL_H + 200 / FULL_H : null;
  const centerX = nums ? (nums[0] + nums[1]) / 2 / FULL_W : null;
  return {
    layout: sample.span.layout,
    atSec: Math.round(sample.sec * 100) / 100,
    chunk: sample.chunk.words.map(word => word.text).join(' '),
    expectedYFrac: expected,
    measuredCenterYFrac: centerY === null ? null : Math.round(centerY * 1000) / 1000,
    measuredCenterXFrac: centerX === null ? null : Math.round(centerX * 1000) / 1000,
    heightPx: nums ? nums[3] - nums[2] + 1 : null,
    ok: Boolean(nums && expected !== null && Math.abs(centerY - expected) <= 0.03 && Math.abs(centerX - 0.5) <= 0.05),
  };
});

const rawFrame = (sec, crop) => {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(sec), '-i', mp4, '-frames:v', '1', '-vf', `crop=${crop.join(':')}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {maxBuffer: 1 << 26});
  return r.stdout;
};
const PLATE = [SMALL_W, SMALL_H / 2, 0, 0]; // layout B top half (the article plate), w:h:x:y
const limeStats = buffer => {
  let count = 0;
  let minX = Infinity;
  let maxX = -1;
  let sum = 0;
  for (let i = 0; i < buffer.length; i += 3) {
    const r = buffer[i];
    const g = buffer[i + 1];
    const b = buffer[i + 2];
    sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (g >= 200 && r >= 140 && r <= 225 && b <= 110 && g - b > 110) {
      count += 1;
      const x = (i / 3) % PLATE[0];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
  }
  return {limePixels: count, minX: count ? minX : null, maxX: count ? maxX : null, meanLuma: Math.round((sum / (buffer.length / 3)) * 10) / 10};
};
const wipeFrames = [-4, 0, 3, 6, 9, 12, 16, 22];
const wipeRows = wipeFrames.map(k => {
  const sec = wipeStartSec + k / FPS;
  return {frameOffset: k, atSec: Math.round(sec * 1000) / 1000, ...limeStats(rawFrame(Math.min(duration - 0.05, sec), PLATE))};
});
// the dim: mean luma of the page BELOW the phrase (no lime there) before vs after the highlight
const dimCrop = [SMALL_W, 100, 0, 360]; // the gray paragraph + page foot (plate y 360-460 at 540 wide)
const meanLuma = buffer => {
  let sum = 0;
  for (let i = 0; i < buffer.length; i += 3) sum += 0.2126 * buffer[i] + 0.7152 * buffer[i + 1] + 0.0722 * buffer[i + 2];
  return sum / (buffer.length / 3);
};
const lumaBefore = meanLuma(rawFrame(wipeStartSec - 4 / FPS, dimCrop));
const lumaAfter = meanLuma(rawFrame(wipeStartSec + 22 / FPS, dimCrop));
const dimRatio = lumaAfter / lumaBefore;

const scene = spawnSync('ffmpeg', ['-v', 'info', '-i', mp4, '-vf', "select='gt(scene,0.05)',showinfo", '-f', 'null', '-'], {encoding: 'utf8'});
const sceneTimes = [...scene.stderr.matchAll(/pts_time:([0-9.]+)/g)].map(match => Number(match[1]));
const layoutCuts = track.slice(1).map(span => span.start);
const cutsOnFile = layoutCuts.filter(cut => sceneTimes.some(time => Math.abs(time - cut) <= 3 / FPS + 0.02)).length;

const chunks = plan.chunks;
const wipeLimeSeries = wipeRows.filter(row => row.frameOffset >= 3);
const monotonicRight = wipeLimeSeries.every((row, index) => index === 0 || (row.maxX ?? -1) >= (wipeLimeSeries[index - 1].maxX ?? -1) - 1);
const leftStable = wipeLimeSeries.filter(row => row.minX !== null).every((row, _, rows) => Math.abs(row.minX - rows[0].minX) <= 10);
const measured = {
  mp4: path.basename(mp4),
  video: {width: info.streams[0].width, height: info.streams[0].height, fps: info.streams[0].r_frame_rate, durationSec: Math.round(duration * 100) / 100},
  layoutTrack: track,
  cutsPlanned: layoutCuts.length,
  cutsVerifiedOnFile: cutsOnFile,
  captions: {
    mode: plan.direction.mode,
    chunkCount: chunks.length,
    wordsPerChunk: {min: Math.min(...chunks.map(chunk => chunk.words.length)), max: Math.max(...chunks.map(chunk => chunk.words.length))},
    firstChunks: chunks.slice(0, 12).map(chunk => ({text: chunk.words.map(word => word.text).join(' '), start: chunk.start, clearAt: chunk.clearAt})),
    maxOverlapSec: Math.round(Math.max(0, ...chunks.slice(1).map((chunk, index) => chunks[index].clearAt - chunk.start)) * 1000) / 1000,
    yBySample: captionRows,
  },
  lime: {
    color: '#BFFF00',
    wipeStartSec,
    phrase: beat.highlight.phrase,
    frames: wipeRows,
    dimLumaBefore: Math.round(lumaBefore * 10) / 10,
    dimLumaAfter: Math.round(lumaAfter * 10) / 10,
    dimRatio: Math.round(dimRatio * 1000) / 1000,
  },
  claimVisual: {stats: plan.claims.stats, coverage: plan.claims.coverage.map(item => ({claim: item.claim.text, kind: item.claim.kind, at: item.claim.start, by: item.by, layout: item.layout, delaySec: item.delaySec})), beats: plan.claims.beats.map(item => ({start: item.start, end: item.end, phrase: item.highlight.phrase}))},
  checks: {
    allFourLayouts: ['explainer_a', 'explainer_b', 'explainer_c', 'explainer_d'].every(id => track.some(span => span.layout === id)),
    chunksOneToThreeWords: chunks.every(chunk => chunk.words.length >= 1 && chunk.words.length <= 3),
    oneChunkAtATime: chunks.every((chunk, index) => index === 0 || chunks[index - 1].clearAt <= chunk.start + 1e-6),
    captionYByLayout: captionRows.length >= 4 && captionRows.every(row => row.ok),
    captionYBothValues: new Set(captionRows.map(row => row.expectedYFrac)).size >= 2,
    limeAppears: wipeRows.filter(row => row.frameOffset >= 6).every(row => row.limePixels > 400),
    limeWipesLeftToRight: wipeRows.find(row => row.frameOffset === 3).limePixels < wipeRows.find(row => row.frameOffset === 16).limePixels && monotonicRight && leftStable,
    restDims: dimRatio >= 0.15 && dimRatio <= 0.42,
    claimToVisualWithinHalfSecond: plan.claims.stats.maxDelaySec <= 0.5 && plan.claims.stats.unmet === 0,
    cutsOnFile: cutsOnFile === layoutCuts.length,
  },
};
fs.writeFileSync(measuredFile, JSON.stringify(measured, null, 1));
console.log('measured', JSON.stringify({duration: measured.video.durationSec, cuts: `${cutsOnFile}/${layoutCuts.length}`, dimRatio: measured.lime.dimRatio, checks: measured.checks}));

// 3) evidence
const stripList = (cells, file, columns, rows) => {
  const dir = fs.mkdtempSync(path.join(tmpDir, 'strip-'));
  cells.forEach((cell, index) => fs.copyFileSync(cell, path.join(dir, `c-${String(index).padStart(3, '0')}.png`)));
  run(['-framerate', '1', '-i', path.join(dir, 'c-%03d.png'), '-vf', `tile=${columns}x${rows}:padding=6:color=black`, '-frames:v', '1', file], path.basename(file));
};
// contact sheet: one frame per layout span (mid)
const spanCells = track.map((span, index) => {
  const small = path.join(tmpDir, `span-${index}.png`);
  const mid = Math.min(duration - 0.05, (span.start + span.end) / 2 + (span.layout === 'explainer_c' ? 0.6 : 0));
  run(['-ss', String(mid), '-i', mp4, '-frames:v', '1', '-vf', 'scale=270:-2', small], `span ${index}`);
  return small;
});
stripList(spanCells, contactSheet, Math.min(5, spanCells.length), Math.ceil(spanCells.length / 5));
// chunk strip: 8 consecutive chunks (3 frames after each swap): one chunk is replaced by the next
const chunkCells = chunks.slice(2, 10).map((chunk, index) => {
  const small = path.join(tmpDir, `chunk-${index}.png`);
  run(['-ss', String(Math.min(duration - 0.05, chunk.start + 4 / FPS)), '-i', mp4, '-frames:v', '1', '-vf', 'scale=270:-2', small], `chunk ${index}`);
  return small;
});
stripList(chunkCells, chunkStrip, 4, 2);
// lime wipe strip: the article plate (top half) at 6 moments around the highlight
const wipeCells = [-4, 2, 5, 8, 12, 22].map((k, index) => {
  const small = path.join(tmpDir, `wipe-${index}.png`);
  run(['-ss', String(wipeStartSec + k / FPS), '-i', mp4, '-frames:v', '1', '-vf', `crop=${SMALL_W}:${SMALL_H / 2}:0:0,scale=360:-2`, small], `wipe ${index}`);
  return small;
});
stripList(wipeCells, wipeStrip, 3, 2);
console.log('evidence', contactSheet, chunkStrip, wipeStrip);
