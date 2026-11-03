/**
 * Machine-checkable invariants over a replay result. Each returns pass/fail plus diagnostics that name the case,
 * the edit and the rule, so a failure is reproducible from the case id alone. No scores, no judgement.
 */

import {buildConflictEdits, ledgerIdResolver, validateEdits, type EditPlanView} from '../lib/editConflicts.ts';
import {outcomeOf, type LedgerEntry} from '../lib/editLedger.ts';
import {classifyReason} from '../lib/reasonRegistry.ts';
import {MAX_RETIME_SEC} from '../stages/broll/brollPlanner.ts';
import {normalizeZoomFocus, normalizeZoomScale} from '../stages/filters/autoZoom.ts';
/** The renderer's zod schemas, injected by the test (this module stays free of imports from the remotion package). */
export type BlueprintSchemas = Record<
  'brollClip' | 'visualOverlay' | 'insetRevealClip' | 'frameInset' | 'mediaContainer' | 'motionGraphic' | 'semanticEmphasis' | 'depthOverlayClip' | 'transitionClip' | 'zoomTrigger',
  {safeParse: (value: unknown) => {success: boolean; error?: unknown}}
>;

import {canonicalJson} from './canonical.ts';
import type {ReplayResult} from './replayCore.ts';

export type InvariantResult = {id: string; title: string; pass: boolean; failures: string[]};

const result = (id: string, title: string, failures: string[]): InvariantResult => ({id, title, pass: failures.length === 0, failures});
const near = (a: number, b: number, tolerance = 0.06) => Math.abs(a - b) <= tolerance;

/** Which plan array a ledger edit type lives in after planning. */
function planItemsFor(type: LedgerEntry['type'], r: ReplayResult): Array<{start: number}> | null {
  const {plan, zoomTriggers, finalized} = r;
  switch (type) {
    case 'cutaway':
      return plan.clips;
    case 'split':
    case 'card':
    case 'cutout':
    case 'bubble':
    case 'lockup':
    case 'pip':
    case 'composite':
      return plan.overlays;
    case 'zoom':
      return zoomTriggers;
    case 'inset_reveal':
      return plan.insetReveals;
    case 'frame_inset':
      return finalized.frameInsets;
    case 'media_container':
      return finalized.mediaContainers;
    case 'kinetic_text':
      return finalized.motionGraphics;
    case 'emphasis':
      return finalized.semanticEmphasis;
    case 'depth_overlay':
      return plan.depthOverlays;
    case 'transition':
      return plan.transitions.map(transition => ({start: transition.at}));
    case 'hook_title':
      return plan.hookTitle ? [{start: plan.hookStartSec ?? 0}] : [];
    default:
      return null;
  }
}

/** M1 — survival: every proposal is resolved; every surviving edit is in the array its renderer track reads and parses. */
export function checkSurvival(r: ReplayResult, schemas: BlueprintSchemas): InvariantResult {
  const failures: string[] = [];
  const entries = r.plan.ledger!.entries();
  for (const entry of entries) {
    const outcome = outcomeOf(entry);
    if (outcome === 'proposed_only') {
      failures.push(`${entry.id}: never resolved (proposed_only)`);
      continue;
    }
    if (outcome === 'dropped' || outcome === 'rejected') {
      continue;
    }
    const items = planItemsFor(entry.type, r);
    const final = entry.final;
    if (items && final && !items.some(item => near(item.start, final.start, 0.25))) {
      failures.push(`${entry.id}: ${outcome} at ${final.start}s but no ${entry.type} in the plan array starts there`);
    }
  }
  const parse = (name: string, schema: {safeParse: (v: unknown) => {success: boolean; error?: unknown}}, list: unknown[]) => {
    list.forEach((item, index) => {
      const parsed = schema.safeParse(item);
      if (!parsed.success) {
        failures.push(`${name}[${index}] fails the blueprint schema: ${JSON.stringify((parsed as {error: {issues?: unknown[]}}).error?.issues?.[0] ?? '')}`);
      }
    });
  };
  parse('brollClips', schemas.brollClip, r.plan.clips);
  parse('visualOverlays', schemas.visualOverlay, r.plan.overlays);
  parse('insetReveals', schemas.insetRevealClip, r.plan.insetReveals);
  parse('frameInsets', schemas.frameInset, r.finalized.frameInsets);
  parse('mediaContainers', schemas.mediaContainer, r.finalized.mediaContainers);
  parse('motionGraphics', schemas.motionGraphic, r.finalized.motionGraphics);
  parse('semanticEmphasis', schemas.semanticEmphasis, r.finalized.semanticEmphasis);
  parse('depthOverlays', schemas.depthOverlayClip, r.plan.depthOverlays);
  parse('transitions', schemas.transitionClip, r.plan.transitions);
  parse('zoomTriggers', schemas.zoomTrigger, r.zoomTriggers);
  return result('M1', 'survival: resolved, present in the renderer array, schema-valid', failures);
}

