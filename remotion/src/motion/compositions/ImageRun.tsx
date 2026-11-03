import React from 'react';
import {AbsoluteFill, Img, Sequence, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';

import {CARD_BORDER_COLOR, CARD_EXIT_FRAMES, cardBorderPx, cardExitAt, cardExitTransform, cardSequenceFrames, type CardExit} from '../../lib/cardFlyOut';
import {bleedScaleAt, imageRunSlots, isFramedItem, motionSpeedAt, type MotionSpeed} from '../../lib/imageRunTiming';
import {Box} from '../components/Reveal';
import {contentBox, type SafeArea} from '../layout';
import {MotionRecipe} from '../recipes/MotionRecipe';
import type {MotionRecipeId} from '../recipes/motionRecipes';

export type ImageRunItem = {
  src: string;
  label?: string;
  /** This still's own entrance (any MotionRecipeId); without it the run rotates through its mode's defaults. */
  recipeId?: MotionRecipeId;
  /** WP39: how far this full-bleed still pushes in: slow 1.00 -> 1.04 (default), normal 1.06, fast 1.08. Overrides the run's `motionSpeed`. Framed cards ignore it. */
  motionSpeed?: MotionSpeed;
};

export type ImageRunBackdrop = 'blur_self' | 'dim' | 'none';

export type ImageRunProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** The creator's own uploaded stills, in speaking order (2-6; extras are ignored). */
  items: ImageRunItem[];
  /** sequence (default): one still at a time, hard cut with a scale pop. logo_cloud: the first still is the hero, the rest sit small and blurred behind it. */
  mode?: 'sequence' | 'logo_cloud';
  /** Frames each still holds in sequence mode. Default: the graphic's length split evenly. */
  holdFrames?: number;
  /** One entrance for every still without its own `recipeId`. Without it: sequence rotates logo_slam, still_push_in, nested_scale_in; logo_cloud = logo_slam hero over orbit_drift / sticker_pop background items. */
  recipeId?: MotionRecipeId;
  /** dim (default): a dark veil over the footage; solid: an opaque near-black ground. Superseded by `backdrop` when that is set. */
  ground?: 'dim' | 'solid';
  /** WP32: what is behind the framed stills. `dim` (default; the old veil over the footage), `blur_self` (the photo IS the world: each still's own blurred, darkened copy bleeds full-frame behind the sharp framed one) or `none` (transparent: the footage / world underneath shows through). */
  backdrop?: ImageRunBackdrop;
  /** WP30: contain (default; logos / screenshots keep their whole picture) or cover (editorial photos fill the frame, no letterbox). */
  fit?: 'contain' | 'cover';
  /** WP35: a white frame (4-6 px, grammar `framed_card.border_px` 5) drawn around every sharp still. Absent / 0 = no border (labeled logos / screenshots keep their plain card). */
  borderPx?: number;
  /** WP35: `fly_out` = at the cut to the next still the outgoing card tilts in 3D (rotate 12 deg), slides to the bottom-right and smears with motion blur over ~6 frames on top of the next still (grammar `framed_card.exit`). The last still has no exit. */
  exit?: CardExit;
  /** WP36: one hold per still in seconds (sequence mode): each still lasts exactly as long as its VO caption group, hard cut on the boundary. Absent / short = the even split (`holdFrames`). */
  holdsSec?: number[];
  /** WP36: per still, true = framed card (white border + fly-out exit, over the photo-as-world backdrop); false = a full-bleed cover still with the push-in (WP39 `motionSpeed`) and no card chrome. Absent = every still follows `borderPx` / `exit` / `fit`. */
  framedItems?: boolean[];
  /** WP39: the run-level push-in speed of the full-bleed stills (an item's own `motionSpeed` wins). Default `slow` (1.00 -> 1.04); `fast` is the WP36 1.00 -> 1.08. */
  motionSpeed?: MotionSpeed;
};

