import React from 'react';
import {AbsoluteFill} from 'remotion';

import {Box} from '../components/Reveal';
import {FitText} from '../components/Text';
import {contentBox, type SafeArea} from '../layout';
import {MotionRecipe} from '../recipes/MotionRecipe';
import type {MotionRecipeId} from '../recipes/motionRecipes';

export type FlashCardProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** The connective phrase (spoken words), 1-4 words. More than 4 are cut to the first 4 on screen. */
  phrase: string;
  /** The solid ground: black (white type, the default) or white (black type). */
  ground?: 'black' | 'white';
  /** The slam: default stretch_squash_pop (cartoon physics, not a fade). */
  recipeId?: MotionRecipeId;
};

/** The most words a flash card shows. */
export const FLASH_CARD_MAX_WORDS = 4;

const GROUNDS = {black: {fill: '#000000', ink: '#FFFFFF'}, white: {fill: '#FFFFFF', ink: '#000000'}} as const;

/**
 * A FLASH / PIVOT CARD (WP17): a pattern interrupt on a connective beat ("Then everything broke"). A solid full-frame black or white ground (no gradient, no card, no paper), one to four words of heavy display type
 * centred, slammed in by a motion recipe. It does not decide how long it stays: the graphic's own start / end in the blueprint do (the seed keeps it to ~0.35-1.2 s), then a cut or whip takes the next world.
 */
export const FlashCard: React.FC<FlashCardProps> = ({width, height, safeArea, phrase, ground = 'black', recipeId = 'stretch_squash_pop'}) => {
  const colors = GROUNDS[ground];
  const shown = phrase.trim().split(/\s+/).filter(Boolean).slice(0, FLASH_CARD_MAX_WORDS).join(' ');
  const box = contentBox(width, height, safeArea, Math.min(width, height) * 0.08);
  return (
    <>
      <AbsoluteFill style={{backgroundColor: colors.fill}} />
      <Box {...box}>
        <MotionRecipe recipeId={recipeId}>
          <FitText text={shown} width={box.width} height={box.height} maxLines={3} align="center" verticalAlign="center" uppercase weight={900} letterSpacing={-0.01} color={colors.ink} />
        </MotionRecipe>
      </Box>
    </>
  );
};
