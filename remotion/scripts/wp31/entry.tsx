/**
 * WP31: bare video type proof (NOT part of the production bundle). Renders the PRODUCTION caption path (`DynamicCaptionRenderer` -> `KineticCaptions`) with two caption directions produced by the
 * server (`wp31-directions.json`, written by wp31-preview.mjs from the real `polishBareCaption`):
 *   - `polish`: what a polish edit now ships (bare stroked karaoke, no plate)
 *   - `legacy`: what WP28 shipped (karaoke + `highlight` = the glossy pill with neon bloom + sheen), kept ONLY for the before / after contact strip
 * ~13 s, 1080x1920 @30 fps:
 *   0.0-3.6   editorial still run (2 real Pexels stills) over a blurred backdrop + bare mid-frame word "BILLION"       (same energy as WP30)
 *   3.6-8.4   talking-head stand-in (gradient + silhouette) with bare karaoke "Then the numbers went wrong"
 *   8.4-13.0  busy full-bleed footage stand-in (a city crowd photo) with bare karaoke "Nobody saw the collapse coming"  (readability on busy footage)
 */
import React from 'react';
import {AbsoluteFill, Composition, Img, Sequence, interpolate, registerRoot, staticFile, useCurrentFrame} from 'remotion';

import {DynamicCaptionRenderer} from '../../src/captions/DynamicCaptionRenderer';
import type {CaptionDirection, RenderStyle} from '../../src/blueprintSchema';
import {ImageRun} from '../../src/motion/compositions/ImageRun';
import {FitText} from '../../src/motion/components/Text';
import {MotionRecipe} from '../../src/motion/recipes/MotionRecipe';
import {H, SAFE, Themed, W, Footage} from '../wp23/shared';
import directions from '../../out/phase36-readiness/wp31-directions.json';

const FPS = 30;
const f = (sec: number) => Math.round(sec * FPS);
const photo = (name: string) => staticFile(`wp30-fixtures/${name}.jpg`);

const STYLE: RenderStyle = {captionTemplate: 'karaoke', layoutStyle: 'fullscreen', captionBottomFrac: 0.28, captionCenterXFrac: 0.5, brollEnabled: true, zoomEnabled: true, trimEnabled: true, colorGradeLut: ''} as RenderStyle;
type Variant = 'polish' | 'legacy';
const directionFor = (variant: Variant): CaptionDirection => ({...(directions[variant] as CaptionDirection), position: 'bottom', bottomFrac: 0.28});

/** Evenly timed words (segment-relative seconds). */
const words = (text: string, start = 0.25, each = 0.5) => text.split(' ').map((word, index) => ({text: word, start: start + index * each, end: start + (index + 1) * each - 0.02, sentenceIndex: index}));
const B_WORDS = words('Then the numbers went wrong');
const C_WORDS = words('Nobody saw the collapse coming');

const Karaoke: React.FC<{variant: Variant; data: ReturnType<typeof words>}> = ({variant, data}) => (
  <DynamicCaptionRenderer transcriptData={data} selectedTemplate={directionFor(variant).template} style={STYLE} direction={directionFor(variant)} language="en" railClear={false} />
);

const Backdrop: React.FC<{name: string}> = ({name}) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, f(3.6)], [1.18, 1.3], {extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill style={{backgroundColor: '#050505', overflow: 'hidden'}}>
      <Img src={photo(name)} style={{width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${scale})`, filter: 'blur(22px) saturate(0.5) brightness(0.85)'}} />
    </AbsoluteFill>
  );
};

/** Bare mid-frame type on the footage: heavy grotesque, white, no chip / pill / sheen (identical to the WP30 proof). */
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

const BusyFootage: React.FC = () => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, f(4.6)], [1.06, 1.16], {extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill style={{overflow: 'hidden', backgroundColor: '#111'}}>
      <Img src={photo('a4-city-crowd')} style={{width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${scale})`}} />
    </AbsoluteFill>
  );
};

const Proof: React.FC<{variant: Variant}> = ({variant}) => (
  <AbsoluteFill style={{backgroundColor: '#000'}}>
    <Sequence from={0} durationInFrames={f(3.6)}>
      <Backdrop name="a2-counting-cash" />
      <Themed>
        <ImageRun width={W} height={H} safeArea={SAFE} mode="sequence" fit="cover" holdFrames={f(1.8)} items={[{src: photo('a2-counting-cash'), label: 'cash', recipeId: 'still_push_in'}, {src: photo('a3-newspaper'), label: 'paper', recipeId: 'card_tilt_in'}]} />
      </Themed>
      <Sequence from={6} durationInFrames={f(1.8) - 10}>
        <Themed>
          <BareWord text="Billion" />
        </Themed>
      </Sequence>
    </Sequence>
    <Sequence from={f(3.6)} durationInFrames={f(4.8)}>
      <Footage moving />
      <Karaoke variant={variant} data={B_WORDS} />
    </Sequence>
    <Sequence from={f(8.4)} durationInFrames={f(4.6)}>
      <BusyFootage />
      <Karaoke variant={variant} data={C_WORDS} />
    </Sequence>
  </AbsoluteFill>
);

const Polish: React.FC = () => <Proof variant="polish" />;
const Legacy: React.FC = () => <Proof variant="legacy" />;

const Root: React.FC = () => (
  <>
    <Composition id="WP31Polish" component={Polish} width={W} height={H} fps={FPS} durationInFrames={f(13.0)} />
    <Composition id="WP31Legacy" component={Legacy} width={W} height={H} fps={FPS} durationInFrames={f(13.0)} />
  </>
);
registerRoot(Root);
