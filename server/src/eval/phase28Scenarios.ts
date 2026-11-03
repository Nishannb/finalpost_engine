/**
 * Phase 28 (Step 1a) scenarios: the REAL parse / compile / plan / layout / finalise stages run on crafted Director output that
 * contains the four edit types whose colours later stages rewrite (kinetic text, emphasis, media containers, frame insets), with
 * colours that are explicit (including an explicit #000000), absent, or invalid. Offline: no network, no model.
 *
 * This module deliberately imports nothing about provenance, so the same scenarios run against the pre-change code (the baseline
 * the before/after comparison uses) and against the post-change code.
 */

import {compileCreativePlan} from '../stages/directorV2/compiler.ts';
import type {CreativeElement, CreativePlan, PerceptionPack} from '../stages/directorV2/types.ts';
import {fallbackVisualDirection, parseVisualDirectorJson, type VisualDirection} from '../stages/broll/geminiDirector.ts';
import type {VisualPlan} from '../stages/broll/brollPlanner.ts';
import {finalizeEdits, zoomResolutionTrace, type FinalizeResult} from '../pipeline/finalizeEdits.ts';
import {resolveDirectedZooms} from '../stages/filters/autoZoom.ts';
import {buildTimeline} from '../stages/filters/timeline.ts';
import {composeBeautifulLayout} from '../stages/layout/slotCompositor.ts';
import {applyGeometricPatches} from '../stages/layout/layoutCritique.ts';
import {occupancyFromSpeaker} from '../stages/layout/occupancy.ts';
import {parseContentProfile, type ContentProfile} from '../stages/contentProfile/contentProfile.ts';
import {loadV1Fixtures} from './fixtures.ts';

export type PlanBRoll = (input: never) => Promise<VisualPlan>;
export type Deps = {planBRoll: PlanBRoll; setDirection: (direction: VisualDirection) => void};

// ---- v1: crafted Director JSON -------------------------------------------------------------------------------------------

const V1_FIXTURE_ID = 'v1-hi-relationship-89d9a6364d';

/** Fixture timeline + a Director response with every colour case. Times are SOURCE seconds (the v1 Director's time base). */
export function craftedV1Response(): {raw: string; fixture: ReturnType<typeof loadV1Fixtures>[number]} {
  const fixture = loadV1Fixtures().find(item => item.id === V1_FIXTURE_ID)!;
  const base = JSON.parse(fixture.rawResponse) as Record<string, unknown>;
  const response = {
    ...base,
    moments: [],
    inset_reveals: [],
    depth_overlays: [],
    zooms: [],
    motion_graphics: [
      {start: 4.4, end: 7.4, text: 'INVALID COLOURS', accent_color: 'red', text_color: 'nope', anchor: 'top_left', role: 'primary', shape: 'pill'},
      {start: 21, end: 24, text: 'EXPLICIT BLACK', accent_color: '#000000', text_color: '#000000', anchor: 'top_left', role: 'primary', shape: 'pill'},
      {start: 29, end: 32, text: 'NO COLOURS', anchor: 'top_left', role: 'secondary', shape: 'pill'},
    ],
    media_containers: [
      {start: 8, end: 13, mode: 'card', canvas_color: '#000000', canvas_title: 'Explicit', canvas_title_color: '#000000'},
      {start: 40, end: 45, mode: 'card', canvas_title: 'Defaulted'},
    ],
    frame_insets: [
      {start: 15, end: 19.5, scale: 0.8, margin_color: '#000000'},
      {start: 34, end: 38.5, scale: 0.8},
    ],
    semantic_emphasis: [
      {start: 25, end: 28, text: 'explicit', accent_color: '#000000', treatment: 'scale', weight: 'primary', anchor: 'top_right'},
      {start: 46, end: 48.5, text: 'defaulted', treatment: 'scale', weight: 'primary', anchor: 'top_right'},
    ],
  };
  return {raw: JSON.stringify(response), fixture};
}

export const PROFILE_RESPONSE = {content_type: 'educational_tips', structure: 'enumerated', pacing: 'fast', graphics_density: 'rich', visual_mood: 'bold_energetic', tone: 'direct', rationale: 'tips'};
/** A model reply with an unusable mood: the parser substitutes the content type's default mood. */
export const PROFILE_RESPONSE_BAD_MOOD = {...PROFILE_RESPONSE, visual_mood: 'not-a-mood'};

const SPEAKER = {x: 0.18, y: 0.16, w: 0.64, h: 0.62};

