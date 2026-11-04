/**
 * Offline proof for personalised music (Phase 3). Local ffmpeg + local Python only: no Runware, no LLM, no network, no R2.
 *
 *   node --experimental-strip-types src/scripts/makePersonalizeProof.ts --write
 *
 * Three synthetic edits (15 s fast and punchy, 40 s normal pace, 90 s slow and calm). For each it writes, under out/fixtures/personalize/<name>/:
 *   source.mp4 + dialogue.wav (band-limited noise "speech" at about -20 LUFS, timed to the words), on.json and off.json (saved-blueprint envelopes),
 *   plan.json (the brief, the placement and the SFX snap counts, for the report).
 * The synthetic bed (known lift, real postprocess) goes to remotion/public/_proof-beds/<name>/ (gitignored) so a local render can fetch it.
 *
 * on.json  = what analyze saves with MUSIC_PERSONALIZE=1: the brief's tempo, placement fields, beat-snapped SFX.
 * off.json = MUSIC_PERSONALIZE=0 (Phase 2.4): the same bed audio, no placement, SFX unsnapped. Same duck envelope, same words, same source.
 * Both use the same pure functions analyze uses (buildMusicBrief, planPlacement, snapHitsToBeats, schedulePolishSfxHits). Importing this module does nothing.
 */

import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {schedulePolishSfxHits} from '../lib/polishSfx.ts';
import {buildBedLoudnessTrack} from '../stages/music/bedLoudness.ts';
import {buildDuckEnvelope, type DuckEnvelope} from '../stages/music/duckEnvelope.ts';
import {LOOP_THRESHOLD_SEC} from '../stages/music/loopBed.ts';
import {buildMusicBrief, type MusicBrief} from '../stages/music/musicBrief.ts';
import {planPlacement} from '../stages/music/personalize.ts';
import {withPlacement, type Placement} from '../stages/music/placement.ts';
import type {BedPlacementMeta} from '../stages/music/placementMeta.ts';
import {snapHitsToBeats} from '../stages/music/sfxBeatSnap.ts';
import type {AudioDesign, CaptionWord} from '../types/blueprint.ts';
import {buildProofBlueprint, type Burst} from './makeProofFixture.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const PERSONALIZE_DIR = path.join(REPO_ROOT, 'out', 'fixtures', 'personalize');
export const PROOF_BEDS_DIR = path.join(REPO_ROOT, 'remotion', 'public', '_proof-beds');
export const PROOF_TARGET_LUFS = -20;

export type Scenario = {
  name: string;
  durationSec: number;
  wpm: number;
  wordsPerPhrase: number;
  pauseSec: number;
  visualMood: string;
  contentType: string;
  /** Seconds between visual cuts (drives the intensity curve and the SFX hits). */
  cutEverySec: number;
};

export const SCENARIOS: Scenario[] = [
  {name: 'punchy-15s', durationSec: 15, wpm: 210, wordsPerPhrase: 7, pauseSec: 0.65, visualMood: 'bold_energetic', contentType: 'motivational', cutEverySec: 2.5},
  {name: 'normal-40s', durationSec: 40, wpm: 150, wordsPerPhrase: 9, pauseSec: 0.8, visualMood: 'clean_light', contentType: 'educational_tips', cutEverySec: 6},
  {name: 'calm-90s', durationSec: 90, wpm: 110, wordsPerPhrase: 10, pauseSec: 1.1, visualMood: 'calm_cool', contentType: 'tutorial', cutEverySec: 12},
];

const FILLER = ['this', 'is', 'a', 'proof', 'of', 'the', 'music', 'placed', 'under', 'voice', 'for', 'a', 'real', 'edit'];

/** Words at a given pace, in phrases separated by pauses. Pure and deterministic. */
export function buildScenarioWords(scenario: Scenario): {words: CaptionWord[]; bursts: Burst[]} {
  const per = 60 / scenario.wpm;
  const words: CaptionWord[] = [];
  const bursts: Burst[] = [];
  let t = 0.5;
  let phrase = 0;
  let k = 0;
  while (t + scenario.wordsPerPhrase * per < scenario.durationSec - 0.8) {
    const start = t;
    for (let i = 0; i < scenario.wordsPerPhrase; i += 1) {
      words.push({text: FILLER[k % FILLER.length]!, start: Number(t.toFixed(3)), end: Number((t + per * 0.9).toFixed(3)), sentenceIndex: phrase});
      t += per;
      k += 1;
    }
    bursts.push({start: Number(start.toFixed(3)), end: Number((t - per * 0.1).toFixed(3))});
    t += scenario.pauseSec;
    phrase += 1;
  }
  return {words, bursts};
}

