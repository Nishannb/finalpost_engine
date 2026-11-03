/**
 * WP55: offline SIMULATED proof for KINETIC_TYPE_STORYTELLING. No Claude, no Director model, no network, no live render.
 *   1. The REAL server pieces run under node (`--experimental-strip-types`): planCraftTemplateBeats (kineticTypeStory selection) -> bindMotionTemplateContent (grounding) -> resolveLibraryGraphic (registry) turn SIMULATED
 *      transcripts into the exact props the production comps render. One scene per template, plus one "full edit" plan that shows sparse selection / budget / one-treatment-per-sentence.
 *   2. Remotion renders the production comps over real footage (the reference clip, ping-pong looped; its person matte is the checked-in fixture public/wp55-fixtures/subject.webm, made once per source video).
 * Usage (from remotion/): npm run preview:wp55     (the fixtures are used as they are; MediaPipe is retired, see the error below for how to regenerate them with RVM)
 * Output (out/phase36-readiness/): wp55-kinetic-type-proof.mp4, wp55-matte-compare.mp4/.png, wp55-contact-sheet.jpg, wp55-strip/*.png, wp55-aspect/*.png, wp55-plan.json, wp55-render-report.json
 */
import {spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
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
const stripDir = path.join(outDir, 'wp55-strip');
const aspectDir = path.join(outDir, 'wp55-aspect');
for (const d of [outDir, stripDir, aspectDir]) fs.mkdirSync(d, {recursive: true});
const file = name => path.join(outDir, name);
const fixtures = path.join(root, 'public/wp55-fixtures');

function run(args, label) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args]);
  if (r.status !== 0) throw new Error(`ffmpeg ${label} failed: ${r.stderr}`);
}

// ---- fixtures: the person matte is produced ONCE per source video (optional python dev tool); never per animation
if (!fs.existsSync(path.join(fixtures, 'subject.webm'))) {
  // The old MediaPipe tool (scripts/wp55/subject_matte.py) is RETIRED. The person matte is Robust Video Matting now.
  throw new Error(
    'public/wp55-fixtures/subject.webm is missing and the MediaPipe tool that made it is retired. Regenerate it with RVM from subjectmatte/ (cwd) using its venv: ' +
      '`.venv-rvm/bin/python -m human_matting.cli <abs>/remotion/public/wp55-fixtures/base.mp4 <abs>/remotion/public/wp55-fixtures/subject.webm <abs>/remotion/public/wp55-fixtures/subject-report.json --quality high`, ' +
      'then write subject-box.json as {"x","y","w","h"} copied from the report\'s `box` (fractions of the frame).',
  );
}
const boxFile = path.join(fixtures, 'subject-box.json');

