import React, {useMemo} from 'react';
import {useCurrentFrame} from 'remotion';

import {drawStroke, pointAlong, progress, type EaseName} from '../animation';
import {useMotionTheme, useSvgId} from '../context';
import {fontFamily, availableWeight} from '../fonts';
import {fitTextBlock} from '../text';
import {withAlpha} from '../theme';
import {useFontId, type FitTextProps} from './Text';

export type NumberFormat = {prefix?: string; suffix?: string; decimals?: number; grouping?: boolean};

/** Deterministic number formatting (no locale APIs): 12500 → "12,500". */
export function formatNumber(value: number, {prefix = '', suffix = '', decimals = 0, grouping = true}: NumberFormat = {}): string {
  const fixed = Math.abs(value).toFixed(decimals);
  const [int = '0', frac] = fixed.split('.');
  const grouped = grouping ? int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : int;
  return `${value < 0 ? '-' : ''}${prefix}${grouped}${frac ? `.${frac}` : ''}${suffix}`;
}

export type CounterProps = NumberFormat & {
  from?: number;
  to: number;
  width: number;
  height: number;
  delay?: number;
  duration?: number;
  easing?: EaseName;
  font?: FitTextProps['font'];
  weight?: number;
  color?: string;
  align?: 'left' | 'center' | 'right';
};

/**
 * Counts from → to. Font size is fitted once to the widest formatted value, so
 * the number never jumps in size while counting; digits are tabular.
 */
export const Counter: React.FC<CounterProps> = ({
  from = 0,
  to,
  width,
  height,
  delay = 0,
  duration = 36,
  easing = 'out',
  font = 'display',
  weight = 900,
  color,
  align = 'center',
  ...format
}) => {
  const theme = useMotionTheme();
  const frame = useCurrentFrame();
  const fontId = useFontId(font);
  const widest = [formatNumber(from, format), formatNumber(to, format)].sort((a, b) => b.length - a.length)[0]!;
  const fit = useMemo(
    () =>
      fitTextBlock({
        text: widest.replace(/\d/g, '8'),
        width,
        height,
        maxLines: 1,
        maxFontSize: height,
        minFontSize: 10,
        font: fontId,
        weight,
        lineHeight: 1,
      }),
    [widest, width, height, fontId, weight],
  );
  const value = from + (to - from) * progress(frame, delay, duration, easing);
  return (
    <div
      style={{
        width,
        height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center',
        fontFamily: fit.fontFamily,
        fontWeight: fit.fontWeight,
        fontSize: fit.fontSize,
        lineHeight: 1,
        fontVariantNumeric: 'tabular-nums',
        color: color ?? theme.text,
        whiteSpace: 'pre',
      }}>
      {formatNumber(value, format)}
    </div>
  );
};

type Datum = {label: string; value: number; color?: string};

export type BarChartProps = {
  data: Datum[];
  width: number;
  height: number;
  orientation?: 'vertical' | 'horizontal';
  /** Index of the bar to emphasise (accent colour, others muted). */
  highlight?: number;
  delay?: number;
  /** Frames between bars. */
  each?: number;
  duration?: number;
  showValues?: boolean;
  valueFormat?: NumberFormat;
  maxValue?: number;
  color?: string;
};

/**
 * Bars grow from the baseline one after another. Labels and values are fitted
 * to their slot (never truncated mid-word unless a single word cannot fit).
 */
