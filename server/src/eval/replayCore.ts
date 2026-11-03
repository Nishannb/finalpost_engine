/**
 * Deterministic replay of a SAVED v1 Director response through the real planner stages.
 *
 *   parse (parseVisualDirectorJson) → planBRoll → resolveDirectedZooms → finalizeEdits
 *
 * Stock search and the Director call are stubbed by the caller (vitest mocks in harness.test.ts); nothing here touches
 * the network. What is NOT exercised: analyzeVideo's blueprint assembly and any rendering.
 */

import {resolveDirectedZooms} from '../stages/filters/autoZoom.ts';
import {buildTimeline, type Timeline} from '../stages/filters/timeline.ts';
import {parseVisualDirectorJson, type VisualDirection} from '../stages/broll/geminiDirector.ts';
import {finalizeEdits, zoomResolutionTrace, type FinalizeResult} from '../pipeline/finalizeEdits.ts';
import type {VisualPlan} from '../stages/broll/brollPlanner.ts';
import type {ZoomTrigger} from '../types/blueprint.ts';
import {canonicalize} from './canonical.ts';
import type {V1Fixture} from './fixtures.ts';

export type ReplayDeps = {
  setDirection: (direction: VisualDirection) => void;
  planBRoll: (input: never) => Promise<VisualPlan>;
};

export type ReplayResult = {
  fixture: V1Fixture;
  timeline: Timeline;
  direction: VisualDirection;
  plan: VisualPlan;
  zoomTriggers: ZoomTrigger[];
  finalized: FinalizeResult;
  canonical: unknown;
};

const DIRECTION_ARRAYS = ['zooms', 'moments', 'insetReveals', 'motionGraphics', 'mediaContainers', 'frameInsets', 'semanticEmphasis', 'depthOverlays', 'transitions'] as const;

/** Reorders every array in a direction. `reverse` or a seeded shuffle; the content is unchanged. */
export function permuteDirection(direction: VisualDirection, mode: 'identity' | 'reverse' | number): VisualDirection {
  if (mode === 'identity') {
    return direction;
  }
  const copy = {...direction} as Record<string, unknown>;
  let state = typeof mode === 'number' ? mode : 1;
  const rand = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  for (const key of DIRECTION_ARRAYS) {
    const list = (direction as unknown as Record<string, unknown[] | undefined>)[key];
    if (!list) {
      continue;
    }
    const next = [...list];
    if (mode === 'reverse') {
      next.reverse();
    } else {
      for (let i = next.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rand() * (i + 1));
        [next[i], next[j]] = [next[j]!, next[i]!];
      }
    }
    copy[key] = next;
  }
  return copy as unknown as VisualDirection;
}

export function parseFixtureDirection(fixture: V1Fixture): VisualDirection {
  return {...parseVisualDirectorJson(fixture.rawResponse, fixture.sourceDurationSec, fixture.transcript), estimatedCostUsd: 0, source: 'gemini'} as VisualDirection;
}

