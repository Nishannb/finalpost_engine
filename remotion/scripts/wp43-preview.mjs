/**
 * WP43: offline proof of Skill C (Jitter-class textual motion graphics). No network, no model, no live render, no audio, no SFX.
 *   1. the REAL server pieces run under node (`--experimental-strip-types`): `resolveLibraryGraphic` turns a brief per family into the `TextualMgPlate` props (the library path analyze uses), `libraryGraphicSource`
 *      is checked to import TextualMgPlate, and `planTextualMgPlates` plans a sparse set of plates for a sample VO (hook / stat / pivot / CTA) with their `captionMuteRanges`.
 *   2. Remotion renders the production `TextualMgPlate` cycling snap_elastic, trail_cascade, scramble_glitch, smear_blur, mask_reveal, counter_metric, tagline_plate (2.2 s each) over dark stills / a footage stand-in.
 * Usage (from remotion/): npm run preview:wp43      (WP43_REUSE_MP4=1 re-cuts the evidence without re-rendering)
 * Output (out/phase36-readiness/): wp43-textual-mg.mp4, wp43-contact-sheet.jpg (row 1 = entrance, row 2 = settled, one column per family), wp43-plan.json, wp43-measured.json, wp43-strip/*.png.
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
const SEG_SEC = 2.2;
const outDir = path.join(root, 'out/phase36-readiness');
const stripDir = path.join(outDir, 'wp43-strip');
fs.mkdirSync(stripDir, {recursive: true});
const mp4 = path.join(outDir, 'wp43-textual-mg.mp4');
const sheet = path.join(outDir, 'wp43-contact-sheet.jpg');
const planFile = path.join(outDir, 'wp43-plan.json');
const measuredFile = path.join(outDir, 'wp43-measured.json');

function run(args, label) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args]);
  if (r.status !== 0) throw new Error(`ffmpeg ${label} failed: ${r.stderr}`);
}

// 1) the plan comes from the REAL server library registry + planner
const server = path.resolve(root, '../server/src');
const script = `
const {resolveLibraryGraphic, libraryGraphicSource} = await import(${JSON.stringify(server + '/stages/motionDirector/libraryRegistry.ts')});
const {planTextualMgPlates} = await import(${JSON.stringify(server + '/stages/broll/textualMgPlanner.ts')});
const {TEXTUAL_MG_FAMILIES} = await import(${JSON.stringify(server + '/stages/broll/textualMgCatalog.ts')});
const demoCopy = {
  snap_elastic: {text: 'Stop scrolling', backdrop: 'a1-startup-office'},
  trail_cascade: {text: 'Here is the trick nobody tells you', backdrop: 'a4-city-crowd'},
  scramble_glitch: {text: 'But then it broke', backdrop: 'footage'},
  smear_blur: {text: 'Nobody saw it coming', backdrop: 'b3-subway'},
  mask_reveal: {text: 'Meet the new engine', backdrop: 'c1-press'},
  counter_metric: {text: 'eighty five percent faster', backdrop: 'a2-counting-cash', counter: {from: 0, to: 85, suffix: '%', decimals: 0}},
  tagline_plate: {text: 'Follow for more', backdrop: 'footage'},
};
const demos = TEXTUAL_MG_FAMILIES.map(family => {
  const copy = demoCopy[family];
  const hit = resolveLibraryGraphic({goal: 'g', visualDescription: 'v', placement: 'overlay', content: {textualMgFamily: family, text: copy.text, ...(copy.counter ? {counter: copy.counter} : {})}});
  if (!hit || hit.compositionId !== 'TextualMgPlate') throw new Error('registry miss for ' + family);
  const source = libraryGraphicSource(hit);
  if (!source.includes("import {TextualMgPlate, type GraphicProps} from '@finalpost/motion';")) throw new Error('unexpected source for ' + family);
  return {family, backdrop: copy.backdrop, props: hit.props, reason: hit.reason, sourceLines: source.split('\\n').length};
});
// a sparse plan over a sample VO (what analyze would publish with POLISH_TEXTUAL_MG=1)
const words = 'Six billion people watch short videos every day but almost none of them convert so here is the trick Follow for more'.split(' ').map((text, i) => ({text, start: 0.2 + i * 0.55, end: 0.2 + i * 0.55 + 0.45}));
const sample = planTextualMgPlates({durationSec: 12, words});
process.stdout.write(JSON.stringify({demos, sample}));
`;
const gen = spawnSync('node', ['--experimental-strip-types', '--input-type=module', '-e', script], {encoding: 'utf8', maxBuffer: 1 << 26, cwd: root});
if (gen.status !== 0) throw new Error(`could not resolve the plates through the real registry: ${gen.stderr}`);
const plan = JSON.parse(gen.stdout);
fs.writeFileSync(planFile, JSON.stringify(plan, null, 1));
console.log('families', plan.demos.map(d => `${d.family}:${d.props.recipeId}`).join(' '));
console.log('sample plan', plan.sample.plates.map(p => `${p.family}[${p.start.toFixed(1)}-${p.end.toFixed(1)}]`).join(' '), plan.sample.warnings.join(' '));

const serveUrl = await bundle({entryPoint: path.join(here, 'wp43/entry.tsx'), outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'wp43-bundle-')), publicDir: path.join(root, 'public')});
const browser = await openBrowser('chrome');
const reuse = process.env.WP43_REUSE_MP4 === '1' && fs.existsSync(mp4);
try {
  const composition = await selectComposition({serveUrl, id: 'WP43TextualMg', puppeteerInstance: browser});
  const segFrames = Math.round(SEG_SEC * FPS);
  const frames = [];
  // entrance (0.45 s into the segment: the plate is mid-recipe) and settled (1.2 s: readable hold)
  const marks = [['enter', 0.25], ['settled', 1.2]];
  plan.demos.forEach((demo, index) => {
    for (const [tag, sec] of marks) frames.push({family: demo.family, tag, frame: Math.min(composition.durationInFrames - 1, index * segFrames + Math.round(sec * FPS))});
  });
  const small = [];
  for (const item of frames) {
    const full = path.join(os.tmpdir(), `wp43-${item.family}-${item.tag}.png`);
    await renderStill({composition, serveUrl, frame: item.frame, output: full, puppeteerInstance: browser, imageFormat: 'png', scale: 1});
    const out = path.join(stripDir, `${item.family}-${item.tag}.png`);
    run(['-i', full, '-vf', 'scale=270:-1', out], 'strip');
    item.file = out;
    small.push(item);
  }
  // contact sheet: 7 columns (families), row 1 = entrance, row 2 = settled
  const ordered = [...small.filter(i => i.tag === 'enter'), ...small.filter(i => i.tag === 'settled')];
  const inputs = ordered.flatMap(i => ['-i', i.file]);
  run([...inputs, '-filter_complex', `${ordered.map((_, k) => `[${k}:v]`).join('')}xstack=inputs=${ordered.length}:layout=${ordered.map((_, k) => `${(k % 7) * 274}_${Math.floor(k / 7) * 484}`).join('|')}:fill=black`, '-frames:v', '1', '-q:v', '3', sheet], 'sheet');
  console.log('contact sheet', sheet);
  if (!reuse) {
    const started = Date.now();
    const full = path.join(os.tmpdir(), 'wp43-full.mp4');
    await renderMedia({composition, serveUrl, codec: 'h264', outputLocation: full, puppeteerInstance: browser, scale: 1, muted: true, onProgress: p => { if (p.renderedFrames % 60 === 0) console.log('frames', p.renderedFrames); }});
    run(['-i', full, '-vf', 'scale=540:-2', '-c:v', 'libx264', '-crf', '23', '-pix_fmt', 'yuv420p', '-an', mp4], 'shrink');
    console.log('wrote', mp4, `${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height,r_frame_rate,duration,nb_frames:format=duration', '-of', 'json', mp4], {encoding: 'utf8'});
  fs.writeFileSync(
    measuredFile,
    JSON.stringify(
      {
        generatedBy: 'remotion/scripts/wp43-preview.mjs',
        live: 'PAUSED',
        sfx: 'none (muted render)',
        segSec: SEG_SEC,
        families: plan.demos.map((d, i) => ({family: d.family, recipeId: d.props.recipeId, text: d.props.text, backdrop: d.backdrop, startSec: +(i * SEG_SEC).toFixed(2), sourceLines: d.sourceLines, registryReason: d.reason})),
        samplePlan: {plates: plan.sample.plates.map(p => ({id: p.id, family: p.family, recipeId: p.recipeId, trigger: p.trigger, start: p.start, end: p.end, text: p.text})), captionMuteRanges: plan.sample.captionMuteRanges, warnings: plan.sample.warnings},
        video: probe.status === 0 ? JSON.parse(probe.stdout) : null,
        stills: frames.map(i => ({family: i.family, tag: i.tag, frame: i.frame})),
      },
      null,
      1,
    ),
  );
  console.log('measured', measuredFile);
} finally {
  await browser.close({silent: true});
}
