// Text-fitting stress test: short, long, single long word, multi-line, kinetic,
// badges — each in a fixed box with a visible outline so clipping is obvious.
import {Background, Badge, Box, FitText, KineticText, contentBox, splitColumn, useMotionTheme, withAlpha, type GraphicProps} from '@finalpost/motion';

type Content = {samples: string[]; kinetic: string; badges: string[]};

export default function TextStress({width, height, safeArea, content}: GraphicProps<Content>) {
  const theme = useMotionTheme();
  const {samples, kinetic, badges} = content!;
  const box = contentBox(width, height, safeArea, 12);
  const rows = splitColumn(box, samples.length + 2, 10);
  const outline = {outline: `2px dashed ${withAlpha(theme.accent, 0.6)}`};
  return (
    <>
      <Background variant="solid" />
      {samples.map((text, i) => (
        <Box key={i} {...rows[i]!} style={outline}>
          <FitText text={text} width={rows[i]!.width} height={rows[i]!.height} maxLines={i % 2 === 0 ? 1 : 3} weight={800} />
        </Box>
      ))}
      <Box {...rows[samples.length]!} style={outline}>
        <KineticText text={kinetic} width={rows[samples.length]!.width} height={rows[samples.length]!.height} maxLines={2} highlight={['three steps']} highlightStyle="marker" emphasisScale={1.12} />
      </Box>
      <Box {...rows[samples.length + 1]!} style={{display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', ...outline}}>
        {badges.map(b => (
          <Badge key={b} text={b} icon="check" height={Math.min(64, rows[samples.length + 1]!.height * 0.8)} maxWidth={rows[samples.length + 1]!.width / badges.length} animate={false} />
        ))}
      </Box>
    </>
  );
}
