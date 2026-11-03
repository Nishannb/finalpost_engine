import React, { useMemo } from 'react';
import {
  AbsoluteFill,
  Easing,
  interpolate,
  interpolateColors,
  random,
  spring,
  useCurrentFrame,
} from 'remotion';

export type Theme = { primary: string; ink: string; surface: string; accent: string };
export type Step = { label: string; icon_hint: string };
export type Content = { headline: string; steps: Step[]; theme?: Partial<Theme> };
export type Cue = { frame: number; step: number };
export type GraphicProps = {
  width: number;
  height: number;
  durationInFrames: number;
  fps: number;
  content: Content;
  cues: Cue[];
};

const DEFAULT_THEME: Theme = {
  primary: '#A78BFA',
  ink: '#F8FAFC',
  surface: '#111827',
  accent: '#F472B6',
};

const FONT = 'Inter, Helvetica, Arial, sans-serif';
const SAFE = { left: 32, right: 32, top: 140, bottom: 470 };
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

type IconKind = 'user' | 'server' | 'camera' | 'generic';
const ICON_ALIASES: Record<string, IconKind> = {
  user: 'user',
  person: 'user',
  customer: 'user',
  people: 'user',
  server: 'server',
  platform: 'server',
  database: 'server',
  cloud: 'server',
  camera: 'camera',
  video: 'camera',
  creator: 'camera',
};

function withAlpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return hex;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function Icon(props: {
  hint: string;
  x: number;
  y: number;
  size: number;
  color: string;
  progress: number;
}) {
  const { hint, x, y, size, color, progress } = props;
  const kind: IconKind = ICON_ALIASES[(hint ?? '').toLowerCase().trim()] ?? 'generic';
  const s = {
    fill: 'none',
    stroke: color,
    strokeWidth: 3,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    pathLength: 1,
    strokeDasharray: 1,
    strokeDashoffset: 1 - progress,
  };
  const dotOpacity = interpolate(progress, [0.6, 1], [0, 1], CLAMP);

  return (
    <svg x={x - size / 2} y={y - size / 2} width={size} height={size} viewBox="0 0 48 48" overflow="visible">
      {kind === 'user' && (
        <>
          <circle cx={24} cy={17} r={8} {...s} />
          <path d="M9 41c0-8.3 6.7-14 15-14s15 5.7 15 14" {...s} />
        </>
      )}
      {kind === 'server' && (
        <>
          <rect x={8} y={8} width={32} height={13} rx={3} {...s} />
          <rect x={8} y={27} width={32} height={13} rx={3} {...s} />
          <path d="M23 14.5h11" {...s} />
          <path d="M23 33.5h11" {...s} />
          <circle cx={15} cy={14.5} r={2} fill={color} opacity={dotOpacity} />
          <circle cx={15} cy={33.5} r={2} fill={color} opacity={dotOpacity} />
        </>
      )}
      {kind === 'camera' && (
        <>
          <path d="M6 17a3 3 0 0 1 3-3h7l3-4h10l3 4h7a3 3 0 0 1 3 3v18a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3z" {...s} />
          <circle cx={24} cy={25} r={7} {...s} />
          <circle cx={36} cy={19} r={1.6} fill={color} opacity={dotOpacity} />
        </>
      )}
      {kind === 'generic' && (
        <>
          <circle cx={24} cy={24} r={15} {...s} />
          <path d="M17 24.5l5 5 9-10" {...s} />
        </>
      )}
    </svg>
  );
}

