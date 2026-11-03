/**
 * WP50 Layer-2 proof (NOT part of the production bundle). Cycles the five NEW motion-template comps (PhotoStackCollapse, PhotoStackReveal, TwoUpStackHold, NeverDoneSlitPoster, TypewriterPoster) back to back, each at its natural length
 * (1.37 / 2.42 / 2.00 / 2.38 / 5.03 s), each fed the props the REAL server library registry resolved from `{motionTemplateId}` (`wp50-plan.json`, written by wp50-preview.mjs). Fixture stills for the stacks and the slit photo; demo copy is proof-shell only.
 * All five are opaque full-bleed templates (they own the frame, captions muted). Silent. 1080x1920 @30. No captions.
 */
import React from 'react';
import {AbsoluteFill, Composition, Sequence, continueRender, delayRender, registerRoot, staticFile} from 'remotion';

import {loadMotionFonts} from '../../src/motion/fonts';
import {NeverDoneSlitPoster} from '../../src/motion/compositions/templates/NeverDoneSlitPoster';
import {PhotoStackCollapse} from '../../src/motion/compositions/templates/PhotoStackCollapse';
import {PhotoStackReveal} from '../../src/motion/compositions/templates/PhotoStackReveal';
import {TwoUpStackHold} from '../../src/motion/compositions/templates/TwoUpStackHold';
import {TypewriterPoster} from '../../src/motion/compositions/templates/TypewriterPoster';
import {Themed, H, SAFE, W} from '../wp23/shared';
import plan from '../../out/phase36-readiness/wp50-plan.json';

// Inter / Space Grotesk come from the toolkit's bundled fonts (no network).
const fontsHandle = delayRender('wp50 motion fonts');
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
  const props = demo.props as object;
  switch (demo.compositionId) {
    case 'PhotoStackCollapse':
      return <PhotoStackCollapse {...common} {...props} imageUrls={[still('a1-startup-office'), still('b3-subway')]} />;
    case 'PhotoStackReveal':
      return <PhotoStackReveal {...common} {...props} imageUrls={[still('a4-city-crowd'), still('b3-subway'), still('c1-press')]} />;
    case 'TwoUpStackHold':
      return <TwoUpStackHold {...common} {...props} imageUrls={[still('a1-startup-office'), still('c1-press')]} />;
    case 'NeverDoneSlitPoster':
      return <NeverDoneSlitPoster {...common} {...props} imageSrc={still('a4-city-crowd')} />;
    default:
      return <TypewriterPoster {...common} {...props} lines={['Livestream', 'July 15, 2026', '◔ 8-10am']} footerLeft="✧ Mango" />;
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
const Root: React.FC = () => <Composition id="WP50MotionTemplates" component={Proof} width={W} height={H} fps={FPS} durationInFrames={total} />;
registerRoot(Root);
