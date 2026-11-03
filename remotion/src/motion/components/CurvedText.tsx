import React, {useMemo} from 'react';
import {useCurrentFrame} from 'remotion';

import {progress, type EaseName} from '../animation';
import {useMotionTheme, useSvgId} from '../context';
import {layoutCurvedText, type CurvedTextOptions, type CurvedTextLayout} from '../curvedText';
import {fontFamily} from '../fonts';
import {availableWeight} from '../fonts';
import {useFontId} from './Text';

export type CurvedTextReveal = 'none' | 'fade' | 'chars' | 'sweep';

export type CurvedTextProps = Omit<CurvedTextOptions, 'font' | 'measure'> & {
  /** 'display' / 'body' use the theme fonts; or a FontId. Default 'display'. */
  font?: 'display' | 'body' | import('../fonts').FontId;
  color?: string;
  /** Outline drawn behind the glyphs, for legibility over busy footage. */
  strokeColor?: string;
  strokeWidth?: number;
  /** Soft drop shadow behind the glyphs. */
  shadow?: boolean;
  /** Entrance: fade the whole line, reveal character by character along the curve, or sweep it in from the start. Default 'none'. */
  reveal?: CurvedTextReveal;
  delay?: number;
  duration?: number;
  easing?: EaseName;
  /** Override: drive the entrance with a 0-1 value. */
  progress?: number;
  /**
   * When the curve cannot hold the text legibly (it would shrink below `minFontSize`, or still leave the box), 'straight' (default) draws it as a straight
   * line fitted to the box instead of shipping tiny or clipped type; 'none' keeps the curve regardless. Generated graphics cannot use hooks, so this guard
   * runs inside the component rather than relying on `onLayout`.
   */
  fallback?: 'straight' | 'none';
  /** Receives the computed layout (font size, bounds, legibility flags), e.g. for a backing panel. */
  onLayout?: (layout: CurvedTextLayout) => void;
  style?: React.CSSProperties;
};

/**
 * Text along an arc, a ring or a smooth curve through your points. The text is measured against the real font and shrunk until it fits the curve and
 * stays `margin` px inside the box, so it never clips at the edge. Renders as SVG text on a path, so it stays crisp in the encoded video.
 */
export const CurvedText: React.FC<CurvedTextProps> = props => {
  const theme = useMotionTheme();
  const font = useFontId(props.font);
  const frame = useCurrentFrame();
  const pathId = useSvgId('curve');
  const clipId = useSvgId('sweep');
  const {text, width, height, shape, curvature, radius, angleDeg, direction, points, align, weight, fontSize, minFontSize, letterSpacing, uppercase, rotationDeg, margin} = props;
  const pointsKey = points ? JSON.stringify(points) : '';
  const fallback = props.fallback ?? 'straight';
  const layout = useMemo(() => {
    const curved = layoutCurvedText({text, width, height, shape, curvature, radius, angleDeg, direction, points, align, font, weight, fontSize, minFontSize, letterSpacing, uppercase, rotationDeg, margin});
    if (fallback === 'none' || (curved.legible && !curved.clipped)) {
      return curved;
    }
    const straight = layoutCurvedText({text, width, height, shape: 'arc', curvature: 0, align, font, weight, fontSize, minFontSize, letterSpacing, uppercase, rotationDeg, margin});
    // Straight text is only better when it is actually more legible; otherwise keep the curve (the caller shortened nothing, so neither is good).
    return straight.fontSize > curved.fontSize || (curved.clipped && !straight.clipped) ? {...straight, usedFallback: true} : curved;
  },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fallback, text, width, height, shape, curvature, radius, angleDeg, direction, pointsKey, align, font, weight, fontSize, minFontSize, letterSpacing, uppercase, rotationDeg, margin],
  );
  React.useEffect(() => {
    props.onLayout?.(layout);
  }, [layout]); // eslint-disable-line react-hooks/exhaustive-deps

  const reveal = props.reveal ?? 'none';
  const t = props.progress ?? (reveal === 'none' ? 1 : progress(frame - (props.delay ?? 0), 0, props.duration ?? 20, props.easing ?? 'out'));
  const color = props.color ?? theme.text;
  const family = fontFamily(font);
  const fontWeight = availableWeight(font, props.weight ?? 700);
  const chars = Array.from(layout.text);
  const glyphs: React.ReactNode =
    reveal === 'chars'
      ? chars.map((ch, i) => (
          <tspan key={i} fillOpacity={clamp01(t * (chars.length + 4) - i - 1)} strokeOpacity={clamp01(t * (chars.length + 4) - i - 1)}>
            {ch}
          </tspan>
        ))
      : layout.text;
  const strokeWidth = props.strokeWidth ?? 0;
  const common = {fontFamily: family, fontWeight, fontSize: layout.fontSize, letterSpacing: layout.letterSpacingPx || undefined} as const;
  const sweepWidth = layout.unrotatedBbox.width * (reveal === 'sweep' ? clamp01(t) : 1);
  const textElement = (extra: React.SVGProps<SVGTextElement>) => (
    <text {...common} textAnchor={layout.textAnchor} {...extra}>
      <textPath href={`#${pathId}`} startOffset={`${layout.startOffset * 100}%`}>
        {glyphs}
      </textPath>
    </text>
  );
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{display: 'block', overflow: 'visible', ...props.style}}>
      <defs>
        <path id={pathId} d={layout.pathD} />
        {reveal === 'sweep' ? (
          <clipPath id={clipId}>
            <rect x={layout.unrotatedBbox.x} y={layout.unrotatedBbox.y} width={Math.max(0, sweepWidth)} height={layout.unrotatedBbox.height} />
          </clipPath>
        ) : null}
      </defs>
      <g
        opacity={reveal === 'fade' ? clamp01(t) : 1}
        transform={layout.rotationDeg ? `rotate(${layout.rotationDeg} ${width / 2} ${height / 2})` : undefined}
        style={props.shadow ? {filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.55))'} : undefined}>
        <g clipPath={reveal === 'sweep' ? `url(#${clipId})` : undefined}>
        {strokeWidth > 0
          ? textElement({fill: 'none', stroke: props.strokeColor ?? '#000000', strokeWidth: strokeWidth * 2, strokeLinejoin: 'round'})
          : null}
        {textElement({fill: color})}
        </g>
      </g>
    </svg>
  );
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