/** The most stills a run shows. */
export const IMAGE_RUN_MAX_ITEMS = 6;
/** WP24: logo-cloud legibility: background logos at 0.65 opacity with a 5 px blur (depth, not mush), the hero at 0.74 of the width so the cloud peeks around it, and a 0.5 dim veil (the footage stays visible). */
export const IMAGE_RUN_CLOUD_ITEM_OPACITY = 0.65;
export const IMAGE_RUN_CLOUD_BLUR_PX = 5;
export const IMAGE_RUN_CLOUD_HERO_WIDTH = 0.74;
export const IMAGE_RUN_DIM_VEIL = 0.5;
/** WP32: the photo-as-world backdrop: the still's own copy, cover-fit, blurred / darkened / slightly desaturated, pushing in slowly so the bleed is never a static plate. */
export const IMAGE_RUN_BACKDROP_BLUR_PX = 26;
export const IMAGE_RUN_BACKDROP_FILTER = `blur(${IMAGE_RUN_BACKDROP_BLUR_PX}px) saturate(0.65) brightness(0.62)`;
export const IMAGE_RUN_BACKDROP_SCALE_FROM = 1.18;
export const IMAGE_RUN_BACKDROP_SCALE_TO = 1.3;
export const IMAGE_RUN_BACKDROP_BASE = '#050505';
/** WP22: a logo cloud's hero pops again this often (seconds) so a long hold is never a static card; the server planner schedules a transition on each pop. */
export const IMAGE_RUN_CLOUD_POP_SEC = 1.5;

/** WP19: the image_story rotation for a sequence run. */
export const IMAGE_RUN_SEQUENCE_RECIPES: readonly MotionRecipeId[] = ['logo_slam', 'still_push_in', 'nested_scale_in'];
export const IMAGE_RUN_CLOUD_HERO_RECIPE: MotionRecipeId = 'logo_slam';
export const IMAGE_RUN_CLOUD_BACKGROUND_RECIPES: readonly MotionRecipeId[] = ['orbit_drift', 'sticker_pop'];

const CLOUD_SPOTS = [
  {x: 0.22, y: 0.2, s: 0.46},
  {x: 0.78, y: 0.27, s: 0.42},
  {x: 0.24, y: 0.8, s: 0.42},
  {x: 0.78, y: 0.75, s: 0.46},
  {x: 0.5, y: 0.1, s: 0.34},
] as const;

const Still: React.FC<{src: string; w: number; h: number; radius: number; fit?: 'contain' | 'cover'; borderPx?: number}> = ({src, w, h, radius, fit = 'contain', borderPx = 0}) => (
  <div
    style={{
      width: w,
      height: h,
      boxSizing: 'border-box',
      borderRadius: radius,
      overflow: 'hidden',
      boxShadow: '0 24px 60px rgba(0,0,0,0.55)',
      background: 'rgba(255,255,255,0.06)',
      ...(borderPx > 0 ? {border: `${borderPx}px solid ${CARD_BORDER_COLOR}`} : {}),
    }}>
    <Img src={src} style={{width: '100%', height: '100%', objectFit: fit}} />
  </div>
);