/** Stage that is allowed to emit a reason (a reason from the wrong stage means the ledger blamed the wrong code path). */
const REASON_STAGE: Array<[RegExp, string[]]> = [
  [/^not_in_edit_allowlist$/, ['visual_director']],
  [/^(zoom_blocked_by_cutaway_or_overlay|zoom_before_|zoom_within_|zoom_cap_|transition_not_near_a_visual|transition_cap_|cutaway_cap_|phrase_card_capped_at_)/, ['editorial_gate']],
  [/^zoom_has_no_duration_after_timeline_mapping$/, ['plan_assembly']],
  [/^no_mask$/, ['depth_planner']],
  [/^(spatial_|temporal_)/, ['conflict_validator']],
  [/^overlaps_/, ['plan_assembly']],
];

/** M2 — every non-surviving edit has a stage and a REGISTERED reason from the right stage. */
export function checkRefusalPrecision(r: ReplayResult): InvariantResult {
  const failures: string[] = [];
  for (const entry of r.plan.ledger!.entries()) {
    for (const event of entry.events) {
      if (event.decision !== 'dropped' && event.decision !== 'rejected') {
        continue;
      }
      if (!event.stage) {
        failures.push(`${entry.id}: ${event.decision} without a stage`);
      }
      const known = classifyReason(event.reason);
      if (!known.registered) {
        failures.push(`${entry.id}: ${event.decision} at ${event.stage} with unregistered reason ${JSON.stringify(event.reason)}`);
        continue;
      }
      const stages = REASON_STAGE.find(([pattern]) => pattern.test(event.reason ?? ''))?.[1];
      if (stages && !stages.includes(event.stage)) {
        failures.push(`${entry.id}: reason ${event.reason} reported by ${event.stage}, expected ${stages.join('|')}`);
      }
    }
    for (const event of entry.events) {
      if (event.decision === 'accepted' && event.reason && !classifyReason(event.reason).registered) {
        failures.push(`${entry.id}: accepted note ${JSON.stringify(event.reason)} is not registered`);
      }
    }
  }
  return result('M2', 'refusal precision: stage + registered reason, from the stage that decided', failures);
}

/** M4/M5 — time and parameter preservation. */
export function checkPreservation(r: ReplayResult): InvariantResult {
  const failures: string[] = [];
  const duration = r.timeline.outputDurationSec;
  for (const entry of r.plan.ledger!.entries()) {
    if (!entry.final) {
      continue;
    }
    if (entry.final.start < -1e-6 || entry.final.end > duration + 0.05) {
      failures.push(`${entry.id}: final span ${entry.final.start}–${entry.final.end} outside the output timeline 0–${duration}`);
    }
    const accepted = entry.events.filter(event => event.decision === 'accepted');
    const hasBoth = accepted.some(event => event.change?.from && event.change?.to);
    const moved = Math.abs(entry.final.start - entry.proposed.start);
    if (entry.type !== 'hook_title' && moved > MAX_RETIME_SEC + 1e-6 && !hasBoth) {
      failures.push(`${entry.id}: moved ${moved.toFixed(2)}s from the proposed time without recording both spans`);
    }
  }
  // Zooms: trigger time is the directed time mapped through the trim; scale/focus are kept or ignored with a note.
  for (const zoom of r.plan.zooms) {
    const expected = r.timeline.mapSourceToOutputClamped(zoom.timestamp);
    const trigger = r.zoomTriggers.find(candidate => near(candidate.start, expected, 0.011));
    if (!trigger) {
      const dropped = r.plan.ledger!.entries().some(entry => entry.type === 'zoom' && outcomeOf(entry) === 'dropped');
      if (!dropped) {
        failures.push(`zoom@${zoom.timestamp}: no trigger at the mapped time ${expected.toFixed(2)} and no drop recorded`);
      }
      continue;
    }
    const scale = normalizeZoomScale(zoom.scale);
    if (scale !== undefined && trigger.scale !== scale) {
      failures.push(`zoom@${zoom.timestamp}: scale ${scale} became ${trigger.scale}`);
    }
    const focus = normalizeZoomFocus(zoom.focus);
    if (focus && JSON.stringify(trigger.focus) !== JSON.stringify(focus)) {
      failures.push(`zoom@${zoom.timestamp}: focus ${JSON.stringify(focus)} became ${JSON.stringify(trigger.focus)}`);
    }
    if (!focus && trigger.focus) {
      failures.push(`zoom@${zoom.timestamp}: a focus appeared that the Director did not give`);
    }
  }
  return result('M4/M5', 'preservation: output-time bounds, recorded moves, zoom time/scale/focus', failures);
}

/** M6 — no silent no-op: an accepted edit reaches a renderer track, or says why it does not. */
export function checkNoSilentNoop(r: ReplayResult): InvariantResult {
  const failures: string[] = [];
  for (const entry of r.plan.ledger!.entries()) {
    const outcome = outcomeOf(entry);
    if (outcome === 'accepted_not_rendered') {
      failures.push(`${entry.id}: accepted but never handed to a renderer track`);
    }
    const last = entry.events.at(-1)!;
    if (outcome === 'rendered_not_apparent' && !last.reason) {
      failures.push(`${entry.id}: rendered as a no-op with no reason`);
    }
  }
  return result('M6', 'no silent no-op: accepted edits reach a track or carry a no-op reason', failures);
}

