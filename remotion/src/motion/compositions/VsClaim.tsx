import React from 'react';

import {Badge} from '../components/Indicators';
import {Box, Reveal} from '../components/Reveal';
import {PlateGround, usePlatePalette} from '../components/Plate';
import {Card} from '../components/Shapes';
import {FitText} from '../components/Text';
import {MotionRecipe} from '../recipes/MotionRecipe';
import type {MotionRecipeId} from '../recipes/motionRecipes';
import {contentBox, isWide, splitColumn, splitRow, type SafeArea} from '../layout';

export type VsClaimProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** The weaker claim ("NO CLUE"). */
  left: string;
  /** The stronger claim ("EXPERT"). */
  right: string;
  /** Small label between the sides. Default "VS". */
  center?: string;
  /** WP14D: the entrance recipe of each side (default smear_blur_in: a horizontal smear that lands, not a fade + slide card). */
  recipeId?: MotionRecipeId;
  background?: boolean;
};

/** Two-sided claim card: the left side lands muted, the right side lands in the accent colour; side by side in a wide region, stacked in a tall one. */
export const VsClaim: React.FC<VsClaimProps> = ({width, height, safeArea, left, right, center = 'VS', recipeId = 'smear_blur_in', background = true}) => {
  const palette = usePlatePalette();
  const box = contentBox(width, height, safeArea, Math.min(width, height) * 0.06);
  const gap = Math.min(width, height) * 0.05;
  const sides = isWide(width, height) ? splitRow(box, 2, gap) : splitColumn(box, 2, gap);
  const badgeHeight = Math.min(84, Math.min(box.width, box.height) * 0.12);
  return (
    <>
      {background ? <PlateGround /> : null}
      {[{text: left, color: palette.paperInk, delay: 0, fill: palette.paper}, {text: right, color: palette.markerInk, delay: 14, fill: palette.marker}].map((side, index) => {
        const rect = sides[index]!;
        return (
          <Box key={index} {...rect}>
            <MotionRecipe recipeId={recipeId} delay={side.delay}>
              <Card width={rect.width} height={rect.height} variant={index === 0 ? 'solid' : 'soft'} color={side.fill} shadow padding={rect.width * 0.06}>
                <FitText text={side.text} width={rect.width * 0.88} height={rect.height * 0.8} maxLines={3} weight={900} letterSpacing={-0.01} uppercase color={side.color} />
              </Card>
            </MotionRecipe>
          </Box>
        );
      })}
      <Box x={box.x + box.width / 2 - badgeHeight * 1.2} y={box.y + box.height / 2 - badgeHeight / 2} width={badgeHeight * 2.4} height={badgeHeight} style={{display: 'flex', justifyContent: 'center'}}>
        <Badge text={center} height={badgeHeight} maxWidth={badgeHeight * 2.4} delay={8} color={palette.ink} textColor={palette.ground} />
      </Box>
    </>
  );
};