const server = path.resolve(root, '../server/src');
const script = `
import fs from 'node:fs';
const cat = await import(${JSON.stringify(server + '/stages/broll/motionTemplateCatalog.ts')});
const craft = await import(${JSON.stringify(server + '/stages/broll/planCraftTemplateBeats.ts')});
const bindMod = await import(${JSON.stringify(server + '/stages/broll/motionTemplateBind.ts')});
const reg = await import(${JSON.stringify(server + '/stages/motionDirector/libraryRegistry.ts')});
const caps = await import(${JSON.stringify(server + '/stages/broll/kineticTypeCapabilities.ts')});
const palette = {accent: '#FF8A1F', ink: '#FFFFFF'};
const FX = {matte: 'https://proof.invalid/subject-alpha.webm', post1: 'https://proof.invalid/post1.jpg', post2: 'https://proof.invalid/post2.jpg', logo: 'https://proof.invalid/logo.svg'};
const box = JSON.parse(fs.readFileSync(${JSON.stringify(boxFile)}, 'utf8'));
const subjectBox = {x: box.x, y: box.y, w: box.w, h: box.h};
const speech = parts => parts.flatMap(([text, at]) => text.split(/\\s+/).map((word, i) => ({text: word, start: at + i * 0.3, end: at + i * 0.3 + 0.25})));
const LEAD = 0.5;
const scenarios = [
  ['clip_45_type_environmental_hero', 'And that is attention.', 14, {subjectMatte: {src: FX.matte, box: subjectBox}}],
  ['clip_46_type_impact_number', 'I can show you the result in 10 seconds.', 14, {}],
  ['clip_47_type_staggered_phrase', 'Good editing feels invisible.', 14, {}],
  ['clip_48_type_split_color_headline', 'We sell homes, not houses.', 14, {}],
  ['clip_49_type_kinetic_word_pop', 'Seriously.', 14, {subjectMatte: {src: FX.matte, box: subjectBox}}],
  ['clip_50_type_stacked_statement', 'So the secret is consistent attention every day.', 14, {}],
  ['clip_51_type_floating_social_proof', 'My reels reached 386 thousand views.', 14, {socialImageUrls: [FX.post1, FX.post2]}],
  ['clip_52_type_logo_reveal', 'Welcome to Northwind Realty.', 3, {brandName: 'Northwind Realty', logoSrc: FX.logo}],
  ['clip_53_type_kinetic_cta', 'Just DM me for a free video.', 30, {}],
  ['clip_54_type_illustrated_emphasis', 'This is the best way to grow.', 14, {}],
];
const scenes = [];
for (const [i, [id, text, at, extra]] of scenarios.entries()) {
  const words = speech([[text, at]]);
  const planned = craft.planCraftTemplateBeats({skill: 'explainer', durationSec: 40, words, kineticOnly: [id], ...extra});
  const beat = planned.beats.find(b => b.templateId === id);
  if (!beat) throw new Error('planner did not pick ' + id + ' for: ' + text + ' -> ' + JSON.stringify(planned.warnings));
  const content = bindMod.bindMotionTemplateContent({templateId: id, words, beatStart: beat.start, beatEnd: beat.end, hint: beat.hint, ...palette, ...extra});
  if (!content) throw new Error('binder refused ' + id);
  const hit = reg.resolveLibraryGraphic({goal: 'g', visualDescription: 'v', placement: 'overlay', content: {motionTemplateId: id, ...content}});
  if (!hit || hit.compositionId !== beat.compositionId) throw new Error('registry miss ' + id);
  const assets = hit.assets ?? {};
  const props = {...hit.props};
  if (props.subjectAsset) { props.subjectSrc = assets[props.subjectAsset].src; delete props.subjectAsset; }
  if (props.logoAsset) { props.logoSrc = assets[props.logoAsset].src; delete props.logoAsset; }
  if (props.imageAssets) { props.imageSrcs = props.imageAssets.map(a => assets[a].src); delete props.imageAssets; }
  delete props.personalized;
  const videoOffsetSec = Math.round((0.15 + i * 0.12) * 100) / 100;
  if (props.occlusion === 'matte') props.subjectStartSec = Math.round((videoOffsetSec + LEAD) * 100) / 100; // timeline mapping is simulated: the subject video is the same ping-pong file as the footage
  const reason = (planned.warnings.find(w => w.startsWith('kinetic_type:' + id)) ?? '').replace('kinetic_type:' + id + ':', '');
  scenes.push({templateId: id, compositionId: hit.compositionId, props, beatSec: Math.round((beat.end - beat.start) * 100) / 100, sentence: text, reason, occlusion: props.occlusion, videoOffsetSec, planned: {start: beat.start, end: beat.end, muteCaptions: beat.muteCaptions, hint: beat.hint, warnings: planned.warnings}, mutesCaptions: planned.captionMuteRanges.length > 0});
}
// full edit: one script, every template allowed, no narrowing: shows the Director-side competition (sparse, one idea per sentence, no caption mute)
const edit = speech([
  ['Welcome to Northwind Realty.', 1], ['I can show you the result in 10 seconds.', 6], ['And that is attention.', 12], ['Good editing feels invisible.', 17], ['We sell homes, not houses.', 22],
  ['So the secret is consistent attention every day.', 27], ['Just DM me for a free video.', 34],
]);
const full = craft.planCraftTemplateBeats({skill: 'explainer', durationSec: 40, words: edit, brandName: 'Northwind Realty', logoSrc: FX.logo, subjectMatte: {src: FX.matte, box: subjectBox}});
const fullEdit = {durationSec: 40, sentences: 7, beats: full.beats.map(b => ({id: b.templateId, start: Math.round(b.start * 100) / 100, end: Math.round(b.end * 100) / 100, intent: b.intent, muteCaptions: b.muteCaptions})), captionMuteRanges: full.captionMuteRanges, warnings: full.warnings.filter(w => w.startsWith('kinetic_type') || w.startsWith('craft_templates:beats'))};
const hero = scenes[0];
const compare = {props: {text: hero.props.text, lead: hero.props.lead, accent: palette.accent, ink: palette.ink, subjectBox, subjectSrc: FX.matte}, beatSec: hero.beatSec, offsetSec: 0.9};
const capsExplainer = caps.kineticTypeCapabilitiesFor('explainer', new Set(reg.LIBRARY_COMPOSITION_IDS)).map(c => ({name: c.name, id: c.templateId, matte: c.matte, durationSec: c.durationSec, ownsFrame: c.ownsFrame}));
process.stdout.write(JSON.stringify({palette, scenes, fullEdit, compare, capabilities: capsExplainer, subjectBox}));
`;
const gen = spawnSync('node', ['--experimental-strip-types', '--input-type=module', '-e', script], {encoding: 'utf8', maxBuffer: 1 << 26, cwd: root});
if (gen.status !== 0) throw new Error(`could not resolve the WP55 plan through the real server code: ${gen.stderr}`);
const plan = JSON.parse(gen.stdout.trim().split('\n').pop());
fs.writeFileSync(file('wp55-plan.json'), JSON.stringify(plan, null, 1));
console.log('scenes', plan.scenes.map(s => `${s.templateId}->${s.compositionId}${s.occlusion ? `[${s.occlusion}]` : ''} ${s.beatSec}s`).join('\n       '));
console.log('full edit', JSON.stringify(plan.fullEdit.beats.map(b => `${b.id.replace('clip_', '')}@${b.start}`)));

