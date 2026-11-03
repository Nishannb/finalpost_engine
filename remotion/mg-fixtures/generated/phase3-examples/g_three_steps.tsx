import {interpolateColors, useCurrentFrame} from 'remotion';
import {
  Arrow,
  Background,
  Box,
  Card,
  FitText,
  Icon,
  Reveal,
  contentBox,
  fitTextGroup,
  isWide,
  progress,
  sliceTop,
  splitColumn,
  splitRow,
  springIn,
  withAlpha,
  type GraphicProps,
} from '@finalpost/motion';

type Content = {
  title: string;
  steps: {label: string}[];
  stepTimesSec: number[];
};

// Decorative icons only (no copy): record, edit, publish.
const STEP_ICONS = ['video', 'wand', 'share'] as const;

export default function Graphic({width, height, durationInFrames, fps, theme, safeArea, content}: GraphicProps<Content>) {
  const frame = useCurrentFrame();
  const {title, steps, stepTimesSec} = content!;
  const n = Math.max(1, steps.length);

  // ---- Layout ----
  const box = contentBox(width, height, safeArea, Math.min(width, height) * 0.05);
  const wide = isWide(width, height);
  const [titleBox, body] = sliceTop(box, wide ? 0.15 : 0.1, box.height * 0.04);
  const gap = wide ? body.width * 0.08 : body.height * 0.07;
  const cells = wide ? splitRow(body, n, gap) : splitColumn(body, n, gap);

  const cell0 = cells[0]!;
  const cardW = cell0.width;
  const cardH = wide ? Math.min(cell0.height, cell0.width * 1.45) : cell0.height;
  const pad = Math.min(cardW, cardH) * 0.08;
  const iconD = Math.min(cardW * 0.46, cardH * 0.4);
  const innerGap = cardH * 0.05;
  const labelW = cardW - pad * 2;
  const labelH = Math.max(20, cardH - iconD - pad * 2 - innerGap);
  const labelSize = fitTextGroup(
    steps.map((s) => s.label),
    {width: labelW, height: labelH, maxLines: 2, font: theme.fontBody, weight: 700},
  );
  const radius = Math.max(8, theme.radius * (Math.min(width, height) / 1080) * 1.4);

  const cardRects = cells.map((c) => ({
    x: c.x,
    y: c.y + (c.height - cardH) / 2,
    width: cardW,
    height: cardH,
  }));

  // ---- Timing (absolute, from content) ----
  const maxStart = Math.max(0, durationInFrames - 10);
  const times = steps.map((_, i) => {
    const sec = stepTimesSec[i];
    const fallback = durationInFrames * (0.08 + (0.6 * i) / Math.max(1, n - 1));
    const f = sec !== undefined ? Math.round(sec * fps) : Math.round(fallback);
    return Math.min(maxStart, Math.max(0, f));
  });

  const strokeW = Math.max(4, Math.min(width, height) * 0.008);

  return (
    <>
      <Background variant="gradient" />

      <Box {...titleBox}>
        <Reveal effect={['fade', 'slide-down']} duration={10}>
          <FitText
            text={title}
            width={titleBox.width}
            height={titleBox.height}
            maxLines={1}
            maxFontSize={titleBox.height * 0.6}
            weight={800}
            color={theme.mutedText}
            uppercase
            letterSpacing={0.06}
          />
        </Reveal>
      </Box>

      {/* Arrows between steps, in region coordinates */}
      {cardRects.slice(0, -1).map((r, i) => {
        const next = cardRects[i + 1]!;
        const t = times[i + 1] ?? maxStart;
        const from = wide
          ? {x: r.x + r.width + gap * 0.12, y: r.y + pad + iconD / 2}
          : {x: r.x + r.width / 2, y: r.y + r.height + gap * 0.12};
        const to = wide
          ? {x: next.x - gap * 0.12, y: next.y + pad + iconD / 2}
          : {x: next.x + next.width / 2, y: next.y - gap * 0.12};
        return (
          <Arrow
            key={`arrow-${i}`}
            from={from}
            to={to}
            delay={Math.max(0, t - 8)}
            duration={8}
            strokeWidth={strokeW}
            headSize={gap * 0.32}
            color={theme.accent}
            head="triangle"
          />
        );
      })}

      {steps.map((step, i) => {
        const r = cardRects[i]!;
        const t = times[i] ?? maxStart;
        const nextT = times[i + 1];
        const lit = Math.min(1, Math.max(0, springIn(frame, fps, t, 'snappy')));
        const emph = progress(frame, t, 8) - (nextT !== undefined ? progress(frame, nextT, 10) : 0);
        const done = nextT !== undefined ? Math.min(1, Math.max(0, springIn(frame, fps, nextT, 'bouncy'))) : 0;

        const scale = (0.9 + 0.1 * lit) * (1 + 0.06 * emph);
        const opacity = 0.22 + lit * 0.78 * (0.7 + 0.3 * emph);
        const borderColor = interpolateColors(emph, [0, 1], [withAlpha(theme.text, 0.14), theme.accent]);
        const circleFill = interpolateColors(
          emph,
          [0, 1],
          [withAlpha(theme.primary, 0.12 + 0.18 * lit), theme.accent],
        );
        const checkD = iconD * 0.36;

        return (
          <Box key={`step-${i}`} {...r}>
            <Reveal effect={['fade', 'slide-up']} delay={i * 3} duration={10}>
              <div
                style={{
                  width: r.width,
                  height: r.height,
                  opacity,
                  transform: `scale(${scale})`,
                  transformOrigin: 'center center',
                  position: 'relative',
                }}>
                <Card
                  width={r.width}
                  height={r.height}
                  variant="solid"
                  color={theme.surface}
                  borderColor={borderColor}
                  borderWidth={Math.max(3, strokeW * 0.8)}
                  radius={radius}
                  padding={pad}>
                  <div
                    style={{
                      width: iconD,
                      height: iconD,
                      borderRadius: iconD / 2,
                      background: circleFill,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      marginBottom: innerGap,
                    }}>
                    <Icon name={STEP_ICONS[i % STEP_ICONS.length]!} size={iconD * 0.5} color={theme.text} strokeWidth={2.4} />
                  </div>
                  <FitText
                    text={step.label}
                    width={labelW}
                    height={labelH}
                    maxLines={2}
                    maxFontSize={labelSize}
                    font="body"
                    weight={700}
                    color={lit > 0.5 ? theme.text : theme.mutedText}
                  />
                </Card>
                {done > 0.01 ? (
                  <div
                    style={{
                      position: 'absolute',
                      left: r.width - checkD - pad * 0.5,
                      top: pad * 0.5,
                      width: checkD,
                      height: checkD,
                      borderRadius: checkD / 2,
                      background: theme.success,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transform: `scale(${done})`,
                    }}>
                    <Icon name="check" size={checkD * 0.62} color={theme.background} strokeWidth={3} />
                  </div>
                ) : null}
              </div>
            </Reveal>
          </Box>
        );
      })}
    </>
  );
}
