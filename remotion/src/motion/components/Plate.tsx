import React from 'react';
import {AbsoluteFill, useVideoConfig} from 'remotion';

import {useMotionTheme} from '../context';
import {platePalette, type PlatePalette} from '../palette';
import {withAlpha} from '../theme';

/** The plate palette of the graphic being rendered (derived from its theme). */
export function usePlatePalette(): PlatePalette {
  return platePalette(useMotionTheme());
}

/** Opaque plate ground: a theme gradient (ground -> ground pulled toward primary) with a soft marker-coloured glow. Never use on overlays. */
export const PlateGround: React.FC = () => {
  const palette = usePlatePalette();
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(ellipse 90% 50% at 50% 28%, ${withAlpha(palette.marker, 0.16)} 0%, ${withAlpha(palette.marker, 0)} 70%), linear-gradient(180deg, ${palette.ground} 0%, ${palette.groundDeep} 100%)`,
      }}
    />
  );
};

/** The frame rate of the graphic being rendered (for speech-synced timings in seconds). */
export function usePlateFps(): number {
  return useVideoConfig().fps;
}
