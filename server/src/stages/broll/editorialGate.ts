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
}): EditorialGateResult {
  const warnings: string[] = [];
  const maxBroll = input.listMode ? MAX_BROLL_LIST : MAX_BROLL;
  const minGap = input.listMode ? 3.2 : MIN_EVENT_GAP_SEC;

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
        continue;
      }
    }
    if (overlay.layout === 'sticker' || overlay.layout === 'pip') {
      // Tiny corner stickers rarely raise retention on talking-head shorts.
      warnings.push(`dropped_low_value:${overlay.layout}`);
      continue;
    }
    if (overlay.layout === 'composite') {
      warnings.push('dropped_low_value:composite');
      continue;
    }
    if (collidesBusy(overlay.start, overlay.end, keptOverlays, input.clips, minGap * 0.55)) {
      if (overlay.layout === 'split') {
        // Split wins: drop later weaker overlays that collide, keep split.
        const trimmed = keptOverlays.filter(
          other =>
            other.layout === 'split' ||
            !(overlay.start < other.end + 0.4 && overlay.end > other.start - 0.4),
        );
        keptOverlays.length = 0;
        keptOverlays.push(...trimmed, overlay);
        continue;
      }
      warnings.push(`dropped_overlap:${overlay.layout}`);
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
      if (splitWindows.some(split => clip.start < split.end && clip.end > split.start)) {
        warnings.push('cutaway_yielded_to_split');
        return false;
      }
      return true;
    })
    .slice(0, maxBroll);

  const spacedClips: BRollClip[] = [];
  for (const clip of clips) {
    const previous = spacedClips.at(-1);
    if (previous && clip.start < previous.end + minGap) {
      // Never shift a cutaway later — that desyncs the spoken word from the picture.
      warnings.push('cutaway_spaced');
      continue;
    }
    if (
      keptOverlays.some(
        overlay =>
          overlay.layout !== 'lockup' &&
          clip.start < overlay.end + 1.2 &&
          clip.end > overlay.start - 1.2,
      )
    ) {
      warnings.push('cutaway_near_overlay');
      continue;
    }
    spacedClips.push(clip);
  }

  const zooms = spaceZooms(
    input.zooms.filter(zoom => {
      const start = zoom.timestamp;
      const end = zoom.timestamp + zoom.durationSec;
      return !blockedByVisual(start, end, spacedClips, keptOverlays);
    }),
    9,
  );

  const transitions = input.transitions
    .filter(transition => {
      const nearVisual =
        spacedClips.some(clip => Math.abs(clip.start - transition.at) < 0.6) ||
        keptOverlays.some(
          overlay =>
            (overlay.layout === 'split' || overlay.layout === 'cutaway') &&
            Math.abs(overlay.start - transition.at) < 0.6,
        );
      return nearVisual;
    })
    .slice(0, MAX_TRANSITIONS);

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

function spaceZooms(zooms: DirectedZoom[], minGapSec: number): DirectedZoom[] {
  const out: DirectedZoom[] = [];
  for (const zoom of [...zooms].sort((a, b) => a.timestamp - b.timestamp)) {
    if (zoom.timestamp < 3.8) {
      continue;
    }
    const previous = out.at(-1);
    if (previous && zoom.timestamp < previous.timestamp + minGapSec) {
      continue;
    }
    out.push(zoom);
    if (out.length >= 3) {
      break;
    }
  }
  return out;
}
