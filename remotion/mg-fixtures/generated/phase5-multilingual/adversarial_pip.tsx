import {useCurrentFrame} from 'remotion';
import {
  Box,
  Card,
  FitText,
  Reveal,
  contentBox,
  isWide,
  progress,
  sliceTop,
  withAlpha,
  type GraphicProps,
} from '@finalpost/motion';

type Content = {quote: string; attribution?: string};

export default function Graphic({width, height, durationInFrames, theme, safeArea, content}: GraphicProps<Content>) {
  const frame = useCurrentFrame();
  const {quote, attribution} = content!;
  const hasAttribution = typeof attribution === 'string' && attribution.trim().length > 0;

  // Card fills the safe content box of the PiP region; outside stays transparent.
  const box = contentBox(width, height, safeArea, Math.min(width, height) * 0.03);
  const radius = Math.max(8, theme.radius * (width / 1080));
  const pad = Math.min(box.width, box.height) * 0.09;
  const inner = {
    x: box.x + pad,
    y: box.y + pad,
    width: Math.max(1, box.width - pad * 2),
    height: Math.max(1, box.height - pad * 2),
  };

  // Accent bar on the left, text to its right.
  const barW = Math.max(4, inner.width * 0.012);
  const barGap = pad * 0.6;
  const textRect = {
    x: inner.x + barW + barGap,
    y: inner.y,
    width: Math.max(1, inner.width - barW - barGap),
    height: inner.height,
  };
  const wide = isWide(width, height);
  const [quoteBox, attrBox] = hasAttribution
    ? sliceTop(textRect, wide ? 0.76 : 0.8, inner.height * 0.04)
    : [textRect, textRect];

  // Timing scales with duration; short fixed entrances.
  const quoteDelay = Math.min(6, Math.round(durationInFrames * 0.08));
  const attrDelay = Math.min(16, Math.round(durationInFrames * 0.22));
  const barGrow = progress(frame, 2, Math.max(6, Math.round(durationInFrames * 0.18)), 'outExpo');

  return (
    <Reveal effect={['fade', 'scale']} duration={10} exit>
      <Box {...box}>
        <Card
          width={box.width}
          height={box.height}
          variant="solid"
          color={withAlpha(theme.surface, 0.94)}
          radius={radius}
          borderColor={withAlpha(theme.text, 0.12)}
          borderWidth={Math.max(1, width * 0.002)}
        />
      </Box>
      <Box x={inner.x} y={inner.y} width={barW} height={inner.height}>
        <div
          style={{
            width: barW,
            height: inner.height,
            borderRadius: barW / 2,
            background: theme.accent,
            transformOrigin: 'top center',
            transform: `scaleY(${barGrow})`,
          }}
        />
      </Box>
      <Box {...quoteBox!}>
        <Reveal delay={quoteDelay} effect={['fade', 'slide-up']} distance={Math.max(8, height * 0.03)}>
          <FitText
            text={quote}
            width={quoteBox!.width}
            height={quoteBox!.height}
            maxLines={5}
            minFontSize={12}
            font="display"
            weight={700}
            align="left"
            verticalAlign="center"
            lineHeight={1.2}
            color={theme.text}
          />
        </Reveal>
      </Box>
      {hasAttribution ? (
        <Box {...attrBox!}>
          <Reveal delay={attrDelay} effect={['fade', 'slide-left']}>
            <FitText
              text={attribution!}
              width={attrBox!.width}
              height={attrBox!.height}
              maxLines={1}
              minFontSize={10}
              font="body"
              weight={600}
              align="left"
              verticalAlign="center"
              color={theme.mutedText}
            />
          </Reveal>
        </Box>
      ) : null}
    </Reveal>
  );
}
