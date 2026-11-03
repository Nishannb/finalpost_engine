import React from 'react';

import {CurvedText} from '../components/CurvedText';
import {MaskReveal} from '../components/MaskedText';
import {PlateGround, usePlatePalette} from '../components/Plate';
import {Box, Reveal} from '../components/Reveal';
import {Shape} from '../components/Shapes';
import {FitText, KineticText} from '../components/Text';
import {contentBox, sliceTop, type SafeArea} from '../layout';
import {MotionRecipe} from '../recipes/MotionRecipe';
import type {MotionRecipeId} from '../recipes/motionRecipes';

export type OpenPlateProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** The big title (spoken words). */
  title: string;
  /** A short spoken run drawn along an arc above the title. */
  kicker?: string;
  /** Optional ordinal chrome ("01 —"). */
  stamp?: string;
  /** A word or phrase of the title lit with the highlighter bar. */
  accent?: string;
  /** WP11A: draw the kicker on an arc (default true). The seed sets false for a kicker with no editorial weight ("today and I"); it is then drawn as straight type. */
  curve?: boolean;
  /** WP14A: the entrance recipe of the title block (default elastic_type_snap: scale overshoot + blur clear, not a fade). */
  recipeId?: MotionRecipeId;
  /** Opaque theme ground. Default true; set false to float it over the footage. */
  background?: boolean;
};

/**
 * Thumbnail / open plate: theme ground, an ordinal, an ARC headline (CurvedText) over a large masked title (MaskReveal wipe) with a highlighter on one word. All colours come from the plate
 * palette (theme in, colours out).
 */
export const OpenPlate: React.FC<OpenPlateProps> = ({width, height, safeArea, title, kicker, stamp, accent, curve = true, recipeId = 'elastic_type_snap', background = true}) => {
  const palette = usePlatePalette();
  const box = contentBox(width, height, safeArea, Math.min(width, height) * 0.07);
  const [stampBox, afterStamp] = stamp ? sliceTop(box, 0.1) : [null, box];
  const [arcBox, afterArc] = kicker ? sliceTop(afterStamp, 0.24) : [null, afterStamp];
  const [titleBox, ruleBox] = sliceTop(afterArc, 0.9);
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
      {arcBox && kicker ? (
        <Box {...arcBox}>
          {curve ? <CurvedText text={kicker} width={arcBox.width} height={arcBox.height} shape="arc" curvature={0.4} align="center" uppercase weight={800} letterSpacing={0.1} color={palette.markerText} reveal="sweep" delay={2} duration={18} fontSize={72} /> : (
            <Reveal delay={2}>
              <FitText text={kicker} width={arcBox.width} height={arcBox.height * 0.6} maxLines={1} align="center" verticalAlign="center" uppercase weight={800} letterSpacing={0.1} color={palette.markerText} />
            </Reveal>
          )}
        </Box>
      ) : null}
      <Box {...titleBox}>
        <MotionRecipe recipeId={recipeId} exit>
        <MaskReveal kind="wipe-up" width={titleBox.width} height={titleBox.height} delay={4} duration={14}>
          <KineticText text={title} width={titleBox.width} height={titleBox.height} maxLines={4} align="left" verticalAlign="center" weight={900} letterSpacing={-0.01} uppercase color={palette.ink} delay={6} each={3} highlight={accent ? [accent] : undefined} highlightStyle="marker" highlightColor={palette.marker} highlightInk={palette.markerInk} highlightOpacity={1} />
        </MaskReveal>
        </MotionRecipe>
      </Box>
      <Box {...ruleBox}>
        <Reveal delay={12}>
          <Shape kind="rect" width={ruleBox.width * 0.32} height={Math.max(6, ruleBox.height * 0.5)} fill={palette.marker} />
        </Reveal>
      </Box>
    </>
  );
};
