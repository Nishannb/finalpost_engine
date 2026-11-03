// README §15 example: a checklist that ticks off while a ring fills.
// Not a reference composition; composed from primitives and helpers.
import {interpolate, useCurrentFrame} from 'remotion';
import {
  Background,
  Box,
  FitText,
  Icon,
  KineticText,
  Progress,
  Reveal,
  contentBox,
  fitTextGroup,
  isWide,
  progress,
  sliceTop,
  splitColumn,
  splitRow,
  springIn,
  useSvgId,
  withAlpha,
  type GraphicProps,
} from '@finalpost/motion';

type Content = {title: string; highlight?: string; items: string[]; doneLabel: string};

export default function Graphic({width, height, durationInFrames, fps, theme, safeArea, content}: GraphicProps<Content>) {
  const frame = useCurrentFrame();
  const {title, highlight, items, doneLabel} = content!;
  const n = Math.max(1, items.length);

  // Layout: from the region and safe area only. Row when wide (split half), stacked when tall.
  const box = contentBox(width, height, safeArea, Math.min(width, height) * 0.05);
  const wide = isWide(width, height);
  const [titleBox, body] = sliceTop(box, wide ? 0.24 : 0.16, box.height * 0.04);
  const [listBox, meterBox] = wide ? splitRow(body, 2, body.width * 0.06) : sliceTop(body, 0.6, body.height * 0.06);
  const rows = splitColumn(listBox!, n, listBox!.height * 0.05);
  const rowH = rows[0]!.height;
  const dot = Math.min(rowH * 0.7, listBox!.width * 0.14);

  // Timing: fractions of the duration, so a ±40% change still reads well.
  const firstCheck = Math.round(durationInFrames * 0.2);
  const lastCheck = Math.round(durationInFrames * 0.7);
  const checkAt = (i: number) => Math.round(firstCheck + ((lastCheck - firstCheck) * i) / Math.max(1, n - 1));
  const done = items.filter((_, i) => frame >= checkAt(i)).length;
  const meter = interpolate(frame, [firstCheck, lastCheck + 8], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  // Text: one measured size for every row so the list reads as a set.
  const labelW = rows[0]!.width - dot * 1.4;
  const labelSize = fitTextGroup(items, {width: labelW, height: rowH * 0.9, maxLines: 2, font: theme.fontBody, weight: 700});

  // SVG defs: unique, stable ids.
  const sweep = useSvgId('sweep');
  const ring = Math.min(meterBox!.width, meterBox!.height) * 0.86;
  const ringX = meterBox!.x + (meterBox!.width - ring) / 2;
  const ringY = meterBox!.y + (meterBox!.height - ring) / 2;

  return (
    <>
      <Background variant="gradient" />
      <Box {...titleBox}>
        <KineticText text={title} width={titleBox.width} height={titleBox.height * 0.9} maxLines={2} align="left" weight={800} highlight={highlight ? [highlight] : []} highlightStyle="marker" />
      </Box>
      <svg width={width} height={height} style={{position: 'absolute', left: 0, top: 0}}>
        <defs>
          <linearGradient id={sweep} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor={theme.primary} />
            <stop offset="1" stopColor={theme.accent} />
          </linearGradient>
        </defs>
        <rect x={titleBox.x} y={titleBox.y + titleBox.height} width={titleBox.width * progress(frame, 8, 20)} height={Math.max(4, height * 0.005)} rx={3} fill={`url(#${sweep})`} />
      </svg>
      {items.map((item, i) => {
        const row = rows[i]!;
        const isDone = frame >= checkAt(i);
        const tick = springIn(frame, fps, checkAt(i), 'bouncy');
        return (
          <Box key={item} {...row}>
            <Reveal delay={6 + i * 4} effect={['fade', 'slide-left']}>
              <div style={{display: 'flex', alignItems: 'center', gap: dot * 0.4, height: row.height}}>
                <div
                  style={{
                    width: dot,
                    height: dot,
                    flexShrink: 0,
                    borderRadius: dot / 2,
                    boxSizing: 'border-box',
                    border: `${Math.max(3, dot * 0.08)}px solid ${isDone ? theme.success : withAlpha(theme.text, 0.3)}`,
                    background: withAlpha(theme.success, 0.2 * Math.min(1, tick)),
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                  <div style={{transform: `scale(${tick})`, display: 'flex'}}>
                    <Icon name="check" size={dot * 0.6} color={theme.success} strokeWidth={3} />
                  </div>
                </div>
                <FitText text={item} width={labelW} height={rowH * 0.9} maxLines={2} maxFontSize={labelSize} align="left" font="body" weight={700} color={isDone ? theme.text : theme.mutedText} />
              </div>
            </Reveal>
          </Box>
        );
      })}
      <Box x={ringX} y={ringY} width={ring} height={ring}>
        <Reveal delay={firstCheck - 8} effect={['fade', 'scale']}>
          <Progress variant="ring" value={meter} width={ring} height={ring} thickness={ring * 0.08} color={done === n ? theme.success : theme.primary} />
        </Reveal>
      </Box>
      <Box x={ringX + ring * 0.2} y={ringY + ring * 0.3} width={ring * 0.6} height={ring * 0.26}>
        <FitText text={`${done}/${n}`} width={ring * 0.6} height={ring * 0.26} maxLines={1} weight={900} tabular color={done === n ? theme.success : theme.text} />
      </Box>
      <Box x={ringX + ring * 0.18} y={ringY + ring * 0.58} width={ring * 0.64} height={ring * 0.14}>
        <Reveal delay={lastCheck + 6} effect={['fade', 'slide-up']}>
          <FitText text={doneLabel} width={ring * 0.64} height={ring * 0.14} maxLines={1} font="body" weight={700} color={theme.mutedText} uppercase letterSpacing={0.08} />
        </Reveal>
      </Box>
    </>
  );
}
