/**
 * Standalone kinetic compositions (registered in Root.tsx):
 *  - KineticEdit:       plate video (+ its audio) -> behind text -> RVM foreground (alpha WebM, optional) -> front text. What the kinetic CLI renders.
 *  - KineticStoryboard: every preset over a plain plate. With no matte a deterministic STAND-IN subject (the same head-ellipse + torso model the depth provider uses) plays the person, so
 *                       "behind" is visible without any footage; pass `matteSrc` (+ `plateSrc`) to see it over a real matte.
 * Layer order per frame: plate -> behind text -> foreground -> front text. No placement logic here.
 */
import React from 'react';
import {AbsoluteFill, OffthreadVideo, staticFile} from 'remotion';
import {z} from 'zod';

import {KineticTrack} from './KineticTrack';
import {renderSpecSchema, type RenderSpec} from './spec';
import {useCurrentFrame} from 'remotion';

const srcOf = (s: string) => (s.startsWith('staticFile:') ? staticFile(s.slice('staticFile:'.length)) : s);

export const kineticEditSchema = z.object({
  spec: renderSpecSchema,
  videoSrc: z.string().optional(),
  matteSrc: z.string().optional(),
  /** plain colour plate when there is no video */
  plateColor: z.string().default('#1b1f27'),
});
export type KineticEditProps = z.infer<typeof kineticEditSchema>;

export const KineticEdit: React.FC<KineticEditProps> = ({spec, videoSrc, matteSrc, plateColor}) => (
  <AbsoluteFill style={{backgroundColor: plateColor}}>
    {videoSrc ? <OffthreadVideo src={srcOf(videoSrc)} style={{position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover'}} /> : null}
    <KineticTrack spec={spec} layer="behind" foreground={Boolean(matteSrc)} />
    {matteSrc ? <OffthreadVideo src={srcOf(matteSrc)} muted transparent style={{position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover'}} /> : null}
    <KineticTrack spec={spec} layer="front" foreground={Boolean(matteSrc)} />
  </AbsoluteFill>
);

// ------------------------------------------------------------------------------------------------------------------------------ storyboard

type Box = {x: number; y: number; w: number; h: number};

/** The silhouette model of server depth.ts `inSilhouette`, drawn: head ellipse in the upper third + a torso block below the neck. */
export const StandInSubject: React.FC<{box: Box; width: number; height: number}> = ({box, width, height}) => {
  const px = (v: number, axis: 'x' | 'y') => v * (axis === 'x' ? width : height);
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <div style={{position: 'absolute', left: px(box.x + 0.1 * box.w, 'x'), top: px(box.y + 0.27 * box.h, 'y'), width: px(0.8 * box.w, 'x'), height: px(0.73 * box.h, 'y'), background: 'linear-gradient(180deg,#46536b,#2b3445)', borderRadius: '18% 18% 0 0'}} />
      <div style={{position: 'absolute', left: px(box.x + box.w / 2 - 0.2 * box.w, 'x'), top: px(box.y + 0.14 * box.h - 0.13 * box.h, 'y'), width: px(0.4 * box.w, 'x'), height: px(0.26 * box.h, 'y'), background: 'linear-gradient(180deg,#6b7a96,#4a566d)', borderRadius: '50%'}} />
    </AbsoluteFill>
  );
};

export const kineticStoryboardSchema = z.object({
  spec: renderSpecSchema,
  subjectBox: z.object({x: z.number(), y: z.number(), w: z.number(), h: z.number()}),
  /** contact-sheet cells: the stand-in figure box and the label per slot (frame range) */
  subjectBoxes: z.array(z.object({startFrame: z.number(), endFrame: z.number(), box: z.object({x: z.number(), y: z.number(), w: z.number(), h: z.number()}), label: z.string().optional()})).default([]),
  /** label per event id prefix, drawn small above the safe area (Studio / review only) */
  labels: z.boolean().default(true),
  /** a real alpha WebM and its plate: replaces the stand-in subject */
  matteSrc: z.string().optional(),
  plateSrc: z.string().optional(),
});
export type KineticStoryboardProps = z.infer<typeof kineticStoryboardSchema>;

export const KineticStoryboard: React.FC<KineticStoryboardProps> = ({spec, subjectBox, subjectBoxes, labels, matteSrc, plateSrc}) => {
  const frame = useCurrentFrame();
  const slot = subjectBoxes.find(b => frame >= b.startFrame && frame < b.endFrame);
  const active = spec.events.find(e => frame >= e.inFrame && frame <= e.outFrame);
  return (
    <AbsoluteFill style={{background: 'linear-gradient(180deg,#2c3545 0%,#475166 55%,#2a3140 100%)'}}>
      {plateSrc ? <OffthreadVideo src={srcOf(plateSrc)} muted style={{position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover'}} /> : null}
      <KineticTrack spec={spec} layer="behind" />
      {matteSrc ? <OffthreadVideo src={srcOf(matteSrc)} muted transparent style={{position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover'}} /> : <StandInSubject box={slot?.box ?? subjectBox} width={spec.width} height={spec.height} />}
      <KineticTrack spec={spec} layer="front" />
      {labels && (active || slot?.label) ? (
        <div style={{position: 'absolute', left: 24, top: 24, fontFamily: 'monospace', fontSize: 18, color: '#10151f', background: 'rgba(255,255,255,0.8)', padding: '4px 8px', borderRadius: 4}}>
          {slot?.label ?? (active ? `${active.presetResolved} · ${active.layering}` : '')}{active?.zone ? ` · zone ${active.zone}` : ''}{active ? ` · ${active.layering}` : ''}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

export const specDuration = (spec: RenderSpec) => Math.max(1, spec.durationInFrames);
