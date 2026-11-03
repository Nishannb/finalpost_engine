/**
 * WP47 Layer-2 proof (NOT part of the production bundle). Cycles the four NEW motion-template comps (AcmeFruitLetterSwap, MorphFontStretch, MenuSlidePoster, EditorialInsetPoster) back to back, each at its natural length
 * (3.83 / 2.30 / 6.80 / 5.30 s), each fed the props the REAL server library registry resolved from `{motionTemplateId}` (`wp47-plan.json`, written by wp47-preview.mjs) plus a fixture still for the editorial photo slot.
 * All four are opaque full-bleed templates (they own the frame, captions muted), so nothing is drawn under them. Silent. 1080x1920 @30. No captions.
 */
import React from 'react';
import {AbsoluteFill, Composition, Sequence, continueRender, delayRender, registerRoot, staticFile} from 'remotion';
import {loadFont as loadCormorant} from '@remotion/google-fonts/CormorantGaramond';
import {loadFont as loadFredoka} from '@remotion/google-fonts/Fredoka';
import {loadFont as loadMarcellus} from '@remotion/google-fonts/Marcellus';

import {loadMotionFonts} from '../../src/motion/fonts';
import {AcmeFruitLetterSwap} from '../../src/motion/compositions/templates/AcmeFruitLetterSwap';
import {EditorialInsetPoster} from '../../src/motion/compositions/templates/EditorialInsetPoster';
import {MenuSlidePoster} from '../../src/motion/compositions/templates/MenuSlidePoster';
import {MorphFontStretch} from '../../src/motion/compositions/templates/MorphFontStretch';
import {Themed, H, SAFE, W} from '../wp23/shared';
import plan from '../../out/phase36-readiness/wp47-plan.json';

// Marcellus (flared serif wordmark), Fredoka (bubbly display) and Cormorant Garamond italic hairline (headlines) are the grammar's faces; Inter / Space Grotesk come from the toolkit's bundled fonts.
// Never fatal: a failed load falls back per glyph (Optima / Palatino, Arial Rounded, Playfair / Georgia).
loadMarcellus('normal', {weights: ['400'], subsets: ['latin']});
loadFredoka('normal', {weights: ['700'], subsets: ['latin']});
loadCormorant('italic', {weights: ['300'], subsets: ['latin']});
const fontsHandle = delayRender('wp47 motion fonts');
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
    case 'AcmeFruitLetterSwap':
      return <AcmeFruitLetterSwap {...common} {...(demo.props as object)} />;
    case 'MorphFontStretch':
      return <MorphFontStretch {...common} {...(demo.props as object)} />;
    case 'MenuSlidePoster':
      return <MenuSlidePoster {...common} {...(demo.props as object)} />;
    default:
      return <EditorialInsetPoster {...common} {...(demo.props as object)} imageSrc={still('a4-city-crowd')} />;
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
const Root: React.FC = () => <Composition id="WP47MotionTemplates" component={Proof} width={W} height={H} fps={FPS} durationInFrames={total} />;
registerRoot(Root);
