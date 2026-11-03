import {
  Box,
  Card,
  Counter,
  FitText,
  Progress,
  Reveal,
  contentBox,
  isWide,
  progress,
  sliceTop,
  splitRow,
  type GraphicProps,
} from '@finalpost/motion';
import {useCurrentFrame} from 'remotion';

type Content = {value: number; suffix?: string; label: string};

export default function Graphic({width, height, durationInFrames, theme, safeArea, content}: GraphicProps<Content>) {
  const frame = useCurrentFrame();
  const {value, suffix, label} = content!;
  const box = contentBox(width, height, safeArea, Math.min(width, height) * 0.03);
  const pad = Math.min(box.width, box.height) * 0.07;
  const inner = contentBox(box.width, box.height, {top: 0, right: 0, bottom: 0, left: 0}, pad);
  const wide = isWide(box.width, box.height);

  // Timing scales with duration
  const fillStart = 6;
  const fillDur = Math.max(20, Math.round(durationInFrames * 0.5));
  const t = progress(frame, fillStart, fillDur);
  const target = Math.max(0, Math.min(1, value / 100));

  // Layout: ring + number on the left/top, label below (or beside when wide)
  const [topArea, labelArea] = sliceTop(inner, 0.68, inner.height * 0.04);
  const [ringBox, numBox] = wide
    ? splitRow(topArea, 2, topArea.width * 0.04)
    : [
        {x: topArea.x, y: topArea.y, width: topArea.width, height: topArea.height},
        {x: topArea.x, y: topArea.y, width: topArea.width, height: topArea.height},
      ];
  const ringSize = Math.min(ringBox!.width, ringBox!.height);
  const ringX = ringBox!.x + (ringBox!.width - ringSize) / 2;
  const ringY = ringBox!.y + (ringBox!.height - ringSize) / 2;

  const numW = wide ? numBox!.width : ringSize * 0.64;
  const numH = ringSize * 0.34;
  const numX = wide ? numBox!.x : ringX + (ringSize - numW) / 2;
  const numY = wide ? numBox!.y + (numBox!.height - numH) / 2 : ringY + (ringSize - numH) / 2;
  const counterW = wide ? numW : numW;

  return (
    <>
      <Box x={box.x} y={box.y} width={box.width} height={box.height}>
        <Reveal effect={['fade', 'scale']} duration={12}>
          <Card width={box.width} height={box.height} variant="solid" color={theme.surface} borderColor={theme.primary} borderWidth={2} radius={Math.min(theme.radius, box.height * 0.1)}>
            <div />
          </Card>
        </Reveal>
      </Box>
      <Box x={box.x + ringX} y={box.y + ringY} width={ringSize} height={ringSize}>
        <Reveal effect={['fade']} duration={8}>
          <Progress variant="ring" value={target * t} width={ringSize} height={ringSize} thickness={ringSize * 0.1} color={theme.accent} />
        </Reveal>
      </Box>
      <Box x={box.x + numX} y={box.y + numY} width={counterW} height={numH}>
        <Counter
          from={0}
          to={value}
          suffix={suffix}
          decimals={0}
          delay={fillStart}
          duration={fillDur}
          width={counterW}
          height={numH}
          color={theme.text}
          weight={900}
        />
      </Box>
      <Box x={box.x + labelArea.x} y={box.y + labelArea.y} width={labelArea.width} height={labelArea.height}>
        <Reveal delay={14} effect={['fade', 'slide-up']}>
          <FitText
            text={label}
            width={labelArea.width}
            height={labelArea.height}
            maxLines={2}
            font="body"
            weight={700}
            color={theme.mutedText}
          />
        </Reveal>
      </Box>
    </>
  );
}