export const BarChart: React.FC<BarChartProps> = ({
  data,
  width,
  height,
  orientation = 'vertical',
  highlight,
  delay = 0,
  each = 4,
  duration = 22,
  showValues = true,
  valueFormat,
  maxValue,
  color,
}) => {
  const theme = useMotionTheme();
  const frame = useCurrentFrame();
  const max = maxValue ?? Math.max(1e-9, ...data.map(d => d.value));
  const n = Math.max(1, data.length);
  const vertical = orientation === 'vertical';
  const labelBand = vertical ? Math.min(height * 0.16, 90) : Math.min(width * 0.32, 320);
  const valueBand = showValues ? (vertical ? Math.min(height * 0.12, 70) : Math.min(width * 0.18, 180)) : 0;
  const slot = (vertical ? width : height) / n;
  const gap = slot * 0.22;
  const barThickness = slot - gap;
  const track = (vertical ? height : width) - labelBand - valueBand;
  const bodyFont = theme.fontBody;
  const labelFit = (text: string) =>
    fitTextBlock({
      text,
      width: vertical ? slot - 8 : labelBand - 16,
      height: vertical ? labelBand : barThickness,
      maxLines: 2,
      maxFontSize: vertical ? labelBand * 0.42 : barThickness * 0.45,
      minFontSize: 12,
      font: bodyFont,
      weight: 600,
    });
  return (
    <div style={{position: 'relative', width, height, fontFamily: fontFamily(bodyFont)}}>
      {data.map((d, i) => {
        const t = progress(frame, delay + i * each, duration, 'outBack');
        const size = Math.max(0, (d.value / max) * track * t);
        const isHi = highlight === undefined || highlight === i;
        const fill = d.color ?? (highlight === undefined ? color ?? theme.primary : isHi ? theme.accent : withAlpha(color ?? theme.primary, 0.45));
        const label = labelFit(d.label);
        const valueText = formatNumber(d.value * Math.min(1, t), valueFormat);
        const valueFont = vertical ? Math.min(valueBand * 0.6, barThickness * 0.42) : Math.min(barThickness * 0.5, valueBand * 0.3);
        const labelStyle: React.CSSProperties = {
          position: 'absolute',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: vertical ? 'center' : 'flex-end',
          textAlign: vertical ? 'center' : 'right',
          fontSize: label.fontSize,
          fontWeight: label.fontWeight,
          lineHeight: `${label.lineHeightPx}px`,
          color: theme.mutedText,
          whiteSpace: 'pre',
        };
        return vertical ? (
          <React.Fragment key={i}>
            <div style={{position: 'absolute', left: i * slot + gap / 2, bottom: labelBand, width: barThickness, height: size, background: fill, borderRadius: `${Math.min(18, barThickness / 4)}px ${Math.min(18, barThickness / 4)}px 4px 4px`}} />
            {showValues ? (
              <div style={{position: 'absolute', left: i * slot, width: slot, bottom: labelBand + size + 6, textAlign: 'center', fontSize: valueFont, fontWeight: availableWeight(bodyFont, 800), color: isHi ? theme.text : theme.mutedText, fontVariantNumeric: 'tabular-nums', opacity: Math.min(1, t * 2), whiteSpace: 'pre'}}>
                {valueText}
              </div>
            ) : null}
            <div style={{...labelStyle, left: i * slot + 4, width: slot - 8, bottom: 0, height: labelBand}}>
              {label.lines.map((l, k) => (
                <div key={k}>{l}</div>
              ))}
            </div>
          </React.Fragment>
        ) : (
          <React.Fragment key={i}>
            <div style={{...labelStyle, left: 0, width: labelBand - 16, top: i * slot + gap / 2, height: barThickness}}>
              {label.lines.map((l, k) => (
                <div key={k}>{l}</div>
              ))}
            </div>
            <div style={{position: 'absolute', left: labelBand, top: i * slot + gap / 2, height: barThickness, width: size, background: fill, borderRadius: `4px ${Math.min(18, barThickness / 4)}px ${Math.min(18, barThickness / 4)}px 4px`}} />
            {showValues ? (
              <div style={{position: 'absolute', left: labelBand + size + 12, top: i * slot + gap / 2, height: barThickness, display: 'flex', alignItems: 'center', fontSize: valueFont, fontWeight: availableWeight(bodyFont, 800), color: isHi ? theme.text : theme.mutedText, fontVariantNumeric: 'tabular-nums', opacity: Math.min(1, t * 2), whiteSpace: 'pre'}}>
                {valueText}
              </div>
            ) : null}
          </React.Fragment>
        );
      })}
    </div>
  );
};

