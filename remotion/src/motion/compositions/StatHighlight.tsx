import React from 'react';

import {Box, Reveal} from '../components/Reveal';
import {Counter, LineChart, type NumberFormat} from '../components/Data';
import {Icon, type IconName} from '../components/Media';
import {PlateGround, usePlatePalette} from '../components/Plate';
import {FitText} from '../components/Text';
import {MotionRecipe} from '../recipes/MotionRecipe';
import type {MotionRecipeId} from '../recipes/motionRecipes';
import {contentBox, sliceTop, type SafeArea} from '../layout';

export type StatHighlightProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  value: NumberFormat & {from?: number; to: number};
  label: string;
  sublabel?: string;
  /** Optional trend under the number (draws after the count). */
  trend?: number[];
  icon?: IconName;
  /** WP14B: the entrance recipe of the number (default counter_snap: a pop on the count). */
  recipeId?: MotionRecipeId;
  /** Opaque background (full-screen / split). Set false for overlays. */
  background?: boolean;
};

/** Big animated number + label, optional trend line. Adapts to tall or wide regions. */
export const StatHighlight: React.FC<StatHighlightProps> = ({width, height, safeArea, value, label, sublabel, trend, icon, recipeId = 'counter_snap', background = true}) => {
  const palette = usePlatePalette();
  const box = contentBox(width, height, safeArea, Math.min(width, height) * 0.06);
  const [top, rest] = sliceTop(box, trend ? 0.55 : 1);
  const iconSize = icon ? Math.min(top.height * 0.16, 110) : 0;
  const [numberBox, labelArea] = sliceTop({...top, y: top.y + iconSize, height: top.height - iconSize}, 0.58);
  const [labelBox, subBox] = sliceTop(labelArea, sublabel ? 0.55 : 1);
  return (
    <>
      {background ? <PlateGround /> : null}
      {icon ? (
        <Box x={top.x} y={top.y} width={top.width} height={iconSize} style={{display: 'flex', justifyContent: 'center'}}>
          <Reveal effect="pop" spring="bouncy">
            <Icon name={icon} size={iconSize} color={palette.markerText} />
          </Reveal>
        </Box>
      ) : null}
      <Box {...numberBox}>
        <MotionRecipe recipeId={recipeId}>
          <Counter {...value} width={numberBox.width} height={numberBox.height} color={palette.ink} />
        </MotionRecipe>
      </Box>
      <Box {...labelBox}>
        <Reveal delay={18}>
          <FitText text={label} width={labelBox.width} height={labelBox.height} maxLines={2} color={palette.markerText} font="body" weight={800} />
        </Reveal>
      </Box>
      {sublabel ? (
        <Box {...subBox}>
          <Reveal delay={26}>
            <FitText text={sublabel} width={subBox.width} height={subBox.height} maxLines={2} color={palette.mutedInk} font="body" weight={500} />
          </Reveal>
        </Box>
      ) : null}
      {trend ? (
        <Box {...rest}>
          <LineChart data={trend} width={rest.width} height={rest.height} delay={20} duration={36} />
        </Box>
      ) : null}
    </>
  );
};
