/**
 * Last planning step before the blueprint is assembled:
 *   1. align the Director's colours with the per-video art direction (when a content profile exists),
 *   2. run the shared temporal/spatial conflict validation over every planned edit,
 *   3. record each surviving edit on the ledger as handed to its Remotion track.
 *
 * Pure with respect to the blueprint: it returns the arrays to use and never touches the network.
 */

import {validateAndApply, type EditDecision, type EditPlanView, type SpeakerGeometry} from '../lib/editConflicts.ts';
import {outcomeOf, type EditLedger, type LedgerEditType} from '../lib/editLedger.ts';
import {carryProvenanceAfterRewrite, provenanceOf} from '../lib/provenance.ts';
import {ledgerIdOf} from '../stages/broll/planLedger.ts';
import type {BehindSubjectEntry} from '../stages/textTreatment/textTreatment.ts';
import {designFromProfile, harmonizeEdits} from '../stages/contentProfile/artDirection.ts';
import type {ContentProfile} from '../stages/contentProfile/contentProfile.ts';
import type {
  BRollClip,
  CaptionDirection,
  DepthOverlayClip,
  FrameInset,
  GeneratedGraphic,
  InsetRevealClip,
  MediaContainerMoment,
  MotionGraphic,
  DesignTokens,
  SemanticEmphasis,
  TransitionClip,
  VisualAnchor,
  VisualOverlay,
  ZoomTrigger,
} from '../types/blueprint.ts';

/** The Remotion component that draws each edit type (ShortVideo.tsx). */
export const RENDERER_TRACK: Record<LedgerEditType, string> = {
  hook_title: 'HookTitle',
  caption: 'KineticCaptions',
  cutaway: 'BRollTrack',
  split: 'SplitStage',
  card: 'VisualOverlayTrack',
  cutout: 'CutoutStage',
  bubble: 'VisualOverlayTrack',
  lockup: 'VisualOverlayTrack',
  pip: 'VisualOverlayTrack',
  composite: 'CompositeTrack',
  zoom: 'ZoomFrame',
  transition: 'TransitionTrack',
  depth_overlay: 'DepthOverlayTrack',
  inset_reveal: 'InsetRevealTrack',
  frame_inset: 'FrameInsetFrame',
  media_container: 'MediaContainerFrame',
  kinetic_text: 'MotionGraphicTrack',
  emphasis: 'SemanticEmphasisTrack',
  generated_graphic: 'GeneratedGraphicTrack',
  behind_subject_text: 'TextBehindSubjectTrack',
};

/** Tracks that read `blueprint.northStarDesign` (the theme channel). */
const THEMED_BY_DESIGN = ['HookTitle', 'KineticCaptions', 'MotionGraphicTrack', 'SemanticEmphasisTrack', 'InsetRevealTrack', 'VisualOverlayTrack'] as const;

export type FinalizeInput = {
  ledger: EditLedger;
  contentProfile: ContentProfile | null;
  /** Existing theme (north-star mode) wins over the profile design. */
  existingDesign?: DesignTokens;
  /** Opt-in (Phase 35): a design built from the Director's validated colour roles. Used like the profile design (edits are harmonized to it), but wins over it. */
  directorDesign?: DesignTokens;
  footageLuminance: number;
  captionLocked: boolean;
  durationSec: number;
  hook: {text: string; start: number; end: number; anchor: VisualAnchor};
  /** Opt-in (Phase 35): the art-directed opening's drawn box (replaces the hook's legacy slot for collision checks) and the behind-subject text, if any. */
  opening?: {start: number; end: number; rect: {x: number; y: number; w: number; h: number}};
  behindSubjectTexts?: BehindSubjectEntry[];
  caption: CaptionDirection;
  brollClips: BRollClip[];
  visualOverlays: VisualOverlay[];
  insetReveals: InsetRevealClip[];
  frameInsets: FrameInset[];
  mediaContainers: MediaContainerMoment[];
  motionGraphics: MotionGraphic[];
  semanticEmphasis: SemanticEmphasis[];
  depthOverlays: DepthOverlayClip[];
  transitions: TransitionClip[];
  zoomTriggers: ZoomTrigger[];
  generatedGraphics: GeneratedGraphic[];
  speaker: SpeakerGeometry;
  speakerCutout: {available?: boolean; videoUrl?: string};
};

