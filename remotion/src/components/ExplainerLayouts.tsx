import React from 'react';
import {AbsoluteFill} from 'remotion';

import {
  EXPLAINER_DARK_GRADE,
  EXPLAINER_SPLIT_RATIO,
  explainerGridCss,
  explainerRegions,
  explainerRegionsAtSeam,
  type ExplainerLayoutId,
} from '../lib/explainerLayouts';

/**
 * WP40: Skill B (Explainer) layout frames. Pure presentation: each layout is a ground + slots; the caller passes the content (speaker footage, b-roll, a diagram).
 * WP42: ShortVideo mounts `ExplainerLayoutFrame` when the blueprint carries `explainerLayoutTrack` (written only behind POLISH_EXPLAINER_SKILL, default off); without a track nothing here is drawn.
 * WP56: Layout B soft-blurs the dividing line (same spirit as ShortVideo SplitStage feather).
 */
type Slots = {children?: React.ReactNode};

/** Layout A: full-frame talking head. */
export const ExplainerLayoutA: React.FC<Slots> = ({children}) => <AbsoluteFill data-explainer-layout="explainer_a" style={{backgroundColor: '#000'}}>{children}</AbsoluteFill>;

/** Layout B: b-roll on the top half, speaker on the bottom half; the seam is where captions sit (y 50 %). WP49: `seam` animates when expanding to / from full frame. WP56: feathered/blurred seam. */
export const ExplainerLayoutB: React.FC<{width: number; height: number; broll: React.ReactNode; speaker: React.ReactNode; seam?: number}> = ({
  width,
  height,
  broll,
  speaker,
  seam = EXPLAINER_SPLIT_RATIO,
}) => {
  const {top, bottom} = Math.abs(seam - EXPLAINER_SPLIT_RATIO) < 1e-6 ? explainerRegions('explainer_b', width, height) : explainerRegionsAtSeam(width, height, seam);
  const seamY = top!.y + top!.h;
  const feather = Math.max(40, height * 0.075);
  const topH = Math.max(0, seamY + feather * 0.55);
  const bottomTop = Math.max(0, seamY - feather * 0.55);
  const bottomH = Math.max(0, height - bottomTop);
  const topMask = {
    WebkitMaskImage: `linear-gradient(to bottom, #000 0%, #000 calc(100% - ${feather}px), transparent 100%)`,
    maskImage: `linear-gradient(to bottom, #000 0%, #000 calc(100% - ${feather}px), transparent 100%)`,
  } as const;
  const bottomMask = {
    WebkitMaskImage: `linear-gradient(to top, #000 0%, #000 calc(100% - ${feather}px), transparent 100%)`,
    maskImage: `linear-gradient(to top, #000 0%, #000 calc(100% - ${feather}px), transparent 100%)`,
  } as const;
  return (
    <AbsoluteFill data-explainer-layout="explainer_b" data-explainer-seam-blur="true" style={{backgroundColor: '#000'}}>
      {topH > 0 ? (
        <div style={{position: 'absolute', left: 0, top: 0, width, height: topH, overflow: 'hidden', ...topMask}}>{broll}</div>
      ) : null}
      {bottomH > 0 ? (
        <div style={{position: 'absolute', left: 0, top: bottomTop, width, height: bottomH, overflow: 'hidden', ...bottomMask}}>{speaker}</div>
      ) : null}
      <div
        data-explainer-seam-band="true"
        style={{
          position: 'absolute',
          top: seamY - feather * 0.5,
          left: 0,
          right: 0,
          height: feather,
          pointerEvents: 'none',
          opacity: 0.85,
          background: 'linear-gradient(to bottom, rgba(255,255,255,0) 0%, rgba(255,255,255,0.14) 45%, rgba(0,0,0,0.12) 55%, rgba(0,0,0,0) 100%)',
          filter: 'blur(10px)',
        }}
      />
    </AbsoluteFill>
  );
};

/** Diagram ground (Layout C). Defaults to Skill B paper+dots; pass ground/dot from blueprint.editPalette when chosen. `dotted=false` = solid ground (e.g. newsroom ink). */
export const DotGridGround: React.FC<{width: number; backgroundColor?: string; dotColor?: string; dotted?: boolean}> = ({
  width,
  backgroundColor,
  dotColor,
  dotted = true,
}) =>
  dotted ? (
    <AbsoluteFill data-dot-grid="true" style={explainerGridCss(width, {backgroundColor: backgroundColor ?? undefined, dotColor: dotColor ?? undefined})} />
  ) : (
    <AbsoluteFill data-dot-grid="solid" style={{backgroundColor: backgroundColor ?? '#0A0A0A'}} />
  );

/** Layout C: full-frame b-roll on a designed ground (preferred: white + light-gray dots); children are the diagram / logo chips / mock window. */
export const ExplainerLayoutC: React.FC<Slots & {width: number; groundColor?: string; groundDotColor?: string; dotted?: boolean}> = ({
  width,
  children,
  groundColor,
  groundDotColor,
  dotted = true,
}) => (
  <AbsoluteFill data-explainer-layout="explainer_c">
    <DotGridGround width={width} backgroundColor={groundColor} dotColor={groundDotColor} dotted={dotted} />
    {children}
  </AbsoluteFill>
);

/** Layout D: full-bleed cutaway / B-roll (no speaker). Slight dark grade so white type still reads. */
export const ExplainerLayoutD: React.FC<Slots> = ({children}) => (
  <AbsoluteFill data-explainer-layout="explainer_d" style={{backgroundColor: '#000'}}>
    <AbsoluteFill style={{filter: `brightness(${EXPLAINER_DARK_GRADE})`}}>{children}</AbsoluteFill>
  </AbsoluteFill>
);

export const ExplainerLayoutFrame: React.FC<{
  layout: ExplainerLayoutId;
  width: number;
  height: number;
  children?: React.ReactNode;
  speaker?: React.ReactNode;
  broll?: React.ReactNode;
  seam?: number;
  groundColor?: string;
  groundDotColor?: string;
  groundDotted?: boolean;
}> = ({layout, width, height, children, speaker, broll, seam, groundColor, groundDotColor, groundDotted}) => {
  if (layout === 'explainer_b') {
    return <ExplainerLayoutB width={width} height={height} broll={broll} speaker={speaker} seam={seam} />;
  }
  if (layout === 'explainer_c') {
    return (
      <ExplainerLayoutC width={width} groundColor={groundColor} groundDotColor={groundDotColor} dotted={groundDotted}>
        {children ?? broll}
      </ExplainerLayoutC>
    );
  }
  if (layout === 'explainer_d') return <ExplainerLayoutD>{children ?? broll}</ExplainerLayoutD>;
  return <ExplainerLayoutA>{children ?? speaker}</ExplainerLayoutA>;
};
