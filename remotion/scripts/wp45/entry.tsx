/**
 * WP45 Layer-2 proof (NOT part of the production bundle). Cycles the four motion-template comps (GridMosaicMorph, SlitPanelCarousel, BentoCardWall, StackedCardDeck) back to back, each at its natural length
 * (4.9 / 6.97 / 5.87 / 2.32 s), each fed the props the REAL server library registry resolved from `{motionTemplateId}` (`wp45-plan.json`, written by wp45-preview.mjs) plus fixture stills for the photo slots.
 * Silent. 1080x1920 @30. No captions (a template mutes them).
 */
import React from 'react';
import {AbsoluteFill, Composition, Sequence, registerRoot, staticFile} from 'remotion';

import {BentoCardWall} from '../../src/motion/compositions/templates/BentoCardWall';
import {GridMosaicMorph} from '../../src/motion/compositions/templates/GridMosaicMorph';
import {SlitPanelCarousel} from '../../src/motion/compositions/templates/SlitPanelCarousel';
import {StackedCardDeck} from '../../src/motion/compositions/templates/StackedCardDeck';
import {Themed, H, SAFE, W} from '../wp23/shared';
import plan from '../../out/phase36-readiness/wp45-plan.json';

const FPS = 30;
const f = (sec: number) => Math.round(sec * FPS);
const still = (name: string) => staticFile(`wp30-fixtures/${name}.jpg`);

type Demo = {templateId: string; compositionId: string; props: Record<string, unknown>; durationSec: number};
const demos = plan.demos as unknown as Demo[];

const PHOTOS = ['a1-startup-office', 'a4-city-crowd', 'b3-subway', 'c1-press', 'a2-counting-cash'];

const render = (demo: Demo): React.ReactNode => {
  const common = {width: W, height: H, safeArea: SAFE};
  switch (demo.compositionId) {
    case 'GridMosaicMorph':
      return <GridMosaicMorph {...common} {...(demo.props as object)} imageSrc={still(PHOTOS[0]!)} />;
    case 'SlitPanelCarousel':
      return <SlitPanelCarousel {...common} {...(demo.props as object)} panels={PHOTOS.map((name, i) => (i === 3 ? {} : {src: still(name)}))} />;
    case 'BentoCardWall':
      return (
        <BentoCardWall
          {...common}
          {...(demo.props as object)}
          cards={['ui', 'photo', 'ui', 'ui', 'photo', 'ui', 'photo', 'ui', 'ui', 'photo', 'ui', 'ui'].map((kind, i) => ({kind: kind as 'ui' | 'photo', ...(kind === 'photo' ? {src: still(PHOTOS[i % PHOTOS.length]!)} : {})}))}
        />
      );
    default:
      return <StackedCardDeck {...common} {...(demo.props as object)} cards={PHOTOS.slice(0, 4).map(name => ({src: still(name)}))} />;
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
const Root: React.FC = () => <Composition id="WP45MotionTemplates" component={Proof} width={W} height={H} fps={FPS} durationInFrames={total} />;
registerRoot(Root);