export type FinalizeResult = {
  design: DesignTokens | undefined;
  caption: CaptionDirection;
  motionGraphics: MotionGraphic[];
  semanticEmphasis: SemanticEmphasis[];
  frameInsets: FrameInset[];
  mediaContainers: MediaContainerMoment[];
  generatedGraphics: GeneratedGraphic[];
  /** Behind-subject text that survived the conflict validator (shortened or dropped when it genuinely collided). */
  behindSubjectTexts: BehindSubjectEntry[];
  decisions: EditDecision[];
};

export function finalizeEdits(input: FinalizeInput): FinalizeResult {
  const {ledger} = input;
  const design = input.existingDesign ?? input.directorDesign ?? (input.contentProfile ? designFromProfile(input.contentProfile) : undefined);

  let {caption, motionGraphics, semanticEmphasis, frameInsets, mediaContainers} = input;
  if (design && (input.contentProfile || input.directorDesign) && !input.existingDesign) {
    const harmonized = harmonizeEdits({
      design,
      footageLuminance: input.footageLuminance,
      motionGraphics,
      semanticEmphasis,
      frameInsets,
      mediaContainers,
      caption,
      // `captionLocked` means "the palette must not restyle the captions" (it only gates the highlight colour; the template is never touched here).
      // A Director colour direction styles the edits, never the captions, so it implies the lock. The profile design keeps its existing behaviour.
      captionLocked: input.captionLocked || Boolean(input.directorDesign),
    });
    ({caption, motionGraphics, semanticEmphasis, frameInsets, mediaContainers} = harmonized);
    // harmonizeEdits rebuilds each edit (its behaviour is unchanged in this step). Carry the provenance of every value it left alone
    // and re-stamp the values it rewrote: those now come from the content profile's design, not from the Director.
    const from = (field: string) => provenanceOf(design, field) ?? 'profile';
    motionGraphics = motionGraphics.map((graphic, index) =>
      carryProvenanceAfterRewrite(input.motionGraphics[index]!, graphic, {accentColor: from(graphic.role === 'primary' ? 'primaryColor' : 'secondaryColor'), textColor: from('inkColor')}),
    );
    semanticEmphasis = semanticEmphasis.map((item, index) =>
      carryProvenanceAfterRewrite(input.semanticEmphasis[index]!, item, {accentColor: from(item.weight === 'primary' ? 'primaryColor' : 'secondaryColor'), textColor: from('inkColor')}),
    );
    frameInsets = frameInsets.map((inset, index) => carryProvenanceAfterRewrite(input.frameInsets[index]!, inset, {marginColor: from('surfaceColor')}));
    mediaContainers = mediaContainers.map((container, index) =>
      carryProvenanceAfterRewrite(input.mediaContainers[index]!, container, {canvasColor: from('surfaceColor'), canvasTitleColor: from('inkColor')}),
    );
  }

  const view: EditPlanView = {
    durationSec: input.durationSec,
    hook: input.hook,
    ...(input.opening ? {opening: input.opening} : {}),
    ...(input.behindSubjectTexts?.length ? {behindSubjectTexts: input.behindSubjectTexts} : {}),
    captionDirection: {position: caption.position, bottomFrac: caption.bottomFrac},
    brollClips: input.brollClips,
    visualOverlays: input.visualOverlays,
    insetReveals: input.insetReveals,
    frameInsets,
    mediaContainers,
    motionGraphics,
    semanticEmphasis,
    generatedGraphics: input.generatedGraphics,
    speaker: input.speaker,
  };
  const {applied, decisions, edits} = validateAndApply(view, ledger);
  ledger.noteStageContext('conflict_validator', {profile: false, theme: false});

  // Renderer hand-off: every surviving edit reaches its Remotion track.
  const dropped = new Set(decisions.filter(decision => decision.action === 'drop').map(decision => decision.id));
  const keyedCutoutUsable = Boolean(input.speakerCutout.available && input.speakerCutout.videoUrl?.trim());
  for (const edit of edits) {
    if (dropped.has(edit.id) || !ledger.get(edit.id)) {
      continue;
    }
    const track = edit.type === 'generated_graphic' && edit.seamY !== undefined ? 'GeneratedSplitStage' : RENDERER_TRACK[edit.type];
    ledger.rendered(edit.id, track, 'visible');
  }
  // Edits the planners derive themselves (or that no earlier stage registered) still get an entry.
  const handOff = (type: LedgerEditType, start: number, end: number, tolerance: number, visibility: 'visible' | 'noop' = 'visible', reason?: string) => {
    let entry = ledger.find(type, start, tolerance);
    if (!entry) {
      const id = ledger.propose({type, stage: 'plan_assembly', start, end, label: type, reason: 'engine_derived'});
      ledger.accept(id, 'plan_assembly', {to: {start, end}});
      entry = ledger.get(id);
    }
    if (entry && entry.events.at(-1)?.decision !== 'dropped') {
      ledger.rendered(entry.id, RENDERER_TRACK[type], visibility, reason);
    }
  };
  for (const trigger of input.zoomTriggers) {
    handOff('zoom', trigger.start, trigger.end, 1.5);
  }
  for (const transition of input.transitions) {
    // TransitionTrack only draws clips that carry a stock `assetUrl`; engine/Director transitions without one are skipped.
    handOff('transition', transition.at, transition.at + transition.duration, 0.25, transition.assetUrl || transition.renderGenerated ? 'visible' : 'noop', transition.assetUrl || transition.renderGenerated ? undefined : 'transition_has_no_asset_so_TransitionTrack_skips_it');
  }
  for (const clip of input.insetReveals) {
    handOff('inset_reveal', clip.start, clip.end, 1.5);
  }
  for (const clip of input.depthOverlays) {
    // DepthOverlayTrack renders the plain picture unless a keyed speaker video exists.
    handOff('depth_overlay', clip.start, clip.end, 1.5, keyedCutoutUsable ? 'visible' : 'noop', keyedCutoutUsable ? undefined : 'no_keyed_speaker_video');
  }

  // Safety net: an edit the planners accepted but that no renderer track received (for example a depth overlay the blueprint
  // omits because no keyed speaker video exists) must not stay "accepted" — that reads as success. Say what happened.
  for (const entry of ledger.entries()) {
    if (outcomeOf(entry) === 'accepted_not_rendered') {
      ledger.drop(entry.id, 'blueprint', 'accepted_but_not_handed_to_renderer');
    }
  }

  for (const track of THEMED_BY_DESIGN) {
    ledger.noteTrackTheme(track, Boolean(design));
  }
  ledger.noteTrackTheme('GeneratedGraphicTrack', applied.generatedGraphics.some(graphic => Boolean(graphic.props?.theme)));

  return {
    design,
    caption,
    motionGraphics: applied.motionGraphics,
    semanticEmphasis: applied.semanticEmphasis,
    frameInsets,
    mediaContainers,
    generatedGraphics: applied.generatedGraphics,
    behindSubjectTexts: applied.behindSubjectTexts,
    decisions,
  };
}

