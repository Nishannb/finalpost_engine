/**
 * TEXT MATCH CUT proof entry (NOT part of the production bundle). Props come from matchcut-plan.json, produced by the REAL server code (planCraftTemplateBeats -> bindMotionTemplateContent -> resolveLibraryGraphic)
 * from SIMULATED transcripts: no Claude, no Director model, no network, no live pipeline run.
 *   MatchCutProof   one beat per grammar (memo / editorial / newsprint) + a keyword-swap beat, back to back with a short black gap (the beat owns the frame, so nothing else is on screen).
 *   MatchCutSingle  one beat at any size (calculateMetadata from props): stills of every cut.
 */
import React from 'react';
import {AbsoluteFill, Composition, Sequence, continueRender, delayRender, registerRoot} from 'remotion';

import {TypeTextMatchCut} from '../../src/motion/compositions/templates/TextMatchCut';
import {loadMotionFonts} from '../../src/motion/fonts';
import plan from '../../out/phase36-readiness/matchcut-plan.json';

const fontsHandle = delayRender('matchcut motion fonts');
loadMotionFonts().then(
  () => continueRender(fontsHandle),
  () => continueRender(fontsHandle),
);

const FPS = 30;
const W = 720;
const H = 1280;
const GAP = Math.round(0.4 * FPS);
type Scene = {props: Record<string, any>; beatSec: number};
const scenes = plan.scenes as Scene[];
const frames = (s: Scene) => Math.round(s.beatSec * FPS);

const Proof: React.FC = () => {
  let from = 0;
  return (
    <AbsoluteFill style={{backgroundColor: '#050505'}}>
      {scenes.map((s, i) => {
        const at = from;
        from += frames(s) + GAP;
        return (
          <Sequence key={i} from={at} durationInFrames={frames(s)}>
            <TypeTextMatchCut width={W} height={H} durationInFrames={frames(s)} {...(s.props as any)} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

const Single: React.FC<{props: Record<string, any>; width: number; height: number; beatSec: number}> = ({props, width, height, beatSec}) => (
  <AbsoluteFill>
    <TypeTextMatchCut width={width} height={height} durationInFrames={Math.round(beatSec * FPS)} {...(props as any)} />
  </AbsoluteFill>
);

const total = scenes.reduce((sum, s) => sum + frames(s) + GAP, 0) - GAP;

const Root: React.FC = () => (
  <>
    <Composition id="MatchCutProof" component={Proof} width={W} height={H} fps={FPS} durationInFrames={total} />
    <Composition
      id="MatchCutSingle"
      component={Single as React.FC<any>}
      width={W}
      height={H}
      fps={FPS}
      durationInFrames={Math.round(2 * FPS)}
      defaultProps={{props: {}, width: W, height: H, beatSec: 2}}
      calculateMetadata={({props}) => ({width: (props as any).width, height: (props as any).height, durationInFrames: Math.round((props as any).beatSec * FPS)})}
    />
  </>
);

registerRoot(Root);
