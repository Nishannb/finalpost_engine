/**
 * Soft QC before render: keep only edits that raise engagement.
 *
 * A talking-head short dies from either boredom or visual spam. This gate
 * spaces events, drops weak overlays, and prefers a few intentional beats
 * over a template of every effect at once.
 */

import type {BRollClip, TransitionClip, VisualOverlay} from '../../types/blueprint.ts';
import type {DirectedZoom} from './geminiDirector.ts';

const MIN_EVENT_GAP_SEC = 4.5;
const MAX_BROLL = 3;
const MAX_BROLL_LIST = 5;
const MAX_PHRASE_CARDS = 2;
const MAX_TRANSITIONS = 4;

/** The spacing the gate enforces between one cutaway's end and the next one's start (single source for the beat-preserving scheduler). */
export function cutawayMinGapSec(listMode: boolean | undefined): number {
  return listMode ? 3.2 : MIN_EVENT_GAP_SEC;
}

export type EditorialGateResult = {
  clips: BRollClip[];
  overlays: VisualOverlay[];
  transitions: TransitionClip[];
  zooms: DirectedZoom[];
  warnings: string[];
};

export function applyEditorialGate(input: {
  clips: BRollClip[];
  overlays: VisualOverlay[];
  transitions: TransitionClip[];
  zooms: DirectedZoom[];
  outputDurationSec: number;
  listMode?: boolean;
  /** North-star: keep director density; only drop broken empty splits. */
  relax?: boolean;
  /** Observation only: called for every edit the gate removes, with the exact rule that removed it. */
  onDrop?: (item: BRollClip | VisualOverlay | DirectedZoom | TransitionClip, reason: string, conflict?: BRollClip | VisualOverlay) => void;
}): EditorialGateResult {
  const onDrop = input.onDrop;
  const warnings: string[] = [];
  const maxBroll = input.listMode ? MAX_BROLL_LIST : MAX_BROLL;
  const minGap = cutawayMinGapSec(input.listMode);

  // Split can be motion video, a still, or a related-image slideshow.
  const overlays = input.overlays.filter(overlay => {
    if (overlay.layout !== 'split') {
      return true;
    }
    const hasSlides = (overlay.slides?.length ?? 0) >= 2;
    const ok =
      Boolean(overlay.assetUrl) &&
      (overlay.mediaKind === 'video' || overlay.mediaKind === 'image' || hasSlides);
    if (!ok) {
      warnings.push('split_dropped_empty');
      onDrop?.(overlay, 'split_dropped_empty');
    }
    return ok;
  });

  if (input.relax) {
    return {
      clips: input.clips.sort((a, b) => a.start - b.start),
      overlays: overlays.sort((a, b) => a.start - b.start),
      transitions: input.transitions,
      zooms: input.zooms,
      warnings,
    };
  }

  const ranked = [...overlays].sort((a, b) => layoutRank(a) - layoutRank(b) || a.start - b.start);
  const keptOverlays: VisualOverlay[] = [];
  let phraseCards = 0;

  for (const overlay of ranked) {
    if (overlay.layout === 'lockup' && overlay.textStyle === 'stack') {
      if (phraseCards >= MAX_PHRASE_CARDS) {
        warnings.push('phrase_card_capped');
        onDrop?.(overlay, `phrase_card_capped_at_${MAX_PHRASE_CARDS}`);
        continue;
      }
    }
    if (overlay.layout === 'sticker' || overlay.layout === 'pip') {
      // Tiny corner stickers rarely raise retention on talking-head shorts.
      warnings.push(`dropped_low_value:${overlay.layout}`);
      onDrop?.(overlay, `dropped_low_value:${overlay.layout}`);
      continue;
    }
    if (overlay.layout === 'composite') {
      warnings.push('dropped_low_value:composite');
      onDrop?.(overlay, 'dropped_low_value:composite');
      continue;
    }
    if (collidesBusy(overlay.start, overlay.end, keptOverlays, input.clips, minGap * 0.55)) {
      if (overlay.layout === 'split') {
        // Split wins: drop later weaker overlays that collide, keep split.
        const trimmed = keptOverlays.filter(other => {
          const keep =
            other.layout === 'split' ||
            !(overlay.start < other.end + 0.4 && overlay.end > other.start - 0.4);
          if (!keep) {
            onDrop?.(other, 'yielded_to_split', overlay);
          }
          return keep;
        });
        keptOverlays.length = 0;
        keptOverlays.push(...trimmed, overlay);
        continue;
      }
      warnings.push(`dropped_overlap:${overlay.layout}`);
      onDrop?.(overlay, `dropped_overlap:${overlay.layout}`);
      continue;
    }
    keptOverlays.push(overlay);
    if (overlay.layout === 'lockup' && overlay.textStyle === 'stack') {
      phraseCards += 1;
    }
  }

  const splitWindows = keptOverlays.filter(o => o.layout === 'split');
  const clips = [...input.clips]
    .sort((a, b) => a.start - b.start)
    .filter(clip => {
      const split = splitWindows.find(window => clip.start < window.end && clip.end > window.start);
      if (split) {
        warnings.push('cutaway_yielded_to_split');
        onDrop?.(clip, 'cutaway_yielded_to_split', split);
        return false;
      }
      return true;
    });
  for (const overflow of clips.slice(maxBroll)) {
    onDrop?.(overflow, `cutaway_cap_${maxBroll}`);
  }
  clips.length = Math.min(clips.length, maxBroll);

  const spacedClips: BRollClip[] = [];
  for (const clip of clips) {
    const previous = spacedClips.at(-1);
    if (previous && clip.start < previous.end + minGap) {
      // Never shift a cutaway later — that desyncs the spoken word from the picture.
      warnings.push('cutaway_spaced');
      onDrop?.(clip, `cutaway_within_${minGap}s_of_previous_cutaway`, previous);
      continue;
    }
    const nearOverlay = keptOverlays.find(
      overlay =>
        overlay.layout !== 'lockup' &&
        clip.start < overlay.end + 1.2 &&
        clip.end > overlay.start - 1.2,
    );
    if (nearOverlay) {
      warnings.push('cutaway_near_overlay');
      onDrop?.(clip, 'cutaway_within_1.2s_of_overlay', nearOverlay);
      continue;
    }
    spacedClips.push(clip);
  }

  const unblockedZooms = input.zooms.filter(zoom => {
    const start = zoom.timestamp;
    const end = zoom.timestamp + zoom.durationSec;
    const blocked = blockedByVisual(start, end, spacedClips, keptOverlays);
    if (blocked) {
      onDrop?.(zoom, 'zoom_blocked_by_cutaway_or_overlay');
    }
    return !blocked;
  });
  const zooms = spaceZooms(unblockedZooms, 9, onDrop);

  const nearVisualTransitions = input.transitions.filter(transition => {
    const nearVisual =
      spacedClips.some(clip => Math.abs(clip.start - transition.at) < 0.6) ||
      keptOverlays.some(
        overlay =>
          (overlay.layout === 'split' || overlay.layout === 'cutaway') &&
          Math.abs(overlay.start - transition.at) < 0.6,
      );
    if (!nearVisual) {
      onDrop?.(transition, 'transition_not_near_a_visual');
    }
    return nearVisual;
  });
  const transitions = nearVisualTransitions.slice(0, MAX_TRANSITIONS);
  for (const overflow of nearVisualTransitions.slice(MAX_TRANSITIONS)) {
    onDrop?.(overflow, `transition_cap_${MAX_TRANSITIONS}`);
  }

  // Long static talking-head with almost no visuals → keep at least one cutaway if we have it.
  if (
    input.outputDurationSec > 22 &&
    spacedClips.length === 0 &&
    !keptOverlays.some(o => o.layout === 'split') &&
    input.clips[0]
  ) {
    spacedClips.push(input.clips[0]);
    warnings.push('cutaway_restored_for_novelty');
  }

  return {
    clips: spacedClips.sort((a, b) => a.start - b.start),
    overlays: keptOverlays.sort((a, b) => a.start - b.start),
    transitions,
    zooms,
    warnings,
  };
}

