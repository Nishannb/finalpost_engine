import React from 'react';

import {Box, Reveal} from '../components/Reveal';
import {PlateGround, usePlatePalette} from '../components/Plate';
import {FitText, KineticText} from '../components/Text';
import {MotionRecipe} from '../recipes/MotionRecipe';
import type {MotionRecipeId} from '../recipes/motionRecipes';
import {contentBox, sliceTop, type SafeArea} from '../layout';

export type QuoteCalloutProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  quote: string;
  author?: string;
  /** Words/phrases to mark. */
  highlight?: string[];
  /** WP14D: the entrance recipe of the quote block (default split_mask_reveal); the quote mark pops with elastic_type_snap. */
  recipeId?: MotionRecipeId;
  background?: boolean;
};

/** Large quote: words land one by one, highlighted phrase gets a marker sweep. */
export const QuoteCallout: React.FC<QuoteCalloutProps> = ({width, height, safeArea, quote, author, highlight, recipeId = 'split_mask_reveal', background = true}) => {
  const palette = usePlatePalette();
  const box = contentBox(width, height, safeArea, Math.min(width, height) * 0.08);
  const [markBox, rest] = sliceTop(box, Math.min(0.16, 160 / box.height));
  const [quoteBox, authorBox] = author ? sliceTop(rest, 0.82) : [rest, null];
  return (
    <>
      {background ? <PlateGround /> : null}
      <Box {...markBox}>
        <MotionRecipe recipeId="elastic_type_snap">
          <FitText text="“" width={markBox.width} height={markBox.height * 1.6} maxLines={1} align="left" verticalAlign="top" color={palette.markerText} weight={900} />
        </MotionRecipe>
      </Box>
      <Box {...quoteBox}>
        <MotionRecipe recipeId={recipeId}>
        <KineticText text={quote} width={quoteBox.width} height={quoteBox.height} maxLines={6} align="left" weight={800} color={palette.ink} delay={6} each={3} highlight={highlight} highlightStyle="marker" highlightColor={palette.marker} highlightInk={palette.markerInk} highlightOpacity={1} />
        </MotionRecipe>
      </Box>
      {authorBox && author ? (
        <Box {...authorBox}>
          <Reveal delay={Math.min(60, 10 + quote.split(/\s+/).length * 3)}>
            <FitText text={`— ${author}`} width={authorBox.width} height={authorBox.height * 0.6} maxLines={1} align="left" font="body" weight={600} color={palette.mutedInk} />
          </Reveal>
        </Box>
      ) : null}
    </>
  );
};
