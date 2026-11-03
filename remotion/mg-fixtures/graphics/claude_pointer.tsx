import React, { useMemo } from 'react';
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame } from 'remotion';

export type Content = {
  label: string;
};

export type GraphicProps = {
  width: number;
  height: number;
  durationInFrames: number;
  fps: number;
  content: Content;
  focusBox: { x: number; y: number; w: number; h: number };
};

const PRIMARY = '#38BDF8';
const INK = '#FFFFFF';
const ACCENT = '#FACC15';
const FONT = 'Inter, Helvetica, Arial, sans-serif';
const SAFE = { left: 64, right: 64, top: 140, bottom: 470 };
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

type Pt = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };

const clamp = (v: number, lo: number, hi: number): number =>
  lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v));

const quad = (a: Pt, c: Pt, b: Pt, t: number): Pt => {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
  };
};

const quadTangent = (a: Pt, c: Pt, b: Pt, t: number): Pt => {
  const u = 1 - t;
  let x = 2 * u * (c.x - a.x) + 2 * t * (b.x - c.x);
  let y = 2 * u * (c.y - a.y) + 2 * t * (b.y - c.y);
  if (Math.abs(x) + Math.abs(y) < 1e-6) {
    x = b.x - a.x;
    y = b.y - a.y;
  }
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
};

// Rounded rect path starting at top-centre, clockwise, ending back at top-centre
// (no Z so dash-based draw-on stays continuous).
const roundedRectPath = (r: Rect, radius: number): string => {
  const { x, y, w, h } = r;
  const rr = Math.max(0, Math.min(radius, w / 2, h / 2));
  return [
    `M ${x + w / 2} ${y}`,
    `H ${x + w - rr}`,
    `A ${rr} ${rr} 0 0 1 ${x + w} ${y + rr}`,
    `V ${y + h - rr}`,
    `A ${rr} ${rr} 0 0 1 ${x + w - rr} ${y + h}`,
    `H ${x + rr}`,
    `A ${rr} ${rr} 0 0 1 ${x} ${y + h - rr}`,
    `V ${y + rr}`,
    `A ${rr} ${rr} 0 0 1 ${x + rr} ${y}`,
    `H ${x + w / 2}`,
  ].join(' ');
};

const bracketsPath = (r: Rect, o: number, len: number): string => {
  const l = r.x - o;
  const t = r.y - o;
  const rt = r.x + r.w + o;
  const b = r.y + r.h + o;
  return [
    `M ${l} ${t + len} V ${t} H ${l + len}`,
    `M ${rt - len} ${t} H ${rt} V ${t + len}`,
    `M ${rt} ${b - len} V ${b} H ${rt - len}`,
    `M ${l + len} ${b} H ${l} V ${b - len}`,
  ].join(' ');
};

