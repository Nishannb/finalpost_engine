import React from 'react';
import {Img} from 'remotion';

import {EXIT_EASE_IN, MOVE_IN_OUT, eased, phase, bezierAt} from '../../../lib/craftTiming';
import type {SafeArea} from '../../layout';
import {hexOr} from './colorUtil';
import {useTemplateClock} from './useTemplateClock';

export type PhotoKenBurnsProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** A single still. Required upstream. */
  imageSrc?: string;
  /** Push-in focus in 0..1 (centre default). */
  focus?: {x: number; y: number};
  /** Final scale (1.08-1.2; default 1.14). */
  zoomTo?: number;
  accent?: string;
  ground?: string;
  durationInFrames?: number;
};

export const KEN_BURNS_BASE_SEC = 3.2;

/**
 * CLIP_44 PHOTO KEN BURNS (WP54 / zoom): ONE still pushed in on a slow moveInOut curve toward a focus point, with a gentle drift; a thin accent bar draws at the bottom edge of the safe area. It is a full-screen template beat — not a third still
 * system (ImageRun keeps its own motionSpeed); it is only planned when a still already exists. Silent, owns the frame.
 */
export const PhotoKenBurns: React.FC<PhotoKenBurnsProps> = ({width, height, imageSrc, focus, zoomTo = 1.14, accent, ground, durationInFrames}) => {
  const {t, durSec} = useTemplateClock(KEN_BURNS_BASE_SEC, durationInFrames);
  const bg = hexOr(ground) ?? '#0B0B0B';
  const hot = hexOr(accent) ?? '#BFFF00';
  const fx = focus && Number.isFinite(focus.x) ? Math.min(0.9, Math.max(0.1, focus.x)) : 0.5;
  const fy = focus && Number.isFinite(focus.y) ? Math.min(0.9, Math.max(0.1, focus.y)) : 0.5;
  const z = 1 + (Math.min(1.25, Math.max(1.05, zoomTo)) - 1) * bezierAt(MOVE_IN_OUT, phase(t, 0, durSec));
  const exit = eased(EXIT_EASE_IN, t, Math.max(1.2, durSec - 0.25), 0.22);
  return (
    <div style={{position: 'absolute', inset: 0, overflow: 'hidden', backgroundColor: bg}}>
      <div style={{position: 'absolute', inset: 0, transform: `scale(${z}) translate(${(0.5 - fx) * (z - 1) * 12}%, ${(0.5 - fy) * (z - 1) * 12}%)`, transformOrigin: `${fx * 100}% ${fy * 100}%`, opacity: 1 - exit}}>
        {imageSrc ? <Img src={imageSrc} style={{width: '100%', height: '100%', objectFit: 'cover'}} /> : <div style={{width: '100%', height: '100%', backgroundColor: '#3A3F4A'}} />}
      </div>
      <div style={{position: 'absolute', left: width * 0.08, top: height * 0.74, width: width * 0.2 * eased(MOVE_IN_OUT, t, 0.4, 0.6) * (1 - exit), height: Math.max(4, height * 0.004), backgroundColor: hot}} />
    </div>
  );
};
