import {useCurrentFrame} from 'remotion';
import {
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
  withAlpha,
  type GraphicProps,
} from '@finalpost/motion';

type Content = {title: string; items: string[]; note?: string};

const ICONS = ['sparkles', 'film', 'scissors', 'video', 'wand'] as const;

export default function Graphic({width, height, durationInFrames, theme, safeArea, content}: GraphicProps<Content>) {
  const frame = useCurrentFrame();
  const {title, items, note} = content!;
  const n = Math.max(1, items.length);
  const pad = Math.min(width, height) * 0.04;
  const box = contentBox(width, height, safeArea, pad);
  const wide = isWide(width, height);

  const [titleBox, afterTitle] = sliceTop(box, 0.16, box.height * 0.03);
  const hasNote = Boolean(note);
  const [listArea, noteBox] = hasNote ? sliceTop(afterTitle, 0.78, afterTitle.height * 0.04) : [afterTitle, afterTitle];
  const gap = Math.min(listArea.width, listArea.height) * 0.04;
  const cells = wide && n > 1 ? splitRow(listArea, n, gap) : splitColumn(listArea, n, gap);

  const first = cells[0]!;
  const rankW = Math.min(first.height, first.width) * (wide ? 0.28 : 0.6);
  const iconSize = Math.min(first.height, first.width) * (wide ? 0.3 : 0.45);
  const labelW = wide ? first.width - 32 : first.width - rankW - iconSize - 80;
  const labelH = wide ? first.height * 0.3 : first.height * 0.7;
  const size = fitTextGroup(items, {width: Math.max(40, labelW), height: labelH, maxLines: 2, font: theme.fontBody, weight: 800});

  const stepGap = Math.max(6, Math.round(durationInFrames * 0.12));
  const startAt = Math.round(durationInFrames * 0.1);
  const bar = progress(frame, 4, 18);

  return (
    <>
      <Background variant="gradient" />
      <Box {...titleBox}>
        <Reveal effect={['fade', 'slide-down']}>
          <FitText text={title} width={titleBox.width} height={titleBox.height} maxLines={1} weight={800} align="left" />
        </Reveal>
      </Box>
      <svg width={width} height={height} style={{position: 'absolute', left: 0, top: 0}}>
        <rect
          x={titleBox.x}
          y={titleBox.y + titleBox.height + 2}
          width={titleBox.width * bar}
          height={Math.max(4, height * 0.005)}
          rx={3}
          fill={theme.accent}
        />
      </svg>
      {items.map((item, i) => {
        const cell = cells[i]!;
        const delay = startAt + i * stepGap;
        const isTop = i === 0;
        const iconName = ICONS[i % ICONS.length]!;
        const accent = isTop ? theme.accent : theme.primary;
        return (
          <Box key={`${item}-${i}`} {...cell}>
            <Reveal delay={delay} effect={['fade', 'slide-left']}>
              <Card
                width={cell.width}
                height={cell.height}
                variant="glass"
                borderColor={withAlpha(accent, 0.6)}
                borderWidth={2}
                padding={16}>
                {wide ? (
                  <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: cell.height * 0.05, width: '100%'}}>
                    <FitText text={`${i + 1}`} width={rankW} height={rankW} maxLines={1} weight={900} tabular color={accent} />
                    <Icon name={iconName} size={iconSize} color={accent} strokeWidth={2.5} />
                    <FitText text={item} width={labelW} height={labelH} maxLines={2} maxFontSize={size} font="body" weight={800} />
                  </div>
                ) : (
                  <div style={{display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 20, width: '100%'}}>
                    <div style={{width: rankW, flexShrink: 0}}>
                      <FitText text={`${i + 1}`} width={rankW} height={rankW} maxLines={1} weight={900} tabular color={accent} />
                    </div>
                    <Icon name={iconName} size={iconSize} color={accent} strokeWidth={2.5} />
                    <FitText text={item} width={Math.max(40, labelW)} height={labelH} maxLines={2} maxFontSize={size} align="left" font="body" weight={800} />
                  </div>
                )}
              </Card>
            </Reveal>
          </Box>
        );
      })}
      {hasNote ? (
        <Box {...noteBox}>
          <Reveal delay={startAt + n * stepGap} effect={['fade', 'slide-up']}>
            <FitText text={note!} width={noteBox.width} height={noteBox.height} maxLines={1} font="body" weight={700} color={theme.accent} />
          </Reveal>
        </Box>
      ) : null}
    </>
  );
}
