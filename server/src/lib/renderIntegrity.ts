/**
 * WP2: post-render integrity decision. Pure: it judges facts that the caller measured (`inspectOutput` in pipeline/experimentVerdict.ts does the stat, ffprobe and
 * full decode), so this file imports only the error taxonomy and the facts TYPE. Mirrors the output block of `judgeExperiment` (same MIN_BYTES, same decode rule:
 * absent decode facts are a failure, never a pass); the duration tolerance is deliberately a little wider (0.5 s) because a product render must not be refused for a frame
 * of rounding, while a truncated or short file is off by far more.
 */
import type {OutputFacts} from '../pipeline/experimentVerdict.ts';
import {EngineError} from './errors.ts';

export const RENDER_MIN_BYTES = 10_000;

export type RenderCheck = 'output_missing' | 'output_empty' | 'output_unreadable' | 'dimensions_mismatch' | 'duration_mismatch' | 'audio_missing' | 'output_not_decoded' | 'output_corrupt';
export type RenderCheckFailure = {check: RenderCheck; detail: string};

export type RenderExpectation = {
  width: number;
  height: number;
  durationSec: number;
  /** True only when the render's source is known to carry audio. Undefined = unknown: the audio check is not applied. */
  expectAudio?: boolean;
};

export function judgeRenderOutput(output: OutputFacts, expected: RenderExpectation): RenderCheckFailure[] {
  if (!output.exists) return [{check: 'output_missing', detail: 'the render produced no file'}];
  if (output.bytes < RENDER_MIN_BYTES) return [{check: 'output_empty', detail: `${output.bytes} bytes`}];
  if (!output.probe) return [{check: 'output_unreadable', detail: (output.probeError ?? 'ffprobe failed').slice(0, 200)}];
  const failures: RenderCheckFailure[] = [];
  const {probe} = output;
  if (probe.width !== expected.width || probe.height !== expected.height) {
    failures.push({check: 'dimensions_mismatch', detail: `${probe.width}x${probe.height}, expected ${expected.width}x${expected.height}`});
  }
  const tolerance = Math.max(0.5, 3 / (probe.fps || 30));
  if (!Number.isFinite(expected.durationSec) || Math.abs(probe.durationSec - expected.durationSec) > tolerance) {
    failures.push({check: 'duration_mismatch', detail: `${probe.durationSec.toFixed(2)} s, expected ${Number(expected.durationSec).toFixed(2)} s (±${tolerance.toFixed(2)})`});
  }
  if (expected.expectAudio === true && !probe.hasAudio) failures.push({check: 'audio_missing', detail: 'the source has audio but the render has no audio stream'});
  if (!output.decode) failures.push({check: 'output_not_decoded', detail: 'the output was not decoded end to end'});
  else if (!output.decode.ok) failures.push({check: 'output_corrupt', detail: output.decode.errors.join(' | ').slice(0, 300)});
  return failures;
}

/** Throws the typed `render_failed` naming every failed check; returns normally when the output passes. */
export function assertRenderOutputValid(output: OutputFacts, expected: RenderExpectation): void {
  const failures = judgeRenderOutput(output, expected);
  if (failures.length === 0) return;
  const names = failures.map(item => item.check).join(', ');
  throw new EngineError('render_failed', `Rendered video failed integrity check (${names}): ${failures[0]!.detail}`, {checks: failures});
}