export type LineChartProps = {
  /** Values in order (or {label, value}); x is evenly spaced. */
  data: Array<number | Datum>;
  width: number;
  height: number;
  color?: string;
  /** Fill under the line (revealed with the line). Default true. */
  area?: boolean;
  showPoints?: boolean;
  /** Text shown next to the final point once the line arrives, e.g. "$10M". */
  endLabel?: string;
  delay?: number;
  duration?: number;
  min?: number;
  max?: number;
  strokeWidth?: number;
};

/**
 * Trend line that draws on left → right as one continuous path, with a dot
 * riding the tip. Values are never re-scaled mid-animation.
 */
export const LineChart: React.FC<LineChartProps> = ({
  data,
  width,
  height,
  color,
  area = true,
  showPoints = false,
  endLabel,
  delay = 0,
  duration = 40,
  min,
  max,
  strokeWidth,
}) => {
  const theme = useMotionTheme();
  const frame = useCurrentFrame();
  const gradientId = useSvgId('area');
  const clipId = useSvgId('reveal');
  const values = data.map(d => (typeof d === 'number' ? d : d.value));
  const lo = min ?? Math.min(...values);
  const hi = max ?? Math.max(...values);
  const sw = strokeWidth ?? Math.max(4, Math.min(width, height) * 0.018);
  const labelSpace = endLabel ? Math.min(height * 0.18, 90) : 0;
  const pad = sw * 2;
  const plotTop = pad + labelSpace;
  const plotH = Math.max(1, height - plotTop - pad);
  const points = values.map((v, i) => ({
    x: pad + (i / Math.max(1, values.length - 1)) * (width - pad * 2),
    y: plotTop + (1 - (v - lo) / Math.max(1e-9, hi - lo)) * plotH,
  }));
  const segs = points.slice(1).map((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y));
  const length = segs.reduce((a, b) => a + b, 0);
  const t = progress(frame, delay, duration, 'inOut');
  const tip = pointAlong(points, t);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const stroke = color ?? theme.success;
  const labelT = progress(frame, delay + duration - 4, 12);
  const labelFont = labelSpace * 0.7;
  return (
    <div style={{position: 'relative', width, height}}>
      <svg width={width} height={height} style={{overflow: 'visible'}}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.35} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0} />
          </linearGradient>
          <clipPath id={clipId}>
            <rect x={0} y={0} width={tip.x} height={height} />
          </clipPath>
        </defs>
        {area ? <path d={`${d} L${points[points.length - 1]!.x} ${height} L${points[0]!.x} ${height} Z`} fill={`url(#${gradientId})`} clipPath={`url(#${clipId})`} /> : null}
        <path d={d} fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" {...drawStroke(length, t)} />
        {showPoints
          ? points.map((p, i) => (p.x <= tip.x + 0.5 ? <circle key={i} cx={p.x} cy={p.y} r={sw * 0.9} fill={theme.background} stroke={stroke} strokeWidth={sw * 0.6} /> : null))
          : null}
        {t > 0 ? <circle cx={tip.x} cy={tip.y} r={sw * 1.4} fill={stroke} /> : null}
      </svg>
      {endLabel ? (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: Math.max(0, points[points.length - 1]!.y - labelSpace - sw * 2),
            fontFamily: fontFamily(theme.fontDisplay),
            fontWeight: availableWeight(theme.fontDisplay, 800),
            fontSize: labelFont,
            color: stroke,
            whiteSpace: 'pre',
            opacity: labelT,
            transform: `translateY(${(1 - labelT) * 12}px)`,
          }}>
          {endLabel}
        </div>
      ) : null}
    </div>
  );
};
