/** Kinetic primitives: interpolation of the RenderSpec keyframes + line rendering. No placement logic lives here: positions come from the spec. */
import React from 'react';

import {FONT_STACK} from './fonts';
import type {Keyframe, RenderEvent, RenderLine} from './spec';

export function interpolateKeyframes(kfs: Keyframe[], frame: number): Keyframe {
  const first = kfs[0]!;
  const last = kfs[kfs.length - 1]!;
  if (frame <= first.frame) return {...first, frame};
  if (frame >= last.frame) return {...last, frame};
  for (let i = 1; i < kfs.length; i += 1) {
    const b = kfs[i]!;
    if (frame <= b.frame) {
      const a = kfs[i - 1]!;
      const u = (frame - a.frame) / Math.max(1, b.frame - a.frame);
      const l = (p: number, q: number) => p + (q - p) * u;
      return {frame, x: l(a.x, b.x), y: l(a.y, b.y), scale: l(a.scale, b.scale), opacity: l(a.opacity, b.opacity), rotateX: l(a.rotateX, b.rotateX), rotateY: l(a.rotateY, b.rotateY), blurPx: l(a.blurPx, b.blurPx), z: l(a.z, b.z)};
    }
  }
  return {...last, frame};
}

export const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
export const gradientCss = (fill: RenderLine['fill']) => `linear-gradient(${fill.angleDeg}deg, ${fill.colors.join(', ')})`;

export type PresetProps = {event: RenderEvent; /** frames since inFrame */ local: number; /** draw only the lines of this side of the subject foreground (stackOverCutout); undefined = every line */ layer?: 'front' | 'behind'};

/** The side of the subject foreground a line draws on: its own `layer` flag, else the event layering. */
export const lineLayer = (event: RenderEvent, line: RenderLine): 'front' | 'behind' => line.layer ?? event.layering;

/** CSS for one line's face + fill + stroke + shadow. */
export function lineStyle(line: RenderLine, ev: RenderEvent, fillOverride?: RenderLine['fill'], opts: {extrude?: string} = {}): React.CSSProperties {
  const fill = fillOverride ?? line.fill;
  const sh = ev.shadow;
  const glow = sh.glowPx > 0 && sh.glowColor ? ` drop-shadow(0 0 ${sh.glowPx}px ${sh.glowColor})` : '';
  const base: React.CSSProperties = {
    position: 'absolute',
    left: line.dx,
    top: line.dy,
    width: line.w,
    height: line.h,
    lineHeight: `${line.h}px`,
    fontFamily: FONT_STACK[line.font],
    fontSize: line.fontPx,
    fontWeight: line.weight,
    fontStyle: line.italic ? 'italic' : 'normal',
    letterSpacing: `${line.letterSpacingEm}em`,
    textTransform: line.uppercase ? 'uppercase' : 'none',
    whiteSpace: 'nowrap',
    textAlign: 'center',
    fontKerning: 'none',
    filter: `drop-shadow(0 ${sh.offsetY}px ${sh.blurPx}px ${sh.color})${glow}`,
    ...(sh.strokePx > 0 && sh.strokeColor ? {WebkitTextStroke: `${sh.strokePx}px ${sh.strokeColor}`, paintOrder: 'stroke fill'} : {}),
    ...(opts.extrude ? {textShadow: opts.extrude} : {}),
  };
  if (fill.kind === 'solid') return {...base, color: fill.colors[0]};
  return {...base, backgroundImage: gradientCss(fill), WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', WebkitTextFillColor: 'transparent'};
}

/** The text of a line at a local frame, with a swap slot applied to its last token. */
export function swapState(line: RenderLine, local: number): {text: string; slotIndex: number; sinceSwap: number} {
  if (line.swapWords.length === 0) return {text: line.text, slotIndex: -1, sinceSwap: 999};
  let idx = 0;
  line.swapFrames.forEach((f, i) => {
    if (local >= f) idx = i;
  });
  const toks = line.text.split(/\s+/);
  const prefix = toks.slice(0, -1).join(' ');
  const word = line.swapWords[Math.min(idx, line.swapWords.length - 1)]!;
  return {text: prefix ? `${prefix} ${word}` : word, slotIndex: idx, sinceSwap: local - (line.swapFrames[idx] ?? 0)};
}

/** Standard stack of lines, optionally staggered line by line (blur + fade per line). */
export const StackLines: React.FC<PresetProps & {stagger?: number; extrude?: string; render?: (line: RenderLine, i: number) => React.ReactNode}> = ({event, local, stagger = 0, render, extrude}) => (
  <>
    {event.lines.map((line, i) => {
      if (render) return <React.Fragment key={i}>{render(line, i)}</React.Fragment>;
      const t = stagger > 0 ? clamp01((local - i * stagger) / 8) : 1;
      const style = lineStyle(line, event, undefined, extrude ? {extrude} : {});
      const swap = swapState(line, local);
      return (
        <div key={i} style={stagger > 0 ? {...style, opacity: t, transform: `translateY(${(1 - t) * 14}px)`, filter: `${style.filter} blur(${(1 - t) * 8}px)`} : style}>
          {swap.text}
        </div>
      );
    })}
  </>
);
