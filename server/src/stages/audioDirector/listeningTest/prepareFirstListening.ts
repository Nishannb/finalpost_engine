/**
 * Prepares (does not render) the first local listening test. NOT RUN in Phase 1.4: it needs a real, rights-cleared bed that does not exist locally.
 *
 *   node --experimental-strip-types src/stages/audioDirector/listeningTest/prepareFirstListening.ts --bed <bed.json> --out <envelope.json> [--vo-lufs N] [--no-beat-data]
 *
 * <bed.json>: a MusicAsset (../audioPlan/assets.ts) with id "first-listening-bed", a `staticFile:` url under remotion/public (so the render needs no
 * network), measured `placement` (BedPlacementMeta, from agents/music_specialist postprocess), `integratedLufs`, and `rights.cleared: true` with the
 * licence and evidence. Anything else is refused.
 * --no-beat-data (this listening test only): accept a bed with NO `placement` key, when no beat analysis is available. Allowed only because every
 * timing anchor of this plan comes from the Event Sheet (entry, sections, hits, ending) and the plan asks for `align: auto`, never `lift_at`.
 * The compiler then reads the bed from its 0 s mark (placement reason `no_meta`, startsOnDownbeat false): nothing claims beat sync, and no beat
 * positions are invented. A `placement` that is present is still checked in full. The production compiler is not changed.
 * Output: a SavedBlueprintEnvelope for `npm run render-blueprint`. Writes only <envelope.json>. No network, no model, no render.
 */
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {musicCatalog, type MusicAsset} from '../audioPlan/assets.ts';
import {compileAudioPlan} from '../audioPlan/compile.ts';
import type {AudioPlanInput} from '../audioPlan/planSchema.ts';
import {toRemotionAudioDesign} from '../audioPlan/remotionAdapter.ts';
import {FIRST_LISTENING_ASSET_ID, firstListeningBlueprint, firstListeningPlan, firstListeningSheet, type CaptureFixture} from './firstListening.ts';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
export const CAPTURE_FIXTURE = path.join(REPO, 'server/src/eval/fixtures/v1-hi-relationship-89d9a6364d.json');
export const SOURCE_VIDEO = path.join(REPO, 'remotion/public/hi.mp4');

/** Refuses anything that is not a real, rights-cleared, locally playable bed. `allowMissingBeatData` (--no-beat-data) accepts a bed without a `placement` key. */
export function checkBed(raw: unknown, options: {allowMissingBeatData?: boolean} = {}): {ok: true; bed: MusicAsset} | {ok: false; reason: string} {
  const bed = raw as Partial<MusicAsset> | null;
  if (!bed || typeof bed !== 'object') return {ok: false, reason: 'bed.json is not an object'};
  if (bed.id !== FIRST_LISTENING_ASSET_ID) return {ok: false, reason: `bed id must be "${FIRST_LISTENING_ASSET_ID}"`};
  if (bed.rights?.cleared !== true || !bed.rights.licence?.trim()) return {ok: false, reason: 'rights.cleared must be true with a licence'};
  if (typeof bed.url !== 'string' || !bed.url.startsWith('staticFile:')) return {ok: false, reason: 'url must be a staticFile: path under remotion/public (no network at render)'};
  if (/\.invalid\//.test(bed.url) || /synthetic/i.test(`${bed.rights.licence} ${bed.rights.note ?? ''}`)) return {ok: false, reason: 'synthetic test assets are not allowed here'};
  const beatDataAbsent = options.allowMissingBeatData === true && !('placement' in bed);
  if (!beatDataAbsent && (!bed.placement || !Array.isArray(bed.placement.downbeatTimes) || bed.placement.downbeatTimes.length < 2)) return {ok: false, reason: 'placement (BedPlacementMeta) with measured downbeats is required'};
  if (typeof bed.fullDurationSec !== 'number' || !(bed.fullDurationSec > 0)) return {ok: false, reason: 'fullDurationSec is required'};
  if (typeof bed.integratedLufs !== 'number') return {ok: false, reason: 'integratedLufs is required'};
  return {ok: true, bed: {kind: 'music', source: 'licensed', ...bed} as MusicAsset};
}

/** Why this plan cannot run without beat data, or null when it can (its music timing comes only from the Event Sheet). */
export function beatDataRequiredBy(plan: AudioPlanInput): string | null {
  if (!plan.music) return null;
  if (plan.music.align && plan.music.align.kind !== 'auto') return `music align "${plan.music.align.kind}" needs measured downbeats`;
  return null;
}

function main(argv: string[]): void {
  const arg = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const bedFile = arg('--bed');
  const outFile = arg('--out');
  const voLufsRaw = arg('--vo-lufs');
  const noBeatData = argv.includes('--no-beat-data');
  if (!bedFile || !outFile) throw new Error('usage: --bed <bed.json> --out <envelope.json> [--vo-lufs N] [--no-beat-data]');
  const checked = checkBed(JSON.parse(readFileSync(bedFile, 'utf8')), {allowMissingBeatData: noBeatData});
  if (!checked.ok) throw new Error(`refused: ${checked.reason}`);
  const fixture = JSON.parse(readFileSync(CAPTURE_FIXTURE, 'utf8')) as CaptureFixture;
  const sheet = firstListeningSheet(fixture);
  const plan = firstListeningPlan(sheet);
  const required = checked.bed.placement ? null : beatDataRequiredBy(plan);
  if (required) throw new Error(`refused: ${required}`);
  const result = compileAudioPlan(plan, {sheet, assets: musicCatalog([checked.bed]), videoId: 'adir_first_listening_hi', ...(voLufsRaw ? {voLufs: Number(voLufsRaw)} : {})});
  if (!result.ok) throw new Error(`plan rejected: ${JSON.stringify(result.errors)}`);
  if (!checked.bed.placement && result.timeline.music && (result.timeline.music.placement.reason !== 'no_meta' || result.timeline.music.placement.startsOnDownbeat)) throw new Error('refused: a bed without beat data must compile as no_meta');
  const lowered = toRemotionAudioDesign(result.timeline);
  if (!lowered.ok) throw new Error(`lowering refused: ${JSON.stringify(lowered.unsupported)}`);
  const envelope = {
    videoId: 'adir_first_listening_hi',
    sourceVideoPath: SOURCE_VIDEO,
    voLufs: result.timeline.voice.source === 'measured' ? result.timeline.voice.voLufs : null,
    savedAt: 'prepared-for-first-listening',
    blueprint: {...firstListeningBlueprint(fixture), audioDesign: lowered.audioDesign},
  };
  writeFileSync(outFile, `${JSON.stringify(envelope, null, 2)}\n`);
  console.log(JSON.stringify({out: outFile, timingHash: result.timeline.timingHash, planHash: result.timeline.planHash, warnings: result.timeline.warnings, dropped: result.timeline.dropped, musicTimeline: lowered.usesMusicTimeline, beatData: checked.bed.placement ? 'measured' : 'absent'}));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main(process.argv.slice(2));
