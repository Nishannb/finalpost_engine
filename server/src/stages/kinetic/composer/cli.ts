/**
 * Kinetic Composer corpus harness (P0 / P10). LOCAL ONLY: ffmpeg + local Remotion. No model call (the Director is not used: the deterministic direction), no network, no R2.
 *
 *   npx tsx server/src/stages/kinetic/composer/cli.ts <corpus.json> <outDir> [--render] [--only id,id] [--concurrency 4] [--no-baseline]
 *
 * corpus.json = {clips: [{id, video, words?: "<[{text,start,end}] json>", fixture?: "<eval fixture with captionWords + keepSegments>", box: {x,y,w,h} (source fractions), preset?: "<captionKit id>",
 *                trimSec?: number}]}
 * Writes per clip: <id>.composer.json (spec + zooms + report), <id>.baseline.json (Kinetic V2 fallback-plan spec), and summary.json / summary.md (variety metrics, old vs new, pairwise sameness).
 * --render: <id>.composer.mp4 (+ <id>.baseline.mp4) through remotion/scripts/kinetic/render.mjs (KineticEdit with the edit's zooms).
 * --matte: the engine's own RVM matte stage (pipeline/kineticMatteStage.ts prepareKineticMatte, local RVM: RVM_PYTHON / RVM_WEIGHTS_PATH / RVM_DEVICE) runs on each plate; the composer gets the matte
 *          (behind-the-speaker words) and the render layers the person foreground (source RGB + RVM alpha) over the behind text, exactly like production's subjectForeground.
 */
import {execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync, existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {resolveKineticIdentity} from '../../../lib/kineticIdentity.ts';
import {plateFromRgb} from '../plate.ts';
import {buildProductionKinetic} from '../productionStage.ts';
import type {RenderSpec} from '../schema.ts';
import {composeKinetic} from './composeKinetic.ts';
import {isPartId} from './slant.ts';
import {measureVariety, sameness, type VarietyMetrics} from './metrics.ts';

type Clip = {id: string; video: string; words?: string; fixture?: string; box: {x: number; y: number; w: number; h: number}; preset?: string; trimSec?: number};
const here = path.dirname(fileURLToPath(import.meta.url));
const REMOTION = path.resolve(here, '../../../../../remotion');
const FPS = 30, W = 1080, H = 1920;

function probe(video: string): {w: number; h: number; dur: number} {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', video], {encoding: 'utf8'});
  const j = JSON.parse(out) as {streams: Array<{width: number; height: number}>; format: {duration: string}};
  return {w: j.streams[0]!.width, h: j.streams[0]!.height, dur: Number(j.format.duration)};
}

function plateStats(video: string, atSec: number, tmp: string): {luminance: number; color: string; grid: Uint8Array} | undefined {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(atSec), '-i', video, '-frames:v', '1', '-vf', 'scale=16:16:flags=area,format=rgb24', '-f', 'rawvideo', tmp]);
  const grid = new Uint8Array(readFileSync(tmp));
  const p = plateFromRgb(grid);
  return p ? {...p, grid} : undefined;
}

