/**
 * WP55 proof entry (NOT part of the production bundle). All props come from wp55-plan.json, produced by the REAL server code (planCraftTemplateBeats -> bindMotionTemplateContent -> resolveLibraryGraphic) from
 * SIMULATED transcripts: no Claude, no Director model, no network.
 *   WP55Proof     ten scenes, one per KINETIC_TYPE_STORYTELLING template, over real footage (reference clip, ping-pong looped) with a stand-in caption bar that is never muted.
 *   WP55Compare   the same hero beat three ways: NAIVE z-order (text on top, rejected), NO-MATTE fallback (headroom layout) and MATTE occlusion (presenter in front).
 *   WP55Single    one comp at any size (calculateMetadata from props): aspect-ratio stills.
 * Footage ping-pong: the clean span of the reference is only ~1.5 s, so it is played forward / back (the matte was computed on the same ping-pong file).
 */
import React from 'react';
import {AbsoluteFill, Composition, OffthreadVideo, Sequence, continueRender, delayRender, registerRoot, staticFile} from 'remotion';

import {
  TypeEnvironmentalHero,
  TypeFloatingSocialProof,
  TypeImpactNumber,
  TypeIllustratedEmphasis,
  TypeKineticCta,
  TypeKineticWordPop,
  TypeLogoReveal,
  TypeSplitColorHeadline,
  TypeStackedStatement,
  TypeStaggeredPhrase,
} from '../../src/motion/compositions/templates/KineticTypeStory';
import {loadMotionFonts} from '../../src/motion/fonts';
import {fontFamily} from '../../src/motion/fonts';
import plan from '../../out/phase36-readiness/wp55-plan.json';

const fontsHandle = delayRender('wp55 motion fonts');
loadMotionFonts().then(
  () => continueRender(fontsHandle),
  () => continueRender(fontsHandle),
);

const FPS = 30;
const W = 720;
const H = 1280;
const COMPS: Record<string, React.FC<any>> = {
  TypeEnvironmentalHero,
  TypeImpactNumber,
  TypeStaggeredPhrase,
  TypeSplitColorHeadline,
  TypeKineticWordPop,
  TypeStackedStatement,
  TypeFloatingSocialProof,
  TypeLogoReveal,
  TypeKineticCta,
  TypeIllustratedEmphasis,
};

type Scene = {
  templateId: string;
  compositionId: string;
  props: Record<string, any>;
  beatSec: number;
  sentence: string;
  reason: string;
  occlusion?: string;
  videoOffsetSec: number;
};
const scenes: Scene[] = plan.scenes as Scene[];
const LEAD = 0.5; // footage alone first: the type is an event, not wallpaper
const TAIL = 0.5;
const sceneFrames = (s: Scene) => Math.round((LEAD + s.beatSec + TAIL) * FPS);

/** The proof swaps the https fixtures for local files exactly like prefetchBlueprintMedia does for real assets. */
function localize(props: Record<string, any>): Record<string, any> {
  const map: Record<string, string> = {
    'https://proof.invalid/subject-alpha.webm': staticFile('wp55-fixtures/subject.webm'),
    'https://proof.invalid/post1.jpg': staticFile('wp55-fixtures/post1.jpg'),
    'https://proof.invalid/post2.jpg': staticFile('wp55-fixtures/post2.jpg'),
    'https://proof.invalid/logo.svg': staticFile('wp55-fixtures/logo.svg'),
  };
  const out: Record<string, any> = {...props};
  for (const key of ['subjectSrc', 'logoSrc']) if (typeof out[key] === 'string' && map[out[key]]) out[key] = map[out[key]];
  if (Array.isArray(out.imageSrcs)) out.imageSrcs = out.imageSrcs.map((u: string) => map[u] ?? u);
  return out;
}

