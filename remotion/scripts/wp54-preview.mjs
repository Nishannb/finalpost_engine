/**
 * WP54: offline proof. No network, no model, no live render, no audio.
 *   1. The REAL server pieces run under node (`--experimental-strip-types`): `planCraftTemplateBeats` + `bindMotionTemplateContent` ground the four kinetic type comps in sample speech + the edit palette;
 *      `runVisualBackendStage` publishes a riso beat whose cached mp4 (the real Brave render from WP53, copied into visual-backend-cache under the planner's cache key) lands in graphic.props.assetUrl, and the native
 *      DoodleDrawOn beat (anidoodle flag, no engine root) publishes too. The mp4 is copied to remotion/public/wp54-fixtures (what prefetch does) and mounted through the REAL GeneratedGraphicTrack.
 *   2. Remotion renders WP54TypeProof (clip_35..38), WP54TemplateProof (doodle / price / device / cursor / logo / ken burns / mesh) and WP54Mounted.
 * Usage (from remotion/): npm run preview:wp54
 * Output (out/phase36-readiness/): wp54-type-proof.mp4, wp54-type-word-reveal.mp4, wp54-templates-proof.mp4, wp54-mounted-backends.mp4, wp54-contact-sheet.jpg, wp54-doodle-still.png, wp54-riso-mounted-still.png, wp54-plan.json, wp54-strip/*.png.
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
const stripDir = path.join(outDir, 'wp54-strip');
fs.mkdirSync(stripDir, {recursive: true});
const file = name => path.join(outDir, name);
const planFile = file('wp54-plan.json');
const rison = file('wp53-riso-number-draft.mp4');

function run(args, label) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args]);
  if (r.status !== 0) throw new Error(`ffmpeg ${label} failed: ${r.stderr}`);
}

const server = path.resolve(root, '../server/src');
const fixtures = path.join(root, 'public/wp54-fixtures');
fs.mkdirSync(fixtures, {recursive: true});
const script = `
import fs from 'node:fs';
import path from 'node:path';
const cat = await import(${JSON.stringify(server + '/stages/broll/motionTemplateCatalog.ts')});
const craft = await import(${JSON.stringify(server + '/stages/broll/planCraftTemplateBeats.ts')});
const bindMod = await import(${JSON.stringify(server + '/stages/broll/motionTemplateBind.ts')});
const reg = await import(${JSON.stringify(server + '/stages/motionDirector/libraryRegistry.ts')});
const vb = await import(${JSON.stringify(server + '/stages/broll/visualBackend/visualBackendStage.ts')});
const riso = await import(${JSON.stringify(server + '/stages/broll/visualBackend/risoAdapter.ts')});
const planner = await import(${JSON.stringify(server + '/stages/broll/visualBackend/planVisualBackendBeats.ts')});
const palette = {accent: '#BFFF00', ground: '#0B0B0B', ink: '#FFFFFF'};
const speech = parts => parts.flatMap(([text, at]) => text.split(/\\s+/).map((word, i) => ({text: word, start: at + i * 0.3, end: at + i * 0.3 + 0.25})));
// four punchlines -> the planner picks word / line / char / weight (each beat alone so all four render in the proof)
const lines = [
  ['Nothing works like this.', 'clip_35_type_word_reveal'],
  ['The real secret, stop guessing.', 'clip_36_type_line_mask'],
  ['Never again.', 'clip_37_type_char_stagger'],
  ['Think bigger.', 'clip_38_type_weight_morph'],
];
const typeDemos = [];
for (const [text, expectId] of lines) {
  const words = speech([[text, 3]]);
  const planned = craft.planCraftTemplateBeats({skill: 'explainer', durationSec: 30, words});
  const beat = planned.beats.find(b => b.templateId === expectId);
  if (!beat) throw new Error('planner did not pick ' + expectId + ' for: ' + text + ' -> ' + JSON.stringify(planned.beats.map(b => b.templateId)));
  const content = bindMotionTemplateContentSafe(beat, words);
  const hit = reg.resolveLibraryGraphic({goal: 'g', visualDescription: 'v', placement: 'full_screen', content: {motionTemplateId: expectId, ...content}});
  if (!hit || hit.compositionId !== beat.compositionId) throw new Error('registry miss ' + expectId);
  const spec = cat.motionTemplate(expectId);
  typeDemos.push({templateId: expectId, compositionId: hit.compositionId, props: hit.props, durationSec: spec.durationSec, phrase: text});
}
function bindMotionTemplateContentSafe(beat, words) {
  const c = bindMod.bindMotionTemplateContent({templateId: beat.templateId, words, beatStart: beat.start, beatEnd: beat.end, hint: beat.hint, ...palette});
  if (!c) throw new Error('bind refused ' + beat.templateId);
  return c;
}
// riso mp4 mount: plan the WP53 fixture sentence, copy the real Brave render into the cache under the planner's key, publish through the real stage
const sentence = "I've helped over 200 people launch";
const sWords = sentence.split(' ').map((text, i) => ({text, start: 1 + i * 0.3, end: 1.25 + i * 0.3}));
const cacheDir = ${JSON.stringify(path.join(root, 'out/visual-backend-cache'))};
fs.mkdirSync(cacheDir, {recursive: true});
const rBeat = planner.planVisualBackendBeats({skill: 'explainer', durationSec: 30, words: sWords, flags: {riso: true, collage: false, anidoodle: false}, accent: palette.accent, ground: palette.ground}).beats[0];
const cachePath = riso.risoCachePath(rBeat, cacheDir);
fs.copyFileSync(${JSON.stringify(rison)}, cachePath);
const fake = async brief => ({id: brief.id, module: {url: 'https://cdn.invalid/' + brief.id + '.js', sha256: 'a'.repeat(64)}, placement: {mode: 'full_screen'}, props: {content: brief.content}, brief: {purpose: 'p', visualIntent: 'v'}});
const rStage = await vb.runVisualBackendStage({polishSkill: 'explainer', words: sWords, durationSec: 30, flags: {riso: true, collage: false, anidoodle: false}, accent: palette.accent, ground: palette.ground, cacheDir, publish: {publisher: fake}});
const risoGraphic = rStage.graphics[0];
if (!risoGraphic || risoGraphic.props.assetUrl !== cachePath) throw new Error('riso graphic did not carry the cached assetUrl: ' + JSON.stringify(risoGraphic && risoGraphic.props.assetUrl));
const dWords = 'Here is how it works inside the engine'.split(' ').map((text, i) => ({text, start: 1 + i * 0.3, end: 1.25 + i * 0.3}));
const dStage = await vb.runVisualBackendStage({polishSkill: 'explainer', words: dWords, durationSec: 30, flags: {riso: false, collage: false, anidoodle: true}, accent: palette.accent, cacheDir, publish: {publisher: fake}});
if (dStage.graphics.length !== 1) throw new Error('native doodle did not publish');
// prefetch rewrite: the cached file is copied under remotion/public (what prefetchBlueprintMedia does) and the graphic points at the staticFile
fs.copyFileSync(cachePath, ${JSON.stringify(path.join(fixtures, 'riso.mp4'))});
const risoSec = 2.4;
const mounted = {
  risoSec,
  graphics: [
    {...risoGraphic, id: 'riso_mounted', start: 0.3, end: 0.3 + risoSec, module: {url: 'x', sha256: 'riso_stub'}, props: {...risoGraphic.props, assetUrl: 'staticFile:wp54-fixtures/riso.mp4'}},
    {...dStage.graphics[0], id: 'doodle_native', start: risoSec + 0.3, end: risoSec + 0.3 + 4.3, module: {url: 'y', sha256: 'doodle_native'}, props: {style: 'cut-paper', accent: palette.accent, backend: 'native', assetUrl: ''}},
  ],
};
process.stdout.write(JSON.stringify({palette, typeDemos, mounted, warnings: {riso: rStage.warnings, doodle: dStage.warnings}, cachePath, risoProps: {backend: risoGraphic.props.backend, assetUrl: risoGraphic.props.assetUrl, template: risoGraphic.props.risoTemplate}}));
`;
const gen = spawnSync('node', ['--experimental-strip-types', '--input-type=module', '-e', script], {encoding: 'utf8', maxBuffer: 1 << 26, cwd: root});
if (gen.status !== 0) throw new Error(`could not resolve the WP54 plan through the real server code: ${gen.stderr}`);
const plan = JSON.parse(gen.stdout.trim().split('\n').pop()); // the server logger may print a line first
fs.writeFileSync(planFile, JSON.stringify(plan, null, 1));
console.log('type demos', plan.typeDemos.map(d => `${d.templateId}->${d.compositionId} "${d.phrase}"`).join(' | '));
console.log('riso mount', plan.risoProps, plan.warnings.riso.join(' '));
console.log('doodle', plan.warnings.doodle.join(' '));

const serveUrl = await bundle({entryPoint: path.join(here, 'wp54/entry.tsx'), outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'wp54-bundle-')), publicDir: path.join(root, 'public')});
const browser = await openBrowser('chrome');
try {
  const grab = async (id, marks, tag) => {
    const composition = await selectComposition({serveUrl, id, puppeteerInstance: browser});
    const out = [];
    for (const [name, sec] of marks) {
      const full = path.join(os.tmpdir(), `wp54-${id}-${name}.png`);
      await renderStill({composition, serveUrl, frame: Math.min(composition.durationInFrames - 1, Math.round(sec * FPS)), output: full, puppeteerInstance: browser, imageFormat: 'png', scale: 1});
      const small = path.join(stripDir, `${tag}-${name}.png`);
      run(['-i', full, '-vf', 'scale=216:-1', small], 'strip');
      out.push({name, full, small});
    }
    return out;
  };
  const video = async (id, name) => {
    const composition = await selectComposition({serveUrl, id, puppeteerInstance: browser});
    const full = path.join(os.tmpdir(), `wp54-${id}.mp4`);
    await renderMedia({composition, serveUrl, codec: 'h264', outputLocation: full, puppeteerInstance: browser, scale: 1, muted: true});
    run(['-i', full, '-vf', 'scale=540:-2', '-c:v', 'libx264', '-crf', '23', '-pix_fmt', 'yuv420p', '-an', file(name)], 'shrink');
    console.log('wrote', name);
  };
  // contact sheet: type comps (mid + late), then the other templates (late)
  const typeMarks = [];
  let off = 0;
  for (const demo of plan.typeDemos) {
    typeMarks.push([`${demo.templateId}-mid`, off + 0.9], [`${demo.templateId}-late`, off + demo.durationSec - 0.7]);
    off += demo.durationSec;
  }
  const tm = await grab('WP54TypeProof', typeMarks, 'type');
  const tplMarks = [];
  off = 0;
  for (const [name, dur, at] of [['doodle-cut-paper', 4.6, 2.9], ['doodle-chalkboard', 4.6, 2.9], ['price-drop', 3.0, 2.4], ['device-frame', 3.4, 1.8], ['cursor-click', 3.0, 1.7], ['logo-reveal', 2.4, 1.4], ['ken-burns', 3.2, 2.2], ['mesh-over-footage', 4.0, 2.0]]) {
    tplMarks.push([name, off + at]);
    off += dur;
  }
  const pm = await grab('WP54TemplateProof', tplMarks, 'tpl');
  const mm = await grab('WP54Mounted', [['riso-mp4-mounted', 1.5], ['doodle-native', 2.4 + 0.3 + 3.4]], 'mount');
  const inputs = [...tm, ...pm];
  const cols = 8;
  run([...inputs.flatMap(i => ['-i', i.small]), '-filter_complex', `${inputs.map((_, k) => `[${k}:v]`).join('')}xstack=inputs=${inputs.length}:layout=${inputs.map((_, k) => `${(k % cols) * 220}_${Math.floor(k / cols) * 385}`).join('|')}:fill=black`, '-frames:v', '1', '-q:v', '3', file('wp54-contact-sheet.jpg')], 'sheet');
  fs.copyFileSync(pm[0].full, file('wp54-doodle-still.png'));
  fs.copyFileSync(mm[0].full, file('wp54-riso-mounted-still.png'));
  fs.copyFileSync(mm[1].full, file('wp54-doodle-mounted-still.png'));
  await video('WP54TypeProof', 'wp54-type-proof.mp4');
  await video('WP54TemplateProof', 'wp54-templates-proof.mp4');
  await video('WP54Mounted', 'wp54-mounted-backends.mp4');
  run(['-i', file('wp54-type-proof.mp4'), '-t', String(plan.typeDemos[0].durationSec), '-c:v', 'libx264', '-crf', '23', '-pix_fmt', 'yuv420p', '-an', file('wp54-type-word-reveal.mp4')], 'word reveal cut');
  console.log('wrote wp54-type-word-reveal.mp4, wp54-contact-sheet.jpg');
} finally {
  await browser.close({silent: true});
}
