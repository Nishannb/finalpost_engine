/**
 * Synthetic proof fixture for `npm run render-blueprint`. Local ffmpeg + local Python (pyloudnorm) only.
 *
 *   node --experimental-strip-types src/scripts/makeProofFixture.ts --write
 *
 * Writes out/fixtures/proof/{dialogue.wav, source.mp4, vo_lufs.txt, blueprint.json}.
 * Refuses without --write. Importing this module does nothing. No network, no upload, no paid API.
 */

import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {buildDuckEnvelope} from '../stages/music/duckEnvelope.ts';
import type {CaptionWord, TimelineBlueprint} from '../types/blueprint.ts';

export const PROOF_DURATION_SEC = 12;
export const PROOF_BED_BASE = 'https://media.kinmel.shop/music/beds/108abbca07e0c08d977649dbd1d1d842c072e564986b495f627caf07bfb55a53';
export const PROOF_TARGET_LUFS = -20;
export const PROOF_VIDEO_ID = 'proof-synth-0001';

export type Burst = {start: number; end: number};

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const PROOF_DIR = path.join(REPO_ROOT, 'out', 'fixtures', 'proof');

/** Deterministic speech-like bursts: 0.8–1.4 s on, 0.6–1.0 s off. Starts at 0.5 s, stops before durationSec. */
export function buildBursts(durationSec = PROOF_DURATION_SEC): Burst[] {
  const ons = [1.1, 0.9, 1.4, 0.8, 1.2, 1.0, 1.3];
  const offs = [0.8, 0.6, 1.0, 0.7, 0.9, 0.6, 1.0];
  const bursts: Burst[] = [];
  let t = 0.5;
  for (let i = 0; i < ons.length; i += 1) {
    const end = t + ons[i]!;
    if (end > durationSec - 0.3) break;
    bursts.push({start: Number(t.toFixed(3)), end: Number(end.toFixed(3))});
    t = end + offs[i]!;
  }
  return bursts;
}

const FILLER = ['this', 'is', 'a', 'proof', 'of', 'the', 'music', 'mix', 'under', 'voice', 'for', 'ducking', 'tests'];

/** 3–4 filler words per burst, evenly split with 40 ms gaps so a burst merges into one duck phrase. */
export function buildCaptionWords(bursts: Burst[]): CaptionWord[] {
  const words: CaptionWord[] = [];
  let k = 0;
  bursts.forEach((burst, sentenceIndex) => {
    const n = 3 + (sentenceIndex % 2);
    const slot = (burst.end - burst.start) / n;
    for (let i = 0; i < n; i += 1) {
      words.push({
        text: FILLER[k % FILLER.length]!,
        start: Number((burst.start + i * slot).toFixed(3)),
        end: Number((burst.start + (i + 1) * slot - 0.04).toFixed(3)),
        sentenceIndex,
      });
      k += 1;
    }
  });
  return words;
}

export function assertWriteFlag(argv: string[]): void {
  if (!argv.includes('--write')) throw new Error('makeProofFixture refuses to run without --write (it writes files under out/fixtures/proof).');
}

export type ProofBlueprintInput = {
  sourcePath: string;
  voLufs: number;
  bursts?: Burst[];
  durationSec?: number;
  savedAt?: string;
};

