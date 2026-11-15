/**
 * Phase SFX-3H: the production render safety rule for generated music beds. Pure; one rule for every render path.
 *
 * A generated bed with a voice-relative (`talking`) duck is levelled (and loudness-corrected, remotion/src/audio/duckEnvelope.ts) against the duck's
 * `bedLufs`. It renders only when that value is
 *   1. a valid measured loudness (music/bgmFailSafe.ts classifyBedLoudness: a finite number in -70..0), AND
 *   2. backed by a provenance record, audioDesign.musicProvenance.bedLoudness, whose status says it was measured (written by the pipeline when it
 *      attached the bed, SFX-3H) or explicitly attested by an operator (render-blueprint --bed-lufs), and whose value equals the duck's.
 *
 * Before SFX-3G a missing measurement silently became -16, so a stored -16 cannot be told from a real -16 by its number. Provenance is NEVER inferred
 * from the value: a blueprint with no record (every blueprint written before SFX-3H) is "unverified" and refused, whatever its value.
 * Not affected: licensed beds, beds without a duck (fixed gains), absolute presets (their gains do not use the bed loudness), blueprints without music.
 *
 * Enforced at the two functions that hand a blueprint to Remotion, stages/render/localRender.ts renderLocally and stages/render/remotionLambda.ts
 * startLambdaRender (every render path ends in one of them), and earlier in pipeline/renderRunner.ts startRender (before a job or quota is recorded).
 */

import {EngineError} from '../../lib/errors.ts';
import type {AudioDesign, TimelineBlueprint} from '../../types/blueprint.ts';
import {classifyBedLoudness} from '../music/bgmFailSafe.ts';

/** The provenance statuses a render accepts. */
export const TRUSTED_BED_LOUDNESS_PROVENANCE = Object.freeze(['measured', 'operator_attested'] as const);
export type BedLoudnessProvenance = {status: (typeof TRUSTED_BED_LOUDNESS_PROVENANCE)[number]; lufs: number};

export type BedLoudnessRenderIssue = {
  code: 'bed_loudness_missing' | 'bed_loudness_invalid' | 'bed_loudness_unverified' | 'bed_loudness_provenance_invalid' | 'bed_loudness_provenance_mismatch';
  detail: string;
};

/** Why this audio design's generated bed must not be rendered, or null when it may. */
export function bedLoudnessRenderIssue(audio: AudioDesign | undefined): BedLoudnessRenderIssue | null {
  if (!audio || audio.musicSource !== 'generated' || !(audio.musicFullUrl ?? audio.musicUrl) || !audio.duck) return null;
  if ((audio.duck.preset ?? 'talking') !== 'talking') return null;
  const bed = classifyBedLoudness(audio.duck.bedLufs);
  if (bed.status === 'missing') return {code: 'bed_loudness_missing', detail: 'the generated bed\'s duck records no bed loudness'};
  if (bed.status === 'invalid') return {code: 'bed_loudness_invalid', detail: `the generated bed's duck records an invalid bed loudness (${bed.reason})`};
  const provenance = (audio.musicProvenance as {bedLoudness?: unknown} | undefined)?.bedLoudness;
  if (provenance === undefined || provenance === null) {
    return {code: 'bed_loudness_unverified', detail: `bed loudness ${bed.lufs} LUFS has no measurement provenance (a blueprint written before SFX-3H, or a record was lost); it is never trusted from its value alone`};
  }
  const record = provenance as {status?: unknown; lufs?: unknown};
  if (!(TRUSTED_BED_LOUDNESS_PROVENANCE as readonly unknown[]).includes(record.status) || typeof record.lufs !== 'number' || !Number.isFinite(record.lufs)) {
    return {code: 'bed_loudness_provenance_invalid', detail: `unrecognised bed loudness provenance ${JSON.stringify(provenance).slice(0, 120)}`};
  }
  if (record.lufs !== bed.lufs) return {code: 'bed_loudness_provenance_mismatch', detail: `provenance says ${record.lufs} LUFS but the duck uses ${bed.lufs} LUFS`};
  return null;
}

/** Throws (EngineError render_failed) before anything reaches Remotion. `where` names the boundary for the log and the message. */
export function assertBedLoudnessRenderable(blueprint: Pick<TimelineBlueprint, 'audioDesign' | 'blueprintId'>, where: string): void {
  const issue = bedLoudnessRenderIssue(blueprint.audioDesign);
  if (!issue) return;
  throw new EngineError('render_failed', `Refusing to render (${where}): unsafe_bed_loudness:${issue.code}: ${issue.detail}. The music would be levelled against an unverified loudness.`, {
    blueprintId: blueprint.blueprintId,
    reason: issue.code,
  });
}

// ------------------------------------------------------------------------------------------------- generated event SFX (Completion Sprint 1)
export type RemovedSfxHit = {at: number; src: string; reason: 'asset_missing_locally' | 'not_hosted_for_lambda'};

/**
 * Generated event SFX are local `staticFile:generated-sfx/...` files until they are published (production/sfxAssetHost.ts). A render must never
 * depend on a file it cannot load, so before handing a blueprint to Remotion:
 *   - local render: a generated hit whose file is missing from remotion/public is removed;
 *   - Lambda render: every generated hit still pointing at a local file is removed (Lambda cannot read the local public folder); hosted URLs stay.
 * Everything else (built-in and catalogue hits, the music) is untouched, and a blueprint with nothing to remove is returned as the SAME object.
 */
export function withRenderableGeneratedSfx<B extends Pick<TimelineBlueprint, 'audioDesign'>>(
  blueprint: B,
  target: {kind: 'local'; publicRoot: string; exists: (absolutePath: string) => boolean} | {kind: 'lambda'},
): {blueprint: B; removed: RemovedSfxHit[]} {
  const hits = blueprint.audioDesign?.hits;
  if (!hits || hits.length === 0) return {blueprint, removed: []};
  const removed: RemovedSfxHit[] = [];
  const kept = hits.filter(hit => {
    const src = (hit as {src?: unknown}).src;
    if (typeof src !== 'string' || !src.startsWith('staticFile:generated-sfx/')) return true;
    if (target.kind === 'lambda') {
      removed.push({at: hit.at, src, reason: 'not_hosted_for_lambda'});
      return false;
    }
    if (!target.exists(`${target.publicRoot.replace(/\/+$/, '')}/${src.slice('staticFile:'.length)}`)) {
      removed.push({at: hit.at, src, reason: 'asset_missing_locally'});
      return false;
    }
    return true;
  });
  if (removed.length === 0) return {blueprint, removed};
  return {blueprint: {...blueprint, audioDesign: {...blueprint.audioDesign!, hits: kept}}, removed};
}
