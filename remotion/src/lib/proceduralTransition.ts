/**
 * WP12C: PROCEDURAL transitions: styles the renderer draws with no stock asset, from the transition's own keyword. Pure (no React, no Remotion), so the frame math is unit-testable.
 *
 *   hard_cut      no overlay at all (an intentional cut, kept as a transition so pacing can be audited)
 *   flash_white   a short white flash that peaks on the cut
 *   flash_black   a short dip to black that peaks on the cut
 *   whip_blur     a brief horizontal smear: the picture under the layer is blurred and streaked across the cut
 *   grade_bw_hold the picture under the layer goes black-and-white for the window (a grade flip that holds, then returns)
 *   whip_blur_left / whip_blur_right  directional smear: the streak sweeps one way across the cut (whip_blur keeps its original left-to-right sweep)
 *   smash_zoom    a punch-in feel: a white edge blowout and blur ring swell to a peak on the cut and clear
 *   dip_color     a short warm-orange flash (a video grade dip, not UI chrome) that peaks on the cut
 *   blur_dissolve a soft full-frame blur with a light veil across the cut (a lens-blur dissolve, not a card fade)
 *
 * The keyword strings are the vocabulary the Director style hints map onto (server `transitionPlan.ts`, kept in sync by a test).
 */
export type ProceduralStyle = 'hard_cut' | 'flash_white' | 'flash_black' | 'whip_blur' | 'grade_bw_hold' | 'whip_blur_left' | 'whip_blur_right' | 'smash_zoom' | 'dip_color' | 'blur_dissolve';

export const PROCEDURAL_KEYWORDS: Record<ProceduralStyle, string> = {
  hard_cut: 'hard cut',
  flash_white: 'flash white',
  flash_black: 'flash black',
  whip_blur: 'whip blur',
  grade_bw_hold: 'grade bw hold',
  whip_blur_left: 'whip blur left',
  whip_blur_right: 'whip blur right',
  smash_zoom: 'smash zoom',
  dip_color: 'dip color',
  blur_dissolve: 'blur dissolve',
};

/** The one accent of `dip_color`: a warm orange grade dip (never the karaoke blue-green). */
export const DIP_COLOR = '#FF6A00';

const BY_KEYWORD = new Map<string, ProceduralStyle>(Object.entries(PROCEDURAL_KEYWORDS).map(([style, keyword]) => [keyword, style as ProceduralStyle]));

/** The procedural style a transition keyword names, or null (an engine / stock keyword). */
export function proceduralStyleOf(keyword: string | undefined): ProceduralStyle | null {
  return BY_KEYWORD.get((keyword ?? '').trim().toLowerCase().replace(/[_-]+/g, ' ')) ?? null;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
/** 0 -> 1 -> 0 over the window, peaking at `peak` (0..1 of the window). */
const tent = (t: number, peak = 0.5) => (t <= peak ? clamp01(t / Math.max(1e-6, peak)) : clamp01((1 - t) / Math.max(1e-6, 1 - peak)));

export type ProceduralLayer =
  | {kind: 'none'}
  | {kind: 'flash'; color: string; opacity: number}
  | {kind: 'whip'; blurPx: number; streakX: number; opacity: number; /** +1 sweeps left to right, -1 right to left. */ direction: 1 | -1}
  | {kind: 'grade'; grayscale: number; contrast: number; opacity: number}
  | {kind: 'smash'; blurPx: number; ringScale: number; edgeOpacity: number}
  | {kind: 'dissolve'; blurPx: number; veilOpacity: number};

/** What to paint at `frame` of a `durationInFrames`-long transition. */
export function proceduralLayer(style: ProceduralStyle, frame: number, durationInFrames: number): ProceduralLayer {
  const t = clamp01(frame / Math.max(1, durationInFrames - 1));
  switch (style) {
    case 'hard_cut':
      return {kind: 'none'};
    case 'flash_white':
      return {kind: 'flash', color: '#FFFFFF', opacity: 0.95 * tent(t, 0.4)};
    case 'flash_black':
      return {kind: 'flash', color: '#000000', opacity: 0.95 * tent(t, 0.4)};
    case 'whip_blur':
    case 'whip_blur_right':
    case 'whip_blur_left': {
      const direction = style === 'whip_blur_left' ? -1 : 1;
      const strength = tent(t, 0.45);
      return {kind: 'whip', blurPx: Math.round(26 * strength * 10) / 10, streakX: Math.round(direction * (t * 2 - 1) * 60 * 10) / 10, opacity: strength, direction};
    }
    case 'smash_zoom': {
      const peak = tent(t, 0.5);
      // WP24: no scaled backdrop blur (it doubled the picture into a blob): a mild blur, a white blowout that closes in from the edges (ringScale 1 -> 1.45 = how far in) and a whole-frame white wash at the peak
      return {kind: 'smash', blurPx: Math.round(8 * peak * 10) / 10, ringScale: Math.round((1 + 0.45 * peak) * 1000) / 1000, edgeOpacity: Math.round(1 * peak * 1000) / 1000};
    }
    case 'dip_color':
      // WP24: a plateau, not a tent: the wash reaches 0.95 by ~25 % of the window and holds until ~65 %, so the mid-frame is obviously orange
      return {kind: 'flash', color: DIP_COLOR, opacity: 0.95 * clamp01(tent(t, 0.4) * 1.6)};
    case 'blur_dissolve': {
      const peak = tent(t, 0.5);
      return {kind: 'dissolve', blurPx: Math.round(18 * peak * 10) / 10, veilOpacity: Math.round(0.22 * peak * 1000) / 1000};
    }
    case 'grade_bw_hold': {
      // ramps in over the first 20 %, holds, ramps out over the last 20 %
      const ramp = t < 0.2 ? t / 0.2 : t > 0.8 ? (1 - t) / 0.2 : 1;
      return {kind: 'grade', grayscale: clamp01(ramp), contrast: 1 + 0.18 * clamp01(ramp), opacity: 1};
    }
  }
}
