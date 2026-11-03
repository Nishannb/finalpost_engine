/**
 * RVM cutout proof entry (NOT part of the production bundle; rendered only by scripts/rvm-proof.mjs).
 *
 *   RvmCutoutProof              720x1280 @ 25 fps, 48 frames = six consecutive 8-frame sections. The SAME transparent asset (the Phase 3 RVM WebM, 48 frames) plays in every section,
 *                               one asset frame per output frame: section k shows asset frames 8k..8k+7. The section is chosen from the absolute frame (no <Sequence>, which would restart the video).
 *                                 1 full-frame cutout over solid #0033FF           4 picture-in-picture over footage (box ~42 % wide, lower right)
 *                                 2 full-frame cutout over footage                  5 cutout over an animated graphic
 *                                 3 split: footage left, cutout over blue right     6 a large word drawn FIRST, the cutout on top (the body occludes the word)
 *   RvmSubjectForegroundProof   the PRODUCTION SubjectForegroundTrack (one keep segment, one span) over the same blue: proves the production component accepts this file.
 *
 * Media is passed in as input props (`staticFile:<path>` strings); nothing here hardcodes a video path.
 */
import React from 'react';
import {AbsoluteFill, Composition, OffthreadVideo, interpolate, registerRoot, useCurrentFrame} from 'remotion';

import {SubjectForegroundTrack} from '../../src/components/SubjectForegroundTrack';
import {TransparentCutout} from '../../src/components/TransparentCutout';
import {resolveMediaSrc} from '../../src/lib/mediaSrc';

const W = 720;
const H = 1280;
const FPS = 25;
const SECTION_FRAMES = 8;
const SECTIONS = 6;
const TOTAL_FRAMES = SECTION_FRAMES * SECTIONS;
const BLUE = '#0033FF';

type ProofProps = {cutoutSrc: string; footageSrc: string};

const Footage: React.FC<{src: string}> = ({src}) => (
  <AbsoluteFill>
    <OffthreadVideo src={resolveMediaSrc(src)} muted style={{width: '100%', height: '100%', objectFit: 'cover'}} />
  </AbsoluteFill>
);

/** A CSS/Remotion graphic whose look changes across the 8 frames of its section. */
const MotionGraphic: React.FC<{local: number}> = ({local}) => {
  const hue = interpolate(local, [0, SECTION_FRAMES - 1], [20, 200]);
  const angle = interpolate(local, [0, SECTION_FRAMES - 1], [160, 300]);
  return (
    <AbsoluteFill style={{background: `linear-gradient(${angle}deg, hsl(${hue}, 90%, 48%), hsl(${hue + 90}, 90%, 24%))`}}>
      <div
        style={{
          position: 'absolute',
          width: 540,
          height: 540,
          borderRadius: '50%',
          left: interpolate(local, [0, SECTION_FRAMES - 1], [-160, 300]),
          top: interpolate(local, [0, SECTION_FRAMES - 1], [800, 360]),
          background: `hsl(${hue + 160}, 95%, 60%)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: 380,
          height: 380,
          left: 250,
          top: 110,
          borderRadius: 44,
          border: '30px solid #FFFFFF',
          transform: `rotate(${interpolate(local, [0, SECTION_FRAMES - 1], [0, 120])}deg)`,
        }}
      />
    </AbsoluteFill>
  );
};

/** A big word on a flat colour. SVG textLength pins the width, so the layout does not depend on which system font is available. */
const BigWord: React.FC<{text: string}> = ({text}) => (
  <AbsoluteFill style={{backgroundColor: '#F5C400'}}>
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{position: 'absolute', inset: 0}}>
      <text
        x={W / 2}
        y={640}
        textAnchor="middle"
        fontSize={360}
        fontWeight={900}
        fill="#C8102E"
        fontFamily="Impact, 'Arial Black', 'Helvetica Neue', Arial, sans-serif"
        textLength={680}
        lengthAdjust="spacingAndGlyphs">
        {text}
      </text>
    </svg>
  </AbsoluteFill>
);

const Proof: React.FC<ProofProps> = ({cutoutSrc, footageSrc}) => {
  const frame = useCurrentFrame();
  const section = Math.min(SECTIONS - 1, Math.floor(frame / SECTION_FRAMES));
  const local = frame - section * SECTION_FRAMES;
  switch (section) {
    case 0:
      return (
        <AbsoluteFill style={{backgroundColor: BLUE}}>
          <TransparentCutout src={cutoutSrc} />
        </AbsoluteFill>
      );
    case 1:
      return (
        <AbsoluteFill>
          <Footage src={footageSrc} />
          <TransparentCutout src={cutoutSrc} />
        </AbsoluteFill>
      );
    case 2:
      return (
        <AbsoluteFill>
          <div style={{position: 'absolute', left: 0, top: 0, width: '50%', height: '100%', overflow: 'hidden'}}>
            <Footage src={footageSrc} />
          </div>
          <div style={{position: 'absolute', left: '50%', top: 0, width: '50%', height: '100%', backgroundColor: BLUE}} />
          <TransparentCutout src={cutoutSrc} box={{x: 0.5, y: 0, w: 0.5, h: 1}} />
        </AbsoluteFill>
      );
    case 3:
      return (
        <AbsoluteFill>
          <Footage src={footageSrc} />
          <TransparentCutout src={cutoutSrc} box={{x: 0.56, y: 0.56, w: 0.42, h: 0.42}} />
        </AbsoluteFill>
      );
    case 4:
      return (
        <AbsoluteFill>
          <MotionGraphic local={local} />
          <TransparentCutout src={cutoutSrc} />
        </AbsoluteFill>
      );
    default:
      return (
        <AbsoluteFill>
          <BigWord text="HELLO" />
          <TransparentCutout src={cutoutSrc} />
        </AbsoluteFill>
      );
  }
};

/** The production foreground layer, fed this file: one keep segment covering the whole clip, one span, over the same blue. */
const SubjectForegroundProof: React.FC<{cutoutSrc: string}> = ({cutoutSrc}) => {
  const durationSec = TOTAL_FRAMES / FPS;
  return (
    <AbsoluteFill style={{backgroundColor: BLUE}}>
      <SubjectForegroundTrack
        foreground={{videoUrl: cutoutSrc, spans: [{start: 0, end: durationSec}]}}
        segments={[{sourceStart: 0, sourceEnd: durationSec, outputStart: 0}]}
        layoutStyle="fullscreen"
        zoomTriggers={[]}
        zoomEnabled={false}
      />
    </AbsoluteFill>
  );
};

const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="RvmCutoutProof"
      component={Proof as React.FC<any>}
      width={W}
      height={H}
      fps={FPS}
      durationInFrames={TOTAL_FRAMES}
      defaultProps={{cutoutSrc: '', footageSrc: ''}}
    />
    <Composition
      id="RvmSubjectForegroundProof"
      component={SubjectForegroundProof as React.FC<any>}
      width={W}
      height={H}
      fps={FPS}
      durationInFrames={TOTAL_FRAMES}
      defaultProps={{cutoutSrc: ''}}
    />
  </>
);

registerRoot(RemotionRoot);
