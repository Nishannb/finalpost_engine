/**
 * WP38: classic TALKING-HEAD polish with the Skill A tools (NOT part of the production bundle). The picture is the production components fed by the REAL planners (wp38-preview.mjs writes wp38-plan.json from
 * voCutGrammar.ts + polishAccumulateCaptions.ts + talkingHeadSkillA.ts + polishImpactFx.ts + editorialStillMontage.ts with the TALKING-HEAD caps):
 *   - the face             the speaker stand-in (no footage in the repo) is the PRIMARY picture the whole runtime; it is hidden only by a still run / a chapter card
 *   - editorial still runs the production `ImageRun` (framed cards, blur_self, fly-out) in the few gaps the tighter WP38 caps leave (<= 25 % of the runtime)
 *   - the chapter card     the production `FlashCard` (white ground) on its own span
 *   - ImpactPunch / ImpactFxTrack   the WP35 money punch-in, flash / sat pop / B&W flip, over the face AND the stills
 *   - AccumulateCaptions   the WP34 accumulate type at the WP38 FACE-SAFE y (`faceSafeYFrac` 0.58); `faceSafe=false` renders the pre-WP38 y 46 % for the before / after
 * NOT faceless (the face is on screen most of the time), NOT the explainer (no layouts, no dotted grid, no chunk-swap). Input props: `captions` (bool), `faceSafe` (bool), `fx` (bool). 1080x1920 @ 30 fps, muted.
 */
import React from 'react';
import {AbsoluteFill, Composition, Sequence, getInputProps, registerRoot, staticFile, useCurrentFrame} from 'remotion';

import type {CaptionDirection, CaptionWord} from '../../src/blueprintSchema';
import {AccumulateCaptions} from '../../src/components/AccumulateCaptions';
import {ImpactFxTrack, ImpactPunch} from '../../src/components/ImpactFxTrack';
import {CARD_BORDER_PX} from '../../src/lib/cardFlyOut';
import type {ImpactFx} from '../../src/lib/impactFx';
import {FlashCard} from '../../src/motion/compositions/FlashCard';
import {ImageRun} from '../../src/motion/compositions/ImageRun';
import type {MotionRecipeId} from '../../src/motion/recipes/motionRecipes';
import {Footage, H, SAFE, Themed, W} from '../wp23/shared';
import plan from '../../out/phase36-readiness/wp38-plan.json';

const FPS = 30;
const frameOf = (sec: number) => Math.round(sec * FPS);

type Run = {start: number; end: number; items: Array<{src: string; label?: string; recipeId?: string}>};
const runs = plan.stills.runs as Run[];
const cards = plan.chapterCards as Array<{at: number; duration: number; text: string}>;
const words = plan.words as CaptionWord[];
const fx = plan.fx as ImpactFx;
const faceSafeDirection = plan.direction as CaptionDirection;
const legacyDirection = plan.legacyDirection as CaptionDirection;
const photo = (src: string) => staticFile(`wp30-fixtures/${src.split('/').pop()}`);

const Tag: React.FC<{text: string}> = ({text}) => (
  <div style={{position: 'absolute', left: 24, top: 24, padding: '6px 14px', borderRadius: 6, background: 'rgba(0,0,0,0.55)', color: '#fff', fontFamily: 'monospace', fontSize: 26, zIndex: 80}}>{text}</div>
);

const Captions: React.FC<{faceSafe: boolean}> = ({faceSafe}) => {
  const frame = useCurrentFrame();
  const inCard = cards.some(card => frame >= frameOf(card.at) && frame < frameOf(card.at + card.duration));
  return inCard ? null : <AccumulateCaptions words={words} language="en" direction={faceSafe ? faceSafeDirection : legacyDirection} />;
};

const TalkingHead: React.FC<{captions: boolean; faceSafe: boolean; effects: boolean; tags: boolean}> = ({captions, faceSafe, effects, tags}) => {
  const effect = effects ? fx : undefined;
  return (
    <AbsoluteFill style={{backgroundColor: '#000'}}>
      <ImpactPunch fx={effect}>
        <Footage moving />
        {runs.map((run, index) => {
          const frames = Math.max(1, frameOf(run.end) - frameOf(run.start));
          return (
            <Sequence key={`run-${index}`} from={frameOf(run.start)} durationInFrames={frames}>
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
                  holdFrames={Math.round(frames / run.items.length)}
                  items={run.items.map(item => ({src: photo(item.src), label: item.label, recipeId: item.recipeId as MotionRecipeId | undefined}))}
                />
              </Themed>
              {tags ? <Tag text="STILL RUN" /> : null}
            </Sequence>
          );
        })}
        {cards.map((card, index) => (
          <Sequence key={`card-${index}`} from={frameOf(card.at)} durationInFrames={Math.max(1, frameOf(card.at + card.duration) - frameOf(card.at))}>
            <Themed>
              <FlashCard width={W} height={H} safeArea={SAFE} phrase={card.text} ground="white" />
            </Themed>
          </Sequence>
        ))}
      </ImpactPunch>
      <ImpactFxTrack fx={effect} />
      {captions ? <Captions faceSafe={faceSafe} /> : null}
    </AbsoluteFill>
  );
};

const Root: React.FC = () => {
  const input = getInputProps() as {captions?: boolean; faceSafe?: boolean; fx?: boolean; tags?: boolean};
  const props = {captions: input.captions !== false, faceSafe: input.faceSafe !== false, effects: input.fx !== false, tags: input.tags === true};
  return <Composition id="WP38Th" component={() => <TalkingHead {...props} />} width={W} height={H} fps={FPS} durationInFrames={frameOf(plan.durationSec)} />;
};
registerRoot(Root);
