import {
  Arrow,
  Background,
  Box,
  Counter,
  FitText,
  KineticText,
  LineChart,
  Reveal,
  contentBox,
  isWide,
  sliceTop,
  splitRow,
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
  const {label, currency, unit, from, to, years, series, caption} = content!;
  const box = contentBox(width, height, safeArea, Math.min(width, height) * 0.05);
  const wide = isWide(width, height);
  const gap = Math.max(8, box.height * 0.02);

  let numbersArea = box;
  let chartAreaAll = box;
  if (wide) {
    const [l, r] = splitRow(box, 2, box.width * 0.06);
    numbersArea = l!;
    chartAreaAll = r!;
  }

  // Numbers column: label, old figure, new figure
  const [labelBox, afterLabel] = sliceTop(numbersArea, wide ? 0.12 : 0.06, gap);
  const [oldBox, afterOld] = sliceTop(afterLabel, wide ? 0.2 : 0.1, gap * 2.5);
  const bigBox = wide ? afterOld : sliceTop(afterOld, 0.3, gap)[0];

  // Chart column: chart, years, caption
  const chartTop = wide ? chartAreaAll : sliceTop(afterOld, 0.3, gap)[1];
  const [chartPlusYears, captionBox] = sliceTop(chartTop, wide ? 0.72 : 0.8, gap);
  const [chartBox, yearsBox] = sliceTop(chartPlusYears, 0.9, 4);
  const [yearL, yearR] = splitRow(yearsBox, 2, yearsBox.width * 0.2);

  const d = durationInFrames;
  const bigDelay = Math.round(d * 0.14);
  const bigDur = Math.round(d * 0.4);
  const chartDelay = Math.round(d * 0.3);
  const chartDur = Math.round(d * 0.5);
  const capDelay = Math.round(d * 0.72);

  const money = {prefix: currency, suffix: unit, decimals: 0};
  const endLabel = `${currency}${to}${unit}`;
  const data = series.map((value, i) => ({label: years[i] ?? '', value}));
  const firstWord = caption.split(' ')[0] ?? '';
  const cx = oldBox.x + oldBox.width / 2;

  return (
    <>
      <Background variant="spotlight" accent={theme.success} />
      <Box {...labelBox}>
        <Reveal effect={['fade', 'slide-down']}>
          <FitText text={label} width={labelBox.width} height={labelBox.height} maxLines={1} weight={800} color={theme.mutedText} uppercase letterSpacing={0.08} />
        </Reveal>
      </Box>
      <Box {...oldBox}>
        <Reveal delay={4} effect={['fade', 'scale']}>
          <Counter from={from} to={from} width={oldBox.width} height={oldBox.height} {...money} color={theme.mutedText} weight={700} />
        </Reveal>
      </Box>
      <Arrow
        from={{x: cx, y: oldBox.y + oldBox.height + 4}}
        to={{x: cx, y: bigBox.y + Math.min(bigBox.height * 0.08, gap * 2)}}
        delay={Math.round(d * 0.08)}
        duration={Math.max(8, Math.round(d * 0.08))}
        strokeWidth={Math.max(6, Math.min(width, height) * 0.01)}
        color={theme.accent}
      />
      <Box {...bigBox}>
        <Reveal delay={bigDelay} effect={['fade', 'scale']} spring="bouncy">
          <Counter from={from} to={to} delay={bigDelay} duration={bigDur} width={bigBox.width} height={bigBox.height} {...money} color={theme.success} weight={900} />
        </Reveal>
      </Box>
      <Box {...chartBox}>
        <LineChart data={data} width={chartBox.width} height={chartBox.height} delay={chartDelay} duration={chartDur} endLabel={endLabel} color={theme.success} min={0} />
      </Box>
      <Box {...yearL!}>
        <Reveal delay={chartDelay}>
          <FitText text={years[0] ?? ''} width={yearL!.width} height={yearL!.height} maxLines={1} font="body" weight={600} align="left" color={theme.mutedText} />
        </Reveal>
      </Box>
      <Box {...yearR!}>
        <Reveal delay={chartDelay + Math.round(chartDur * 0.8)}>
          <FitText text={years[years.length - 1] ?? ''} width={yearR!.width} height={yearR!.height} maxLines={1} font="body" weight={600} align="right" color={theme.text} />
        </Reveal>
      </Box>
      <Box {...captionBox}>
        <KineticText
          text={caption}
          width={captionBox.width}
          height={captionBox.height}
          maxLines={2}
          weight={800}
          font="display"
          color={theme.text}
          delay={capDelay}
          each={4}
          effect="up"
          highlight={firstWord ? [firstWord] : []}
          highlightStyle="color"
          highlightColor={theme.accent}
          emphasisScale={1.12}
        />
      </Box>
    </>
  );
}
