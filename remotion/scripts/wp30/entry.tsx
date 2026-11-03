/**
 * WP30: editorial still montage proof (NOT part of the production bundle). ~17 s, 1080x1920 @30 fps, built from the production comps with REAL Pexels stills (public/wp30-fixtures, fetched once):
 * no solid color worlds, no ProcessSteps, no pill karaoke, no talking head. Timeline:
 *   0.0-0.9   FlashCard "Then it all broke" (black)
 *   0.9       whip blur right -> 0.9-8.1  ImageRun (sequence, 4 stills x 1.8 s: still_push_in / card_tilt_in / orbit_drift / still_push_in) over a blurred, desaturated copy of the current photo
 *   8.1       smash zoom      -> 8.1-13.5 ImageRun (3 stills x 1.8 s, the rotation offset by one) over the same kind of backdrop
 *   13.5      whip blur left      -> 13.5-16.0 tilted press-photo card (card_tilt_in) over its own blurred still
 *   16.0      hard cut        -> 16.0-17.0 FlashCard "Then silence" (black)
 * Bare mid-frame type (no chrome, no pill): "BILLION" on the cash still, "COLLAPSED" on the empty-desk still. The recipe rotation below is exactly `editorialRecipeAt(runIndex, itemIndex)` from the server planner.
 */
import React from 'react';
import {AbsoluteFill, Composition, Img, Sequence, interpolate, registerRoot, staticFile, useCurrentFrame} from 'remotion';

import {visualOverlaySchema, type TransitionClip} from '../../src/blueprintSchema';
import {MediaCardView} from '../../src/components/MediaCardTrack';
import {SmashPunch} from '../../src/components/SmashPunch';
import {TransitionTrack} from '../../src/components/TransitionTrack';
import {FlashCard} from '../../src/motion/compositions/FlashCard';
import {ImageRun} from '../../src/motion/compositions/ImageRun';
import {FitText} from '../../src/motion/components/Text';
import {MotionRecipe} from '../../src/motion/recipes/MotionRecipe';
import {H, SAFE, Themed, W} from '../wp23/shared';

const FPS = 30;
const f = (sec: number) => Math.round(sec * FPS);
const HOLD = 1.8;

const photo = (name: string) => staticFile(`wp30-fixtures/${name}.jpg`);
const RECIPES = ['still_push_in', 'card_tilt_in', 'orbit_drift'] as const;
const recipeAt = (runIndex: number, itemIndex: number) => RECIPES[(runIndex + itemIndex) % RECIPES.length]!;

const RUN_A = ['a1-startup-office', 'a2-counting-cash', 'a3-newspaper', 'a4-city-crowd'];
const RUN_B = ['b1-laptop-desk', 'b2-empty-desk', 'b3-subway'];
const CARD = 'c1-press';

const clip = (at: number, keyword: string, duration = 0.45): TransitionClip => ({at, duration, keyword, assetUrl: '', blend: 'screen', provider: 'generated', providerId: 0, width: 1080, height: 1920, credit: '', creditUrl: '', renderGenerated: true});
const CLIPS = [clip(0.9, 'whip blur right', 0.4), clip(8.1, 'smash zoom'), clip(13.5, 'whip blur left', 0.4), clip(16.0, 'hard cut', 0.2)];

