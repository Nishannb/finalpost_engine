/**
 * Pipeline wrapper for the kinetic engine (stages/kinetic/productionStage.ts). Everything here is I/O glue and policy; the layout work stays in the stage.
 *
 * Contract with analyzeVideo: this NEVER throws and NEVER changes the edit unless it returns a spec. On any problem it returns `spec: null` and a warning, and the caller keeps the template
 * Kinetic-Led path untouched (that is the fallback). When it returns a spec, the typography track owns every spoken word: the caller mutes the ordinary captions for the whole edit.
 */
import {promises as fs} from 'node:fs';

import {outcomeOf, type EditLedger} from '../lib/editLedger.ts';
import {ledgerIdOf} from '../stages/broll/planLedger.ts';
import {sampleStillGrid} from '../media/ffmpeg.ts';
import type {DirectorCall} from '../stages/kinetic/director.ts';
import {plateFromRgb} from '../stages/kinetic/plate.ts';
import {buildProductionKinetic, type ProductionKineticReport} from '../stages/kinetic/productionStage.ts';
import type {RenderSpec} from '../stages/kinetic/schema.ts';
import type {SpeakerBoxSource} from '../stages/kinetic/speakerBox.ts';
import {behindWindows, foregroundSpans, spansCover} from '../stages/kinetic/matteMap.ts';
import type {AlphaGrid} from '../stages/kinetic/scene.ts';
import {planSpeakerMotion, type MotionPolicy, type TrackingSample} from '../stages/kinetic/speakerMotion.ts';

/** The fullscreen layout draws the speaker with `object-position: 50% 42%` (remotion ShortVideo `speakerAt`). Split layouts differ, so the engine only runs on the fullscreen speaker. */
export const FULLSCREEN_OBJECT_POSITION = {x: 0.5, y: 0.42} as const;

export type KineticEngineInput = {
  captionWords: ReadonlyArray<{text: string; start: number; end: number}>;
  fps: number;
  width: number;
  height: number;
  durationSec: number;
  speaker: {box: {x: number; y: number; w: number; h: number}; source: SpeakerBoxSource; /** a moving speaker (optional): source-fraction boxes at sample frames; default none = one static box */ motion?: ReadonlyArray<{frame: number; box: {x: number; y: number; w: number; h: number}; margin?: {x: number; y: number}; cover?: ReadonlyArray<unknown>}>; /** Phase 4.5 (default absent = the one static box): timestamped measured boxes on the OUTPUT timeline; turned into a motion track by the policy in speakerMotion.ts. Ignored when `motion` is given. */ samples?: ReadonlyArray<TrackingSample>; motionPolicy?: Partial<MotionPolicy>; /** output frames of the edit's cuts (keep-segment starts), so the policy never interpolates or holds across one */ cutFrames?: ReadonlyArray<number>};
  sourceSize: {width: number; height: number};
  zoomTriggers: ReadonlyArray<{start: number; end: number; scale: number; focus?: {x: number; y: number} | undefined}>;
  zoomEnabled: boolean;
  /** a still of the speaker (the occupancy still): the plate colour / brightness are sampled from it */
  stillPath?: string;
  allowThreeD: boolean;
  /** Phase 4 Director-solver integration (default off = Phase 3 behaviour) */
  adaptive?: boolean;
  /** undefined = the configured Gemini Director (budgeted through lib/http requestJson); null = none */
  director?: DirectorCall | null;
  richDirectorInput?: boolean;
  /** Phase 5 (absent = no matte = the Phase 4.9 front-only engine): the RVM matte in composition fractions (pipeline/kineticMatteStage.ts). The caller must ship the foreground or re-run without it. */
  matte?: {grid: AlphaGrid; alphaAreaFrac: number};
  /** Phase 4.8: placement policy overrides (evaluation / regression use); absent = the production defaults of productionStage.ts */
  /** Phase 5.15 (G3): context-driven, Director-preserving motion (stages/kinetic/playbook.ts `motionVariety`). Default true: the production Kinetic V2 engine (itself behind POLISH_KINETIC_ENGINE, default off) uses it; false = the Phase 5.14 motion exactly. */
  motionVariety?: boolean;
  /** V1: the user's caption identity derived from the selected CaptionKit preset (stages/kinetic/presetIdentity.ts). Absent = Kinetic's own look. */
  identity?: import('../stages/kinetic/presetIdentity.ts').KineticIdentity;
  placementPolicy?: {observationBudget?: import('../stages/kinetic/speakerGeometry.ts').ObservationBudget | null; fitHeroFace?: boolean; relocateBeforeFloor?: boolean; refuseBelowFloor?: boolean; keepSwallowingMatchCuts?: boolean};
};

