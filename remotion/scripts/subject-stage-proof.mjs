/**
 * Subject Stage proof (Phase 6): renders the REAL `ShortVideo` composition with a `subjectStage` blueprint that cycles S1 -> S2 -> S3 -> S4 -> S5 over a 20 s talking head, so the host z-order, the room
 * blur / dim (speaker `grade`), SubjectStageTrack, the RVM subject (SubjectForegroundTrack) and SubjectStageFront are all the production code. LOCAL render only (no Lambda, no network, no model).
 * Usage (from remotion/):  node scripts/subject-stage-proof.mjs        (not an npm script)
 *
 * Inputs: remotion/public/hi.mp4 and an RVM cutout of its first 20 s (SS_MATTE, default /tmp/subject-stage-proof/hi-matte-0-20.webm; generated with the repo's RVM venv when missing).
 * FRAMING: hi.mp4 is a tight medium shot (head top at ~9 % of the frame); the grammar assumes head top at ~28-30 %. The proof therefore recomposes BOTH the room video and the matte the same way (scaled to 79 %,
 * bottom-aligned, the new headroom / side strips filled with a blurred smear of the room's left-top corner, which has no person in it) so the subject sits where the grammar expects her. This is a proof-only prep step, not product behaviour (see phase6-report.md).
 *
 * Output (out/subject-stage-proof/): subject-stage-proof.mp4, S1.png .. S5.png, S4b.png (the last S4's chip). The stage plan comes from the REAL planner (validated; all five stages required). Temp bundle / public / media dirs are removed at the end.
 * Refuses to start under 1.5 GiB free.
 */
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const engine = path.resolve(root, '..');
const require = createRequire(path.join(root, 'package.json'));
const outDir = path.join(root, 'out/subject-stage-proof');
const MATTE = process.env.SS_MATTE || '/tmp/subject-stage-proof/hi-matte-0-20.webm';
const FPS = 25;
const W = 720;
const H = 1280;
const DUR = 20;

const stat = fs.statfsSync(root);
const free = stat.bavail * stat.bsize;
if (free < 1.5 * 1024 ** 3) {
  console.error(`STOP: ${(free / 1024 ** 3).toFixed(2)} GiB free, need 1.5. Nothing was bundled.`);
  process.exit(2);
}
if (!fs.existsSync(path.join(root, 'public/hi.mp4'))) throw new Error('missing remotion/public/hi.mp4');

