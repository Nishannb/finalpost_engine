/**
 * Kinetic typography CLI.
 *   npx tsx server/src/stages/kinetic/cli.ts run <video> --brand <json> --out <mp4> [--matte <webm>] [--transcript <json>] [--debug] [--range a-b] [--no-render]
 *   npx tsx server/src/stages/kinetic/cli.ts storyboard [--out-dir <dir>]      (rewrites remotion/src/kinetic/storyboard.spec.json, renders the 12 cells + the contact sheet remotion/out/kinetic-engine/stills/sheet.png)
 *   npx tsx server/src/stages/kinetic/cli.ts sheet2 | sheet3 | split-depth | matchcut-proof    (sheet-2.png, sheet-3.png, split-depth.png, matchcut.mp4 + matchcut.png; sheet.png is never touched)
 *   npx tsx server/src/stages/kinetic/cli.ts motion-proof [--out-dir <dir>]    (90-frame phrase-a mp4 + hold / slam stills, remotion/out/kinetic-engine/motion)
 */
import {execFile} from 'node:child_process';
import {mkdir, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';

import {REMOTION_DIR, runKinetic} from './runKinetic.ts';
import {buildFallbackPlan} from './fallback.ts';
import {solveLayout} from './layout.ts';
import {StaticCamera} from './camera.ts';
import {SubjectBandDepth} from './depth.ts';
import {buildScene} from './scene.ts';
import {SHEET2_COLS, buildSheet2, sheet2Props} from './sheet2.ts';
import {SHEET3_COLS, buildSheet3, sheet3Props} from './sheet3.ts';
import {SHEET_COLS, STORYBOARD_SUBJECT, buildPhraseA, buildStoryboard, storyboardProps} from './storyboard.ts';
import {brandConfigSchema, type KineticWord, type TextEvent} from './schema.ts';

const execP = promisify(execFile);

function parseArgs(argv: string[]): {cmd: string; pos: string[]; flags: Record<string, string | true>} {
  const [cmd = '', ...rest] = argv;
  const pos: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i]!;
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith('--')) { flags[k] = next; i += 1; } else flags[k] = true;
    } else pos.push(a);
  }
  return {cmd, pos, flags};
}

export async function storyboardCommand(outDir: string): Promise<string[]> {
  const sb = buildStoryboard();
  const specPath = path.join(REMOTION_DIR, 'src/kinetic/storyboard.spec.json');
  await writeFile(specPath, JSON.stringify(storyboardProps(sb)));
  await mkdir(outDir, {recursive: true});
  const cellFile = (i: number) => path.join(outDir, `c${String(i + 1).padStart(2, '0')}.png`);
  const job = {stills: sb.cells.map((c, i) => ({id: 'KineticStoryboard', frame: c.stillFrame, out: cellFile(i)})), videos: []};
  const jobFile = path.join(outDir, '.job.json');
  await writeFile(jobFile, JSON.stringify(job));
  const {stdout} = await execP('node', [path.join(REMOTION_DIR, 'scripts/kinetic/render.mjs'), jobFile], {cwd: REMOTION_DIR, maxBuffer: 1 << 26, timeout: 30 * 60_000});
  // the contact sheet: SHEET_COLS columns x 4 rows (3 styles + the specials row)
  const sheet = path.join(outDir, 'sheet.png');
  const rows = Math.ceil(sb.cells.length / SHEET_COLS);
  await execP('ffmpeg', ['-y', '-v', 'error', '-framerate', '1', '-i', path.join(outDir, 'c%02d.png'), '-vf', `scale=540:960,tile=${SHEET_COLS}x${rows}:padding=6:margin=6:color=0x0b0e14`, '-frames:v', '1', sheet]);
  await rm(jobFile, {force: true});
  return [...stdout.split('\n').filter(l => l.startsWith('  ')).map(l => l.trim()), sheet];
}

