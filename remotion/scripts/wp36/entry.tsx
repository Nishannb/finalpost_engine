/**
 * WP36: faceless documentary lane proof (NOT part of the production bundle). The WHOLE picture is the production components fed by the REAL planners (wp36-preview.mjs writes wp36-plan.json from
 * voCutGrammar.ts + polishAccumulateCaptions.ts + polishImpactFx.ts + facelessDocLane.ts):
 *   - the lane's runs        the production `ImageRun` (sequence, cover, blur_self, per-still `holdsSec` + `framedItems`): full-bleed push-in stills, ~15 % framed cards with the white border + fly-out
 *   - the chapter card       the production `FlashCard` (white ground) on its own span
 *   - ImpactPunch / ImpactFxTrack   the WP35 money punch-in over the media, the flash / sat pop / B&W flip over everything
 *   - AccumulateCaptions     the WP34 accumulate type, hidden over the chapter card
 * No footage layer: the talking head is not part of this composition (0 % talking-head frames). 1080x1920 @ 30 fps, muted.
 */
import React from 'react';
import {AbsoluteFill, Composition, Sequence, registerRoot, staticFile, useCurrentFrame} from 'remotion';

import type {CaptionDirection, CaptionWord} from '../../src/blueprintSchema';
import {AccumulateCaptions} from '../../src/components/AccumulateCaptions';
import {ImpactFxTrack, ImpactPunch} from '../../src/components/ImpactFxTrack';
import {CARD_BORDER_PX} from '../../src/lib/cardFlyOut';
import type {MotionSpeed} from '../../src/lib/imageRunTiming';
import type {ImpactFx} from '../../src/lib/impactFx';
import {FlashCard} from '../../src/motion/compositions/FlashCard';
import {ImageRun} from '../../src/motion/compositions/ImageRun';
import type {MotionRecipeId} from '../../src/motion/recipes/motionRecipes';
import {H, SAFE, Themed, W} from '../wp23/shared';
import plan from '../../out/phase36-readiness/wp36-plan.json';

const FPS = 30;
const frameOf = (sec: number) => Math.round(sec * FPS);

type LaneRun = {start: number; end: number; items: Array<{src: string; label?: string; recipeId?: string; motionSpeed?: MotionSpeed}>; holdsSec: number[]; framedItems: boolean[]};
const runs = plan.lane.runs as LaneRun[];
const files = plan.files as Record<string, string>;
const cards = plan.chapterCards as Array<{at: number; duration: number; text: string}>;
const words = plan.words as CaptionWord[];
const direction = plan.direction as CaptionDirection;
const fx = plan.fx as ImpactFx;

const inCard = (frame: number) => cards.some(card => frame >= frameOf(card.at) && frame < frameOf(card.at + card.duration));

const Captions: React.FC = () => {
  const frame = useCurrentFrame();
  return inCard(frame) ? null : <AccumulateCaptions words={words} language="en" direction={direction} />;
};

const Faceless: React.FC = () => (
  <AbsoluteFill style={{backgroundColor: '#000'}}>
    <ImpactPunch fx={fx}>
      {runs.map((run, index) => (
        <Sequence key={`run-${index}`} from={frameOf(run.start)} durationInFrames={Math.max(1, frameOf(run.end) - frameOf(run.start))}>
          <Themed>
            <ImageRun
              width={W}
              height={H}
              safeArea={SAFE}
              mode="sequence"
              fit="cover"
              backdrop="blur_self"
              borderPx={CARD_BORDER_PX}
              exit="fly_out"
              holdsSec={run.holdsSec}
              framedItems={run.framedItems}
              items={run.items.map(item => ({src: staticFile(`wp36-fixtures/${files[item.src]}`), label: item.label, recipeId: item.recipeId as MotionRecipeId | undefined, motionSpeed: item.motionSpeed}))}
            />
          </Themed>
        </Sequence>
      ))}
      {cards.map((card, index) => (
        <Sequence key={`card-${index}`} from={frameOf(card.at)} durationInFrames={Math.max(1, frameOf(card.at + card.duration) - frameOf(card.at))}>
          <Themed>
            <FlashCard width={W} height={H} safeArea={SAFE} phrase={card.text} ground="white" />
          </Themed>
        </Sequence>
      ))}
    </ImpactPunch>
    <ImpactFxTrack fx={fx} />
    <Captions />
  </AbsoluteFill>
);

const Root: React.FC = () => <Composition id="WP36Faceless" component={Faceless} width={W} height={H} fps={FPS} durationInFrames={frameOf(plan.durationSec)} />;
registerRoot(Root);