/** WP35: one still of a sequence run. Inside its Sequence: frames [0, hold) the still holds; frames [hold, hold + exitFrames) (only with `exit`) its card flies out over the NEXT still, which has already cut in underneath. */
const StillSlide: React.FC<{hold: number; exitFrames: number; world: React.ReactNode; width: number; height: number; children: React.ReactNode}> = ({hold, exitFrames, world, width, height, children}) => {
  const frame = useCurrentFrame();
  const leaving = exitFrames > 0 && frame >= hold;
  if (!leaving) {
    return (
      <>
        {world}
        <CutPop>{children}</CutPop>
      </>
    );
  }
  // the outgoing still's world is gone (the next still's world is the backdrop now); only its card stays, above the next still
  const state = cardExitAt(frame - hold, exitFrames);
  return (
    <AbsoluteFill style={{zIndex: 2, pointerEvents: 'none'}}>
      <AbsoluteFill style={{transform: cardExitTransform(state, width, height), filter: state.blurPx > 0 ? `blur(${state.blurPx}px)` : undefined}}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
};

/** WP36: a full-bleed editorial still (the faceless documentary shot): cover-fit, a linear push-in over its own hold, a soft ~20 % edge vignette. No card, no border, no pop: the next cut is hard. WP39: the push travels 1.00 -> 1.04 / 1.06 / 1.08 by `speed` (default slow). */
const BleedStill: React.FC<{src: string; hold: number; speed?: MotionSpeed}> = ({src, hold, speed}) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{backgroundColor: IMAGE_RUN_BACKDROP_BASE, overflow: 'hidden'}}>
      <Img src={src} style={{width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${bleedScaleAt(frame, hold, speed)})`}} />
      <AbsoluteFill style={{background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,0.2) 100%)'}} />
    </AbsoluteFill>
  );
};

/** WP32: the still's own blurred bleed filling the whole frame (the Metromedia photo-as-world backdrop). Lives inside the still's Sequence, so its push-in restarts with each cut. */
const PhotoWorld: React.FC<{src: string}> = ({src}) => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const scale = interpolate(frame, [0, Math.max(1, durationInFrames)], [IMAGE_RUN_BACKDROP_SCALE_FROM, IMAGE_RUN_BACKDROP_SCALE_TO], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill style={{backgroundColor: IMAGE_RUN_BACKDROP_BASE, overflow: 'hidden'}}>
      <Img src={src} style={{width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${scale})`, filter: IMAGE_RUN_BACKDROP_FILTER}} />
    </AbsoluteFill>
  );
};

/** A hard cut lands with a 4-frame scale pop (1.07 -> 1), the video-collage beat between two stills. */
const CutPop: React.FC<{children: React.ReactNode}> = ({children}) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, 4], [1.07, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return <AbsoluteFill style={{transform: `scale(${scale})`}}>{children}</AbsoluteFill>;
};

