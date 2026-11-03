/**
 * WP32: photo-as-world backdrop + chest-band bare type proof (NOT part of the production bundle). Renders the PRODUCTION `ImageRun` (backdrop prop) and the PRODUCTION caption path
 * (`DynamicCaptionRenderer` -> `KineticCaptions`) with caption directions produced by the real server helper (`wp32-directions.json`, written by wp32-preview.mjs from `polishBareCaption`):
 *   - `new` (WP32): ImageRun `backdrop="blur_self"` (each still's own blurred bleed is the world, the sharp framed still floats on it) + bare karaoke at chest-band weight (fontScale 1.4, 2 words a line)
 *   - `old` (WP30/31): ImageRun `backdrop="dim"` (a framed card on a dim veil over the talking head) + bare karaoke at template size (fontScale 1, 3 words a line); kept ONLY for the before / after strip
 * ~9.6 s, 1080x1920 @30 fps, real Pexels stills from public/wp30-fixtures:
 *   0.0-5.4   editorial ImageRun (3 stills x 1.8 s: still_push_in / card_tilt_in / orbit_drift) + karaoke "This founder raised a billion dollars"
 *   5.4-9.6   busy full-bleed footage stand-in (city crowd photo) + karaoke "Then the numbers went wrong"  (bare type on busy footage)
 */
import React from 'react';
import {AbsoluteFill, Composition, Img, Sequence, interpolate, registerRoot, staticFile, useCurrentFrame} from 'remotion';

import {DynamicCaptionRenderer} from '../../src/captions/DynamicCaptionRenderer';
import type {CaptionDirection, RenderStyle} from '../../src/blueprintSchema';
import {ImageRun, type ImageRunBackdrop} from '../../src/motion/compositions/ImageRun';
import {H, SAFE, Themed, W, Footage} from '../wp23/shared';
import directions from '../../out/phase36-readiness/wp32-directions.json';

const FPS = 30;
const f = (sec: number) => Math.round(sec * FPS);
const HOLD = 1.8;
const photo = (name: string) => staticFile(`wp30-fixtures/${name}.jpg`);

const STYLE: RenderStyle = {captionTemplate: 'karaoke', layoutStyle: 'fullscreen', captionBottomFrac: 0.28, captionCenterXFrac: 0.5, brollEnabled: true, zoomEnabled: true, trimEnabled: true, colorGradeLut: ''} as RenderStyle;
type Variant = 'new' | 'old';
const BACKDROP: Record<Variant, ImageRunBackdrop> = {new: 'blur_self', old: 'dim'};
const directionFor = (variant: Variant): CaptionDirection => ({...(directions[variant] as CaptionDirection), position: 'bottom', bottomFrac: 0.28});

/** Evenly timed words (segment-relative seconds). */
const words = (text: string, start = 0.25, each = 0.7) => text.split(' ').map((word, index) => ({text: word, start: start + index * each, end: start + (index + 1) * each - 0.02, sentenceIndex: 0}));
const RUN_WORDS = words('This founder raised a billion dollars', 0.2, 0.8);
const BUSY_WORDS = words('Then the numbers went wrong', 0.25, 0.75);

const RUN = [
  {name: 'a2-counting-cash', recipeId: 'still_push_in'},
  {name: 'a3-newspaper', recipeId: 'card_tilt_in'},
  {name: 'a1-startup-office', recipeId: 'orbit_drift'},
] as const;

const Karaoke: React.FC<{variant: Variant; data: ReturnType<typeof words>}> = ({variant, data}) => (
  <DynamicCaptionRenderer transcriptData={data} selectedTemplate={directionFor(variant).template} style={STYLE} direction={directionFor(variant)} language="en" railClear={false} />
);

const BusyFootage: React.FC = () => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, f(4.2)], [1.06, 1.16], {extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill style={{overflow: 'hidden', backgroundColor: '#111'}}>
      <Img src={photo('a4-city-crowd')} style={{width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${scale})`}} />
    </AbsoluteFill>
  );
};

const Proof: React.FC<{variant: Variant}> = ({variant}) => (
  <AbsoluteFill style={{backgroundColor: '#000'}}>
    <Sequence from={0} durationInFrames={f(5.4)}>
      {/* the talking head the old ImageRun veil sat over; the new backdrop covers it completely */}
      <Footage moving />
      <Themed>
        <ImageRun width={W} height={H} safeArea={SAFE} mode="sequence" fit="cover" backdrop={BACKDROP[variant]} holdFrames={f(HOLD)} items={RUN.map(item => ({src: photo(item.name), label: item.name, recipeId: item.recipeId}))} />
      </Themed>
      <Karaoke variant={variant} data={RUN_WORDS} />
    </Sequence>
    <Sequence from={f(5.4)} durationInFrames={f(4.2)}>
      <BusyFootage />
      <Karaoke variant={variant} data={BUSY_WORDS} />
    </Sequence>
  </AbsoluteFill>
);

const NewWorld: React.FC = () => <Proof variant="new" />;
const OldWorld: React.FC = () => <Proof variant="old" />;

const Root: React.FC = () => (
  <>
    <Composition id="WP32New" component={NewWorld} width={W} height={H} fps={FPS} durationInFrames={f(9.6)} />
    <Composition id="WP32Old" component={OldWorld} width={W} height={H} fps={FPS} durationInFrames={f(9.6)} />
  </>
);
registerRoot(Root);
