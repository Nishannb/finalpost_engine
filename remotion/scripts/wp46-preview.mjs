/**
 * WP46: offline proof of the Layer-2 motion-template toolkit (CLIP_05..08). No network, no model, no live render, no audio, no SFX.
 *   1. the REAL server pieces run under node (`--experimental-strip-types`): `resolveLibraryGraphic` turns `{motionTemplateId}` into each composition's props (the library path analyze uses; clip_07 resolves as an OVERLAY, the other three as full_screen, and the placement exceptions are checked both ways), `libraryGraphicSource` is checked
 *      to import the composition, and `planMotionTemplateBeats` plans sparse beats for a sample VO under EACH skill's allowlist (with the caption mute ranges).
 *   2. Remotion renders the PRODUCTION ConfigBrandLoop, BlurWordCarousel, IosNotificationMock and NestedRectTitleWipe back to back at their natural lengths over fixture stills.
 * Usage (from remotion/): npm run preview:wp46      (WP46_REUSE_MP4=1 re-cuts the evidence without re-rendering)
 * Output (out/phase36-readiness/): wp46-motion-templates.mp4, wp46-contact-sheet.jpg (row 1 = mid-motion, row 2 = late / payoff, one column per template), wp46-plan.json, wp46-measured.json, wp46-strip/*.png.
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
const stripDir = path.join(outDir, 'wp46-strip');
fs.mkdirSync(stripDir, {recursive: true});
const mp4 = path.join(outDir, 'wp46-motion-templates.mp4');
const sheet = path.join(outDir, 'wp46-contact-sheet.jpg');
const planFile = path.join(outDir, 'wp46-plan.json');
const measuredFile = path.join(outDir, 'wp46-measured.json');

function run(args, label) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args]);
  if (r.status !== 0) throw new Error(`ffmpeg ${label} failed: ${r.stderr}`);
}

// 1) the plan comes from the REAL server library registry + catalog + planner
const server = path.resolve(root, '../server/src');
const script = `
const {resolveLibraryGraphic, libraryGraphicSource} = await import(${JSON.stringify(server + '/stages/motionDirector/libraryRegistry.ts')});
const cat = await import(${JSON.stringify(server + '/stages/broll/motionTemplateCatalog.ts')});
// the four NEW templates only (wp45-preview.mjs proves CLIP_01..04)
const WP46_IDS = ['clip_05_config_brand_loop', 'clip_06_blur_word_carousel', 'clip_07_ios_notification', 'clip_08_nested_rect_title'];
const placementOf = spec => (spec.placement === 'overlay' ? 'overlay' : 'full_screen');
const demos = cat.MOTION_TEMPLATE_CATALOG.filter(spec => WP46_IDS.includes(spec.id)).map(spec => {
  const placement = placementOf(spec);
  const hit = resolveLibraryGraphic({goal: 'g', visualDescription: 'v', placement, content: {motionTemplateId: spec.id, intent: spec.intents[0]}});
  if (!hit || hit.compositionId !== spec.compositionId) throw new Error('registry miss for ' + spec.id);
  // the placement exception holds both ways: clip_07 is overlay only, the opaque three are full-bleed only
  const wrong = resolveLibraryGraphic({goal: 'g', visualDescription: 'v', placement: placement === 'overlay' ? 'full_screen' : 'overlay', content: {motionTemplateId: spec.id}});
  if (wrong !== null) throw new Error('wrong-placement brief should miss for ' + spec.id);
  const source = libraryGraphicSource(hit);
  // the overlay notification host is imported under a neutral alias (the aesthetic gate reads "IosNotification" as authored OS chrome)
  const importLine = spec.compositionId === 'IosNotificationMock' ? "import {IosNotificationMock as NotifyOverlay, type GraphicProps} from '@finalpost/motion';" : "import {" + spec.compositionId + ", type GraphicProps} from '@finalpost/motion';";
  if (!source.includes(importLine)) throw new Error('unexpected source for ' + spec.id);
  return {templateId: spec.id, compositionId: spec.compositionId, placement, ownsFrame: spec.ownsFrame, primitives: spec.primitives, durationSec: spec.durationSec, props: hit.props, reason: hit.reason, sourceLines: source.split('\\n').length};
});
const words = 'Here is the product launch and the new app sends a message notification to the team the title of the brand guideline version and the key moments of emotion and the config event loop'.split(' ').map((text, i) => ({text, start: 0.3 + i * 1.7, end: 0.3 + i * 1.7 + 0.45}));
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

const serveUrl = await bundle({entryPoint: path.join(here, 'wp46/entry.tsx'), outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'wp46-bundle-')), publicDir: path.join(root, 'public')});
const browser = await openBrowser('chrome');
const reuse = process.env.WP46_REUSE_MP4 === '1' && fs.existsSync(mp4);
try {
  const composition = await selectComposition({serveUrl, id: 'WP46MotionTemplates', puppeteerInstance: browser});
  // local seconds inside each template: [mid-motion, late / payoff]
  const marks = {
    clip_05_config_brand_loop: [1.6, 5.4],
    clip_06_blur_word_carousel: [1.25, 3.4],
    clip_07_ios_notification: [0.4, 1.2],
    clip_08_nested_rect_title: [1.7, 4.5],
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
    const full = path.join(os.tmpdir(), `wp46-${item.id}-${item.tag}.png`);
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
    const full = path.join(os.tmpdir(), 'wp46-full.mp4');
    await renderMedia({composition, serveUrl, codec: 'h264', outputLocation: full, puppeteerInstance: browser, scale: 1, muted: true, onProgress: p => { if (p.renderedFrames % 60 === 0) console.log('frames', p.renderedFrames); }});
    run(['-i', full, '-vf', 'scale=540:-2', '-c:v', 'libx264', '-crf', '23', '-pix_fmt', 'yuv420p', '-an', mp4], 'shrink');
    console.log('wrote', mp4, `${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height,r_frame_rate,duration,nb_frames:format=duration', '-of', 'json', mp4], {encoding: 'utf8'});
  fs.writeFileSync(
    measuredFile,
    JSON.stringify(
      {
        generatedBy: 'remotion/scripts/wp46-preview.mjs',
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