export async function motionProofCommand(outDir: string): Promise<string[]> {
  const p = buildPhraseA();
  const props = {spec: p.spec, subjectBox: STORYBOARD_SUBJECT, subjectBoxes: [{startFrame: 0, endFrame: 90, box: {x: 0.04, y: 0.3, w: 0.4, h: 0.62}, label: 'phrase-a · cinematicClean · FAKE timings'}], labels: true};
  await mkdir(outDir, {recursive: true});
  await writeFile(path.join(outDir, 'phrase-a.spec.json'), JSON.stringify(p.spec));
  const job = {
    stills: [
      {id: 'KineticStoryboard', frame: p.frames.hold, out: path.join(outDir, 'phrase-a-hold.png'), props},
      {id: 'KineticStoryboard', frame: p.frames.slam, out: path.join(outDir, 'phrase-a-slam.png'), props},
    ],
    videos: [{id: 'KineticStoryboard', out: path.join(outDir, 'phrase-a.mp4'), props, from: 0, to: 89, muted: true, crf: 18}],
  };
  const jobFile = path.join(outDir, '.job.json');
  await writeFile(jobFile, JSON.stringify(job));
  const {stdout} = await execP('node', [path.join(REMOTION_DIR, 'scripts/kinetic/render.mjs'), jobFile], {cwd: REMOTION_DIR, maxBuffer: 1 << 26, timeout: 30 * 60_000});
  await rm(jobFile, {force: true});
  return stdout.split('\n').filter(l => l.startsWith('  ')).map(l => l.trim());
}

const runJob = async (outDir: string, job: unknown): Promise<string[]> => {
  const jobFile = path.join(outDir, '.job.json');
  await writeFile(jobFile, JSON.stringify(job));
  try {
    const {stdout} = await execP('node', [path.join(REMOTION_DIR, 'scripts/kinetic/render.mjs'), jobFile], {cwd: REMOTION_DIR, maxBuffer: 1 << 26, timeout: 30 * 60_000});
    return stdout.split('\n').filter(l => l.startsWith('  ')).map(l => l.trim());
  } finally {
    await rm(jobFile, {force: true});
  }
};

/** sheet-2.png: the depth + looks contact sheet (sheet.png, the layout sheet, is never touched). Cell stills go to a temp dir. */
export async function sheet2Command(outDir: string): Promise<string[]> {
  const sb = buildSheet2();
  await mkdir(outDir, {recursive: true});
  const tmp = path.join(outDir, '.sheet2-cells');
  await mkdir(tmp, {recursive: true});
  const cellFile = (i: number) => path.join(tmp, `s${String(i + 1).padStart(2, '0')}.png`);
  const props = sheet2Props(sb);
  await runJob(tmp, {stills: sb.cells.map((c, i) => ({id: 'KineticStoryboard', frame: c.stillFrame, out: cellFile(i), props}))});
  const sheet = path.join(outDir, 'sheet-2.png');
  const rows = Math.ceil(sb.cells.length / SHEET2_COLS);
  await execP('ffmpeg', ['-y', '-v', 'error', '-framerate', '1', '-i', path.join(tmp, 's%02d.png'), '-vf', `scale=540:960,tile=${SHEET2_COLS}x${rows}:padding=6:margin=6:color=0x0b0e14`, '-frames:v', '1', sheet]);
  await rm(tmp, {recursive: true, force: true});
  return [sheet];
}

/** sheet-3.png: perspective / isometric / slant / extruded-yaw contact sheet. */
export async function sheet3Command(outDir: string): Promise<string[]> {
  const sb = buildSheet3();
  await mkdir(outDir, {recursive: true});
  const tmp = path.join(outDir, '.sheet3-cells');
  await mkdir(tmp, {recursive: true});
  const cellFile = (i: number) => path.join(tmp, `s${String(i + 1).padStart(2, '0')}.png`);
  const props = sheet3Props(sb);
  await runJob(tmp, {stills: sb.cells.map((c, i) => ({id: 'KineticStoryboard', frame: c.stillFrame, out: cellFile(i), props}))});
  const sheet = path.join(outDir, 'sheet-3.png');
  const rows = Math.ceil(sb.cells.length / SHEET3_COLS);
  await execP('ffmpeg', ['-y', '-v', 'error', '-framerate', '1', '-i', path.join(tmp, 's%02d.png'), '-vf', `scale=540:960,tile=${SHEET3_COLS}x${rows}:padding=6:margin=6:color=0x0b0e14`, '-frames:v', '1', sheet]);
  await rm(tmp, {recursive: true, force: true});
  return [sheet];
}

