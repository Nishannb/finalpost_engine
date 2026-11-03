import React from 'react';

import {Box, Reveal} from '../components/Reveal';
import {usePlatePalette} from '../components/Plate';
import {Card} from '../components/Shapes';
import {FitText} from '../components/Text';
import {contentBox, type SafeArea} from '../layout';
import {withAlpha} from '../theme';

export type BrandLockupBarProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** The wordmark, as text. No logo image is fetched. */
  name: string;
  tagline?: string;
};

/** Small text-only brand lockup sitting at the bottom of the safe area: a quiet bar with the name and an optional tagline. Overlay: no background. */
export const BrandLockupBar: React.FC<BrandLockupBarProps> = ({width, height, safeArea, name, tagline}) => {
  const palette = usePlatePalette();
  const box = contentBox(width, height, safeArea, Math.min(width, height) * 0.05);
  const barHeight = Math.min(box.height * 0.5, Math.max(72, box.height * 0.12));
  const barWidth = Math.min(box.width, box.width * 0.8);
  const y = box.y + box.height - barHeight;
  return (
    <Box x={box.x + (box.width - barWidth) / 2} y={y} width={barWidth} height={barHeight}>
      <Reveal effect={['fade', 'slide-up']} delay={4}>
        <Card width={barWidth} height={barHeight} variant="glass" color={withAlpha(palette.ground, 0.78)} borderColor={palette.marker} shadow padding={barHeight * 0.18}>
          <FitText text={tagline ? `${name} · ${tagline}` : name} width={barWidth - barHeight * 0.36} height={barHeight * 0.64} maxLines={1} weight={800} color={palette.ink} uppercase letterSpacing={2} />
        </Card>
      </Reveal>
    </Box>
  );
};
