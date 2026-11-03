import React from 'react';

import {MaskReveal} from '../components/MaskedText';
import {PlateGround, usePlatePalette} from '../components/Plate';
import {Box, Reveal} from '../components/Reveal';
import {Shape} from '../components/Shapes';
import {FitText, KineticText} from '../components/Text';
import {contentBox, sliceTop, type SafeArea} from '../layout';
import {MotionRecipe} from '../recipes/MotionRecipe';
import type {MotionRecipeId} from '../recipes/motionRecipes';

export type StampTitleProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** The big section stamp ("02 —"). Optional: without it the title takes the whole box. */
  stamp?: string;
  /** The section title (spoken words). */
  title: string;
  /** One short quiet line under the title (spoken words). */
  subtitle?: string;
  /** WP14A: the entrance recipe of the title (default stretch_squash_pop). */
  recipeId?: MotionRecipeId;
  /** Opaque full-bleed background. Default true; set false to float it over the footage. */
  background?: boolean;
};

/** Section stamp (WP10A: plate palette + a masked wipe on the title): a large marker ordinal, a rule, then the title landing word by word and an optional quiet line ("02 — MARKET" chrome). */
export const StampTitle: React.FC<StampTitleProps> = ({width, height, safeArea, stamp, title, subtitle, recipeId = 'stretch_squash_pop', background = true}) => {
  const palette = usePlatePalette();
  const box = contentBox(width, height, safeArea, Math.min(width, height) * 0.08);
  const [stampBox, afterStamp] = stamp ? sliceTop(box, 0.3) : [null, box];
  const [ruleBox, afterRule] = stamp ? sliceTop(afterStamp, 0.06) : [null, afterStamp];
  const [titleBox, subBox] = subtitle ? sliceTop(afterRule, 0.74) : [afterRule, null];
  return (
    <>
      {background ? <PlateGround /> : null}
      {stampBox && stamp ? (
        <Box {...stampBox}>
          <Reveal effect="pop" spring="bouncy">
            <FitText text={stamp} width={stampBox.width} height={stampBox.height} maxLines={1} align="left" verticalAlign="center" color={palette.markerText} weight={900} />
          </Reveal>
        </Box>
      ) : null}
      {ruleBox ? (
        <Box {...ruleBox}>
          <Reveal delay={6}>
            <Shape kind="rect" width={ruleBox.width * 0.4} height={Math.max(6, ruleBox.height * 0.5)} fill={palette.marker} />
          </Reveal>
        </Box>
      ) : null}
      <Box {...titleBox}>
        <MotionRecipe recipeId={recipeId} exit>
        <MaskReveal kind="wipe-right" width={titleBox.width} height={titleBox.height} delay={8} duration={14}>
          <KineticText text={title} width={titleBox.width} height={titleBox.height} maxLines={4} align="left" verticalAlign="top" weight={900} letterSpacing={-0.01} uppercase color={palette.ink} delay={10} each={3} />
        </MaskReveal>
        </MotionRecipe>
      </Box>
      {subBox && subtitle ? (
        <Box {...subBox}>
          <Reveal delay={Math.min(50, 16 + title.split(/\s+/).length * 3)}>
            <FitText text={subtitle} width={subBox.width} height={subBox.height * 0.7} maxLines={2} align="left" font="body" weight={600} color={palette.mutedInk} />
          </Reveal>
        </Box>
      ) : null}
    </>
  );
};
