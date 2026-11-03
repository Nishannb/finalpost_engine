import React from 'react';
import {Img} from 'remotion';

import {
  CONFIG_BRAND_LOOP_BASE_SEC,
  CONFIG_COLORS,
  CONFIG_SCENE_TONES,
  configMaskPath,
  configMaskRadiiAt,
  configScene,
  configStickerState,
  fitContain,
} from '../../../lib/motionTemplateTiming';
import {fontFamily} from '../../fonts';
import type {SafeArea} from '../../layout';
import {PhotoFill} from './shared';
import {useTemplateClock} from './useTemplateClock';

export type ConfigScene = {src?: string};

export type ConfigBrandLoopProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** Up to 5 still photos, one per scene (A-E). A scene with no `src` draws a flat silhouette stand-in. */
  scenes?: ConfigScene[];
  /** The persistent wordmark (default CONFIG). It never animates. */
  wordmark?: string;
  /** One accent for this instance: it recolours the "SHIP IT" cursor tag (default blue). */
  accent?: string;
  /** Hide the demo "SHIP IT" sticker (live polish with a video-bound wordmark). */
  hideShipTag?: boolean;
  /** Override the beat length (frames); defaults to the Sequence's duration. */
  durationInFrames?: number;
};

const ARTBOARD_ASPECT = 4 / 5;
const TAG_TEXT = 'SHIP IT';

const Flower: React.FC<{size: number}> = ({size}) => (
  <svg width={size} height={size} viewBox="-50 -50 100 100">
    {[0, 60, 120, 180, 240, 300].map(deg => (
      <ellipse key={deg} cx={0} cy={-28} rx={15} ry={24} fill={CONFIG_COLORS.magenta} transform={`rotate(${deg})`} />
    ))}
    <circle r={12} fill={CONFIG_COLORS.yellow} />
  </svg>
);

const DiscDiamond: React.FC<{size: number}> = ({size}) => (
  <svg width={size} height={size} viewBox="-50 -50 100 100">
    <circle cx={-12} cy={8} r={34} fill={CONFIG_COLORS.yellow} />
    <rect x={14} y={-46} width={30} height={30} fill={CONFIG_COLORS.yellow} transform="rotate(45 29 -31)" />
  </svg>
);

const ShipTag: React.FC<{size: number; color: string}> = ({size, color}) => (
  <div style={{position: 'relative', width: size * 1.7, height: size * 0.62}}>
    <div style={{position: 'absolute', left: 0, top: size * 0.12, width: size * 1.7, height: size * 0.5, borderRadius: size * 0.1, backgroundColor: color, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
      <span style={{fontFamily: fontFamily('inter'), fontWeight: 900, fontSize: size * 0.23, letterSpacing: '0.04em', color: CONFIG_COLORS.white}}>{TAG_TEXT}</span>
    </div>
    <svg width={size * 0.3} height={size * 0.36} viewBox="0 0 30 36" style={{position: 'absolute', left: -size * 0.1, top: -size * 0.1}}>
      <path d="M2 2 L2 28 L9 21 L14 33 L19 31 L14 19 L24 19 Z" fill={CONFIG_COLORS.white} stroke={CONFIG_COLORS.black} strokeWidth={2} strokeLinejoin="round" />
    </svg>
  </div>
);

/**
 * CLIP_05 CONFIG BRAND LOOP (WP46 Layer 2): 4:5 black artboard, 7.63 s seamless loop. hard_cut_on_grid swaps a still photo every 1.5 s (5 scenes); mask_morph deforms the photo's outline from 0.15 s before each cut to 0.4 s
 * after it; sticker_pop drops three flat vector stickers (flower, disc + diamond, SHIP IT tag) on their own clocks (dot -> full over 0.8 s ease-out with a 45 degree turn, shrink out over 0.2 s). The wordmark is static and top-most.
 * No fade, no blur, no glow, no Ken Burns. Silent.
 */
export const ConfigBrandLoop: React.FC<ConfigBrandLoopProps> = ({width, height, scenes, wordmark = 'CONFIG', accent, hideShipTag = false, durationInFrames}) => {
  const {t} = useTemplateClock(CONFIG_BRAND_LOOP_BASE_SEC, durationInFrames);
  const board = fitContain(ARTBOARD_ASPECT, width, height);
  const scene = configScene(t);
  const tone = CONFIG_SCENE_TONES[scene % CONFIG_SCENE_TONES.length]!;
  const src = scenes?.[scene]?.src;

  // the photo: ~60 % of the artboard width, centred, slightly above the vertical centre; static
  const photoW = Math.round(board.w * 0.6);
  const photoH = Math.round(photoW * 1.18);
  const photoX = Math.round(board.x + (board.w - photoW) / 2);
  const photoY = Math.round(board.y + board.h * 0.46 - photoH / 2);
  const path = configMaskPath(configMaskRadiiAt(t), photoW, photoH);

  const sticker = (id: 'flower' | 'disc_diamond' | 'ship_tag', cx: number, cy: number, child: React.ReactNode) => {
    const state = configStickerState(id, t);
    if (!state) return null;
    return (
      <div key={id} style={{position: 'absolute', left: Math.round(cx), top: Math.round(cy), transform: `translate(-50%, -50%) rotate(${state.rotateDeg}deg) scale(${state.scale})`, transformOrigin: '50% 50%'}}>
        {child}
      </div>
    );
  };
  const unit = board.w * 0.22;
  const wordWidth = board.w * 0.25;

  return (
    <div style={{position: 'absolute', inset: 0, overflow: 'hidden', backgroundColor: CONFIG_COLORS.black}}>
      <div style={{position: 'absolute', left: photoX, top: photoY, width: photoW, height: photoH, clipPath: `path("${path}")`}}>
        {src ? <Img src={src} style={{position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover'}} /> : <PhotoFill ground={tone.ground} figure={tone.figure} sun={tone.sun} />}
      </div>
      {sticker('flower', board.x + board.w * 0.83, board.y + board.h * 0.15, <Flower size={unit} />)}
      {sticker('disc_diamond', board.x + board.w * 0.17, board.y + board.h * 0.76, <DiscDiamond size={unit * 0.95} />)}
      {!hideShipTag && sticker('ship_tag', board.x + board.w * 0.76, board.y + board.h * 0.72, <ShipTag size={unit * 0.9} color={accent && /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : CONFIG_COLORS.blue} />)}
      <div style={{position: 'absolute', left: Math.round(board.x + (board.w - wordWidth) / 2), top: Math.round(board.y + board.h * 0.9), width: Math.round(wordWidth), transform: 'translateY(-50%)', textAlign: 'center', whiteSpace: 'nowrap', fontFamily: fontFamily('inter'), fontWeight: 900, fontSize: Math.round(wordWidth / (wordmark.length * 0.72 + 0.1)), lineHeight: 1, letterSpacing: '0.02em', color: CONFIG_COLORS.white}}>
        {wordmark}
      </div>
    </div>
  );
};
