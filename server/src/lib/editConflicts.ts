/**
 * Shared temporal + spatial conflict validation over the planned edits.
 *
 * Every text-bearing edit (hook, captions, kinetic text, emphasis, cards,
 * generated graphics) and every layout that replaces or splits the picture is
 * modelled as an interval on ONE output timeline plus a normalised screen
 * rectangle. Conflicts are resolved by priority; the lower-priority edit may be
 * relocated (only to an anchor the renderer supports), shortened inside its
 * own spoken window, or dropped. Nothing is ever moved to another moment, and
 * every change is returned with its reason, original and final timing, and the
 * ids it conflicted with.
 *
 * Geometry is estimated from the renderer's own layout rules (anchors, font
 * scale, caption docking). Where an edit has no usable geometry the validator
 * falls back to assuming overlap and says so (`geometry: 'unknown'`).
 */

import type {
  BRollClip,
  CaptionDirection,
  FrameInset,
  GeneratedGraphic,
  InsetRevealClip,
  MediaContainerMoment,
  MotionGraphic,
  SemanticEmphasis,
  VisualAnchor,
  VisualOverlay,
} from '../types/blueprint.ts';
import {CAPTION_BAND, hookRectForAnchor, overlapArea, rectsOverlap, slotRectForAnchor, type NormRect} from '../stages/layout/occupancy.ts';
import type {EditLedger, LedgerEditType, LedgerEvent, TimeSpan} from './editLedger.ts';
import type {BehindSubjectEntry} from '../stages/textTreatment/textTreatment.ts';
import {carryProvenance} from './provenance.ts';
import {ledgerLabel} from './editLedger.ts';

export type Geometry = NonNullable<LedgerEvent['geometry']>;

/** Mirrors remotion/src/generated/placement.ts (a test asserts parity). */
export const GENERATED_SPLIT_RATIO = 0.5;
export const DOCKED_CAPTION_BOTTOM_FRAC = 0.08;

export const MIN_DURATION_SEC = {kinetic_text: 1, emphasis: 0.8, generated_graphic: 1.5, behind_subject_text: 1} as const;

/** Draw order of the Remotion tracks (higher = on top); see ShortVideo.tsx. */
const Z = {layout: 5, cutaway: 15, overlay: 25, kinetic_text: 40, generated_graphic: 50, emphasis: 60, hook_title: 100, caption: 110, behind_subject_text: 30} as const;

const PRIORITY = {caption: 100, hook_title: 90, layout: 80, generated_graphic: 70, overlay: 60, kinetic_text: 50, emphasis: 40,
  /** Below the base layouts (a layout that reshapes or hides the picture also hides this text, so it must yield to them) and above the other text edits. */
  behind_subject_text: 75,
} as const;

const SAFE_FRAME: NormRect = {x: 0.03, y: 0.04, w: 0.94, h: 0.93};
/** Right-hand platform button rail (like / comment / share). */
const PLATFORM_RAIL: NormRect = {x: 0.86, y: 0.4, w: 0.14, h: 0.42};
const MIN_OVERLAP_SEC = 0.05;
const MIN_OVERLAP_AREA = 0.0015;
const FACE_OVERLAP_AREA = 0.003;

export type ConflictReason =
  | 'temporal_invalid_interval'
  | 'temporal_out_of_bounds'
  | 'temporal_occluded_by_fullscreen'
  | 'temporal_conflicts_with_layout'
  | 'spatial_text_overlap'
  | 'spatial_crosses_split_seam'
  | 'spatial_covers_captions'
  | 'spatial_covers_face'
  | 'spatial_outside_safe_area'
  | 'spatial_platform_ui_zone';

export type ConflictEdit = {
  id: string;
  type: LedgerEditType;
  start: number;
  end: number;
  /** Readable copy is drawn by this edit. */
  text: boolean;
  /** Screen rectangle, normalised to the frame; null when unknown. */
  rect: NormRect | null;
  geometry: Geometry;
  /** Hides the base picture for its whole rectangle. */
  opaque: boolean;
  coversFrame: boolean;
  /** Draws the base picture as a split; rect.y of the seam is `seamY`. */
  seamY?: number;
  z: number;
  priority: number;
  mutable: boolean;
  anchor?: string;
  /** Anchors the renderer supports for this edit, in preference order. */
  relocatable?: string[];
  minDurationSec: number;
  /** Where the edit lives in the plan, so decisions can be applied. */
  ref?: {array: 'motionGraphics' | 'semanticEmphasis' | 'generatedGraphics' | 'behindSubjectTexts'; index: number};
  /** Edit whose own timing is part of the base layout (caption docking, base picture). */
  isLayout?: boolean;
};

export type EditDecision = {
  id: string;
  action: 'keep' | 'relocate' | 'shorten' | 'drop';
  reason?: ConflictReason;
  conflictsWith: string[];
  from: TimeSpan;
  to: TimeSpan | null;
  anchorFrom?: string;
  anchorTo?: string;
  geometry: Geometry;
  /** Conflicts that were recorded but need no action (e.g. estimated face overlap). */
  advisories: ConflictReason[];
};