export type StageSnapshot = {
  /** parseVisualDirectorJson (or the v2 compiler's direction) */
  direction: Pick<VisualDirection, 'motionGraphics' | 'mediaContainers' | 'frameInsets' | 'semanticEmphasis'>;
  /** planBRoll output */
  planned: Pick<VisualPlan, 'motionGraphics' | 'mediaContainers' | 'frameInsets' | 'semanticEmphasis'>;
  /** composeBeautifulLayout then applyGeometricPatches (v1 only) */
  laidOut?: Pick<VisualPlan, 'motionGraphics' | 'mediaContainers' | 'semanticEmphasis'>;
  /** finalizeEdits, with and without a content profile */
  finalizedNoProfile: FinalizeResult;
  finalizedProfile?: FinalizeResult;
  profile?: ContentProfile;
};

function finalize(plan: VisualPlan, items: {motionGraphics: VisualPlan['motionGraphics']; mediaContainers: VisualPlan['mediaContainers']; semanticEmphasis: VisualPlan['semanticEmphasis']}, durationSec: number, profile: ContentProfile | null, zoomTriggers: ReturnType<typeof resolveDirectedZooms>): FinalizeResult {
  return finalizeEdits({
    ledger: plan.ledger!,
    contentProfile: profile,
    footageLuminance: 0.4,
    captionLocked: false,
    durationSec,
    hook: {text: '', start: 0, end: 0, anchor: 'top_left'},
    caption: plan.caption,
    brollClips: plan.clips,
    visualOverlays: plan.overlays,
    insetReveals: plan.insetReveals,
    frameInsets: plan.frameInsets,
    mediaContainers: items.mediaContainers,
    motionGraphics: items.motionGraphics,
    semanticEmphasis: items.semanticEmphasis,
    depthOverlays: [],
    transitions: plan.transitions,
    zoomTriggers,
    generatedGraphics: [],
    speaker: {box: SPEAKER, source: 'fallback'},
    speakerCutout: {available: false},
  });
}

export async function runV1(deps: Deps, profileResponse?: Record<string, unknown>): Promise<StageSnapshot> {
  const {raw, fixture} = craftedV1Response();
  const parsed = {...parseVisualDirectorJson(raw, fixture.sourceDurationSec, fixture.transcript), estimatedCostUsd: 0, source: 'gemini'} as VisualDirection;
  const timeline = buildTimeline(fixture.keepSegments as never);
  deps.setDirection({...parsed, hookSubtitle: '', estimatedCostUsd: 0, source: 'gemini'} as VisualDirection);
  const plan = await deps.planBRoll({
    transcript: fixture.transcript,
    sourceDurationSec: fixture.sourceDurationSec,
    timeline,
    words: fixture.words,
    captionWords: fixture.captionWords,
    requestedEdits: null,
    captionTemplate: fixture.captionTemplate ?? undefined,
  } as never);
  const occupancy = occupancyFromSpeaker(SPEAKER, 'fallback');
  const composed = composeBeautifulLayout({occupancy, hookStyle: plan.hookStyle, caption: plan.caption, motionGraphics: plan.motionGraphics, overlays: plan.overlays, mediaContainers: plan.mediaContainers, semanticEmphasis: plan.semanticEmphasis});
  const patched = applyGeometricPatches(occupancy, {hookTitle: plan.hookTitle, hookAnchor: composed.hookAnchor, hookDurationSec: plan.hookDurationSec, caption: composed.caption, motionGraphics: composed.motionGraphics, overlays: composed.overlays, mediaContainers: composed.mediaContainers, semanticEmphasis: composed.semanticEmphasis});
  const zoomTriggers = resolveDirectedZooms({directed: plan.zooms, words: fixture.words as never, timeline, scale: 1.25, maxDurationSec: 3.2, alreadyOutput: false, trace: zoomResolutionTrace(plan.ledger!)});
  const laid = {motionGraphics: patched.motionGraphics, mediaContainers: patched.mediaContainers, semanticEmphasis: patched.semanticEmphasis};
  const profile = profileResponse ? parseContentProfile(profileResponse) : undefined;
  const finalizedNoProfile = finalize(plan, laid, timeline.outputDurationSec, null, zoomTriggers);
  const finalizedProfile = profile ? finalize(plan, laid, timeline.outputDurationSec, profile, zoomTriggers) : undefined;
  return {direction: parsed, planned: plan, laidOut: laid, finalizedNoProfile, finalizedProfile, profile};
}

/** Every v1 fixture's parsed direction (the frozen saved responses) — used for the parse-level before/after. */
export function parsedFixtureDirections(): Array<{id: string; direction: VisualDirection}> {
  return loadV1Fixtures().map(fixture => ({id: fixture.id, direction: {...parseVisualDirectorJson(fixture.rawResponse, fixture.sourceDurationSec, fixture.transcript), estimatedCostUsd: 0, source: 'gemini'} as VisualDirection}));
}

export function fallbackDirection(): VisualDirection {
  const fixture = loadV1Fixtures().find(item => item.id === V1_FIXTURE_ID)!;
  return fallbackVisualDirection({transcript: fixture.transcript, sourceDurationSec: fixture.sourceDurationSec, momentCount: 4});
}

