import {
  Background,
  Box,
  Counter,
  FitText,
  Icon,
  KineticText,
  LineChart,
  Reveal,
  contentBox,
  isWide,
  sliceTop,
  type GraphicProps,
} from '@finalpost/motion';

type Content = {label: string; from: string; to: string; series: number[]; caption: string};

function parseFigure(text: string): {prefix: string; value: number; suffix: string; decimals: number} | null {
  const m = /^(\D*?)(\d[\d,]*(?:\.\d+)?)(\D*)$/.exec(text.trim());
  if (!m) return null;
  const numStr = (m[2] ?? '').replace(/,/g, '');
  const value = Number(numStr);
  if (!Number.isFinite(value)) return null;
  const dot = numStr.indexOf('.');
  return {prefix: m[1] ?? '', value, suffix: m[3] ?? '', decimals: dot >= 0 ? numStr.length - dot - 1 : 0};
}

export default function Graphic({width, height, durationInFrames, theme, safeArea, content}: GraphicProps<Content>) {
  const {label, from, to, series, caption} = content!;
  const box = contentBox(width, height, safeArea, Math.min(width, height) * 0.05);
  const gap = box.height * 0.02;
  const wide = isWide(width, height);

  const [labelBox, r1] = sliceTop(box, wide ? 0.11 : 0.06, gap);
  const [numbers, r2] = sliceTop(r1, wide ? 0.42 : 0.36, gap);
  const [oldBox, nr] = sliceTop(numbers, 0.24, gap * 0.5);
  const [arrowBox, newBox] = sliceTop(nr, 0.14, gap * 0.5);
  const [chartBox, captionBox] = sliceTop(r2, 0.7, gap * 1.5);

  const countStart = Math.round(durationInFrames * 0.1);
  const countDur = Math.max(12, Math.round(durationInFrames * 0.45));
  const chartDelay = Math.round(durationInFrames * 0.18);
  const chartDur = Math.max(12, Math.round(durationInFrames * 0.5));
  const captionDelay = Math.round(durationInFrames * 0.5);

  const toFig = parseFigure(to);
  const fromFig = parseFigure(from);
  const arrowSize = Math.min(arrowBox.height, arrowBox.width * 0.2);

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
            weight={700}
            color={theme.mutedText}
            letterSpacing={0.08}
          />
        </Reveal>
      </Box>
      <Box {...oldBox}>
        <Reveal delay={2} effect={['fade', 'scale']}>
          <FitText
            text={from}
            width={oldBox.width}
            height={oldBox.height}
            maxLines={1}
            weight={700}
            color={theme.mutedText}
            tabular
          />
        </Reveal>
      </Box>
      <Box {...arrowBox}>
        <Reveal delay={Math.round(countStart * 0.6)} effect={['fade', 'slide-down']}>
          <div style={{width: arrowBox.width, height: arrowBox.height, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
            <Icon name="arrow-down" size={arrowSize} color={theme.accent} strokeWidth={3} />
          </div>
        </Reveal>
      </Box>
      <Box {...newBox}>
        <Reveal delay={countStart} effect={['fade', 'scale']} spring="bouncy">
          {toFig ? (
            <Counter
              from={fromFig ? fromFig.value : 0}
              to={toFig.value}
              prefix={toFig.prefix}
              suffix={toFig.suffix}
              decimals={toFig.decimals}
              delay={countStart}
              duration={countDur}
              width={newBox.width}
              height={newBox.height}
              color={theme.success}
              weight={900}
            />
          ) : (
            <FitText text={to} width={newBox.width} height={newBox.height} maxLines={1} weight={900} color={theme.success} tabular />
          )}
        </Reveal>
      </Box>
      <Box {...chartBox}>
        <LineChart
          data={series}
          width={chartBox.width}
          height={chartBox.height}
          delay={chartDelay}
          duration={chartDur}
          endLabel={to}
          color={theme.success}
        />
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
          delay={captionDelay}
          effect="up"
          highlight={['5倍']}
          highlightStyle="color"
          highlightColor={theme.accent}
          emphasisScale={1.12}
        />
      </Box>
    </>
  );
}