export type SpeakerGeometry = {box: NormRect; source: 'vision' | 'fallback'};

export type EditPlanView = {
  durationSec: number;
  hook?: {text: string; start: number; end: number; anchor: VisualAnchor};
  /** Opt-in art-directed opening. When present it REPLACES the hook's legacy corner slot with the box that is actually drawn. */
  opening?: {start: number; end: number; rect: NormRect};
  /** Text between the footage and the speaker's matte. Only present when a real matte exists. */
  behindSubjectTexts?: BehindSubjectEntry[];
  captionDirection?: Pick<CaptionDirection, 'position' | 'bottomFrac'>;
  brollClips?: BRollClip[];
  visualOverlays?: VisualOverlay[];
  insetReveals?: InsetRevealClip[];
  frameInsets?: FrameInset[];
  mediaContainers?: MediaContainerMoment[];
  motionGraphics?: MotionGraphic[];
  semanticEmphasis?: SemanticEmphasis[];
  generatedGraphics?: GeneratedGraphic[];
  speaker?: SpeakerGeometry;
};

// ---- geometry --------------------------------------------------------------

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Width of one text line as a fraction of the frame width. Calibrated on a rendered frame (35 characters of
 * 0.048-of-width italic type spanned ~0.67 of the frame), so ~0.40 of the font size per character, rounded up.
 */
const textWidthFrac = (text: string, fontFrac: number) => clamp(Array.from(text.trim()).length * fontFrac * 0.4, fontFrac, 0.9);
/** Frame height is 16/9 of its width, so a font of `fontFrac` of the width spans this fraction of the height. */
const lineHeightFrac = (fontFrac: number) => fontFrac * (9 / 16) * 1.3;

export const KINETIC_ANCHORS = ['top_left', 'top_right', 'bottom_left', 'bottom_right'] as const;
export const EMPHASIS_ANCHORS = ['top_left', 'top_right', 'bottom_left', 'bottom_right'] as const;

/** Mirrors MotionGraphicTrack's anchorStyle: pad 6% of width, top 8% / bottom 24% of height. */
export function kineticTextRect(graphic: Pick<MotionGraphic, 'text' | 'role' | 'fontScale' | 'anchor'> & {shape?: MotionGraphic['shape']}, anchor: string = graphic.anchor): NormRect {
  const base = graphic.role === 'primary' ? 0.058 : graphic.role === 'secondary' ? 0.046 : 0.04;
  const font = base * Math.max(0.6, graphic.fontScale || 1);
  // Filled shapes pad the text on both sides (measured: a pill added ~1.5 font sizes of width).
  const padding = graphic.shape && graphic.shape !== 'none' && graphic.shape !== 'underline' ? font * 1.5 : 0;
  const w = Math.min(0.9, textWidthFrac(graphic.text, font) + padding);
  const h = lineHeightFrac(font) * 1.6;
  const pad = 0.06;
  if (anchor === 'center') {
    return {x: pad, y: 0.38, w: 1 - pad * 2, h};
  }
  const bottom = anchor.startsWith('bottom');
  const y = bottom ? 1 - 0.24 - h : 0.08;
  const x = anchor.endsWith('right') ? 1 - pad - w : pad;
  return {x, y, w, h};
}

/** Mirrors SemanticEmphasisTrack's slotStyle: pad 5% of width, top 9% / bottom 26% of height. */
export function emphasisRect(item: Pick<SemanticEmphasis, 'text' | 'weight' | 'treatment' | 'anchor'>, anchor: string = item.anchor ?? 'top_right'): NormRect {
  const font = item.treatment === 'count' ? 0.11 : item.weight === 'primary' ? 0.055 : 0.042;
  const w = textWidthFrac(item.text, font);
  const h = lineHeightFrac(font) * 1.5;
  const pad = 0.05;
  const bottom = anchor.startsWith('bottom');
  const y = bottom ? 1 - 0.26 - h : 0.09;
  const x = anchor.endsWith('left') ? pad : 1 - pad - w;
  return {x, y, w, h};
}

/** Caption band during the base layout and while a generated split docks it (see captionsForGeneratedSplit). */
export function captionRect(
  direction: Pick<CaptionDirection, 'position' | 'bottomFrac'> | undefined,
  splitSide?: 'top' | 'bottom',
): NormRect {
  const band = 0.13;
  const place = (top: number, bottom: number): NormRect => ({x: 0.04, y: top, w: 0.92, h: Math.max(0.05, bottom - top)});
  const position = direction?.position ?? 'bottom';
  const bottomFrac = direction?.bottomFrac ?? 0.2;
  if (splitSide && position !== 'top') {
    if (splitSide === 'top') {
      const bottom = 1 - DOCKED_CAPTION_BOTTOM_FRAC;
      return place(bottom - band, bottom);
    }
    const seam = GENERATED_SPLIT_RATIO;
    return place(seam - (DOCKED_CAPTION_BOTTOM_FRAC + band), seam - GENERATED_SPLIT_RATIO * DOCKED_CAPTION_BOTTOM_FRAC);
  }
  if (position === 'top') {
    return place(0.12, 0.12 + band);
  }
  if (position === 'center') {
    return place((1 - band) / 2, (1 + band) / 2);
  }
  const bottom = 1 - bottomFrac;
  return place(bottom - band, bottom);
}

