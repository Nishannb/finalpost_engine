import React from 'react';

import {Arrow, Badge, FocusRing} from '../components/Indicators';
import type {IconName} from '../components/Media';
import {Box} from '../components/Reveal';
import {contentBox, type SafeArea} from '../layout';
import {measureLine} from '../text';
import {usePlatePalette} from '../components/Plate';
import {useMotionTheme} from '../context';

export type PointerCalloutProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** What to point at, in this region's pixels. */
  target: {x: number; y: number; width: number; height: number};
  label: string;
  icon?: IconName;
};

/**
 * Transparent overlay: ring around the target, arrow from a label to it. The
 * label goes above or below the target (whichever has room inside the safe
 * area) and toward the region's roomier side. Paints no background.
 */
export const PointerCallout: React.FC<PointerCalloutProps> = ({width, height, safeArea, target, label, icon}) => {
  const theme = useMotionTheme();
  const palette = usePlatePalette();
  const box = contentBox(width, height, safeArea, 24);
  const badgeH = Math.max(56, Math.min(88, width * 0.075));
  const badgeW = Math.min(box.width, measureLine(label, badgeH * 0.44, theme.fontBody, 700) + badgeH * (icon ? 1.5 : 0.9));
  const gapY = Math.min(260, height * 0.14);
  const roomAbove = target.y - box.y;
  const above = roomAbove >= gapY + badgeH || roomAbove > box.y + box.height - (target.y + target.height);
  const targetCx = target.x + target.width / 2;
  const leftward = targetCx > width / 2;
  const badgeX = Math.max(box.x, Math.min(box.x + box.width - badgeW, leftward ? targetCx - badgeW - target.width * 0.1 : targetCx + target.width * 0.1));
  const badgeY = above ? Math.max(box.y, target.y - gapY - badgeH) : Math.min(box.y + box.height - badgeH, target.y + target.height + gapY);
  const from = {x: badgeX + badgeW * (leftward ? 0.7 : 0.3), y: above ? badgeY + badgeH + 10 : badgeY - 10};
  const to = {x: leftward ? target.x - 18 : target.x + target.width + 18, y: above ? target.y + target.height * 0.3 : target.y + target.height * 0.7};
  return (
    <>
      <FocusRing {...target} delay={0} duration={16} color={palette.marker} />
      <Arrow from={from} to={to} bend={leftward === above ? 0.25 : -0.25} delay={10} duration={14} color={palette.marker} outline pulse />
      <Box x={badgeX} y={badgeY} width={badgeW} height={badgeH}>
        <Badge text={label} icon={icon} height={badgeH} maxWidth={box.width} delay={6} color={palette.ground} textColor={palette.ink} bordered />
      </Box>
    </>
  );
};
