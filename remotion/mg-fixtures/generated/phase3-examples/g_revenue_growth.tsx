import {useCurrentFrame} from 'remotion';
import {
  Background,
  Box,
  Counter,
  FitText,
  KineticText,
  Line,
  LineChart,
  Reveal,
  contentBox,
  fitTextBlock,
  isWide,
  keyframes,
  progress,
  sliceTop,
  type GraphicProps,
} from '@finalpost/motion';

type Content = {
  label: string;
  currency: string;
  unit: string;
  from: number;
  to: number;
  years: string[];
  series: number[];
  caption: string;
};

export default function Graphic({width, height, durationInFrames, theme, safeArea, content}: GraphicProps<Content>) {
  const frame = useCurrentFrame();
  const {label, currency, unit, from, to, years, series, caption} = content!;
  const d = durationInFrames;
  const wide = isWide(width, height);

  // Layout
  const box = contentBox(width, height, safeArea, Math.min(width, height) * 0.05);
  const gap = box.height * 0.02;
  const [labelBox, rest] = sliceTop(box, wide ? 0.1 : 0.07, gap);

  let oldBox: {x: number; y: number; width: number; height: number};
  let bigBox: {x: number; y: number; width: number; height: number};
  let below: {x: number; y: number; width: number; height: number};

  if (wide) {
    const [numbers, after] = sliceTop(rest, 0.36, gap);
    const oldW = numbers.width * 0.3;
    const g = numbers.width * 0.05;
    oldBox = {x: numbers.x, y: numbers.y + numbers.height * 0.3, width: oldW, height: numbers.height * 0.4};
    bigBox = {x: numbers.x + oldW + g, y: numbers.y, width: numbers.width - oldW - g, height: numbers.height};
    below = after;
  } else {
    const [o, r2] = sliceTop(rest, 0.08, gap * 0.5);
    const [b, r3] = sliceTop(r2, 0.24, gap);
    oldBox = o;
    bigBox = b;
    below = r3;
  }
  const [chartBox, captionBox] = sliceTop(below, wide ? 0.72 : 0.8, gap);

  // Timing (fractions of duration)
  const oldIn = 4;
  const strikeAt = Math.round(d * 0.14);
  const countStart = Math.round(d * 0.16);
  const countDur = Math.max(12, Math.round(d * 0.34));
  const countEnd = countStart + countDur;
  const chartStart = Math.round(d * 0.22);
  const chartDur = Math.max(14, Math.round(d * 0.42));
  const captionAt = Math.round(d * 0.62);

  // Celebratory pop when the count lands
  const pop = keyframes(frame, [countEnd, countEnd + 5, countEnd + 14], [1, 1.08, 1]);

  // Old figure: measured so the strike-through matches its width
  const oldText = `${currency}${from}${unit}`;
  const oldFit = fitTextBlock({
    text: oldText,
    width: oldBox.width,
    height: oldBox.height,
    maxLines: 1,
    font: theme.fontDisplay,
    weight: 800,
  });
  const strikeHalf = Math.min(oldBox.width, oldFit.width) / 2 + oldFit.fontSize * 0.08;
  const oldCx = oldBox.x + oldBox.width / 2;
  const oldCy = oldBox.y + oldBox.height / 2;
  const oldDim = 1 - 0.35 * progress(frame, strikeAt, 10);

  // Chart data
  const data = series.map((value, i) => ({label: years[i] ?? '', value}));
  const endLabel = `${currency}${to}${unit}`;

  // Emphasis on the multiple
  const ratio = from !== 0 ? Math.round((to / from) * 10) / 10 : 0;
  const multiple = `${ratio}×`;

  return (
    <>
      <Background variant="spotlight" accent={theme.success} />

      <Box {...labelBox}>
        <Reveal effect={['fade', 'slide-down']}>
          <FitText
            text={label}
            width={labelBox.width}
            height={labelBox.height}
            maxLines={1}
            weight={800}
            color={theme.mutedText}
            uppercase
            letterSpacing={0.08}
          />
        </Reveal>
      </Box>

      <Box {...oldBox}>
        <Reveal delay={oldIn} effect={['fade', 'slide-up']}>
          <div style={{opacity: oldDim}}>
            <FitText
              text={oldText}
              width={oldBox.width}
              height={oldBox.height}
              maxLines={1}
              maxFontSize={oldFit.fontSize}
              weight={800}
              color={theme.mutedText}
              tabular
            />
          </div>
        </Reveal>
      </Box>
      <Line
        from={{x: oldCx - strikeHalf, y: oldCy}}
        to={{x: oldCx + strikeHalf, y: oldCy}}
        color={theme.mutedText}
        strokeWidth={Math.max(3, oldFit.fontSize * 0.07)}
        delay={strikeAt}
        duration={10}
      />

      <Box {...bigBox}>
        <Reveal delay={countStart - 4} effect={['fade', 'scale']} spring="bouncy">
          <div style={{transform: `scale(${pop})`, transformOrigin: '50% 50%'}}>
            <Counter
              from={from}
              to={to}
              delay={countStart}
              duration={countDur}
              prefix={currency}
              suffix={unit}
              decimals={0}
              width={bigBox.width}
              height={bigBox.height}
              weight={900}
              color={theme.success}
            />
          </div>
        </Reveal>
      </Box>

      <Box {...chartBox}>
        <Reveal delay={chartStart - 4} effect="fade">
          <LineChart
            data={data}
            width={chartBox.width}
            height={chartBox.height}
            color={theme.success}
            area
            showPoints
            endLabel={endLabel}
            delay={chartStart}
            duration={chartDur}
            strokeWidth={Math.max(4, width * 0.008)}
          />
        </Reveal>
      </Box>

      <Box {...captionBox}>
        <KineticText
          text={caption}
          width={captionBox.width}
          height={captionBox.height}
          maxLines={2}
          font="body"
          weight={700}
          color={theme.text}
          mode="words"
          effect="up"
          delay={captionAt}
          each={4}
          highlight={[multiple]}
          highlightStyle="color"
          highlightColor={theme.accent}
          emphasisScale={1.15}
        />
      </Box>
    </>
  );
}
