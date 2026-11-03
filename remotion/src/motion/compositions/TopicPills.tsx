import React from 'react';

import {Badge} from '../components/Indicators';
import {usePlatePalette} from '../components/Plate';
import {Box} from '../components/Reveal';
import type {IconName} from '../components/Media';
import {contentBox, type SafeArea} from '../layout';

export type TopicPill = {label: string; icon?: IconName};

export type TopicPillsProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** At most 8 pills are shown. */
  items: TopicPill[];
  /** Where the floating column sits. Default 'left'. */
  side?: 'left' | 'right';
};

export const PILLS_MAX = 8;

/** Floating topic chips ("Accountant", "Supply chain", ...) that pop in one after another, staggered sideways so they read as floating. Overlay: no background. */
export const TopicPills: React.FC<TopicPillsProps> = ({width, height, safeArea, items, side = 'left'}) => {
  const palette = usePlatePalette();
  const shown = items.filter(item => item.label.trim()).slice(0, PILLS_MAX);
  const box = contentBox(width, height, safeArea, Math.min(width, height) * 0.05);
  const count = Math.max(1, shown.length);
  const gap = box.height * 0.03;
  const pillHeight = Math.min(104, (box.height - gap * (count - 1)) / count);
  const maxWidth = box.width * 0.78;
  return (
    <>
      {shown.map((item, index) => {
        const drift = (index % 2) * box.width * 0.1;
        const x = side === 'left' ? box.x + drift : box.x + box.width - maxWidth - drift;
        return (
          <Box key={index} x={x} y={box.y + index * (pillHeight + gap)} width={maxWidth} height={pillHeight} style={{display: 'flex', justifyContent: side === 'left' ? 'flex-start' : 'flex-end'}}>
            <Badge text={item.label} icon={item.icon} height={pillHeight} maxWidth={maxWidth} delay={index * 7} color={palette.paper} textColor={palette.paperInk} borderColor={palette.marker} iconScale={0.62} iconColor={palette.paperInk} weight={800} bordered />
          </Box>
        );
      })}
    </>
  );
};
