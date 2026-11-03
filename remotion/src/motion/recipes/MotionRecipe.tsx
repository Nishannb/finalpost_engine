import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';

import {Reveal} from '../components/Reveal';
import {
  counterSnapValue,
  exitFrames,
  getRecipe,
  recipeExitState,
  recipeState,
  scrambleText,
  typeTrailGlyphs,
  type MotionRecipeId,
} from './motionRecipes';

export type MotionRecipeProps = {
  /** One of MOTION_RECIPE_IDS. An unknown id falls back to a snappy pop (never a bare fade). */
  recipeId: MotionRecipeId | string;
  /** Frames before the entrance starts. */
  delay?: number;
  /** Override: freeze the recipe at this frame (relative to the start of the entrance). Used by tests and by hosts that time several layers together. */
  atFrame?: number;
  /** Glyph recipes (type_trail, scramble_settle): the text to draw. Without it the wrapped children get the recipe's light wrapper motion. */
  text?: string;
  /** counter_snap: the number to count. Without it the children are wrapped. */
  value?: {from?: number; to: number; prefix?: string; suffix?: string; decimals?: number};
  /**
   * WP14F: vernacular exit over the last frames (true = 10 frames, or a frame count). Uses smear_blur_out / scale_blur_out / close_mask
   * matched to the recipe family — not a soft fade alone.
   */
  exit?: boolean | number;
  style?: React.CSSProperties;
  children?: React.ReactNode;
};

const fixed = (value: number, decimals: number) => value.toFixed(decimals);

/**
 * Runs a motion recipe (video vernacular: elastic snap, smear, type trail, scramble, split reveal, squash and stretch, counter snap, nested scale) on its children, or on `text` / `value` for the glyph and number
 * recipes. Pure in the frame: no state, no effects. The entrance is a short fixed span (see `entranceFrames`) so the graphic can be 40 % longer or shorter.
 */
export const MotionRecipe: React.FC<MotionRecipeProps> = ({recipeId, delay = 0, atFrame, text, value, exit, style, children}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const recipe = getRecipe(recipeId);
  if (!recipe) {
    return (
      <Reveal effect="pop" spring="snappy" delay={delay} style={style}>
        {text ?? children}
      </Reveal>
    );
  }
  const local = (atFrame ?? frame) - delay;
  // Before its delay the layer is hidden (a delayed recipe must not sit on its first frame while it waits).
  if (local < 0) return <div style={{...style, opacity: 0}}>{children ?? text}</div>;
  const state = recipeState(recipe.id, local, fps, durationInFrames);
  const exitLen = exit ? exitFrames(durationInFrames, exit === true ? 10 : exit) : 0;
  const exitState = exit ? recipeExitState(recipe.id, frame, durationInFrames, exitLen) : null;
  const filters = [
    Math.max(state.blurPx, exitState?.blurPx ?? 0) > 0 ? `blur(${Math.max(state.blurPx, exitState?.blurPx ?? 0)}px)` : '',
    // glitch: a red / blue drop-shadow pair is the RGB split (no blue-green, so it never reads as the karaoke colour)
    state.rgbSplitPx > 0 ? `drop-shadow(${-state.rgbSplitPx}px 0 0 rgba(255,45,85,0.75)) drop-shadow(${state.rgbSplitPx}px 0 0 rgba(45,120,255,0.75))` : '',
  ].filter(Boolean);
  const maskCell = state.maskCellPx;
  const mask = maskCell !== undefined ? 'conic-gradient(#000 25%, transparent 0 50%, #000 0 75%, transparent 0)' : undefined;
  const tx = state.translateX + (exitState?.translateX ?? 0);
  const ty = state.translateY + (exitState?.translateY ?? 0);
  const sx = state.scaleX * (exitState?.scaleX ?? 1);
  const sy = state.scaleY * (exitState?.scaleY ?? 1);
  const rot = state.rotateDeg + (exitState?.rotateDeg ?? 0);
  const opacity = state.opacity * (exitState?.opacity ?? 1);
  const wrapper: React.CSSProperties = {
    ...style,
    opacity,
    // WP19: card_tilt_in swings under perspective (rotateX / rotateY); every other recipe leaves both at 0 and gets no perspective.
    transform: `${state.rotateXDeg !== 0 || state.rotateYDeg !== 0 ? `perspective(900px) rotateX(${state.rotateXDeg}deg) rotateY(${state.rotateYDeg}deg) ` : ''}translate(${tx}px, ${ty}px) rotate(${rot}deg) scale(${sx}, ${sy})${style?.transform ? ` ${style.transform}` : ''}`,
    filter: filters.length > 0 ? filters.join(' ') : undefined,
    clipPath: exitState?.clipPath ?? state.clipPath,
    ...(mask ? {maskImage: mask, WebkitMaskImage: mask, maskSize: `${maskCell}px ${maskCell}px`, WebkitMaskSize: `${maskCell}px ${maskCell}px`} : {}),
  };

  if (recipe.id === 'scramble_settle' && text !== undefined) {
    return <div style={wrapper}>{scrambleText(text, Math.max(0, local), durationInFrames)}</div>;
  }
  if (recipe.id === 'type_trail' && text !== undefined) {
    const glyphs = typeTrailGlyphs(text, Math.max(0, local), durationInFrames);
    return (
      <div style={{...wrapper, whiteSpace: 'pre-wrap'}}>
        {glyphs.map((glyph, index) => (
          <span key={index} style={{position: 'relative', display: 'inline-block', opacity: glyph.opacity, transform: `translateY(${glyph.translateY}px)`}}>
            {glyph.ghosts.map((ghost, ghostIndex) => (
              <span key={ghostIndex} aria-hidden style={{position: 'absolute', left: `${ghost.offsetEm}em`, top: 0, opacity: ghost.opacity}}>
                {glyph.char}
              </span>
            ))}
            {glyph.char}
          </span>
        ))}
      </div>
    );
  }
  if (recipe.id === 'counter_snap' && value) {
    const shown = counterSnapValue(Math.max(0, local), fps, durationInFrames, value.from ?? 0, value.to);
    return (
      <div style={wrapper}>
        {value.prefix ?? ''}
        {fixed(shown, value.decimals ?? 0)}
        {value.suffix ?? ''}
      </div>
    );
  }
  if (recipe.id === 'nested_scale_in') {
    return (
      <div style={wrapper}>
        <div style={{transform: `scale(${state.innerScale})`, transformOrigin: 'center center'}}>{children ?? text}</div>
      </div>
    );
  }
  return <div style={wrapper}>{children ?? text}</div>;
};
