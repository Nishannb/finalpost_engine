import {interpolateColors, useCurrentFrame} from 'remotion';
import {
  Arrow,
  Background,
  Box,
  Card,
  FitText,
  Icon,
  KineticText,
  Reveal,
  contentBox,
  fitTextGroup,
  isWide,
  sliceTop,
  splitColumn,
  splitRow,
  springIn,
  withAlpha,
  type GraphicProps,
} from '@finalpost/motion';

type Content = {title: string; steps: string[]};

export default function Graphic({width, height, durationInFrames, fps, theme, safeArea, content}: GraphicProps<Content>) {
  const frame = useCurrentFrame();
  const {title, steps} = content!;
  const n = Math.max(1, steps.length);
  const wide = isWide(width, height);

  // Layout
  const box = contentBox(width, height, safeArea, Math.min(width, height) * 0.05);
  const [titleBox, body] = sliceTop(box, wide ? 0.18 : 0.12, box.height * 0.04);
  const gap = wide ? body.width * 0.09 : body.height * 0.07;
  const cards = wide ? splitRow(body, n, gap) : splitColumn(body, n, gap);
  const scale = width / 1080;
  const radius = Math.max(8, theme.radius * scale);

  // Per-card inner geometry
  const first = cards[0]!;
  const pad = Math.min(first.width, first.height) * 0.08;
  const circle = wide
    ? Math.min(first.width * 0.3, first.height * 0.24)
    : Math.min(first.height * 0.6, first.width * 0.18);
  const labelW = wide ? first.width - pad * 2 : first.width - pad * 3 - circle;
  const labelH = wide ? first.height - pad * 2.6 - circle : first.height - pad * 2;
  const lineHeight = 1.35;
  // Measure group size with default line height, compensate for the taller Devanagari line height.
  const labelSize = fitTextGroup(steps, {
    width: labelW,
    height: labelH * (1.15 / lineHeight),
    maxLines: wide ? 4 : 2,
    font: theme.fontBody,
    weight: 700,
  });

  // Timing: fractions of duration
  const firstAt = Math.round(durationInFrames * 0.16);
  const lastAt = Math.round(durationInFrames * 0.64);
  const at = (i: number) => Math.round(firstAt + ((lastAt - firstAt) * i) / Math.max(1, n - 1));

  const arrowStroke = Math.max(4, gap * 0.08);

  return (
    <>
      <Background variant="gradient" />
      <Box {...titleBox}>
        <KineticText
          text={title}
          width={titleBox.width}
          height={titleBox.height}
          maxLines={2}
          weight={800}
          lineHeight={1.3}
          each={3}
        />
      </Box>

      {steps.map((step, i) => {
        const c = cards[i]!;
        const lit = Math.min(1, Math.max(0, springIn(frame, fps, at(i), 'snappy')));
        const pop = springIn(frame, fps, at(i), 'bouncy');
        const border = interpolateColors(lit, [0, 1], [withAlpha(theme.text, 0.15), theme.accent]);
        const labelColor = interpolateColors(lit, [0, 1], [theme.mutedText, theme.text]);
        const circleX = wide ? (c.width - circle) / 2 : pad;
        const circleY = wide ? pad : (c.height - circle) / 2;
        const labelX = wide ? pad : pad * 2 + circle;
        const labelY = wide ? pad * 1.6 + circle : pad;
        return (
          <Box key={i} {...c}>
            <Reveal delay={3 + i * 4} effect={['fade', wide ? 'slide-up' : 'slide-left']}>
              <div
                style={{
                  position: 'relative',
                  width: c.width,
                  height: c.height,
                  opacity: 0.6 + 0.4 * lit,
                  transform: `scale(${1 + 0.04 * lit})`,
                }}>
                <Card
                  width={c.width}
                  height={c.height}
                  variant="solid"
                  color={theme.surface}
                  radius={radius}
                  borderColor={border}
                  borderWidth={Math.max(3, 5 * scale)}
                />
                <Box x={circleX} y={circleY} width={circle} height={circle}>
                  <div
                    style={{
                      width: circle,
                      height: circle,
                      borderRadius: circle / 2,
                      boxSizing: 'border-box',
                      border: `${Math.max(3, circle * 0.07)}px solid ${border}`,
                      background: withAlpha(theme.accent, lit),
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                    <div style={{transform: `scale(${Math.max(0, pop)})`, display: 'flex'}}>
                      <Icon name="check" size={circle * 0.55} color={theme.background} strokeWidth={3} />
                    </div>
                  </div>
                </Box>
                <Box x={labelX} y={labelY} width={labelW} height={labelH}>
                  <FitText
                    text={step}
                    width={labelW}
                    height={labelH}
                    maxLines={wide ? 4 : 2}
                    maxFontSize={labelSize}
                    font="body"
                    weight={700}
                    lineHeight={lineHeight}
                    align={wide ? 'center' : 'left'}
                    verticalAlign={wide ? 'top' : 'center'}
                    color={labelColor}
                  />
                </Box>
              </div>
            </Reveal>
          </Box>
        );
      })}

      {cards.slice(0, -1).map((a, i) => {
        const b = cards[i + 1]!;
        const delay = at(i) + 3;
        const duration = Math.max(4, at(i + 1) - at(i) - 4);
        const from = wide
          ? {x: a.x + a.width + gap * 0.18, y: a.y + a.height / 2}
          : {x: a.x + a.width / 2, y: a.y + a.height + gap * 0.15};
        const to = wide
          ? {x: b.x - gap * 0.18, y: b.y + b.height / 2}
          : {x: b.x + b.width / 2, y: b.y - gap * 0.15};
        return (
          <Arrow
            key={`arrow-${i}`}
            from={from}
            to={to}
            delay={delay}
            duration={duration}
            color={theme.accent}
            strokeWidth={arrowStroke}
            headSize={gap * 0.3}
          />
        );
      })}
    </>
  );
}
