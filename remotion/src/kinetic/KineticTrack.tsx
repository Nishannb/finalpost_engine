/**
 * The kinetic track: draws RenderSpec events of one layer ('behind' | 'front') for the current composition frame. Placement is pure interpolation of the solver's keyframes.
 * In ShortVideo it is mounted twice (behind the RVM foreground, in front of it) and ONLY when blueprint.kinetic exists; absent = nothing is mounted and nothing changes.
 */
import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';

import {FONT_STACK, useKineticFonts} from './fonts';
import {PRESET_COMPONENTS} from './presets';
import {interpolateKeyframes} from './primitives';
import type {GapCaption, RenderEvent, RenderSpec} from './spec';

/** Warm light-leak flash of the title moment: a full-frame screen-blend wash (a compositor primitive, never a glow on the glyphs). Opacities are sampled by the solver. */
export const LightLeak: React.FC<{event: RenderEvent; frame: number}> = ({event, frame}) => {
  const f = event.flash;
  if (!f) return null;
  const a = f.opacities[frame - f.startFrame];
  if (a === undefined || a <= 0.001) return null;
  return (
    <AbsoluteFill style={{mixBlendMode: 'screen', opacity: a, background: `radial-gradient(120% 80% at 8% 12%, ${f.color} 0%, rgba(255,138,61,0.55) 38%, rgba(255,138,61,0) 78%)`}} />
  );
};

/** Leftover gap caption (IN-11 tick in, OUT-6 cut out): a large spoken content word filling the open frame while no lockup is active. Scale / opacity are sampled by the solver; this only interpolates. */
export const GapCaptionView: React.FC<{caption: GapCaption; frame: number}> = ({caption: c, frame}) => {
  if (frame < c.inFrame || frame >= c.outFrame) return null;
  const kfs = c.keyframes;
  let k = kfs[0]!;
  if (frame >= kfs[kfs.length - 1]!.frame) k = kfs[kfs.length - 1]!;
  else for (let i = 1; i < kfs.length; i += 1) {
    const b = kfs[i]!;
    if (frame <= b.frame) { const a = kfs[i - 1]!; const u = (frame - a.frame) / Math.max(1, b.frame - a.frame); k = {frame, scale: a.scale + (b.scale - a.scale) * u, opacity: a.opacity + (b.opacity - a.opacity) * u}; break; }
  }
  if (k.opacity <= 0.002) return null;
  return (
    <div
      data-gap-caption={c.text}
      style={{
        position: 'absolute', left: c.cx - c.w / 2, top: c.cy - c.h / 2, width: c.w, height: c.h,
        display: 'flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap',
        fontFamily: FONT_STACK[c.font], fontSize: c.fontPx, fontWeight: c.weight, lineHeight: `${c.h}px`, color: c.color, fontKerning: 'none',
        opacity: k.opacity, transform: `scale(${k.scale})`,
        textShadow: '0 2px 10px rgba(0,0,0,0.55)',
        ...(c.strokeColor ? {WebkitTextStroke: `${Math.max(1, c.fontPx * 0.03)}px ${c.strokeColor}`, paintOrder: 'stroke fill'} : {}),
      }}
    >
      {c.text}
    </div>
  );
};

export type KineticLayer = 'behind' | 'front';

export const KineticEventView: React.FC<{event: RenderEvent; frame: number; layer?: KineticLayer}> = ({event, frame, layer}) => {
  if (frame < event.inFrame || frame > event.outFrame) return null;
  const k = interpolateKeyframes(event.keyframes, frame);
  if (k.opacity <= 0.001) return null;
  const Preset = PRESET_COMPONENTS[event.presetResolved];
  const {w, h} = event.block;
  const blur = k.blurPx + event.depthBlurPx;
  // type.words keeps opacity / blur on each WORD (a block filter / opacity would flatten its preserve-3d parallax)
  const perWord = event.presetResolved === 'type.words';
  return (
    <div
      data-kinetic-event={event.id}
      data-layering={event.layering}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: w,
        height: h,
        opacity: perWord ? 1 : k.opacity,
        transformStyle: perWord ? 'preserve-3d' : undefined,
        transformOrigin: '50% 50%',
        transform: `translate(${k.x - w / 2}px, ${k.y - h / 2}px) perspective(${event.perspectivePx}px) translateZ(${k.z}px) rotateX(${k.rotateX}deg) rotateY(${k.rotateY}deg) scale(${k.scale})`,
        filter: perWord ? undefined : `${blur > 0.05 ? `blur(${blur}px)` : ''}${event.tint ? ' saturate(0.92) brightness(0.94)' : ''}`.trim() || undefined,
        willChange: 'transform, opacity',
      }}
    >
      <Preset event={event} local={frame - event.inFrame} {...(layer ? {layer} : {})} />
    </div>
  );
};

/**
 * `foreground` = a person-foreground layer is mounted above the 'behind' text. When it is NOT, 'behind' events are never drawn behind (they would cover the face): the 'front' mount draws them instead.
 */
export const KineticTrack: React.FC<{spec: RenderSpec | undefined; layer: KineticLayer; foreground?: boolean}> = ({spec, layer, foreground = true}) => {
  const frame = useCurrentFrame();
  const ready = useKineticFonts();
  if (!spec || !ready) return null;
  // a line may carry its own layer (stackOverCutout): such an event is mounted on BOTH sides and each mount draws only its lines. Without a foreground everything of the event draws in front.
  const hasLayer = (e: RenderEvent, side: KineticLayer) => e.lines.some(l => (l.layer ?? e.layering) === side);
  const events = spec.events.filter(e => (layer === 'behind' ? foreground && hasLayer(e, 'behind') : hasLayer(e, 'front') || (!foreground && e.layering === 'behind')));
  const captions = layer === 'front' ? spec.captions ?? [] : [];
  if (events.length === 0 && captions.length === 0) return null;
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      {captions.filter(c => frame >= c.inFrame && frame < c.outFrame).map(c => <GapCaptionView key={`cap-${c.wordIdx}`} caption={c} frame={frame} />)}
      {events.map(e => (
        <KineticEventView key={e.id} event={e} frame={frame} {...(foreground && e.lines.some(l => l.layer) ? {layer} : {})} />
      ))}
      {layer === 'front' ? spec.events.map(e => <LightLeak key={`leak-${e.id}`} event={e} frame={frame} />) : null}
    </AbsoluteFill>
  );
};
