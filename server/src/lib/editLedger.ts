/**
 * Edit-decision ledger: one correlated record per proposed edit, from the
 * Director's proposal to its final disposition. Stages append events to the
 * same entry (found by stable id), so "why did this edit disappear?" has a
 * single answer instead of a trail of unrelated warnings.
 *
 * Deterministic and cheap: no model calls, no transcript text, only short
 * labels (a keyword or the first words of an on-screen text).
 */

import {createHash} from 'node:crypto';

export const LEDGER_EDIT_TYPES = [
  'hook_title',
  'caption',
  'cutaway',
  'split',
  'card',
  'cutout',
  'bubble',
  'lockup',
  'pip',
  'composite',
  'zoom',
  'transition',
  'depth_overlay',
  'inset_reveal',
  'frame_inset',
  'media_container',
  'kinetic_text',
  'emphasis',
  'generated_graphic',
  /** Opt-in (Phase 35): text drawn between the footage and the speaker's alpha matte. */
  'behind_subject_text',
] as const;
export type LedgerEditType = (typeof LEDGER_EDIT_TYPES)[number];

export type LedgerStage =
  | 'visual_director'
  | 'moment_planner'
  | 'editorial_gate'
  | 'inset_planner'
  | 'depth_planner'
  | 'plan_assembly'
  | 'motion_director'
  | 'motion_worker'
  | 'conflict_validator'
  | 'blueprint'
  | 'renderer';

/** proposed → accepted | rejected | dropped → rendered. `accepted` may carry a change. */
export type LedgerDecision = 'proposed' | 'accepted' | 'rejected' | 'dropped' | 'rendered';

export type TimeSpan = {start: number; end: number};

export type LedgerChange = {
  /** Output-timeline span before and after, when the stage moved or trimmed the edit. */
  from?: TimeSpan;
  to?: TimeSpan;
  /** Anchor or position before/after, when the stage relocated the edit. */
  anchorFrom?: string;
  anchorTo?: string;
};

export type LedgerEvent = {
  stage: LedgerStage;
  decision: LedgerDecision;
  reason?: string;
  /** exact: the stage knew this edit's own reason. stage_warnings: attributed from the stage's warnings. */
  precision?: 'exact' | 'stage_warnings';
  conflictsWith?: string[];
  /** Finer-grained cause than `reason` (e.g. which of several conditions disabled stock lookup). Optional; `reason` stays the registered code. */
  cause?: string;
  change?: LedgerChange;
  /** Renderer events: the Remotion track that draws the edit. */
  track?: string;
  /** Renderer events: expected on-screen effect. */
  visibility?: 'visible' | 'noop';
  /** Spatial decisions made without measured geometry. */
  geometry?: 'measured' | 'estimated' | 'fallback' | 'unknown';
};

export type LedgerPrerequisite = {name: string; satisfied: boolean; detail?: string};

export type LedgerEntry = {
  id: string;
  type: LedgerEditType;
  /** Stage that first proposed the edit. */
  source: LedgerStage;
  /** Short non-sensitive label (keyword / first words of the on-screen text). */
  label: string;
  /** Output-timeline span when first recorded. */
  proposed: TimeSpan;
  /** Span in the final blueprint; null when the edit did not survive. */
  final: TimeSpan | null;
  reason?: string;
  prerequisites: LedgerPrerequisite[];
  events: LedgerEvent[];
};

export type LedgerOutcome =
  | 'rendered'
  | 'rendered_not_apparent'
  | 'accepted_not_rendered'
  | 'dropped'
  | 'rejected'
  | 'proposed_only';

export type LedgerProfileContext = {
  present: boolean;
  contentType?: string;
  structure?: string;
  density?: string;
  mood?: string;
  maxGraphics?: number;
};

export type StageContext = {profile: boolean; theme: boolean};

const round = (value: number) => Math.round(value * 1000) / 1000;
const span = (start: number, end: number): TimeSpan => ({start: round(start), end: round(end)});

