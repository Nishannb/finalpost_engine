import {useCurrentFrame} from 'remotion';
import {
  Background,
  Badge,
  Box,
  Card,
  Counter,
  FitText,
  KineticText,
  Reveal,
  contentBox,
  fitTextGroup,
  formatNumber,
  measureLine,
  progress,
  sliceTop,
  withAlpha,
  type GraphicProps,
} from '@finalpost/motion';

type Content = {
  title: string;
  stages: {label: string; value: number}[];
  overall: string;
};

export default function Graphic({width, height, durationInFrames, theme, safeArea, content}: GraphicProps<Content>) {
  const frame = useCurrentFrame();
  const {title, stages, overall} = content!;
  const n = Math.max(1, stages.length);
  const maxValue = Math.max(1, ...stages.map((s) => s.value));

  const pad = Math.min(width, height) * 0.04;
  const box = contentBox(width, height, safeArea, pad);
  const [titleBox, rest] = sliceTop(box, 0.1, box.height * 0.02);

  // Bottom call-out and funnel area
  const overallH = rest.height * 0.14;
  const overallGap = rest.height * 0.03;
  const overallRect = {x: rest.x, y: rest.y + rest.height - overallH, width: rest.width, height: overallH};
  const funnel = {x: rest.x, y: rest.y, width: rest.width, height: rest.height - overallH - overallGap};

  // Rows: each stage = text strip + bar, with a gap that holds the conversion badge
  const gh = funnel.height * 0.11;
  const rh = (funnel.height - (n - 1) * gh) / n;
  const th = rh * 0.5;
  const bh = rh - th;
  const cx = funnel.x + funnel.width / 2;

  const stageStart = (i: number) => Math.round(durationInFrames * 0.06 + i * durationInFrames * 0.17);

  const labelW = funnel.width * 0.58;
  const countW = funnel.width * 0.38;
  const labelSize = fitTextGroup(
    stages.map((s) => s.label),
    {width: labelW, height: th, maxLines: 1, font: theme.fontBody, weight: 700},
  );

  const badgeH = Math.max(30, gh * 0.9);

  return (
    <>
      <Background variant="grid" />
      <Box {...titleBox}>
        <Reveal effect={['fade', 'slide-down']}>
          <FitText text={title} width={titleBox.width} height={titleBox.height} maxLines={1} weight={800} color={theme.text} />
        </Reveal>
      </Box>

      {stages.map((s, i) => {
        const y = funnel.y + i * (rh + gh);
        const start = stageStart(i);
        const isLast = i === n - 1;
        const color = isLast ? theme.accent : theme.primary;
        const full = funnel.width * (s.value / maxValue);
        const barW = Math.max(8, full) * progress(frame, start + 2, 18);
        const barY = y + th;
        return (
          <Box key={`${s.label}-${i}`} x={0} y={0} width={width} height={height}>
            <Reveal delay={start} effect={['fade']} duration={10}>
              <div
                style={{
                  position: 'absolute',
                  left: funnel.x,
                  top: y,
                  width: labelW,
                  height: th,
                }}>
                <FitText
                  text={s.label}
                  width={labelW}
                  height={th}
                  maxLines={1}
                  maxFontSize={labelSize}
                  align="left"
                  font="body"
                  weight={isLast ? 900 : 700}
                  color={isLast ? theme.accent : theme.text}
                />
              </div>
              <div
                style={{
                  position: 'absolute',
                  left: funnel.x + funnel.width - countW,
                  top: y,
                  width: countW,
                  height: th,
                }}>
                <Counter
                  to={s.value}
                  delay={start}
                  duration={Math.round(durationInFrames * 0.16)}
                  width={countW}
                  height={th}
                  align="right"
                  color={isLast ? theme.accent : theme.text}
                />
              </div>
            </Reveal>
            {isLast ? (
              <div
                style={{
                  position: 'absolute',
                  left: cx - (barW + bh * 0.5) / 2,
                  top: barY - bh * 0.25,
                  width: barW + bh * 0.5,
                  height: bh * 1.5,
                  borderRadius: bh,
                  background: withAlpha(theme.accent, 0.25 * progress(frame, start + 6, 16)),
                }}
              />
            ) : null}
            <div
              style={{
                position: 'absolute',
                left: cx - barW / 2,
                top: barY,
                width: barW,
                height: bh,
                borderRadius: Math.min(bh * 0.3, 14),
                background: color,
              }}
            />
          </Box>
        );
      })}

      {stages.slice(1).map((s, k) => {
        const i = k + 1;
        const prev = stages[i - 1]!;
        const rate = prev.value > 0 ? (s.value / prev.value) * 100 : 0;
        const rounded = Math.round(rate * 10) / 10;
        const text = formatNumber(rounded, {suffix: '%', decimals: Number.isInteger(rounded) ? 0 : 1});
        const bw = measureLine(text, badgeH * 0.44, theme.fontBody, 700) + badgeH * 1.5;
        const by = funnel.y + i * (rh + gh) - gh + (gh - badgeH) / 2;
        return (
          <Box key={`badge-${i}`} x={cx - bw / 2} y={by} width={bw} height={badgeH}>
            <Badge text={text} icon="arrow-down" height={badgeH} delay={stageStart(i) + 8} bordered />
          </Box>
        );
      })}

      <Box {...overallRect}>
        <Reveal delay={stageStart(n - 1) + Math.round(durationInFrames * 0.12)} effect={['fade', 'scale']} spring="bouncy">
          <Card
            width={overallRect.width}
            height={overallRect.height}
            variant="outline"
            borderColor={theme.accent}
            borderWidth={4}
            padding={12}>
            <KineticText
              text={overall}
              width={overallRect.width - 48}
              height={overallRect.height - 24}
              maxLines={1}
              weight={800}
              highlight={[overall.split(' ')[0] ?? overall]}
              highlightStyle="color"
              highlightColor={theme.accent}
              delay={stageStart(n - 1) + Math.round(durationInFrames * 0.12)}
              each={4}
            />
          </Card>
        </Reveal>
      </Box>
    </>
  );
}
