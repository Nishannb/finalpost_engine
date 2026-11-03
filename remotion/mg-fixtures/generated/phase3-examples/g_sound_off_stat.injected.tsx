import {useCurrentFrame} from 'remotion';
import {
  Box,
  Card,
  Counter,
  FitText,
  Progress,
  Reveal,
  contentBox,
  isWide,
  keyframes,
  progress,
  sliceTop,
  withAlpha,
  type GraphicProps,
} from '@finalpost/motion';

type Content = {value: number; suffix: string; label: string};

const jitter = Math.random();

export default function Graphic({width, height, durationInFrames, theme, safeArea, content}: GraphicProps<Content>) {
  const frame = useCurrentFrame();
  const {value, suffix, label} = content!;
  const minDim = Math.min(width, height);

  // Card occupies the safe content area of the PiP region.
  const box = contentBox(width, height, safeArea, minDim * 0.03);
  const radius = Math.min(theme.radius, minDim * 0.08);
  const pad = Math.min(box.width, box.height) * 0.08;
  const inner = {
    x: box.x + pad,
    y: box.y + pad,
    width: Math.max(1, box.width - pad * 2),
    height: Math.max(1, box.height - pad * 2),
  };

  // Layout: ring beside the label when landscape-ish, stacked otherwise.
  const wide = isWide(width, height);
  let ringArea: {x: number; y: number; width: number; height: number};
  let labelBox: {x: number; y: number; width: number; height: number};
  if (wide) {
    const gap = inner.width * 0.06;
    const side = Math.min(inner.height, inner.width * 0.5);
    ringArea = {x: inner.x, y: inner.y, width: side, height: inner.height};
    labelBox = {
      x: inner.x + side + gap,
      y: inner.y,
      width: Math.max(1, inner.width - side - gap),
      height: inner.height,
    };
  } else {
    const [top, rest] = sliceTop(inner, 0.72, inner.height * 0.04);
    ringArea = top;
    labelBox = rest;
  }

  const ring = Math.min(ringArea.width, ringArea.height);
  const ringX = ringArea.x + (ringArea.width - ring) / 2;
  const ringY = ringArea.y + (ringArea.height - ring) / 2;

  // Timing as fractions of the duration.
  const fillStart = 6;
  const fillDur = Math.max(12, Math.round(durationInFrames * 0.45));
  const fillEnd = fillStart + fillDur;
  const labelDelay = Math.round(durationInFrames * 0.3);

  const target = Math.max(0, Math.min(1, value / 100));
  const ringValue = target * progress(frame, fillStart, fillDur, 'out');
  const pop = keyframes(frame, [fillEnd, fillEnd + 5, fillEnd + 14], [1, 1.08, 1]);

  const numW = ring * 0.62;
  const numH = ring * 0.34;

  return (
    <>
      <Box {...box}>
        <Reveal effect={['fade', 'scale']} duration={10}>
          <Card
            width={box.width}
            height={box.height}
            variant="solid"
            color={theme.surface}
            radius={radius}
            borderColor={withAlpha(theme.text, 0.12)}
            borderWidth={Math.max(1, minDim * 0.004)}
          />
        </Reveal>
      </Box>

      <Box x={ringX} y={ringY} width={ring} height={ring}>
        <Reveal delay={3} effect={['fade', 'scale']}>
          <Progress
            variant="ring"
            value={ringValue}
            width={ring}
            height={ring}
            thickness={ring * 0.1}
            color={theme.accent}
            trackColor={withAlpha(theme.text, 0.14)}
          />
        </Reveal>
      </Box>

      <Box x={ringX + (ring - numW) / 2} y={ringY + (ring - numH) / 2} width={numW} height={numH}>
        <Reveal delay={4} effect="fade">
          <div style={{transform: `scale(${pop})`, width: numW, height: numH}}>
            <Counter frm={0}
              from={0}
              to={value}
              suffix={suffix}
              decimals={0}
              delay={fillStart}
              duration={fillDur}
              width={numW}
              height={numH}
              weight={900}
              color={theme.accent}
            />
          </div>
        </Reveal>
      </Box>

      <Box {...labelBox}>
        <Reveal delay={labelDelay} effect={['fade', 'slide-up']}>
          <FitText
            text={label}
            width={labelBox.width}
            height={labelBox.height}
            maxLines={2}
            font="body"
            weight={700}
            color={theme.text}
            align={wide ? 'left' : 'center'}
            minFontSize={14}
          />
        </Reveal>
      </Box>
      <svg width={1} height={1}><defs><linearGradient id="glow" /></defs></svg>
    </>
  );
}
