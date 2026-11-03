/**
 * WP40: offline proof of Explainer Skill B: the pacing planner + the four layouts. One ~24 s MP4 that cycles B (split hook) -> A (talking head) -> C (white + light-gray DOT GRID diagram) -> A -> D (dark cutaway)
 * -> A (cta). Real pure planner (server/src/stages/broll/explainerPacing.ts) on the fixture VO (server/src/stages/broll/fixtures/wp40-vo-words.json); the speaker and the dark cutaway are fixtures / cached stock
 * stills (public/wp36-fixtures). Network: only the bundled Poppins font fetch. No live render, no model, no audio, no SFX. Skill A files (wp36-*) are NOT touched.
 * Usage (from remotion/): npm run preview:wp40      (WP40_REUSE_MP4=1 re-measures / re-cuts the evidence without re-rendering)
 * Output (out/phase36-readiness/): wp40-explainer-layouts.mp4, wp40-contact-sheet.jpg, wp40-layout-c-full.png (the dot grid at full res), wp40-plan.json, wp40-measured.json, wp40-strip/*.png.
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
const stripDir = path.join(outDir, 'wp40-strip');
fs.mkdirSync(stripDir, {recursive: true});
for (const name of fs.readdirSync(stripDir)) fs.rmSync(path.join(stripDir, name));
const mp4 = path.join(outDir, 'wp40-explainer-layouts.mp4');
const contactSheet = path.join(outDir, 'wp40-contact-sheet.jpg');
const layoutCFull = path.join(outDir, 'wp40-layout-c-full.png');
const planFile = path.join(outDir, 'wp40-plan.json');
const measuredFile = path.join(outDir, 'wp40-measured.json');
const planTmp = path.join(os.tmpdir(), 'wp40-plan-raw.json');

function run(args, label) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args]);
  if (r.status !== 0) throw new Error(`ffmpeg ${label} failed: ${r.stderr}`);
}

// 1) the plan comes from the REAL pure planner
const script = `
import {readFileSync, writeFileSync} from 'node:fs';
const {planExplainerPacing} = await import(${JSON.stringify(path.resolve(root, '../server/src/stages/broll/explainerPacing.ts'))});
const fixture = JSON.parse(readFileSync(${JSON.stringify(path.resolve(root, '../server/src/stages/broll/fixtures/wp40-vo-words.json'))}, 'utf8'));
const pacing = planExplainerPacing({durationSec: fixture.durationSec, words: fixture.words});
// stub caption per segment: the first 1-3 spoken words (lowercase); WP41 replaces this with chunk-swap
const captions = pacing.segments.map(segment => {
  const spoken = fixture.words.filter(word => word.start >= segment.start - 0.05 && word.start < segment.end).slice(0, 3).map(word => word.text.toLowerCase().replace(/[.,!?]+$/, ''));
  return {text: spoken.join(' ')};
});
writeFileSync(${JSON.stringify(planTmp)}, JSON.stringify({durationSec: fixture.durationSec, pacing, captions}));
`;
const gen = spawnSync('node', ['--experimental-strip-types', '--input-type=module', '-e', script], {encoding: 'utf8', maxBuffer: 1 << 26, cwd: root});
if (gen.status !== 0) throw new Error(`could not plan the explainer pacing: ${gen.stderr}`);
const plan = JSON.parse(fs.readFileSync(planTmp, 'utf8'));
const fixturesDir = path.join(root, 'public/wp36-fixtures');
plan.files = {broll: 'pexels-10004971.jpg', cutaway: 'pixabay-10363743.jpg'}; // cached stock stills: a newspaper headline (B top) and a dark-graded audience (D)
for (const file of Object.values(plan.files)) if (!fs.existsSync(path.join(fixturesDir, file))) throw new Error(`missing cached still ${file} (run npm run preview:wp36 once)`);
fs.writeFileSync(planFile, JSON.stringify(plan, null, 1));
const segs = plan.pacing.segments;
console.log(`plan: ${segs.length} segments in ${plan.durationSec}s: ${segs.map(s => `${s.layout.slice(-1).toUpperCase()}[${s.start.toFixed(1)}-${s.end.toFixed(1)}]`).join(' ')}; ${plan.pacing.warnings.join(' ')}`);

const frameOfSec = sec => Math.round(sec * FPS);
const serveUrl = await bundle({entryPoint: path.join(here, 'wp40/entry.tsx'), outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'wp40-bundle-')), publicDir: path.join(root, 'public')});
const reuse = process.env.WP40_REUSE_MP4 === '1' && fs.existsSync(mp4);
const browser = await openBrowser('chrome');
try {
  const composition = await selectComposition({serveUrl, id: 'WP40Explainer', puppeteerInstance: browser});
  if (!reuse) {
    const started = Date.now();
    const full = path.join(os.tmpdir(), 'wp40-full.mp4');
    await renderMedia({composition, serveUrl, codec: 'h264', outputLocation: full, puppeteerInstance: browser, scale: 1, muted: true, onProgress: p => { if (p.renderedFrames % 150 === 0) console.log('frames', p.renderedFrames); }});
    run(['-i', full, '-vf', 'scale=540:-2,fps=30', '-c:v', 'libx264', '-crf', '23', '-pix_fmt', 'yuv420p', '-an', mp4], 'shrink');
    console.log('wrote', mp4, `${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
  // the dot grid at full resolution (layout C, mid-segment, after the diagram has drawn on)
  const cSeg = segs.find(s => s.layout === 'explainer_c');
  if (cSeg) await renderStill({composition, serveUrl, output: layoutCFull, frame: Math.min(frameOfSec(cSeg.end) - 1, frameOfSec(cSeg.start) + Math.round((cSeg.end - cSeg.start) * FPS * 0.85)), puppeteerInstance: browser});
} finally {
  await browser.close({silent: true});
}

// 2) measure the MP4
const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate,nb_frames:format=duration', '-of', 'json', mp4], {encoding: 'utf8'});
const info = JSON.parse(probe.stdout);
const duration = Number(info.format.duration);
const stats = (region, sec) => {
  const [w, h, x, y] = region;
  const r = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(sec), '-i', mp4, '-frames:v', '1', '-vf', `crop=${w}:${h}:${x}:${y},signalstats,metadata=print:file=-`, '-f', 'null', '-'], {encoding: 'utf8'});
  const read = key => Number((r.stdout.match(new RegExp(`lavfi\\.signalstats\\.${key}=([0-9.]+)`)) ?? [])[1]);
  return {yMin: read('YMIN'), yAvg: Math.round(read('YAVG') * 10) / 10, yMax: read('YMAX')};
};
const FRAME_W = 540;
const FRAME_H = 960;
const perSegment = segs.map((segment, index) => {
  const mid = Math.min(duration - 0.05, (segment.start + segment.end) / 2);
  const late = Math.min(duration - 0.05, segment.start + (segment.end - segment.start) * 0.85);
  const row = {index, layout: segment.layout, role: segment.role, start: segment.start, end: segment.end, lengthSec: Math.round((segment.end - segment.start) * 1000) / 1000};
  row.whole = stats([FRAME_W, FRAME_H, 0, 0], mid);
  if (segment.layout === 'explainer_b') {
    row.topHalf = stats([FRAME_W, FRAME_H / 2, 0, 0], mid);
    row.bottomHalf = stats([FRAME_W, FRAME_H / 2, 0, FRAME_H / 2], mid);
  }
  if (segment.layout === 'explainer_c') row.gridMargin = stats([66, 270, 0, 350], late); // a content-free left margin (x 0-132, y 700-1240 at 1080): white ground + gray dots only
  return row;
});
const cRow = perSegment.find(row => row.layout === 'explainer_c');
const dRow = perSegment.find(row => row.layout === 'explainer_d');
const aRows = perSegment.filter(row => row.layout === 'explainer_a');
const scene = spawnSync('ffmpeg', ['-v', 'info', '-i', mp4, '-vf', "select='gt(scene,0.08)',showinfo", '-f', 'null', '-'], {encoding: 'utf8'});
const sceneTimes = [...scene.stderr.matchAll(/pts_time:([0-9.]+)/g)].map(match => Number(match[1]));
const cutsOnFile = plan.pacing.cuts.filter(cut => sceneTimes.some(time => Math.abs(time - cut) <= 3 / FPS + 0.02)).length;
const measured = {
  mp4: path.basename(mp4),
  video: {width: info.streams[0].width, height: info.streams[0].height, fps: info.streams[0].r_frame_rate, durationSec: Math.round(duration * 100) / 100},
  segments: perSegment,
  pacing: plan.pacing.stats,
  warnings: plan.pacing.warnings,
  cutsPlanned: plan.pacing.cuts.length,
  cutsVerifiedOnFile: cutsOnFile,
  checks: {
    allFourLayouts: ['explainer_a', 'explainer_b', 'explainer_c', 'explainer_d'].every(id => segs.some(s => s.layout === id)),
    cWhiteGround: Boolean(cRow && cRow.gridMargin.yAvg >= 235 && cRow.gridMargin.yMax >= 250),
    cDotsVisible: Boolean(cRow && cRow.gridMargin.yMin <= 225 && cRow.gridMargin.yMin >= 150),
    dDarkerThanA: Boolean(dRow && aRows.length && dRow.whole.yAvg < Math.min(...aRows.map(row => row.whole.yAvg)) - 10),
    bTopBottomDiffer: Boolean(perSegment.find(row => row.layout === 'explainer_b' && Math.abs(row.topHalf.yAvg - row.bottomHalf.yAvg) > 5)),
  },
};
fs.writeFileSync(measuredFile, JSON.stringify(measured, null, 1));
console.log('measured', JSON.stringify({duration: measured.video.durationSec, cuts: `${cutsOnFile}/${plan.pacing.cuts.length}`, checks: measured.checks}));

// 3) evidence: the middle frame of every segment, 3 x 2
const cells = [];
for (const [index, segment] of segs.entries()) {
  const mid = Math.min(duration - 0.05, (segment.start + segment.end) / 2 + (segment.layout === 'explainer_c' ? 0.5 : 0));
  const small = path.join(stripDir, `seg-${String(index).padStart(2, '0')}.png`);
  run(['-ss', String(mid), '-i', mp4, '-frames:v', '1', '-vf', 'scale=300:-2', small], `seg ${index}`);
  cells.push(small);
}
const list = path.join(os.tmpdir(), 'wp40-list.txt');
fs.writeFileSync(list, cells.map(file => `file '${file}'\nduration 1`).join('\n') + `\nfile '${cells[cells.length - 1]}'\n`);
const columns = Math.min(6, cells.length);
run(['-f', 'concat', '-safe', '0', '-i', list, '-vf', `tile=${columns}x${Math.ceil(cells.length / columns)}:padding=6:color=black`, '-frames:v', '1', contactSheet], 'contact sheet');
console.log('contact sheet', contactSheet, `${cells.length} segments`);
