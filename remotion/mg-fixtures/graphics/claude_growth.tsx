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

export type Content = {
  headline: string;
  subtext: string;
  number: { from: number; to: number; suffix: string };
};

export type GraphicProps = {
  width: number;
  height: number;
  durationInFrames: number;
  fps: number;
  content: Content;
};

const THEME = {
  primary: '#22C55E',
  ink: '#F8FAFC',
  surface: '#0B1220',
  accent: '#FACC15',
};

const FONT = 'Inter, Helvetica, Arial, sans-serif';
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

const SAFE_X = 64;
const SAFE_TOP = 140;
const SAFE_BOTTOM = 470;

/** Shrink a font size so a single line fits within maxWidth (approximate glyph width). */
function fitFont(text: string, maxWidth: number, base: number, charW: number): number {
  const n = Math.max(1, Array.from(text).length);
  return Math.min(base, maxWidth / (n * charW));
}

function decimalsOf(v: number): number {
  if (Number.isInteger(v)) return 0;
  const str = String(v);
  const idx = str.indexOf('.');
  return idx === -1 ? 0 : Math.min(2, str.length - idx - 1);
}

export default function Graphic(props: GraphicProps) {
  const { width, height, fps, content } = props;
  const d = Math.max(20, props.durationInFrames);
  const frame = useCurrentFrame();

  const s = Math.min(width / 1080, height / 1920);
  const innerW = width - SAFE_X * 2;
  const top = SAFE_TOP;
  const bottom = height - SAFE_BOTTOM;
  const boxH = bottom - top;

  const { from, to, suffix } = content.number;

  // ---------- Timing (all relative to duration) ----------
  const countStart = Math.round(d * 0.06);
  const slamF = Math.max(countStart + 8, Math.round(d * 0.56));
  const headlineF = slamF + Math.round(d * 0.03);
  const subtextF = slamF + Math.round(d * 0.1);

  // Growth progress: accelerates into the slam (ends with velocity for impact).
  const g = interpolate(frame, [countStart, slamF], [0, 1], {
    ...CLAMP,
    easing: Easing.bezier(0.55, 0, 0.8, 0.55),
  });
  const slammed = frame >= slamF;

  const intro = interpolate(frame, [0, countStart + 6], [0, 1], {
    ...CLAMP,
    easing: Easing.out(Easing.cubic),
  });

  const slam = spring({
    frame: frame - slamF,
    fps,
    config: { damping: 9, stiffness: 220, mass: 0.7 },
  });
  const impact = interpolate(frame, [slamF, slamF + 10], [1, 0], CLAMP) * (slammed ? 1 : 0);
  const flash = interpolate(frame, [slamF, slamF + 6], [1, 0], CLAMP) * (slammed ? 1 : 0);
  const burst = interpolate(frame, [slamF, slamF + Math.max(12, Math.round(d * 0.2))], [0, 1], {
    ...CLAMP,
    easing: Easing.out(Easing.cubic),
  });

  // Screen shake on impact (deterministic).
  const shakeAmp = 16 * s * impact;
  const shakeX = (random(`shx-${frame}`) - 0.5) * 2 * shakeAmp;
  const shakeY = (random(`shy-${frame}`) - 0.5) * 2 * shakeAmp;

  // ---------- Number ----------
  const decimals = Math.max(1, decimalsOf(from), decimalsOf(to));
  const value = from + (to - from) * g;
  const numText = slammed
    ? Number.isInteger(to)
      ? String(to)
      : to.toFixed(decimals)
    : value.toFixed(decimals);

  const widestNum = `${Math.max(Math.abs(from), Math.abs(to)).toFixed(decimals)}${suffix}`;
  const numFont = fitFont(widestNum, innerW, 330 * s, 0.62);
  const numberCenterY = top + boxH * 0.29;

  const preScale = interpolate(g, [0, 1], [0.8, 1]) * interpolate(intro, [0, 1], [0.9, 1]);
  const numScale = slammed ? interpolate(slam, [0, 1], [1.45, 1]) : preScale;
  const numColor = slammed
    ? interpolateColors(frame, [slamF, slamF + 8], [THEME.accent, THEME.primary])
    : interpolateColors(g, [0, 1], ['#94A3B8', THEME.ink]);
  const numGlow = slammed ? 0.55 + 0.45 * impact : 0.15 * g;

  // ---------- Headline / subtext ----------
  const hl = spring({ frame: frame - headlineF, fps, config: { damping: 14, stiffness: 160 } });
  const st = spring({ frame: frame - subtextF, fps, config: { damping: 16, stiffness: 140 } });
  const headlineFont = fitFont(content.headline, innerW, 92 * s, 0.68);
  const subtextFont = fitFont(content.subtext, innerW, 54 * s, 0.52);
  const headlineY = top + boxH * 0.03;
  const subtextY = top + boxH * 0.46;

  // ---------- Chart ----------
  const ratios = useMemo(() => {
    const N = 12;
    const maxV = Math.max(Math.abs(from), Math.abs(to), 1e-6);
    return Array.from({ length: N }, (_, i) => {
      const t = i / (N - 1);
      const v = from > 0 && to > 0 ? from * Math.pow(to / from, t) : from + (to - from) * t;
      return Math.max(0.04, Math.abs(v) / maxV);
    });
  }, [from, to]);

  const N = ratios.length;
  const chartTop = top + boxH * 0.58;
  const chartBottom = bottom - 24 * s;
  const chartH = chartBottom - chartTop;
  const gap = 14 * s;
  const barW = (innerW - gap * (N - 1)) / N;
  const fullH = chartH * 0.84;
  const rx = Math.min(barW * 0.25, 10 * s);

  const bars = ratios.map((r, i) => {
    const lp = interpolate(g, [i / (N + 3), (i + 4) / (N + 3)], [0, 1], {
      ...CLAMP,
      easing: Easing.out(Easing.back(1.4)),
    });
    const h = r * fullH * lp;
    const x = SAFE_X + i * (barW + gap);
    return { x, y: chartBottom - h, h, lp, i };
  });

  const active = bars.filter((b) => b.lp > 0.001);
  const linePts = active.map((b) => `${b.x + barW / 2},${b.y - 18 * s}`).join(' ');
  const lineOpacity = interpolate(g, [0.04, 0.14], [0, 1], CLAMP);
  const last = active[active.length - 1];
  const prev = active[active.length - 2];
  const arrowAngle =
    last && prev ? (Math.atan2(last.y - prev.y, barW + gap) * 180) / Math.PI : -45;
  const lastHi = slammed ? interpolate(frame, [slamF, slamF + 6], [0, 1], CLAMP) : 0;
  const lastColor = interpolateColors(lastHi, [0, 1], [THEME.primary, THEME.accent]);

  const gridOpacity = 0.08 * intro;
  const glow = 0.1 + 0.12 * g + 0.2 * flash;

  // Sparks / ring
  const sparks = useMemo(
    () =>
      Array.from({ length: 22 }, (_, i) => ({
        angle: (i / 22) * Math.PI * 2 + (random(`sa-${i}`) - 0.5) * 0.4,
        dist: 0.55 + random(`sd-${i}`) * 0.6,
        len: 0.25 + random(`sl-${i}`) * 0.25,
        accent: random(`sc-${i}`) > 0.45,
      })),
    []
  );

  return (
    <AbsoluteFill style={{ backgroundColor: THEME.surface, overflow: 'hidden', fontFamily: FONT }}>
      {/* Ambient background */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 70% 45% at 50% 78%, rgba(34,197,94,${glow}) 0%, rgba(34,197,94,0) 70%),
            radial-gradient(ellipse 60% 35% at 50% 25%, rgba(250,204,21,${0.06 * g + 0.14 * flash}) 0%, rgba(250,204,21,0) 70%),
            radial-gradient(ellipse 120% 80% at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.45) 100%)`,
        }}
      />

      <AbsoluteFill style={{ transform: `translate(${shakeX}px, ${shakeY}px)` }}>
        {/* Chart + effects */}
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          style={{ position: 'absolute', left: 0, top: 0 }}
        >
          <defs>
            <linearGradient id="g3x-bar" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={THEME.primary} stopOpacity={1} />
              <stop offset="100%" stopColor={THEME.primary} stopOpacity={0.12} />
            </linearGradient>
            <linearGradient id="g3x-last" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={lastColor} stopOpacity={1} />
              <stop offset="100%" stopColor={lastColor} stopOpacity={0.2} />
            </linearGradient>
            <filter id="g3x-blur" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation={18 * s} />
            </filter>
          </defs>

          {/* Grid */}
          {[0.25, 0.5, 0.75, 1].map((p) => (
            <line
              key={p}
              x1={SAFE_X}
              x2={width - SAFE_X}
              y1={chartBottom - fullH * p}
              y2={chartBottom - fullH * p}
              stroke={THEME.ink}
              strokeOpacity={gridOpacity}
              strokeWidth={2 * s}
              strokeDasharray={`${6 * s} ${10 * s}`}
            />
          ))}
          <line
            x1={SAFE_X}
            x2={SAFE_X + innerW * intro}
            y1={chartBottom}
            y2={chartBottom}
            stroke={THEME.ink}
            strokeOpacity={0.25}
            strokeWidth={3 * s}
          />

          {/* Glow behind last bar after slam */}
          {last && last.i === N - 1 && lastHi > 0 ? (
            <rect
              x={last.x - 6 * s}
              y={last.y}
              width={barW + 12 * s}
              height={last.h}
              fill={THEME.accent}
              opacity={0.55 * lastHi * (0.6 + 0.4 * impact)}
              filter="url(#g3x-blur)"
            />
          ) : null}

          {/* Bars */}
          {bars.map((b) =>
            b.h > 0.5 ? (
              <rect
                key={b.i}
                x={b.x}
                y={b.y}
                width={barW}
                height={b.h}
                rx={Math.min(rx, b.h / 2)}
                fill={b.i === N - 1 && lastHi > 0 ? 'url(#g3x-last)' : 'url(#g3x-bar)'}
                opacity={0.35 + 0.65 * (b.i / (N - 1))}
              />
            ) : null
          )}

          {/* Trend line */}
          {active.length > 1 ? (
            <polyline
              points={linePts}
              fill="none"
              stroke={THEME.ink}
              strokeOpacity={0.9 * lineOpacity}
              strokeWidth={5 * s}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}
          {active.map((b) => (
            <circle
              key={`dot-${b.i}`}
              cx={b.x + barW / 2}
              cy={b.y - 18 * s}
              r={6 * s * Math.min(1, b.lp)}
              fill={THEME.ink}
              opacity={lineOpacity}
            />
          ))}
          {last ? (
            <g
              transform={`translate(${last.x + barW / 2}, ${last.y - 18 * s}) rotate(${arrowAngle})`}
              opacity={lineOpacity}
            >
              <polygon
                points={`${26 * s},0 ${-6 * s},${-16 * s} ${-6 * s},${16 * s}`}
                fill={slammed ? THEME.accent : THEME.ink}
              />
            </g>
          ) : null}

          {/* Shockwave ring + sparks */}
          {slammed && burst < 1 ? (
            <g>
              <circle
                cx={width / 2}
                cy={numberCenterY}
                r={interpolate(burst, [0, 1], [90 * s, 600 * s])}
                fill="none"
                stroke={THEME.accent}
                strokeWidth={Math.max(0.5, 12 * s * (1 - burst))}
                opacity={0.7 * (1 - burst)}
              />
              {sparks.map((sp, i) => {
                const outer = sp.dist * 480 * s * burst + 120 * s;
                const inner = outer - sp.len * 200 * s * (1 - burst * 0.6);
                const cx = width / 2;
                const cy = numberCenterY;
                return (
                  <line
                    key={i}
                    x1={cx + Math.cos(sp.angle) * inner}
                    y1={cy + Math.sin(sp.angle) * inner}
                    x2={cx + Math.cos(sp.angle) * outer}
                    y2={cy + Math.sin(sp.angle) * outer}
                    stroke={sp.accent ? THEME.accent : THEME.primary}
                    strokeWidth={6 * s}
                    strokeLinecap="round"
                    opacity={1 - burst}
                  />
                );
              })}
            </g>
          ) : null}
        </svg>

        {/* Headline */}
        <div
          style={{
            position: 'absolute',
            left: SAFE_X,
            width: innerW,
            top: headlineY,
            textAlign: 'center',
            color: THEME.ink,
            fontSize: headlineFont,
            fontWeight: 900,
            lineHeight: 1.1,
            whiteSpace: 'nowrap',
            letterSpacing: `${interpolate(hl, [0, 1], [0.28, 0.06])}em`,
            opacity: Math.min(1, hl * 1.4),
            transform: `translateY(${(1 - hl) * 40 * s}px)`,
          }}
        >
          {content.headline}
        </div>

        {/* Big number */}
        <div
          style={{
            position: 'absolute',
            left: SAFE_X,
            width: innerW,
            top: numberCenterY,
            textAlign: 'center',
            fontSize: numFont,
            fontWeight: 900,
            lineHeight: 1,
            whiteSpace: 'nowrap',
            letterSpacing: '-0.04em',
            fontVariantNumeric: 'tabular-nums',
            color: numColor,
            opacity: intro,
            transform: `translateY(-50%) scale(${numScale})`,
            textShadow: `0 0 ${60 * s}px rgba(34,197,94,${numGlow}), 0 ${8 * s}px ${30 * s}px rgba(0,0,0,0.5)`,
          }}
        >
          {numText}
          <span style={{ color: slammed ? THEME.accent : numColor, fontSize: '0.8em', marginLeft: '0.04em' }}>
            {suffix}
          </span>
        </div>

        {/* Subtext */}
        <div
          style={{
            position: 'absolute',
            left: SAFE_X,
            width: innerW,
            top: subtextY,
            textAlign: 'center',
            color: THEME.ink,
            fontSize: subtextFont,
            fontWeight: 500,
            lineHeight: 1.2,
            whiteSpace: 'nowrap',
            letterSpacing: '0.01em',
            opacity: 0.78 * Math.min(1, st * 1.3),
            transform: `translateY(${(1 - st) * 28 * s}px)`,
          }}
        >
          {content.subtext}
        </div>
      </AbsoluteFill>

      {/* Impact flash */}
      <AbsoluteFill style={{ backgroundColor: THEME.ink, opacity: 0.14 * flash, pointerEvents: 'none' }} />
    </AbsoluteFill>
  );
}