/** split-depth.png: one full-size frame of stackOverCutout on the storyboard figure (line 1 above the head in front, the hero cut by the silhouette). */
export async function splitDepthCommand(outDir: string): Promise<string[]> {
  const width = 1080, height = 1920, fps = 30;
  const words: KineticWord[] = ['i', 'feel', 'like', 'giving'].map((text, idx) => ({idx, text, startFrame: 8 + idx * 12, endFrame: 8 + idx * 12 + 11, emphasisScore: 0.8}));
  const shots = [{id: 'shot-0', startFrame: 0, endFrame: 120}];
  const ev: TextEvent = {id: 'split', shotId: 'shot-0', wordRange: [0, 3], lines: [{text: 'i feel like', role: 'connector'}, {text: 'giving', role: 'hero'}], preset: 'type.words', layering: 'auto', anchor: 'auto', regionHint: 'stackOverCutout'};
  const scenes = {'shot-0': buildScene({shotId: 'shot-0', subjectBox: STORYBOARD_SUBJECT, luminance: 0.07, width, height})};
  const {spec} = solveLayout({plan: {version: '1', style: 'cinematicClean', events: [ev]}, words, shots, scenes, cameras: {'shot-0': new StaticCamera().track(shots[0]!)}, depth: new SubjectBandDepth(), brand: brandConfigSchema.parse({}), width, height, fps, seed: 1, planSource: 'split-depth'});
  const out = path.join(outDir, 'split-depth.png');
  await mkdir(outDir, {recursive: true});
  await runJob(outDir, {stills: [{id: 'KineticStoryboard', frame: 60, out, props: {spec, subjectBox: STORYBOARD_SUBJECT, subjectBoxes: [], labels: false}}]});
  return [out];
}

/** The fake spoken phrase of the match-cut proof (TIMINGS ARE FAKE): "so what is design in the work we do" -> keyword "design", editorial grammar. */
export function matchCutProofSpec(width = 720, height = 1280) {
  const fps = 30;
  const toks = 'so what is design in the work we do'.split(' ');
  const words: KineticWord[] = toks.map((text, idx) => ({idx, text, startFrame: 4 + idx * 8, endFrame: 4 + idx * 8 + 7, emphasisScore: 0.5}));
  const shots = [{id: 'shot-0', startFrame: 0, endFrame: 140}];
  const plan = buildFallbackPlan({words, shots, fps}).plan;
  const scenes = {'shot-0': buildScene({shotId: 'shot-0', subjectBox: STORYBOARD_SUBJECT, luminance: 0.07, width, height})};
  const solved = solveLayout({plan, words, shots, scenes, cameras: {'shot-0': new StaticCamera().track(shots[0]!)}, depth: new SubjectBandDepth(), brand: brandConfigSchema.parse({}), width, height, fps, seed: 1, planSource: 'matchcut-proof (fake timings)'});
  return {...solved, plan, words};
}

/** matchcut.mp4 (~2 s) + matchcut.png: TypeTextMatchCut through the kinetic compositor (KineticEdit on a plain plate), from a fake transcript, through the fallback planner and the real solver. */
export async function matchCutProofCommand(motionDir: string, stillsDir: string): Promise<string[]> {
  const {spec} = matchCutProofSpec();
  const mc = spec.events.find(e => e.presetResolved === 'type.matchCut');
  if (!mc) throw new Error('no match cut was planned for the proof phrase');
  await mkdir(motionDir, {recursive: true});
  await mkdir(stillsDir, {recursive: true});
  await writeFile(path.join(motionDir, 'matchcut.spec.json'), JSON.stringify(spec));
  const props = {spec, plateColor: '#1b1f27'};
  const out = path.join(motionDir, 'matchcut.mp4');
  const still = path.join(stillsDir, 'matchcut.png');
  await runJob(motionDir, {
    stills: [{id: 'KineticEdit', frame: mc.inFrame + 17, out: still, props}],
    videos: [{id: 'KineticEdit', out, props, from: Math.max(0, mc.inFrame - 2), to: mc.outFrame - 1, muted: true, crf: 18}],
  });
  return [out, still];
}

