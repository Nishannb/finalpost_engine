// Example task 2: "Transparent overlay that points to the product in the
// underlying video, with a pulsing arrow and a short label." No background.
import {Arrow, Badge, Box, FocusRing, contentBox, measureLine, useMotionTheme, type GraphicProps} from '@finalpost/motion';

type Content = {label: string; target: {x: number; y: number; width: number; height: number}};

export default function Graphic({width, safeArea, content, height}: GraphicProps<Content>) {
  const theme = useMotionTheme();
  const {label, target} = content!;
  const box = contentBox(width, height, safeArea, 24);
  const badgeH = 80;
  const badgeW = measureLine(label, badgeH * 0.44, theme.fontBody, 700) + badgeH * 1.5;
  const badgeX = Math.max(box.x, Math.min(box.x + box.width - badgeW, target.x - badgeW * 0.6));
  const badgeY = Math.max(box.y, target.y - 300);

  return (
    <>
      <FocusRing x={target.x} y={target.y} width={target.width} height={target.height} delay={0} duration={14} />
      <Arrow
        from={{x: badgeX + badgeW * 0.35, y: badgeY + badgeH + 12}}
        to={{x: target.x - 20, y: target.y + target.height * 0.3}}
        bend={0.3}
        delay={8}
        duration={14}
        outline
        pulse
      />
      <Box x={badgeX} y={badgeY} width={badgeW} height={badgeH}>
        <Badge text={label} icon="sparkles" height={badgeH} delay={4} bordered />
      </Box>
    </>
  );
}
