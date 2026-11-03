/**
 * WP35: the FRAMED-CARD EXIT (Metromedia grammar `framed_card`): a still's white-bordered card leaves with a 3D tilt (rotate 12 deg), slides off to the bottom-right and smears with motion blur over ~6 frames,
 * revealing the next still. Pure frame math (no React / Remotion).
 *
 *   exit: {rotate_deg: 12, slide: bottom_right, motion_blur: true, frames: 6}
 *   border_px: 5, border_color: "#FFFFFF"
 */
export const CARD_BORDER_PX = 5;
export const CARD_BORDER_PX_RANGE = {min: 4, max: 6} as const;
export const CARD_BORDER_COLOR = '#FFFFFF';
export const CARD_EXIT_FRAMES = 6;
export const CARD_EXIT_ROTATE_DEG = 12;
/** The 3D part of the tilt: the card turns about its vertical / horizontal axis as it goes (perspective 1100 px). */
export const CARD_EXIT_TILT_Y_DEG = -22;
export const CARD_EXIT_TILT_X_DEG = 9;
export const CARD_EXIT_PERSPECTIVE_PX = 1100;
export const CARD_EXIT_MAX_BLUR_PX = 16;
export type CardExit = 'fly_out';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round3 = (value: number) => Math.round(value * 1000) / 1000;
/** Accelerating: the card hangs for a frame, then is thrown (ease-in cubic). */
const easeIn = (t: number) => t ** 3;

export const cardBorderPx = (px: number | undefined): number => (px === undefined || !(px > 0) ? 0 : clamp(Math.round(px), CARD_BORDER_PX_RANGE.min, CARD_BORDER_PX_RANGE.max));

export type CardExitState = {
  /** Fractions of the composition width / height the card has travelled toward the bottom-right. */
  slideXFrac: number;
  slideYFrac: number;
  rotateZDeg: number;
  rotateYDeg: number;
  rotateXDeg: number;
  scale: number;
  /** Motion blur: a CSS blur peaking mid-throw, plus a horizontal stretch along the travel direction. */
  blurPx: number;
  stretchX: number;
  /** 0 while the card sits, 1 at the last exit frame (the card is fully off the frame by then). */
  progress: number;
};

export const CARD_AT_REST: CardExitState = {slideXFrac: 0, slideYFrac: 0, rotateZDeg: 0, rotateYDeg: 0, rotateXDeg: 0, scale: 1, blurPx: 0, stretchX: 1, progress: 0};

/** The card at `frameInExit` (0 = the first exit frame) of a `frames`-long exit. Frame `frames - 1` is entirely off-frame. */
export function cardExitAt(frameInExit: number, frames: number = CARD_EXIT_FRAMES): CardExitState {
  const total = Math.max(2, Math.round(frames));
  if (frameInExit < 0) return CARD_AT_REST;
  // frame 0 already moves a little (the throw starts on the cut), the last frame is at progress 1
  const p = clamp((frameInExit + 1) / total, 0, 1);
  const e = easeIn(p);
  const speed = clamp(Math.sin(Math.PI * Math.min(1, p * 0.9 + 0.1)), 0, 1);
  return {
    slideXFrac: round3(1.25 * e),
    slideYFrac: round3(0.75 * e),
    rotateZDeg: round3(CARD_EXIT_ROTATE_DEG * e),
    rotateYDeg: round3(CARD_EXIT_TILT_Y_DEG * e),
    rotateXDeg: round3(CARD_EXIT_TILT_X_DEG * e),
    scale: round3(1 - 0.12 * e),
    blurPx: round3(CARD_EXIT_MAX_BLUR_PX * speed),
    stretchX: round3(1 + 0.18 * speed),
    progress: round3(p),
  };
}

/** The CSS transform of the card for an exit state (translate in px of the composition). */
export function cardExitTransform(state: CardExitState, width: number, height: number): string {
  if (state.progress === 0) return 'none';
  return `perspective(${CARD_EXIT_PERSPECTIVE_PX}px) translate(${Math.round(state.slideXFrac * width)}px, ${Math.round(state.slideYFrac * height)}px) rotateZ(${state.rotateZDeg}deg) rotateY(${state.rotateYDeg}deg) rotateX(${state.rotateXDeg}deg) scale(${state.scale}) scaleX(${state.stretchX})`;
}

/** The sequence length of still `index` of `count` when its card flies out over the next still: its hold plus the exit frames (the last still has no next still, so no exit). */
export function cardSequenceFrames(hold: number, index: number, count: number, exit: CardExit | undefined, exitFrames: number = CARD_EXIT_FRAMES): {frames: number; exitFrames: number} {
  if (exit !== 'fly_out' || index >= count - 1) return {frames: hold, exitFrames: 0};
  return {frames: hold + exitFrames, exitFrames};
}