const tmpMedia = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-media-'));
const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-bundle-'));
const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-public-'));
let browser;
const written = [];
try {
  // ---- 1. the RVM cutout of the first 20 s (generated with the repo's RVM venv when missing; MPS)
  if (!fs.existsSync(MATTE)) {
    fs.mkdirSync(path.dirname(MATTE), {recursive: true});
    const py = path.join(engine, 'subjectmatte/.venv-rvm/bin/python');
    if (!fs.existsSync(py)) throw new Error('no RVM cutout and no RVM venv to make one');
    execFileSync(py, ['-m', 'human_matting.cli', path.join(root, 'public/hi.mp4'), MATTE, MATTE.replace(/\.webm$/, '.json'), '--ranges', `0-${DUR}`], {cwd: path.join(engine, 'subjectmatte'), env: {...process.env, RVM_DEVICE: process.env.RVM_DEVICE || 'mps'}, stdio: 'inherit'});
  }

  // ---- 2. proof-only reframing: room video + matte get the SAME transform (79 %, bottom aligned, mirrored headroom)
  const S = 0.79;
  const sw = 2 * Math.round((W * S) / 2);
  const sh = 2 * Math.round((H * S) / 2);
  const px = Math.round((W - sw) / 2);
  const py = H - sh;
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-t', String(DUR), '-i', path.join(root, 'public/hi.mp4'), '-an', '-filter_complex', `[0:v]split[a][b];[a]crop=110:240:0:0,scale=${W}:${H},boxblur=18:4[bg];[b]scale=${sw}:${sh}[fg];[bg][fg]overlay=${px}:${py},format=yuv420p`, '-c:v', 'libx264', '-crf', '18', '-r', String(FPS), path.join(tmpMedia, 'room.mp4')]);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-t', String(DUR), '-c:v', 'libvpx-vp9', '-i', MATTE, '-an', '-vf', `format=yuva420p,scale=${sw}:${sh},pad=${W}:${H}:${px}:${py}:color=black@0,format=yuva420p`, '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-b:v', '0', '-crf', '28', '-r', String(FPS), path.join(tmpMedia, 'matte.webm')]);

  // ---- 3. the blueprint: the REAL planner (server/src/stages/subjectStage, imported as TypeScript by Node's type stripping) over a 20 s spoken-like script, so the proof obeys every rule
  // (contentful S1 from the first frame, no behind gap > 0.5 s, heavy runs broken by S4, S5 once and full-bleed). The plan is validated and must contain all five stages.
  const {planSubjectStage, toSubjectStageBlueprint, validateSubjectStagePlan} = await import(path.join(engine, 'server/src/stages/subjectStage/planSubjectStage.ts'));
  const script = [
    ['Imagine you see a shocking post about a flood in your town right now.', 3.4],
    ['The page said "please send money to this account right now".', 3.4],
    ['The term is called phishing and it basically means online fraud.', 3.4],
    ['So I searched for it and the results were everywhere, with many links and websites.', 4.8],
    ['The official conclusion is final: verify through official channels.', 3.2],
  ];
  let clock = 0.4;
  const sentences = script.map(([text, dur]) => {
    const row = {start: Math.round(clock * 1000) / 1000, end: Math.round((clock + dur) * 1000) / 1000, text};
    clock += dur + 0.25;
    return row;
  });
  const base = JSON.parse(fs.readFileSync(path.join(root, 'props/sample.json'), 'utf8'));
  const plan = planSubjectStage({sentences, durationSec: DUR});
  const problems = validateSubjectStagePlan(plan, DUR);
  const stagesSeen = new Set(plan.spans.map(span => span.stage));
  if (problems.length > 0 || !['S1', 'S2', 'S3', 'S4', 'S5'].every(id => stagesSeen.has(id))) throw new Error(`proof plan invalid: ${JSON.stringify({problems, stages: [...stagesSeen]})}`);
  const subjectStage = toSubjectStageBlueprint(plan, 'staticFile:subject-stage-proof/matte.webm');
  const captionWords = sentences.flatMap((sentence, sentenceIndex) => {
    const parts = sentence.text.replace(/["]/g, '').split(/\s+/);
    const step = (sentence.end - sentence.start) / parts.length;
    return parts.map((text, i) => ({text, start: Math.round((sentence.start + i * step) * 100) / 100, end: Math.round((sentence.start + (i + 0.9) * step) * 100) / 100, sentenceIndex}));
  });
  const blueprint = {
    ...base.blueprint,
    blueprintId: 'subject_stage_proof',
    videoUrl: 'staticFile:subject-stage-proof/room.mp4',
    fps: FPS,
    width: W,
    height: H,
    sourceDurationSec: DUR,
    outputDurationSec: DUR,
    keepSegments: [{sourceStart: 0, sourceEnd: DUR, outputStart: 0}],
    captionWords,
    zoomTriggers: [],
    hookTitle: '',
    hookSubtitle: '',
    brollClips: [],
    depthOverlays: [],
    insetReveals: [],
    visualOverlays: [],
    motionGraphics: [],
    mediaContainers: [],
    semanticEmphasis: [],
    subjectStage,
  };
  const inputProps = {blueprint, style: {...base.style, zoomEnabled: false, brollEnabled: true}};

  // ---- 4. bundle the production Root + the proof media, render stills + the mp4
  fs.cpSync(path.join(root, 'public'), publicDir, {recursive: true});
  fs.mkdirSync(path.join(publicDir, 'subject-stage-proof'), {recursive: true});
  fs.copyFileSync(path.join(tmpMedia, 'room.mp4'), path.join(publicDir, 'subject-stage-proof/room.mp4'));
  fs.copyFileSync(path.join(tmpMedia, 'matte.webm'), path.join(publicDir, 'subject-stage-proof/matte.webm'));
  fs.mkdirSync(outDir, {recursive: true});
  const {bundle} = require('@remotion/bundler');
  const {openBrowser, renderMedia, renderStill, selectComposition} = require('@remotion/renderer');
  const serveUrl = await bundle({entryPoint: path.join(root, 'src/index.ts'), outDir: bundleDir, publicDir});
  browser = await openBrowser('chrome');
  const composition = await selectComposition({serveUrl, id: 'ShortVideo', puppeteerInstance: browser, inputProps});
  const still = async (name, tSec) => {
    const output = path.join(outDir, name);
    await renderStill({composition, serveUrl, frame: Math.round(tSec * FPS), output, puppeteerInstance: browser, imageFormat: 'png', inputProps, logLevel: 'warn'});
    written.push(output);
  };
  // one still per stage, timed from the plan: S1 mid-plate | S2 after the card's slow push began | S3 after ~2 s of scroll | S4 with the stack's second line | S5 on the full-bleed HOLD | S4b the last S4's chip
  const span = id => plan.spans.find(x => x.stage === id);
  const lastS4 = [...plan.spans].reverse().find(x => x.stage === 'S4');
  const stack = plan.accents.find(a => a.kind === 'text_stack');
  await still('S1.png', span('S1').start + 1.5);
  await still('S2.png', span('S2').start + 2);
  await still('S3.png', span('S3').start + 2.5);
  await still('S4.png', stack ? stack.start + (stack.lineStarts?.[1] ?? 1) + 0.5 : span('S4').start + 1.5);
  await still('S5.png', span('S5').start + 1.2);
  await still('S4b.png', lastS4.start + 0.8);
  const mp4 = path.join(outDir, 'subject-stage-proof.mp4');
  await renderMedia({composition, serveUrl, codec: 'h264', outputLocation: mp4, puppeteerInstance: browser, muted: true, imageFormat: 'png', crf: 20, inputProps, logLevel: 'warn'});
  written.push(mp4);
} finally {
  if (browser) await browser.close({silent: true});
  for (const dir of [bundleDir, publicDir, tmpMedia]) fs.rmSync(dir, {recursive: true, force: true});
}
console.log('wrote:\n' + written.map(f => '  ' + f).join('\n'));