export function cutTimesFor(scenario: Scenario): number[] {
  const out: number[] = [];
  for (let t = scenario.cutEverySec; t < scenario.durationSec - 1; t += scenario.cutEverySec) out.push(Number(t.toFixed(2)));
  return out;
}

export function assertWriteFlag(argv: string[]): void {
  if (!argv.includes('--write')) throw new Error('makePersonalizeProof refuses to run without --write (it writes under out/fixtures/personalize and remotion/public/_proof-beds).');
}

function ffmpeg(args: string[]): void {
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], {stdio: 'inherit'});
}

function pythonBin(): string {
  const venv = path.join(REPO_ROOT, 'agents', '.venv', 'bin', 'python');
  return process.env.PROOF_PYTHON ?? (existsSync(venv) ? venv : 'python3');
}

function measureVoLufs(wav: string, bursts: Burst[], dir: string): number {
  const intervals = path.join(dir, 'speech_intervals.json');
  writeFileSync(intervals, JSON.stringify(bursts.map(b => [b.start, b.end])));
  const out = execFileSync(pythonBin(), ['-m', 'music_specialist.vo_lufs', wav, intervals], {cwd: path.join(REPO_ROOT, 'agents'), encoding: 'utf8'});
  const value = (JSON.parse(out) as {vo_lufs: number | null}).vo_lufs;
  if (value === null || !Number.isFinite(value)) throw new Error('vo_lufs measurement returned null');
  return value;
}

function makeDialogue(wavPath: string, bursts: Burst[], durationSec: number, dir: string): number {
  const gate = bursts.map(b => `max(0,min(1,min((t-${b.start})/0.03,(${b.end}-t)/0.05)))`).join('+');
  const noise = (seed: number) => `anoisesrc=color=pink:seed=${seed}:sample_rate=48000:duration=${durationSec}`;
  const build = (gainDb: number, out: string) =>
    ffmpeg([
      '-f', 'lavfi', '-i', noise(11),
      '-f', 'lavfi', '-i', noise(29),
      '-filter_complex',
      `[0:a][1:a]amerge=inputs=2,highpass=f=300,lowpass=f=3400,volume='${gate}':eval=frame,volume=${gainDb}dB,alimiter=limit=0.95[a]`,
      '-map', '[a]', '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', out,
    ]);
  const trial = path.join(dir, 'dialogue_trial.wav');
  build(0, trial);
  build(Number((PROOF_TARGET_LUFS - measureVoLufs(trial, bursts, dir)).toFixed(2)), wavPath);
  return measureVoLufs(wavPath, bursts, dir);
}

type BedResult = {meta: BedPlacementMeta; files: {full: string; loop: string; carved: string}; measuredBpm: number | null};

