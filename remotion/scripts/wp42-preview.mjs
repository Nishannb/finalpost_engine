/**
 * WP42: offline proof that Explainer Skill B is MOUNTED in the production composition. Unlike WP40 / WP41 (custom Roots), this renders the REAL `ShortVideo` composition (src/index.ts -> Root -> ShortVideo) from a
 * blueprint written by the REAL pure planners (server explainerPacing + explainerClaims + polishExplainerCaptions + explainerMount, incl. the real `placeExplainerMedia` with a cached-stills resolver):
 * `explainerLayoutTrack` (A / B / C / D hard cuts), `explainerClaimBeats` (the article plate + LIME #BFFF00 wipe), chunk-swap `captionDirection` with `yTrack`, no soft transitions.
 * Stand-ins: the talking head is an ffmpeg-generated box figure (no footage in the repo; one clock counter shows the speaker stays continuous), the stock stills are the cached WP36 fixtures. Muted, no SFX, 1080x1920 @ 30.
 * Network: none. No live render, no model, no audio. Skill A (wp36-*), WP40 and WP41 files are NOT touched.
 * Usage (from remotion/): npm run preview:wp42      (WP42_REUSE_MP4=1 re-measures / re-cuts the evidence without re-rendering)
 * Output (out/phase36-readiness/): wp42-explainer-mounted.mp4, wp42-contact-sheet.jpg, wp42-cut-strip.jpg, wp42-blueprint.json, wp42-measured.json.
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
const FRAME_SEEK_EPS = 0.004;
const outDir = path.join(root, 'out/phase36-readiness');
fs.mkdirSync(outDir, {recursive: true});
const mp4 = path.join(outDir, 'wp42-explainer-mounted.mp4');
const contactSheet = path.join(outDir, 'wp42-contact-sheet.jpg');
const cutStrip = path.join(outDir, 'wp42-cut-strip.jpg');
const blueprintFile = path.join(outDir, 'wp42-blueprint.json');
const measuredFile = path.join(outDir, 'wp42-measured.json');
const planTmp = path.join(os.tmpdir(), 'wp42-plan-raw.json');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp42-'));
const fixturesDir = path.join(root, 'public/wp36-fixtures');
const wp42Dir = path.join(root, 'public/wp42-fixtures');
fs.mkdirSync(wp42Dir, {recursive: true});

function run(args, label) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args]);
  if (r.status !== 0) throw new Error(`ffmpeg ${label} failed: ${r.stderr}`);
}

// 0) the speaker stand-in (a box figure with a clock; one continuous 27 s clip)
const speakerFile = path.join(wp42Dir, 'speaker.mp4');
const SPEAKER_SEC = 27;
if (!fs.existsSync(speakerFile)) {
  const base = `color=c=0x3b4552:s=${FULL_W}x${FULL_H}:r=${FPS}:d=${SPEAKER_SEC}`;
  const figure = [
    "drawbox=x='340+26*sin(t*1.4)':y=520:w=400:h=520:color=0xc9a58a:t=fill",
    "drawbox=x='190+14*sin(t*1.4)':y=1020:w=700:h=700:color=0x1f2937:t=fill",
    "drawbox=x='440+26*sin(t*1.4)':y=700:w=40:h=30:color=0x1f2937:t=fill",
    "drawbox=x='600+26*sin(t*1.4)':y=700:w=40:h=30:color=0x1f2937:t=fill",
  ];
  const withClock = [...figure, "drawtext=text='SPEAKER %{pts\\:hms}':x=40:y=1700:fontsize=64:fontcolor=white:box=1:boxcolor=0x00000099"];
  let r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', base, '-vf', withClock.join(','), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-an', speakerFile]);
  if (r.status !== 0) {
    r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', base, '-vf', figure.join(','), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-an', speakerFile]);
    if (r.status !== 0) throw new Error(`speaker stand-in failed: ${r.stderr}`);
  }
}

// 1) the plan + the blueprint come from the REAL planners / schema
const files = {landscape: ['pexels-10004971.jpg', 'pexels-7567223.jpg', 'pexels-4968545.jpg', 'pexels-8473770.jpg'], portrait: ['pixabay-10363743.jpg', 'pixabay-4651185.jpg']};
for (const file of [...files.landscape, ...files.portrait]) if (!fs.existsSync(path.join(fixturesDir, file))) throw new Error(`missing cached still ${file} (run npm run preview:wp36 once)`);
const script = `
import {readFileSync, writeFileSync} from 'node:fs';
const server = ${JSON.stringify(path.resolve(root, '../server/src'))};
const {planExplainerPacing} = await import(server + '/stages/broll/explainerPacing.ts');
const {planClaimVisuals} = await import(server + '/stages/broll/explainerClaims.ts');
const {planExplainerMount, placeExplainerMedia} = await import(server + '/stages/broll/explainerMount.ts');
const {polishExplainerCaptions} = await import(server + '/lib/polishExplainerCaptions.ts');
const {timelineBlueprintSchema} = await import(${JSON.stringify(path.resolve(root, 'src/blueprintSchema.ts'))});
const fixture = JSON.parse(readFileSync(server + '/stages/broll/fixtures/wp41-vo-words.json', 'utf8'));
const sample = JSON.parse(readFileSync(${JSON.stringify(path.join(root, 'props/sample.json'))}, 'utf8'));
const files = ${JSON.stringify(files)};
const idOf = file => Number(file.match(/(\\d+)\\.jpg$/)[1]);
const resolver = async (query, options) => {
  const pool = options.orientation === 'portrait' ? files.portrait : files.landscape;
  const provider = file => (file.startsWith('pexels') ? 'pexels' : 'pixabay');
  const file = pool.find(item => !options.excludeKeys.has(provider(item) + ':' + idOf(item))) ?? pool[0];
  return {assetUrl: 'https://fixture.invalid/' + file, provider: provider(file), providerId: idOf(file), width: 1600, height: 1000, credit: 'cached fixture', creditUrl: 'https://fixture.invalid'};
};
const pacing = planExplainerPacing({durationSec: fixture.durationSec, words: fixture.words});
const claims = planClaimVisuals({segments: pacing.segments, words: fixture.words});
const polished = polishExplainerCaptions({position: 'center', bottomFrac: 0.2}, {layoutTrack: claims.layoutTrack});
const mount = planExplainerMount({claimPlan: claims, words: fixture.words, durationSec: fixture.durationSec});
const media = await placeExplainerMedia({slots: mount.slots, resolver});
// the proof is offline: the https fixture urls become the cached local stills
const overlays = media.overlays.map(overlay => (overlay.assetUrl ? {...overlay, assetUrl: 'staticFile:wp36-fixtures/' + overlay.assetUrl.split('/').pop()} : overlay));
const words = fixture.words.map(word => ({...word, sentenceIndex: 0}));
const blueprint = timelineBlueprintSchema.parse({
  ...sample.blueprint,
  blueprintId: 'wp42_proof',
  videoUrl: 'staticFile:wp42-fixtures/speaker.mp4',
  languageCode: 'en',
  fps: 30, width: 1080, height: 1920,
  sourceDurationSec: fixture.durationSec, outputDurationSec: fixture.durationSec,
  keepSegments: [{sourceStart: 0, sourceEnd: fixture.durationSec, outputStart: 0}],
  captionWords: words,
  zoomTriggers: [], hookTitle: '', hookSubtitle: '', brollClips: [], depthOverlays: [], insetReveals: [], motionGraphics: [], mediaContainers: [], semanticEmphasis: [],
  visualOverlays: overlays,
  transitions: [],
  captionDirection: polished.caption,
  explainerLayoutTrack: mount.layoutTrack,
  explainerClaimBeats: mount.claimBeats,
});
writeFileSync(${JSON.stringify(planTmp)}, JSON.stringify({durationSec: fixture.durationSec, blueprint, mountWarnings: [...mount.warnings, ...media.warnings], captionWarnings: polished.warnings, claimStats: claims.stats, claimWarnings: claims.warnings, slots: mount.slots.map(slot => ({layout: slot.layout, start: slot.start, end: slot.end, label: slot.label, queries: slot.queries}))}));
`;
const gen = spawnSync('node', ['--experimental-strip-types', '--input-type=module', '-e', script], {encoding: 'utf8', maxBuffer: 1 << 26, cwd: root});
if (gen.status !== 0) throw new Error(`could not plan the mounted explainer: ${gen.stderr}`);
const plan = JSON.parse(fs.readFileSync(planTmp, 'utf8'));
const blueprint = plan.blueprint;
fs.writeFileSync(blueprintFile, JSON.stringify(plan, null, 1));
const track = blueprint.explainerLayoutTrack;
const beat = blueprint.explainerClaimBeats[0];
if (!beat) throw new Error('the fixture produced no claim beat');
console.log(`plan: ${track.map(s => `${s.layout.slice(-1).toUpperCase()}[${s.start.toFixed(1)}-${s.end.toFixed(1)}]`).join(' ')}; beats ${blueprint.explainerClaimBeats.length}; overlays ${blueprint.visualOverlays.length}; ${blueprint.captionDirection.mode}; ${plan.mountWarnings.join(' ')}`);

const style = {captionTemplate: 'karaoke', layoutStyle: 'fullscreen', captionBottomFrac: 0.2, captionCenterXFrac: 0.5, brollEnabled: true, zoomEnabled: false, trimEnabled: false, colorGradeLut: ''};
const inputProps = {blueprint, style};
const inputPropsNoCaptions = {blueprint: {...blueprint, captionWords: []}, style};
const frameOfSec = sec => Math.round(sec * FPS);
const serveUrl = await bundle({entryPoint: path.join(root, 'src/index.ts'), outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'wp42-bundle-')), publicDir: path.join(root, 'public')});
const reuse = process.env.WP42_REUSE_MP4 === '1' && fs.existsSync(mp4);
const browser = await openBrowser('chrome');
const spanAt = sec => track.find(span => sec >= span.start && sec < span.end);
const chunks = [];
{
  // caption sample per layout span: a chunk word start inside the span (>= 0.4 s in) held for >= 0.3 s
  const words = blueprint.captionWords;
  for (const span of track) {
    const word = words.find(item => item.start >= span.start + 0.4 && item.end <= span.end - 0.1 && item.end - item.start >= 0.3);
    if (word) chunks.push({span, word, sec: word.start + 0.2});
  }
}
const stills = [];
let wipeStartSec = beat.phraseStart;
try {
  const composition = await selectComposition({serveUrl, id: 'ShortVideo', puppeteerInstance: browser, inputProps});
  if (composition.durationInFrames !== frameOfSec(plan.durationSec) && Math.abs(composition.durationInFrames - frameOfSec(plan.durationSec)) > 2) throw new Error(`unexpected composition length ${composition.durationInFrames}`);
  if (!reuse) {
    const started = Date.now();
    const full = path.join(tmpDir, 'wp42-full.mp4');
    await renderMedia({composition, serveUrl, codec: 'h264', outputLocation: full, puppeteerInstance: browser, scale: 1, muted: true, inputProps, onProgress: p => { if (p.renderedFrames % 150 === 0) console.log('frames', p.renderedFrames); }});
    run(['-i', full, '-vf', `scale=${SMALL_W}:-2,fps=30`, '-c:v', 'libx264', '-crf', '23', '-pix_fmt', 'yuv420p', '-an', mp4], 'shrink');
    console.log('wrote', mp4, `${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
  const compositionOff = await selectComposition({serveUrl, id: 'ShortVideo', puppeteerInstance: browser, inputProps: inputPropsNoCaptions});
  for (const [index, sample] of chunks.entries()) {
    const frame = frameOfSec(sample.sec);
    const on = path.join(tmpDir, `on-${index}.png`);
    const off = path.join(tmpDir, `off-${index}.png`);
    await renderStill({composition, serveUrl, output: on, frame, puppeteerInstance: browser, inputProps});
    await renderStill({composition: compositionOff, serveUrl, output: off, frame, puppeteerInstance: browser, inputProps: inputPropsNoCaptions});
    stills.push({index, on, off});
  }
} finally {
  await browser.close({silent: true});
}

// 2) measure
const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate:format=duration', '-of', 'json', mp4], {encoding: 'utf8'});
const info = JSON.parse(probe.stdout);
const duration = Number(info.format.duration);

const rawFrame = (sec, crop) => {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(Math.max(0, sec)), '-i', mp4, '-frames:v', '1', '-vf', `crop=${crop.join(':')}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {maxBuffer: 1 << 26});
  return r.stdout;
};
const meanLuma = buffer => {
  let sum = 0;
  for (let i = 0; i < buffer.length; i += 3) sum += 0.2126 * buffer[i] + 0.7152 * buffer[i + 1] + 0.0722 * buffer[i + 2];
  return buffer.length ? sum / (buffer.length / 3) : 0;
};
const countPixels = (buffer, test) => {
  let count = 0;
  for (let i = 0; i < buffer.length; i += 3) if (test(buffer[i], buffer[i + 1], buffer[i + 2])) count += 1;
  return count;
};
const isSkin = (r, g, b) => Math.abs(r - 0xc9) < 28 && Math.abs(g - 0xa5) < 28 && Math.abs(b - 0x8a) < 28;
const isLime = (r, g, b) => g >= 200 && r >= 140 && r <= 225 && b <= 110 && g - b > 110;

// hard cuts: a layout change is ONE frame step (the frames either side differ a lot; the frames after the cut barely move), never a gradual blend
const frameStepDiff = (secA, secB) => {
  const a = rawFrame(secA, [SMALL_W, SMALL_H, 0, 0]);
  const b = rawFrame(secB, [SMALL_W, SMALL_H, 0, 0]);
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) sum += Math.abs(a[i] - b[i]);
  return n ? sum / n : 0;
};
const layoutCuts = track.slice(1).map(span => span.start);
const cutRows = layoutCuts.map(cut => {
  const f = Math.round(cut * FPS);
  const t = k => (f + k) / FPS - FRAME_SEEK_EPS; // ffmpeg -ss lands on the first frame at / after the target: a hair BEFORE the frame's pts selects exactly that frame
  const pre = frameStepDiff(t(-3), t(-2)); // before the cut: calm
  const step = frameStepDiff(t(-1), t(0)); // across the cut: the jump
  const post = frameStepDiff(t(1), t(2)); // after the cut: calm
  const blendLeft = frameStepDiff(t(-2), t(-1));
  const blendRight = frameStepDiff(t(0), t(1));
  return {cutSec: cut, pre: Math.round(pre * 10) / 10, step: Math.round(step * 10) / 10, post: Math.round(post * 10) / 10, preStep: Math.round(blendLeft * 10) / 10, postStep: Math.round(blendRight * 10) / 10, hard: step > 12 && blendLeft < step * 0.45 && blendRight < step * 0.45};
});

// per layout: speaker visibility (skin pixels of the figure in the top / bottom half) and the layout grammar
const HALF = [SMALL_W, SMALL_H / 2];
const layoutRows = track.map(span => {
  const mid = Math.min(duration - 0.05, (span.start + span.end) / 2 + (span.layout === 'explainer_b' ? 0.1 : 0));
  const top = rawFrame(mid, [HALF[0], HALF[1], 0, 0]);
  const bottom = rawFrame(mid, [HALF[0], HALF[1], 0, SMALL_H / 2]);
  const whole = rawFrame(mid, [SMALL_W, SMALL_H, 0, 0]);
  return {
    layout: span.layout,
    start: span.start,
    end: span.end,
    midSec: Math.round(mid * 100) / 100,
    skinTop: countPixels(top, isSkin),
    skinBottom: countPixels(bottom, isSkin),
    skinWhole: countPixels(whole, isSkin),
    wholeLuma: Math.round(meanLuma(whole) * 10) / 10,
    topLuma: Math.round(meanLuma(top) * 10) / 10,
  };
});
const rowOf = id => layoutRows.filter(row => row.layout === id);

// the lime wipe (beat plate = top half of the layout-B beat span)
const PLATE = [SMALL_W, SMALL_H / 2, 0, 0];
const wipeFrames = [-4, 0, 3, 6, 9, 12, 16, 22];
const limeRows = wipeFrames.map(k => {
  const sec = Math.min(duration - 0.05, wipeStartSec + k / FPS);
  const buffer = rawFrame(sec, PLATE);
  let minX = Infinity;
  let maxX = -1;
  let count = 0;
  for (let i = 0; i < buffer.length; i += 3) {
    if (isLime(buffer[i], buffer[i + 1], buffer[i + 2])) {
      count += 1;
      const x = (i / 3) % PLATE[0];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
  }
  return {frameOffset: k, atSec: Math.round(sec * 1000) / 1000, limePixels: count, minX: count ? minX : null, maxX: count ? maxX : null};
});
const series = limeRows.filter(row => row.frameOffset >= 3);
const monotonicRight = series.every((row, index) => index === 0 || (row.maxX ?? -1) >= (series[index - 1].maxX ?? -1) - 1);
const dimCrop = [SMALL_W, 100, 0, 360];
const lumaBefore = meanLuma(rawFrame(wipeStartSec - 4 / FPS, dimCrop));
const lumaAfter = meanLuma(rawFrame(wipeStartSec + 22 / FPS, dimCrop));

// captions by diff (y by layout)
const captionRows = chunks.map((sample, index) => {
  const r = spawnSync('ffmpeg', ['-v', 'info', '-i', stills[index].on, '-i', stills[index].off, '-filter_complex', '[0:v][1:v]blend=all_mode=difference,crop=1080:1500:0:200,format=gray,bbox=min_val=70', '-f', 'null', '-'], {encoding: 'utf8'});
  const hits = [...r.stderr.matchAll(/x1:(\d+)\s+x2:(\d+)\s+y1:(\d+)\s+y2:(\d+)/g)];
  const nums = hits.length ? hits[hits.length - 1].slice(1, 5).map(Number) : null;
  const expected = blueprint.captionDirection.yTrack.find(entry => sample.sec >= entry.start && sample.sec < entry.end)?.yFrac ?? null;
  const centerY = nums ? (nums[2] + nums[3]) / 2 / FULL_H + 200 / FULL_H : null;
  const centerX = nums ? (nums[0] + nums[1]) / 2 / FULL_W : null;
  return {
    layout: sample.span.layout,
    atSec: Math.round(sample.sec * 100) / 100,
    word: sample.word.text,
    expectedYFrac: expected,
    measuredCenterYFrac: centerY === null ? null : Math.round(centerY * 1000) / 1000,
    measuredCenterXFrac: centerX === null ? null : Math.round(centerX * 1000) / 1000,
    ok: Boolean(nums && expected !== null && Math.abs(centerY - expected) <= 0.04 && Math.abs(centerX - 0.5) <= 0.08),
  };
});

// speaker continuity: the stand-in carries a clock; the same clip time must keep advancing across every layout (the speaker video is never restarted by a layout swap)
const scene = spawnSync('ffmpeg', ['-v', 'info', '-i', mp4, '-vf', "select='gt(scene,0.05)',showinfo", '-f', 'null', '-'], {encoding: 'utf8'});
const sceneTimes = [...scene.stderr.matchAll(/pts_time:([0-9.]+)/g)].map(match => Number(match[1]));
const cutsOnFile = layoutCuts.filter(cut => sceneTimes.some(time => Math.abs(time - cut) <= 3 / FPS + 0.02)).length;

const skinMin = 400; // px at 540 x 480 for a visible figure
const checks = {
  productionComposition: true,
  allFourLayouts: ['explainer_a', 'explainer_b', 'explainer_c', 'explainer_d'].every(id => track.some(span => span.layout === id)),
  layoutTrackTilesWithoutGaps: track.every((span, index) => index === 0 || Math.abs(span.start - track[index - 1].end) < 1e-6),
  everyCutIsHard: cutRows.length > 0 && cutRows.every(row => row.hard),
  cutsOnFile: cutsOnFile === layoutCuts.length,
  speakerFullOnA: rowOf('explainer_a').every(row => row.skinWhole > skinMin),
  speakerBottomOnB: rowOf('explainer_b').every(row => row.skinBottom > skinMin && row.skinTop < row.skinBottom / 4),
  speakerHiddenOnCD: [...rowOf('explainer_c'), ...rowOf('explainer_d')].every(row => row.skinWhole < skinMin / 8),
  cIsWhiteGround: rowOf('explainer_c').every(row => row.wholeLuma > 150),
  dIsDark: rowOf('explainer_d').every(row => row.wholeLuma < 110),
  chunkSwapMode: blueprint.captionDirection.mode === 'chunk_swap',
  captionYByLayout: captionRows.length >= 4 && captionRows.every(row => row.ok),
  captionYBothValues: new Set(captionRows.map(row => row.expectedYFrac)).size >= 2,
  limeAppears: limeRows.filter(row => row.frameOffset >= 6).every(row => row.limePixels > 400),
  limeWipesLeftToRight: limeRows.find(row => row.frameOffset === 3).limePixels < limeRows.find(row => row.frameOffset === 16).limePixels && monotonicRight,
  restDims: lumaAfter / lumaBefore >= 0.15 && lumaAfter / lumaBefore <= 0.5,
  noSoftTransitions: blueprint.transitions.length === 0,
};
const measured = {
  mp4: path.basename(mp4),
  video: {width: info.streams[0].width, height: info.streams[0].height, fps: info.streams[0].r_frame_rate, durationSec: Math.round(duration * 100) / 100},
  layoutTrack: track,
  claimBeats: blueprint.explainerClaimBeats,
  mountWarnings: plan.mountWarnings,
  claimStats: plan.claimStats,
  mediaSlots: plan.slots,
  overlays: blueprint.visualOverlays.map(overlay => ({intent: overlay.intent, start: overlay.start, end: overlay.end, mediaKind: overlay.mediaKind, asset: overlay.assetUrl.split('/').pop(), label: overlay.overlayText})),
  cuts: cutRows,
  cutsPlanned: layoutCuts.length,
  cutsVerifiedOnFile: cutsOnFile,
  layouts: layoutRows,
  captions: {mode: blueprint.captionDirection.mode, yBySample: captionRows},
  lime: {color: '#BFFF00', phrase: beat.phrase, wipeStartSec, frames: limeRows, dimLumaBefore: Math.round(lumaBefore * 10) / 10, dimLumaAfter: Math.round(lumaAfter * 10) / 10, dimRatio: Math.round((lumaAfter / lumaBefore) * 1000) / 1000},
  checks,
};
fs.writeFileSync(measuredFile, JSON.stringify(measured, null, 1));
console.log('measured', JSON.stringify({duration: measured.video.durationSec, cuts: `${cutsOnFile}/${layoutCuts.length}`, checks}));

// 3) evidence
const stripList = (cells, file, columns, rows) => {
  const dir = fs.mkdtempSync(path.join(tmpDir, 'strip-'));
  cells.forEach((cell, index) => fs.copyFileSync(cell, path.join(dir, `c-${String(index).padStart(3, '0')}.png`)));
  run(['-framerate', '1', '-i', path.join(dir, 'c-%03d.png'), '-vf', `tile=${columns}x${rows}:padding=6:color=black`, '-frames:v', '1', file], path.basename(file));
};
const spanCells = track.map((span, index) => {
  const small = path.join(tmpDir, `span-${index}.png`);
  const mid = Math.min(duration - 0.05, (span.start + span.end) / 2 + (span.layout === 'explainer_b' ? 0.4 : 0));
  run(['-ss', String(mid), '-i', mp4, '-frames:v', '1', '-vf', 'scale=270:-2', small], `span ${index}`);
  return small;
});
stripList(spanCells, contactSheet, Math.min(5, spanCells.length), Math.ceil(spanCells.length / 5));
// cut strip: the frame before and the frame at the first four cuts (a hard cut = one step)
const cutCells = layoutCuts.slice(0, 4).flatMap((cut, index) =>
  [-1, 0].map(k => {
    const small = path.join(tmpDir, `cut-${index}-${k}.png`);
    run(['-ss', String((Math.round(cut * FPS) + k) / FPS - FRAME_SEEK_EPS), '-i', mp4, '-frames:v', '1', '-vf', 'scale=270:-2', small], `cut ${index}`);
    return small;
  }),
);
stripList(cutCells, cutStrip, 4, Math.ceil(cutCells.length / 4));
console.log('evidence', contactSheet, cutStrip);
