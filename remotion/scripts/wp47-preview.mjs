/**
 * WP47: offline proof of the Layer-2 motion-template toolkit (CLIP_09..12 = analysis Part 2 ACME Clips 5-8). No network, no model, no live render, no audio, no SFX.
 *   1. the REAL server pieces run under node (`--experimental-strip-types`): `resolveLibraryGraphic` turns `{motionTemplateId}` into each composition's props (the library path analyze uses; all four resolve as opaque full_screen and an overlay brief misses), `libraryGraphicSource` is checked
 *      to import the composition, and `planMotionTemplateBeats` plans sparse beats for a sample VO under EACH skill's allowlist (with the caption mute ranges).
 *   2. Remotion renders the PRODUCTION AcmeFruitLetterSwap, MorphFontStretch, MenuSlidePoster and EditorialInsetPoster back to back at their natural lengths over fixture stills.
 * Usage (from remotion/): npm run preview:wp47      (WP47_REUSE_MP4=1 re-cuts the evidence without re-rendering)
 * Output (out/phase36-readiness/): wp47-motion-templates.mp4, wp47-contact-sheet.jpg (row 1 = mid-motion, row 2 = late / payoff, one column per template), wp47-plan.json, wp47-measured.json, wp47-strip/*.png.
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
const stripDir = path.join(outDir, 'wp47-strip');
fs.mkdirSync(stripDir, {recursive: true});
const mp4 = path.join(outDir, 'wp47-motion-templates.mp4');
const sheet = path.join(outDir, 'wp47-contact-sheet.jpg');
const planFile = path.join(outDir, 'wp47-plan.json');
const measuredFile = path.join(outDir, 'wp47-measured.json');

function run(args, label) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args]);
  if (r.status !== 0) throw new Error(`ffmpeg ${label} failed: ${r.stderr}`);
}

// 1) the plan comes from the REAL server library registry + catalog + planner
const server = path.resolve(root, '../server/src');
const script = `
const {resolveLibraryGraphic, libraryGraphicSource} = await import(${JSON.stringify(server + '/stages/motionDirector/libraryRegistry.ts')});
const cat = await import(${JSON.stringify(server + '/stages/broll/motionTemplateCatalog.ts')});
// the four NEW templates only (wp45-preview.mjs proves CLIP_01..04, wp46-preview.mjs CLIP_05..08)
const WP47_IDS = ['clip_09_acme_fruit_swap', 'clip_10_morph_stretch', 'clip_11_menu_slide', 'clip_12_editorial_inset'];
const placementOf = spec => (spec.placement === 'overlay' ? 'overlay' : 'full_screen');
const demos = cat.MOTION_TEMPLATE_CATALOG.filter(spec => WP47_IDS.includes(spec.id)).map(spec => {
  const placement = placementOf(spec);
  const hit = resolveLibraryGraphic({goal: 'g', visualDescription: 'v', placement, content: {motionTemplateId: spec.id, intent: spec.intents[0]}});
  if (!hit || hit.compositionId !== spec.compositionId) throw new Error('registry miss for ' + spec.id);
  // all four are opaque full-bleed only: an overlay brief must miss
  const wrong = resolveLibraryGraphic({goal: 'g', visualDescription: 'v', placement: placement === 'overlay' ? 'full_screen' : 'overlay', content: {motionTemplateId: spec.id}});
  if (wrong !== null) throw new Error('wrong-placement brief should miss for ' + spec.id);
  const source = libraryGraphicSource(hit);
  const importLine = "import {" + spec.compositionId + ", type GraphicProps} from '@finalpost/motion';";
  if (!source.includes(importLine)) throw new Error('unexpected source for ' + spec.id);
  return {templateId: spec.id, compositionId: spec.compositionId, placement, ownsFrame: spec.ownsFrame, primitives: spec.primitives, durationSec: spec.durationSec, props: hit.props, reason: hit.reason, sourceLines: source.split('\\n').length};
});
const phrases = ['the acme wordmark with a fruit letter', 'a morph of the new typeface', 'the sandwich menu at the bakery', 'heritage and elegance in the editorial lookbook'];
const words = phrases.flatMap((phrase, p) => phrase.split(' ').map((text, k) => ({text, start: 2 + p * 9 + k * 0.4, end: 2 + p * 9 + k * 0.4 + 0.35})));
const skills = ['faceless', 'explainer', 'textual_mg', 'newsroom_mg', 'default'];
const samples = Object.fromEntries(skills.map(skill => [skill, cat.planMotionTemplateBeats({skill, durationSec: 40, words})]));
process.stdout.write(JSON.stringify({demos, allowlists: cat.SKILL_MOTION_TEMPLATE_ALLOWLIST, samples}));
`;
const gen = spawnSync('node', ['--experimental-strip-types', '--input-type=module', '-e', script], {encoding: 'utf8', maxBuffer: 1 << 26, cwd: root});
if (gen.status !== 0) throw new Error(`could not resolve the templates through the real registry: ${gen.stderr}`);
const plan = JSON.parse(gen.stdout);
fs.writeFileSync(planFile, JSON.stringify(plan, null, 1));
console.log('templates', plan.demos.map(d => `${d.templateId}->${d.compositionId}`).join(' '));
for (const [skill, sample] of Object.entries(plan.samples)) console.log('plan', skill, sample.beats.map(b => `${b.templateId}[${b.start.toFixed(1)}-${b.end.toFixed(1)}]`).join(' '), sample.warnings.join(' '));

const serveUrl = await bundle({entryPoint: path.join(here, 'wp47/entry.tsx'), outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'wp47-bundle-')), publicDir: path.join(root, 'public')});
const browser = await openBrowser('chrome');
const reuse = process.env.WP47_REUSE_MP4 === '1' && fs.existsSync(mp4);
try {
  const composition = await selectComposition({serveUrl, id: 'WP47MotionTemplates', puppeteerInstance: browser});
  // local seconds inside each template: [mid-motion, late / payoff]
  const marks = {
    clip_09_acme_fruit_swap: [0.2, 2.7],
    clip_10_morph_stretch: [0.85, 2.0],
    clip_11_menu_slide: [1.8, 5.2],
    clip_12_editorial_inset: [1.0, 3.7],
  };
  const frames = [];
  let offset = 0;
  for (const demo of plan.demos) {
    const [mid, late] = marks[demo.templateId];
    frames.push({id: demo.templateId, tag: 'mid', frame: offset + Math.round(mid * FPS)}, {id: demo.templateId, tag: 'late', frame: offset + Math.round(late * FPS)});
    offset += Math.round(demo.durationSec * FPS);
  }
  const small = [];
  for (const item of frames) {
    const full = path.join(os.tmpdir(), `wp47-${item.id}-${item.tag}.png`);
    await renderStill({composition, serveUrl, frame: Math.min(composition.durationInFrames - 1, item.frame), output: full, puppeteerInstance: browser, imageFormat: 'png', scale: 1});
    const out = path.join(stripDir, `${item.id}-${item.tag}.png`);
    run(['-i', full, '-vf', 'scale=270:-1', out], 'strip');
    item.file = out;
    small.push(item);
  }
  const ordered = [...small.filter(i => i.tag === 'mid'), ...small.filter(i => i.tag === 'late')];
  const inputs = ordered.flatMap(i => ['-i', i.file]);
  run([...inputs, '-filter_complex', `${ordered.map((_, k) => `[${k}:v]`).join('')}xstack=inputs=${ordered.length}:layout=${ordered.map((_, k) => `${(k % 4) * 274}_${Math.floor(k / 4) * 484}`).join('|')}:fill=black`, '-frames:v', '1', '-q:v', '3', sheet], 'sheet');
  console.log('contact sheet', sheet);
  if (!reuse) {
    const started = Date.now();
    const full = path.join(os.tmpdir(), 'wp47-full.mp4');
    await renderMedia({composition, serveUrl, codec: 'h264', outputLocation: full, puppeteerInstance: browser, scale: 1, muted: true, onProgress: p => { if (p.renderedFrames % 60 === 0) console.log('frames', p.renderedFrames); }});
    run(['-i', full, '-vf', 'scale=540:-2', '-c:v', 'libx264', '-crf', '23', '-pix_fmt', 'yuv420p', '-an', mp4], 'shrink');
    console.log('wrote', mp4, `${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height,r_frame_rate,duration,nb_frames:format=duration', '-of', 'json', mp4], {encoding: 'utf8'});
  fs.writeFileSync(
    measuredFile,
    JSON.stringify(
      {
        generatedBy: 'remotion/scripts/wp47-preview.mjs',
        live: 'PAUSED',
        sfx: 'none (muted render)',
        templates: plan.demos.map(d => ({templateId: d.templateId, compositionId: d.compositionId, placement: d.placement, ownsFrame: d.ownsFrame, primitives: d.primitives, durationSec: d.durationSec, props: d.props, sourceLines: d.sourceLines, registryReason: d.reason})),
        allowlists: plan.allowlists,
        samplePlans: Object.fromEntries(Object.entries(plan.samples).map(([skill, sample]) => [skill, {beats: sample.beats, captionMuteRanges: sample.captionMuteRanges, warnings: sample.warnings}])),
        video: probe.status === 0 ? JSON.parse(probe.stdout) : null,
        stills: frames.map(i => ({id: i.id, tag: i.tag, frame: i.frame})),
      },
      null,
      1,
    ),
  );
  console.log('measured', measuredFile);
} finally {
  await browser.close({silent: true});
}
