/**
 * Phase D / text-behind-readability proof entry (NOT part of the production bundle; rendered only by scripts/kinetic-led-rvm-proof.mjs).
 *
 *   KledHero      the environmental hero over footage, 48 frames, BEHIND the presenter (host-composited: the PRODUCTION SubjectForegroundTrack draws the RVM cutout above it). The word is a MARQUEE (reveal 'sweep'): big, scrolling
 *                 behind the head so every glyph spends a stretch fully clear of it. `legacy` renders the OLD static centred word behind the head (the bug) for comparison.
 *   KledWordPop   the word pop. It is NEVER behind the presenter any more: the comp ignores occlusion, so even a stale `occlusion="matte"` request renders beside / in the headroom (the foreground is still drawn, to prove it).
 *
 * Footage = remotion/public/hi.mp4 (its first 48 frames); cutout = the Phase 3 RVM WebM of the same frames. Palette = KINETIC_LED_CONFIG (accent #3D4A5C, ink #171717). No external reference is copied.
 */
import React from 'react';
import {AbsoluteFill, Composition, OffthreadVideo, continueRender, delayRender, registerRoot, staticFile} from 'remotion';

import {SubjectForegroundTrack} from '../../src/components/SubjectForegroundTrack';
import {TypeEnvironmentalHero, TypeKineticWordPop} from '../../src/motion/compositions/templates/KineticTypeStory';
import {loadMotionFonts} from '../../src/motion/fonts';

const fontsHandle = delayRender('kinetic-led proof fonts');
loadMotionFonts().then(
  () => continueRender(fontsHandle),
  () => continueRender(fontsHandle),
);

const W = 720;
const H = 1280;
const FPS = 25;
const FRAMES = 48;
const STYLE = {accent: '#3D4A5C', ink: '#171717'};
/** What production passes WITH the matte: the RVM report's own box (measured by subjectmatte test_rvm_ranges on this clip). */
const MATTE_BOX = {x: 0, y: 0.09, w: 1, h: 0.91};
/**
 * The head band measured on the Phase 3 RVM alpha of THIS clip at the rows the hero / word pop occupy (y = 0.14 .. 0.21, frames 0-47): x = 0.335 .. 0.715 (it widens to 0.33 .. 0.74 lower down at y ~ 0.3). The union box above is the
 * full frame width (the arms reach the edges at y >= 0.4), so production demotes this clip's hero to headroom (subject fills the frame); this box is what a head-and-shoulders talking head with free side gutters looks like,
 * and is what the proof drives the comps with.
 */
const HEAD_BOX = {x: 0.335, y: 0.09, w: 0.38, h: 0.91};
/**
 * What production has WITHOUT a matte: the measured vision box of the speaker. In THIS clip the head starts at y ~ 0.09 and the arms reach the frame edges, so the true extents are the same as the matte's: there is NO headroom,
 * and the no-matte planner therefore does not plan an environmental hero here at all (`kinetic_type:environmental:skipped:no_matte_no_headroom`). Only the word pop (which has no headroom gate) is rendered as the no-matte control.
 */
const VISION_BOX = {x: 0, y: 0.09, w: 0.98, h: 0.91};

type Props = {matte: boolean; legacy?: boolean; noFg?: boolean};

const Stage: React.FC<{matte: boolean; noFg?: boolean; children: React.ReactNode}> = ({matte, noFg, children}) => (
  <AbsoluteFill style={{backgroundColor: '#000'}}>
    <OffthreadVideo src={staticFile('hi.mp4')} muted style={{position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover'}} />
    {children}
    {matte && !noFg ? (
      <SubjectForegroundTrack
        foreground={{videoUrl: 'staticFile:rvm-kled/cutout.webm', spans: [{start: 0, end: FRAMES / FPS}]}}
        segments={[{sourceStart: 0, sourceEnd: FRAMES / FPS, outputStart: 0}]}
        layoutStyle="fullscreen"
        zoomTriggers={[]}
        zoomEnabled={false}
      />
    ) : null}
  </AbsoluteFill>
);

/** The word that failed before (static, big, middle letters hidden for the whole beat). It keeps its big size; the MARQUEE scrolls it behind the head so every glyph is clear for a stretch. */
const HERO_WORD = 'ATTENTION';

const KledHero: React.FC<Props> = ({matte, legacy, noFg}) =>
  legacy ? (
    // the OLD behaviour (static, centred, behind the head): the bug, kept only as a comparison render
    <Stage matte={matte} noFg={noFg}>
      <TypeEnvironmentalHero width={W} height={H} text="ATTENTION" lead="and that is" tone="accent" occlusion="matte" reveal="none" subjectBox={MATTE_BOX} {...STYLE} />
    </Stage>
  ) : (
    <Stage matte={matte} noFg={noFg}>
      <TypeEnvironmentalHero width={W} height={H} text={HERO_WORD} lead="and that is" tone="accent" occlusion={matte ? 'matte' : 'none'} reveal="sweep" subjectBox={matte ? HEAD_BOX : VISION_BOX} {...STYLE} />
    </Stage>
  );

/** Word pop with a STALE occlusion request: it must still render fully beside the head (never behind, zero overlap with the silhouette), with the foreground drawn on top to prove nothing hides it. */
const KledWordPop: React.FC<Props> = ({matte, noFg}) => (
  <Stage matte={matte} noFg={noFg}>
    <TypeKineticWordPop width={W} height={H} word="Okay" anchor="left" occlusion="matte" subjectBox={HEAD_BOX} {...STYLE} />
  </Stage>
);

const Root: React.FC = () => (
  <>
    <Composition id="KledHero" component={KledHero as React.FC<any>} width={W} height={H} fps={FPS} durationInFrames={FRAMES} defaultProps={{matte: true}} />
    <Composition id="KledHeroLegacy" component={KledHero as React.FC<any>} width={W} height={H} fps={FPS} durationInFrames={FRAMES} defaultProps={{matte: true, legacy: true}} />
    <Composition id="KledWordPop" component={KledWordPop as React.FC<any>} width={W} height={H} fps={FPS} durationInFrames={FRAMES} defaultProps={{matte: true}} />
  </>
);

registerRoot(Root);
