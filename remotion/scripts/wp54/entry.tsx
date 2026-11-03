/**
 * WP54 proof entry (NOT part of the production bundle). Three compositions, all silent, 1080x1920 @30:
 *   WP54TypeProof      the four kinetic type comps (clip_35..38) fed the props the REAL planner + binder produced from sample speech (wp54-plan.json).
 *   WP54TemplateProof  DoodleDrawOn (cut-paper + chalkboard), PromoPriceDrop, ProductDeviceFrame, ProductCursorClick, LogoReveal, PhotoKenBurns and MeshGradientGround over footage.
 *   WP54Mounted        the REAL GeneratedGraphicTrack mounting (1) a riso graphic whose props.assetUrl is a rendered mp4 and (2) a native DoodleDrawOn graphic — the same component ShortVideo mounts.
 * Fixture pictures (screenshot / logo) are inline SVG data URLs (proof only; live polish takes the creator's https uploads).
 */
import React from 'react';
import {AbsoluteFill, Composition, Sequence, continueRender, delayRender, registerRoot} from 'remotion';

import {GeneratedGraphicTrack} from '../../src/generated/GeneratedGraphicTrack';
import {CharStaggerType} from '../../src/motion/compositions/templates/CharStaggerType';
import {DoodleDrawOn} from '../../src/motion/compositions/templates/DoodleDrawOn';
import {LineMaskReveal} from '../../src/motion/compositions/templates/LineMaskReveal';
import {LogoReveal} from '../../src/motion/compositions/templates/LogoReveal';
import {MeshGradientGround} from '../../src/motion/compositions/templates/MeshGradientGround';
import {PhotoKenBurns} from '../../src/motion/compositions/templates/PhotoKenBurns';
import {ProductCursorClick} from '../../src/motion/compositions/templates/ProductCursorClick';
import {ProductDeviceFrame} from '../../src/motion/compositions/templates/ProductDeviceFrame';
import {PromoPriceDrop} from '../../src/motion/compositions/templates/PromoPriceDrop';
import {WeightMorphType} from '../../src/motion/compositions/templates/WeightMorphType';
import {WordRevealType} from '../../src/motion/compositions/templates/WordRevealType';
import {loadMotionFonts} from '../../src/motion/fonts';
import {Footage, H, LOGOS, SAFE, SHOT, Themed, W} from '../wp23/shared';
import plan from '../../out/phase36-readiness/wp54-plan.json';

const fontsHandle = delayRender('wp54 motion fonts');
loadMotionFonts().then(
  () => continueRender(fontsHandle),
  () => continueRender(fontsHandle),
);

const FPS = 30;
const f = (sec: number) => Math.round(sec * FPS);
const common = {width: W, height: H, safeArea: SAFE};

type TypeDemo = {templateId: string; compositionId: string; props: Record<string, unknown>; durationSec: number};
const typeDemos = plan.typeDemos as unknown as TypeDemo[];

const typeComp = (demo: TypeDemo): React.ReactNode => {
  const props = demo.props as object;
  switch (demo.compositionId) {
    case 'WordRevealType':
      return <WordRevealType {...common} {...props} />;
    case 'LineMaskReveal':
      return <LineMaskReveal {...common} {...props} />;
    case 'CharStaggerType':
      return <CharStaggerType {...common} {...props} />;
    default:
      return <WeightMorphType {...common} {...props} />;
  }
};

const sequence = (items: Array<{sec: number; node: React.ReactNode; key: string}>): React.ReactNode => {
  let at = 0;
  return items.map(item => {
    const from = at;
    at += f(item.sec);
    return (
      <Sequence key={item.key} from={from} durationInFrames={f(item.sec)}>
        <Themed>{item.node}</Themed>
      </Sequence>
    );
  });
};
const totalOf = (items: Array<{sec: number}>) => items.reduce((sum, item) => sum + f(item.sec), 0);

const palette = plan.palette as {accent: string; ground: string; ink: string};

const TYPE_ITEMS = typeDemos.map(demo => ({key: demo.templateId, sec: demo.durationSec, node: typeComp(demo)}));
const TypeProof: React.FC = () => <AbsoluteFill style={{backgroundColor: '#000'}}>{sequence(TYPE_ITEMS)}</AbsoluteFill>;

const TEMPLATE_ITEMS = [
  {key: 'doodle-cut-paper', sec: 4.6, node: <DoodleDrawOn {...common} style="cut-paper" accent={palette.accent} />},
  {key: 'doodle-chalkboard', sec: 4.6, node: <DoodleDrawOn {...common} style="chalkboard" labels={['Input', 'Process', 'Output']} />},
  {key: 'price-drop', sec: 3.0, node: <PromoPriceDrop {...common} was={79} now={47} prefix="$" label="today" {...palette} />},
  {key: 'device-frame', sec: 3.4, node: <ProductDeviceFrame {...common} imageSrc={SHOT} accent={palette.accent} ground={palette.ground} />},
  {key: 'cursor-click', sec: 3.0, node: <ProductCursorClick {...common} imageSrc={SHOT} target={{x: 0.7, y: 0.32}} accent={palette.accent} ground={palette.ground} />},
  {key: 'logo-reveal', sec: 2.4, node: <LogoReveal {...common} logoSrc={LOGOS[0]} accent={palette.accent} ground="#FFFFFF" />},
  {key: 'ken-burns', sec: 3.2, node: <PhotoKenBurns {...common} imageSrc={SHOT} focus={{x: 0.35, y: 0.3}} accent={palette.accent} ground={palette.ground} />},
  {
    key: 'mesh-over-footage',
    sec: 4.0,
    node: (
      <AbsoluteFill>
        <Footage moving />
        <MeshGradientGround {...common} {...palette} strength={0.55} />
      </AbsoluteFill>
    ),
  },
];
const TemplateProof: React.FC = () => <AbsoluteFill style={{backgroundColor: '#000'}}>{sequence(TEMPLATE_ITEMS)}</AbsoluteFill>;

// WP54Mounted: the real track + a stub component for the riso graphic (the mp4 plays instead of it) and DoodleDrawOn for the native one.
const Stub: React.FC = () => <AbsoluteFill style={{backgroundColor: '#FF00FF'}} />; // magenta would show if the mp4 did NOT mount
const DoodleComponent = DoodleDrawOn as unknown as React.ComponentType<Record<string, unknown>>;
const mounted = plan.mounted as {risoSec: number; graphics: Array<Record<string, unknown>>};
const MOUNT_SEC = mounted.risoSec + 4.6;
const Mounted: React.FC = () => (
  <AbsoluteFill style={{backgroundColor: '#000'}}>
    <Footage moving />
    <GeneratedGraphicTrack
      graphics={mounted.graphics as never}
      components={{riso_stub: Stub as never, doodle_native: DoodleComponent as never}}
      captionBand={null}
    />
  </AbsoluteFill>
);

const Root: React.FC = () => (
  <>
    <Composition id="WP54TypeProof" component={TypeProof} width={W} height={H} fps={FPS} durationInFrames={totalOf(TYPE_ITEMS)} />
    <Composition id="WP54TemplateProof" component={TemplateProof} width={W} height={H} fps={FPS} durationInFrames={totalOf(TEMPLATE_ITEMS)} />
    <Composition id="WP54Mounted" component={Mounted} width={W} height={H} fps={FPS} durationInFrames={f(MOUNT_SEC)} />
  </>
);
registerRoot(Root);
