import React from 'react';

import {MOVE_IN_OUT, bezierAt, eased, phase} from '../../../lib/craftTiming';
import type {SafeArea} from '../../layout';
import {hexOr, mixHex} from './colorUtil';
import {useTemplateClock} from './useTemplateClock';

export type MeshGradientGroundProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  accent?: string;
  ground?: string;
  ink?: string;
  /** 0..1 overall strength (default 0.5: soft, never competes with the speaker or type). */
  strength?: number;
  durationInFrames?: number;
};

export const MESH_BASE_SEC = 4.0;

/**
 * CLIP_40 MESH GRADIENT GROUND (WP54 / ambient, from the motion-background recipe): three soft radial colour fields (accent / ground / ink mixes) drift on a cinematic-band curve under an OVERLAY — it carries NO text, owns no frame
 * and never mutes the captions. At most one per edit. Edge-faded in and out by opacity of the fields themselves. No particles, no audio.
 */
export const MeshGradientGround: React.FC<MeshGradientGroundProps> = ({width, height, accent, ground, ink, strength = 0.5, durationInFrames}) => {
  const {t, durSec} = useTemplateClock(MESH_BASE_SEC, durationInFrames);
  const hot = hexOr(accent) ?? '#7A5CFF';
  const base = hexOr(ground) ?? '#101828';
  const tone = hexOr(ink) ?? '#FFFFFF';
  const s = Math.min(0.8, Math.max(0.15, strength));
  const fade = Math.min(eased(MOVE_IN_OUT, t, 0, 0.6), 1 - eased(MOVE_IN_OUT, t, Math.max(0.8, durSec - 0.6), 0.6));
  const drift = bezierAt(MOVE_IN_OUT, phase(t, 0, durSec));
  const fields = [
    {color: hot, x: 22 + drift * 20, y: 24 + drift * 10, r: 62},
    {color: mixHex(hot, base, 0.5), x: 78 - drift * 18, y: 48 + drift * 14, r: 70},
    {color: mixHex(tone, hot, 0.65), x: 40 + drift * 16, y: 82 - drift * 12, r: 58},
  ];
  return (
    <div style={{position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', opacity: fade * s}}>
      {fields.map((f, i) => (
        <div key={i} style={{position: 'absolute', inset: 0, backgroundImage: `radial-gradient(circle at ${f.x}% ${f.y}%, ${f.color} 0%, transparent ${f.r}%)`, mixBlendMode: i === 2 ? 'soft-light' : 'normal'}} />
      ))}
    </div>
  );
};
