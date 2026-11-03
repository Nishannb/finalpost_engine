import {useCurrentFrame} from 'remotion';
import {
  Arrow,
  Background,
  Box,
  FitText,
  Icon,
  Reveal,
  contentBox,
  fitTextGroup,
  lerp,
  progress,
  sliceTop,
  splitColumn,
  splitRow,
  withAlpha,
  type GraphicProps,
} from '@finalpost/motion';

type Content = {
  title: string;
  steps: {label: string}[];
  stepTimesSec: number[];
};

const ICONS = ['video', 'wand', 'share'] as const;
const FALLBACK_ICON = 'sparkles';

export default function Graphic({width, height, durationInFrames, fps, theme, safeArea, content}: GraphicProps<Content>) {
  const frame = useCurrentFrame();
  const {title, steps, stepTimesSec} = content!;
  const n = Math.max(1, steps.length);

  const pad = Math.min(width, height) * 0.04;
  const box = contentBox(width, height, safeArea, pad);
  const rowMode = width > height * 1.5;

  const [titleBox, body] = sliceTop(box, 0.1, box.height * 0.03);
  const gap = rowMode ? body.width * 0.09 : body.height * 0.085;
  const rects = rowMode ? splitRow(body, n, gap) : splitColumn(body, n, gap);

  // Activation frames, in the order given; never earlier than the previous step.
  const times: number[] = steps.map((_, i) => {
    const sec = stepTimesSec[i] ?? 0.4 + i * 1.5;
    return Math.max(0, Math.min(durationInFrames - 1, Math.round(sec * fps)));
  });

  // Shared label size.
  const sample = rects[0]!;
  const labelW = rowMode ? sample.width * 0.88 : sample.width * 0.58;
  const labelH = rowMode ? sample.height * 0.32 : sample.height * 0.62;
  const labels = steps.map((s) => s.label);
  const labelSize = fitTextGroup(labels.length ? labels : [' '], {
    width: labelW,
    height: labelH,
    maxLines: 2,
    font: theme.fontBody,
    weight: 800,
  });

  const arrowStroke = Math.max(5, Math.min(10, gap * 0.16));

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
            weight={700}
            font="display"
            color={theme.mutedText}
          />
        </Reveal>
      </Box>

      {steps.map((step, i) => {
        const r = rects[i]!;
        const t = times[i]!;
        const tNext = i + 1 < steps.length ? times[i + 1]! : Number.POSITIVE_INFINITY;
        const act = progress(frame, t, 10);
        const done = Number.isFinite(tNext) ? progress(frame, tNext, 10) : 0;
        const opacity = lerp(0.4, 1, act) * lerp(1, 0.82, done);
        const scale = 1 + 0.045 * act * (1 - done);

        const accentColor = done > 0.5 ? theme.success : act > 0.01 ? theme.accent : theme.mutedText;
        const borderColor = act < 0.01 ? withAlpha(theme.text, 0.15) : done > 0.5 ? withAlpha(theme.success, 0.6) : theme.accent;
        const radius = Math.min(r.width, r.height) * 0.14;
        const bw = Math.max(3, Math.min(r.width, r.height) * 0.025) * (1 + act * (1 - done));

        const p = Math.min(r.width, r.height) * 0.12;
        const dot = rowMode ? Math.min(r.width * 0.5, r.height * 0.42) : r.height - p * 2;
        const dotX = rowMode ? (r.width - dot) / 2 : p;
        const dotY = p;
        const textX = rowMode ? r.width * 0.06 : p * 2 + dot;
        const textY = rowMode ? dotY + dot + p * 0.6 : p;
        const textW = rowMode ? r.width * 0.88 : r.width - textX - p;
        const textH = rowMode ? r.height - textY - p : r.height - p * 2;
        const badge = dot * 0.36;

        return (
          <Box key={`${step.label}-${i}`} {...r}>
            <Reveal delay={i * 4} effect={['fade', 'slide-up']}>
              <div
                style={{
                  position: 'relative',
                  width: r.width,
                  height: r.height,
                  boxSizing: 'border-box',
                  borderRadius: radius,
                  border: `${bw}px solid ${borderColor}`,
                  background: withAlpha(theme.surface, 0.55 + 0.4 * act),
                  opacity,
                  transform: `scale(${scale})`,
                }}>
                <Box x={dotX - bw} y={dotY - bw} width={dot} height={dot}>
                  <div
                    style={{
                      width: dot,
                      height: dot,
                      borderRadius: dot / 2,
                      background: withAlpha(accentColor, 0.18),
                      border: `${Math.max(3, dot * 0.04)}px solid ${accentColor}`,
                      boxSizing: 'border-box',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                    <Icon name={ICONS[i] ?? FALLBACK_ICON} size={dot * 0.52} color={accentColor} strokeWidth={2.5} />
                  </div>
                </Box>
                <Box x={dotX - bw + dot - badge * 0.9} y={dotY - bw + dot - badge * 0.9} width={badge} height={badge}>
                  <div
                    style={{
                      width: badge,
                      height: badge,
                      borderRadius: badge / 2,
                      background: theme.success,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: done,
                      transform: `scale(${lerp(0.4, 1, done)})`,
                    }}>
                    <Icon name="check" size={badge * 0.66} color={theme.background} strokeWidth={4} />
                  </div>
                </Box>
                <Box x={textX - bw} y={textY - bw} width={textW} height={textH}>
                  <FitText
                    text={step.label}
                    width={textW}
                    height={textH}
                    maxLines={2}
                    maxFontSize={labelSize}
                    font="body"
                    weight={800}
                    align={rowMode ? 'center' : 'left'}
                    verticalAlign={rowMode ? 'top' : 'center'}
                    color={act < 0.01 ? theme.mutedText : theme.text}
                  />
                </Box>
              </div>
            </Reveal>
          </Box>
        );
      })}

      {steps.slice(0, -1).map((_, i) => {
        const a = rects[i]!;
        const b = rects[i + 1]!;
        const start = Math.max(0, times[i + 1]! - 10);
        const from = rowMode
          ? {x: a.x + a.width + gap * 0.12, y: a.y + a.height / 2}
          : {x: a.x + a.width / 2, y: a.y + a.height + gap * 0.12};
        const to = rowMode
          ? {x: b.x - gap * 0.12, y: b.y + b.height / 2}
          : {x: b.x + b.width / 2, y: b.y - gap * 0.12};
        return (
          <Arrow
            key={`arrow-${i}`}
            from={from}
            to={to}
            delay={start}
            duration={10}
            strokeWidth={arrowStroke}
            color={theme.accent}
          />
        );
      })}
    </>
  );
}