// ---- v2: crafted creative plan -------------------------------------------------------------------------------------------

const DURATION = 40;
const words = Array.from({length: 80}, (_, i) => ({id: `w${i}`, text: `word${i}`, start: i * 0.5, end: i * 0.5 + 0.45, sentenceId: 's0'}));
const pack = () =>
  ({words, sentences: [], userAssets: [{id: 'ub', description: 'user clip', durationSec: 9, kind: 'clip'}], occupancySlices: [], outputDurationSec: DURATION, speakerCutoutAvailable: false, requestedEdits: []}) as unknown as PerceptionPack;
export const v2Element = (kind: string, from: number, to: number, extra: Record<string, unknown> = {}): CreativeElement =>
  ({id: `e_${kind}`, beatId: 'b', intent: `purpose of ${kind}`, kind, wordRange: {startWordId: `w${from}`, endWordId: `w${to}`}, params: {}, ...extra}) as unknown as CreativeElement;
const planOf = (elements: CreativeElement[]): CreativePlan =>
  ({editThesis: 't', editThesisParts: {} as never, hookTitle: '', hookStyle: 'bold' as never, caption: undefined as never, preferredLutId: '', suggestedLutIds: [], elements, estimatedCostUsd: 0, promptVersion: 'audit', inputHash: 'audit', raw: {}}) as unknown as CreativePlan;

export type V2Case = {label: string; element: CreativeElement};
export const V2_CASES: V2Case[] = [
  {label: 'kinetic explicit', element: v2Element('kinetic_text', 12, 19, {text: 'Say it plainly', accentColor: '#000000', textColor: '#000000', params: {shape: 'pill'}})},
  {label: 'kinetic defaulted', element: v2Element('kinetic_text', 12, 19, {text: 'Say it plainly', params: {shape: 'pill'}})},
  {label: 'emphasis explicit', element: v2Element('emphasis', 12, 16, {text: 'real connection', accentColor: '#000000'})},
  {label: 'emphasis defaulted', element: v2Element('emphasis', 12, 16, {text: 'real connection'})},
  {label: 'container explicit', element: v2Element('media_container', 12, 20, {text: 'The plan', params: {containerMode: 'card', canvasColor: '#000000'}})},
  {label: 'container defaulted', element: v2Element('media_container', 12, 20, {text: 'The plan', params: {containerMode: 'card'}})},
  {label: 'frame margin explicit black', element: v2Element('frame_inset', 12, 21, {params: {scale: 0.8, marginColor: '#000000'}})},
  {label: 'frame canvas colour', element: v2Element('frame_inset', 12, 21, {params: {scale: 0.8, canvasColor: '#222222'}})},
  {label: 'frame accent colour', element: v2Element('frame_inset', 12, 21, {accentColor: '#333333', params: {scale: 0.8}})},
  {label: 'frame defaulted', element: v2Element('frame_inset', 12, 21, {params: {scale: 0.8}})},
  {label: 'frame invalid colour', element: v2Element('frame_inset', 12, 21, {params: {scale: 0.8, marginColor: 'teal'}})},
];

export type V2Snapshot = {label: string; direction: VisualDirection; planned: VisualPlan; finalizedNoProfile: FinalizeResult; finalizedProfile: FinalizeResult};

export async function runV2(deps: Deps, testCase: V2Case): Promise<V2Snapshot> {
  const compiled = await compileCreativePlan({pack: pack(), plan: planOf([testCase.element]), noRepair: true});
  deps.setDirection({...compiled.direction, estimatedCostUsd: 0});
  const timeline = buildTimeline([{sourceStart: 0, sourceEnd: DURATION, outputStart: 0}] as never);
  const captionWords = words.map(word => ({text: word.text, start: word.start, end: word.end, sentenceIndex: 0}));
  const plan = await deps.planBRoll({transcript: 'word0', sourceDurationSec: DURATION, timeline, words: captionWords as never, captionWords: captionWords as never, requestedEdits: null, directorV2: true} as never);
  const triggers = resolveDirectedZooms({directed: plan.zooms, words: captionWords as never, timeline, scale: 1.25, maxDurationSec: 3.2, alreadyOutput: true, trace: zoomResolutionTrace(plan.ledger!)});
  const items = {motionGraphics: plan.motionGraphics, mediaContainers: plan.mediaContainers, semanticEmphasis: plan.semanticEmphasis};
  const finalizedNoProfile = finalize(plan, items, DURATION, null, triggers);
  const finalizedProfile = finalize(plan, items, DURATION, parseContentProfile(PROFILE_RESPONSE), triggers);
  return {label: testCase.label, direction: compiled.direction, planned: plan, finalizedNoProfile, finalizedProfile};
}