const serveUrl = await bundle({entryPoint: path.join(here, 'wp55/entry.tsx'), outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'wp55-bundle-')), publicDir: path.join(root, 'public')});
const browser = await openBrowser('chrome');
const report = {checks: {}, files: []};
try {
  const LEAD = 0.5;
  const TAIL = 0.5;
  const grab = async (id, frame, out, inputProps) => {
    const composition = await selectComposition({serveUrl, id, puppeteerInstance: browser, inputProps});
    await renderStill({composition, serveUrl, frame: Math.min(composition.durationInFrames - 1, frame), output: out, puppeteerInstance: browser, imageFormat: 'png', scale: 1, inputProps});
  };
  // strip + contact sheet: mid-beat of each scene
  const strips = [];
  let off = 0;
  for (const [i, s] of plan.scenes.entries()) {
    const frame = Math.round((off + LEAD + Math.min(s.beatSec * 0.62, s.beatSec - 0.3)) * FPS);
    const out = path.join(stripDir, `${String(i + 45)}-${s.templateId.replace('clip_', '').replace(/^\d+_/, '')}.png`);
    await grab('WP55Proof', frame, out);
    strips.push(out);
    off += LEAD + s.beatSec + TAIL;
  }
  const cols = 5;
  const small = strips.map((p, i) => {
    const o = path.join(os.tmpdir(), `wp55-small-${i}.png`);
    run(['-i', p, '-vf', 'scale=360:-1', o], 'small');
    return o;
  });
  run([...small.flatMap(i => ['-i', i]), '-filter_complex', `${small.map((_, k) => `[${k}:v]`).join('')}xstack=inputs=${small.length}:layout=${small.map((_, k) => `${(k % cols) * 360}_${Math.floor(k / cols) * 640}`).join('|')}:fill=black`, '-frames:v', '1', '-q:v', '3', file('wp55-contact-sheet.jpg')], 'sheet');
  report.files.push('wp55-contact-sheet.jpg');

  // matte comparison still (+ video)
  const cmp = await selectComposition({serveUrl, id: 'WP55Compare', puppeteerInstance: browser});
  await renderStill({composition: cmp, serveUrl, frame: Math.round((0.3 + plan.compare.beatSec * 0.6) * FPS), output: file('wp55-matte-compare.png'), puppeteerInstance: browser, imageFormat: 'png', scale: 1});
  report.files.push('wp55-matte-compare.png');

  // aspect ratios: the same hero (fallback layout) / impact / split / cta at 1:1, 4:5 and 16:9, no footage
  const sizes = [['1x1', 1080, 1080], ['4x5', 1080, 1350], ['16x9', 1920, 1080]];
  const pickScene = id => plan.scenes.find(s => s.templateId === id);
  const aspectJobs = [['clip_46_type_impact_number', {}], ['clip_48_type_split_color_headline', {}], ['clip_53_type_kinetic_cta', {}], ['clip_45_type_environmental_hero', {occlusion: 'none', subjectSrc: undefined}]];
  for (const [w, h, tag] of sizes.map(([t, w, h]) => [w, h, t])) {
    for (const [id, over] of aspectJobs) {
      const s = pickScene(id);
      const props = {...s.props, ...over};
      if (props.subjectSrc === undefined) delete props.subjectSrc;
      const out = path.join(aspectDir, `${tag}-${id.replace('clip_', '').replace(/^\d+_type_/, '')}.png`);
      await grab('WP55Single', Math.round(Math.min(s.beatSec * 0.6, s.beatSec - 0.3) * FPS), out, {compositionId: s.compositionId, props, width: w, height: h});
    }
  }
  report.files.push('wp55-aspect/*.png');

  // determinism: the same frame rendered twice is byte-identical
  const sc = plan.scenes[3];
  const frame = Math.round((LEAD + sc.beatSec * 0.5) * FPS);
  const hashes = [];
  for (let i = 0; i < 2; i++) {
    const out = path.join(os.tmpdir(), `wp55-det-${i}.png`);
    await grab('WP55Single', Math.round(sc.beatSec * 0.5 * FPS), out, {compositionId: sc.compositionId, props: sc.props, width: 720, height: 1280});
    hashes.push(crypto.createHash('sha256').update(fs.readFileSync(out)).digest('hex'));
  }
  report.checks.deterministic = hashes[0] === hashes[1];
  if (!report.checks.deterministic) throw new Error('non-deterministic render');

  const video = async (id, name, crf = 20) => {
    const composition = await selectComposition({serveUrl, id, puppeteerInstance: browser});
    const full = path.join(os.tmpdir(), `wp55-${id}.mp4`);
    await renderMedia({composition, serveUrl, codec: 'h264', outputLocation: full, puppeteerInstance: browser, scale: 1, muted: true});
    run(['-i', full, '-c:v', 'libx264', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-an', file(name)], 'shrink');
    report.files.push(name);
    console.log('wrote', name);
  };
  await video('WP55Proof', 'wp55-kinetic-type-proof.mp4');
  await video('WP55Compare', 'wp55-matte-compare.mp4');
} finally {
  await browser.close({silent: true});
}
report.checks.scenes = plan.scenes.length;
report.checks.captionsMuted = plan.scenes.some(s => s.mutesCaptions);
fs.writeFileSync(file('wp55-render-report.json'), JSON.stringify(report, null, 1));
console.log('done', JSON.stringify(report.checks));