/** M9 — the final plan is stable under the same conflict validator that produced it (nothing left to move or drop). */
export function checkConflictIdempotence(r: ReplayResult): InvariantResult {
  const failures: string[] = [];
  const view: EditPlanView = {
    durationSec: r.timeline.outputDurationSec,
    hook: {text: r.plan.hookTitle, start: r.plan.hookStartSec ?? 0, end: (r.plan.hookStartSec ?? 0) + r.plan.hookDurationSec, anchor: 'top_left'},
    captionDirection: {position: r.finalized.caption.position, bottomFrac: r.finalized.caption.bottomFrac},
    brollClips: r.plan.clips,
    visualOverlays: r.plan.overlays,
    insetReveals: r.plan.insetReveals,
    frameInsets: r.finalized.frameInsets,
    mediaContainers: r.finalized.mediaContainers,
    motionGraphics: r.finalized.motionGraphics,
    semanticEmphasis: r.finalized.semanticEmphasis,
    generatedGraphics: r.finalized.generatedGraphics,
    speaker: {box: {x: 0.18, y: 0.16, w: 0.64, h: 0.62}, source: 'fallback'},
  };
  const edits = buildConflictEdits(view, ledgerIdResolver(r.plan.ledger!));
  for (const decision of validateEdits(view, edits)) {
    if (decision.action === 'drop' || decision.action === 'relocate' || decision.action === 'shorten') {
      failures.push(`${decision.id}: the final plan still needs a ${decision.action} (${decision.reason})`);
    }
  }
  return result('M9', 'conflict-stable: re-validating the final plan changes nothing', failures);
}

/** M3 — determinism: the same Director content in any array order gives the same canonical result. */
export function checkPermutation(base: ReplayResult, others: Array<{label: string; result: ReplayResult}>): InvariantResult {
  const failures: string[] = [];
  const reference = canonicalJson(base.canonical);
  for (const other of others) {
    const text = canonicalJson(other.result.canonical);
    if (text !== reference) {
      const a = reference.split('\n');
      const b = text.split('\n');
      const at = a.findIndex((line, index) => line !== b[index]);
      failures.push(`order ${other.label}: first difference at canonical line ${at + 1}: ${JSON.stringify(a[at])} vs ${JSON.stringify(b[at])}`);
    }
  }
  return result('M3', 'determinism under input-array permutation', failures);
}

export function runAll(base: ReplayResult, permuted: Array<{label: string; result: ReplayResult}>, schemas: BlueprintSchemas): InvariantResult[] {
  return [checkSurvival(base, schemas), checkRefusalPrecision(base), checkPermutation(base, permuted), checkPreservation(base), checkNoSilentNoop(base), checkConflictIdempotence(base)];
}

/** D-report: computed facts for reviewers. Never pass/fail. */
export function densityReport(r: ReplayResult) {
  const duration = r.timeline.outputDurationSec;
  // Captions span the whole video and are always present, so they say nothing about editing density; no-op edits are not visible.
  const survivors = r.plan.ledger!.entries().filter(entry => entry.type !== 'caption' && ['accepted', 'rendered', 'accepted_not_rendered'].includes(outcomeOf(entry)));
  const noop = r.plan.ledger!.entries().filter(entry => outcomeOf(entry) === 'rendered_not_apparent').length;
  const byKind: Record<string, number> = {};
  for (const entry of survivors) {
    byKind[entry.type] = (byKind[entry.type] ?? 0) + 1;
  }
  const full = survivors.filter(entry => ['cutaway', 'split', 'cutout', 'frame_inset', 'media_container', 'inset_reveal'].includes(entry.type) && entry.final);
  const coveredSec = full.reduce((sum, entry) => sum + (entry.final!.end - entry.final!.start), 0);
  const spans = survivors.filter(entry => entry.final).map(entry => entry.final!).sort((a, b) => a.start - b.start);
  let longestGap = 0;
  let cursor = 0;
  for (const span of spans) {
    longestGap = Math.max(longestGap, span.start - cursor);
    cursor = Math.max(cursor, span.end);
  }
  longestGap = Math.max(longestGap, duration - cursor);
  const proposed = r.plan.ledger!.entries().length;
  return {
    outputDurationSec: duration,
    proposed,
    visibleSurvivors: survivors.length,
    renderedAsNoop: noop,
    survivorsByKind: byKind,
    editsPerMinute: Number(((survivors.length / duration) * 60).toFixed(2)),
    fullFrameCoverageFraction: Number((coveredSec / duration).toFixed(3)),
    longestUneditedStretchSec: Number(longestGap.toFixed(2)),
    survivorsWithoutReason: survivors.filter(entry => !entry.reason && !entry.events.some(event => event.reason)).length,
  };
}
