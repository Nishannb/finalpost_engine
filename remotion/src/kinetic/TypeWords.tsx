/**
 * MOTION-PLAYBOOK compositor for `type.words`. One RenderLine = one word. The solver already sampled every curve (expo-out entries, expo-in exits, the hold) into frame keyframes:
 * this file only INTERPOLATES them (block pose from KineticTrack + each word's own keyframes) and paints. No easing, no placement, no timing decisions live here.
 *
 * The block element is `preserve-3d` so the per-word parallax z separates under the block's slow rotateX / rotateY drift. Opacity and blur therefore live on each WORD (a filter or
 * opacity < 1 on the block would flatten the 3D context), combined with the block's own opacity / blur.
 */
import React from 'react';

import {FONT_STACK} from './fonts';
import {interpolateKeyframes, lineLayer} from './primitives';
import type {PresetProps} from './primitives';
import {interpolateWordKeys} from './wordKeys';
import type {RenderLine} from './spec';

const gradientCss = (fill: RenderLine['fill']) => `linear-gradient(${fill.angleDeg}deg, ${fill.colors.join(', ')})`;
const darken = (hex: string): string => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#1A1A1A';
  const n = parseInt(m[1]!, 16);
  const ch = (v: number) => Math.round(v * 0.42).toString(16).padStart(2, '0');
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
};
/** Hard side-face of an isometric block letter (SHADOW / FLIP), in a darker shade of the face colour. */
const blockExtrude = (hex: string, px: number): string => {
  const side = darken(hex);
  const n = Math.max(7, Math.min(16, Math.round(px * 0.09)));
  return Array.from({length: n}, (_, i) => `${(i + 1) * 1.15}px ${(i + 1) * 1.15}px 0 ${side}`).join(', ');
};
const rgba = (hex: string, a: number) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

export const TypeWords: React.FC<PresetProps> = ({event, local, layer}) => {
  const frame = event.inFrame + local;
  const block = interpolateKeyframes(event.keyframes, frame);
  const sh = event.shadow;
  return (
    <div style={{position: 'absolute', inset: 0, transformStyle: 'preserve-3d'}}>
      {event.lines.map((line, i) => {
        if (layer && lineLayer(event, line) !== layer) return null; // stackOverCutout: this mount draws only its side of the subject
        const first = line.wordKeyframes[0];
        if (!first || frame < first.frame) return null;
        const wk = interpolateWordKeys(line.wordKeyframes, frame);
        const opacity = wk.opacity * block.opacity * line.textOpacity;
        if (opacity <= 0.002 || wk.mask <= 0) return null;
        const blur = wk.blurPx + block.blurPx + event.depthBlurPx;
        const glow = line.glow;
        const glowPx = glow ? glow.radiusPx * wk.glowK : 0;
        const faceHex = line.fill.colors[0] ?? '#FFFFFF';
        const iso = event.pose === 'isometric';
        const shadow = iso
          ? blockExtrude(faceHex, line.fontPx)
          : `drop-shadow(0 ${sh.offsetY}px ${sh.blurPx}px ${sh.color})${glow ? ` drop-shadow(0 0 ${glowPx}px ${rgba(glow.color, Math.min(1, glow.opacity * Math.min(1.6, wk.glowK)))})` : ''}`;
        const skew = event.pose === 'slant' ? ' skewX(-12deg)' : '';
        const face: React.CSSProperties = {
          width: line.w,
          height: line.h,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          lineHeight: `${line.h}px`,
          fontFamily: FONT_STACK[line.font],
          fontSize: line.fontPx,
          fontWeight: line.weight,
          fontStyle: line.italic ? 'italic' : 'normal',
          letterSpacing: `${line.letterSpacingEm + wk.trackingEm}em`,
          textTransform: line.uppercase ? 'uppercase' : 'none',
          whiteSpace: 'nowrap',
          fontKerning: 'none',
          ...(sh.strokePx > 0 && sh.strokeColor ? {WebkitTextStroke: `${sh.strokePx}px ${sh.strokeColor}`, paintOrder: 'stroke fill'} : {}),
          ...(line.fill.kind === 'solid'
            ? {color: line.fill.colors[0]}
            : {backgroundImage: gradientCss(line.fill), WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', WebkitTextFillColor: 'transparent'}),
        };
        return (
          <div
            key={i}
            data-word={line.text}
            style={{
              position: 'absolute',
              left: line.dx,
              top: line.dy,
              width: line.w,
              height: line.h,
              transformOrigin: '50% 50%',
              transform: `translate3d(${wk.x}px, ${wk.y}px, ${line.zPx + wk.z}px) rotateX(${wk.rotateX}deg) rotateY(${wk.rotateY}deg) scale(${wk.scale}) scaleX(${wk.scaleX})${skew}`,
              opacity,
              filter: blur > 0.05 ? `blur(${blur}px)` : undefined,
            }}
          >
            {wk.ghost > 0.01 ? (
              <div style={{position: 'absolute', left: -Math.max(4, line.fontPx * 0.05), top: 0, opacity: wk.ghost, filter: `blur(1.5px)`}}>
                <div style={face}>{line.text}</div>
              </div>
            ) : null}
            {wk.split > 0.3 ? (
              <>
                <div style={{position: 'absolute', left: -wk.split, top: 0, mixBlendMode: 'screen', opacity: 0.85}}>
                  <div style={{...face, backgroundImage: 'none', WebkitBackgroundClip: 'border-box', backgroundClip: 'border-box', color: '#FF2A55', WebkitTextFillColor: '#FF2A55'}}>{line.text}</div>
                </div>
                <div style={{position: 'absolute', left: wk.split, top: 0, mixBlendMode: 'screen', opacity: 0.85}}>
                  <div style={{...face, backgroundImage: 'none', WebkitBackgroundClip: 'border-box', backgroundClip: 'border-box', color: '#22E0FF', WebkitTextFillColor: '#22E0FF'}}>{line.text}</div>
                </div>
              </>
            ) : null}
            <div style={{position: 'absolute', left: 0, top: 0, filter: shadow, clipPath: wk.mask < 0.999 ? `inset(-60% ${(1 - wk.mask) * 100}% -60% -20%)` : undefined}}>
              <div style={face}>{line.text}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
