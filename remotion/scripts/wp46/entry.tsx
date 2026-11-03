/**
 * WP46 Layer-2 proof (NOT part of the production bundle). Cycles the four NEW motion-template comps (ConfigBrandLoop, BlurWordCarousel, IosNotificationMock, NestedRectTitleWipe) back to back, each at its natural length
 * (7.63 / 3.67 / 2.02 / 6.15 s), each fed the props the REAL server library registry resolved from `{motionTemplateId}` (`wp46-plan.json`, written by wp46-preview.mjs) plus fixture stills for the photo slots. The overlay
 * template (IosNotificationMock) is drawn over stand-in footage because it owns no frame. Silent. 1080x1920 @30. No captions.
 */
import React from 'react';
import {AbsoluteFill, Composition, Sequence, continueRender, delayRender, registerRoot, staticFile} from 'remotion';
import {loadFont as loadPlayfair} from '@remotion/google-fonts/PlayfairDisplay';
import {loadFont as loadPoppins} from '@remotion/google-fonts/Poppins';

import {loadMotionFonts} from '../../src/motion/fonts';
import {BlurWordCarousel} from '../../src/motion/compositions/templates/BlurWordCarousel';
import {ConfigBrandLoop} from '../../src/motion/compositions/templates/ConfigBrandLoop';
import {IosNotificationMock} from '../../src/motion/compositions/templates/IosNotificationMock';
import {NestedRectTitleWipe} from '../../src/motion/compositions/templates/NestedRectTitleWipe';
import {Footage, Themed, H, SAFE, W} from '../wp23/shared';
import plan from '../../out/phase36-readiness/wp46-plan.json';

// Poppins (carousel) + Playfair Display (title) are the grammar's faces; the Inter / Space Grotesk stacks come from the toolkit's bundled fonts. Never fatal: a failed load falls back per glyph.
loadPoppins('normal', {weights: ['700'], subsets: ['latin']});
loadPlayfair('normal', {weights: ['700'], subsets: ['latin']});
const fontsHandle = delayRender('wp46 motion fonts');
loadMotionFonts().then(
  () => continueRender(fontsHandle),
  () => continueRender(fontsHandle),
);

const FPS = 30;
const f = (sec: number) => Math.round(sec * FPS);
const still = (name: string) => staticFile(`wp30-fixtures/${name}.jpg`);

type Demo = {templateId: string; compositionId: string; props: Record<string, unknown>; durationSec: number};
const demos = plan.demos as unknown as Demo[];

const PHOTOS = ['a1-startup-office', 'a4-city-crowd', 'b3-subway', 'c1-press', 'a2-counting-cash'];

const render = (demo: Demo): React.ReactNode => {
  const common = {width: W, height: H, safeArea: SAFE};
  switch (demo.compositionId) {
    case 'ConfigBrandLoop':
      return <ConfigBrandLoop {...common} {...(demo.props as object)} scenes={PHOTOS.map(name => ({src: still(name)}))} />;
    case 'BlurWordCarousel':
      return <BlurWordCarousel {...common} {...(demo.props as object)} />;
    case 'IosNotificationMock':
      return (
        <>
          <Footage moving />
          <IosNotificationMock {...common} {...(demo.props as object)} />
        </>
      );
    default:
      return <NestedRectTitleWipe {...common} {...(demo.props as object)} imageSrc={still(PHOTOS[3]!)} />;
  }
};

const Proof: React.FC = () => {
  let at = 0;
  return (
    <AbsoluteFill style={{backgroundColor: '#000'}}>
      {demos.map(demo => {
        const from = at;
        at += f(demo.durationSec);
        return (
          <Sequence key={demo.templateId} from={from} durationInFrames={f(demo.durationSec)}>
            <Themed>{render(demo)}</Themed>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

const total = demos.reduce((sum, demo) => sum + f(demo.durationSec), 0);
const Root: React.FC = () => <Composition id="WP46MotionTemplates" component={Proof} width={W} height={H} fps={FPS} durationInFrames={total} />;
registerRoot(Root);