/** WP22: the hero of a logo cloud re-pops (1.07 -> 1 over 4 frames) every IMAGE_RUN_CLOUD_POP_SEC after the first entrance. */
const CloudPop: React.FC<{children: React.ReactNode}> = ({children}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const period = Math.round(IMAGE_RUN_CLOUD_POP_SEC * fps);
  const since = frame >= period ? frame % period : 99;
  const scale = interpolate(since, [0, 4], [1.07, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return <div style={{width: '100%', height: '100%', transform: `scale(${scale})`}}>{children}</div>;
};

/**
 * An IMAGE RUN (WP18): the creator's uploaded stills (logos, headshots, screenshots, product shots) shown as a quick video collage, not a card grid. Sequence mode holds each still briefly, a motion recipe brings
 * it in and a hard cut with a scale pop takes the next. Logo-cloud mode keeps one hero still in front with the other logos small, dim and blurred behind it. It draws no text of its own: the spoken words stay
 * with the captions, and `label` is only the accessible name of a still. The graphic's own start / end in the blueprint decide how long the run is up.
 */
export const ImageRun: React.FC<ImageRunProps> = ({width, height, safeArea, items, mode = 'sequence', holdFrames, recipeId, ground = 'dim', backdrop, motionSpeed, fit = 'contain', borderPx, exit, holdsSec, framedItems}) => {
  const {durationInFrames, fps} = useVideoConfig();
  const shown = items.slice(0, IMAGE_RUN_MAX_ITEMS);
  const box = contentBox(width, height, safeArea, Math.min(width, height) * 0.08);
  const world: ImageRunBackdrop = backdrop ?? 'dim';
  const fill = ground === 'solid' ? '#0B0B0B' : `rgba(0,0,0,${IMAGE_RUN_DIM_VEIL})`;
  // dim: the veil / solid ground; none: the world underneath shows through; blur_self: drawn per still below (the photo is the world).
  const veil = world === 'dim' ? <AbsoluteFill style={{backgroundColor: fill}} /> : null;
  const hero = {w: box.width * (mode === 'logo_cloud' ? IMAGE_RUN_CLOUD_HERO_WIDTH : 0.86), h: box.height * 0.5};
  const radius = Math.round(Math.min(width, height) * 0.03);
  const hold = Math.max(6, Math.round(holdFrames ?? durationInFrames / Math.max(1, shown.length)));
  const border = cardBorderPx(borderPx);
  const exitFrames = CARD_EXIT_FRAMES;

  if (mode === 'logo_cloud' && shown.length >= 2) {
    const [lead, ...rest] = shown;
    return (
      <>
        {world === 'blur_self' ? <PhotoWorld src={lead!.src} /> : veil}
        {rest.slice(0, CLOUD_SPOTS.length).map((item, index) => {
          const spot = CLOUD_SPOTS[index]!;
          const size = box.width * spot.s;
          return (
            <div key={`${item.src}-${index}`} style={{position: 'absolute', left: box.x + box.width * spot.x - size / 2, top: box.y + box.height * spot.y - size / 2, width: size, height: size, opacity: IMAGE_RUN_CLOUD_ITEM_OPACITY, filter: `blur(${IMAGE_RUN_CLOUD_BLUR_PX}px)`}}>
              <MotionRecipe recipeId={item.recipeId ?? recipeId ?? IMAGE_RUN_CLOUD_BACKGROUND_RECIPES[index % IMAGE_RUN_CLOUD_BACKGROUND_RECIPES.length]!} delay={2 + index * 2}>
                <Still src={item.src} w={size} h={size} radius={radius} />
              </MotionRecipe>
            </div>
          );
        })}
        <Box {...box}>
          <CloudPop>
          <div style={{width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
            <MotionRecipe recipeId={lead!.recipeId ?? recipeId ?? IMAGE_RUN_CLOUD_HERO_RECIPE}>
              <Still src={lead!.src} w={hero.w} h={hero.h} radius={radius} borderPx={border} />
            </MotionRecipe>
          </div>
          </CloudPop>
        </Box>
      </>
    );
  }

  const slots = imageRunSlots({count: shown.length, durationInFrames, fps, holdFrames: hold, holdsSec});
  return (
    <>
      {veil}
      {shown.map((item, index) => {
        const last = index === shown.length - 1;
        const framed = isFramedItem(framedItems, index);
        const slotAt = slots[index]!;
        if (framed === false) {
          return (
            <Sequence key={`${item.src}-${index}`} from={slotAt.from} durationInFrames={slotAt.hold} layout="none">
              <BleedStill src={item.src} hold={slotAt.hold} speed={motionSpeedAt(shown.map(still => still.motionSpeed), index, motionSpeed)} />
            </Sequence>
          );
        }
        const slot = cardSequenceFrames(slotAt.hold, index, shown.length, exit, exitFrames);
        return (
          <Sequence key={`${item.src}-${index}`} from={slotAt.from} durationInFrames={last ? Math.max(slotAt.hold, durationInFrames - slotAt.from) : slot.frames} layout="none">
            <StillSlide hold={slotAt.hold} exitFrames={slot.exitFrames} world={world === 'blur_self' ? <PhotoWorld src={item.src} /> : null} width={width} height={height}>
              <Box {...box}>
                <div style={{width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                  <MotionRecipe recipeId={item.recipeId ?? recipeId ?? IMAGE_RUN_SEQUENCE_RECIPES[index % IMAGE_RUN_SEQUENCE_RECIPES.length]!}>
                    <Still src={item.src} w={hero.w} h={hero.h} radius={radius} fit={fit} borderPx={border} />
                  </MotionRecipe>
                </div>
              </Box>
            </StillSlide>
          </Sequence>
        );
      })}
    </>
  );
};
