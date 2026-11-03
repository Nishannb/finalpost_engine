import {interpolate, useCurrentFrame} from 'remotion';
import {
  Background,
  Box,
  Counter,
  FitText,
  Icon,
  KineticText,
  LineChart,
  Reveal,
  contentBox,
  isWide,
  progress,
  sliceTop,
  splitRow,
  springIn,
  withAlpha,
  type GraphicProps,
} from '@finalpost/motion';

type Content = {
  label: string;
  from: string;
  to: string;
  series: number[];
  caption: string;
};

type ParsedFigure = {prefix: string; value: number; suffix: string; decimals: number};

// Splits a formatted figure such as "¥1,000万" into prefix / number / suffix so it can count up.
function parseFigure(text: string): ParsedFigure | null {
  const m = text.match(/^([^\d]*?)(\d[\d,]*(?:\.\d+)?)([^\d]*)$/);
  if (!m) return null;
  const raw = (m[2] ?? '').replace(/,/g, '');
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  const dot = raw.indexOf('.');
  return {
    prefix: m[1] ?? '',
    value,
    suffix: m[3] ?? '',
    decimals: dot >= 0 ? raw.length - dot - 1 : 0,
  };
}

// Emphasis phrase from the director's designIntent (styling key only, not added copy).
const EMPHASIS = ['5倍'];

export default function Graphic({width, height, durationInFrames, fps, theme, safeArea, content}: GraphicProps<Content>) {
  const frame = useCurrentFrame();
  const {label, from, to, series, caption} = content!;
  const d = durationInFrames;

  // Layout
  const box = contentBox(width, height, safeArea, Math.min(width, height) * 0.06);
  const wide = isWide(width, height);
  const gap = box.height * 0.02;
  const [labelBox, rest1] = sliceTop(box, wide ? 0.1 : 0.07, gap);
  const [oldBox, rest2] = sliceTop(rest1, wide ? 0.12 : 0.09, gap);
  const [newBox, rest3] = sliceTop(rest2, wide ? 0.26 : 0.2, gap);
  const [chartBox, captionBox] = sliceTop(rest3, 0.68, gap * 1.5);

  const [oldTextBox, oldIconBox] = splitRow(oldBox, 2, oldBox.width * 0.04);
  const oldW = oldBox.width * 0.62;
  const iconSize = Math.min(oldBox.height * 0.8, oldBox.width * 0.12);

  // Timing (fractions of duration)
  const countStart = Math.round(d * 0.12);
  const countDur = Math.max(10, Math.round(d * 0.45));
  const countEnd = countStart + countDur;
  const chartDelay = Math.round(d * 0.15);
  const chartDur = Math.max(10, Math.round(d * 0.5));
  const captionDelay = Math.round(d * 0.55);
  const captionEach = Math.max(1, Math.round(d * 0.012));

  const oldFig = parseFigure(from);
  const newFig = parseFigure(to);

  // Punch when the count lands
  const land = springIn(frame, fps, countEnd, 'bouncy');
  const punch = 1 + 0.08 * Math.sin(Math.min(1, land) * Math.PI);
  const glow = interpolate(frame, [countEnd - 4, countEnd + 6], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const underline = progress(frame, countEnd, Math.max(6, Math.round(d * 0.12)));

  return (
    <>
      <Background variant="spotlight" accent={theme.accent} />

      <Box {...labelBox}>
        <Reveal effect={['fade', 'slide-down']} duration={12}>
          <FitText
            text={label}
            width={labelBox.width}
            height={labelBox.height}
            maxLines={1}
            font="body"
            weight={700}
            color={theme.mutedText}
            letterSpacing={0.08}
          />
        </Reveal>
      </Box>

      {/* Old figure: small and muted */}
      <Box x={oldBox.x + (oldBox.width - oldW) / 2} y={oldBox.y} width={oldW} height={oldBox.height}>
        <Reveal delay={2} effect={['fade', 'slide-up']}>
          <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', gap: iconSize * 0.3, height: oldBox.height}}>
            <FitText
              text={from}
              width={oldW - iconSize * 1.3}
              height={oldBox.height * 0.9}
              maxLines={1}
              weight={700}
              color={theme.mutedText}
              tabular
            />
            <div style={{display: 'flex', flexShrink: 0, opacity: 0.9}}>
              <Icon name="trending-up" size={iconSize} color={theme.success} strokeWidth={2.5} />
            </div>
          </div>
        </Reveal>
      </Box>
      {/* keep split rects referenced for consistent layout semantics */}
      <Box x={oldTextBox!.x} y={oldTextBox!.y} width={0} height={0} />
      <Box x={oldIconBox!.x} y={oldIconBox!.y} width={0} height={0} />

      {/* New figure: large, counting up */}
      <Box {...newBox}>
        <Reveal delay={countStart - 4} effect={['fade', 'scale']} spring="snappy">
          <div
            style={{
              width: newBox.width,
              height: newBox.height,
              transform: `scale(${punch})`,
              transformOrigin: '50% 50%',
            }}>
            {newFig ? (
              <Counter
                from={oldFig ? oldFig.value : 0}
                to={newFig.value}
                prefix={newFig.prefix}
                suffix={newFig.suffix}
                decimals={newFig.decimals}
                grouping
                delay={countStart}
                duration={countDur}
                width={newBox.width}
                height={newBox.height * 0.88}
                weight={900}
                color={theme.accent}
              />
            ) : (
              <FitText text={to} width={newBox.width} height={newBox.height * 0.88} maxLines={1} weight={900} color={theme.accent} tabular />
            )}
          </div>
        </Reveal>
      </Box>
      <Box
        x={newBox.x + newBox.width * 0.2}
        y={newBox.y + newBox.height * 0.92}
        width={newBox.width * 0.6}
        height={Math.max(6, newBox.height * 0.04)}>
        <div
          style={{
            width: '100%',
            height: '100%',
            borderRadius: 999,
            background: withAlpha(theme.accent, 0.35 + 0.5 * glow),
            transform: `scaleX(${underline})`,
            transformOrigin: '50% 50%',
          }}
        />
      </Box>

      {/* Rising chart */}
      <Box {...chartBox}>
        <Reveal delay={chartDelay - 4} effect="fade" duration={8}>
          <LineChart
            data={series}
            width={chartBox.width}
            height={chartBox.height}
            color={theme.success}
            area
            delay={chartDelay}
            duration={chartDur}
            endLabel={to}
          />
        </Reveal>
      </Box>

      {/* Japanese caption with 5倍 emphasis */}
      <Box {...captionBox}>
        <KineticText
          text={caption}
          width={captionBox.width}
          height={captionBox.height}
          maxLines={2}
          mode="chars"
          effect="up"
          delay={captionDelay}
          each={captionEach}
          font="body"
          weight={800}
          color={theme.text}
          highlight={EMPHASIS}
          highlightStyle="marker"
          highlightColor={theme.accent}
          emphasisScale={1.12}
        />
      </Box>
    </>
  );
}
