/**
 * Ledger plumbing for the visual planner: records what the Director proposed and
 * attributes each later disappearance to the stage and rule that caused it.
 * Observation only; nothing here decides whether an edit survives.
 */

import {EditLedger, ledgerLabel, type LedgerEditType, type LedgerStage, type LedgerPrerequisite} from '../../lib/editLedger.ts';
import type {VisualOverlayLayout} from '../../types/blueprint.ts';
import type {VisualDirection} from './geminiDirector.ts';

export type DirectionIds = Map<object, string>;

export const LEDGER_ID = Symbol('ledgerId');

/** The ledger id carried on a (possibly copied) object, if any. */
export const ledgerIdOf = (item: object | undefined | null): string | undefined =>
  item ? (item as {[LEDGER_ID]?: string})[LEDGER_ID] : undefined;

export function momentEditType(layout: VisualOverlayLayout | string): LedgerEditType {
  switch (layout) {
    case 'cutaway':
    case 'split':
    case 'cutout':
    case 'composite':
    case 'pip':
    case 'bubble':
      return layout;
    case 'lockup':
    case 'chip':
    case 'banner':
    case 'stat':
      return 'lockup';
    default:
      return 'card';
  }
}

export type ProposalContext = {
  /** Maps a Director time to output time (identity when the Director already used output time). */
  toOutput: (sec: number) => number;
  hookDurationSec: number;
  maskAvailable: boolean;
  cutoutAvailable: boolean;
};

export function proposeDirection(ledger: EditLedger, direction: VisualDirection, ctx: ProposalContext): DirectionIds {
  const ids: DirectionIds = new Map();
  const fallback = direction.source === 'fallback';
  const from = fallback ? 'engine_fallback_direction' : undefined;
  const add = (item: object, input: Parameters<EditLedger['propose']>[0]) => {
    ids.set(item, ledger.propose({...input, reason: input.reason ?? from}));
  };

  if (direction.hookTitle?.trim()) {
    const start = direction.hookStartSec ?? 0;
    const end = direction.hookEndSec ?? start + ctx.hookDurationSec;
    add(direction, {type: 'hook_title', stage: 'visual_director', start: ctx.toOutput(start), end: ctx.toOutput(end), label: direction.hookTitle});
  }
  for (const zoom of direction.zooms ?? []) {
    add(zoom, {type: 'zoom', stage: 'visual_director', start: ctx.toOutput(zoom.timestamp), end: ctx.toOutput(zoom.timestamp + zoom.durationSec), label: 'zoom'});
  }
  for (const moment of direction.moments ?? []) {
    const type = momentEditType(moment.layout);
    const prerequisites: LedgerPrerequisite[] =
      type === 'cutout' ? [{name: 'speaker_cutout_available', satisfied: ctx.cutoutAvailable}] : [];
    const start = ctx.toOutput(moment.timestamp);
    add(moment, {type, stage: 'visual_director', start, end: start, label: moment.overlayText || moment.searchKeyword, prerequisites});
  }
  for (const item of direction.depthOverlays ?? []) {
    add(item, {
      type: 'depth_overlay',
      stage: 'visual_director',
      start: ctx.toOutput(item.start),
      end: ctx.toOutput(item.end),
      label: item.assetId || item.searchKeyword,
      reason: item.reason,
      prerequisites: [{name: 'subject_mask_available', satisfied: ctx.maskAvailable}],
    });
  }
  for (const item of direction.transitions ?? []) {
    add(item, {type: 'transition', stage: 'visual_director', start: ctx.toOutput(item.start), end: ctx.toOutput(item.end), label: item.style || 'transition'});
  }
  for (const item of direction.insetReveals ?? []) {
    add(item, {type: 'inset_reveal', stage: 'visual_director', start: ctx.toOutput(item.start), end: ctx.toOutput(item.end), label: item.variant, reason: item.reason});
  }
  for (const item of direction.motionGraphics ?? []) {
    add(item, {type: 'kinetic_text', stage: 'visual_director', start: ctx.toOutput(item.start), end: ctx.toOutput(item.end), label: item.text});
  }
  for (const item of direction.mediaContainers ?? []) {
    add(item, {type: 'media_container', stage: 'visual_director', start: ctx.toOutput(item.start), end: ctx.toOutput(item.end), label: item.mode});
  }
  for (const item of direction.frameInsets ?? []) {
    add(item, {type: 'frame_inset', stage: 'visual_director', start: ctx.toOutput(item.start), end: ctx.toOutput(item.end), label: 'frame'});
  }
  for (const item of direction.semanticEmphasis ?? []) {
    add(item, {type: 'emphasis', stage: 'visual_director', start: ctx.toOutput(item.start), end: ctx.toOutput(item.end), label: item.text});
  }
  return ids;
}