/** The shared hook box is 0.36 wide; a measured two-line hook spanned 0.40, so use a wider box here. */
export function hookRect(anchor: VisualAnchor): NormRect {
  const base = hookRectForAnchor(anchor);
  const w = 0.46;
  return {...base, w, x: base.x + base.w / 2 > 0.5 ? 1 - 0.04 - w : base.x};
}

const faceRect = (box: NormRect): NormRect => ({x: box.x + box.w * 0.15, y: box.y, w: box.w * 0.7, h: box.h * 0.38});

const inflate = (rect: NormRect, pad: number): NormRect => ({x: rect.x - pad, y: rect.y - pad, w: rect.w + pad * 2, h: rect.h + pad * 2});

const within = (rect: NormRect, outer: NormRect) =>
  rect.x >= outer.x - 1e-6 && rect.y >= outer.y - 1e-6 && rect.x + rect.w <= outer.x + outer.w + 1e-6 && rect.y + rect.h <= outer.y + outer.h + 1e-6;

// ---- building the edit set -------------------------------------------------

const overlapSec = (a: TimeSpan, b: TimeSpan) => Math.min(a.end, b.end) - Math.max(a.start, b.start);

const TEXT_OVERLAY_LAYOUTS = new Set(['card', 'lockup', 'chip', 'banner', 'stat', 'bubble', 'sticker', 'pip']);

function layoutType(layout: string): LedgerEditType {
  switch (layout) {
    case 'split':
      return 'split';
    case 'cutout':
      return 'cutout';
    case 'composite':
      return 'composite';
    case 'cutaway':
      return 'cutaway';
    case 'bubble':
      return 'bubble';
    case 'lockup':
    case 'chip':
    case 'banner':
    case 'stat':
      return 'lockup';
    case 'pip':
      return 'pip';
    default:
      return 'card';
  }
}

/** Ledger ids are created here for any edit the earlier stages did not already register. */
export type IdResolver = (type: LedgerEditType, start: number, label: string) => string;

export function ledgerIdResolver(ledger: EditLedger, stage: 'plan_assembly' | 'conflict_validator' = 'plan_assembly'): IdResolver {
  return (type, start, label) => {
    const existing = ledger.find(type, start, 1.5);
    if (existing && (existing.label === ledgerLabel(label) || existing.label === '')) {
      return existing.id;
    }
    // The planner moved the edit (speech alignment, hook guard): its ledger entry carries the FINAL span, which is what
    // the plan now holds. Without this the director's entry stays "accepted" and a duplicate engine entry is created.
    const byFinal = ledger
      .entries()
      .filter(entry => entry.type === type && entry.final && Math.abs(entry.final.start - start) <= 0.25)
      .sort((a, b) => Math.abs(a.final!.start - start) - Math.abs(b.final!.start - start))[0];
    if (byFinal) {
      return byFinal.id;
    }
    // Same type near the same start: the planner remapped the director's time. Match by label.
    const byLabel = ledger.entries().find(entry => entry.type === type && entry.label === ledgerLabel(label) && Math.abs(entry.proposed.start - start) <= 3);
    if (byLabel) {
      return byLabel.id;
    }
    return ledger.propose({type, stage, start, end: start, label});
  };
}