function layoutRank(overlay: VisualOverlay): number {
  if (overlay.layout === 'split') {
    return 0;
  }
  if (overlay.layout === 'cutaway') {
    return 1;
  }
  if (overlay.layout === 'lockup' && overlay.textStyle === 'stack') {
    return 2;
  }
  if (overlay.layout === 'banner' || overlay.layout === 'chip') {
    return 3;
  }
  return 5;
}

function collidesBusy(
  start: number,
  end: number,
  overlays: VisualOverlay[],
  clips: BRollClip[],
  gap: number,
): boolean {
  return (
    overlays.some(other => start < other.end + gap && end > other.start - gap) ||
    clips.some(clip => start < clip.end + gap && end > clip.start - gap)
  );
}

function blockedByVisual(
  start: number,
  end: number,
  clips: BRollClip[],
  overlays: VisualOverlay[],
): boolean {
  return (
    clips.some(clip => start < clip.end && end > clip.start) ||
    overlays.some(
      overlay =>
        (overlay.layout === 'split' || overlay.layout === 'cutaway') &&
        start < overlay.end &&
        end > overlay.start,
    )
  );
}

function spaceZooms(zooms: DirectedZoom[], minGapSec: number, onDrop?: (zoom: DirectedZoom, reason: string) => void): DirectedZoom[] {
  const out: DirectedZoom[] = [];
  const sorted = [...zooms].sort((a, b) => a.timestamp - b.timestamp);
  for (const [index, zoom] of sorted.entries()) {
    if (zoom.timestamp < 3.8) {
      onDrop?.(zoom, 'zoom_before_3.8s');
      continue;
    }
    const previous = out.at(-1);
    if (previous && zoom.timestamp < previous.timestamp + minGapSec) {
      onDrop?.(zoom, `zoom_within_${minGapSec}s_of_previous_zoom`);
      continue;
    }
    out.push(zoom);
    if (out.length >= 3) {
      for (const overflow of sorted.slice(index + 1)) {
        onDrop?.(overflow, 'zoom_cap_3');
      }
      break;
    }
  }
  return out;
}
