/**
 * Verdict of ONE AI-directed experiment run. `success` means every requirement below holds; anything else is `failed` with a coded reason. A run that
 * threw, a missing or malformed MP4, a deterministic substitute, a missing opening or an unreconciled ledger can never be reported as a successful
 * AI-directed edit. Pure except for `inspectOutput` (stat + ffprobe of the local file).
 */

import {spawn} from 'node:child_process';
import {stat} from 'node:fs/promises';

import {env} from '../config/env.ts';
import {probeMedia} from '../media/ffmpeg.ts';

/** Result of decoding every video and audio packet of the file (no output is written). `ok` only when the decoder reported nothing and enough frames came out. */
export type DecodeFacts = {ok: boolean; videoFrames: number; decodedSec: number; errors: string[]};

export type OutputFacts = {path: string; exists: boolean; bytes: number; probe?: {width: number; height: number; durationSec: number; fps: number; hasAudio: boolean}; probeError?: string; decode?: DecodeFacts};

/** Decoded video frames must reach this fraction of duration x fps; a silently short decode (truncated data, dropped tail) fails even with no decoder message. */
const MIN_DECODED_FRACTION = 0.98;

/**
 * Decode the WHOLE file (all video and audio streams) to the null muxer. Header metadata proves nothing about the data: a truncated MP4 with an intact
 * `moov` probes as full length. Any decoder message at `-v error`, a non-zero exit, a timeout, or too few decoded frames makes `ok` false. Writes no file.
 */
export function decodeFully(filePath: string, expected: {durationSec: number; fps: number}, timeoutMs = 10 * 60_000): Promise<DecodeFacts> {
  return new Promise(resolve => {
    const child = spawn(env.FFMPEG_PATH, ['-nostdin', '-v', 'error', '-nostats', '-progress', 'pipe:1', '-i', filePath, '-map', '0:v', '-map', '0:a?', '-f', 'null', '-'], {stdio: ['ignore', 'pipe', 'pipe']});
    let progress = '';
    let stderr = '';
    let settled = false;
    const finish = (facts: DecodeFacts) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(facts);
      }
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ok: false, videoFrames: 0, decodedSec: 0, errors: [`decode timed out after ${timeoutMs} ms`]});
    }, timeoutMs);
    child.stdout.on('data', chunk => (progress = (progress + String(chunk)).slice(-4000)));
    child.stderr.on('data', chunk => (stderr = (stderr + String(chunk)).slice(0, 8000)));
    child.on('error', error => finish({ok: false, videoFrames: 0, decodedSec: 0, errors: [`could not start ffmpeg: ${error.message}`]}));
    child.on('close', code => {
      const last = (key: string) => [...progress.matchAll(new RegExp(`^${key}=(\\d+)`, 'gm'))].map(match => Number(match[1])).pop() ?? 0;
      const videoFrames = last('frame');
      const decodedSec = last('out_time_us') / 1e6;
      const errors = stderr.split('\n').map(line => line.trim()).filter(Boolean).slice(0, 5);
      if (code !== 0) errors.push(`ffmpeg exited with code ${code}`);
      const needed = Math.floor(expected.durationSec * expected.fps * MIN_DECODED_FRACTION);
      if (videoFrames < needed) errors.push(`decoded ${videoFrames} video frames, expected at least ${needed}`);
      finish({ok: errors.length === 0, videoFrames, decodedSec, errors});
    });
  });
}

/** Below this a file cannot be a rendered video. */
export const MIN_BYTES = 10_000;

