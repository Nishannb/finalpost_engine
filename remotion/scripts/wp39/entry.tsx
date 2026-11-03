/**
 * WP39: still-motion speed proof (NOT part of the production bundle). One PRODUCTION `ImageRun` (sequence, cover, full-bleed stills, per-still `holdsSec`) at a chosen `motionSpeed`; wp39-preview.mjs renders
 * the first / middle / last frame of a short hold per speed and tiles them against the WP36 push (= `fast`). No audio, no footage, no SFX. 1080x1920 @ 30 fps.
 */
import React from 'react';
import {Composition, registerRoot, staticFile} from 'remotion';

import type {MotionSpeed} from '../../src/lib/imageRunTiming';
import {ImageRun} from '../../src/motion/compositions/ImageRun';
import {H, SAFE, Themed, W} from '../wp23/shared';

export const HOLD_FRAMES = 24; // 0.8 s: a typical faceless hold (mean shot ~0.85 s)

type Props = {motionSpeed: MotionSpeed; files: string[]};

const Motion: React.FC<Props> = ({motionSpeed, files}) => (
  <Themed>
    <ImageRun
      width={W}
      height={H}
      safeArea={SAFE}
      mode="sequence"
      fit="cover"
      backdrop="blur_self"
      holdsSec={files.map(() => HOLD_FRAMES / 30)}
      framedItems={files.map(() => false)}
      items={files.map(file => ({src: staticFile(`wp36-fixtures/${file}`), motionSpeed}))}
    />
  </Themed>
);

const Root: React.FC = () => (
  <Composition id="WP39Motion" component={Motion} width={W} height={H} fps={30} durationInFrames={HOLD_FRAMES * 2} defaultProps={{motionSpeed: 'slow', files: [] as string[]} satisfies Props} />
);
registerRoot(Root);