const Footage: React.FC<{startSec: number}> = ({startSec}) => (
  <OffthreadVideo src={staticFile('wp55-fixtures/base.mp4')} muted startFrom={Math.round(startSec * FPS)} style={{position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover'}} />
);

/** Stand-in for the caption renderer: the FULL spoken line in the caption band. Never muted (the WP55 overlays own no frame). */
const SimCaption: React.FC<{text: string}> = ({text}) => (
  <div style={{position: 'absolute', left: W * 0.08, width: W * 0.84, bottom: H * 0.1, textAlign: 'center', fontFamily: fontFamily('inter'), fontWeight: 800, fontSize: H * 0.027, lineHeight: 1.2, color: '#FFFFFF', textShadow: '0 2px 10px rgba(0,0,0,0.75)'}}>{text}</div>
);

const Chip: React.FC<{text: string}> = ({text}) => (
  <div style={{position: 'absolute', left: 14, top: 14, padding: '6px 10px', borderRadius: 8, background: 'rgba(0,0,0,0.62)', color: '#fff', fontFamily: 'monospace', fontSize: 14, lineHeight: 1.25, maxWidth: W - 28}}>{text}</div>
);

const Scene: React.FC<{scene: Scene}> = ({scene}) => {
  const Comp = COMPS[scene.compositionId]!;
  return (
    <AbsoluteFill style={{backgroundColor: '#000'}}>
      <Footage startSec={scene.videoOffsetSec} />
      <Sequence from={Math.round(LEAD * FPS)} durationInFrames={Math.round(scene.beatSec * FPS)}>
        <Comp width={W} height={H} {...localize(scene.props)} />
      </Sequence>
      <SimCaption text={scene.sentence} />
      <Chip text={`${scene.templateId}${scene.occlusion ? `  [${scene.occlusion}]` : ''}\n${scene.reason}`} />
    </AbsoluteFill>
  );
};

const Proof: React.FC = () => {
  let from = 0;
  return (
    <AbsoluteFill style={{backgroundColor: '#000'}}>
      {scenes.map((scene, i) => {
        const start = from;
        from += sceneFrames(scene);
        return (
          <Sequence key={i} from={start} durationInFrames={sceneFrames(scene)}>
            <Scene scene={scene} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

const Panel: React.FC<{mode: 'naive' | 'fallback' | 'matte'; label: string; offsetX: number}> = ({mode, label, offsetX}) => {
  const hero = plan.compare as {props: Record<string, any>; beatSec: number; offsetSec: number};
  const p = localize(hero.props);
  const common = {width: W, height: H, text: p.text, lead: p.lead, accent: p.accent, ink: p.ink, subjectBox: p.subjectBox};
  return (
    <div style={{position: 'absolute', left: offsetX, top: 0, width: W, height: H, overflow: 'hidden'}}>
      <Footage startSec={hero.offsetSec} />
      <Sequence from={Math.round(0.3 * FPS)} durationInFrames={Math.round(hero.beatSec * FPS)}>
        {mode === 'naive' ? (
          // what plain z-ordering gives: type OVER the presenter, as large as the matte layout (this is the rejected result)
          <TypeEnvironmentalHero {...common} occlusion="matte" subjectSrc={staticFile("wp55-fixtures/empty.webm")} subjectStartSec={0} />
        ) : mode === 'fallback' ? (
          <TypeEnvironmentalHero {...common} occlusion="none" />
        ) : (
          <TypeEnvironmentalHero {...common} occlusion="matte" subjectSrc={p.subjectSrc} subjectStartSec={hero.offsetSec + 0.3} />
        )}
      </Sequence>
      <Chip text={label} />
    </div>
  );
};

const Compare: React.FC = () => (
  <AbsoluteFill style={{backgroundColor: '#111'}}>
    <Panel mode="naive" label={'NAIVE z-order (rejected)\ntype drawn over the presenter'} offsetX={0} />
    <Panel mode="fallback" label={'NO MATTE -> fallback\nheadroom layout, no faked depth'} offsetX={W + 12} />
    <Panel mode="matte" label={'MATTE -> real occlusion\npresenter in front of the type'} offsetX={(W + 12) * 2} />
  </AbsoluteFill>
);

const Single: React.FC<{compositionId: string; props: Record<string, any>; width: number; height: number; bg?: string}> = ({compositionId, props, width, height, bg}) => {
  const Comp = COMPS[compositionId]!;
  return (
    <AbsoluteFill style={{background: bg ?? 'linear-gradient(160deg,#5b7a99 0%,#c8d3dd 55%,#3b4a5a 100%)'}}>
      <Comp width={width} height={height} {...localize(props)} />
    </AbsoluteFill>
  );
};

const total = scenes.reduce((sum, s) => sum + sceneFrames(s), 0);
const compare = plan.compare as {beatSec: number};

const Root: React.FC = () => (
  <>
    <Composition id="WP55Proof" component={Proof} width={W} height={H} fps={FPS} durationInFrames={total} />
    <Composition id="WP55Compare" component={Compare} width={W * 3 + 24} height={H} fps={FPS} durationInFrames={Math.round((compare.beatSec + 0.9) * FPS)} />
    <Composition
      id="WP55Single"
      component={Single as React.FC<any>}
      width={W}
      height={H}
      fps={FPS}
      durationInFrames={Math.round(4 * FPS)}
      defaultProps={{compositionId: 'TypeImpactNumber', props: {}, width: W, height: H}}
      calculateMetadata={({props}) => ({width: (props as any).width, height: (props as any).height})}
    />
  </>
);

registerRoot(Root);
