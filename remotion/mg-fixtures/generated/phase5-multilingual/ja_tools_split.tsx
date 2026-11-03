import {interpolate, useCurrentFrame} from 'remotion';
import {
  Background,
  Box,
  Card,
  FitText,
  Icon,
  Reveal,
  contentBox,
  fitTextGroup,
  sliceTop,
  splitColumn,
  springIn,
  withAlpha,
  type GraphicProps,
} from '@finalpost/motion';

type Content = {title: string; items: string[]; note?: string};

const ICONS = ['sparkles', 'film', 'layers'] as const;

export default function Graphic({width, height, durationInFrames, fps, theme, safeArea, content}: GraphicProps<Content>) {
  const frame = useCurrentFrame();
  const {title, items, note} = content!;
  const n = Math.max(1, items.length);

  // Layout derived from the region and safe area.
  const box = contentBox(width, height, safeArea, Math.min(width, height) * 0.05);
  const hasNote = Boolean(note && note.length > 0);
  const [titleBox, rest] = sliceTop(box, 0.16, box.height * 0.03);
  const [listBox, noteBox] = sliceTop(rest, hasNote ? 0.8 : 1, rest.height * 0.04);
  const rows = splitColumn(listBox, n, listBox.height * 0.07);
  const rowW = rows[0]!.width;
  const rowH = rows[0]!.height;

  const radius = Math.max(8, theme.radius * (width / 1080));
  const pad = Math.min(rowH * 0.22, rowW * 0.04);
  const rankSize = rowH * 0.62;
  const iconSize = rowH * 0.46;
  const gap = Math.max(10, rowH * 0.2);
  const labelW = Math.max(40, rowW - pad * 2 - rankSize - iconSize - gap * 2);
  const labelH = rowH * 0.7;
  const labelSize = fitTextGroup(items, {width: labelW, height: labelH, maxLines: 1, font: theme.fontBody, weight: 800});

  // Timing as fractions of the duration.
  const firstRow = Math.max(4, Math.round(durationInFrames * 0.1));
  const each = Math.max(4, Math.round((durationInFrames * 0.3) / Math.max(1, n - 1)));
  const rowAt = (i: number) => firstRow + i * each;
  const noteAt = Math.round(durationInFrames * 0.55);
  const emphAt = Math.round(durationInFrames * 0.6);

  // The row the note refers to (if any) gets an accent outline once the note appears.
  const noteText = note ?? '';
  const emphIndex = hasNote
    ? items.findIndex((it) => {
        const first = it.split(' ')[0] ?? '';
        return first.length > 0 && noteText.includes(first);
      })
    : -1;
  const emph = interpolate(frame, [emphAt, emphAt + 10], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  const barH = Math.max(4, height * 0.006);

  return (
    <>
      <Background variant="gradient" />
      <Box x={titleBox.x} y={titleBox.y} width={titleBox.width} height={titleBox.height - barH * 2}>
        <Reveal effect={['fade', 'slide-down']} duration={12}>
          <FitText
            text={title}
            width={titleBox.width}
            height={titleBox.height - barH * 2}
            maxLines={1}
            align="left"
            weight={800}
            color={theme.text}
          />
        </Reveal>
      </Box>
      <Box x={titleBox.x} y={titleBox.y + titleBox.height - barH} width={titleBox.width * 0.3} height={barH}>
        <Reveal effect="grow-x" delay={4} duration={14}>
          <div style={{width: titleBox.width * 0.3, height: barH, borderRadius: barH / 2, background: theme.accent}} />
        </Reveal>
      </Box>
      {items.map((item, i) => {
        const row = rows[i]!;
        const pop = springIn(frame, fps, rowAt(i) + 3, 'bouncy');
        const isTop = i === 0;
        const isEmph = i === emphIndex;
        const borderColor = isEmph ? withAlpha(theme.accent, emph) : withAlpha(theme.text, 0.08);
        return (
          <Box key={`${i}-${item}`} {...row}>
            <Reveal delay={rowAt(i)} duration={12} effect={['fade', 'slide-left']}>
              <Card
                width={row.width}
                height={row.height}
                variant="soft"
                radius={radius}
                padding={0}
                borderColor={borderColor}
                borderWidth={Math.max(2, rowH * 0.035)}
              >
                <div
                  style={{
                    width: row.width,
                    height: row.height,
                    boxSizing: 'border-box',
                    paddingLeft: pad,
                    paddingRight: pad,
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap,
                  }}
                >
                  <div
                    style={{
                      width: rankSize,
                      height: rankSize,
                      flexShrink: 0,
                      borderRadius: rankSize / 2,
                      background: isTop ? theme.accent : withAlpha(theme.primary, 0.3),
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transform: `scale(${pop})`,
                    }}
                  >
                    <FitText
                      text={String(i + 1)}
                      width={rankSize * 0.6}
                      height={rankSize * 0.6}
                      maxLines={1}
                      weight={900}
                      tabular
                      color={isTop ? theme.background : theme.text}
                    />
                  </div>
                  <div style={{width: iconSize, height: iconSize, flexShrink: 0, display: 'flex'}}>
                    <Icon name={ICONS[i % ICONS.length]!} size={iconSize} color={isEmph && emph > 0.5 ? theme.accent : theme.secondary} strokeWidth={2.4} />
                  </div>
                  <FitText
                    text={item}
                    width={labelW}
                    height={labelH}
                    maxLines={1}
                    maxFontSize={labelSize}
                    align="left"
                    font="body"
                    weight={800}
                    color={theme.text}
                  />
                </div>
              </Card>
            </Reveal>
          </Box>
        );
      })}
      {hasNote && noteBox ? (
        <Box {...noteBox}>
          <Reveal delay={noteAt} duration={12} effect={['fade', 'slide-up']}>
            <FitText
              text={noteText}
              width={noteBox.width}
              height={noteBox.height}
              maxLines={1}
              font="body"
              weight={700}
              color={theme.mutedText}
            />
          </Reveal>
        </Box>
      ) : null}
    </>
  );
}
