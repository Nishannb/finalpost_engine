/**
 * WP48 Layer-2 proof (NOT part of the production bundle). Cycles the four NEW motion-template comps (HeritageDevotionPoster, SilkLegacyCover, GlassTestimonialMorph, PortraitPushCarousel) back to back, each at its natural length
 * (6.90 / 3.05 / 3.93 / 4.35 s), each fed the props the REAL server library registry resolved from `{motionTemplateId}` (`wp48-plan.json`, written by wp48-preview.mjs); stills: fixture photo for the silk cover and the three push cards, stand-in silhouettes elsewhere.
 * All four are opaque full-bleed templates (they own the frame, captions muted), so nothing is drawn under them. Silent. 1080x1920 @30. No captions.
 */
import React from 'react';
import {AbsoluteFill, Composition, Sequence, continueRender, delayRender, registerRoot, staticFile} from 'remotion';

import {loadMotionFonts} from '../../src/motion/fonts';
import {GlassTestimonialMorph} from '../../src/motion/compositions/templates/GlassTestimonialMorph';
import {HeritageDevotionPoster} from '../../src/motion/compositions/templates/HeritageDevotionPoster';
import {PortraitPushCarousel} from '../../src/motion/compositions/templates/PortraitPushCarousel';
import {SilkLegacyCover} from '../../src/motion/compositions/templates/SilkLegacyCover';
import {Themed, H, SAFE, W} from '../wp23/shared';
import plan from '../../out/phase36-readiness/wp48-plan.json';

// Inter / Space Grotesk come from the toolkit's bundled fonts (no network).
const fontsHandle = delayRender('wp48 motion fonts');
loadMotionFonts().then(
  () => continueRender(fontsHandle),
  () => continueRender(fontsHandle),
);

const FPS = 30;
const f = (sec: number) => Math.round(sec * FPS);
const still = (name: string) => staticFile(`wp30-fixtures/${name}.jpg`);

type Demo = {templateId: string; compositionId: string; props: Record<string, unknown>; durationSec: number};
const demos = plan.demos as unknown as Demo[];

const render = (demo: Demo): React.ReactNode => {
  const common = {width: W, height: H, safeArea: SAFE};
  switch (demo.compositionId) {
    case 'HeritageDevotionPoster':
      return <HeritageDevotionPoster {...common} {...(demo.props as object)} />;
    case 'SilkLegacyCover':
      return <SilkLegacyCover {...common} {...(demo.props as object)} imageSrc={still('a4-city-crowd')} />;
    case 'GlassTestimonialMorph':
      return <GlassTestimonialMorph {...common} {...(demo.props as object)} />;
    default:
      return <PortraitPushCarousel {...common} {...(demo.props as object)} imageUrls={[still('a1-startup-office'), still('b3-subway'), still('c1-press')]} />;
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
const Root: React.FC = () => <Composition id="WP48MotionTemplates" component={Proof} width={W} height={H} fps={FPS} durationInFrames={total} />;
registerRoot(Root);
