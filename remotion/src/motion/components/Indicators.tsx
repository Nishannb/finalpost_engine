import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';

import {drawStroke, pulse as pulseAt, springIn} from '../animation';
import {useMotionTheme} from '../context';
import {availableWeight, fontFamily} from '../fonts';
import {fitTextBlock, measureLine} from '../text';
import {withAlpha} from '../theme';
import {Icon, type IconName} from './Media';
import {useDraw, type DrawTiming} from './Shapes';

type Point = {x: number; y: number};

function quad(a: Point, c: Point, b: Point, t: number): Point {
  const u = 1 - t;
  return {x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y};
}

export type ArrowProps = DrawTiming & {
  from: Point;
  to: Point;
  /** Curvature: 0 straight, ±0.3 gentle curve (sign picks the side). */
  bend?: number;
  color?: string;
  strokeWidth?: number;
  head?: 'triangle' | 'open' | 'none';
  headSize?: number;
  /** Dark halo under the stroke for readability over video. */
  outline?: boolean;
  /** Nudge the head back and forth toward the target after drawing. */
  pulse?: boolean;
  dashed?: boolean;
};

/**
 * Arrow drawn from `from` to `to` in the parent's coordinate space. Draws on
 * over `duration` frames after `delay`; the head rides the tip.
 */
