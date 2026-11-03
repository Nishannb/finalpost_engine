/**
 * WP26: the SMASH ZOOM PUNCH of the footage. A `smash zoom` transition used to be an overlay only (an edge blowout); the picture underneath did not move. This is the pure frame math for the other half: while a smash-zoom
 * transition window is open, the main footage stack scales 1.0 -> `SMASH_PUNCH_PEAK` -> 1.0 (and picks up a touch of blur at the peak), in sync with the blowout (same window as `drawableTransitions`).
 */
import {proceduralStyleOf} from './proceduralTransition';
import {drawableTransitions} from './timeline';

export const SMASH_PUNCH_PEAK = 1.16;
export const SMASH_PUNCH_BLUR_PX = 3;
/** The punch builds fast and releases slower: the peak sits at 40 % of the window. */
const PEAK_AT = 0.4;

export type SmashPunch = {scale: number; blurPx: number};
export const NO_PUNCH: SmashPunch = {scale: 1, blurPx: 0};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeIn = (t: number) => t ** 2;

/** The punch at one frame of a transition window of `durationInFrames`. 1 at both ends, `SMASH_PUNCH_PEAK` at the peak. */
export function smashPunchAt(frameInWindow: number, durationInFrames: number): SmashPunch {
  if (durationInFrames < 2 || frameInWindow < 0 || frameInWindow > durationInFrames) return NO_PUNCH;
  const t = clamp01(frameInWindow / Math.max(1, durationInFrames - 1));
  const amount = t <= PEAK_AT ? easeOut(t / PEAK_AT) : 1 - easeIn((t - PEAK_AT) / (1 - PEAK_AT));
  return {scale: Math.round((1 + (SMASH_PUNCH_PEAK - 1) * amount) * 1000) / 1000, blurPx: Math.round(SMASH_PUNCH_BLUR_PX * amount * 10) / 10};
}

/** The punch of the footage at output frame `frame`: the strongest of every smash-zoom transition whose window contains the frame; no punch for any other transition keyword. */
export function smashPunchForClips(clips: ReadonlyArray<{at: number; duration: number; assetUrl: string; keyword?: string; renderGenerated?: boolean}>, frame: number, fps: number, totalFrames: number): SmashPunch {
  let best = NO_PUNCH;
  for (const {clip, from, durationInFrames} of drawableTransitions([...clips], fps, totalFrames)) {
    if (clip.assetUrl || proceduralStyleOf(clip.keyword) !== 'smash_zoom') continue;
    const punch = smashPunchAt(frame - from, durationInFrames);
    if (punch.scale > best.scale) best = punch;
  }
  return best;
}
