import React from 'react';

import {Box, Reveal} from '../components/Reveal';
import {PlateGround, usePlatePalette} from '../components/Plate';
import {FitText, KineticText} from '../components/Text';
import {contentBox, sliceTop, type SafeArea} from '../layout';
import {MotionRecipe} from '../recipes/MotionRecipe';
import type {MotionRecipeId} from '../recipes/motionRecipes';

export type FullscreenStatementProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** The one statement (a cutaway beat without stock video). */
  statement: string;
  sublabel?: string;
  /** Words or phrases to emphasise. */
  highlight?: string[];
  /** WP14A: the entrance recipe of the statement (default smear_blur_in). */
  recipeId?: MotionRecipeId;
  /** Opaque full-bleed background. Default true; set false to float it over the footage. */
  background?: boolean;
};

/** Full-bleed statement: dark spotlight background, big centred kinetic type, optional quiet sublabel. */
export const FullscreenStatement: React.FC<FullscreenStatementProps> = ({width, height, safeArea, statement, sublabel, highlight, recipeId = 'smear_blur_in', background = true}) => {
  const palette = usePlatePalette();
  const box = contentBox(width, height, safeArea, Math.min(width, height) * 0.08);
  const [main, subBox] = sublabel ? sliceTop(box, 0.82) : [box, null];
  return (
    <>
      {background ? <PlateGround /> : null}
      <Box {...main}>
        <MotionRecipe recipeId={recipeId} exit>
        <KineticText text={statement} width={main.width} height={main.height} maxLines={5} align="center" verticalAlign="center" weight={900} letterSpacing={-0.01} delay={4} each={3} highlight={highlight} color={palette.ink} highlightColor={palette.marker} highlightInk={palette.markerInk} highlightOpacity={1} highlightStyle="marker" />
        </MotionRecipe>
      </Box>
      {subBox && sublabel ? (
        <Box {...subBox}>
          <Reveal delay={Math.min(50, 12 + statement.split(/\s+/).length * 3)}>
            <FitText text={sublabel} width={subBox.width} height={subBox.height * 0.7} maxLines={2} align="center" font="body" weight={600} color={palette.mutedInk} />
          </Reveal>
        </Box>
      ) : null}
    </>
  );
};