export async function inspectOutput(filePath: string): Promise<OutputFacts> {
  let bytes = 0;
  try {
    bytes = (await stat(filePath)).size;
  } catch {
    return {path: filePath, exists: false, bytes: 0};
  }
  try {
    const probe = await probeMedia(filePath);
    // Header facts are not enough: decode every packet. Skipped for a file too small to be a video (the verdict already fails it as output_empty).
    const decode = bytes < MIN_BYTES ? undefined : await decodeFully(filePath, {durationSec: probe.durationSec, fps: probe.fps || 30});
    return {path: filePath, exists: true, bytes, probe, ...(decode ? {decode} : {})};
  } catch (error) {
    return {path: filePath, exists: true, bytes, probeError: error instanceof Error ? error.message.slice(0, 200) : String(error)};
  }
}

export type VerdictFailure = {code: string; detail: string};

export type VerdictInput = {
  /** Set when analyzeVideo or the render threw. */
  pipelineError?: {name?: string; message: string; code?: string};
  blueprint?: {
    width: number;
    height: number;
    outputDurationSec: number;
    stats?: {warnings?: string[]};
    zoomTriggers?: unknown[];
    motionGraphics?: unknown[];
    semanticEmphasis?: unknown[];
    frameInsets?: unknown[];
    insetReveals?: unknown[];
    generatedGraphics?: unknown[];
    visualOverlays?: Array<{layout?: string}>;
    hookTitle?: string;
    openingTreatment?: unknown;
  };
  /** `director/06-edit-ledger.json` and `07-edit-outcomes.json` as dumped by the run. */
  ledger?: {edits: Array<{type: string; final: unknown}>; summary: {outcomes: Record<string, number>}};
  outcomes?: {fallbackSubstitutions?: string[]; directorFallbackReason?: string | null};
  output?: OutputFacts;
  spend?: {geminiUsd: number; geminiCapUsd: number; billingStop: string | null; refused: Array<{reason?: string; host: string}>};
  claudeSpentUsd?: number;
  claudeCapUsd?: number;
  /** The source had an audio track (the render must keep it). */
  expectAudio?: boolean;
};

const WARNING_FAILURES: Array<[RegExp, string]> = [
  [/^director_fallback$/, 'director_fallback'],
  [/^motion_director_failed$/, 'motion_director_failed'],
  [/^motion_dropped:/, 'motion_graphic_dropped'],
  [/^strict_degraded:/, 'strict_degraded_graphic'],
  [/^opening_rejected:/, 'opening_rejected'],
];

const LOCKUP_LAYOUTS: ReadonlySet<string> = new Set(['lockup', 'chip', 'banner', 'stat']);

/** Ledger type -> how many of that edit the blueprint actually carries. */
const BLUEPRINT_COUNTS: Array<[string, (b: NonNullable<VerdictInput['blueprint']>) => number]> = [
  ['zoom', b => b.zoomTriggers?.length ?? 0],
  ['kinetic_text', b => b.motionGraphics?.length ?? 0],
  ['emphasis', b => b.semanticEmphasis?.length ?? 0],
  ['frame_inset', b => b.frameInsets?.length ?? 0],
  ['inset_reveal', b => b.insetReveals?.length ?? 0],
  ['generated_graphic', b => b.generatedGraphics?.length ?? 0],
  // Ledger type `lockup` covers every text overlay layout (see momentEditType in stages/broll/planLedger.ts): lockup, chip, banner and stat.
  ['lockup', b => (b.visualOverlays ?? []).filter(item => LOCKUP_LAYOUTS.has(String(item.layout))).length],
];

