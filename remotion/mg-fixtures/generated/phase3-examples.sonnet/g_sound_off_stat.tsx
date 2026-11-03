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
  const pad = Math.min(width, height) * 0.06;
  const box = contentBox(width, height, safeArea, pad);
  const wide = isWide(width, height);

  const fillDuration = Math.max(20, Math.round(durationInFrames * 0.45));
  const fillStart = 6;
  const t = progress(frame, fillStart, fillDuration, 'out');
  const target = Math.max(0, Math.min(1, value / 100));

  const inner = {x: 0, y: 0, width: box.width, height: box.height};
  const gap = box.height * 0.05;

  let ringBox;
  let textBox;
  if (wide) {
    const [a, b] = splitRow(inner, 2, box.width * 0.04);
    ringBox = a!;
    textBox = b!;
  } else {
    const [a, b] = sliceTop(inner, 0.68, gap);
    ringBox = a;
    textBox = b;
  }
  // Wide: ring left, label right. Tall: ring on top, label below.
  const ringSize = Math.min(ringBox.width, ringBox.height);
  const ringX = ringBox.x + (ringBox.width - ringSize) / 2;
  const ringY = ringBox.y + (ringBox.height - ringSize) / 2;
  const numW = ringSize * 0.66;
  const numH = ringSize * 0.34;

  return (
    <Box x={0} y={0} width={width} height={height}>
      <Reveal effect={['fade', 'scale']} duration={12}>
        <Card width={width} height={height} variant="solid" color={theme.surface} padding={0} radius={Math.min(width, height) * 0.08}>
          <Box x={box.x} y={box.y} width={box.width} height={box.height}>
            <Box x={ringX} y={ringY} width={ringSize} height={ringSize}>
              <Progress
                variant="ring"
                value={target * t}
                width={ringSize}
                height={ringSize}
                thickness={ringSize * 0.11}
                color={theme.accent}
              />
            </Box>
            <Box x={ringX + (ringSize - numW) / 2} y={ringY + (ringSize - numH) / 2} width={numW} height={numH}>
              <Counter
                from={0}
                to={value}
                suffix={suffix}
                delay={fillStart}
                duration={fillDuration}
                width={numW}
                height={numH}
                color={theme.text}
                weight={900}
              />
            </Box>
            <Box x={textBox.x} y={textBox.y} width={textBox.width} height={textBox.height}>
              <Reveal delay={14} effect={['fade', 'slide-up']}>
                <FitText
                  text={label}
                  width={textBox.width}
                  height={textBox.height}
                  maxLines={2}
                  font="body"
                  weight={700}
                  color={theme.mutedText}
                  align={wide ? 'left' : 'center'}
                />
              </Reveal>
            </Box>
          </Box>
        </Card>
      </Reveal>
    </Box>
  );
}
