import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';

import {drawStroke, progress, type EaseName} from '../animation';
import {useMotionTheme, useSvgId} from '../context';
import {withAlpha} from '../theme';

/** Shared timing props: self-animate after `delay` for `duration` frames, or pass `progress` (0–1). */
export type DrawTiming = {delay?: number; duration?: number; easing?: EaseName; progress?: number};

export function useDraw({delay = 0, duration = 18, easing = 'inOut', progress: override}: DrawTiming): number {
  const frame = useCurrentFrame();
  return override ?? progress(frame, delay, duration, easing);
}

export type CardProps = {
  width: number;
  height: number;
  /** solid: surface fill · soft: tinted fill · outline: border only · glass: translucent (no blur). */
  variant?: 'solid' | 'soft' | 'outline' | 'glass';
  /** Fill/tint colour. Defaults to theme.surface (solid) or theme.primary (soft/outline). */
  color?: string;
  radius?: number;
  borderColor?: string;
  borderWidth?: number;
  /** Small, cheap drop shadow. */
  shadow?: boolean;
  padding?: number;
  style?: React.CSSProperties;
  children?: React.ReactNode;
};

/** Rounded container. Content inside is laid out normally (flex column, centred). */
export const Card: React.FC<CardProps> = ({
  width,
  height,
  variant = 'solid',
  color,
  radius,
  borderColor,
  borderWidth = 3,
  shadow = false,
  padding = 0,
  style,
  children,
}) => {
  const theme = useMotionTheme();
  const tint = color ?? (variant === 'solid' ? theme.surface : theme.primary);
  const background =
    variant === 'solid'
      ? tint
      : variant === 'soft'
        ? withAlpha(tint, 0.16)
        : variant === 'glass'
          ? withAlpha(theme.surface, 0.72)
          : 'transparent';
  const border =
    variant === 'outline' || borderColor
      ? `${borderWidth}px solid ${borderColor ?? tint}`
      : variant === 'glass'
        ? `${borderWidth}px solid ${withAlpha(theme.text, 0.14)}`
        : undefined;
  return (
    <div
      style={{
        width,
        height,
        boxSizing: 'border-box',
        borderRadius: radius ?? Math.min(theme.radius, height / 2),
        background,
        border,
        boxShadow: shadow ? '0 10px 30px rgba(0,0,0,0.35)' : undefined,
        padding,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        ...style,
      }}>
      {children}
    </div>
  );
};

export type ShapeProps = DrawTiming & {
  kind: 'circle' | 'rect' | 'pill' | 'ring';
  width: number;
  height: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
  /** Animate the stroke drawing on (ring/stroked shapes). */
  draw?: boolean;
  style?: React.CSSProperties;
};

/** Basic SVG shape sized to width × height. `ring` = stroked circle. */
export const Shape: React.FC<ShapeProps> = ({
  kind,
  width,
  height,
  fill,
  stroke,
  strokeWidth = 6,
  radius,
  draw = false,
  style,
  ...timing
}) => {
  const theme = useMotionTheme();
  const t = useDraw(timing);
  const sw = stroke || kind === 'ring' ? strokeWidth : 0;
  const w = width - sw;
  const h = height - sw;
  const rx = kind === 'circle' || kind === 'ring' ? Math.min(w, h) / 2 : kind === 'pill' ? h / 2 : radius ?? theme.radius;
  const perimeter =
    kind === 'circle' || kind === 'ring'
      ? Math.PI * Math.min(w, h)
      : 2 * (w + h) - (8 - 2 * Math.PI) * Math.min(rx, w / 2, h / 2);
  const dash = draw ? drawStroke(perimeter, t) : {};
  return (
    <svg width={width} height={height} style={{display: 'block', overflow: 'visible', ...style}}>
      {kind === 'circle' || kind === 'ring' ? (
        <ellipse
          cx={width / 2}
          cy={height / 2}
          rx={w / 2}
          ry={h / 2}
          fill={kind === 'ring' ? 'none' : fill ?? theme.primary}
          stroke={kind === 'ring' ? stroke ?? theme.primary : stroke}
          strokeWidth={sw}
          strokeLinecap="round"
          transform={`rotate(-90 ${width / 2} ${height / 2})`}
          {...dash}
        />
      ) : (
        <rect
          x={sw / 2}
          y={sw / 2}
          width={w}
          height={h}
          rx={rx}
          fill={fill ?? (stroke ? 'none' : theme.primary)}
          stroke={stroke}
          strokeWidth={sw}
          {...dash}
        />
      )}
    </svg>
  );
};

export type LineProps = DrawTiming & {
  from: {x: number; y: number};
  to: {x: number; y: number};
  color?: string;
  strokeWidth?: number;
  dashed?: boolean;
  /** Draw on from `from` to `to`. Default true. */
  draw?: boolean;
  opacity?: number;
};

/**
 * Straight line in the parent's coordinate space (place inside a positioned
 * parent, e.g. the graphic root or a Box). Doubles as a divider.
 */
export const Line: React.FC<LineProps> = ({from, to, color, strokeWidth = 4, dashed = false, draw = true, opacity = 1, ...timing}) => {
  const theme = useMotionTheme();
  const t = useDraw(timing);
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const end = draw ? {x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t} : to;
  return (
    <svg width={1} height={1} style={{position: 'absolute', left: 0, top: 0, overflow: 'visible'}}>
      <line
        x1={from.x}
        y1={from.y}
        x2={end.x}
        y2={end.y}
        stroke={color ?? withAlpha(theme.text, 0.35)}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={dashed ? `${strokeWidth * 2} ${strokeWidth * 3}` : undefined}
        opacity={length > 0 ? opacity : 0}
      />
    </svg>
  );
};

export type BackgroundProps = {
  /** solid · gradient (vertical, subtle) · spotlight (radial glow) · grid (faint lines). */
  variant?: 'solid' | 'gradient' | 'spotlight' | 'grid';
  color?: string;
  accent?: string;
};

/** Full-region opaque background for full-screen / split graphics. Never use on overlays. */
export const Background: React.FC<BackgroundProps> = ({variant = 'gradient', color, accent}) => {
  const theme = useMotionTheme();
  const base = color ?? theme.background;
  const glow = accent ?? theme.primary;
  const gridId = useSvgId('grid');
  if (variant === 'grid') {
    return (
      <AbsoluteFill style={{backgroundColor: base}}>
        <svg width="100%" height="100%">
          <defs>
            <pattern id={gridId} width={60} height={60} patternUnits="userSpaceOnUse">
              <path d="M 60 0 L 0 0 0 60" fill="none" stroke={withAlpha(theme.text, 0.06)} strokeWidth={2} />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill={`url(#${gridId})`} />
        </svg>
      </AbsoluteFill>
    );
  }
  const background =
    variant === 'solid'
      ? base
      : variant === 'spotlight'
        ? `radial-gradient(ellipse 80% 55% at 50% 40%, ${withAlpha(glow, 0.28)} 0%, ${withAlpha(glow, 0)} 70%), ${base}`
        : `linear-gradient(180deg, ${base} 0%, ${withAlpha(glow, 0.18)} 100%), ${base}`;
  return <AbsoluteFill style={{background}} />;
};
