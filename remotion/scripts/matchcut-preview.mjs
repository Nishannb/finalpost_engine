/**
 * TEXT MATCH CUT: offline SIMULATED proof (live renders stay PAUSED: no Claude, no Director model, no network, no pipeline run).
 *   1. The REAL server pieces run under node (`--experimental-strip-types`): planCraftTemplateBeats (kinetic-led ON) -> bindMotionTemplateContent (grounding) -> resolveLibraryGraphic (registry) turn SIMULATED transcripts
 *      containing the word "intelligence" into the exact props the production comp renders. The toolkit + Director capability block are dumped too.
 *   2. Remotion renders the production comp: matchcut-intelligence-proof.mp4 (3 grammars + a keyword swap), a contact sheet of every cut, and a hard-cut check (frame-to-frame difference) on the encoded video.
 * Usage (from remotion/): npm run preview:matchcut
 * Output (out/phase36-readiness/): matchcut-intelligence-proof.mp4, matchcut-cuts-contact-sheet.jpg, matchcut-plan.json, matchcut-render-report.json
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
fs.mkdirSync(outDir, {recursive: true});
const file = name => path.join(outDir, name);
const run = (args, label) => {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args]);
  if (r.status !== 0) throw new Error(`ffmpeg ${label} failed: ${r.stderr}`);
};

const server = path.resolve(root, '../server/src');
const script = `
const cat = await import(${JSON.stringify(server + '/stages/broll/motionTemplateCatalog.ts')});
const craft = await import(${JSON.stringify(server + '/stages/broll/planCraftTemplateBeats.ts')});
const bindMod = await import(${JSON.stringify(server + '/stages/broll/motionTemplateBind.ts')});
const reg = await import(${JSON.stringify(server + '/stages/motionDirector/libraryRegistry.ts')});
const caps = await import(${JSON.stringify(server + '/stages/broll/kineticTypeCapabilities.ts')});
const toolkits = await import(${JSON.stringify(server + '/lib/editToolkits.ts')});
const led = await import(${JSON.stringify(server + '/stages/broll/kineticLedConfig.ts')});
const ID = 'clip_55_type_text_match_cut';
const speech = (text, at) => text.split(/\\s+/).map((word, i) => ({text: word, start: at + i * 0.3, end: at + i * 0.3 + 0.25}));
const LEAD = 0.5;
const sentences = [
  ['memo', 'So what is intelligence really, and how does a machine learn it', 14],
  ['editorial', 'Let us talk about the power of intelligence in brand design', 14],
  ['newsprint', 'Here is the story behind what is intelligence and why the press keeps missing it', 14],
  ['swap', 'We move from instinct to intelligence in every single edit we make', 14],
];
const scenes = [];
for (const [label, text, at] of sentences) {
  const words = speech(text, at);
  const planned = craft.planCraftTemplateBeats({skill: 'default', durationSec: 40, words, kineticOnly: [ID], kineticLed: true});
  const beat = planned.beats.find(b => b.templateId === ID);
  if (!beat) throw new Error('planner did not pick the text match cut for: ' + text + ' -> ' + JSON.stringify(planned.warnings));
  const content = bindMod.bindMotionTemplateContent({templateId: ID, words, beatStart: beat.start, beatEnd: beat.end, hint: beat.hint, accent: '#3D4A5C', ground: '#F7F6F2'});
  if (!content) throw new Error('binder refused ' + text);
  const hit = reg.resolveLibraryGraphic({goal: 'g', visualDescription: 'v', placement: 'full_screen', content: {motionTemplateId: ID, ...content}});
  if (!hit || hit.compositionId !== beat.compositionId) throw new Error('registry miss');
  const props = {...hit.props};
  delete props.personalized;
  scenes.push({label, sentence: text, props, beatSec: Math.round((beat.end - beat.start) * 100) / 100, planned: {start: beat.start, end: beat.end, muteCaptions: beat.muteCaptions, hint: beat.hint}, reason: (planned.warnings.find(w => w.startsWith('kinetic_type:' + ID)) ?? '').replace('kinetic_type:' + ID + ':', ''), warnings: planned.warnings.filter(w => w.startsWith('kinetic_'))});
}
// a full 40 s Kinetic-Led edit: the match cut competes with the other kinetic type and is capped (<= 1 per 20 s)
const edit = [...speech('Welcome to Northwind Realty.', 1), ...speech(sentences[0][1], 6), ...speech('And that is attention.', 13), ...speech('Good editing feels invisible.', 18), ...speech(sentences[3][1], 23), ...speech('So the secret is consistent attention every day.', 30), ...speech('Just DM me for a free video.', 36)];
const full = craft.planCraftTemplateBeats({skill: 'default', durationSec: 40, words: edit, kineticLed: true});
const ledEdit = {durationSec: 40, ledBudget: led.kineticLedBeatBudget(40), beats: full.beats.map(b => ({id: b.templateId, start: Math.round(b.start * 100) / 100, end: Math.round(b.end * 100) / 100, family: led.kineticMotionFamily(b.templateId), muteCaptions: b.muteCaptions})), warnings: full.warnings.filter(w => w.startsWith('kinetic_'))};
const kinetic = toolkits.EDIT_TOOLKITS.find(t => t.id === 'kinetic_text');
const toolkit = {id: kinetic.id, mentionsMatchCut: kinetic.description.includes('type_text_match_cut'), description: kinetic.description};
const capsRow = caps.kineticTypeCapabilitiesFor('default', new Set(reg.LIBRARY_COMPOSITION_IDS)).find(c => c.name === 'type_text_match_cut');
const directorBlock = caps.formatKineticTypeForDirector('default', new Set(reg.LIBRARY_COMPOSITION_IDS)).split('\\n').filter(l => l.includes('type_text_match_cut'));
const catalogRow = cat.motionTemplate(ID);
const allowedIn = Object.keys(cat.SKILL_MOTION_TEMPLATE_ALLOWLIST).filter(k => cat.SKILL_MOTION_TEMPLATE_ALLOWLIST[k].includes(ID));
process.stdout.write(JSON.stringify({scenes, ledEdit, toolkit, capability: capsRow, directorBlock, catalogRow, allowedIn}));
`;
const gen = spawnSync('node', ['--experimental-strip-types', '--input-type=module', '-e', script], {encoding: 'utf8', maxBuffer: 1 << 26, cwd: root});
if (gen.status !== 0) throw new Error(`could not resolve the match-cut plan through the real server code: ${gen.stderr}`);
const plan = JSON.parse(gen.stdout.trim().split('\n').pop());
fs.writeFileSync(file('matchcut-plan.json'), JSON.stringify(plan, null, 1));
console.log('toolkit kinetic_text mentions type_text_match_cut:', plan.toolkit.mentionsMatchCut, '| allowed in skills:', plan.allowedIn.join(', '));
for (const s of plan.scenes) console.log(`[${s.label}] ${s.props.variant} keyword="${s.props.keyword}"${s.props.swapKeyword ? ` -> "${s.props.swapKeyword}"` : ''} ${s.beatSec}s | ${s.reason}`);
console.log('led edit beats:', plan.ledEdit.beats.map(b => `${b.id.replace('clip_', '')}@${b.start}`).join(' '));

const serveUrl = await bundle({entryPoint: path.join(here, 'matchcut/entry.tsx'), outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'matchcut-bundle-')), publicDir: path.join(root, 'public')});
const browser = await openBrowser('chrome');
const report = {checks: {}, files: []};
try {
  // contact sheet: one row per scene, one column per cut (mid-scene frame), cut length from the comp's own preset
  const SCENE_SEC = {memo: 0.16, editorial: 0.2, newsprint: 0.23};
  const COLS = 7;
  const cells = [];
  for (const [r, s] of plan.scenes.entries()) {
    const per = Math.max(2, Math.round(SCENE_SEC[s.props.variant] * FPS));
    for (let c = 0; c < COLS; c++) {
      const frame = Math.min(Math.round(s.beatSec * FPS) - 1, c * per + Math.floor(per / 2));
      const out = path.join(os.tmpdir(), `matchcut-${r}-${c}.png`);
      const inputProps = {props: s.props, width: 720, height: 1280, beatSec: s.beatSec};
      const composition = await selectComposition({serveUrl, id: 'MatchCutSingle', puppeteerInstance: browser, inputProps});
      await renderStill({composition, serveUrl, frame, output: out, puppeteerInstance: browser, imageFormat: 'png', scale: 0.5, inputProps});
      cells.push(out);
    }
  }
  run([...cells.flatMap(i => ['-i', i]), '-filter_complex', `${cells.map((_, k) => `[${k}:v]`).join('')}xstack=inputs=${cells.length}:layout=${cells.map((_, k) => `${(k % COLS) * 360}_${Math.floor(k / COLS) * 640}`).join('|')}:fill=black`, '-frames:v', '1', '-q:v', '3', file('matchcut-cuts-contact-sheet.jpg')], 'sheet');
  report.files.push('matchcut-cuts-contact-sheet.jpg');

  const composition = await selectComposition({serveUrl, id: 'MatchCutProof', puppeteerInstance: browser});
  const full = path.join(os.tmpdir(), 'matchcut-proof-full.mp4');
  await renderMedia({composition, serveUrl, codec: 'h264', outputLocation: full, puppeteerInstance: browser, scale: 1, muted: true});
  run(['-i', full, '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-an', file('matchcut-intelligence-proof.mp4')], 'shrink');
  report.files.push('matchcut-intelligence-proof.mp4');

  // hard-cut check on the encoded video: per-frame luma difference. Cuts are single-frame spikes, held frames are quiet (T2 has a steady push-in drift), no dissolve (a spike is never followed by a second spike).
  const probe = spawnSync('ffmpeg', ['-v', 'error', '-i', file('matchcut-intelligence-proof.mp4'), '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YDIF:file=-', '-f', 'null', '-'], {encoding: 'utf8', maxBuffer: 1 << 26});
  const ydif = [...probe.stdout.matchAll(/YDIF=([\d.]+)/g)].map(m => Number(m[1]));
  const spikes = ydif.map((v, i) => [i, v]).filter(([, v]) => v > 8).map(([i]) => i);
  const adjacent = spikes.filter((i, k) => k > 0 && i - spikes[k - 1] === 1).length;
  report.checks.frames = ydif.length;
  report.checks.cutFrames = spikes;
  report.checks.adjacentSpikes = adjacent;
  report.checks.hardCutsOnly = spikes.length >= 10 && adjacent === 0;
} finally {
  await browser.close({silent: true});
}
report.checks.beats = plan.scenes.length;
report.checks.mutesCaptions = plan.scenes.every(s => s.planned.muteCaptions === true);
fs.writeFileSync(file('matchcut-render-report.json'), JSON.stringify(report, null, 1));
console.log('done', JSON.stringify(report.checks));
