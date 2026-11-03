import {
  Box,
  Card,
  FitText,
  Reveal,
  contentBox,
  sliceTop,
  type GraphicProps,
} from '@finalpost/motion';

type Content = {quote: string; attribution?: string};

export default function Graphic({width, height, theme, safeArea, content}: GraphicProps<Content>) {
  const {quote, attribution} = content!;
  const box = contentBox(width, height, safeArea, Math.min(width, height) * 0.03);
  const pad = Math.max(14, Math.min(box.width, box.height) * 0.07);
  const barW = Math.max(5, box.width * 0.012);

  const inner = {
    x: box.x + pad + barW + pad * 0.5,
    y: box.y + pad,
    width: Math.max(10, box.width - pad * 2 - barW - pad * 0.5),
    height: Math.max(10, box.height - pad * 2),
  };

  const hasAttribution = Boolean(attribution && attribution.length > 0);
  const [quoteBox, attrBox] = hasAttribution
    ? sliceTop(inner, 0.78, inner.height * 0.04)
    : [inner, inner];

  return (
    <>
      <Reveal effect={['fade', 'slide-up']} duration={12}>
        <Box {...box}>
          <Card width={box.width} height={box.height} variant="solid" color={theme.surface} shadow={false} />
        </Box>
      </Reveal>
      <Reveal effect={['fade', 'grow-y']} delay={4} duration={12}>
        <Box x={box.x + pad} y={box.y + pad} width={barW} height={box.height - pad * 2}>
          <div style={{width: barW, height: box.height - pad * 2, borderRadius: barW / 2, background: theme.accent}} />
        </Box>
      </Reveal>
      <Box {...quoteBox}>
        <Reveal effect={['fade', 'slide-up']} delay={6}>
          <FitText
            text={quote}
            width={quoteBox.width}
            height={quoteBox.height}
            maxLines={6}
            align="left"
            font="body"
            weight={600}
            color={theme.text}
          />
        </Reveal>
      </Box>
      {hasAttribution ? (
        <Box {...attrBox!}>
          <Reveal effect={['fade']} delay={16}>
            <FitText
              text={attribution!}
              width={attrBox!.width}
              height={attrBox!.height}
              maxLines={1}
              align="left"
              font="body"
              weight={500}
              color={theme.mutedText}
            />
          </Reveal>
        </Box>
      ) : null}
    </>
  );
}
