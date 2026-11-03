import {useCurrentFrame} from 'remotion';
import {
  Background,
  Badge,
  Box,
  FitText,
  KineticText,
  Reveal,
  contentBox,
  fitTextGroup,
  formatNumber,
  measureLine,
  progress,
  pulse,
  sliceTop,
  springIn,
  withAlpha,
  type GraphicProps,
} from '@finalpost/motion';

type Stage = {label: string; value: number};
type Content = {title: string; stages: Stage[]; overall: string};

const formatPct = (x: number): string => {
  const decimals = Math.abs(x - Math.round(x)) < 0.05 ? 0 : 1;
  return formatNumber(x, {suffix: '%', decimals, grouping: true});
};

export default function Graphic({width, height, durationInFrames, fps, theme, safeArea, content}: GraphicProps<Content>) {
  const frame = useCurrentFrame();
  const {title, stages, overall} = content!;
  const n = Math.max(1, stages.length);
  const maxValue = Math.max(1, ...stages.map((s) => s.value));

  // Layout
  const box = contentBox(width, height, safeArea, Math.min(width, height) * 0.04);
  const [titleBox, rest] = sliceTop(box, 0.12, box.height * 0.02);
  const [funnelBox, overallBox] = sliceTop(rest, 0.84, rest.height * 0.02);

  const gapRatio = 0.6;
  const rowH = funnelBox.height / (n + (n - 1) * gapRatio);
  const gapH = rowH * gapRatio;
  const rowY = (i: number) => funnelBox.y + i * (rowH + gapH);

  const colGap = funnelBox.width * 0.025;
  const labelW = funnelBox.width * 0.28;
  const countW = funnelBox.width * 0.22;
  const barColX = funnelBox.x + labelW + colGap;
  const barColW = funnelBox.width - labelW - countW - colGap * 2;
  const countX = barColX + barColW + colGap;
  const barCenter = barColX + barColW / 2;

  const barH = rowH * 0.72;
  const barY = (i: number) => rowY(i) + (rowH - barH) / 2;
  const barW = (v: number) => Math.max(barColW * 0.06, (barColW * v) / maxValue);
  const radius = Math.min(barH / 2, (theme.radius * width) / 1080);

  // Timing (fractions of the duration)
  const stageStart = (i: number) => Math.round(durationInFrames * (0.08 + i * (0.56 / n)));
  const countDur = Math.max(10, Math.round(durationInFrames * 0.18));
  const overallStart = Math.round(durationInFrames * 0.7);

  // Text sizing
  const labels = stages.map((s) => s.label);
  const labelSize = fitTextGroup(labels, {width: labelW, height: rowH * 0.8, maxLines: 2, font: theme.fontBody, weight: 700});
  const countStrs = stages.map((s) => formatNumber(s.value, {grouping: true}));
  const countSize = fitTextGroup(countStrs, {width: countW, height: rowH * 0.7, maxLines: 1, font: theme.fontDisplay, weight: 800});

  // Derived conversions
  const first = stages[0];
  const last = stages[stages.length - 1];
  const overallPct = first && last && first.value > 0 ? formatPct((last.value / first.value) * 100) : '';
  const highlight = overallPct && overall.includes(overallPct) ? [overallPct] : [];

  const badgeH = Math.min(gapH * 0.82, rowH * 0.55);
  const lastIdx = stages.length - 1;
  const glow = progress(frame, overallStart, 10) * pulse(frame, fps, 40, 0.3, 0.6);

  return (
    <>
      <Background variant="gradient" />

      <Box {...titleBox}>
        <Reveal effect={['fade', 'slide-down']}>
          <FitText text={title} width={titleBox.width} height={titleBox.height} maxLines={1} weight={800} color={theme.text} />
        </Reveal>
      </Box>

      {/* Funnel connectors */}
      <svg width={width} height={height} style={{position: 'absolute', left: 0, top: 0}}>
        {stages.slice(0, -1).map((s, i) => {
          const next = stages[i + 1]!;
          const wa = barW(s.value);
          const wb = barW(next.value);
          const ya = barY(i) + barH;
          const yb = barY(i + 1);
          const pts = `${barCenter - wa / 2},${ya} ${barCenter + wa / 2},${ya} ${barCenter + wb / 2},${yb} ${barCenter - wb / 2},${yb}`;
          return <polygon key={`c${i}`} points={pts} fill={withAlpha(theme.primary, 0.18)} opacity={progress(frame, stageStart(i + 1), 10)} />;
        })}
      </svg>

      {/* Highlight glow behind the final stage */}
      {last ? (
        <div
          style={{
            position: 'absolute',
            left: barCenter - barW(last.value) / 2 - barH * 0.18,
            top: barY(lastIdx) - barH * 0.18,
            width: barW(last.value) + barH * 0.36,
            height: barH * 1.36,
            borderRadius: radius + barH * 0.18,
            background: withAlpha(theme.accent, 0.35),
            opacity: glow,
          }}
        />
      ) : null}

      {stages.map((s, i) => {
        const start = stageStart(i);
        const isLast = i === lastIdx;
        const grow = Math.min(1, springIn(frame, fps, start, 'smooth'));
        const w = barW(s.value);
        const p = progress(frame, start, countDur, 'out');
        const shown = formatNumber(Math.round(s.value * p), {grouping: true});
        const color = isLast ? theme.accent : theme.text;
        return (
          <div key={`${s.label}-${i}`}>
            <div
              style={{
                position: 'absolute',
                left: barCenter - w / 2,
                top: barY(i),
                width: w,
                height: barH,
                borderRadius: radius,
                background: isLast ? theme.accent : theme.primary,
                transform: `scaleX(${grow})`,
                transformOrigin: 'center',
                opacity: progress(frame, start, 6),
              }}
            />
            <Box x={funnelBox.x} y={rowY(i)} width={labelW} height={rowH}>
              <Reveal delay={start} effect={['fade', 'slide-left']}>
                <FitText text={s.label} width={labelW} height={rowH} maxLines={2} maxFontSize={labelSize} align="right" font="body" weight={isLast ? 800 : 700} color={isLast ? theme.accent : theme.mutedText} />
              </Reveal>
            </Box>
            <Box x={countX} y={rowY(i)} width={countW} height={rowH}>
              <Reveal delay={start} effect={['fade', 'slide-right']}>
                <FitText text={shown} width={countW} height={rowH} maxLines={1} maxFontSize={countSize} align="left" weight={800} tabular color={color} />
              </Reveal>
            </Box>
          </div>
        );
      })}

      {/* Step conversion badges */}
      {stages.slice(0, -1).map((s, i) => {
        const next = stages[i + 1]!;
        const pct = s.value > 0 ? formatPct((next.value / s.value) * 100) : '–';
        const measured = measureLine(pct, badgeH * 0.44, theme.fontBody, 700) + badgeH * 1.8;
        const bw = Math.min(measured, barColW);
        const cy = rowY(i) + rowH + gapH / 2;
        return (
          <Box key={`b${i}`} x={barCenter - bw / 2} y={cy - badgeH / 2} width={bw} height={badgeH}>
            <Badge text={pct} icon="arrow-down" height={badgeH} maxWidth={bw} delay={stageStart(i + 1) + 6} color={theme.surface} textColor={theme.text} bordered />
          </Box>
        );
      })}

      <Box {...overallBox}>
        <KineticText
          text={overall}
          width={overallBox.width}
          height={overallBox.height}
          maxLines={1}
          weight={800}
          color={theme.text}
          delay={overallStart}
          each={3}
          effect="up"
          highlight={highlight}
          highlightStyle="color"
          highlightColor={theme.accent}
          emphasisScale={1.15}
        />
      </Box>
    </>
  );
}