/**
 * Ledger hooks for `resolveDirectedZooms`. The resolver itself decides one thing only: whether a
 * gate-approved zoom still has a duration after mapping onto the output timeline. Blocking by
 * cutaways/overlays is the editorial gate's decision and is recorded there, not here.
 */
export function zoomResolutionTrace(ledger: EditLedger) {
  return {
    keep: (zoom: object, trigger: ZoomTrigger, note?: string) => {
      const id = ledgerIdOf(zoom);
      if (id && ledger.get(id)) {
        ledger.accept(id, 'plan_assembly', {to: {start: trigger.start, end: trigger.end}, ...(note ? {reason: note} : {})});
      }
    },
    drop: (zoom: object, reason: string) => {
      const id = ledgerIdOf(zoom);
      if (id && ledger.get(id)) {
        ledger.drop(id, 'plan_assembly', reason);
      }
    },
  };
}

/** Anchor changes made by the layout compositor / critique after planning, recorded where the same edit can be matched. */
export function recordAnchorChanges<T extends {start: number; text: string; anchor?: string}>(
  ledger: EditLedger,
  type: 'kinetic_text' | 'emphasis',
  before: T[],
  after: T[],
): void {
  if (before.length !== after.length) {
    return;
  }
  before.forEach((item, index) => {
    const next = after[index]!;
    if (item.anchor && next.anchor && item.anchor !== next.anchor) {
      const entry = ledger.findByLabel(type, item.text, item.start);
      if (entry) {
        ledger.accept(entry.id, 'plan_assembly', {reason: 'layout_compositor_moved_anchor', anchorFrom: item.anchor, anchorTo: next.anchor});
      }
    }
  });
}