/** the output-timeline plate: keep segments cut + concatenated (a single full segment = the source, trimmed) */
function makePlate(clip: Clip, keep: Array<{sourceStart: number; sourceEnd: number}> | null, outDir: string, durationSec: number): string {
  const out = path.join(outDir, `${clip.id}.plate.mp4`);
  if (existsSync(out)) return out;
  if (keep && keep.length > 1) {
    const parts = keep.map((k, i) => `[0:v]trim=${k.sourceStart}:${k.sourceEnd},setpts=PTS-STARTPTS[v${i}];[0:a]atrim=${k.sourceStart}:${k.sourceEnd},asetpts=PTS-STARTPTS[a${i}]`).join(';');
    const cat = keep.map((_, i) => `[v${i}][a${i}]`).join('') + `concat=n=${keep.length}:v=1:a=1[v][a]`;
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', clip.video, '-filter_complex', `${parts};${cat}`, '-map', '[v]', '-map', '[a]', '-r', String(FPS), '-c:v', 'libx264', '-crf', '20', '-preset', 'veryfast', '-c:a', 'aac', out]);
  } else {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', clip.video, '-t', String(durationSec), '-r', String(FPS), '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`, '-c:v', 'libx264', '-crf', '20', '-preset', 'veryfast', '-c:a', 'aac', out]);
  }
  return out;
}

const fmt = (m: VarietyMetrics) => `score ${m.varietyScore} | designed ${(m.designedShare * 100).toFixed(0)}% | caption-only ${(m.captionLikeShare * 100).toFixed(0)}% | distinct ${m.distinct} (${m.per30s.toFixed(1)}/30s) | max share ${(m.maxShare * 100).toFixed(0)}% | repeats ${m.repeats} | zones ${m.zoneEntropy.toFixed(2)} | scale x${m.scaleContrast.toFixed(1)} | motions ${m.motionDistinct} | torso ${(m.torsoOverlap * 100).toFixed(0)}% | scene ${m.sceneElements}`;

async function main(): Promise<void> {
  const [corpusPath, outArg] = process.argv.slice(2);
  const outDir = outArg ? path.resolve(outArg) : '';
  if (!corpusPath || !outDir) throw new Error('usage: cli.ts <corpus.json> <outDir> [--render] [--only a,b] [--concurrency n] [--no-baseline]');
  const flag = (n: string) => process.argv.includes(n);
  const opt = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
  const only = opt('--only')?.split(',');
  const concurrency = Number(opt('--concurrency') ?? 4);
  mkdirSync(outDir, {recursive: true});
  const corpus = JSON.parse(readFileSync(corpusPath, 'utf8')) as {clips: Clip[]};
  const rows: Array<{id: string; composer: VarietyMetrics | null; baseline: VarietyMetrics | null; spec: RenderSpec | null; base: RenderSpec | null; tone: string; failure?: string}> = [];
  const renderJob: {extraPublic: Array<{from: string; to: string}>; videos: Array<Record<string, unknown>>} = {extraPublic: [], videos: []};
  for (const clip of corpus.clips) {
    if (only && !only.includes(clip.id)) continue;
    const src = probe(clip.video);
    let words: Array<{text: string; start: number; end: number}>;
    let keep: Array<{sourceStart: number; sourceEnd: number}> | null = null;
    let durationSec: number;
    if (clip.fixture) {
      const fx = JSON.parse(readFileSync(clip.fixture, 'utf8')) as {captionWords: Array<{text: string; start: number; end: number}>; keepSegments: Array<{sourceStart: number; sourceEnd: number}>; outputDurationSec: number};
      words = fx.captionWords; keep = fx.keepSegments; durationSec = fx.outputDurationSec;
    } else {
      words = JSON.parse(readFileSync(clip.words!, 'utf8'));
      durationSec = Math.min(src.dur, clip.trimSec ?? src.dur);
      words = words.filter(w => w.end <= durationSec);
    }
    const plate = makePlate(clip, keep, outDir, durationSec);
    const stats = plateStats(plate, Math.min(5, durationSec / 3), path.join(outDir, `${clip.id}.grid.rgb`));
    const warnings: string[] = [];
    const identity = clip.preset ? resolveKineticIdentity(clip.preset, warnings) : undefined;
    const speaker = {box: clip.box, source: 'vision' as const, srcW: W, srcH: H, objectPosition: {x: 0.5, y: 0.42}};
    // --matte: RVM on the output-timeline plate (one segment), through the production matte stage
    let matte: {grid: import('../scene.ts').AlphaGrid; alphaAreaFrac: number} | undefined;
    let foreground: string | undefined;
    if (flag('--matte')) {
      const {prepareKineticMatte} = await import('../../../pipeline/kineticMatteStage.ts');
      const pp = probe(plate);
      const m = await prepareKineticMatte({sourcePath: plate, workDir: path.join(outDir, `matte-${clip.id}`), keepSegments: [{sourceStart: 0, sourceEnd: Math.max(0, durationSec - 2 / FPS), outputStart: 0}], fps: FPS, outW: W, outH: H, srcW: pp.w, srcH: pp.h,
        objectPosition: {x: 0.5, y: 0.42}, zoomTriggers: [], zoomEnabled: true, durationFrames: Math.ceil(durationSec * FPS), maxDurationSec: 120});
      console.log(`  matte ${clip.id}: ${m.ok ? `ok area=${m.report.alphaAreaFrac} ${Math.round(m.report.totalMs / 1000)}s device=${m.report.device ?? '-'}` : `FAILED ${m.reason}`}`);
      if (m.ok) { matte = m.matte; foreground = m.foregroundPath; }
    }
    const composed = await composeKinetic({captionWords: words, fps: FPS, width: W, height: H, durationSec, speaker, zoomTriggers: [], zoomEnabled: true, ...(stats ? {plate: stats} : {}), ...(identity ? {identity} : {}), director: null, ...(matte ? {matte} : {})});
    writeFileSync(path.join(outDir, `${clip.id}.composer.json`), JSON.stringify({spec: composed.spec, zoomTriggers: composed.zoomTriggers, report: composed.report}, null, 1));
    let base: RenderSpec | null = null;
    if (!flag('--no-baseline')) {
      const b = await buildProductionKinetic({captionWords: words, fps: FPS, width: W, height: H, durationSec, speaker, zoomTriggers: [], zoomEnabled: true, ...(stats ? {plate: {luminance: stats.luminance, color: stats.color}} : {}), ...(identity ? {identity} : {}), director: null,
        policy: {allowThreeD: false, coverAllWords: true, directorSolver: 'phase3', motionVariety: true, keepSwallowingMatchCuts: true}});
      base = b.spec;
      writeFileSync(path.join(outDir, `${clip.id}.baseline.json`), JSON.stringify({spec: b.spec, report: {ok: b.report.ok, failure: b.report.failure, planSource: b.report.planSource}}, null, 1));
    }
    const speech = {startFrame: Math.round(words[0]!.start * FPS), endFrame: Math.round(words[words.length - 1]!.end * FPS)};
    const scene = composed.debug?.scene;
    const cm = composed.spec ? measureVariety(composed.spec, scene, speech) : null;
    const bm = base ? measureVariety(base, scene, speech) : null;
    rows.push({id: clip.id, composer: cm, baseline: bm, spec: composed.spec, base, tone: composed.report.direction.tone, ...(composed.report.failure ? {failure: composed.report.failure} : {})});
    if (composed.report.motion) console.log(`  motion ${JSON.stringify(composed.report.motion)}`);
    console.log(`\n== ${clip.id} (${composed.report.direction.tone}, ${composed.report.beats.length} beats, zooms +${composed.report.zooms.added}, match cut ${composed.report.matchCut.kept}, repairs ${composed.report.repairs}, drawn ${composed.report.coverage.drawn}/${composed.report.coverage.words})${composed.report.failure ? ' FAILED ' + composed.report.failure : ''}`);
    if (cm) console.log(`  composer: ${fmt(cm)}`);
    if (bm) console.log(`  baseline: ${fmt(bm)}`);
    for (const b of composed.report.beats) console.log(`    ${b.composition.padEnd(15)} ${b.text.slice(0, 120)}`);
    if (flag('--stills') && composed.spec) {
      const pub = `composer-review/${clip.id}.plate.mp4`;
      if (!renderJob.extraPublic.some(e => e.to === pub)) renderJob.extraPublic.push({from: plate, to: pub});
      const stills = ((renderJob as unknown as {stills?: unknown[]}).stills ??= []);
      const fgS = foreground && composed.report.motion?.behind ? `composer-review/${clip.id}.fg.webm` : null;
      if (fgS && !renderJob.extraPublic.some(e => e.to === fgS)) renderJob.extraPublic.push({from: foreground!, to: fgS});
      const props = {spec: composed.spec, videoSrc: `staticFile:${pub}`, zoomTriggers: composed.zoomTriggers, ...(fgS ? {matteSrc: `staticFile:${fgS}`} : {})};
      const tag = (e: RenderSpec['events'][number]) => `${e.composition ?? 'matchCut'}${Math.abs(e.keyframes[0]?.rotateY ?? 0) >= 12 ? `_slant${Math.round(e.keyframes[0]!.rotateY)}` : ''}${e.layering === 'behind' ? '_behind' : ''}`;
      // one settled still per designed beat (a backed `.b` event belongs to its beat's still)
      const designed = composed.spec.events.filter(x => (x.composition && x.composition !== 'captionLane' && !isPartId(x.id)) || x.presetResolved === 'type.matchCut');
      for (const e of designed) {
        const f = Math.min(e.outFrame - 3, Math.round(e.inFrame + (e.outFrame - e.inFrame) * 0.72));
        stills.push({id: 'KineticEdit', frame: f, out: path.resolve(outDir, 'proof', clip.id, `${String(f).padStart(5, '0')}-${tag(e)}.png`), props});
      }
      // motion proof: two side entries (left / right) caught mid-entry
      for (const d of ['-1', '1']) {
        const e = designed.find(x => x.notes.includes(`dir:${d}`) && x.lines.some(l => l.anim === 'E3' || l.anim === 'IN-3'));
        if (!e) continue;
        const l = e.lines.find(x => x.anim === 'E3' || x.anim === 'IN-3')!;
        const f = e.inFrame + l.enterFrame + 3;
        stills.push({id: 'KineticEdit', frame: f, out: path.resolve(outDir, 'proof', clip.id, `${String(f).padStart(5, '0')}-entry-from-${d === '-1' ? 'left' : 'right'}-${tag(e)}.png`), props});
      }
    }
    if (flag('--render') && composed.spec) {
      const pub = `composer-review/${clip.id}.plate.mp4`;
      renderJob.extraPublic.push({from: plate, to: pub});
      const fgPub = foreground && composed.report.motion?.behind ? `composer-review/${clip.id}.fg.webm` : null;
      if (fgPub) renderJob.extraPublic.push({from: foreground!, to: fgPub});
      renderJob.videos.push({id: 'KineticEdit', out: path.resolve(outDir, `${clip.id}.composer.mp4`), props: {spec: composed.spec, videoSrc: `staticFile:${pub}`, zoomTriggers: composed.zoomTriggers, ...(fgPub ? {matteSrc: `staticFile:${fgPub}`} : {})}, crf: 22, concurrency});
      if (base && flag('--render-baseline')) renderJob.videos.push({id: 'KineticEdit', out: path.resolve(outDir, `${clip.id}.baseline.mp4`), props: {spec: base, videoSrc: `staticFile:${pub}`}, crf: 22, concurrency});
    }
  }
  // pairwise sameness (composer vs composer, baseline vs baseline)
  const pair = (pick: (r: (typeof rows)[number]) => RenderSpec | null) => {
    const xs = rows.map(pick).filter((s): s is RenderSpec => Boolean(s));
    const vals: number[] = [];
    for (let i = 0; i < xs.length; i += 1) for (let j = i + 1; j < xs.length; j += 1) vals.push(sameness(xs[i]!, xs[j]!));
    return vals.length ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 1000) / 1000 : null;
  };
  const summary = {clips: rows.map(r => ({id: r.id, tone: r.tone, composer: r.composer, baseline: r.baseline, failure: r.failure})), samenessComposer: pair(r => r.spec), samenessBaseline: pair(r => r.base)};
  writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 1));
  const md = [`# Kinetic Composer corpus`, '', `| clip | tone | engine | score | designed | caption-only | distinct (/30s) | max share | repeats | zone spread | scale | motions | torso | scene |`, '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows.flatMap(r => [r.composer, r.baseline].map((m, k) => m ? `| ${r.id} | ${r.tone} | ${k ? 'V2 baseline' : 'composer'} | ${m.varietyScore} | ${(m.designedShare * 100).toFixed(0)}% | ${(m.captionLikeShare * 100).toFixed(0)}% | ${m.distinct} (${m.per30s.toFixed(1)}) | ${(m.maxShare * 100).toFixed(0)}% | ${m.repeats} | ${m.zoneEntropy.toFixed(2)} | x${m.scaleContrast.toFixed(1)} | ${m.motionDistinct} | ${(m.torsoOverlap * 100).toFixed(0)}% | ${m.sceneElements} |` : `| ${r.id} | ${r.tone} | ${k ? 'V2 baseline' : 'composer'} | ${k && flag('--no-baseline') ? 'skipped' : `FAILED ${r.failure ?? ''}`} |||||||||||`)),
    '', `Mean pairwise sameness (0 = nothing in common, 1 = identical mix): composer ${summary.samenessComposer}, V2 baseline ${summary.samenessBaseline}`].join('\n');
  writeFileSync(path.join(outDir, 'summary.md'), md);
  console.log('\n' + md);
  if ((flag('--render') && renderJob.videos.length) || flag('--stills')) {
    const jobPath = path.join(outDir, 'render-job.json');
    writeFileSync(jobPath, JSON.stringify(renderJob));
    execFileSync('node', [path.join(REMOTION, 'scripts/kinetic/render.mjs'), jobPath], {cwd: REMOTION, stdio: 'inherit'});
  }
}

main().catch(err => { console.error(err); process.exit(1); });