export function buildConflictEdits(plan: EditPlanView, idFor: IdResolver): ConflictEdit[] {
  const edits: ConflictEdit[] = [];
  const speaker = plan.speaker;
  const generated = plan.generatedGraphics ?? [];

  if (plan.hook?.text.trim()) {
    // With an art-directed opening the drawn box is known exactly, so it is `measured`; the legacy corner slot is an estimate.
    edits.push({
      id: idFor('hook_title', plan.opening?.start ?? plan.hook.start, plan.hook.text),
      type: 'hook_title',
      start: plan.opening?.start ?? plan.hook.start,
      end: plan.opening?.end ?? plan.hook.end,
      text: true,
      rect: plan.opening?.rect ?? hookRect(plan.hook.anchor),
      geometry: plan.opening ? 'measured' : 'estimated',
      opaque: false,
      coversFrame: false,
      z: Z.hook_title,
      priority: PRIORITY.hook_title,
      mutable: false,
      anchor: plan.hook.anchor,
      minDurationSec: 0,
    });
  }

  // Captions: one segment per generated-split interval (docked band) plus the gaps between them.
  const splits = generated
    .filter(graphic => graphic.placement.mode === 'split_screen')
    .map(graphic => ({start: graphic.start, end: graphic.end, side: (graphic.placement as {graphicSide: 'top' | 'bottom'}).graphicSide}))
    .sort((a, b) => a.start - b.start);
  let cursor = 0;
  const captionSegment = (start: number, end: number, side?: 'top' | 'bottom') => {
    if (end - start <= 0.01) {
      return;
    }
    edits.push({
      id: idFor('caption', start, side ? `docked-${side}` : 'base'),
      type: 'caption',
      start,
      end,
      text: true,
      rect: captionRect(plan.captionDirection, side),
      geometry: 'estimated',
      opaque: false,
      coversFrame: false,
      z: Z.caption,
      priority: PRIORITY.caption,
      mutable: false,
      minDurationSec: 0,
      isLayout: true,
    });
  };
  for (const split of splits) {
    captionSegment(cursor, Math.min(split.start, plan.durationSec));
    captionSegment(Math.max(split.start, 0), Math.min(split.end, plan.durationSec), split.side);
    cursor = Math.max(cursor, split.end);
  }
  captionSegment(cursor, plan.durationSec);

  for (const clip of plan.brollClips ?? []) {
    edits.push({
      id: idFor('cutaway', clip.start, clip.keyword),
      type: 'cutaway',
      start: clip.start,
      end: clip.end,
      text: false,
      rect: {x: 0, y: 0, w: 1, h: 1},
      geometry: 'measured',
      opaque: true,
      coversFrame: true,
      z: Z.cutaway,
      priority: PRIORITY.layout,
      mutable: false,
      minDurationSec: 0,
    });
  }

  for (const overlay of plan.visualOverlays ?? []) {
    const type = layoutType(overlay.layout);
    const isSplit = overlay.layout === 'split';
    const frameLayout = overlay.layout === 'cutout' || overlay.layout === 'composite';
    const mediaHalf: NormRect | null = isSplit
      ? overlay.speakerSide === 'top'
        ? {x: 0, y: GENERATED_SPLIT_RATIO, w: 1, h: 1 - GENERATED_SPLIT_RATIO}
        : {x: 0, y: 0, w: 1, h: GENERATED_SPLIT_RATIO}
      : null;
    const hasText = TEXT_OVERLAY_LAYOUTS.has(overlay.layout) && ledgerLabel(overlay.overlayText).length > 0;
    edits.push({
      id: idFor(type, overlay.start, overlay.overlayText || overlay.keyword),
      type,
      start: overlay.start,
      end: overlay.end,
      text: hasText,
      rect: frameLayout ? {x: 0, y: 0, w: 1, h: 1} : mediaHalf ?? slotRectForAnchor(overlay.anchor),
      geometry: isSplit || frameLayout ? 'measured' : 'estimated',
      opaque: isSplit || frameLayout || overlay.layout === 'card',
      coversFrame: frameLayout,
      seamY: isSplit ? GENERATED_SPLIT_RATIO : undefined,
      z: isSplit || frameLayout ? Z.layout : Z.overlay,
      priority: isSplit || frameLayout ? PRIORITY.layout : PRIORITY.overlay,
      mutable: false,
      minDurationSec: 0,
      isLayout: isSplit || frameLayout,
    });
  }

  const wholeFrameLayout = (type: LedgerEditType, start: number, end: number, label: string) =>
    edits.push({
      id: idFor(type, start, label),
      type,
      start,
      end,
      text: false,
      rect: {x: 0, y: 0, w: 1, h: 1},
      geometry: 'measured',
      opaque: false,
      coversFrame: false,
      z: Z.layout,
      priority: PRIORITY.layout,
      mutable: false,
      minDurationSec: 0,
      isLayout: true,
    });
  for (const clip of plan.insetReveals ?? []) {
    wholeFrameLayout('inset_reveal', clip.start, clip.end, 'inset');
  }
  for (const inset of plan.frameInsets ?? []) {
    wholeFrameLayout('frame_inset', inset.start, inset.end, 'frame');
  }
  for (const container of plan.mediaContainers ?? []) {
    wholeFrameLayout('media_container', container.start, container.end, container.mode);
  }

  (plan.motionGraphics ?? []).forEach((graphic, index) => {
    edits.push({
      id: idFor('kinetic_text', graphic.start, graphic.text),
      type: 'kinetic_text',
      start: graphic.start,
      end: graphic.end,
      text: true,
      rect: graphic.text.trim() ? kineticTextRect(graphic) : null,
      geometry: graphic.text.trim() ? 'estimated' : 'unknown',
      opaque: false,
      coversFrame: false,
      z: Z.kinetic_text,
      priority: PRIORITY.kinetic_text,
      mutable: true,
      anchor: graphic.anchor,
      relocatable: [...KINETIC_ANCHORS],
      minDurationSec: MIN_DURATION_SEC.kinetic_text,
      ref: {array: 'motionGraphics', index},
    });
  });

  (plan.semanticEmphasis ?? []).forEach((item, index) => {
    edits.push({
      id: idFor('emphasis', item.start, item.text),
      type: 'emphasis',
      start: item.start,
      end: item.end,
      text: true,
      rect: item.text.trim() ? emphasisRect(item) : null,
      geometry: item.text.trim() ? 'estimated' : 'unknown',
      opaque: false,
      coversFrame: false,
      z: Z.emphasis,
      priority: PRIORITY.emphasis,
      mutable: true,
      anchor: item.anchor ?? 'top_right',
      relocatable: [...EMPHASIS_ANCHORS],
      minDurationSec: MIN_DURATION_SEC.emphasis,
      ref: {array: 'semanticEmphasis', index},
    });
  });

  (plan.behindSubjectTexts ?? []).forEach((item, index) => {
    edits.push({
      id: idFor('behind_subject_text', item.start, item.text),
      type: 'behind_subject_text',
      start: item.start,
      end: item.end,
      text: true,
      rect: {x: (1 - item.widthFrac) / 2, y: item.centerY - item.heightFrac / 2, w: item.widthFrac, h: item.heightFrac},
      geometry: 'measured',
      opaque: false,
      coversFrame: false,
      z: Z.behind_subject_text,
      priority: PRIORITY.behind_subject_text,
      // Mutable on purpose: when it genuinely collides it is shortened or dropped, never allowed to evict a layout or another text.
      mutable: true,
      minDurationSec: MIN_DURATION_SEC.behind_subject_text,
      ref: {array: 'behindSubjectTexts', index},
    });
  });

  generated.forEach((graphic, index) => {
    const placement = graphic.placement;
    const rect: NormRect | null =
      placement.mode === 'full_screen'
        ? {x: 0, y: 0, w: 1, h: 1}
        : placement.mode === 'split_screen'
          ? placement.graphicSide === 'top'
            ? {x: 0, y: 0, w: 1, h: GENERATED_SPLIT_RATIO}
            : {x: 0, y: GENERATED_SPLIT_RATIO, w: 1, h: 1 - GENERATED_SPLIT_RATIO}
          : placement.box ?? {x: 0, y: 0, w: 1, h: 1};
    edits.push({
      id: idFor('generated_graphic', graphic.start, graphic.id),
      type: 'generated_graphic',
      start: graphic.start,
      end: graphic.end,
      text: true,
      rect,
      geometry: 'measured',
      opaque: placement.mode === 'full_screen' || placement.mode === 'split_screen',
      coversFrame: placement.mode === 'full_screen',
      seamY: placement.mode === 'split_screen' ? GENERATED_SPLIT_RATIO : undefined,
      z: Z.generated_graphic,
      priority: PRIORITY.generated_graphic,
      mutable: true,
      minDurationSec: MIN_DURATION_SEC.generated_graphic,
      ref: {array: 'generatedGraphics', index},
    });
  });

  void speaker;
  return edits;
}