/**
 * Final freeze: what the composition may keep while the kinetic engine owns the edit. The engine places type in FULL-FRAME composition pixels against the speaker's full-frame box, so:
 *  - media containers and inset reveals move the SPEAKER ALONE (the type would stay put while the person moves): dropped (Phase 3);
 *  - frame insets (Director-provided or automatic stillness insets) are a smaller crop window (remotion FrameInsetTrack.tsx, overflow hidden) that the picture's AbsoluteFill layers shrink
 *    into, while the kinetic track keeps its absolute pixel positions (KineticTrack.tsx): type near an edge is clipped (visual sign-off E1/E2: "chase" lost its "e") and the face keep-out
 *    no longer lines up with the shrunken speaker: dropped too. The template path (engine not owning the edit) never calls this and keeps all of them.
 */
export function kineticOwnedComposition(input: {mediaContainers: readonly unknown[]; insetReveals?: readonly unknown[] | null; frameInsets?: readonly unknown[] | null}): {dropSpeakerTransforms: boolean; dropFrameInsets: boolean; warnings: string[]} {
  const warnings: string[] = [];
  const speakerTransforms = input.mediaContainers.length + (input.insetReveals?.length ?? 0);
  if (speakerTransforms > 0) warnings.push(`kinetic_engine:speaker_transforms_removed:${speakerTransforms}`);
  const insets = input.frameInsets?.length ?? 0;
  if (insets > 0) warnings.push(`kinetic_engine:frame_insets_removed:${insets}`);
  return {dropSpeakerTransforms: speakerTransforms > 0, dropFrameInsets: insets > 0, warnings};
}

/**
 * Phase 5.12 (G0): the stage-2 TEXT systems that would otherwise survive next to the engine. `blueprint.motionGraphics` (stage-2 kinetic_text cards, remotion MotionGraphicTrack) and
 * `blueprint.semanticEmphasis` (remotion SemanticEmphasisTrack, mounted ABOVE the kinetic front layer) both draw words on screen. The engine already draws every spoken word, mutes the
 * captions for the whole edit and solves its placements without knowing either system exists, so a surviving card duplicates words and can sit over (emphasis) or under the kinetic type
 * unguarded. analyzeVideo already switches off every other text system when the engine owns the edit (template Kinetic-Led, motion templates, generated graphics, stack hook); these two were
 * missed. Pictures (b-roll, visual overlays, transitions) are not text and are kept. The template path (engine not owning the edit) never calls this.
 */
export function kineticOwnedText(input: {motionGraphics?: readonly unknown[] | null; semanticEmphasis?: readonly unknown[] | null}): {dropMotionGraphics: boolean; dropSemanticEmphasis: boolean; warnings: string[]} {
  const mg = input.motionGraphics?.length ?? 0;
  const se = input.semanticEmphasis?.length ?? 0;
  const warnings: string[] = [];
  if (mg > 0) warnings.push(`kinetic_engine:motion_graphics_removed:${mg}`);
  if (se > 0) warnings.push(`kinetic_engine:semantic_emphasis_removed:${se}`);
  return {dropMotionGraphics: mg > 0, dropSemanticEmphasis: se > 0, warnings};
}

/**
 * Phase 5.13: the visual-overlay layouts the renderer draws as TEXT and nothing else (remotion VisualOverlayTrack: `lockup` / `stat` -> PhraseStack, `banner`, `chip`, `bubble` -> ChatBubbleStack).
 * The same set as stages/render/prefetchAssets.ts TEXT_LAYOUTS. Every other layout (cutaway, pip, sticker, card, composite, split, cutout) is a PICTURE and never draws `overlayText` / `keyword`.
 */
export const TEXT_OVERLAY_LAYOUTS: ReadonlySet<string> = new Set(['lockup', 'stat', 'banner', 'chip', 'bubble']);
type OverlayLike = {layout: string; mediaKind: string; intent?: string | undefined};
/** Skill B (explainer) media: drawn by the explainer layout frames (ExplainerMount), not by VisualOverlayTrack. That lane is NOT owned by this module (see the Phase 5.13 report). */
export const isExplainerOverlay = (o: OverlayLike): boolean => typeof o.intent === 'string' && o.intent.startsWith('explainer_');
/** A text treatment carried as an overlay: a text layout, or a text plate (`mediaKind: 'text'`: no picture, its words are its content). Explainer-lane media is excluded. */
export const isTextOverlay = (o: OverlayLike): boolean => !isExplainerOverlay(o) && (o.mediaKind === 'text' || TEXT_OVERLAY_LAYOUTS.has(o.layout));