export async function replayV1(fixture: V1Fixture, deps: ReplayDeps, permutation: 'identity' | 'reverse' | number = 'identity', mutate?: (direction: VisualDirection) => VisualDirection): Promise<ReplayResult> {
  const timeline = buildTimeline(fixture.keepSegments as never);
  const parsed = parseFixtureDirection(fixture);
  const direction = permuteDirection(mutate ? mutate(parsed) : parsed, permutation);
  deps.setDirection({...direction, hookSubtitle: '', estimatedCostUsd: 0, source: 'gemini'} as VisualDirection);
  const plan = await deps.planBRoll({
    transcript: fixture.transcript,
    sourceDurationSec: fixture.sourceDurationSec,
    timeline,
    words: fixture.words,
    captionWords: fixture.captionWords,
    requestedEdits: fixture.requestedEdits,
    captionTemplate: fixture.captionTemplate ?? undefined,
  } as never);
  const ledger = plan.ledger!;
  // Same call analyzeVideo makes after planning.
  const zoomTriggers = resolveDirectedZooms({
    directed: plan.zooms,
    words: fixture.words as never,
    timeline,
    scale: 1.25,
    maxDurationSec: 3.2,
    alreadyOutput: false,
    trace: zoomResolutionTrace(ledger),
  });
  const finalized = finalizeEdits({
    ledger,
    contentProfile: null,
    footageLuminance: 0.4,
    captionLocked: false,
    durationSec: timeline.outputDurationSec,
    hook: {text: plan.hookTitle, start: plan.hookStartSec ?? 0, end: (plan.hookStartSec ?? 0) + plan.hookDurationSec, anchor: 'top_left'},
    caption: plan.caption,
    brollClips: plan.clips,
    visualOverlays: plan.overlays,
    insetReveals: plan.insetReveals,
    frameInsets: plan.frameInsets,
    mediaContainers: plan.mediaContainers,
    motionGraphics: plan.motionGraphics,
    semanticEmphasis: plan.semanticEmphasis,
    depthOverlays: plan.depthOverlays,
    transitions: plan.transitions,
    zoomTriggers,
    generatedGraphics: [],
    speaker: {box: {x: 0.18, y: 0.16, w: 0.64, h: 0.62}, source: 'fallback'},
    speakerCutout: {available: false},
  });
  return {fixture, timeline, direction, plan, zoomTriggers, finalized, canonical: canonicalResult({fixture, plan, zoomTriggers, finalized})};
}

function canonicalResult(input: {fixture: V1Fixture; plan: VisualPlan; zoomTriggers: ZoomTrigger[]; finalized: FinalizeResult}) {
  const {plan, zoomTriggers, finalized} = input;
  const ledger = plan.ledger!.toJSON();
  return canonicalize({
    caseId: input.fixture.id,
    hook: {text: plan.hookTitle, start: plan.hookStartSec ?? 0, duration: plan.hookDurationSec, style: plan.hookStyle},
    clips: plan.clips.map(({start, end, keyword, assetUrl}) => ({start, end, keyword, assetUrl})),
    overlays: plan.overlays.map(({start, end, layout, overlayText, assetUrl, anchor, treatment}) => ({start, end, layout, overlayText, assetUrl, anchor, treatment})),
    insetReveals: plan.insetReveals.map(({start, end, params}) => ({start, end, variant: params.variant})),
    frameInsets: plan.frameInsets,
    mediaContainers: plan.mediaContainers,
    depthOverlays: plan.depthOverlays.map(({start, end, assetUrl}) => ({start, end, assetUrl})),
    transitions: plan.transitions.map(({at, duration, keyword}) => ({at, duration, keyword})),
    directedZooms: plan.zooms,
    zoomTriggers,
    motionGraphics: finalized.motionGraphics,
    semanticEmphasis: finalized.semanticEmphasis,
    decisions: finalized.decisions.map(({id, action, reason}) => ({id, action, reason})).sort((a, b) => a.id.localeCompare(b.id)),
    warnings: [...plan.warnings].sort(),
    ledger: [...ledger.edits]
      .map(edit => ({id: edit.id, type: edit.type, proposed: edit.proposed, final: edit.final, events: edit.events.map(event => ({stage: event.stage, decision: event.decision, reason: event.reason, track: event.track, visibility: event.visibility}))}))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
}

/** What a replay exercises. Reported with every result so coverage is never overstated. */
export const V1_REPLAY_COVERAGE = {
  level: 'saved_response_replay',
  exercised: ['parseVisualDirectorJson', 'planBRoll', 'resolveDirectedZooms', 'finalizeEdits', 'blueprint zod schemas (per item)'],
  stubbed: ['planVisualDirection (returns the saved response)', 'stock search'],
  notExercised: ['analyzeVideo blueprint assembly', 'Remotion rendering'],
} as const;