/** Pure: the SavedBlueprintEnvelope for the proof render. */
export function buildProofBlueprint(input: ProofBlueprintInput) {
  const durationSec = input.durationSec ?? PROOF_DURATION_SEC;
  const captionWords = buildCaptionWords(input.bursts ?? buildBursts(durationSec));
  const duck = buildDuckEnvelope({words: captionWords, durationSec, preset: 'talking', voLufs: input.voLufs, bedLufs: -16});
  const blueprint: TimelineBlueprint = {
    schemaVersion: 1,
    blueprintId: 'bp_proofsynth0001',
    createdAt: input.savedAt ?? new Date().toISOString(),
    videoUrl: input.sourcePath,
    languageCode: 'en',
    detectedLanguage: 'English',
    fps: 30,
    width: 1080,
    height: 1920,
    sourceDurationSec: durationSec,
    outputDurationSec: durationSec,
    words: captionWords.map(({text, start, end}) => ({text, start, end})),
    captionWords,
    transcript: captionWords.map(word => word.text).join(' '),
    trimExclusions: [],
    keepSegments: [{sourceStart: 0, sourceEnd: durationSec, outputStart: 0}],
    zoomTriggers: [],
    brollClips: [],
    depthOverlays: [],
    insetReveals: [],
    hookTitle: '',
    hookSubtitle: '',
    hookDurationSec: 0,
    hookStartSec: 0,
    hookStyle: 'impact',
    hookAnchor: 'top_left',
    visualOverlays: [],
    transitions: [],
    motionGraphics: [],
    mediaContainers: [],
    frameInsets: [],
    semanticEmphasis: [],
    generatedGraphics: [],
    captionDirection: {
      position: 'bottom',
      bottomFrac: 0.2,
      textColor: '#EAF2F8',
      highlightColor: '#00E5FF',
      boxColor: null,
      template: 'editorial-emphasis',
      animation: 'highlight',
      fontScale: 1.05,
    },
    colorGradeLut: '',
    suggestedLutIds: [],
    preferredLutId: '',
    editThesis: '',
    audioDesign: {
      musicSource: 'generated',
      musicUrl: `${PROOF_BED_BASE}/bed_full.wav`,
      musicFullUrl: `${PROOF_BED_BASE}/bed_full.wav`,
      musicLoopUrl: `${PROOF_BED_BASE}/bed_loop.wav`,
      musicCarvedUrl: `${PROOF_BED_BASE}/bed_carved.wav`,
      musicFullDurationSec: 56.68,
      musicMood: 'high-energy',
      ducking: true,
      voLufs: input.voLufs,
      duck,
      sfx: [],
    },
  } as unknown as TimelineBlueprint;
  return {
    videoId: PROOF_VIDEO_ID,
    sourceVideoPath: input.sourcePath,
    voLufs: input.voLufs,
    savedAt: input.savedAt ?? new Date().toISOString(),
    blueprint,
  };
}

function ffmpeg(args: string[]): void {
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], {stdio: 'inherit'});
}

function measureVoLufs(wav: string, bursts: Burst[]): number {
  const intervals = path.join(PROOF_DIR, 'speech_intervals.json');
  writeFileSync(intervals, JSON.stringify(bursts.map(b => [b.start, b.end])));
  const venvPython = path.join(REPO_ROOT, 'agents', '.venv', 'bin', 'python');
  const python = process.env.PROOF_PYTHON ?? (existsSync(venvPython) ? venvPython : 'python3');
  const out = execFileSync(python, ['-m', 'music_specialist.vo_lufs', wav, intervals], {
    cwd: path.join(REPO_ROOT, 'agents'),
    encoding: 'utf8',
  });
  const value = (JSON.parse(out) as {vo_lufs: number | null}).vo_lufs;
  if (value === null || !Number.isFinite(value)) throw new Error('vo_lufs measurement returned null');
  return value;
}

function makeDialogue(wavPath: string, bursts: Burst[]): number {
  const gate = bursts.map(b => `max(0,min(1,min((t-${b.start})/0.03,(${b.end}-t)/0.05)))`).join('+');
  const noise = (seed: number) => `anoisesrc=color=pink:seed=${seed}:sample_rate=48000:duration=${PROOF_DURATION_SEC}`;
  const build = (gainDb: number, out: string) =>
    ffmpeg([
      '-f', 'lavfi', '-i', noise(11),
      '-f', 'lavfi', '-i', noise(29),
      '-filter_complex',
      `[0:a][1:a]amerge=inputs=2,highpass=f=300,lowpass=f=3400,volume='${gate}':eval=frame,volume=${gainDb}dB,alimiter=limit=0.95[a]`,
      '-map', '[a]', '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', out,
    ]);
  const trial = path.join(PROOF_DIR, 'dialogue_trial.wav');
  build(0, trial);
  const gain = PROOF_TARGET_LUFS - measureVoLufs(trial, bursts);
  build(Number(gain.toFixed(2)), wavPath);
  return measureVoLufs(wavPath, bursts);
}

function main(): void {
  assertWriteFlag(process.argv.slice(2));
  mkdirSync(PROOF_DIR, {recursive: true});
  const bursts = buildBursts();
  const wav = path.join(PROOF_DIR, 'dialogue.wav');
  const mp4 = path.join(PROOF_DIR, 'source.mp4');

  const voLufs = Number(makeDialogue(wav, bursts).toFixed(2));
  // Solid-colour 1080x1920 @30 fps with the synthetic dialogue as its audio.
  ffmpeg([
    '-f', 'lavfi', '-i', `color=c=0x1d3557:s=1080x1920:r=30:d=${PROOF_DURATION_SEC}`,
    '-i', wav,
    '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', mp4,
  ]);
  writeFileSync(path.join(PROOF_DIR, 'vo_lufs.txt'), `${voLufs}\n`);
  writeFileSync(path.join(PROOF_DIR, 'blueprint.json'), `${JSON.stringify(buildProofBlueprint({sourcePath: mp4, voLufs}), null, 2)}\n`);
  console.log(`speech-gated vo_lufs=${voLufs}\nfixture: ${PROOF_DIR}`);
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