/** Phase 5.13: text overlays are dropped while the engine owns the edit; picture overlays are kept untouched (same objects, same order). */
export function kineticOwnedOverlays<T extends OverlayLike>(overlays: readonly T[] | null | undefined): {kept: T[]; dropped: T[]; warnings: string[]} {
  const kept: T[] = [], dropped: T[] = [];
  for (const o of overlays ?? []) (isTextOverlay(o) ? dropped : kept).push(o);
  return {kept, dropped, warnings: dropped.length ? [`kinetic_engine:text_overlays_removed:${dropped.length}`] : []};
}

/**
 * Phase 5.13: the art-directed opening and behind-subject text while the engine owns the edit.
 *  - `openingTreatment` (remotion components/OpeningTreatment.tsx) is ONE title lockup: the text, an optional panel BEHIND the text box and an accent bar UNDER the text, all inside the text's
 *    own box. Neither the panel nor the bar exists without the text (they frame it), so there is no independent non-text visual to keep: the whole lockup is dropped. It is drawn ABOVE the
 *    kinetic front layer, over the engine's own opening lockup.
 *  - `behindSubjectTexts` (TextBehindSubjectTrack) are words drawn behind the person. While the engine owns the edit the only producer is the opening's behind-subject variant (the motion stage,
 *    the other producer, does not run).
 */
export function kineticOwnedOpening(input: {openingTreatment?: unknown; behindSubjectTexts?: readonly unknown[] | null}): {dropOpening: boolean; dropBehindSubjectTexts: boolean; warnings: string[]} {
  const opening = Boolean(input.openingTreatment);
  const behind = input.behindSubjectTexts?.length ?? 0;
  const warnings: string[] = [];
  if (opening) warnings.push('kinetic_engine:opening_treatment_removed');
  if (behind > 0) warnings.push(`kinetic_engine:behind_subject_texts_removed:${behind}`);
  return {dropOpening: opening, dropBehindSubjectTexts: behind > 0, warnings};
}

/**
 * Phase 5.13: the last line of defence, applied to the blueprint's text-carrying fields immediately before it is assembled, after every stage that can append to them. In a correct run it changes
 * nothing (the owned-text drops above already ran); anything it does remove was added by a stage after the edit ledger was summarised, so it is reported as `kinetic_engine:late_text_removed:*`.
 * Pictures are kept (same objects, same order).
 * Phase 5.14: the Skill B explainer lane is suppressed at the engine boundary (kineticOwnedLanes), so `explainerLane` is false and no explainer media exists in a correct run. If either is ever
 * present anyway, the WHOLE lane goes (its layout track + claim beats via `dropExplainerLane`, and every explainer-tagged overlay, picture or text plate): without its layout track the renderer
 * would draw its stills as plain cutaways and its text plates as blank plates, i.e. a partial lane.
 */
export function kineticFinalTextGuard<O extends OverlayLike, M, S, B, P>(parts: {hookTitle: string; openingTreatment: P | null | undefined; motionGraphics: readonly M[] | null | undefined; semanticEmphasis: readonly S[] | null | undefined; behindSubjectTexts: readonly B[] | null | undefined; overlays: readonly O[] | null | undefined; explainerLane: boolean}): {
  hookTitle: string; openingTreatment: null; motionGraphics: M[]; semanticEmphasis: S[]; behindSubjectTexts: B[]; overlays: O[]; dropExplainerLane: boolean; warnings: string[];
} {
  const explainerMedia = (parts.overlays ?? []).filter(isExplainerOverlay);
  const ov = kineticOwnedOverlays((parts.overlays ?? []).filter(o => !isExplainerOverlay(o)));
  const counts: Array<[string, number]> = [
    ['hook_title', parts.hookTitle ? 1 : 0], ['opening_treatment', parts.openingTreatment ? 1 : 0], ['motion_graphics', parts.motionGraphics?.length ?? 0],
    ['semantic_emphasis', parts.semanticEmphasis?.length ?? 0], ['behind_subject_texts', parts.behindSubjectTexts?.length ?? 0], ['text_overlays', ov.dropped.length],
    ['explainer_lane', parts.explainerLane ? 1 : 0], ['explainer_media', explainerMedia.length],
  ];
  const warnings = counts.filter(([, n]) => n > 0).map(([k, n]) => `kinetic_engine:late_text_removed:${k}=${n}`);
  return {hookTitle: '', openingTreatment: null, motionGraphics: [], semanticEmphasis: [], behindSubjectTexts: [], overlays: ov.kept, dropExplainerLane: parts.explainerLane, warnings};
}

