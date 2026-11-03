// Example task 3: "Full-screen animated statistic showing $2M → $10M with an
// upward trend chart." Two counters, an arrow, a drawn trend line.
import {
  Arrow,
  Background,
  Box,
  Counter,
  FitText,
  LineChart,
  Reveal,
  contentBox,
  isWide,
  sliceTop,
  splitRow,
  type GraphicProps,
} from '@finalpost/motion';

type Content = {title: string; from: number; to: number; trend: number[]; caption: string};

export default function Graphic({width, height, theme, safeArea, content}: GraphicProps<Content>) {
  const {title, from, to, trend, caption} = content!;
  const box = contentBox(width, height, safeArea, Math.min(width, height) * 0.05);
  const [titleBox, rest] = sliceTop(box, 0.12, 16);
  const [numbersBox, chartArea] = sliceTop(rest, isWide(width, height) ? 0.32 : 0.26, 16);
  const [chartBox, captionBox] = sliceTop(chartArea, 0.8, 12);
  const [left, right] = splitRow(numbersBox, 2, numbersBox.width * 0.18);
  const money = {prefix: '$', suffix: 'M', decimals: 0};

  return (
    <>
      <Background variant="spotlight" accent={theme.success} />
      <Box {...titleBox}>
        <Reveal>
          <FitText text={title} width={titleBox.width} height={titleBox.height} maxLines={1} weight={800} color={theme.mutedText} uppercase letterSpacing={0.06} />
        </Reveal>
      </Box>
      <Box {...left!}>
        <Reveal delay={4} effect={['fade', 'scale']}>
          <Counter from={from} to={from} width={left!.width} height={left!.height} {...money} color={theme.mutedText} />
        </Reveal>
      </Box>
      <Arrow
        from={{x: left!.x + left!.width + 10, y: numbersBox.y + numbersBox.height / 2}}
        to={{x: right!.x - 10, y: numbersBox.y + numbersBox.height / 2}}
        delay={12}
        duration={10}
        strokeWidth={10}
        color={theme.accent}
      />
      <Box {...right!}>
        <Reveal delay={18} effect={['fade', 'scale']} spring="bouncy">
          <Counter from={from} to={to} delay={18} duration={40} width={right!.width} height={right!.height} {...money} color={theme.success} />
        </Reveal>
      </Box>
      <Box {...chartBox}>
        <LineChart data={trend} width={chartBox.width} height={chartBox.height} delay={18} duration={44} endLabel={`$${to}M`} />
      </Box>
      <Box {...captionBox}>
        <Reveal delay={56}>
          <FitText text={caption} width={captionBox.width} height={captionBox.height} maxLines={2} font="body" weight={600} color={theme.text} />
        </Reveal>
      </Box>
    </>
  );
}