/** A blurred, desaturated, darkened copy of the photo on screen: gives the framed still depth instead of a flat black ground. Slowly pushes in so the backdrop is never static. */
const Backdrop: React.FC<{names: string[]; hold: number}> = ({names, hold}) => (
  <AbsoluteFill style={{backgroundColor: '#050505'}}>
    {names.map((name, index) => (
      <Sequence key={name} from={index * hold} durationInFrames={hold} layout="none">
        <BackdropPlate src={photo(name)} duration={hold} />
      </Sequence>
    ))}
  </AbsoluteFill>
);
const BackdropPlate: React.FC<{src: string; duration: number}> = ({src, duration}) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, duration], [1.18, 1.3], {extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill style={{overflow: 'hidden'}}>
      <Img src={src} style={{width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${scale})`, filter: 'blur(22px) saturate(0.5) brightness(0.85)'}} />
    </AbsoluteFill>
  );
};

/** Bare mid-frame type on the footage: heavy grotesque, white, no chip / pill / sheen. */
const BareWord: React.FC<{text: string}> = ({text}) => {
  const w = W - 120;
  const h = 210;
  return (
    <div style={{position: 'absolute', left: 60, top: 1250, width: w, height: h, textShadow: '0 6px 28px rgba(0,0,0,0.65)'}}>
      <MotionRecipe recipeId="elastic_type_snap">
        <FitText text={text} width={w} height={h} maxLines={1} align="center" verticalAlign="center" uppercase weight={900} letterSpacing={-0.01} color="#FFFFFF" />
      </MotionRecipe>
    </div>
  );
};

const CARD_OVERLAY = visualOverlaySchema.parse({
  start: 0, end: 2.5, layout: 'card', mediaKind: 'image', anchor: 'top', keyword: 'press', overlayText: '', assetUrl: `staticFile:wp30-fixtures/${CARD}.jpg`, provider: 'user', providerId: 0,
  width: 1200, height: 627, credit: '', creditUrl: '', recipeId: 'card_tilt_in', visualWeight: 'hero', treatment: 'float', glow: false,
});

const Montage: React.FC = () => (
  <AbsoluteFill style={{backgroundColor: '#000'}}>
    <SmashPunch clips={CLIPS}>
      <Sequence from={0} durationInFrames={f(0.9)}>
        <Themed>
          <FlashCard width={W} height={H} safeArea={SAFE} phrase="Then it all broke" ground="black" />
        </Themed>
      </Sequence>
      <Sequence from={f(0.9)} durationInFrames={f(7.2)}>
        <Backdrop names={RUN_A} hold={f(HOLD)} />
        <Themed>
          <ImageRun width={W} height={H} safeArea={SAFE} mode="sequence" fit="cover" holdFrames={f(HOLD)} items={RUN_A.map((name, index) => ({src: photo(name), label: name, recipeId: recipeAt(0, index)}))} />
        </Themed>
        <Sequence from={f(HOLD) + 6} durationInFrames={f(HOLD) - 10}>
          <Themed>
            <BareWord text="Billion" />
          </Themed>
        </Sequence>
      </Sequence>
      <Sequence from={f(8.1)} durationInFrames={f(5.4)}>
        <Backdrop names={RUN_B} hold={f(HOLD)} />
        <Themed>
          <ImageRun width={W} height={H} safeArea={SAFE} mode="sequence" fit="cover" holdFrames={f(HOLD)} items={RUN_B.map((name, index) => ({src: photo(name), label: name, recipeId: recipeAt(1, index)}))} />
        </Themed>
        <Sequence from={f(HOLD) + 6} durationInFrames={f(HOLD) - 10}>
          <Themed>
            <BareWord text="Collapsed" />
          </Themed>
        </Sequence>
      </Sequence>
      <Sequence from={f(13.5)} durationInFrames={f(2.5)}>
        <Backdrop names={[CARD]} hold={f(2.5)} />
        <AbsoluteFill style={{backgroundColor: 'rgba(0,0,0,0.35)'}} />
        <MediaCardView overlay={CARD_OVERLAY} />
      </Sequence>
      <Sequence from={f(16.0)} durationInFrames={f(1.0)}>
        <Themed>
          <FlashCard width={W} height={H} safeArea={SAFE} phrase="Then silence" ground="black" />
        </Themed>
      </Sequence>
    </SmashPunch>
    <TransitionTrack clips={CLIPS} />
  </AbsoluteFill>
);

const Root: React.FC = () => <Composition id="WP30Montage" component={Montage} width={W} height={H} fps={FPS} durationInFrames={f(17.0)} />;
registerRoot(Root);