async function main(): Promise<void> {
  const {cmd, pos, flags} = parseArgs(process.argv.slice(2));
  if (cmd === 'run') {
    const video = pos[0];
    if (!video || typeof flags.out !== 'string') { console.error('usage: run <video> --brand <json> --out <mp4> [--matte <webm>] [--transcript <json>] [--debug] [--range a-b] [--no-render]'); process.exit(2); }
    const range = typeof flags.range === 'string' ? (flags.range.split('-').map(Number) as [number, number]) : undefined;
    const {report, outputs} = await runKinetic({
      video: path.resolve(video), out: path.resolve(flags.out),
      ...(typeof flags.brand === 'string' ? {brandPath: path.resolve(flags.brand)} : {}),
      ...(typeof flags.matte === 'string' ? {matte: path.resolve(flags.matte)} : {}),
      ...(typeof flags.transcript === 'string' ? {transcriptPath: path.resolve(flags.transcript)} : {}),
      debug: Boolean(flags.debug), render: !flags['no-render'], ...(range ? {frameRange: range} : {}),
    });
    console.log(JSON.stringify({outputs, providers: report.providers, planSource: report.planSource, noMatte: report.noMatte, violations: report.guardrailViolations.length, cache: report.cache, warnings: report.warnings}, null, 2));
    return;
  }
  if (cmd === 'storyboard') {
    const outDir = path.resolve(typeof flags['out-dir'] === 'string' ? flags['out-dir'] : path.join(REMOTION_DIR, 'out/kinetic-engine/stills'));
    const written = await storyboardCommand(outDir);
    console.log('storyboard wrote:\n' + written.map(w => '  ' + w).join('\n'));
    return;
  }
  if (cmd === 'motion-proof') {
    const outDir = path.resolve(typeof flags['out-dir'] === 'string' ? flags['out-dir'] : path.join(REMOTION_DIR, 'out/kinetic-engine/motion'));
    const written = await motionProofCommand(outDir);
    console.log('motion proof wrote:\n' + written.map(w => '  ' + w).join('\n'));
    return;
  }
  if (cmd === 'sheet2') {
    const outDir = path.resolve(typeof flags['out-dir'] === 'string' ? flags['out-dir'] : path.join(REMOTION_DIR, 'out/kinetic-engine/stills'));
    console.log('sheet-2 wrote:\n' + (await sheet2Command(outDir)).map(w => '  ' + w).join('\n'));
    return;
  }
  if (cmd === 'sheet3') {
    const outDir = path.resolve(typeof flags['out-dir'] === 'string' ? flags['out-dir'] : path.join(REMOTION_DIR, 'out/kinetic-engine/stills'));
    console.log('sheet-3 wrote:\n' + (await sheet3Command(outDir)).map(w => '  ' + w).join('\n'));
    return;
  }
  if (cmd === 'split-depth') {
    const outDir = path.resolve(typeof flags['out-dir'] === 'string' ? flags['out-dir'] : path.join(REMOTION_DIR, 'out/kinetic-engine/stills'));
    console.log('split-depth wrote:\n' + (await splitDepthCommand(outDir)).map(w => '  ' + w).join('\n'));
    return;
  }
  if (cmd === 'matchcut-proof') {
    const base = path.join(REMOTION_DIR, 'out/kinetic-engine');
    console.log('matchcut proof wrote:\n' + (await matchCutProofCommand(path.join(base, 'motion'), path.join(base, 'stills'))).map(w => '  ' + w).join('\n'));
    return;
  }
  console.error('commands: run | storyboard | motion-proof | sheet2 | sheet3 | split-depth | matchcut-proof');
  process.exit(2);
}

const entry = process.argv[1] ?? '';
if (entry.endsWith('kinetic/cli.ts') || entry.endsWith('kinetic/cli.js')) {
  main().catch(err => { console.error(err instanceof Error ? err.stack ?? err.message : err); process.exit(1); });
}
