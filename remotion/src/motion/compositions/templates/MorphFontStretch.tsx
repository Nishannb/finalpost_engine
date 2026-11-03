import React from 'react';

import {MORPH_BASE_SEC, MORPH_COLORS, MORPH_DEFAULT_TEXT, MORPH_WIDTH, easeOutCubic, fitContain, mix, morphFrame} from '../../../lib/motionTemplateTiming';
import {fontFamily} from '../../fonts';
import type {SafeArea} from '../../layout';
import {useTemplateClock} from './useTemplateClock';

export type MorphFontStretchProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** The word (default MORPH). */
  text?: string;
  /** One accent for this instance: the letter colour (default cyan). */
  accent?: string;
  /** Override the beat length (frames); defaults to the Sequence's duration. */
  durationInFrames?: number;
};

const ARTBOARD_ASPECT = 16 / 10;
/** Average advance (em) of the heavy rounded display face and of the plain sans: they size the per-letter cells. */
const BUBBLY_ADVANCE = 0.78;
const PLAIN_ADVANCE = 0.58;
/** The bubbly face is drawn tall (a 1.8x vertical scale of the glyph only), so that the 3.8x stretch overflows the artboard and is cropped, as in the reference. */
const BUBBLY_TALL = 1.8;
const BUBBLY_FONT = `'Fredoka', 'Arial Rounded MT Bold', 'Nunito', 'Baloo 2', ${fontFamily('inter')}`;

/**
 * CLIP_10 MORPH FONT STRETCH (WP47 Layer 2): cyan (#00B1FC) lettering on #11102A, 16:10 artboard (letterboxed inside a 9:16 frame), 2.30 s seamless loop. The word starts as heavy bubbly display type (width ~0.53 of the artboard),
 * vertical_stretch pulls it to 1.8x wide / 3.8x tall (cropped by the artboard) from 0.53 s, a HARD cut at 1.37 s resets it to a plain sans (width ~0.25), and font_morph turns each letter plain -> bubbly while it scales up,
 * left to right (0.17 s stagger, 0.18 s per letter; the stagger tightens only if the word is too long to finish before the loop point). The morph is a per-letter face swap at the half way point plus a scale-up: no cross-fade.
 * Silent. No blur, glow or glitch.
 */
export const MorphFontStretch: React.FC<MorphFontStretchProps> = ({width, height, text, accent, durationInFrames}) => {
  const {t} = useTemplateClock(MORPH_BASE_SEC, durationInFrames);
  const board = fitContain(ARTBOARD_ASPECT, width, height);
  const letters = [...(text && text.trim() ? text.trim() : MORPH_DEFAULT_TEXT)];
  const frame = morphFrame(t, letters.length);
  const color = accent && /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : MORPH_COLORS.cyan;

  const bubblyAdv = (board.w * MORPH_WIDTH.bubbly) / letters.length;
  const plainAdv = (board.w * MORPH_WIDTH.plain) / letters.length;
  const bubblyFs = bubblyAdv / BUBBLY_ADVANCE;
  const plainFs = plainAdv / PLAIN_ADVANCE;
  const cellH = bubblyFs * 1.1;

  return (
    <div style={{position: 'absolute', inset: 0, overflow: 'hidden', backgroundColor: MORPH_COLORS.ground}}>
      <div style={{position: 'absolute', left: board.x, top: board.y, width: board.w, height: board.h, overflow: 'hidden'}}>
        <div style={{position: 'absolute', left: 0, top: board.h / 2 - cellH / 2, width: board.w, height: cellH, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${frame.sx}, ${frame.sy})`, transformOrigin: '50% 50%'}}>
          {letters.map((letter, i) => {
            const m = frame.letters[i]!;
            const e = easeOutCubic(m);
            const bubbly = m >= 0.5;
            return (
              <div key={i} style={{width: mix(plainAdv, bubblyAdv, e), height: cellH, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                <span style={{display: 'block', fontFamily: bubbly ? BUBBLY_FONT : fontFamily('inter'), fontWeight: bubbly ? 700 : 400, fontSize: mix(plainFs, bubblyFs, e), lineHeight: 1, color, whiteSpace: 'pre', transform: bubbly ? `scaleY(${BUBBLY_TALL})` : undefined, transformOrigin: '50% 50%'}}>{letter}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