export default function Graphic(props: GraphicProps) {
  const { width, height, durationInFrames, fps, content, cues } = props;
  const frame = useCurrentFrame();
  const theme: Theme = { ...DEFAULT_THEME, ...(content.theme ?? {}) };
  const steps = content.steps ?? [];
  const n = steps.length;
  const dur = Math.max(1, durationInFrames);
  const sec = (s: number) => s * fps;

  // Resolve one reveal frame per step; compress if cues would land too late for a shortened duration.
  const stepFrames = useMemo(() => {
    const raw = steps.map((_, i) => {
      const c = (cues ?? []).find((q) => q.step === i);
      if (c) return Math.max(0, c.frame);
      const t = steps.length > 1 ? i / (steps.length - 1) : 0;
      return Math.round(dur * (0.15 + 0.6 * t));
    });
    const latest = dur * 0.78;
    const max = raw.length ? Math.max(...raw) : 0;
    const k = max > latest && max > 0 ? latest / max : 1;
    let prev = -Infinity;
    return raw.map((f) => {
      const v = Math.max(f * k, prev + 1);
      prev = v;
      return v;
    });
  }, [steps, cues, dur]);
  const fAt = (i: number): number => stepFrames[i] ?? 0;

  // Layout
  const contentW = width - SAFE.left - SAFE.right;
  const headline = content.headline ?? '';
  const headFs = Math.max(40, Math.min(64, (contentW * 2) / (Math.max(1, headline.length) * 0.56)));
  const headTop = SAFE.top + 20;

  const regionTop = 430;
  const regionBottom = height - SAFE.bottom - 30;
  const slot = (regionBottom - regionTop) / Math.max(1, n);
  const r = Math.max(36, Math.min(76, slot * 0.24));
  const cx = SAFE.left + 8 + r;
  const centers = steps.map((_, i) => regionTop + slot * (i + 0.5));
  const cyAt = (i: number): number => centers[i] ?? 0;
  const cardX = cx + r + 24;
  const cardW = width - SAFE.right - cardX;
  const cardH = Math.min(112, r * 1.45);

  // Global in/out
  const headIn = spring({ frame, fps, config: { damping: 16, stiffness: 120 } });
  const ghostIn = interpolate(frame, [0, sec(0.4)], [0, 1], CLAMP);
  const exitLen = Math.max(6, Math.round(dur * 0.08));
  const exitOpacity = interpolate(frame, [dur - exitLen, dur], [1, 0], CLAMP);
  const underline = interpolate(frame, [sec(0.2), sec(0.7)], [0, 1], {
    ...CLAMP,
    easing: Easing.out(Easing.cubic),
  });

  const reveal = (i: number) =>
    i < n ? interpolate(frame - fAt(i), [0, sec(0.33)], [0, 1], CLAMP) : 0;

  return (
    <AbsoluteFill style={{ backgroundColor: theme.surface, fontFamily: FONT, overflow: 'hidden' }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(130% 55% at 100% 0%, ${withAlpha(theme.primary, 0.16)}, transparent 62%), radial-gradient(90% 40% at 0% 100%, ${withAlpha(theme.accent, 0.08)}, transparent 70%)`,
        }}
      />
      <AbsoluteFill style={{ opacity: exitOpacity }}>
        {/* Headline */}
        <div
          style={{
            position: 'absolute',
            left: SAFE.left,
            top: headTop,
            width: contentW,
            color: theme.ink,
            fontSize: headFs,
            fontWeight: 800,
            lineHeight: 1.08,
            letterSpacing: -0.5,
            opacity: headIn,
            transform: `translateY(${(1 - headIn) * 30}px)`,
          }}
        >
          {headline}
          <div
            style={{
              marginTop: 22,
              height: 8,
              width: 110 * underline,
              borderRadius: 4,
              background: `linear-gradient(90deg, ${theme.accent}, ${theme.primary})`,
            }}
          />
        </div>

        <svg width={width} height={height} style={{ position: 'absolute', left: 0, top: 0 }}>
          <defs>
            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="10" />
            </filter>
            {steps.slice(0, -1).map((_, i) => (
              <linearGradient
                key={i}
                id={`seg-${i}`}
                gradientUnits="userSpaceOnUse"
                x1={cx}
                y1={cyAt(i) + r}
                x2={cx}
                y2={cyAt(i + 1) - r}
              >
                <stop offset="0" stopColor={theme.primary} />
                <stop offset="1" stopColor={theme.accent} />
              </linearGradient>
            ))}
          </defs>

          {/* Connectors */}
          {steps.slice(0, -1).map((_, i) => {
            const y0 = cyAt(i) + r + 12;
            const y1 = cyAt(i + 1) - r - 12;
            const len = Math.max(1, y1 - y0);
            const fA = fAt(i);
            const fB = fAt(i + 1);
            const start = fA + Math.min(sec(0.2), (fB - fA) * 0.25);
            const end = Math.max(start + 1, fB);
            const p = interpolate(frame, [start, end], [0, 1], {
              ...CLAMP,
              easing: Easing.inOut(Easing.cubic),
            });
            const tipY = y0 + len * p;
            const flowIn = interpolate(frame, [end, end + sec(0.3)], [0, 1], CLAMP);
            const chevron = interpolate(p, [0.85, 1], [0, 1], CLAMP);
            const speed = len / sec(1.1);
            return (
              <g key={`seg-${i}`}>
                <line
                  x1={cx}
                  y1={y0}
                  x2={cx}
                  y2={y1}
                  stroke={theme.ink}
                  strokeOpacity={0.12 * ghostIn}
                  strokeWidth={3}
                  strokeDasharray="2 12"
                  strokeLinecap="round"
                />
                {p > 0 && (
                  <line
                    x1={cx}
                    y1={y0}
                    x2={cx}
                    y2={tipY}
                    stroke={`url(#seg-${i})`}
                    strokeWidth={5}
                    strokeLinecap="round"
                  />
                )}
                {p > 0 && p < 1 && (
                  <>
                    <circle cx={cx} cy={tipY} r={12} fill={theme.accent} opacity={0.6} filter="url(#glow)" />
                    <circle cx={cx} cy={tipY} r={6} fill={theme.accent} />
                  </>
                )}
                <path
                  d={`M${cx - 9} ${y1 - 8} L${cx} ${y1 + 1} L${cx + 9} ${y1 - 8}`}
                  fill="none"
                  stroke={theme.accent}
                  strokeWidth={4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={chevron}
                />
                {flowIn > 0 &&
                  [0, 1, 2].map((k) => {
                    const phase = (frame * speed + (k * len) / 3) % len;
                    const t = phase / len;
                    const o = Math.sin(Math.PI * t) * flowIn;
                    const pr = 3.5 + random(`flow-${i}-${k}`) * 2;
                    return (
                      <circle key={k} cx={cx} cy={y0 + phase} r={pr} fill={theme.ink} opacity={o * 0.9} />
                    );
                  })}
              </g>
            );
          })}

          {/* Nodes */}
          {steps.map((step, i) => {
            const cy = cyAt(i);
            const t = frame - fAt(i);
            const s = spring({ frame: t, fps, config: { damping: 13, stiffness: 160, mass: 0.8 } });
            const appear = interpolate(t, [0, 6], [0, 1], CLAMP);
            const rev = reveal(i);
            const nextRev = reveal(i + 1);
            const active = rev * (1 - nextRev);
            const ringColor = interpolateColors(nextRev, [0, 1], [theme.accent, theme.primary]);
            const scale = interpolate(s, [0, 1], [0.4, 1]);
            const iconP = interpolate(t, [4, 4 + sec(0.6)], [0, 1], {
              ...CLAMP,
              easing: Easing.out(Easing.cubic),
            });
            const pulse = interpolate(t, [0, sec(0.7)], [0, 1], CLAMP);
            return (
              <g key={`node-${i}`}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="none"
                  stroke={theme.ink}
                  strokeOpacity={0.14 * ghostIn * (1 - appear)}
                  strokeWidth={2}
                  strokeDasharray="4 10"
                />
                {t >= 0 && (
                  <g transform={`translate(${cx} ${cy}) scale(${scale}) translate(${-cx} ${-cy})`} opacity={appear}>
                    <circle cx={cx} cy={cy} r={r * 0.95} fill={theme.accent} opacity={0.35 * active} filter="url(#glow)" />
                    <circle cx={cx} cy={cy} r={r} fill={theme.surface} />
                    <circle cx={cx} cy={cy} r={r} fill={withAlpha(theme.primary, 0.14)} />
                    <circle cx={cx} cy={cy} r={r - 2} fill="none" stroke={ringColor} strokeWidth={4} />
                    <Icon hint={step.icon_hint} x={cx} y={cy} size={r * 1.0} color={theme.ink} progress={iconP} />
                  </g>
                )}
                {t >= 0 && pulse < 1 && (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={r * (1 + 0.55 * pulse)}
                    fill="none"
                    stroke={theme.accent}
                    strokeWidth={3}
                    opacity={(1 - pulse) * 0.7}
                  />
                )}
              </g>
            );
          })}
        </svg>

        {/* Labels */}
        {steps.map((step, i) => {
          const t = frame - fAt(i) - 4;
          const sl = spring({ frame: t, fps, config: { damping: 16, stiffness: 150 } });
          const o = interpolate(t, [0, 8], [0, 1], CLAMP);
          const rev = reveal(i);
          const nextRev = reveal(i + 1);
          const active = rev * (1 - nextRev);
          const label = step.label ?? '';
          const fs = Math.max(28, Math.min(52, (cardW - 56) / (Math.max(1, label.length) * 0.58)));
          const borderColor = interpolateColors(nextRev, [0, 1], [theme.accent, theme.primary]);
          return (
            <div
              key={`label-${i}`}
              style={{
                position: 'absolute',
                left: cardX,
                top: cyAt(i) - cardH / 2,
                width: cardW,
                height: cardH,
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
                paddingLeft: 28,
                paddingRight: 20,
                borderRadius: 22,
                background: withAlpha(theme.primary, 0.08 + 0.06 * active),
                border: `2px solid ${withAlpha(borderColor, 0.25 + 0.45 * active)}`,
                opacity: o * (1 - 0.3 * nextRev),
                transform: `translateX(${(1 - sl) * 48}px)`,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: cardH * 0.22,
                  width: 6,
                  height: cardH * 0.56,
                  borderRadius: 3,
                  background: borderColor,
                }}
              />
              <span
                style={{
                  color: theme.ink,
                  fontSize: fs,
                  fontWeight: 700,
                  letterSpacing: -0.3,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {label}
              </span>
            </div>
          );
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