export function ledgerLabel(text: string | undefined, max = 40): string {
  return (text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Stable across runs for the same proposal: type + start (ms) + short content hash. */
export function stableEditId(type: LedgerEditType, start: number, label: string): string {
  const hash = createHash('sha1').update(label.toLowerCase()).digest('hex').slice(0, 6);
  return `${type}@${Math.round(start * 1000)}#${hash}`;
}

export function outcomeOf(entry: LedgerEntry): LedgerOutcome {
  const last = entry.events.at(-1);
  if (!last) {
    return 'proposed_only';
  }
  if (last.decision === 'rejected') {
    return 'rejected';
  }
  if (last.decision === 'dropped') {
    return 'dropped';
  }
  if (last.decision === 'rendered') {
    return last.visibility === 'noop' ? 'rendered_not_apparent' : 'rendered';
  }
  return last.decision === 'accepted' ? 'accepted_not_rendered' : 'proposed_only';
}

export class EditLedger {
  private readonly byId = new Map<string, LedgerEntry>();
  private profile: LedgerProfileContext = {present: false};
  private readonly stageContext = new Map<LedgerStage, StageContext>();
  private readonly themeAtTrack = new Map<string, boolean>();

  setProfile(profile: LedgerProfileContext): void {
    this.profile = profile;
  }

  noteStageContext(stage: LedgerStage, context: StageContext): void {
    this.stageContext.set(stage, context);
  }

  noteTrackTheme(track: string, themed: boolean): void {
    this.themeAtTrack.set(track, (this.themeAtTrack.get(track) ?? false) || themed);
  }

  propose(input: {
    type: LedgerEditType;
    stage: LedgerStage;
    start: number;
    end: number;
    label?: string;
    reason?: string;
    prerequisites?: LedgerPrerequisite[];
  }): string {
    const label = ledgerLabel(input.label);
    const base = stableEditId(input.type, input.start, label);
    let id = base;
    for (let n = 2; this.byId.has(id); n += 1) {
      id = `${base}-${n}`;
    }
    this.byId.set(id, {
      id,
      type: input.type,
      source: input.stage,
      label,
      proposed: span(input.start, input.end),
      final: null,
      reason: input.reason ? ledgerLabel(input.reason, 160) : undefined,
      prerequisites: input.prerequisites ?? [],
      events: [{stage: input.stage, decision: 'proposed'}],
    });
    return id;
  }

  private entry(id: string): LedgerEntry {
    const found = this.byId.get(id);
    if (!found) {
      throw new Error(`edit ledger: unknown edit id ${id}`);
    }
    return found;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  get(id: string): LedgerEntry | undefined {
    return this.byId.get(id);
  }

  /** First entry of this type whose proposed start is within `toleranceSec` of `start`. */
  find(type: LedgerEditType, start: number, toleranceSec = 0.05): LedgerEntry | undefined {
    return this.entries().find(entry => entry.type === type && Math.abs(entry.proposed.start - start) <= toleranceSec);
  }

  /** Entry of this type with the same label whose proposed start is within `toleranceSec`. */
  findByLabel(type: LedgerEditType, label: string, start: number, toleranceSec = 3): LedgerEntry | undefined {
    const wanted = ledgerLabel(label);
    return this.entries().find(entry => entry.type === type && entry.label === wanted && Math.abs(entry.proposed.start - start) <= toleranceSec);
  }

  private push(id: string, event: LedgerEvent): LedgerEntry {
    const entry = this.entry(id);
    entry.events.push(event);
    return entry;
  }

  accept(id: string, stage: LedgerStage, change?: LedgerChange & {reason?: string; conflictsWith?: string[]; geometry?: LedgerEvent['geometry']}): void {
    const {reason, conflictsWith, geometry, ...raw} = change ?? {};
    const delta: LedgerChange = {
      ...raw,
      ...(raw.from ? {from: span(raw.from.start, raw.from.end)} : {}),
      ...(raw.to ? {to: span(raw.to.start, raw.to.end)} : {}),
    };
    const entry = this.push(id, {
      stage,
      decision: 'accepted',
      ...(reason ? {reason} : {}),
      ...(conflictsWith?.length ? {conflictsWith} : {}),
      ...(geometry ? {geometry} : {}),
      ...(Object.keys(delta).length > 0 ? {change: delta} : {}),
    });
    if (delta.to) {
      entry.final = delta.to;
    }
  }

  /** The edit was accepted by an earlier stage; record the span it holds in the plan. */
  setFinal(id: string, final: TimeSpan): void {
    this.entry(id).final = span(final.start, final.end);
  }

  reject(id: string, stage: LedgerStage, reason: string, extra: {conflictsWith?: string[]; precision?: LedgerEvent['precision']; geometry?: LedgerEvent['geometry']; cause?: string} = {}): void {
    const entry = this.push(id, {stage, decision: 'rejected', reason, precision: extra.precision ?? 'exact', ...(extra.cause ? {cause: extra.cause} : {}), ...(extra.conflictsWith?.length ? {conflictsWith: extra.conflictsWith} : {}), ...(extra.geometry ? {geometry: extra.geometry} : {})});
    entry.final = null;
  }

  drop(id: string, stage: LedgerStage, reason: string, extra: {conflictsWith?: string[]; precision?: LedgerEvent['precision']; geometry?: LedgerEvent['geometry']; cause?: string} = {}): void {
    const entry = this.push(id, {stage, decision: 'dropped', reason, precision: extra.precision ?? 'exact', ...(extra.cause ? {cause: extra.cause} : {}), ...(extra.conflictsWith?.length ? {conflictsWith: extra.conflictsWith} : {}), ...(extra.geometry ? {geometry: extra.geometry} : {})});
    entry.final = null;
  }

  rendered(id: string, track: string, visibility: 'visible' | 'noop' = 'visible', reason?: string): void {
    this.push(id, {stage: 'renderer', decision: 'rendered', track, visibility, ...(reason ? {reason} : {})});
  }

  entries(): LedgerEntry[] {
    return [...this.byId.values()];
  }

  toJSON(): LedgerDump {
    const entries = this.entries();
    return {
      version: 1,
      timeBase: 'output_seconds',
      contentProfile: this.profile,
      stageContext: Object.fromEntries(this.stageContext),
      trackTheme: Object.fromEntries(this.themeAtTrack),
      edits: entries,
      summary: summarizeLedger(entries, {
        stageContext: Object.fromEntries(this.stageContext),
        trackTheme: Object.fromEntries(this.themeAtTrack),
        profile: this.profile,
      }),
    };
  }
}

export type LedgerSummary = {
  proposedByType: Record<string, number>;
  acceptedByType: Record<string, number>;
  /** type → reason → count, for rejected and dropped edits. */
  lostByTypeAndReason: Record<string, Record<string, number>>;
  outcomes: Record<LedgerOutcome, number>;
  reachedRendererByTrack: Record<string, number>;
  conflicts: {temporal: number; spatial: number};
  stageContext: Record<string, StageContext>;
  trackTheme: Record<string, boolean>;
  profilePresent: boolean;
};

export type LedgerDump = {
  version: 1;
  timeBase: 'output_seconds';
  contentProfile: LedgerProfileContext;
  stageContext: Record<string, StageContext>;
  trackTheme: Record<string, boolean>;
  edits: LedgerEntry[];
  summary: LedgerSummary;
};

const bump = (counts: Record<string, number>, key: string) => {
  counts[key] = (counts[key] ?? 0) + 1;
};

export function summarizeLedger(
  entries: LedgerEntry[],
  context: {stageContext?: Record<string, StageContext>; trackTheme?: Record<string, boolean>; profile?: LedgerProfileContext} = {},
): LedgerSummary {
  const summary: LedgerSummary = {
    proposedByType: {},
    acceptedByType: {},
    lostByTypeAndReason: {},
    outcomes: {rendered: 0, rendered_not_apparent: 0, accepted_not_rendered: 0, dropped: 0, rejected: 0, proposed_only: 0},
    reachedRendererByTrack: {},
    conflicts: {temporal: 0, spatial: 0},
    stageContext: context.stageContext ?? {},
    trackTheme: context.trackTheme ?? {},
    profilePresent: context.profile?.present ?? false,
  };
  for (const entry of entries) {
    bump(summary.proposedByType, entry.type);
    const outcome = outcomeOf(entry);
    summary.outcomes[outcome] += 1;
    if (outcome === 'rendered' || outcome === 'rendered_not_apparent' || outcome === 'accepted_not_rendered') {
      bump(summary.acceptedByType, entry.type);
    }
    if (outcome === 'dropped' || outcome === 'rejected') {
      const reason = entry.events.at(-1)?.reason ?? 'unknown';
      const byReason = (summary.lostByTypeAndReason[entry.type] ??= {});
      bump(byReason, reason);
    }
    const rendered = entry.events.find(event => event.decision === 'rendered');
    if (rendered?.track) {
      bump(summary.reachedRendererByTrack, rendered.track);
    }
    for (const event of entry.events) {
      for (const match of event.reason?.matchAll(/\b(temporal|spatial)_[a-z_]+/g) ?? []) {
        summary.conflicts[match[1] as 'temporal' | 'spatial'] += 1;
      }
    }
  }
  return summary;
}
