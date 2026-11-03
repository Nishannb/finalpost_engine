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
  const wide = isWide(width, height);
  const pad = Math.min(width, height) * 0.05;
  const box = contentBox(width, height, safeArea, pad);

  const countDelay = Math.round(durationInFrames * 0.1);
  const countDur = Math.round(durationInFrames * 0.35);
  const chartDelay = Math.round(durationInFrames * 0.3);
  const chartDur = Math.round(durationInFrames * 0.45);
  const captionDelay = Math.round(durationInFrames * 0.72);

  const [labelBox, rest] = sliceTop(box, 0.07, box.height * 0.015);
  const [numbersBox, rest2] = sliceTop(rest, wide ? 0.34 : 0.28, box.height * 0.02);
  const [chartArea, captionBox] = sliceTop(rest2, 0.8, box.height * 0.02);
  const [yearsBox, chartBoxOnly] = [
    {x: chartArea.x, y: chartArea.y + chartArea.height * 0.88, width: chartArea.width, height: chartArea.height * 0.12},
    {x: chartArea.x, y: chartArea.y, width: chartArea.width, height: chartArea.height * 0.86},
  ];
  const [oldBox, newBox] = splitRow(numbersBox, 2, numbersBox.width * 0.14);
  // Make the new figure take more space than the old one
  const oldW = numbersBox.width * 0.26;
  const gap = numbersBox.width * 0.08;
  const oldR = {x: numbersBox.x, y: numbersBox.y + numbersBox.height * 0.3, width: oldW, height: numbersBox.height * 0.4};
  const newR = {
    x: numbersBox.x + oldW + gap,
    y: numbersBox.y,
    width: numbersBox.width - oldW - gap,
    height: numbersBox.height,
  };
  void oldBox;
  void newBox;

  const yearCount = Math.max(1, years.length);
  const yearW = chartBoxOnly.width / yearCount;
  const fmt = {prefix: currency, suffix: unit, decimals: 0};

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
            font="body"
          />
        </Reveal>
      </Box>

      <Box {...oldR}>
        <Reveal delay={2} effect={['fade', 'slide-right']}>
          <Counter
            from={from}
            to={from}
            width={oldR.width}
            height={oldR.height}
            {...fmt}
            color={theme.mutedText}
            weight={700}
          />
        </Reveal>
      </Box>
      <Arrow
        from={{x: oldR.x + oldR.width + gap * 0.1, y: numbersBox.y + numbersBox.height / 2}}
        to={{x: newR.x - gap * 0.1, y: numbersBox.y + numbersBox.height / 2}}
        delay={countDelay}
        duration={10}
        strokeWidth={Math.max(6, width * 0.008)}
        color={theme.accent}
      />
      <Box {...newR}>
        <Reveal delay={countDelay} effect={['fade', 'scale']} spring="bouncy">
          <Counter
            from={from}
            to={to}
            delay={countDelay}
            duration={countDur}
            width={newR.width}
            height={newR.height}
            {...fmt}
            color={theme.success}
            weight={900}
          />
        </Reveal>
      </Box>

      <Box {...chartBoxOnly}>
        <LineChart
          data={series}
          width={chartBoxOnly.width}
          height={chartBoxOnly.height}
          delay={chartDelay}
          duration={chartDur}
          color={theme.success}
          endLabel={`${currency}${to}${unit}`}
          showPoints
        />
      </Box>

      {years.map((y, i) => (
        <Box key={`${y}-${i}`} x={yearsBox.x + i * yearW} y={yearsBox.y} width={yearW} height={yearsBox.height}>
          <Reveal delay={chartDelay + Math.round((chartDur * i) / yearCount)} effect={['fade']}>
            <FitText
              text={y}
              width={yearW}
              height={yearsBox.height}
              maxLines={1}
              font="body"
              weight={600}
              color={i === yearCount - 1 ? theme.text : theme.mutedText}
              maxFontSize={Math.max(26, height * 0.022)}
              minFontSize={12}
              tabular
            />
          </Reveal>
        </Box>
      ))}

      <Box {...captionBox}>
        <Reveal delay={captionDelay} effect={['fade', 'slide-up']} spring="bouncy">
          <FitText
            text={caption}
            width={captionBox.width}
            height={captionBox.height}
            maxLines={1}
            weight={800}
            color={theme.accent}
            font="display"
          />
        </Reveal>
      </Box>
    </>
  );
}