const CATEGORIES = ['zooms', 'transitions', 'moments', 'depthOverlays', 'insetReveals', 'motionGraphics', 'mediaContainers', 'frameInsets', 'semanticEmphasis'] as const;

/** Items the allowlist filter removed (the Director proposed them, but the request did not permit the toolkit). */
export function recordAllowlistRejections(ledger: EditLedger, ids: DirectionIds, before: VisualDirection, after: VisualDirection): void {
  for (const category of CATEGORIES) {
    const kept = new Set<object>(after[category] ?? []);
    for (const item of before[category] ?? []) {
      const id = ids.get(item);
      if (id && !kept.has(item)) {
        ledger.reject(id, 'visual_director', 'not_in_edit_allowlist');
      }
    }
  }
}

/** Items added by the engine to satisfy a required toolkit (not proposed by the model). */
export function recordEngineFills(ledger: EditLedger, ids: DirectionIds, direction: VisualDirection, ctx: ProposalContext): void {
  const known = new Set(ids.keys());
  const fresh = {...direction} as VisualDirection;
  for (const category of CATEGORIES) {
    (fresh as Record<string, unknown>)[category] = (direction[category] ?? []).filter(item => !known.has(item));
  }
  fresh.hookTitle = '';
  for (const [item, id] of proposeDirection(ledger, fresh, ctx)) {
    ids.set(item, id);
    const entry = ledger.get(id);
    if (entry && !entry.reason) {
      entry.reason = 'engine_fill: required edit style was not placed by the Director';
    }
  }
}

/** Tracing hooks for the remap functions: keep → accepted with its output span; drop → dropped with the rule. */
export function remapTrace<T extends {start: number; end: number}>(ledger: EditLedger, ids: DirectionIds) {
  return {
    drop: (item: T, reason: string) => {
      const id = ids.get(item);
      if (id) {
        ledger.drop(id, 'plan_assembly', reason);
      }
    },
    keep: (item: T, out: T) => {
      const id = ids.get(item);
      if (id) {
        ledger.accept(id, 'plan_assembly', {...(ledger.get(id) ? {from: ledger.get(id)!.proposed} : {}), to: {start: out.start, end: out.end}});
      }
    },
  };
}

/** Exact per-item reason strings the inset / depth planners already emit, keyed by planner id. */
export function plannerDropReasons(warnings: string[]): Map<string, string> {
  const reasons = new Map<string, string>();
  for (const warning of warnings) {
    const match = /^drop:([^:]+):(.+)$/.exec(warning);
    if (match) {
      reasons.set(match[1]!, match[2]!);
    }
  }
  return reasons;
}

export type SpanLike = {start: number; end: number};

/**
 * Attribute inset / depth outcomes: a `drop:<id>:<reason>` warning is exact; an item
 * with an output clip is accepted; otherwise the planner warnings are attached as
 * the (imprecise) reason.
 */
export function recordPlannerOutcome<D extends object>(
  ledger: EditLedger,
  ids: DirectionIds,
  directed: D[],
  outputs: SpanLike[],
  options: {stage: LedgerStage; plannerIds: (item: D, index: number) => string[]; warnings: string[]; toOutput: (sec: number) => number; startOf: (item: D) => number},
): void {
  const reasons = plannerDropReasons(options.warnings);
  const tolerance = 1.5;
  directed.forEach((item, index) => {
    const id = ids.get(item);
    if (!id) {
      return;
    }
    const entry = ledger.get(id);
    if (!entry || entry.events.at(-1)?.decision === 'rejected') {
      return;
    }
    const exact = options.plannerIds(item, index).map(plannerId => reasons.get(plannerId)).find(Boolean);
    if (exact) {
      ledger.drop(id, options.stage, exact);
      return;
    }
    const start = options.toOutput(options.startOf(item));
    const output = outputs.find(clip => Math.abs(clip.start - start) <= tolerance);
    if (output) {
      ledger.accept(id, options.stage, {from: entry.proposed, to: {start: output.start, end: output.end}});
      return;
    }
    const related = options.warnings.filter(warning => /^depth_overlay_|^inset_/.test(warning)).map(warning => ledgerLabel(warning, 60));
    ledger.drop(id, options.stage, related.length > 0 ? `planner_warning:${related[0]}` : 'not_in_planner_output', {precision: 'stage_warnings'});
  });
}