export default function Graphic(props: GraphicProps) {
  const { width, height, durationInFrames, fps, content, focusBox } = props;
  const frame = useCurrentFrame();
  const label = content.label ?? '';

  const layout = useMemo(() => {
    const pad = 18;
    const R: Rect = {
      x: focusBox.x - pad,
      y: focusBox.y - pad,
      w: focusBox.w + pad * 2,
      h: focusBox.h + pad * 2,
    };
    const radius = Math.min(40, R.w * 0.14, R.h * 0.14);

    // Label sizing (estimated; text is centred on the anchor so estimate error is symmetric)
    const maxPillW = width - SAFE.left - SAFE.right;
    const chars = Math.max(1, label.length);
    let fs = 54;
    const pillWFor = (f: number) => chars * f * 0.58 + f * 1.24 + f * 0.76;
    if (pillWFor(fs) > maxPillW) fs = Math.max(30, fs * (maxPillW / pillWFor(fs)));
    const pillW = Math.min(maxPillW, pillWFor(fs));
    const pillH = fs * 1.2 + fs * 0.76 + 6;

    const side: 'left' | 'right' = R.x + R.w / 2 >= width / 2 ? 'left' : 'right';
    const safeTop = SAFE.top;
    const safeBottom = height - SAFE.bottom;
    const gapY = 150;

    let mode: 'above' | 'below' | 'beside' = 'beside';
    let cy: number;
    const aboveCy = R.y - gapY - pillH / 2;
    const belowCy = R.y + R.h + gapY + pillH / 2;
    if (aboveCy - pillH / 2 >= safeTop) {
      mode = 'above';
      cy = aboveCy;
    } else if (belowCy + pillH / 2 <= safeBottom) {
      mode = 'below';
      cy = belowCy;
    } else {
      cy = clamp(R.y + R.h / 2, safeTop + pillH / 2, safeBottom - pillH / 2);
    }

    const preferredCx =
      side === 'left' ? (SAFE.left + R.x) / 2 : (R.x + R.w + width - SAFE.right) / 2;
    const cx = clamp(preferredCx, SAFE.left + pillW / 2, width - SAFE.right - pillW / 2);
    const labelLeft = cx - pillW / 2;
    const labelRight = cx + pillW / 2;

    let start: Pt;
    let end: Pt;
    let ctrl: Pt;
    const endGap = 26;
    if (mode === 'beside') {
      start = { x: side === 'left' ? labelRight + 16 : labelLeft - 16, y: cy };
      end = { x: side === 'left' ? R.x - endGap : R.x + R.w + endGap, y: R.y + R.h / 2 };
      ctrl = { x: (start.x + end.x) / 2, y: Math.min(start.y, end.y) - 90 };
    } else {
      const endY = mode === 'above' ? R.y + R.h * 0.3 : R.y + R.h * 0.7;
      end = { x: side === 'left' ? R.x - endGap : R.x + R.w + endGap, y: endY };
      let sx =
        side === 'left'
          ? Math.min(cx + pillW * 0.1, end.x - 140)
          : Math.max(cx - pillW * 0.1, end.x + 140);
      sx = clamp(sx, labelLeft + 40, labelRight - 40);
      const sy = mode === 'above' ? cy + pillH / 2 + 18 : cy - pillH / 2 - 18;
      start = { x: sx, y: sy };
      ctrl = { x: sx, y: endY };
    }

    const originY = mode === 'above' ? '100%' : mode === 'below' ? '0%' : '50%';
    return { R, radius, fs, pillW, pillH, cx, cy, start, end, ctrl, originY };
  }, [width, height, focusBox.x, focusBox.y, focusBox.w, focusBox.h, label]);

  const ids = useMemo(() => {
    const k = `${Math.round(focusBox.x)}-${Math.round(focusBox.y)}-${Math.round(focusBox.w)}-${Math.round(focusBox.h)}`;
    return { glow: `pg-glow-${k}`, soft: `pg-soft-${k}` };
  }, [focusBox.x, focusBox.y, focusBox.w, focusBox.h]);

  // ---- Timing (proportional so it scales with duration) ----
  const d = Math.max(1, Math.round(durationInFrames));
  const exitFrames = Math.max(6, Math.round(d * 0.16));
  const exitStart = Math.max(1, d - exitFrames);
  const outlineEnd = Math.max(8, d * 0.3);
  const labelStart = Math.round(d * 0.1);
  const arrowStart = d * 0.2;
  const arrowEnd = Math.min(exitStart - 2, arrowStart + Math.max(8, d * 0.28));
  const bracketStart = Math.round(outlineEnd * 0.75);

  const outlineP = interpolate(frame, [0, outlineEnd], [0, 1], {
    ...CLAMP,
    easing: Easing.bezier(0.65, 0, 0.35, 1),
  });
  const arrowP = interpolate(frame, [arrowStart, Math.max(arrowStart + 1, arrowEnd)], [0, 1], {
    ...CLAMP,
    easing: Easing.out(Easing.cubic),
  });
  const labelS = spring({
    frame: frame - labelStart,
    fps,
    config: { damping: 11, stiffness: 170, mass: 0.7 },
  });
  const bracketS = spring({
    frame: frame - bracketStart,
    fps,
    config: { damping: 14, stiffness: 200 },
  });
  const exitO = interpolate(frame, [exitStart, d], [1, 0], {
    ...CLAMP,
    easing: Easing.in(Easing.quad),
  });
  const exitScale = interpolate(frame, [exitStart, d], [1, 0.94], CLAMP);

  const pulse = 0.5 + 0.5 * Math.sin((frame / fps) * Math.PI * 2 * 1.1);
  const outlineVisible = outlineP > 0.005 ? 1 : 0;
  const sweepO = interpolate(frame, [outlineEnd, outlineEnd + 6], [0, 1], CLAMP);
  const sweepOffset = -Math.max(0, frame - outlineEnd) / (fps * 1.6);
  const fillO = interpolate(frame, [outlineEnd * 0.5, outlineEnd], [0, 0.1], CLAMP);

  const { R, radius, start, end, ctrl } = layout;
  const rectD = roundedRectPath(R, radius);
  const cxR = R.x + R.w / 2;
  const cyR = R.y + R.h / 2;

  // Arrow: sampled sub-curve so the head rides exactly on the tip
  const arrow = useMemo(() => {
    if (arrowP <= 0.001) return null;
    const N = 48;
    const parts: string[] = [];
    for (let i = 0; i <= N; i++) {
      const p = quad(start, ctrl, end, (arrowP * i) / N);
      parts.push(`${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`);
    }
    const tip = quad(start, ctrl, end, arrowP);
    const tan = quadTangent(start, ctrl, end, arrowP);
    const angle = (Math.atan2(tan.y, tan.x) * 180) / Math.PI;
    return { d: parts.join(' '), tip, angle };
  }, [arrowP, start, ctrl, end]);
  const headScale = interpolate(arrowP, [0, 0.15], [0, 1], CLAMP);

  const bracketOffset = interpolate(bracketS, [0, 1], [44, 14]);
  const bracketLen = Math.min(46, R.w * 0.2, R.h * 0.2);

  const fs = layout.fs;
  const labelOpacity = interpolate(labelS, [0, 0.25], [0, 1], CLAMP) * exitO;
  const labelScale = (0.45 + 0.55 * labelS) * exitScale;
  const labelLift = (1 - labelS) * 28;
  const dotScale = 0.85 + 0.25 * pulse;

  return (
    <AbsoluteFill style={{ background: 'transparent', pointerEvents: 'none' }}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}
      >
        <defs>
          <filter id={ids.glow} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation={10} />
          </filter>
          <filter id={ids.soft} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation={5} />
          </filter>
        </defs>

        <g
          opacity={exitO}
          transform={`translate(${cxR} ${cyR}) scale(${exitScale}) translate(${-cxR} ${-cyR})`}
        >
          {/* faint tint over the phone */}
          <path d={rectD} fill={PRIMARY} opacity={fillO} />

          <g opacity={outlineVisible}>
            {/* dark contrast halo for busy footage */}
            <path
              d={rectD}
              fill="none"
              stroke="rgba(0,0,0,0.55)"
              strokeWidth={18}
              strokeLinecap="round"
              pathLength={1}
              strokeDasharray="1 1"
              strokeDashoffset={1 - outlineP}
              filter={`url(#${ids.soft})`}
            />
            {/* pulsing glow */}
            <path
              d={rectD}
              fill="none"
              stroke={PRIMARY}
              strokeWidth={16}
              strokeLinecap="round"
              pathLength={1}
              strokeDasharray="1 1"
              strokeDashoffset={1 - outlineP}
              filter={`url(#${ids.glow})`}
              opacity={0.55 + 0.4 * pulse}
            />
            {/* core stroke */}
            <path
              d={rectD}
              fill="none"
              stroke={PRIMARY}
              strokeWidth={7}
              strokeLinecap="round"
              pathLength={1}
              strokeDasharray="1 1"
              strokeDashoffset={1 - outlineP}
            />
            <path
              d={rectD}
              fill="none"
              stroke={INK}
              strokeWidth={2}
              strokeLinecap="round"
              pathLength={1}
              strokeDasharray="1 1"
              strokeDashoffset={1 - outlineP}
              opacity={0.75}
            />
          </g>

          {/* travelling highlight once the outline is complete */}
          <g opacity={sweepO}>
            <path
              d={rectD}
              fill="none"
              stroke={INK}
              strokeWidth={12}
              strokeLinecap="round"
              pathLength={1}
              strokeDasharray="0.09 0.91"
              strokeDashoffset={sweepOffset}
              filter={`url(#${ids.glow})`}
              opacity={0.8}
            />
            <path
              d={rectD}
              fill="none"
              stroke={INK}
              strokeWidth={5}
              strokeLinecap="round"
              pathLength={1}
              strokeDasharray="0.09 0.91"
              strokeDashoffset={sweepOffset}
            />
          </g>

          {/* accent corner brackets */}
          <g opacity={interpolate(bracketS, [0, 0.3], [0, 1], CLAMP)}>
            <path
              d={bracketsPath(R, bracketOffset, bracketLen)}
              fill="none"
              stroke="rgba(0,0,0,0.5)"
              strokeWidth={11}
              strokeLinecap="round"
              strokeLinejoin="round"
              filter={`url(#${ids.soft})`}
            />
            <path
              d={bracketsPath(R, bracketOffset, bracketLen)}
              fill="none"
              stroke={ACCENT}
              strokeWidth={6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        </g>

        {/* arrow */}
        {arrow ? (
          <g opacity={exitO}>
            <path
              d={arrow.d}
              fill="none"
              stroke="rgba(0,0,0,0.5)"
              strokeWidth={20}
              strokeLinecap="round"
              strokeLinejoin="round"
              filter={`url(#${ids.soft})`}
            />
            <path
              d={arrow.d}
              fill="none"
              stroke={ACCENT}
              strokeWidth={9}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <g
              transform={`translate(${arrow.tip.x} ${arrow.tip.y}) rotate(${arrow.angle}) scale(${headScale})`}
            >
              <polygon
                points="20,0 -22,-22 -12,0 -22,22"
                fill="rgba(0,0,0,0.5)"
                filter={`url(#${ids.soft})`}
              />
              <polygon
                points="20,0 -22,-22 -12,0 -22,22"
                fill={ACCENT}
                stroke={ACCENT}
                strokeWidth={4}
                strokeLinejoin="round"
              />
            </g>
          </g>
        ) : null}
      </svg>

      {/* label */}
      {label.length > 0 ? (
        <div
          style={{
            position: 'absolute',
            left: layout.cx,
            top: layout.cy,
            transform: `translate(-50%, -50%) translateY(${labelLift}px) scale(${labelScale})`,
            transformOrigin: `50% ${layout.originY}`,
            opacity: labelOpacity,
            maxWidth: width - SAFE.left - SAFE.right,
            display: 'flex',
            alignItems: 'center',
            gap: fs * 0.4,
            padding: `${fs * 0.38}px ${fs * 0.62}px`,
            borderRadius: 999,
            background: 'rgba(2, 6, 23, 0.82)',
            border: `3px solid ${PRIMARY}`,
            boxShadow: `0 0 ${18 + 14 * pulse}px ${PRIMARY}99, 0 12px 34px rgba(0,0,0,0.5)`,
            fontFamily: FONT,
            fontSize: fs,
            fontWeight: 800,
            lineHeight: 1.2,
            letterSpacing: -0.5,
            color: INK,
            whiteSpace: 'nowrap',
            boxSizing: 'border-box',
          }}
        >
          <span
            style={{
              flex: '0 0 auto',
              width: fs * 0.36,
              height: fs * 0.36,
              borderRadius: '50%',
              background: ACCENT,
              boxShadow: `0 0 ${10 + 8 * pulse}px ${ACCENT}`,
              transform: `scale(${dotScale})`,
            }}
          />
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              textShadow: '0 2px 8px rgba(0,0,0,0.6)',
            }}
          >
            {label}
          </span>
        </div>
      ) : null}
    </AbsoluteFill>
  );
}
