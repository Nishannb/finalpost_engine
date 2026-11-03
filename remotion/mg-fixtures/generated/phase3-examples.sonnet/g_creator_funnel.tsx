import {useCurrentFrame} from 'remotion';
import {
  Background,
  Badge,
  Box,
  Counter,
  FitText,
  KineticText,
  Reveal,
  Card,
  contentBox,
  fitTextGroup,
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

const pctText = (num: number, den: number): string => {
  if (!den) return '0%';
  const r = Math.round((num / den) * 1000) / 10;
  return `${r}%`;
};

export default function Graphic({width, height, durationInFrames, theme, safeArea, content}: GraphicProps<Content>) {
  const frame = useCurrentFrame();
  const {title, stages, overall} = content!;
  const n = Math.max(1, stages.length);

  const pad = Math.min(width, height) * 0.04;
  const box = contentBox(width, height, safeArea, pad);
  const gap = box.height * 0.02;
  const [titleBox, rest] = sliceTop(box, 0.1, gap);

  const calloutH = rest.height * 0.17;
  const area = {x: rest.x, y: rest.y, width: rest.width, height: rest.height - calloutH - gap};
  const calloutY = area.y + area.height + gap;

  // Rows: n stages and n-1 gaps (gap = 0.55 * stage height)
  const h = area.height / (n + (n - 1) * 0.55);
  const g = h * 0.55;
  const barH = h * 0.72;

  // Columns: label | funnel | count
  const labelW = box.width * 0.27;
  const countW = box.width * 0.25;
  const colGap = box.width * 0.02;
  const fx = box.x + labelW + colGap;
  const fw = box.width - labelW - countW - colGap * 2;
  const cx = fx + fw / 2;
  const countX = fx + fw + colGap;

  const maxVal = Math.max(1, ...stages.map((s) => s.value));
  const widthOf = (v: number) => Math.max(10, (fw * v) / maxVal);

  const startOf = (i: number) => Math.round(durationInFrames * 0.08 + i * durationInFrames * 0.15);
  const growDur = Math.max(8, Math.round(durationInFrames * 0.1));
  const countDur = Math.max(12, Math.round(durationInFrames * 0.18));
  const overallAt = Math.round(durationInFrames * 0.74);

  const labelSize = fitTextGroup(
    stages.map((s) => s.label),
    {width: labelW, height: barH, maxLines: 2, font: theme.fontBody, weight: 700},
  );

  const rowY = (i: number) => area.y + i * (h + g);
  const lastIdx = n - 1;
  const overallToken = overall.split(' ')[0] ?? '';

  return (
    <>
      <Background variant="gradient" />
      <Box {...titleBox}>
        <Reveal effect={['fade', 'slide-down']}>
          <FitText
            text={title}
            width={titleBox.width}
            height={titleBox.height}
            maxLines={1}
            weight={800}
            align="left"
            color={theme.mutedText}
            uppercase
            letterSpacing={0.05}
          />
        </Reveal>
      </Box>

      {/* funnel connectors */}
      <svg width={width} height={height} style={{position: 'absolute', left: 0, top: 0}}>
        {stages.slice(0, -1).map((s, i) => {
          const next = stages[i + 1]!;
          const w1 = widthOf(s.value);
          const w2 = widthOf(next.value);
          const y1 = rowY(i) + (h + barH) / 2;
          const y2 = rowY(i + 1) + (h - barH) / 2;
          const t = progress(frame, startOf(i + 1), growDur);
          return (
            <polygon
              key={`c-${i}`}
              points={`${cx - w1 / 2},${y1} ${cx + w1 / 2},${y1} ${cx + w2 / 2},${y2} ${cx - w2 / 2},${y2}`}
              fill={withAlpha(i + 1 === lastIdx ? theme.accent : theme.primary, 0.22)}
              opacity={t}
            />
          );
        })}
      </svg>

      {stages.map((s, i) => {
        const isLast = i === lastIdx;
        const color = isLast ? theme.accent : theme.primary;
        const start = startOf(i);
        const t = progress(frame, start, growDur, 'outExpo');
        const w = widthOf(s.value) * t;
        const y = rowY(i);
        return (
          <div key={`s-${i}`}>
            <div
              style={{
                position: 'absolute',
                left: cx - w / 2,
                top: y + (h - barH) / 2,
                width: w,
                height: barH,
                borderRadius: Math.min(barH * 0.25, 14),
                background: color,
                opacity: Math.min(1, t * 2),
              }}
            />
            <Box x={box.x} y={y + (h - barH) / 2} width={labelW} height={barH}>
              <Reveal delay={start} effect={['fade', 'slide-right']}>
                <FitText
                  text={s.label}
                  width={labelW}
                  height={barH}
                  maxLines={2}
                  maxFontSize={labelSize}
                  align="left"
                  font="body"
                  weight={isLast ? 900 : 700}
                  color={isLast ? theme.accent : theme.text}
                />
              </Reveal>
            </Box>
            <Box x={countX} y={y + (h - barH) / 2} width={countW} height={barH}>
              <Reveal delay={start} effect={['fade']}>
                <Counter
                  to={s.value}
                  width={countW}
                  height={barH}
                  delay={start}
                  duration={countDur}
                  align="right"
                  color={isLast ? theme.accent : theme.text}
                />
              </Reveal>
            </Box>
          </div>
        );
      })}

      {/* step conversion badges */}
      {stages.slice(1).map((s, k) => {
        const i = k + 1;
        const prev = stages[i - 1]!;
        const badgeH = Math.min(g * 0.9, 60);
        const by = rowY(i - 1) + h + (g - badgeH) / 2;
        return (
          <Box key={`b-${i}`} x={fx} y={by} width={fw} height={badgeH}>
            <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', width: fw, height: badgeH}}>
              <Badge
                text={pctText(s.value, prev.value)}
                icon="arrow-down"
                height={badgeH}
                maxWidth={fw}
                delay={startOf(i) + Math.round(growDur * 0.6)}
                bordered
              />
            </div>
          </Box>
        );
      })}

      {/* overall callout */}
      <Box x={box.x} y={calloutY} width={box.width} height={calloutH}>
        <Reveal delay={overallAt} effect={['fade', 'scale']} spring="bouncy">
          <Card
            width={box.width}
            height={calloutH}
            variant="outline"
            borderColor={theme.accent}
            borderWidth={4}
            color={withAlpha(theme.accent, 0.14)}
            padding={calloutH * 0.12}>
            <KineticText
              text={overall}
              width={box.width - calloutH * 0.4}
              height={calloutH * 0.72}
              maxLines={1}
              weight={900}
              delay={overallAt + 4}
              highlight={overallToken ? [overallToken] : []}
              highlightStyle="color"
              highlightColor={theme.accent}
              emphasisScale={1.12}
            />
          </Card>
        </Reveal>
      </Box>
    </>
  );
}
