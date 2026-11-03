/**
 * WP35: impact FX + framed-card fly-out proof (NOT part of the production bundle). Everything is the PRODUCTION component fed by the REAL planners (wp35-preview.mjs writes wp35-plan.json from
 * voCutGrammar.ts + polishAccumulateCaptions.ts + polishImpactFx.ts):
 *   - WP35Impact       the WP33/34 faceless montage (real Pexels stills, hard cuts on every caption group, accumulate captions, white chapter card) + `ImpactPunch` (money punch-in) + `ImpactFxTrack`
 *                      (overexpose flash, saturation glow pop, black-and-white spans) drawn UNDER the captions. 1080x1920 @30 fps, muted.
 *   - WP35Cards        the production `ImageRun` editorial run: `borderPx` white card border + `exit="fly_out"` (3D tilt + slide + motion blur over 6 frames onto the next still), photo-as-world backdrop
 *   - WP35CardsPlain   the same run WITHOUT the border / exit (the pre-WP35 hard cut), for the before / after strip
 * Nothing else: no transition overlay, no sticker, no pill.
 */
import React from 'react';
import {AbsoluteFill, Composition, Img, Sequence, interpolate, registerRoot, staticFile, useCurrentFrame} from 'remotion';

import type {CaptionDirection, CaptionWord} from '../../src/blueprintSchema';
import {AccumulateCaptions} from '../../src/components/AccumulateCaptions';
import {ImpactFxTrack, ImpactPunch} from '../../src/components/ImpactFxTrack';
import {CARD_BORDER_PX} from '../../src/lib/cardFlyOut';
import type {ImpactFx} from '../../src/lib/impactFx';
import {FlashCard} from '../../src/motion/compositions/FlashCard';
import {ImageRun} from '../../src/motion/compositions/ImageRun';
import {H, SAFE, Themed, W} from '../wp23/shared';
import plan from '../../out/phase36-readiness/wp35-plan.json';

const FPS = 30;
const frameOf = (sec: number) => Math.round(sec * FPS);
const photo = (name: string) => staticFile(`wp30-fixtures/${name}.jpg`);

type Shot = {start: number; end: number; kind: 'group' | 'hold' | 'card' | 'split'; still: string};
const shots = plan.shots as Shot[];
const cards = plan.chapterCards as Array<{at: number; duration: number; text: string}>;
const words = plan.words as CaptionWord[];
const direction = plan.direction as CaptionDirection;
const fx = plan.fx as ImpactFx;

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

const Captions: React.FC = () => {
  const frame = useCurrentFrame();
  return inCard(frame) ? null : <AccumulateCaptions words={words} language="en" direction={direction} />;
};

const Impact: React.FC<{fx?: ImpactFx}> = ({fx: effects}) => (
  <AbsoluteFill style={{backgroundColor: '#000'}}>
    <ImpactPunch fx={effects}>
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
    </ImpactPunch>
    <ImpactFxTrack fx={effects} />
    <Captions />
  </AbsoluteFill>
);

const RUN = ['a2-counting-cash', 'a3-newspaper', 'a1-startup-office', 'b1-laptop-desk'];
export const CARD_HOLD = 40;
const CARD_FRAMES = RUN.length * CARD_HOLD;

const Cards: React.FC<{plain?: boolean}> = ({plain}) => (
  <AbsoluteFill style={{backgroundColor: '#000'}}>
    <Themed>
      <ImageRun
        width={W}
        height={H}
        safeArea={SAFE}
        mode="sequence"
        fit="cover"
        backdrop="blur_self"
        holdFrames={CARD_HOLD}
        {...(plain ? {} : {borderPx: CARD_BORDER_PX, exit: 'fly_out' as const})}
        items={RUN.map((name, index) => ({src: photo(name), label: name, recipeId: (['still_push_in', 'card_tilt_in', 'orbit_drift', 'still_push_in'] as const)[index]}))}
      />
    </Themed>
  </AbsoluteFill>
);

const Root: React.FC = () => (
  <>
    <Composition id="WP35Impact" component={() => <Impact fx={fx} />} width={W} height={H} fps={FPS} durationInFrames={frameOf(plan.durationSec)} />
    <Composition id="WP35ImpactOff" component={() => <Impact />} width={W} height={H} fps={FPS} durationInFrames={frameOf(plan.durationSec)} />
    <Composition id="WP35Cards" component={() => <Cards />} width={W} height={H} fps={FPS} durationInFrames={CARD_FRAMES} />
    <Composition id="WP35CardsPlain" component={() => <Cards plain />} width={W} height={H} fps={FPS} durationInFrames={CARD_FRAMES} />
  </>
);
registerRoot(Root);
