import React from 'react';

import {ACME_BASE_SEC, ACME_DEFAULT_WORD, ACME_SCENES, acmeFruitState, acmeSceneIndex, fitContain, type AcmeFruit} from '../../../lib/motionTemplateTiming';
import type {SafeArea} from '../../layout';
import {useTemplateClock} from './useTemplateClock';

export type AcmeFruitLetterSwapProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** The wordmark (default ACME). One glyph per scene is replaced by a fruit; an index past the word clamps to its last glyph. */
  word?: string;
  /** Override the beat length (frames); defaults to the Sequence's duration. */
  durationInFrames?: number;
};

const ARTBOARD_ASPECT = 4 / 5;
/** Flared, wedge-serif capitals; falls back to Optima / Palatino, then any serif. */
const FLARED_SERIF = `'Marcellus', 'Optima', 'Palatino Linotype', Georgia, serif`;

/** Flat vector stand-ins for the photoreal fruit: solid fills only, no gradient, no halo. */
const Fruit: React.FC<{kind: AcmeFruit; size: number}> = ({kind, size}) => (
  <svg width={size} height={size} viewBox="-50 -50 100 100" style={{display: 'block', overflow: 'visible'}}>
    {kind === 'apple' && (
      <>
        <path d="M0 -30 C-14 -42 -46 -30 -42 4 C-40 34 -18 46 0 38 C18 46 40 34 42 4 C46 -30 14 -42 0 -30 Z" fill="#E0241B" />
        <rect x={-2.5} y={-46} width={5} height={18} rx={2.5} fill="#5A3A1E" />
        <ellipse cx={12} cy={-38} rx={14} ry={7} fill="#3E9B3A" transform="rotate(-25 12 -38)" />
      </>
    )}
    {kind === 'grapes' && (
      <>
        {[
          [-22, -14], [0, -18], [22, -14], [-12, 4], [12, 4], [0, 24], [-26, 8], [26, 8],
        ].map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy! + 4} r={13} fill={i % 2 === 0 ? '#6B2FA0' : '#7F3FBF'} />
        ))}
        <rect x={-2.5} y={-46} width={5} height={16} rx={2.5} fill="#5A3A1E" />
        <ellipse cx={14} cy={-38} rx={14} ry={7} fill="#3E9B3A" transform="rotate(-20 14 -38)" />
      </>
    )}
    {kind === 'banana' && (
      <>
        <path d="M-44 -8 C-38 34 18 48 46 -30 L38 -38 C16 8 -22 14 -38 -16 Z" fill="#FFD83B" />
        <circle cx={-42} cy={-12} r={5} fill="#5A3A1E" />
        <circle cx={42} cy={-34} r={5} fill="#5A3A1E" />
      </>
    )}
    {kind === 'peach' && (
      <>
        <circle cx={0} cy={4} r={38} fill="#FF9B73" />
        <path d="M2 -32 C-14 -12 -14 20 6 40" fill="none" stroke="#E8704A" strokeWidth={5} strokeLinecap="round" />
        <rect x={-2.5} y={-46} width={5} height={14} rx={2.5} fill="#5A3A1E" />
        <ellipse cx={14} cy={-38} rx={14} ry={7} fill="#3E9B3A" transform="rotate(-25 14 -38)" />
      </>
    )}
  </svg>
);

/**
 * CLIP_09 ACME FRUIT LETTER SWAP (WP47 Layer 2): a flared-serif wordmark centred on a flat colour field, 4:5 artboard, 3.83 s seamless loop. color_field_cut: the whole ground HARD-cuts between five scenes
 * (burst - rest - emphasis; lime / orange / grey / orange / navy) and each scene fixes the word's scale (0.58 / 0.58 / 0.22 / 1.20 / 0.58 of the artboard width). letter_swap: in four scenes one glyph is replaced by a
 * fruit that settles from 1.6x to 1x over 0.4 s (ease-out) with a ~15 degree turn. Fruit are flat vector stand-ins (no alpha halo). No fade, blur, glitch, shake or glow. Silent.
 */
export const AcmeFruitLetterSwap: React.FC<AcmeFruitLetterSwapProps> = ({width, height, word, durationInFrames}) => {
  const {t} = useTemplateClock(ACME_BASE_SEC, durationInFrames);
  const board = fitContain(ARTBOARD_ASPECT, width, height);
  const scene = ACME_SCENES[acmeSceneIndex(t)]!;
  const fruit = acmeFruitState(t);
  const glyphs = [...(word && word.trim() ? word.trim() : ACME_DEFAULT_WORD)];
  const wordW = board.w * scene.scale;
  const cell = wordW / glyphs.length;
  const fontSize = cell * 1.2;
  const left = (width - wordW) / 2;
  const top = board.y + board.h / 2 - cell / 2;
  const swapAt = fruit ? Math.min(fruit.glyph, glyphs.length - 1) : -1;

  return (
    <div style={{position: 'absolute', inset: 0, overflow: 'hidden', backgroundColor: scene.bg}}>
      {glyphs.map((glyph, i) => (
        <div key={i} style={{position: 'absolute', left: Math.round(left + i * cell), top: Math.round(top), width: Math.round(cell), height: Math.round(cell), display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
          {i === swapAt && fruit ? (
            <div style={{width: cell * 0.96, height: cell * 0.96, transform: `rotate(${fruit.rotateDeg}deg) scale(${fruit.scale})`, transformOrigin: '50% 50%'}}>
              <Fruit kind={fruit.fruit} size={cell * 0.96} />
            </div>
          ) : (
            <span style={{fontFamily: FLARED_SERIF, fontWeight: 400, fontSize, lineHeight: 1, color: scene.ink, whiteSpace: 'pre'}}>{glyph}</span>
          )}
        </div>
      ))}
    </div>
  );
};
