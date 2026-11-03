/**
 * WP33: VO cut grammar proof (NOT part of the production bundle). A ~20 s FACELESS montage: no talking head, no PiP, every shot is a real Pexels still (public/wp30-fixtures) on a HARD CUT, one new still per 1-3 word
 * caption group, keyed to a hardcoded fixture word timeline. The cut plan (`wp33-plan.json`) is written by wp33-preview.mjs from the REAL server planner (`voCutGrammar.ts`): shots, caption groups, holds and the chapter
 * card, plus the still chosen for each shot (a literal noun match when the group names one, never the same still twice in a row).
 *   - shot            Img cover + linear push-in 1.0 -> 1.08 over the shot (editref broll.stills_motion)
 *   - hold            same shot, just longer (1.5-2.5 s on the money / CTA words); the captions still change group by group on it
 *   - chapter card    the PRODUCTION FlashCard, white ground (the 15-25 s schedule)
 *   - captions        bare sentence-case type, ~7 % of the frame height, centred at ~46 % of the height, one group at a time and cleared on the next cut (WP34 will accumulate + blur-fade; this is the simple per-group form)
 * Nothing else: no transition overlay, no flash, no sticker, no pill. 1080x1920 @30 fps, muted.
 */
import React from 'react';
import {AbsoluteFill, Composition, Img, Sequence, interpolate, registerRoot, staticFile, useCurrentFrame} from 'remotion';

import {FlashCard} from '../../src/motion/compositions/FlashCard';
import {FitText} from '../../src/motion/components/Text';
import {H, SAFE, Themed, W} from '../wp23/shared';
import plan from '../../out/phase36-readiness/wp33-plan.json';

const FPS = 30;
const frameOf = (sec: number) => Math.round(sec * FPS);
const photo = (name: string) => staticFile(`wp30-fixtures/${name}.jpg`);

type Shot = {start: number; end: number; kind: 'group' | 'hold' | 'card' | 'split'; still: string};
type Group = {start: number; end: number; words: string[]};
const shots = plan.shots as Shot[];
const groups = plan.groups as Group[];
const cards = plan.chapterCards as Array<{at: number; duration: number; text: string}>;

/** One still, pushed in linearly 1.0 -> 1.08 for as long as the shot lasts. */
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

const CAPTION_W = W - 120;
const CAPTION_H = Math.round(H * 0.16);
/** ~7 % of the frame height, understated: sentence case, white, a soft 8 px / 35 % shadow. The group text loses its trailing punctuation. */
const Caption: React.FC<{text: string}> = ({text}) => (
  <Themed>
    <div style={{position: 'absolute', left: 60, top: Math.round(H * 0.46 - CAPTION_H / 2), width: CAPTION_W, height: CAPTION_H, textShadow: '0 2px 8px rgba(0,0,0,0.35)'}}>
      <FitText text={text} width={CAPTION_W} height={CAPTION_H} maxLines={2} maxFontSize={Math.round(H * 0.07)} align="center" verticalAlign="center" weight={800} color="#FFFFFF" />
    </div>
  </Themed>
);

const inCard = (time: number) => cards.some(card => time >= card.at - 1e-6 && time < card.at + card.duration - 1e-6);

const Montage: React.FC = () => (
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
    {groups.map((group, index) => {
      if (inCard(group.start)) return null;
      const next = groups[index + 1];
      const end = Math.min(next ? next.start : plan.durationSec, group.end + 0.25);
      const from = frameOf(group.start);
      const frames = Math.max(1, frameOf(end) - from);
      return (
        <Sequence key={`caption-${index}`} from={from} durationInFrames={frames}>
          <Caption text={group.words.join(' ').replace(/[.,;:!?]+$/, '')} />
        </Sequence>
      );
    })}
  </AbsoluteFill>
);

const Root: React.FC = () => <Composition id="WP33Montage" component={Montage} width={W} height={H} fps={FPS} durationInFrames={frameOf(plan.durationSec)} />;
registerRoot(Root);
