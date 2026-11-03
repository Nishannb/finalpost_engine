/**
 * WP23: local stills entry (NOT part of the production bundle). Registers stand-alone compositions that draw the Metromedia-open comps with fixture props:
 * FlashCard, ImageRun (logo_cloud + sequence), the procedural TransitionTrack over a stand-in "footage" gradient, and a MediaCardView with card_tilt_in.
 * Logos / screenshot are inline SVG data URLs (no network, no repo assets needed).
 */
import React from 'react';
import {AbsoluteFill, Composition, registerRoot} from 'remotion';

import {visualOverlaySchema, type TransitionClip} from '../../src/blueprintSchema';
import {MediaCardView} from '../../src/components/MediaCardTrack';
import {SmashPunch} from '../../src/components/SmashPunch';
import {TransitionTrack} from '../../src/components/TransitionTrack';
import {FlashCard} from '../../src/motion/compositions/FlashCard';
import {ImageRun} from '../../src/motion/compositions/ImageRun';

import {Footage, H, LOGOS, SAFE, SHOT, Themed, W} from './shared';

const Flash: React.FC = () => (
  <Themed>
    <FlashCard width={W} height={H} safeArea={SAFE} phrase="Then everything broke" ground="black" />
  </Themed>
);
const Cloud: React.FC = () => (
  <Themed>
    <Footage />
    <ImageRun width={W} height={H} safeArea={SAFE} mode="logo_cloud" items={LOGOS.map((src, i) => ({src, label: `logo ${i}`}))} />
  </Themed>
);
const Sequence3: React.FC = () => (
  <Themed>
    <Footage />
    <ImageRun width={W} height={H} safeArea={SAFE} mode="sequence" items={[{src: LOGOS[0]!}, {src: SHOT, recipeId: 'card_tilt_in'}, {src: LOGOS[2]!}]} />
  </Themed>
);

const clip = (at: number, keyword: string): TransitionClip => ({at, duration: 0.5, keyword, assetUrl: '', blend: 'screen', provider: 'generated', providerId: 0, width: 1080, height: 1920, credit: '', creditUrl: '', renderGenerated: true});
const CLIPS = [clip(0.5, 'whip blur right'), clip(2.0, 'smash zoom'), clip(3.5, 'dip color'), clip(5.0, 'flash white')];
const Transitions: React.FC = () => (
  <>
    <SmashPunch clips={CLIPS}>
      <Footage />
    </SmashPunch>
    <TransitionTrack clips={CLIPS} />
  </>
);

const OVERLAY = visualOverlaySchema.parse({
  start: 0, end: 3, layout: 'card', mediaKind: 'image', anchor: 'top', keyword: 'dashboard', overlayText: '', assetUrl: SHOT, provider: 'user', providerId: 0,
  width: 600, height: 600, credit: '', creditUrl: '', recipeId: 'card_tilt_in', visualWeight: 'hero', treatment: 'float', glow: false,
});
const Tilt: React.FC = () => (
  <>
    <Footage />
    <MediaCardView overlay={OVERLAY} />
  </>
);

const Root: React.FC = () => (
  <>
    <Composition id="WP23Flash" component={Flash} width={W} height={H} fps={30} durationInFrames={30} />
    <Composition id="WP23Cloud" component={Cloud} width={W} height={H} fps={30} durationInFrames={150} />
    <Composition id="WP23Sequence" component={Sequence3} width={W} height={H} fps={30} durationInFrames={90} />
    <Composition id="WP23Transitions" component={Transitions} width={W} height={H} fps={30} durationInFrames={180} />
    <Composition id="WP23Tilt" component={Tilt} width={W} height={H} fps={30} durationInFrames={90} />
  </>
);
registerRoot(Root);
