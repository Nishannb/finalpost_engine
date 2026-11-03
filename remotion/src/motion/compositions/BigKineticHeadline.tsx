import React from 'react';

import {Box} from '../components/Reveal';
import {PlateGround, usePlatePalette} from '../components/Plate';
import {KineticText} from '../components/Text';
import {contentBox, splitColumn, type SafeArea} from '../layout';
import {MotionRecipe} from '../recipes/MotionRecipe';
import type {MotionRecipeId} from '../recipes/motionRecipes';

export type HeadlineLine = {text: string; weight?: number; color?: string};

export type BigKineticHeadlineProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** Stacked lines, top to bottom (at most 5 are shown). Mixed weights give the "Organic WARMS the audience" energy. */
  lines: HeadlineLine[];
  /** A word or phrase to light up in the accent colour wherever it appears. */
  accent?: string;
  /**
   * WP14D: the entrance recipe of each line (default stretch_squash_pop: the stacked headline is a punchline beat, so it lands with cartoon physics). The recipe owns the layer's settle; the words still
   * stagger in with KineticText for reading energy.
   */
  recipeId?: MotionRecipeId;
  /** Opaque background (full-screen). Default false: type over the footage. */
  background?: boolean;
};

export const HEADLINE_MAX_LINES = 5;

/** Large stacked, mixed-weight headline: each line lands word by word, the accent phrase is coloured. */
export const BigKineticHeadline: React.FC<BigKineticHeadlineProps> = ({width, height, safeArea, lines, accent, recipeId = 'stretch_squash_pop', background = false}) => {
  const palette = usePlatePalette();
  const shown = lines.filter(line => line.text.trim()).slice(0, HEADLINE_MAX_LINES);
  const box = contentBox(width, height, safeArea, Math.min(width, height) * 0.06);
  const rows = splitColumn(box, Math.max(1, shown.length), Math.min(width, height) * 0.015);
  return (
    <>
      {background ? <PlateGround /> : null}
      {shown.map((line, index) => (
        <Box key={index} {...rows[index]!}>
          <MotionRecipe recipeId={recipeId} delay={index * 8}>
          <KineticText
            text={line.text}
            width={rows[index]!.width}
            height={rows[index]!.height}
            maxLines={1}
            align="left"
            uppercase
            weight={line.weight ?? (index % 2 === 0 ? 900 : 600)}
            color={line.color ?? palette.ink}
            delay={index * 8}
            each={3}
            effect="up"
            highlight={accent ? [accent] : undefined}
            highlightColor={palette.marker}
            highlightInk={palette.markerInk}
            highlightOpacity={1}
            highlightStyle="marker"
          />
          </MotionRecipe>
        </Box>
      ))}
    </>
  );
};
