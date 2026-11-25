/**
 * Kinetic Composer scene layer: plate treatments, accent shapes and counters (RenderSpec.scene). Like every kinetic track, this file only INTERPOLATES solver-sampled keys and paints:
 * no placement, timing or easing decisions live here. Absent `spec.scene` = nothing is mounted (every pre-composer spec renders exactly as before).
 */
import React from 'react';
import {AbsoluteFill} from 'remotion';

import {FONT_STACK} from './fonts';
import type {SceneCounter, SceneElement, SceneKey, ScenePlate, SceneShape} from './spec';

export function interpolateSceneKeys(keys: SceneKey[], frame: number): SceneKey {
  const first = keys[0]!, last = keys[keys.length - 1]!;
  if (frame <= first.frame) return {...first, frame};
  if (frame >= last.frame) return {...last, frame};
  for (let i = 1; i < keys.length; i += 1) {
    const b = keys[i]!;
    if (frame <= b.frame) {
      const a = keys[i - 1]!;
      const u = (frame - a.frame) / Math.max(1, b.frame - a.frame);
      const l = (p: number, q: number) => p + (q - p) * u;
      return {frame, opacity: l(a.opacity, b.opacity), progress: l(a.progress, b.progress), scale: l(a.scale, b.scale), x: l(a.x, b.x), y: l(a.y, b.y), amount: l(a.amount, b.amount)};
    }
  }
  return {...last, frame};
}

const rgba = (hex: string, a: number): string => {
  const m = /^#?([0-9a-f]{6})/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(1, a))})`;
};
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

const PlateView: React.FC<{el: ScenePlate; k: SceneKey}> = ({el, k}) => {
  const a = clamp01(k.amount) * clamp01(k.opacity);
  if (a <= 0.002) return null;
  const fx = el.focus?.x ?? 0.5, fy = el.focus?.y ?? 0.4;
  switch (el.effect) {
    case 'dim': return <AbsoluteFill style={{background: rgba(el.color, a)}} />;
    case 'wash': return <AbsoluteFill style={{background: rgba(el.color, a), mixBlendMode: 'multiply'}} />;
    case 'vignette': return <AbsoluteFill style={{background: `radial-gradient(ellipse 75% 60% at ${fx * 100}% ${fy * 100}%, rgba(0,0,0,0) 35%, ${rgba(el.color, a)} 100%)`}} />;
    case 'spotlight': return <AbsoluteFill style={{background: `radial-gradient(circle at ${fx * 100}% ${fy * 100}%, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 22%, ${rgba(el.color, a)} 62%)`}} />;
    case 'blur': return <AbsoluteFill style={{backdropFilter: `blur(${(a * 18).toFixed(2)}px)`, WebkitBackdropFilter: `blur(${(a * 18).toFixed(2)}px)`}} />;
    case 'backdrop': return <AbsoluteFill style={{background: `linear-gradient(180deg, ${rgba(el.color, a)} 0%, ${rgba(el.color, a * 0.94)} 100%)`}} />;
    default: return null;
  }
};