// ---- conflict detection ----------------------------------------------------

type Context = {durationSec: number; speaker?: SpeakerGeometry};

const span = (edit: Pick<ConflictEdit, 'start' | 'end'>): TimeSpan => ({start: edit.start, end: edit.end});

/** Conflict between `edit` and an already-accepted `other` (both active at the same time). */
function pairConflict(edit: ConflictEdit, other: ConflictEdit): {reason: ConflictReason; geometry: Geometry} | null {
  if (overlapSec(span(edit), span(other)) <= MIN_OVERLAP_SEC) {
    return null;
  }
  // Region graphics get the caption band as a safe area from the renderer, so they never sit under captions.
  if (edit.type === 'generated_graphic' && edit.opaque && other.type === 'caption') {
    return null;
  }
  // Another edit hides this one (drawn above an opaque region that covers it).
  if (other.opaque && other.z > edit.z && edit.text) {
    if (edit.rect && other.rect && overlapArea(edit.rect, other.rect) > MIN_OVERLAP_AREA) {
      if (other.type === 'generated_graphic') {
        return {reason: other.coversFrame ? 'temporal_occluded_by_fullscreen' : 'spatial_text_overlap', geometry: edit.geometry};
      }
    }
  }
  if (edit.text && other.text) {
    if (!edit.rect || !other.rect) {
      // Captions have known geometry of their own; only text with no usable box is assumed to overlap.
      return edit.type === 'caption' || other.type === 'caption' ? null : {reason: 'spatial_text_overlap', geometry: 'unknown'};
    }
    if (overlapArea(edit.rect, other.rect) > MIN_OVERLAP_AREA) {
      return {reason: 'spatial_text_overlap', geometry: edit.geometry === 'estimated' || other.geometry === 'estimated' ? 'estimated' : 'measured'};
    }
  }
  // Text behind the speaker is drawn on the talking-head layer: any layout that hides or reshapes that picture hides it too. Overlapping the
  // speaker themselves is the point of the effect and is NOT a conflict; neither is a zoom (it scales the same layer).
  if (edit.type === 'behind_subject_text' && other.type !== 'caption' && other.type !== 'behind_subject_text' && (other.isLayout || other.coversFrame || other.opaque)) {
    return {reason: 'temporal_conflicts_with_layout', geometry: 'measured'};
  }
  // A generated graphic cannot share the base picture with a layout that reshapes it.
  if (edit.type === 'generated_graphic' && (other.isLayout || other.coversFrame) && other.type !== 'caption') {
    return {reason: 'temporal_conflicts_with_layout', geometry: 'measured'};
  }
  return null;
}

