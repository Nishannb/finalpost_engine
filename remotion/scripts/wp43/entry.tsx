/**
 * WP43 Skill C proof (NOT part of the production bundle). Cycles the seven textual MG families with the PRODUCTION `TextualMgPlate`, each fed the props the REAL server library registry resolved
 * (`wp43-plan.json`, written by wp43-preview.mjs from `resolveLibraryGraphic` + `libraryGraphicSource` inputs), over dark stills / a footage stand-in. No captions are drawn (a Skill C plate mutes them).
 * 7 segments x 2.2 s, 1080x1920 @30.
 */
import React from 'react';
import {AbsoluteFill, Composition, Img, Sequence, interpolate, registerRoot, staticFile, useCurrentFrame} from 'remotion';

import {TextualMgPlate, type TextualMgPlateProps} from '../../src/motion/compositions/TextualMgPlate';
import {Footage, H, SAFE, Themed, W} from '../wp23/shared';
import plan from '../../out/phase36-readiness/wp43-plan.json';

const FPS = 30;
export const SEG_SEC = 2.2;
const f = (sec: number) => Math.round(sec * FPS);

type Demo = {family: string; backdrop: string; props: Omit<TextualMgPlateProps, 'width' | 'height' | 'safeArea'>};
const demos = plan.demos as unknown as Demo[];

/** A dark, slightly blurred still with a slow push: busy enough that the plate has to hold its own. */
const DarkStill: React.FC<{name: string}> = ({name}) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, f(SEG_SEC)], [1.08, 1.16], {extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill style={{backgroundColor: '#050505', overflow: 'hidden'}}>
      <Img src={staticFile(`wp30-fixtures/${name}.jpg`)} style={{width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${scale})`, filter: 'brightness(0.42) saturate(0.7)'}} />
    </AbsoluteFill>
  );
};

const Backdrop: React.FC<{name: string}> = ({name}) =>
  name === 'footage' ? (
    <AbsoluteFill>
      <Footage moving />
      <AbsoluteFill style={{backgroundColor: 'rgba(0,0,0,0.38)'}} />
    </AbsoluteFill>
  ) : (
    <DarkStill name={name} />
  );

const Proof: React.FC = () => (
  <AbsoluteFill style={{backgroundColor: '#000'}}>
    {demos.map((demo, index) => (
      <Sequence key={demo.family} from={index * f(SEG_SEC)} durationInFrames={f(SEG_SEC)}>
        <Backdrop name={demo.backdrop} />
        <Sequence from={f(0.12)} durationInFrames={f(SEG_SEC) - f(0.12) - f(0.1)}>
          <Themed>
            <TextualMgPlate width={W} height={H} safeArea={SAFE} {...demo.props} />
          </Themed>
        </Sequence>
      </Sequence>
    ))}
  </AbsoluteFill>
);

const Root: React.FC = () => <Composition id="WP43TextualMg" component={Proof} width={W} height={H} fps={FPS} durationInFrames={f(SEG_SEC) * demos.length} />;
registerRoot(Root);
