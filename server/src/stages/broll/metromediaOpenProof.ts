/**
 * WP21: a STRUCTURAL PROOF that the polish planners compose into a Metromedia-style open. PURE: it runs the same planners `analyzeVideo` runs, in the same order, on a fixture (words + bound labeled assets with fake URLs),
 * and returns one timeline of beats. It does not call a model, the worker, R2 or a renderer; it proves the grammar (flash card -> multi-image run -> tilted screenshot card -> filler cutaway, with procedural transitions between),
 * not the look.
 */
import {resolveLibraryGraphic} from '../motionDirector/libraryRegistry.ts';
import {overlayCoverStarts} from './engagementCadence.ts';
import {fillerWarnings, planFillerClipLane, type FillerSource} from './fillerClipLane.ts';
import {findFlashCardCandidates, flashCardCap, flashCardDuration} from './flashCardSeed.ts';
import type {LabeledAssetBrief} from './labeledAssetBrief.ts';
import {labeledAssetWarnings, mediaKindOfUrl, planLabeledAssetPlacements, type ImageRunPlan, type ResolvedLabeledAsset} from './labeledAssetPlacement.ts';
import {preferMediaWarnings, textOnlyOpensWithMediaAvailable} from './preferMedia.ts';
import {ensurePolishTransitionDensity} from './transitionDensity.ts';

export type OpenProofFixture = {
  outputDurationSec: number;
  words: Array<{text: string; start: number; end: number}>;
  assetBrief: LabeledAssetBrief;
  /** userAssetId -> upload URL */
  assets: Record<string, string>;
};

export type OpenBeat = {t: number; end: number; kind: 'flash_card' | 'flash_end' | 'run_cut' | 'image_run' | 'labeled_overlay' | 'filler' | 'transition'; detail: string};

export type OpenProof = {
  flash: {phrase: string; start: number; end: number; wordCount: number; registryComposition: string | null} | null;
  runs: ImageRunPlan[];
  overlays: ReturnType<typeof planLabeledAssetPlacements>['overlays'];
  fillers: ReturnType<typeof planFillerClipLane>;
  transitions: ReturnType<typeof ensurePolishTransitionDensity>['added'];
  preferMedia: string[];
  warnings: string[];
  beats: OpenBeat[];
  /** Largest gap (s) between consecutive visual-change times from the first to the last (flash start / end, run start, run cuts, overlay starts, filler starts, transitions). */
  maxGapSec: number;
};

/** The largest gap between consecutive times (sorted, de-duplicated); 0 for fewer than two. */
export function maxGapBetweenVisualBeats(times: readonly number[]): number {
  const sorted = [...new Set(times.map(time => Math.round(time * 1000) / 1000))].sort((a, b) => a - b);
  return sorted.slice(1).reduce((max, time, index) => Math.max(max, time - sorted[index]!), 0);
}

const sentenceStartsOf = (words: OpenProofFixture['words']): number[] => words.filter((word, index) => index === 0 || word.start - words[index - 1]!.end >= 0.35).map(word => word.start);