function seamCrossing(edit: ConflictEdit, accepted: ConflictEdit[]): boolean {
  if (!edit.text || !edit.rect || edit.seamY !== undefined || !edit.mutable) {
    return false;
  }
  return accepted.some(
    other =>
      other.seamY !== undefined &&
      overlapSec(span(edit), span(other)) > MIN_OVERLAP_SEC &&
      edit.rect!.y < other.seamY &&
      edit.rect!.y + edit.rect!.h > other.seamY,
  );
}

type SingleIssue = {reason: ConflictReason; blocking: boolean; geometry: Geometry};

function singleIssues(edit: ConflictEdit, accepted: ConflictEdit[], context: Context, rectOverride?: NormRect): SingleIssue[] {
  const issues: SingleIssue[] = [];
  const rect = rectOverride ?? edit.rect;
  // Only anchored text boxes: region graphics are laid out (and safe-areaed) by the renderer.
  // The art-directed opening has a measured box, so it is checked against the face too (an advisory: the opening is not removable here, but the ledger says so).
  const openingBox = edit.type === 'hook_title' && edit.geometry === 'measured';
  if (!edit.text || !rect || (edit.type !== 'kinetic_text' && edit.type !== 'emphasis' && !openingBox)) {
    return issues;
  }
  if (openingBox) {
    if (context.speaker && overlapArea(rect, faceRect(context.speaker.box)) > FACE_OVERLAP_AREA) {
      issues.push({reason: 'spatial_covers_face', blocking: false, geometry: context.speaker.source === 'vision' ? 'measured' : 'fallback'});
    }
    return issues;
  }
  if (!within(rect, SAFE_FRAME)) {
    issues.push({reason: 'spatial_outside_safe_area', blocking: true, geometry: edit.geometry});
  }
  if (rectsOverlap(rect, PLATFORM_RAIL) && overlapArea(rect, PLATFORM_RAIL) > MIN_OVERLAP_AREA) {
    issues.push({reason: 'spatial_platform_ui_zone', blocking: false, geometry: edit.geometry});
  }
  if (seamCrossing({...edit, rect}, accepted)) {
    issues.push({reason: 'spatial_crosses_split_seam', blocking: true, geometry: edit.geometry});
  }
  if (context.speaker) {
    const face = faceRect(context.speaker.box);
    if (overlapArea(rect, face) > FACE_OVERLAP_AREA) {
      // A fallback box is a guess: record it, but do not remove an edit because of it.
      issues.push({reason: 'spatial_covers_face', blocking: context.speaker.source === 'vision', geometry: context.speaker.source === 'vision' ? 'measured' : 'fallback'});
    }
  }
  return issues;
}

function remainingWindow(edit: ConflictEdit, conflicts: ConflictEdit[]): TimeSpan | null {
  let pieces: TimeSpan[] = [span(edit)];
  for (const other of conflicts) {
    pieces = pieces.flatMap(piece => {
      if (overlapSec(piece, other) <= 0) {
        return [piece];
      }
      const out: TimeSpan[] = [];
      if (other.start > piece.start) {
        out.push({start: piece.start, end: other.start});
      }
      if (other.end < piece.end) {
        out.push({start: other.end, end: piece.end});
      }
      return out;
    });
  }
  const best = pieces.sort((a, b) => b.end - b.start - (a.end - a.start))[0];
  return best && best.end - best.start >= edit.minDurationSec - 1e-9 ? {start: Math.round(best.start * 1000) / 1000, end: Math.round(best.end * 1000) / 1000} : null;
}

const SIDE_PREFERENCE: Record<string, string[]> = {
  top_left: ['top_right', 'bottom_left', 'bottom_right'],
  top_right: ['top_left', 'bottom_right', 'bottom_left'],
  top: ['top_right', 'top_left', 'bottom_right'],
  bottom_left: ['bottom_right', 'top_left', 'top_right'],
  bottom_right: ['bottom_left', 'top_right', 'top_left'],
};

function rectFor(edit: ConflictEdit, plan: EditPlanView, anchor: string): NormRect | null {
  if (edit.ref?.array === 'motionGraphics') {
    const graphic = plan.motionGraphics?.[edit.ref.index];
    return graphic ? kineticTextRect(graphic, anchor) : null;
  }
  if (edit.ref?.array === 'semanticEmphasis') {
    const item = plan.semanticEmphasis?.[edit.ref.index];
    return item ? emphasisRect(item, anchor) : null;
  }
  return null;
}

/**
 * Resolve every conflict. Edits are considered from highest to lowest priority
 * (earlier start first); a mutable edit that conflicts with something already
 * accepted is relocated, shortened, or dropped, in that order.
 */
