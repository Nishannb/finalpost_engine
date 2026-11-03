import {useCurrentFrame} from 'remotion';
import {
  Arrow,
  Background,
  Box,
  FitText,
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

type Content = {title: string; steps: string[]};

export default function Graphic({width, height, durationInFrames, fps, theme, safeArea, content}: GraphicProps<Content>) {
  const frame = useCurrentFrame();
  const {title, steps} = content!;
  const n = Math.max(1, steps.length);
  const pad = Math.min(width, height) * 0.04;
  const box = contentBox(width, height, safeArea, pad);
  const wide = isWide(width, height);
  const [titleBox, body] = sliceTop(box, 0.16, box.height * 0.03);

  // Layout: each step gets a cell; arrows sit in the gaps between cells.
  const gap = wide ? body.width * 0.07 : body.height * 0.09;
  const cells = wide ? splitRow(body, n, gap) : splitColumn(body, n, gap);

  // Timing as fractions of duration
  const first = Math.round(durationInFrames * 0.14);
  const last = Math.round(durationInFrames * 0.62);
  const actAt = (i: number) => Math.round(first + ((last - first) * i) / Math.max(1, n - 1));

  const cell0 = cells[0]!;
  const badge = Math.min(wide ? cell0.width * 0.28 : cell0.height * 0.5, 84);
  const textW = wide ? cell0.width - pad * 1.2 : cell0.width - badge - pad * 3;
  const textH = wide ? cell0.height - badge - pad * 2 : cell0.height - pad * 1.4;
  const labelSize = fitTextGroup(steps, {
    width: Math.max(40, textW),
    height: Math.max(40, textH),
    maxLines: 4,
    font: theme.fontBody,
    weight: 700,
  });

  return (
    <>
      <Background variant="gradient" />
      <Box {...titleBox}>
        <Reveal effect={['fade', 'slide-down']}>
          <FitText text={title} width={titleBox.width} height={titleBox.height} maxLines={1} weight={800} color={theme.text} />
        </Reveal>
      </Box>
      {cells.map((cell, i) => {
        const active = frame >= actAt(i);
        const s = springIn(frame, fps, actAt(i), 'bouncy');
        const glow = Math.min(1, s);
        const cardFill = active ? withAlpha(theme.primary, 0.28) : withAlpha(theme.surface, 0.9);
        const edge = active ? theme.accent : withAlpha(theme.text, 0.2);
        const num = String(i + 1);
        const circle = (
          <div
            style={{
              width: badge,
              height: badge,
              flexShrink: 0,
              borderRadius: badge / 2,
              background: active ? theme.accent : withAlpha(theme.text, 0.15),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transform: `scale(${active ? 0.9 + 0.1 * glow : 1})`,
            }}>
            <FitText text={num} width={badge * 0.6} height={badge * 0.6} maxLines={1} weight={900} tabular color={active ? theme.background : theme.mutedText} />
          </div>
        );
        const label = (
          <FitText
            text={steps[i]!}
            width={Math.max(40, textW)}
            height={Math.max(40, textH)}
            maxLines={4}
            maxFontSize={labelSize}
            align={wide ? 'center' : 'left'}
            font="body"
            weight={700}
            color={active ? theme.text : theme.mutedText}
          />
        );
        return (
          <Box key={i} {...cell}>
            <Reveal delay={4 + i * 5} effect={['fade', 'slide-up']}>
              <div
                style={{
                  width: cell.width,
                  height: cell.height,
                  boxSizing: 'border-box',
                  borderRadius: theme.radius * (width / 1080) * 0.8,
                  background: cardFill,
                  border: `${Math.max(3, pad * 0.12)}px solid ${edge}`,
                  display: 'flex',
                  flexDirection: wide ? 'column' : 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: pad,
                  padding: pad * 0.6,
                }}>
                {circle}
                {label}
              </div>
            </Reveal>
          </Box>
        );
      })}
      {cells.slice(0, -1).map((cell, i) => {
        const next = cells[i + 1]!;
        const d = actAt(i + 1) - 8;
        const from = wide
          ? {x: cell.x + cell.width + gap * 0.12, y: cell.y + cell.height / 2}
          : {x: cell.x + cell.width / 2, y: cell.y + cell.height + gap * 0.12};
        const to = wide
          ? {x: next.x - gap * 0.12, y: next.y + next.height / 2}
          : {x: next.x + next.width / 2, y: next.y - gap * 0.12};
        const lit = progress(frame, d, 8);
        return (
          <Arrow
            key={`a${i}`}
            from={from}
            to={to}
            delay={Math.max(0, d)}
            duration={10}
            strokeWidth={Math.max(6, pad * 0.2)}
            color={lit > 0 ? theme.accent : theme.mutedText}
            head="triangle"
          />
        );
      })}
    </>
  );
}
