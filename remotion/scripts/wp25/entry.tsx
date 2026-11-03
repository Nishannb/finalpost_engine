/**
 * WP25: one continuous ~8.5 s Metromedia-style open (NOT part of the production bundle), built from the production comps with the WP23 fixtures. Timeline @30 fps:
 *   0.0-0.8  FlashCard "THEN EVERYTHING BROKE" (black)
 *   0.8      whip blur right  -> 0.8-4.0 ImageRun logo_cloud over breathing footage (hero re-pops at +2.2 s)
 *   4.0      smash zoom       -> 4.0-6.0 screenshot MediaCard, card_tilt_in
 *   6.0      dip color        -> 6.0-7.5 full-bleed still with still_push_in (filler-like)
 *   7.5      hard cut         -> 7.5-8.5 footage
 * WP26: the footage layer is wrapped in the production SmashPunch, so the smash-zoom frame shows the enlarged picture. Transitions are the production TransitionTrack with procedural keywords; nothing is fetched.
 */
import React from 'react';
import {AbsoluteFill, Composition, Img, Sequence, registerRoot} from 'remotion';

import {visualOverlaySchema, type TransitionClip} from '../../src/blueprintSchema';
import {MediaCardView} from '../../src/components/MediaCardTrack';
import {SmashPunch} from '../../src/components/SmashPunch';
import {TransitionTrack} from '../../src/components/TransitionTrack';
import {FlashCard} from '../../src/motion/compositions/FlashCard';
import {ImageRun} from '../../src/motion/compositions/ImageRun';
import {MotionRecipe} from '../../src/motion/recipes/MotionRecipe';
import {Footage, H, LOGOS, SAFE, SHOT, Themed, W} from '../wp23/shared';

const FPS = 30;
const f = (sec: number) => Math.round(sec * FPS);

const clip = (at: number, keyword: string, duration = 0.45): TransitionClip => ({at, duration, keyword, assetUrl: '', blend: 'screen', provider: 'generated', providerId: 0, width: 1080, height: 1920, credit: '', creditUrl: '', renderGenerated: true});
const CLIPS = [clip(0.8, 'whip blur right', 0.4), clip(4.0, 'smash zoom'), clip(6.0, 'dip color', 0.4), clip(7.5, 'hard cut', 0.2)];

const OVERLAY = visualOverlaySchema.parse({
  start: 0, end: 2, layout: 'card', mediaKind: 'image', anchor: 'top', keyword: 'dashboard', overlayText: '', assetUrl: SHOT, provider: 'user', providerId: 0,
  width: 600, height: 600, credit: '', creditUrl: '', recipeId: 'card_tilt_in', visualWeight: 'hero', treatment: 'float', glow: false,
});

const Open: React.FC = () => (
  <AbsoluteFill style={{backgroundColor: '#000'}}>
    <SmashPunch clips={CLIPS}>
      <Footage moving />
    </SmashPunch>
    <Sequence from={0} durationInFrames={f(0.8)}>
      <Themed>
        <FlashCard width={W} height={H} safeArea={SAFE} phrase="Then everything broke" ground="black" />
      </Themed>
    </Sequence>
    <Sequence from={f(0.8)} durationInFrames={f(3.2)}>
      <Themed>
        <ImageRun width={W} height={H} safeArea={SAFE} mode="logo_cloud" items={LOGOS.map((src, i) => ({src, label: `logo ${i}`}))} />
      </Themed>
    </Sequence>
    <Sequence from={f(4.0)} durationInFrames={f(2.0)}>
      <MediaCardView overlay={OVERLAY} />
    </Sequence>
    <Sequence from={f(6.0)} durationInFrames={f(1.5)}>
      <AbsoluteFill>
        <MotionRecipe recipeId="still_push_in" style={{width: '100%', height: '100%'}}>
          <Img src={SHOT} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
        </MotionRecipe>
      </AbsoluteFill>
    </Sequence>
    <TransitionTrack clips={CLIPS} />
  </AbsoluteFill>
);

const Root: React.FC = () => <Composition id="WP25Open" component={Open} width={W} height={H} fps={FPS} durationInFrames={f(8.5)} />;
registerRoot(Root);
