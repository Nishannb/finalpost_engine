/**
 * Reconstruct a (partial) edit ledger from the artifacts older runs saved:
 * the Director's parsed response (`01-gemini-director.json`) and the engine's
 * visual plan (`03-engine-visual-plan.json`).
 *
 * Those files record WHAT was proposed and WHAT survived, not the rule that removed
 * an edit, so every unmatched proposal is reported as `unknown_cause_not_recorded`
 * (with the plan's warnings attached) rather than guessed. Runs made after the
 * ledger existed carry exact reasons in `06-edit-ledger.json`.
 */

import {EditLedger, type LedgerDump, type LedgerEditType} from './editLedger.ts';

type Span = {start: number; end: number};

export type SavedDirectorResponse = {
  hookTitle?: string;
  zooms?: Array<{timestamp: number; durationSec: number}>;
  moments?: Array<{timestamp: number; layout: string; searchKeyword: string; overlayText?: string}>;
  depthOverlays?: Array<Span & {assetId?: string}>;
  insetReveals?: Array<Span & {variant?: string}>;
  motionGraphics?: Array<Span & {text: string}>;
  mediaContainers?: Array<Span & {mode?: string}>;
  frameInsets?: Array<Span>;
  semanticEmphasis?: Array<Span & {text: string}>;
};

export type SavedVisualPlan = {
  hookTitle?: string;
  zooms?: Array<{timestamp: number; durationSec: number}>;
  clips?: Array<Span & {keyword: string}>;
  overlays?: Array<Span & {layout: string; text?: string}>;
  depthOverlays?: Span[];
  insetReveals?: Span[];
  transitions?: Array<{at: number}>;
  motionGraphics?: Array<Span & {text: string}>;
  mediaContainers?: Span[];
  frameInsets?: Span[];
  semanticEmphasis?: Array<Span & {text: string}>;
  warnings?: string[];
};

const SHIFT_TOLERANCE_SEC = 2;
const near = (a: number, b: number) => Math.abs(a - b) <= SHIFT_TOLERANCE_SEC;
const UNKNOWN = 'unknown_cause_not_recorded';

const momentType = (layout: string): LedgerEditType =>
  (['cutaway', 'split', 'cutout', 'composite', 'pip', 'bubble'] as string[]).includes(layout) ? (layout as LedgerEditType) : ['lockup', 'chip', 'banner', 'stat'].includes(layout) ? 'lockup' : 'card';

export function backfillLedger(response: SavedDirectorResponse, plan: SavedVisualPlan): LedgerDump {
  const ledger = new EditLedger();
  ledger.setProfile({present: false});
  const warnings = (plan.warnings ?? []).slice(0, 6).join(',');
  const lost = (id: string, extra = '') => ledger.drop(id, 'plan_assembly', `${UNKNOWN}${extra}`, {precision: 'stage_warnings'});
  const settle = (id: string, final: Span | undefined) => {
    if (final) {
      ledger.accept(id, 'plan_assembly', {to: {start: final.start, end: final.end}});
      ledger.rendered(id, 'blueprint');
    } else {
      lost(id, warnings ? `; plan warnings: ${warnings}` : '');
    }
  };

  if (response.hookTitle?.trim()) {
    settle(ledger.propose({type: 'hook_title', stage: 'visual_director', start: 0, end: 0, label: response.hookTitle}), plan.hookTitle ? {start: 0, end: 0} : undefined);
  }

  const takenZooms = new Set<number>();
  for (const zoom of response.zooms ?? []) {
    const id = ledger.propose({type: 'zoom', stage: 'visual_director', start: zoom.timestamp, end: zoom.timestamp + zoom.durationSec, label: 'zoom'});
    const index = (plan.zooms ?? []).findIndex((kept, i) => !takenZooms.has(i) && near(kept.timestamp, zoom.timestamp));
    if (index >= 0) {
      takenZooms.add(index);
    }
    const kept = plan.zooms?.[index];
    settle(id, kept ? {start: kept.timestamp, end: kept.timestamp + kept.durationSec} : undefined);
  }

  // Cutaways are re-anchored to where their keyword is spoken, so match by keyword rather than by time.
  const takenClips = new Set<number>();
  for (const moment of response.moments ?? []) {
    const type = momentType(moment.layout);
    const id = ledger.propose({type, stage: 'visual_director', start: moment.timestamp, end: moment.timestamp, label: moment.overlayText || moment.searchKeyword});
    const pool = type === 'cutaway' ? plan.clips ?? [] : (plan.overlays ?? []).filter(overlay => overlay.layout === moment.layout);
    const index = pool.findIndex((kept, i) => !takenClips.has(type === 'cutaway' ? i : -1 - i) && ('keyword' in kept ? (kept as {keyword: string}).keyword === moment.searchKeyword : near(kept.start, moment.timestamp)));
    const kept = pool[index];
    if (kept) {
      takenClips.add(type === 'cutaway' ? index : -1 - index);
    }
    settle(id, kept);
  }

  // Planners emit `drop:<id>:<reason>` per item, so those drops ARE exact; the saved plan also names
  // which surviving edits occupy the dropped edit's window.
  const exactDrops = new Map<string, string>();
  for (const warning of plan.warnings ?? []) {
    const match = /^drop:([^:]+):(.+)$/.exec(warning);
    if (match) {
      exactDrops.set(match[1]!, match[2]!);
    }
  }
  const survivors = () =>
    ledger
      .entries()
      .filter(entry => entry.final && ['cutaway', 'split', 'cutout', 'composite', 'depth_overlay', 'frame_inset', 'media_container'].includes(entry.type));
  const timed = <T extends Span>(
    type: LedgerEditType,
    proposed: T[] | undefined,
    kept: Span[] | undefined,
    label: (item: T) => string,
    plannerIds: (item: T, index: number) => string[] = () => [],
  ) => {
    const taken = new Set<number>();
    (proposed ?? []).forEach((item, itemIndex) => {
      const id = ledger.propose({type, stage: 'visual_director', start: item.start, end: item.end, label: label(item)});
      const index = (kept ?? []).findIndex((candidate, i) => !taken.has(i) && near(candidate.start, item.start));
      if (index >= 0) {
        taken.add(index);
      }
      const exact = plannerIds(item, itemIndex).map(plannerId => exactDrops.get(plannerId)).find(Boolean);
      if (!kept?.[index] && exact) {
        const occupying = survivors()
          .filter(entry => entry.final!.start < item.end + 1 && entry.final!.end > item.start - 1)
          .map(entry => entry.id);
        ledger.drop(id, type === 'depth_overlay' ? 'depth_planner' : 'inset_planner', exact, {conflictsWith: /overlap/.test(exact) ? occupying : []});
        return;
      }
      settle(id, kept?.[index]);
    });
  };
  timed('depth_overlay', response.depthOverlays, plan.depthOverlays, item => item.assetId ?? 'depth', (item, index) => [item.assetId || `depth_${index}`, `depth_stock_${index}`]);
  timed('inset_reveal', response.insetReveals, plan.insetReveals, item => item.variant ?? 'inset', (_item, index) => [`inset_${index}`]);
  timed('kinetic_text', response.motionGraphics, plan.motionGraphics, item => item.text);
  timed('media_container', response.mediaContainers, plan.mediaContainers, item => item.mode ?? 'container');
  timed('frame_inset', response.frameInsets, plan.frameInsets, () => 'frame');
  timed('emphasis', response.semanticEmphasis, plan.semanticEmphasis, item => item.text);

  return ledger.toJSON();
}