/** The synthetic bed for one brief: its tempo, a lift near 12 s. The real postprocess measures downbeats, energy map and lift. */
function makeBed(name: string, brief: MusicBrief): BedResult {
  const barSec = (4 * 60) / brief.bpm;
  const liftBar = Math.max(2, Math.round(12 / barSec));
  const bars = Math.ceil(56 / barSec);
  const outDir = path.join(PROOF_BEDS_DIR, name);
  mkdirSync(outDir, {recursive: true});
  execFileSync(pythonBin(), ['-m', 'music_specialist.scripts.proof_bed', '--bpm', String(brief.bpm), '--lift-bar', String(liftBar), '--bars', String(bars), '--out-dir', outDir], {
    cwd: path.join(REPO_ROOT, 'agents'),
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const raw = JSON.parse(readFileSync(path.join(outDir, 'meta.json'), 'utf8')) as Record<string, any>;
  const meta: BedPlacementMeta = {
    downbeatTimes: raw.downbeat_times,
    energyMap: raw.energy_map,
    liftSec: raw.lift_sec ?? null,
    liftBar: raw.lift_bar ?? null,
    barSec: raw.bar_sec ?? null,
    fullDurationSec: raw.duration_sec,
    hasLoop: raw.loop_fallback === false,
    loopDurationSec: raw.loop_duration_sec ?? null,
    loopBars: raw.loop_bars ?? null,
    ...(Array.isArray(raw.loudness_map) && raw.loudness_map.length > 0 ? {loudnessMap: raw.loudness_map} : {}),
    ...(Array.isArray(raw.carved_loudness_map) && raw.carved_loudness_map.length > 0 ? {carvedLoudnessMap: raw.carved_loudness_map} : {}),
    ...(Array.isArray(raw.loop_loudness_map) && raw.loop_loudness_map.length > 0 ? {loopLoudnessMap: raw.loop_loudness_map} : {}),
    ...(typeof raw.loop_lufs === 'number' ? {loopLufs: raw.loop_lufs} : {}),
  };
  const url = (file: string) => `staticFile:_proof-beds/${name}/${file}`;
  return {meta, files: {full: url('bed_full.wav'), loop: url('bed_loop.wav'), carved: url('bed_carved.wav')}, measuredBpm: raw.measured_bpm ?? null};
}

export type ProofPlan = {
  name: string;
  brief: MusicBrief;
  voLufs: number;
  trueLiftSec: number;
  measuredLiftSec: number | null;
  placement: Omit<Placement, 'barLinesSec' | 'beatsSec'>;
  sfx: {scheduled: number; snapped: number; dropped: number; wordMaskDropped: number};
};

function writeScenario(scenario: Scenario): ProofPlan {
  const dir = path.join(PERSONALIZE_DIR, scenario.name);
  mkdirSync(dir, {recursive: true});
  const {words, bursts} = buildScenarioWords(scenario);
  const wav = path.join(dir, 'dialogue.wav');
  const mp4 = path.join(dir, 'source.mp4');
  const voLufs = Number(makeDialogue(wav, bursts, scenario.durationSec, dir).toFixed(2));
  ffmpeg([
    '-f', 'lavfi', '-i', `color=c=0x1d3557:s=1080x1920:r=30:d=${scenario.durationSec}`,
    '-i', wav,
    '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', mp4,
  ]);

  const videoId = `pz-${scenario.name}`;
  const cuts = cutTimesFor(scenario);
  // The brief exactly as runDirectorV2 builds it: sentence starts stand in for the cut rate.
  const early = buildMusicBrief({videoId, captionWords: words, durationSec: scenario.durationSec, visualMood: scenario.visualMood, contentType: scenario.contentType, cutCount: new Set(words.map(w => w.sentenceIndex)).size});
  const bed = makeBed(scenario.name, early);

  const onsets = words.map(word => word.start);
  const transitions = cuts.map((at, i) => ({at, keyword: i % 2 === 0 ? 'whip pan' : 'hard cut'}));
  const scheduled = schedulePolishSfxHits({transitions, wordOnsetsSec: onsets});
  const unmasked = schedulePolishSfxHits({transitions});

  const planned = planPlacement({
    videoId, words, durationSec: scenario.durationSec, visualMood: scenario.visualMood, contentType: scenario.contentType,
    cutTimesSec: cuts, zoomTimesSec: [], plateTimesSec: [], popTimesSec: [], bed: bed.meta,
  });
  const snapped = snapHitsToBeats(scheduled.hits, {beatsSec: planned.placement.beatsSec, barLinesSec: planned.placement.barLinesSec, wordOnsetsSec: onsets, durationSec: scenario.durationSec});

  const duck = buildDuckEnvelope({words, durationSec: scenario.durationSec, preset: 'talking', voLufs, bedLufs: -16});
  const baseAudio: AudioDesign = {
    musicSource: 'generated',
    musicUrl: bed.files.full,
    musicFullUrl: bed.files.full,
    musicLoopUrl: bed.files.loop,
    musicCarvedUrl: bed.files.carved,
    musicFullDurationSec: bed.meta.fullDurationSec ?? undefined,
    musicMood: planned.brief.style,
    ducking: true,
    voLufs,
    duck,
    sfx: [],
  };
  const common = {
    captionWords: words,
    words: words.map(({text, start, end}) => ({text, start, end})),
    transcript: words.map(word => word.text).join(' '),
    sourceDurationSec: scenario.durationSec,
    outputDurationSec: scenario.durationSec,
    keepSegments: [{sourceStart: 0, sourceEnd: scenario.durationSec, outputStart: 0}],
    hookDurationSec: 0,
  };
  const envelope = (mode: 'on' | 'off', audioDesign: AudioDesign) => {
    const base = buildProofBlueprint({sourcePath: mp4, voLufs, bursts, durationSec: scenario.durationSec});
    return {
      ...base,
      videoId: `${videoId}-${mode}`,
      blueprint: {...base.blueprint, ...common, blueprintId: `bp_pz_${scenario.name.replace(/-/g, '_')}_${mode}`, audioDesign},
    };
  };
  // Loudness-aware ducking, built the way analyzeVideo builds it: on = after placement; off = the bed plays from 0 with the legacy loop hand-off.
  const loudness = (startOffsetSec: number, loopFromSec: number | null): AudioDesign['duck'] => {
    const track = buildBedLoudnessTrack({bed: bed.meta, startOffsetSec, loopFromSec, durationSec: scenario.durationSec, duck, carved: true});
    return track ? {...duck, bedLoudness: track} : duck;
  };
  const legacyLoopFrom = scenario.durationSec > LOOP_THRESHOLD_SEC && bed.meta.hasLoop ? bed.meta.fullDurationSec : null;
  const onAudio: AudioDesign = {
    ...withPlacement({...baseAudio, hits: snapped.hits, duck: loudness(planned.placement.startOffsetSec, planned.placement.loopFromSec)}, planned.placement),
    musicProvenance: {
      source: 'generated', mood: planned.brief.style, costUsd: 0,
      brief: {style: planned.brief.style, family: planned.brief.family, bpm: planned.brief.bpm, key: planned.brief.key, speechWpm: planned.brief.speechWpm, arc: planned.brief.arc, energy: planned.brief.energy, hookAtSec: planned.brief.hookAtSec},
      bedStyle: planned.brief.style, bedMeasuredLiftSec: bed.meta.liftSec, liftAtVideoSec: planned.placement.liftAtVideoSec, startsOnDownbeat: planned.placement.startsOnDownbeat,
      placementReason: planned.placement.reason, sfxSnapped: snapped.stats.snapped, sfxDropped: snapped.stats.dropped,
    },
  };
  const offAudio: AudioDesign = {...baseAudio, hits: scheduled.hits, duck: loudness(0, legacyLoopFrom), musicProvenance: {source: 'generated', mood: planned.brief.family, costUsd: 0}};
  writeFileSync(path.join(dir, 'on.json'), `${JSON.stringify(envelope('on', onAudio), null, 2)}\n`);
  writeFileSync(path.join(dir, 'off.json'), `${JSON.stringify(envelope('off', offAudio), null, 2)}\n`);

  const {barLinesSec: _bars, beatsSec: _beats, ...placement} = planned.placement;
  const plan: ProofPlan = {
    name: scenario.name,
    brief: planned.brief,
    voLufs,
    trueLiftSec: Number((Math.max(2, Math.round(12 / ((4 * 60) / planned.brief.bpm))) * ((4 * 60) / planned.brief.bpm)).toFixed(2)),
    measuredLiftSec: bed.meta.liftSec,
    placement,
    sfx: {scheduled: scheduled.hits.length, snapped: snapped.stats.snapped, dropped: snapped.stats.dropped, wordMaskDropped: unmasked.hits.length - scheduled.hits.length},
  };
  writeFileSync(path.join(dir, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
  return plan;
}

function main(): void {
  assertWriteFlag(process.argv.slice(2));
  mkdirSync(PERSONALIZE_DIR, {recursive: true});
  for (const scenario of SCENARIOS) {
    const plan = writeScenario(scenario);
    console.log(`${plan.name}: ${plan.brief.style} ${plan.brief.bpm} bpm ${plan.brief.key} ${plan.brief.arc} (${plan.brief.speechWpm} wpm) | offset ${plan.placement.startOffsetSec}s lift@${plan.placement.liftAtVideoSec}s hook@${plan.brief.hookAtSec}s end ${plan.placement.endType}`);
  }
}

const invokedDirectly = (() => {
  const invoked = process.argv[1];
  return Boolean(invoked) && path.resolve(invoked!) === fileURLToPath(import.meta.url);
})();

if (invokedDirectly) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