export function validateEdits(plan: EditPlanView, edits: ConflictEdit[], context: Context = {durationSec: plan.durationSec, speaker: plan.speaker}): EditDecision[] {
  const decisions: EditDecision[] = [];
  const accepted: ConflictEdit[] = [];
  const ordered = [...edits].sort((a, b) => b.priority - a.priority || a.start - b.start);

  for (const edit of ordered) {
    const from = span(edit);
    const base: Pick<EditDecision, 'id' | 'from' | 'geometry'> = {id: edit.id, from, geometry: edit.geometry};

    // Interval validity.
    if (!Number.isFinite(edit.start) || !Number.isFinite(edit.end) || edit.end <= edit.start) {
      decisions.push({...base, action: edit.mutable ? 'drop' : 'keep', reason: 'temporal_invalid_interval', conflictsWith: [], to: edit.mutable ? null : from, advisories: []});
      if (!edit.mutable) {
        accepted.push(edit);
      }
      continue;
    }
    let working: ConflictEdit = edit;
    let clampedReason: ConflictReason | undefined;
    if (edit.start < -1e-6 || edit.end > context.durationSec + 1e-6) {
      const start = Math.max(0, edit.start);
      const end = Math.min(context.durationSec, edit.end);
      if (!edit.mutable) {
        decisions.push({...base, action: 'keep', reason: 'temporal_out_of_bounds', conflictsWith: [], to: from, advisories: ['temporal_out_of_bounds']});
        accepted.push(edit);
        continue;
      }
      if (end - start < edit.minDurationSec - 1e-9) {
        decisions.push({...base, action: 'drop', reason: 'temporal_out_of_bounds', conflictsWith: [], to: null, advisories: []});
        continue;
      }
      working = {...edit, start, end};
      clampedReason = 'temporal_out_of_bounds';
    }

    const conflicts = (candidate: ConflictEdit, rect?: NormRect) =>
      accepted
        .map(other => ({other, found: pairConflict(rect ? {...candidate, rect} : candidate, other)}))
        .filter((entry): entry is {other: ConflictEdit; found: {reason: ConflictReason; geometry: Geometry}} => entry.found !== null);

    const pair = conflicts(working);
    const singles = singleIssues(working, accepted, context);
    const blockingSingles = singles.filter(issue => issue.blocking);
    const advisories = singles.filter(issue => !issue.blocking).map(issue => issue.reason);

    if (!working.mutable || (pair.length === 0 && blockingSingles.length === 0)) {
      if (clampedReason && working !== edit) {
        decisions.push({...base, action: 'shorten', reason: clampedReason, conflictsWith: [], to: span(working), advisories});
      } else {
        decisions.push({...base, action: 'keep', conflictsWith: pair.map(entry => entry.other.id), reason: pair[0]?.found.reason, to: from, advisories: [...advisories, ...pair.map(entry => entry.found.reason)]});
      }
      accepted.push(working);
      continue;
    }

    const reason = pair[0]?.found.reason ?? blockingSingles[0]!.reason;
    const geometry = pair[0]?.found.geometry ?? blockingSingles[0]!.geometry;
    const conflictIds = [...new Set(pair.map(entry => entry.other.id))];

    // 1. Relocate to another anchor the renderer supports.
    let relocated: {anchor: string; rect: NormRect} | null = null;
    if (working.relocatable && working.anchor && working.rect) {
      for (const anchor of SIDE_PREFERENCE[working.anchor] ?? []) {
        if (!working.relocatable.includes(anchor)) {
          continue;
        }
        const rect = rectFor(working, plan, anchor);
        if (!rect) {
          continue;
        }
        const candidate = {...working, rect, anchor};
        const blocked =
          conflicts(candidate, rect).length > 0 ||
          singleIssues(candidate, accepted, context, rect).some(issue => issue.blocking) ||
          // Moving into unknown territory is conservative even with a fallback speaker box.
          (context.speaker !== undefined && overlapArea(rect, inflate(context.speaker.box, 0.01)) > FACE_OVERLAP_AREA) ||
          overlapArea(rect, CAPTION_BAND) > MIN_OVERLAP_AREA;
        if (!blocked) {
          relocated = {anchor, rect};
          break;
        }
      }
    }
    if (relocated) {
      const moved = {...working, anchor: relocated.anchor, rect: relocated.rect};
      decisions.push({
        ...base,
        action: 'relocate',
        reason,
        conflictsWith: conflictIds,
        to: span(working),
        anchorFrom: working.anchor,
        anchorTo: relocated.anchor,
        geometry,
        advisories,
      });
      accepted.push(moved);
      continue;
    }

    // 2. Shorten inside its own window (never into another moment).
    const window = pair.length > 0 ? remainingWindow(working, pair.map(entry => entry.other)) : null;
    if (window && pair.length > 0 && blockingSingles.length === 0) {
      decisions.push({...base, action: 'shorten', reason, conflictsWith: conflictIds, to: window, geometry, advisories});
      accepted.push({...working, start: window.start, end: window.end});
      continue;
    }

    // 3. Drop with the reason.
    decisions.push({...base, action: 'drop', reason, conflictsWith: conflictIds, to: null, geometry, advisories});
  }

  return decisions;
}