export function judgeExperiment(input: VerdictInput): {status: 'success' | 'failed'; failures: VerdictFailure[]} {
  const failures: VerdictFailure[] = [];
  const fail = (code: string, detail: string) => failures.push({code, detail});

  if (input.pipelineError) {
    fail('pipeline_error', `${input.pipelineError.code ?? input.pipelineError.name ?? 'error'}: ${input.pipelineError.message.slice(0, 300)}`);
  }
  const warnings = input.blueprint?.stats?.warnings ?? [];
  if (input.blueprint) {
    if (!warnings.some(item => item.startsWith('director_video_input:'))) fail('video_input_missing', 'the whole-video input to the Director is not recorded in the blueprint');
    if (!warnings.some(item => item.startsWith('opening_treatment:'))) {
      fail('opening_missing', warnings.find(item => item.startsWith('opening_rejected:')) ?? 'no opening treatment was delivered from the Director plan');
    }
    for (const warning of warnings) {
      for (const [pattern, code] of WARNING_FAILURES) {
        if (pattern.test(warning) && !(code === 'opening_rejected')) fail(code, warning);
      }
    }
  }
  if (input.outcomes?.directorFallbackReason) fail('director_fallback', input.outcomes.directorFallbackReason);
  if (input.outcomes?.fallbackSubstitutions?.length) fail('deterministic_substitution', `parts supplied by the deterministic fallback, not the Director: ${input.outcomes.fallbackSubstitutions.join(', ')}`);

  if (input.ledger && input.blueprint) {
    if ((input.ledger.summary.outcomes.accepted_not_rendered ?? 0) > 0) fail('ledger_unreconciled', `${input.ledger.summary.outcomes.accepted_not_rendered} edit(s) accepted but not handed to the renderer`);
    for (const [type, count] of BLUEPRINT_COUNTS) {
      const surviving = input.ledger.edits.filter(edit => edit.type === type && edit.final !== null).length;
      const actual = count(input.blueprint);
      if (surviving !== actual) fail('ledger_unreconciled', `${type}: ledger has ${surviving} surviving, blueprint has ${actual}`);
    }
  } else if (!input.pipelineError) {
    fail('ledger_unreconciled', 'no ledger or blueprint to reconcile');
  }

  const output = input.output;
  if (!output) {
    fail('output_missing', 'no render was attempted or recorded');
  } else if (!output.exists) {
    fail('output_missing', `no file at ${output.path}`);
  } else if (output.bytes < MIN_BYTES) {
    fail('output_empty', `${output.bytes} bytes`);
  } else if (!output.probe) {
    fail('output_unreadable', output.probeError ?? 'ffprobe failed');
  } else if (input.blueprint) {
    const {probe} = output;
    if (probe.width !== input.blueprint.width || probe.height !== input.blueprint.height) fail('dimensions_mismatch', `${probe.width}x${probe.height}, expected ${input.blueprint.width}x${input.blueprint.height}`);
    const tolerance = Math.max(0.25, 3 / (probe.fps || 30));
    if (Math.abs(probe.durationSec - input.blueprint.outputDurationSec) > tolerance) fail('duration_mismatch', `${probe.durationSec.toFixed(2)} s, expected ${input.blueprint.outputDurationSec.toFixed(2)} s (±${tolerance.toFixed(2)})`);
    if (input.expectAudio && !probe.hasAudio) fail('audio_missing', 'the render has no audio stream');
    // Success requires PROOF that the data decodes: absent decode facts are a failure, never a pass.
    if (!output.decode) fail('output_not_decoded', 'the output was not decoded end to end, so it cannot be called a success');
    else if (!output.decode.ok) fail('output_corrupt', output.decode.errors.join(' | ').slice(0, 400));
  }

  if (input.spend?.billingStop) fail('billing_stop', input.spend.billingStop);
  for (const refusal of input.spend?.refused ?? []) fail('spend_guard_refused', `${refusal.host}: ${refusal.reason}`);
  if (input.spend && input.spend.geminiUsd > input.spend.geminiCapUsd) fail('gemini_cap_exceeded', `$${input.spend.geminiUsd.toFixed(4)} > $${input.spend.geminiCapUsd.toFixed(2)}`);
  if (input.claudeSpentUsd !== undefined && input.claudeCapUsd !== undefined && input.claudeSpentUsd > input.claudeCapUsd) fail('claude_cap_exceeded', `$${input.claudeSpentUsd.toFixed(4)} > $${input.claudeCapUsd.toFixed(2)}`);

  return {status: failures.length === 0 ? 'success' : 'failed', failures};
}