export const Arrow: React.FC<ArrowProps> = ({
  from,
  to,
  bend = 0,
  color,
  strokeWidth = 8,
  head = 'triangle',
  headSize,
  outline = false,
  pulse = false,
  dashed = false,
  ...timing
}) => {
  const theme = useMotionTheme();
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = useDraw({duration: 16, easing: 'out', ...timing});
  const stroke = color ?? theme.accent;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ctrl = {x: (from.x + to.x) / 2 - (dy / len) * bend * len, y: (from.y + to.y) / 2 + (dx / len) * bend * len};
  const samples = 40;
  const pts = Array.from({length: samples + 1}, (_, i) => quad(from, ctrl, to, (i / samples) * t));
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const tip = pts[samples]!;
  const prev = pts[samples - 1]!;
  const angle = (Math.atan2(tip.y - prev.y, tip.x - prev.x) * 180) / Math.PI;
  const size = headSize ?? strokeWidth * 3.2;
  const nudge = pulse && t >= 1 ? pulseAt(frame, fps, 0.8, 0, size * 0.35) : 0;
  const headPath =
    head === 'triangle'
      ? `M${size * 0.55} 0 L${-size * 0.6} ${-size * 0.6} L${-size * 0.6} ${size * 0.6} Z`
      : `M${-size * 0.6} ${-size * 0.6} L${size * 0.4} 0 L${-size * 0.6} ${size * 0.6}`;
  const lineProps = {
    d,
    fill: 'none',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeDasharray: dashed ? `${strokeWidth * 1.5} ${strokeWidth * 2}` : undefined,
  };
  return (
    <svg width={1} height={1} style={{position: 'absolute', left: 0, top: 0, overflow: 'visible'}}>
      {t > 0.001 ? (
        <>
          {outline ? <path {...lineProps} stroke="rgba(0,0,0,0.45)" strokeWidth={strokeWidth + 8} /> : null}
          <path {...lineProps} stroke={stroke} strokeWidth={strokeWidth} />
          {head !== 'none' ? (
            <g transform={`translate(${tip.x} ${tip.y}) rotate(${angle}) translate(${nudge} 0) scale(${Math.min(1, t * 4)})`}>
              {outline ? (
                <path d={headPath} fill={head === 'triangle' ? 'rgba(0,0,0,0.45)' : 'none'} stroke="rgba(0,0,0,0.45)" strokeWidth={8} strokeLinejoin="round" />
              ) : null}
              <path
                d={headPath}
                fill={head === 'triangle' ? stroke : 'none'}
                stroke={stroke}
                strokeWidth={head === 'triangle' ? 2 : strokeWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          ) : null}
        </>
      ) : null}
    </svg>
  );
};

export type FocusRingProps = DrawTiming & {
  /** The box to highlight, in the parent's coordinates (px). */
  x: number;
  y: number;
  width: number;
  height: number;
  shape?: 'rounded' | 'ellipse';
  color?: string;
  strokeWidth?: number;
  /** Space between the box and the ring. */
  padding?: number;
  /** Soft breathing halo after drawing (cheap: a translucent wider stroke, no blur). */
  pulse?: boolean;
  /** Dark halo for contrast over video. Default true. */
  outline?: boolean;
};

/** Outline that draws around a target box — "look here". Transparent everywhere else. */
export const FocusRing: React.FC<FocusRingProps> = ({
  x,
  y,
  width,
  height,
  shape = 'rounded',
  color,
  strokeWidth = 8,
  padding = 16,
  pulse = true,
  outline = true,
  ...timing
}) => {
  const theme = useMotionTheme();
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = useDraw({duration: 18, ...timing});
  const stroke = color ?? theme.secondary;
  const rx = x - padding;
  const ry = y - padding;
  const w = width + padding * 2;
  const h = height + padding * 2;
  const radius = shape === 'ellipse' ? 0 : Math.min(36, w * 0.15, h * 0.15);
  const perimeter = shape === 'ellipse' ? Math.PI * (1.5 * (w + h) / 2 - Math.sqrt((w * h) / 4)) : 2 * (w + h);
  const dash = drawStroke(perimeter, t);
  const halo = pulse && t >= 1 ? pulseAt(frame, fps, 1.2, 0.15, 0.45) : 0;
  const el = (extra: React.SVGProps<SVGElement>) =>
    shape === 'ellipse' ? (
      <ellipse cx={rx + w / 2} cy={ry + h / 2} rx={w / 2} ry={h / 2} fill="none" {...(extra as React.SVGProps<SVGEllipseElement>)} />
    ) : (
      <rect x={rx} y={ry} width={w} height={h} rx={radius} fill="none" {...(extra as React.SVGProps<SVGRectElement>)} />
    );
  return (
    <svg width={1} height={1} style={{position: 'absolute', left: 0, top: 0, overflow: 'visible'}}>
      {halo > 0 ? el({stroke, strokeWidth: strokeWidth * 3.2, opacity: halo}) : null}
      {outline ? el({stroke: 'rgba(0,0,0,0.45)', strokeWidth: strokeWidth + 8, ...dash}) : null}
      {el({stroke, strokeWidth, strokeLinecap: 'round', ...dash})}
    </svg>
  );
};

export type BadgeProps = {
  text: string;
  icon?: IconName;
  /** Badge height in px; text and icon scale from it. Default 72. */
  height?: number;
  /** Longest the badge may grow; text shrinks to fit. */
  maxWidth?: number;
  color?: string;
  textColor?: string;
  /** Pop in after `delay` frames (spring). Set animate={false} for static. */
  delay?: number;
  animate?: boolean;
  /** Thin border (default colour: the theme accent; see `borderColor`). */
  bordered?: boolean;
  /** Border colour when `bordered`. */
  borderColor?: string;
  /** Ellipsise instead of shrinking when the text cannot fit maxWidth. Default false. */
  truncate?: boolean;
  /** WP13C: icon size as a fraction of the badge height (default 0.5; illustrated chips use a bigger symbol). */
  iconScale?: number;
  /** WP13C: label weight (default 700; short-form chips use 800+). */
  weight?: number;
  /** WP13C: icon colour (default: the text colour). */
  iconColor?: string;
  style?: React.CSSProperties;
};

/** Pill label sized to its text (measured). Good for callout labels, tags, step names. */
export const Badge: React.FC<BadgeProps> = ({
  text,
  icon,
  height = 72,
  maxWidth = 900,
  color,
  textColor,
  delay = 0,
  animate = true,
  bordered = false,
  borderColor,
  truncate = false,
  iconScale = 0.5,
  weight = 700,
  iconColor,
  style,
}) => {
  const theme = useMotionTheme();
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  // Text never gets cut by default: if the badge cannot fit maxWidth at this
  // height, the whole badge shrinks proportionally instead.
  if (!truncate) {
    const natural = measureLine(text, height * 0.44, theme.fontBody, 700) + height * (0.84 + (icon ? iconScale + 0.18 : 0));
    if (natural > maxWidth) {
      height = Math.max(8, height * (maxWidth / natural) * 0.98);
    }
  }
  const padX = height * 0.42;
  const iconSize = icon ? height * iconScale : 0;
  const gap = icon ? height * 0.18 : 0;
  const fit = fitTextBlock({
    text,
    width: maxWidth - padX * 2 - iconSize - gap,
    height: height * 0.62,
    maxLines: 1,
    maxFontSize: height * 0.44,
    minFontSize: truncate ? Math.max(10, height * 0.22) : Math.max(4, height * 0.3),
    font: theme.fontBody,
    weight,
    truncate,
  });
  const textWidth = measureLine(fit.lines[0] ?? '', fit.fontSize, theme.fontBody, weight);
  const s = animate ? springIn(frame, fps, delay, 'bouncy') : 1;
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap,
        height,
        width: Math.ceil(textWidth + padX * 2 + iconSize + gap),
        boxSizing: 'border-box',
        padding: `0 ${padX}px`,
        borderRadius: height / 2,
        background: color ?? theme.surface,
        border: bordered ? `3px solid ${borderColor ?? theme.accent}` : undefined,
        color: textColor ?? theme.text,
        fontFamily: fontFamily(theme.fontBody),
        fontWeight: availableWeight(theme.fontBody, weight),
        fontSize: fit.fontSize,
        whiteSpace: 'pre',
        opacity: Math.min(1, Math.max(0, s)),
        transform: `scale(${Math.max(0, s)})`,
        ...style,
      }}>
      {icon ? <Icon name={icon} size={iconSize} color={iconColor ?? textColor ?? theme.accent} /> : null}
      <span>{fit.lines[0]}</span>
    </div>
  );
};