/**
 * Phase 5.14: lanes that may not run while the engine owns the edit. The Skill B explainer lane (POLISH_EXPLAINER_SKILL) re-composes the picture: a hard-cut layout track that moves the speaker
 * into a split (`speakerAt('50% 22%')`), article / text plates, chunk-swap captions, explainer media overlays, its own palette, cleared transitions, and it hides every picture-owning overlay outside
 * its layouts. The engine places its type against the FULL-FRAME speaker, so none of that is compatible. Suppressed = exactly as if the flag were off for the rest of this job (the caller turns the
 * per-job flag off before any explainer reader runs), so the lane never partially executes. Flag off / engine not owning the edit: never called, nothing changes.
 */
export function kineticOwnedLanes(input: {explainerSkill: boolean}): {suppressExplainer: boolean; warnings: string[]} {
  return input.explainerSkill ? {suppressExplainer: true, warnings: ['kinetic_engine:explainer_lane_suppressed']} : {suppressExplainer: false, warnings: []};
}

/** Phase 5.13: the edit-ledger reason every Kinetic V2 text-ownership removal carries. */
export const KINETIC_TEXT_DROP_REASON = 'kinetic_engine_owns_text';
/**
 * Phase 5.13: records Kinetic V2 text-ownership removals in the edit ledger, the same mechanism the other text removals of analyzeVideo use (`ledger.drop(id, 'plan_assembly', reason)`).
 *  - `items`: objects that carry their ledger id (motion graphics, semantic emphasis, overlays);
 *  - `behindSubjectTexts`: entries found by type + start, as the Subject Stage removals do;
 *  - `hookTitle`: every hook-title entry not already dropped or rejected (`final` is only filled in later, so it cannot be used here).
 * An item with no ledger entry is skipped (it was never proposed, e.g. added by a stage that does not write the ledger). Returns the number of entries recorded.
 */
export function ledgerDropOwnedText(ledger: Pick<EditLedger, 'get' | 'drop' | 'find' | 'entries'>, removed: {items?: readonly object[]; behindSubjectTexts?: ReadonlyArray<{start: number}>; hookTitle?: boolean}): number {
  let n = 0;
  for (const item of removed.items ?? []) {
    const id = ledgerIdOf(item);
    if (id && ledger.get(id)) { ledger.drop(id, 'plan_assembly', KINETIC_TEXT_DROP_REASON); n += 1; }
  }
  for (const item of removed.behindSubjectTexts ?? []) {
    const entry = ledger.find('behind_subject_text', item.start, 0.05);
    if (entry) { ledger.drop(entry.id, 'plan_assembly', KINETIC_TEXT_DROP_REASON); n += 1; }
  }
  if (removed.hookTitle) for (const entry of ledger.entries()) if (entry.type === 'hook_title' && !['dropped', 'rejected'].includes(outcomeOf(entry))) { ledger.drop(entry.id, 'plan_assembly', KINETIC_TEXT_DROP_REASON); n += 1; }
  return n;
}

/** Final freeze: automatic stillness frame insets are planned only when the kinetic engine does NOT own the edit (same reason as above). */
export const stillnessInsetsAllowed = (kineticEngineOwnsEdit: boolean): boolean => !kineticEngineOwnsEdit;

/**
 * Phase 5: the person foreground a matte-informed spec needs. The renderer draws EVERY behind line behind the foreground whenever `subjectForeground` exists, and draws the foreground only inside its
 * spans, so the spans must cover every behind window (checked here; `ok: false` = the caller must not ship this spec with this foreground). No behind line = no foreground needed.
 */
export function planKineticForeground(spec: RenderSpec, fps: number, durationFrames: number): {behindEvents: number; spans: Array<{start: number; end: number}>; ok: boolean} {
  const windows = behindWindows(spec.events).map(w => ({inFrame: Math.max(0, w.inFrame), outFrame: Math.min(durationFrames, w.outFrame)})).filter(w => w.outFrame > w.inFrame);
  if (windows.length === 0) return {behindEvents: 0, spans: [], ok: true};
  const spans = foregroundSpans(windows, fps, durationFrames);
  return {behindEvents: windows.length, spans, ok: spansCover(spans, windows, fps)};
}

