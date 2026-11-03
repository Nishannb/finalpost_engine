/**
 * WP34: accumulate-caption proof (NOT part of the production bundle). The WP33 faceless montage (real Pexels stills, HARD CUTS on every caption group, push-in 1.0 -> 1.08, white chapter card) with the
 * captions drawn by the PRODUCTION `AccumulateCaptions` component: words build up in spoken order with a 4-frame blur-fade and the line hard-clears on the next cut.
 * `wp34-plan.json` is written by wp34-preview.mjs from the REAL planners (voCutGrammar.ts + polishAccumulateCaptions.ts): shots (+ the still per shot), words, chapter cards and the caption direction.
 *   - WP34Accumulate   the grammar (this WP)
 *   - WP34Replace      the same stills and cuts with the OLD replace captions (WP32 bare karaoke, 2 words, 1.4 x) for the old-vs-new strip
 * Nothing else: no transition overlay, no flash, no sticker, no pill. 1080x1920 @30 fps, muted.
 */
import React from 'react';
import {AbsoluteFill, Composition, Img, Sequence, interpolate, registerRoot, staticFile, useCurrentFrame} from 'remotion';

import type {CaptionDirection, CaptionWord, RenderStyle} from '../../src/blueprintSchema';
import {AccumulateCaptions} from '../../src/components/AccumulateCaptions';
import {KineticCaptions} from '../../src/components/KineticCaptions';
import {FlashCard} from '../../src/motion/compositions/FlashCard';
import {H, SAFE, Themed, W} from '../wp23/shared';
import plan from '../../out/phase36-readiness/wp34-plan.json';

const FPS = 30;
const frameOf = (sec: number) => Math.round(sec * FPS);
const photo = (name: string) => staticFile(`wp30-fixtures/${name}.jpg`);

type Shot = {start: number; end: number; kind: 'group' | 'hold' | 'card' | 'split'; still: string};
const shots = plan.shots as Shot[];
const cards = plan.chapterCards as Array<{at: number; duration: number; text: string}>;
const words = plan.words as CaptionWord[];
const direction = plan.direction as CaptionDirection;

const REPLACE_DIRECTION: CaptionDirection = {
  position: 'center',
  bottomFrac: 0.48,
  textColor: '#FFFFFF',
  highlightColor: '#FFFFFF',
  boxColor: null,
  template: 'karaoke',
  animation: 'scale',
  fontScale: 1.4,
  maxWords: 2,
  strokeColor: '#111111',
  strokeWidthEm: 0.08,
  glow: false,
  activeStyle: 'fill',
};
const STYLE: RenderStyle = {captionTemplate: 'karaoke', layoutStyle: 'fullscreen', captionBottomFrac: 0.48, captionCenterXFrac: 0.5, brollEnabled: true, zoomEnabled: true, trimEnabled: true, colorGradeLut: ''};

const Still: React.FC<{name: string; frames: number}> = ({name, frames}) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, Math.max(1, frames)], [1, 1.08], {extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill style={{overflow: 'hidden', backgroundColor: '#111'}}>
      <Img src={photo(name)} style={{width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${scale})`}} />
      <AbsoluteFill style={{background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.28) 50%, rgba(0,0,0,0.5) 100%)'}} />
    </AbsoluteFill>
  );
};

const inCard = (frame: number) => cards.some(card => frame >= frameOf(card.at) && frame < frameOf(card.at + card.duration));

/** No caption over a chapter card (the card owns its own phrase), exactly as the WP33 proof. */
const Captions: React.FC<{replace?: boolean}> = ({replace}) => {
  const frame = useCurrentFrame();
  if (inCard(frame)) return null;
  return replace ? (
    <KineticCaptions words={words} style={STYLE} language="en" direction={REPLACE_DIRECTION} />
  ) : (
    <AccumulateCaptions words={words} language="en" direction={direction} />
  );
};

const Montage: React.FC<{replace?: boolean}> = ({replace}) => (
  <AbsoluteFill style={{backgroundColor: '#000'}}>
    {shots.map((shot, index) => {
      const from = frameOf(shot.start);
      const frames = Math.max(1, frameOf(shot.end) - from);
      const card = shot.kind === 'card' ? cards.find(item => Math.abs(item.at - shot.start) < 0.02) : undefined;
      return (
        <Sequence key={`shot-${index}`} from={from} durationInFrames={frames}>
          {card ? (
            <Themed>
              <FlashCard width={W} height={H} safeArea={SAFE} phrase={card.text} ground="white" />
            </Themed>
          ) : (
            <Still name={shot.still} frames={frames} />
          )}
        </Sequence>
      );
    })}
    <Captions replace={replace} />
  </AbsoluteFill>
);

const Root: React.FC = () => (
  <>
    <Composition id="WP34Accumulate" component={Montage} width={W} height={H} fps={FPS} durationInFrames={frameOf(plan.durationSec)} />
    <Composition id="WP34Replace" component={() => <Montage replace />} width={W} height={H} fps={FPS} durationInFrames={frameOf(plan.durationSec)} />
  </>
);
registerRoot(Root);
