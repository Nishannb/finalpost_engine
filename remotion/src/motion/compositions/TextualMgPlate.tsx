/**
 * Skill C — TextualMgPlate: Jitter-class hero/emphasis type over media (not karaoke, not ProcessSteps).
 * Catalog: remotion/src/lib/textualMgCatalog.ts · grammar: textual-mg-grammar.yaml
 * Default ground is transparent so type blends into the video frame; optional soft plate for legibility.
 */
import React from 'react';
import {AbsoluteFill} from 'remotion';

import {textualMgFontPx, textualMgLines} from '../../lib/textualMgLines';
import {defaultRecipeFor, type TextualMgFamily, type TextualMgRecipeId} from '../../lib/textualMgCatalog';
import {Box} from '../components/Reveal';
import {FitText} from '../components/Text';
import {contentBox, type SafeArea} from '../layout';
import {MotionRecipe} from '../recipes/MotionRecipe';
import type {MotionRecipeId} from '../recipes/motionRecipes';

export type TextualMgPlateProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** Spoken / designed line (1–8 words typical). */
  text: string;
  family?: TextualMgFamily;
  recipeId?: TextualMgRecipeId | MotionRecipeId;
  /** Fill colour of the type. */
  color?: string;
  /** Soft black stroke for legibility over busy media. */
  stroke?: boolean;
  /**
   * none = type over footage (Skill C default blend).
   * soft_plate = translucent dark band behind type only (not a solid world).
   * Never a full-bleed solid “world” — use FlashCard for that interrupt.
   */
  background?: 'none' | 'soft_plate';
  /** Vertical centre of the plate as a fraction of frame height (chest-band default). */
  yFrac?: number;
  /** counter_metric: count to this value (text can be prefix/suffix). */
  counter?: {from?: number; to: number; prefix?: string; suffix?: string; decimals?: number};
};

export const TEXTUAL_MG_MAX_WORDS = 8;
/** Frames between successive lines of a glyph-recipe plate (trail / scramble). */
const LINE_STAGGER_FRAMES = 4;

const clipWords = (raw: string, max: number) =>
  raw
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, max)
    .join(' ');

/**
 * Mid-frame designed type with recipe entrance + vernacular exit. Host for Skill C families.
 */
export const TextualMgPlate: React.FC<TextualMgPlateProps> = ({
  width,
  height,
  safeArea,
  text,
  family = 'snap_elastic',
  recipeId,
  color = '#FFFFFF',
  stroke = true,
  background = 'none',
  yFrac = 0.48,
  counter,
}) => {
  const recipe = recipeId ?? defaultRecipeFor(family);
  const shown = clipWords(text, TEXTUAL_MG_MAX_WORDS);
  const box = contentBox(width, height, safeArea, Math.min(width, height) * 0.07);
  const bandH = Math.min(height * 0.28, box.height * 0.55);
  const bandTop = height * yFrac - bandH / 2;
  const typeStyle: React.CSSProperties = {
    fontFamily: 'system-ui, "Segoe UI", Inter, sans-serif',
    fontWeight: 900,
    letterSpacing: family === 'trail_cascade' ? 0.02 : -0.02,
    textTransform: family === 'tagline_plate' || family === 'snap_elastic' ? 'uppercase' : 'none',
    color,
    textAlign: 'center',
    width: '100%',
    ...(stroke
      ? {
          WebkitTextStroke: `${Math.max(1, width * 0.0018)}px rgba(0,0,0,0.85)`,
          paintOrder: 'stroke fill',
          textShadow: '0 8px 28px rgba(0,0,0,0.55), 0 2px 4px rgba(0,0,0,0.4)',
        }
      : {textShadow: '0 6px 24px rgba(0,0,0,0.45)'}),
  };

  const glyphLines = textualMgLines(shown, 3);
  const glyphPx = textualMgFontPx(glyphLines, box.width, Math.min(width, height) * 0.1);
  const body =
    recipe === 'counter_snap' && counter ? (
      <MotionRecipe recipeId={recipe} value={counter} exit style={{...typeStyle, fontSize: Math.min(width, height) * 0.14}} />
    ) : recipe === 'type_trail' || recipe === 'scramble_settle' ? (
      // glyph recipes draw one inline-block per character: break into whole-word lines ourselves (never mid-word), stagger the lines
      <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%'}}>
        {glyphLines.map((line, index) => (
          <MotionRecipe key={index} recipeId={recipe} text={line} delay={index * LINE_STAGGER_FRAMES} exit style={{...typeStyle, whiteSpace: 'nowrap', fontSize: glyphPx, lineHeight: 1.08}} />
        ))}
      </div>
    ) : (
      <MotionRecipe recipeId={recipe} exit>
        <FitText
          text={shown}
          width={box.width}
          height={bandH}
          maxLines={3}
          align="center"
          verticalAlign="center"
          uppercase={family === 'tagline_plate' || family === 'snap_elastic'}
          weight={900}
          letterSpacing={-0.02}
          color={color}
        />
      </MotionRecipe>
    );

  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      {background === 'soft_plate' ? (
        <div
          style={{
            position: 'absolute',
            left: width * 0.06,
            width: width * 0.88,
            top: bandTop - height * 0.02,
            height: bandH + height * 0.04,
            borderRadius: Math.min(width, height) * 0.02,
            background: 'rgba(0,0,0,0.42)',
          }}
        />
      ) : null}
      <Box x={box.x} y={Math.max(box.y, bandTop)} width={box.width} height={bandH}>
        <div style={{width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>{body}</div>
      </Box>
    </AbsoluteFill>
  );
};