export function planMetromediaOpenProof(fixture: OpenProofFixture): OpenProof {
  const duration = fixture.outputDurationSec;
  const warnings: string[] = [];

  // 1) the flash / pivot card (first candidate, within the cap)
  const candidate = flashCardCap(duration) > 0 ? findFlashCardCandidates(fixture.words)[0] : undefined;
  const flash = candidate
    ? (() => {
        const start = candidate.startSec;
        const end = Math.round((start + flashCardDuration(candidate.endSec - candidate.startSec)) * 1000) / 1000;
        const hit = resolveLibraryGraphic({goal: 'pivot', visualDescription: 'flash card', placement: 'full_screen', content: {flash: candidate.phrase}});
        return {phrase: candidate.phrase, start, end, wordCount: candidate.phrase.split(/\s+/).length, registryComposition: hit?.compositionId ?? null};
      })()
    : null;

  // 2) bound labeled assets -> overlays + image runs (the flash card owns its window)
  const assets = new Map<string, ResolvedLabeledAsset>(Object.entries(fixture.assets).map(([id, url]) => [id, {url, mediaKind: mediaKindOfUrl(url)}]));
  const labeled = planLabeledAssetPlacements({brief: fixture.assetBrief, assets, outputDurationSec: duration, blockedRanges: flash ? [{start: flash.start, end: flash.end}] : []});
  warnings.push(...labeledAssetWarnings(labeled));

  // 3) filler clips from bound broll_clip / user videos in windows nothing covers
  const boundVideos = new Set(fixture.assetBrief.slots.filter(slot => slot.status === 'uploaded' && slot.kind === 'broll_clip' && slot.userAssetId).map(slot => slot.userAssetId!));
  const sources: FillerSource[] = [...assets].filter(([, asset]) => asset.mediaKind === 'video').sort(([a], [b]) => Number(boundVideos.has(b)) - Number(boundVideos.has(a))).map(([id, asset]) => ({...asset, userAssetId: id}));
  const fullScreen = [...(flash ? [{start: flash.start, end: flash.end}] : []), ...labeled.overlays.filter(o => o.layout === 'cutaway').map(o => ({start: o.start, end: o.end}))];
  const fillers = planFillerClipLane({
    sources,
    outputDurationSec: duration,
    coveredStarts: [...(flash ? [flash.start] : []), ...overlayCoverStarts(labeled.overlays)],
    blockedRanges: fullScreen,
    overlayRanges: labeled.overlays.map(o => ({start: o.start, end: o.end})),
    pipBlockedRanges: labeled.overlays.filter(o => o.layout === 'pip' || o.layout === 'card').map(o => ({start: o.start, end: o.end})),
    words: fixture.words,
  });
  warnings.push(...fillerWarnings(fillers));

  // 4) prefer-media over a text-only open: the proof has no OpenPlate, so this stays empty unless one is added
  const preferMedia = preferMediaWarnings(textOnlyOpensWithMediaAvailable({graphics: [], mediaBeats: labeled.overlays, mediaUnder: []}));

  // 5) transition density anchored on the slot boundaries, media cuts and the end of the flash card
  const cutTimes = [...labeled.overlays, ...fillers.overlays].filter(o => o.layout === 'cutaway').map(o => o.start);
  const density = ensurePolishTransitionDensity({
    durationSec: duration,
    existing: [],
    sentenceStarts: sentenceStartsOf(fixture.words),
    cutTimes: [...cutTimes, ...labeled.overlays.map(o => o.start), ...fillers.overlays.map(o => o.start), ...(flash ? [flash.end] : [])],
    // WP22: the same forced cuts analyze passes: a cut after the flash card, a pop-transition inside a long logo cloud
    forcedCuts: [...(flash ? [flash.end] : []), ...labeled.runs.filter(run => run.mode === 'logo_cloud').flatMap(run => run.cutAts)],
    assetSlotWindows: fixture.assetBrief.slots.map(slot => ({start: slot.startSec, end: slot.endSec})),
  });
  warnings.push(`polish_pace:transitions:${density.added.length}`);

  const beats: OpenBeat[] = [
    ...(flash ? [{t: flash.start, end: flash.end, kind: 'flash_card' as const, detail: flash.phrase}] : []),
    ...(flash ? [{t: flash.end, end: flash.end, kind: 'flash_end' as const, detail: 'back to the world'}] : []),
    ...labeled.runs.flatMap(run => run.cutAts.map(at => ({t: at, end: at, kind: 'run_cut' as const, detail: `${run.mode} cut`}))),
    ...labeled.runs.map(run => ({t: run.start, end: run.end, kind: 'image_run' as const, detail: `${run.mode}: ${run.items.map(item => `${item.label ?? '?'}${item.recipeId ? `(${item.recipeId})` : ''}`).join(' | ')}`})),
    ...labeled.overlays.filter(o => !(o.slides && o.slides.length > 1)).map(o => ({t: o.start, end: o.end, kind: 'labeled_overlay' as const, detail: `${o.layout} ${o.keyword}${o.recipeId ? ` (${o.recipeId})` : ''}`})),
    ...fillers.overlays.map(o => ({t: o.start, end: o.end, kind: 'filler' as const, detail: `${o.layout} ${o.keyword}${fillers.motionGraphics.find(g => g.start === o.start) ? ` + word "${fillers.motionGraphics.find(g => g.start === o.start)!.text}"` : ''}`})),
    ...density.added.map(item => ({t: item.at, end: item.at, kind: 'transition' as const, detail: `${item.keyword} (${item.anchor})`})),
  ].sort((a, b) => a.t - b.t);

  const maxGapSec = maxGapBetweenVisualBeats(beats.map(beat => beat.t));
  return {flash, runs: labeled.runs, overlays: labeled.overlays, fillers, transitions: density.added, preferMedia, warnings, beats, maxGapSec};
}