export type ProgressProps = DrawTiming & {
  variant?: 'bar' | 'ring';
  /** Target value 0–1. */
  value: number;
  width: number;
  /** Bar thickness, or ring diameter is min(width, height). */
  height: number;
  color?: string;
  trackColor?: string;
  thickness?: number;
  /** Show "NN%" (ring: centred inside; bar: right of the fill end). */
  showLabel?: boolean;
};

/** Animated percentage: a filling bar or a sweeping ring. */
export const Progress: React.FC<ProgressProps> = ({
  variant = 'bar',
  value,
  width,
  height,
  color,
  trackColor,
  thickness,
  showLabel = false,
  ...timing
}) => {
  const theme = useMotionTheme();
  const t = useDraw({duration: 30, easing: 'out', ...timing});
  const fill = color ?? theme.primary;
  const track = trackColor ?? withAlpha(theme.text, 0.12);
  const v = Math.max(0, Math.min(1, value)) * t;
  const label = `${Math.round(v * 100)}%`;
  if (variant === 'ring') {
    const size = Math.min(width, height);
    const sw = thickness ?? size * 0.1;
    const r = (size - sw) / 2;
    const c = 2 * Math.PI * r;
    return (
      <div style={{position: 'relative', width: size, height: size}}>
        <svg width={size} height={size} style={{transform: 'rotate(-90deg)'}}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={sw} />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={fill} strokeWidth={sw} strokeLinecap="round" strokeDasharray={`${c} ${c}`} strokeDashoffset={c * (1 - v)} />
        </svg>
        {showLabel ? (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: theme.text,
              fontFamily: fontFamily(theme.fontDisplay),
              fontWeight: availableWeight(theme.fontDisplay, 800),
              fontSize: size * 0.24,
              fontVariantNumeric: 'tabular-nums',
            }}>
            {label}
          </div>
        ) : null}
      </div>
    );
  }
  const barH = thickness ?? height;
  return (
    <div style={{position: 'relative', width, height}}>
      <div style={{position: 'absolute', left: 0, top: (height - barH) / 2, width, height: barH, borderRadius: barH / 2, background: track, overflow: 'hidden'}}>
        <div style={{width: `${v * 100}%`, height: '100%', borderRadius: barH / 2, background: fill}} />
      </div>
      {showLabel ? (
        <div
          style={{
            position: 'absolute',
            right: 0,
            bottom: height + 8,
            color: theme.text,
            fontFamily: fontFamily(theme.fontBody),
            fontWeight: 700,
            fontSize: Math.max(18, barH * 1.4),
            fontVariantNumeric: 'tabular-nums',
          }}>
          {label}
        </div>
      ) : null}
    </div>
  );
};

