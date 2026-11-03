import React from 'react';

import {
  NEVER_DONE_BASE_SEC,
  NEVER_DONE_COLORS,
  NEVER_DONE_DEFAULT_LINES,
  NEVER_DONE_DEFAULT_WORDMARK,
  fitContain,
  neverDoneFrame,
} from '../../../lib/motionTemplateTiming';
import {fontFamily} from '../../fonts';
import type {SafeArea} from '../../layout';
import {PhotoFill} from './shared';
import {useTemplateClock} from './useTemplateClock';

export type NeverDoneSlitPosterProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** The four headline lines (default We / are / never / done.): the first two sit above the slit, the last two below. */
  lines?: [string, string, string, string];
  /** The photo (default: a grey flat-colour silhouette stand-in; always drawn black and white). */
  imageSrc?: string;
  /** The small wordmark at the bottom (default acme™; live polish hides it with `hideMicro`). */
  wordmark?: string;
  /** Hide the wordmark + mono caption (live polish). */
  hideMicro?: boolean;
  /** Override the beat length (frames); defaults to the Sequence's duration. */
  durationInFrames?: number;
};

const ARTBOARD_ASPECT = 4 / 5;

/**
 * CLIP_20 NEVER DONE SLIT POSTER (WP50 Layer 2 / Part 4): #000000, 4:5 artboard, 2.38 s. Starts on black (no payoff flash) -> lines pop as a centred block (80 ms stagger, mask rise) -> hold ->
 * slit_reveal: the photo opens from the centre axis between lines 2 and 3 while the halves part into state A, then holds. The headline is ALWAYS above the photo. Silent. No glitch, blur, glow or cross-fade.
 */
export const NeverDoneSlitPoster: React.FC<NeverDoneSlitPosterProps> = ({width, height, lines, imageSrc, wordmark, hideMicro = false, durationInFrames}) => {
  const {t} = useTemplateClock(NEVER_DONE_BASE_SEC, durationInFrames);
  const board = fitContain(ARTBOARD_ASPECT, width, height);
  const copy = lines && lines.length === 4 ? lines : NEVER_DONE_DEFAULT_LINES;
  const mark = wordmark && wordmark.trim() ? wordmark.trim() : NEVER_DONE_DEFAULT_WORDMARK;
  const frame = neverDoneFrame(t);
  const fontSize = board.h * 0.1;
  const lineBox = board.h * 0.12;
  const window = frame.window;

  return (
    <div style={{position: 'absolute', inset: 0, overflow: 'hidden', backgroundColor: NEVER_DONE_COLORS.ground}}>
      <div style={{position: 'absolute', left: board.x, top: board.y, width: board.w, height: board.h, overflow: 'hidden', backgroundColor: NEVER_DONE_COLORS.ground}}>
        {!frame.black && window > 0 && (
          <div style={{position: 'absolute', inset: 0, clipPath: `inset(${((1 - window) / 2) * 100}% 0 ${((1 - window) / 2) * 100}% 0)`}}>
            <PhotoFill src={imageSrc} ground="#3A3A3A" figure="#0F0F0F" sun="#9A9A9A" grayscale />
            <div style={{position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.3)'}} />
            {!hideMicro && (
              <div style={{position: 'absolute', left: 0, right: 0, top: '49%', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: board.w * 0.015, color: NEVER_DONE_COLORS.ink, fontFamily: "'Courier New', monospace", fontSize: board.w * 0.022, letterSpacing: board.w * 0.003}}>
                <span style={{width: 0, height: 0, borderTop: `${board.w * 0.0075}px solid transparent`, borderBottom: `${board.w * 0.0075}px solid transparent`, borderLeft: `${board.w * 0.013}px solid ${NEVER_DONE_COLORS.ink}`}} />
                <span>SIDE A / TRACK 01</span>
              </div>
            )}
          </div>
        )}
        {!frame.black &&
          copy.map((line, i) => (
            <div key={`line${i}`} style={{position: 'absolute', left: 0, width: board.w, top: Math.round(frame.lineY[i]! * board.h - lineBox / 2), height: lineBox, overflow: 'hidden', display: 'flex', justifyContent: 'center', alignItems: 'center'}}>
              <div style={{transform: `translateY(${(1 - frame.lineReveal[i]!) * 100}%)`, color: NEVER_DONE_COLORS.ink, fontFamily: fontFamily('space_grotesk'), fontWeight: 700, fontSize, lineHeight: 1, letterSpacing: -fontSize * 0.02, whiteSpace: 'nowrap'}}>{line}</div>
            </div>
          ))}
        {!frame.black && !hideMicro && (
          <div style={{position: 'absolute', left: 0, right: 0, top: board.h * 0.955, textAlign: 'center', color: NEVER_DONE_COLORS.ink, fontFamily: fontFamily('space_grotesk'), fontWeight: 700, fontSize: board.w * 0.032}}>{mark}</div>
        )}
      </div>
    </div>
  );
};