export type KineticEngineOutcome = {
  spec: RenderSpec | null;
  report: ProductionKineticReport | null;
  /** blueprint warnings, in the existing `family:detail` style */
  warnings: string[];
};

export async function runKineticEngineStage(input: KineticEngineInput): Promise<KineticEngineOutcome> {
  const warnings: string[] = [];
  try {
    let plate: {luminance: number; color: string} | null = null;
    if (input.stillPath) {
      try { plate = plateFromRgb(await sampleStillGrid(input.stillPath, 16)); } catch { warnings.push('kinetic_engine:plate_unmeasured'); }
      await fs.rm(`${input.stillPath}.grid16.rgb`, {force: true}).catch(() => undefined);
    }
    let motion = input.speaker.motion;
    if (!motion && input.speaker.samples) {
      const mp = planSpeakerMotion({samples: input.speaker.samples, fps: input.fps, durationFrames: Math.ceil(input.durationSec * input.fps), ...(input.speaker.cutFrames ? {cutFrames: input.speaker.cutFrames} : {}), ...(input.speaker.motionPolicy ? {policy: input.speaker.motionPolicy} : {})});
      if (mp) {
        motion = mp.motion;
        warnings.push(`kinetic_engine:speaker_motion:samples=${mp.report.usable}/${mp.report.offered},conservative=${Math.round(mp.report.conservativeFraction * 100)}%`);
      } else warnings.push(`kinetic_engine:speaker_static_box:no_usable_samples(${input.speaker.samples.length} offered)`);
    }
    const {spec, report} = await buildProductionKinetic({
      captionWords: input.captionWords, fps: input.fps, width: input.width, height: input.height, durationSec: input.durationSec,
      speaker: {box: input.speaker.box, source: input.speaker.source, srcW: input.sourceSize.width, srcH: input.sourceSize.height, objectPosition: FULLSCREEN_OBJECT_POSITION, ...(motion ? {motion} : {})},
      zoomTriggers: input.zoomTriggers, zoomEnabled: input.zoomEnabled,
      ...(plate ? {plate} : {}),
      ...(input.matte ? {matte: input.matte} : {}),
      ...(input.director !== undefined ? {director: input.director} : {}),
      ...(input.richDirectorInput ? {richDirectorInput: true} : {}),
      ...(input.identity ? {identity: input.identity} : {}),
      policy: {allowThreeD: input.allowThreeD, coverAllWords: true, directorSolver: input.adaptive ? 'phase4' : 'phase3', motionVariety: input.motionVariety !== false, ...(input.placementPolicy ?? {})},
    });
    if (!spec || !report.ok) {
      warnings.push(`kinetic_engine_failed:${(report.failure ?? 'no_spec').slice(0, 120)}`);
      return {spec: null, report, warnings};
    }
    // a spec that fails the engine's own guardrails is not shipped: the template path runs instead
    if (report.guardrailViolations.length > 0) {
      warnings.push(`kinetic_engine_failed:guardrails:${report.guardrailViolations.slice(0, 3).map(v => `${v.rule}@${v.eventId}`).join(',')}`);
      return {spec: null, report, warnings};
    }
    if (report.coverage.missing > 0) warnings.push(`kinetic_engine:coverage_gaps:${report.coverage.missing}`);
    warnings.push('kinetic_engine:on');
    if (report.planSource === 'fallback') warnings.push(`kinetic_engine_fallback_plan:${(report.planReason ?? 'unknown').slice(0, 80)}`);
    else if (report.planPartial) warnings.push('kinetic_engine_partial');
    if (report.speakerBox.measured) warnings.push('kinetic_engine:speaker_box_measured');
    if (report.matte) warnings.push(report.matte.used ? `kinetic_engine:matte_used:area=${report.matte.alphaAreaFrac}` : `kinetic_engine:matte_unused:${report.matte.note}`);
    if (report.phase4) warnings.push(`kinetic_engine:adaptive:repairs=${report.phase4.repairs.demoted.length}d/${report.phase4.repairs.removed.length}r`);
    warnings.push(`kinetic_engine:decisions:${report.decisionSummary.total}`);
    return {spec, report, warnings};
  } catch (err) {
    warnings.push(`kinetic_engine_failed:${(err instanceof Error ? err.message : String(err)).slice(0, 120)}`);
    return {spec: null, report: null, warnings};
  }
}
