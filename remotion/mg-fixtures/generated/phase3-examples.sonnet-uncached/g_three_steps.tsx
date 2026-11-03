import {useCurrentFrame} from 'remotion';
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
  withAlpha,
  type GraphicProps,
} from '@finalpost/motion';

type Content = {
  title: string;
  steps: {label: string}[];
  stepTimesSec?: number[];
};

const ICONS = ['video', 'wand', 'share', 'rocket', 'check'] as const;

export default function Graphic({width, height, durationInFrames, fps, theme, safeArea, content}: GraphicProps<Content>) {
  const frame = useCurrentFrame();
  const {title, steps, stepTimesSec} = content!;
  const n = Math.max(1, steps.length);
  const wide = isWide(width, height);

  const box = contentBox(width, height, safeArea, Math.min(width, height) * 0.04);
  const [titleBox, body] = sliceTop(box, wide ? 0.12 : 0.09, box.height * 0.03);

  // Step activation frames (from content, clamped into the graphic).
  const times = steps.map((_, i) => {
    const sec = stepTimesSec?.[i];
    const f = sec === undefined ? Math.round(durationInFrames * (0.08 + 0.3 * i)) : Math.round(sec * fps);
    return Math.max(0, Math.min(durationInFrames - 12, f));
  });

  // Card rectangles.
  const gap = wide ? Math.max(56, body.width * 0.07) : Math.max(56, body.height * 0.07);
  type R = {x: number; y: number; width: number; height: number};
  let rects: R[] = [];
  if (wide) {
    const cw = (body.width - gap * (n - 1)) / n;
    const ch = Math.min(body.height, cw * 1.35);
    const y = body.y + (body.height - ch) / 2;
    rects = steps.map((_, i) => ({x: body.x + i * (cw + gap), y, width: cw, height: ch}));
  } else {
    const rh = Math.min((body.height - gap * (n - 1)) / n, body.width * 0.4);
    const total = rh * n + gap * (n - 1);
    const y0 = body.y + (body.height - total) / 2;
    rects = steps.map((_, i) => ({x: body.x, y: y0 + i * (rh + gap), width: body.width, height: rh}));
  }
  void splitColumn;

  const r0 = rects[0]!;
  const pad = Math.min(r0.width, r0.height) * 0.08;
  const iconCircle = wide ? Math.min(r0.width * 0.42, r0.height * 0.36) : r0.height * 0.62;
  const labelW = wide ? r0.width - pad * 2 : r0.width - iconCircle - pad * 3;
  const labelH = wide ? r0.height - iconCircle - pad * 3 : r0.height - pad * 2;
  const labelSize = fitTextGroup(steps.map((s) => s.label), {
    width: labelW,
    height: labelH,
    maxLines: 2,
    font: theme.fontBody,
    weight: 800,
  });

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
            color={theme.mutedText}
            uppercase
            letterSpacing={0.06}
          />
        </Reveal>
      </Box>

      {rects.slice(0, -1).map((r, i) => {
        const nx = rects[i + 1]!;
        const from = wide
          ? {x: r.x + r.width + 8, y: r.y + r.height / 2}
          : {x: r.x + r.width / 2, y: r.y + r.height + 6};
        const to = wide
          ? {x: nx.x - 8, y: nx.y + nx.height / 2}
          : {x: nx.x + nx.width / 2, y: nx.y - 6};
        return (
          <Arrow
            key={`a${i}`}
            from={from}
            to={to}
            delay={Math.max(0, times[i + 1]! - 6)}
            duration={10}
            strokeWidth={Math.max(6, Math.min(width, height) * 0.011)}
            color={theme.accent}
          />
        );
      })}

      {steps.map((step, i) => {
        const r = rects[i]!;
        const t = times[i]!;
        const next = i + 1 < n ? times[i + 1]! : undefined;
        const appear = progress(frame, t, 10);
        const done = next === undefined ? 0 : progress(frame, next, 10);
        const active = appear * (1 - done);
        const scale = 1 + 0.06 * active;
        const dim = 1 - 0.22 * done;
        const checkSize = Math.min(r.width, r.height) * 0.2;
        const iconName = ICONS[i % ICONS.length]!;
        return (
          <Box key={`${step.label}-${i}`} {...r}>
            <Reveal delay={t} effect={['fade', 'pop']}>
              <div style={{width: r.width, height: r.height, transform: `scale(${scale})`, opacity: dim, position: 'relative'}}>
                <Card
                  width={r.width}
                  height={r.height}
                  variant="soft"
                  color={theme.surface}
                  borderColor={active > 0.5 ? theme.accent : withAlpha(theme.text, 0.15)}
                  borderWidth={active > 0.5 ? 5 : 2}
                  padding={0}>
                  <div
                    style={{
                      width: r.width,
                      height: r.height,
                      display: 'flex',
                      flexDirection: wide ? 'column' : 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: pad,
                      padding: pad,
                      boxSizing: 'border-box',
                    }}>
                    <div
                      style={{
                        width: iconCircle,
                        height: iconCircle,
                        flexShrink: 0,
                        borderRadius: iconCircle / 2,
                        position: 'relative',
                        background: withAlpha(theme.primary, 0.3),
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}>
                      <div
                        style={{
                          position: 'absolute',
                          left: 0,
                          top: 0,
                          width: iconCircle,
                          height: iconCircle,
                          borderRadius: iconCircle / 2,
                          background: theme.accent,
                          opacity: active,
                        }}
                      />
                      <div style={{position: 'relative', display: 'flex'}}>
                        <Icon name={iconName} size={iconCircle * 0.55} color={theme.text} strokeWidth={2.4} />
                      </div>
                    </div>
                    <FitText
                      text={step.label}
                      width={labelW}
                      height={labelH}
                      maxLines={2}
                      maxFontSize={labelSize}
                      font="body"
                      weight={800}
                      align={wide ? 'center' : 'left'}
                      color={active > 0.5 ? theme.text : theme.mutedText}
                    />
                  </div>
                </Card>
                <div
                  style={{
                    position: 'absolute',
                    right: -checkSize * 0.25,
                    top: -checkSize * 0.25,
                    width: checkSize,
                    height: checkSize,
                    borderRadius: checkSize / 2,
                    background: theme.success,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transform: `scale(${done})`,
                  }}>
                  <Icon name="check" size={checkSize * 0.65} color={theme.background} strokeWidth={3.5} />
                </div>
              </div>
            </Reveal>
          </Box>
        );
      })}
    </>
  );
}