// ---- applying decisions ----------------------------------------------------

export type AppliedPlan = {
  behindSubjectTexts: BehindSubjectEntry[];
  motionGraphics: MotionGraphic[];
  semanticEmphasis: SemanticEmphasis[];
  generatedGraphics: GeneratedGraphic[];
};

export function applyDecisions(plan: EditPlanView, edits: ConflictEdit[], decisions: EditDecision[]): AppliedPlan {
  const byId = new Map(decisions.map(decision => [decision.id, decision]));
  const motionGraphics: MotionGraphic[] = [];
  const semanticEmphasis: SemanticEmphasis[] = [];
  const generatedGraphics: GeneratedGraphic[] = [];
  const behindSubjectTexts: BehindSubjectEntry[] = [];
  const refs = new Map(edits.filter(edit => edit.ref).map(edit => [`${edit.ref!.array}:${edit.ref!.index}`, edit.id]));

  (plan.motionGraphics ?? []).forEach((graphic, index) => {
    const decision = byId.get(refs.get(`motionGraphics:${index}`) ?? '');
    if (decision?.action === 'drop') {
      return;
    }
    motionGraphics.push(
      decision && decision.action !== 'keep'
        ? carryProvenance(graphic, {...graphic, ...(decision.action === 'relocate' ? {anchor: decision.anchorTo as MotionGraphic['anchor']} : {}), ...(decision.action === 'shorten' && decision.to ? {start: decision.to.start, end: decision.to.end} : {})})
        : graphic,
    );
  });
  (plan.semanticEmphasis ?? []).forEach((item, index) => {
    const decision = byId.get(refs.get(`semanticEmphasis:${index}`) ?? '');
    if (decision?.action === 'drop') {
      return;
    }
    semanticEmphasis.push(
      decision && decision.action !== 'keep'
        ? carryProvenance(item, {...item, ...(decision.action === 'relocate' ? {anchor: decision.anchorTo as VisualAnchor} : {}), ...(decision.action === 'shorten' && decision.to ? {start: decision.to.start, end: decision.to.end} : {})})
        : item,
    );
  });
  (plan.generatedGraphics ?? []).forEach((graphic, index) => {
    const decision = byId.get(refs.get(`generatedGraphics:${index}`) ?? '');
    if (decision?.action === 'drop') {
      return;
    }
    generatedGraphics.push(decision?.action === 'shorten' && decision.to ? {...graphic, start: decision.to.start, end: decision.to.end} : graphic);
  });
  (plan.behindSubjectTexts ?? []).forEach((item, index) => {
    const decision = byId.get(refs.get(`behindSubjectTexts:${index}`) ?? '');
    if (decision?.action === 'drop') {
      return;
    }
    behindSubjectTexts.push(decision?.action === 'shorten' && decision.to ? {...item, start: decision.to.start, end: decision.to.end} : item);
  });
  return {behindSubjectTexts, motionGraphics, semanticEmphasis, generatedGraphics};
}

/** Record every decision on the ledger and return the plan with the decisions applied. */
export function validateAndApply(plan: EditPlanView, ledger: EditLedger): {applied: AppliedPlan; decisions: EditDecision[]; edits: ConflictEdit[]} {
  const edits = buildConflictEdits(plan, ledgerIdResolver(ledger));
  const decisions = validateEdits(plan, edits);
  for (const decision of decisions) {
    const geometry = decision.geometry === 'unknown' || decision.geometry === 'fallback' ? decision.geometry : undefined;
    const entry = ledger.get(decision.id);
    if (!entry) {
      continue;
    }
    if (decision.action === 'drop') {
      ledger.drop(decision.id, 'conflict_validator', decision.reason ?? 'temporal_invalid_interval', {conflictsWith: decision.conflictsWith, geometry: decision.geometry});
    } else if (decision.action === 'keep') {
      ledger.accept(decision.id, 'conflict_validator', {
        ...(decision.advisories.length > 0 ? {reason: `advisory:${decision.advisories.join(',')}`} : {}),
        ...(decision.conflictsWith.length > 0 ? {conflictsWith: decision.conflictsWith} : {}),
        ...(geometry ? {geometry} : {}),
        to: decision.to ?? decision.from,
      });
    } else {
      ledger.accept(decision.id, 'conflict_validator', {
        reason: decision.reason,
        conflictsWith: decision.conflictsWith,
        from: decision.from,
        to: decision.to ?? decision.from,
        ...(decision.anchorFrom ? {anchorFrom: decision.anchorFrom, anchorTo: decision.anchorTo} : {}),
        ...(geometry ? {geometry} : {}),
      });
    }
  }
  return {applied: applyDecisions(plan, edits, decisions), decisions, edits};
}
