import React from 'react';
import {Img} from 'remotion';

import {ENTER_EASE_OUT, EXIT_EASE_IN, MOVE_IN_OUT, bezierAt, eased, phase} from '../../../lib/craftTiming';
import type {SafeArea} from '../../layout';
import {hexOr, readableInk} from './colorUtil';
import {useTemplateClock} from './useTemplateClock';

export type LogoRevealProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** The creator's logo (https asset). Required upstream: without it the beat is skipped with a warning. */
  logoSrc?: string;
  accent?: string;
  ground?: string;
  durationInFrames?: number;
};

export const LOGO_REVEAL_BASE_SEC = 2.4;

/**
 * CLIP_39 LOGO REVEAL (WP54 / card, brand): the provided logo opens from a hard-edged mask (hero band, ease-out) and settles with a 4% scale; an accent underline sweeps beneath it (moveInOut). Cinematic band exit (ease-in). No particles, no music.
 * Silent, owns the frame. Needs a logo asset — no wordmark text is ever invented.
 */
export const LogoReveal: React.FC<LogoRevealProps> = ({width, height, logoSrc, accent, ground, durationInFrames}) => {
  const {t, durSec} = useTemplateClock(LOGO_REVEAL_BASE_SEC, durationInFrames);
  const bg = hexOr(ground) ?? '#FFFFFF';
  const hot = hexOr(accent) ?? readableInk(bg, '#BFFF00', '#111111');
  const open = bezierAt(ENTER_EASE_OUT, phase(t, 0.15, 0.7));
  const settle = 1.04 - 0.04 * bezierAt(MOVE_IN_OUT, phase(t, 0.15, 1.2));
  const sweep = eased(MOVE_IN_OUT, t, 0.7, 0.6);
  const exit = eased(EXIT_EASE_IN, t, Math.max(1.4, durSec - 0.4), 0.35);
  const box = Math.min(width * 0.6, height * 0.3);
  return (
    <div style={{position: 'absolute', inset: 0, overflow: 'hidden', backgroundColor: bg}}>
      <div style={{position: 'absolute', left: (width - box) / 2, top: height * 0.4 - box / 2, width: box, height: box, clipPath: `inset(0 ${(1 - open) * 50}% 0 ${(1 - open) * 50}%)`, transform: `scale(${settle})`, opacity: 1 - exit}}>
        {logoSrc ? <Img src={logoSrc} style={{width: '100%', height: '100%', objectFit: 'contain'}} /> : <div style={{width: '100%', height: '100%', borderRadius: box * 0.2, backgroundColor: hot}} />}
      </div>
      <div style={{position: 'absolute', left: (width - box) / 2, top: height * 0.4 + box / 2 + height * 0.025, width: box * sweep * (1 - exit), height: Math.max(5, height * 0.005), backgroundColor: hot}} />
    </div>
  );
};