const ShapeView: React.FC<{el: SceneShape; k: SceneKey}> = ({el, k}) => {
  const p = clamp01(k.progress);
  const op = clamp01(k.opacity);
  if (op <= 0.002 || p <= 0.001) return null;
  const wrap: React.CSSProperties = {position: 'absolute', left: el.x + k.x, top: el.y + k.y, width: Math.max(1, Math.abs(el.w)), height: Math.max(1, Math.abs(el.h)), opacity: op, transform: `rotate(${el.rotateDeg}deg) scale(${k.scale})`, transformOrigin: '50% 50%'};
  const origin = el.origin === 'center' ? '50% 50%' : el.origin === 'right' ? '100% 50%' : '0% 50%';
  if (el.shape === 'bar' || el.shape === 'underline') {
    return <div style={wrap}><div style={{position: 'absolute', inset: 0, background: el.color, borderRadius: el.radiusPx, transform: `scaleX(${p})`, transformOrigin: origin}} /></div>;
  }
  if (el.shape === 'dot') {
    return <div style={wrap}><div style={{position: 'absolute', inset: 0, background: el.color, borderRadius: '50%', transform: `scale(${p})`}} /></div>;
  }
  if (el.shape === 'box') {
    const inset = `inset(0 ${(1 - p) * 100}% 0 0)`;
    return (
      <div style={wrap}>
        <div style={{position: 'absolute', inset: 0, borderRadius: el.radiusPx, clipPath: inset, ...(el.fill ? {background: el.color} : {border: `${el.strokePx}px solid ${el.color}`})}} />
      </div>
    );
  }
  // SVG strokes: ring, line, arrow, bracket (stroke traced by progress)
  const W = Math.max(1, Math.abs(el.w)), H = Math.max(1, Math.abs(el.h)), sw = Math.max(1, el.strokePx);
  const svgBox: React.CSSProperties = {...wrap, left: Math.min(el.x, el.x + el.w) + k.x - sw * 2, top: Math.min(el.y, el.y + el.h) + k.y - sw * 2, width: W + sw * 4, height: H + sw * 4, overflow: 'visible'};
  const ox = sw * 2, oy = sw * 2;
  const dash = (len: number) => ({strokeDasharray: `${len}`, strokeDashoffset: `${len * (1 - p)}`});
  if (el.shape === 'ring') {
    const rx = W / 2, ry = H / 2;
    const len = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
    return <svg style={svgBox}><ellipse cx={ox + rx} cy={oy + ry} rx={rx} ry={ry} fill="none" stroke={el.color} strokeWidth={sw} strokeLinecap="round" style={dash(len)} transform={`rotate(-90 ${ox + rx} ${oy + ry})`} /></svg>;
  }
  if (el.shape === 'bracket') {
    const len = H + W * 2;
    return <svg style={svgBox}><path d={`M ${ox + W} ${oy} L ${ox} ${oy} L ${ox} ${oy + H} L ${ox + W} ${oy + H}`} fill="none" stroke={el.color} strokeWidth={sw} strokeLinejoin="round" style={dash(len)} /></svg>;
  }
  // line / arrow from (x, y) to (x + w, y + h)
  const x1 = ox + (el.w < 0 ? W : 0), y1 = oy + (el.h < 0 ? H : 0), x2 = ox + (el.w < 0 ? 0 : W), y2 = oy + (el.h < 0 ? 0 : H);
  const len = Math.hypot(x2 - x1, y2 - y1);
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const head = sw * 3.2;
  return (
    <svg style={svgBox}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={el.color} strokeWidth={sw} strokeLinecap="round" style={dash(len)} />
      {el.shape === 'arrow' && p > 0.92 ? (
        <path d={`M ${x2 - head * Math.cos(ang - 0.5)} ${y2 - head * Math.sin(ang - 0.5)} L ${x2} ${y2} L ${x2 - head * Math.cos(ang + 0.5)} ${y2 - head * Math.sin(ang + 0.5)}`} fill="none" stroke={el.color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      ) : null}
    </svg>
  );
};

const formatCounter = (v: number, decimals: number): string => {
  const fixed = v.toFixed(decimals);
  const [int, dec] = fixed.split('.');
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return dec ? `${grouped}.${dec}` : grouped;
};

const CounterView: React.FC<{el: SceneCounter; k: SceneKey}> = ({el, k}) => {
  const op = clamp01(k.opacity);
  if (op <= 0.002) return null;
  const value = el.from + (el.to - el.from) * clamp01(k.progress);
  const text = `${el.prefix}${formatCounter(value, el.decimals)}${el.suffix}`;
  return (
    <div
      data-counter={el.id}
      style={{
        position: 'absolute', left: el.cx - el.w / 2 + k.x, top: el.cy - el.h / 2 + k.y, width: el.w, height: el.h,
        display: 'flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap',
        fontFamily: FONT_STACK[el.font], fontSize: el.fontPx, fontWeight: el.weight, lineHeight: `${el.h}px`, color: el.color, fontKerning: 'none', fontVariantNumeric: 'tabular-nums',
        opacity: op, transform: `scale(${k.scale})`, transformOrigin: '50% 50%',
        filter: `drop-shadow(0 6px 18px rgba(0,0,0,0.45))${el.glowColor ? ` drop-shadow(0 0 ${Math.round(el.fontPx * 0.18)}px ${el.glowColor})` : ''}`,
        ...(el.strokeColor ? {WebkitTextStroke: `${Math.max(2, el.fontPx * 0.025)}px ${el.strokeColor}`, paintOrder: 'stroke fill'} : {}),
      }}
    >
      {text}
    </div>
  );
};

const active = (el: SceneElement, frame: number) => frame >= el.inFrame && frame <= el.outFrame;

/** `part`: 'under' = plate treatments + under-shapes (below the type), 'over' = over-shapes + counters (above the type). */
export const SceneLayer: React.FC<{scene: SceneElement[] | undefined; frame: number; part: 'under' | 'over'}> = ({scene, frame, part}) => {
  if (!scene || scene.length === 0) return null;
  const items = scene.filter(el => active(el, frame) && (part === 'under' ? el.kind === 'plate' || (el.kind === 'shape' && el.layer === 'under') : el.kind === 'counter' || (el.kind === 'shape' && el.layer === 'over')));
  if (items.length === 0) return null;
  // plates first (full-frame), then shapes / counters in spec order
  items.sort((a, b) => (a.kind === 'plate' ? 0 : 1) - (b.kind === 'plate' ? 0 : 1));
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}} data-scene-part={part}>
      {items.map(el => {
        const k = interpolateSceneKeys(el.keys, frame);
        if (el.kind === 'plate') return <PlateView key={el.id} el={el} k={k} />;
        if (el.kind === 'shape') return <ShapeView key={el.id} el={el} k={k} />;
        return <CounterView key={el.id} el={el} k={k} />;
      })}
    </AbsoluteFill>
  );
};
