import {
  Arrow,
  Badge,
  Box,
  FocusRing,
  contentBox,
  measureLine,
  useMotionTheme,
  type GraphicProps,
} from '@finalpost/motion';

type Content = {
  label: string;
  sublabel?: string;
  target: {x: number; y: number; w: number; h: number};
};

export default function Graphic({width, height, safeArea, content}: GraphicProps<Content>) {
  const theme = useMotionTheme();
  const {label, sublabel, target: t} = content!;
  const box = contentBox(width, height, safeArea, Math.min(width, height) * 0.03);

  // Target in region px
  const target = {
    x: t.x * width,
    y: t.y * height,
    width: t.w * width,
    height: t.h * height,
  };

  const badgeH = Math.max(56, Math.min(width, height) * 0.075);
  const subH = badgeH * 0.62;
  const gapBetween = badgeH * 0.12;
  const hasSub = Boolean(sublabel && sublabel.length > 0);
  const blockH = badgeH + (hasSub ? subH + gapBetween : 0);
  const gap = Math.max(badgeH * 1.6, height * 0.07);

  const badgeW = Math.min(
    box.width,
    measureLine(label, badgeH * 0.44, theme.fontBody, 700) + badgeH * 1.5,
  );
  const subW = hasSub
    ? Math.min(box.width, measureLine(sublabel!, subH * 0.46, theme.fontBody, 600) + subH * 1.1)
    : 0;
  const blockW = Math.max(badgeW, subW);

  // Choose the side (above / below the target) with more room
  const spaceAbove = target.y - box.y;
  const spaceBelow = box.y + box.height - (target.y + target.height);
  const above = spaceAbove >= spaceBelow;

  const rawBlockY = above
    ? target.y - gap - blockH
    : target.y + target.height + gap;
  const blockY = Math.max(box.y, Math.min(box.y + box.height - blockH, rawBlockY));
  const blockX = Math.max(
    box.x,
    Math.min(box.x + box.width - blockW, target.x - blockW * 0.35),
  );

  const arrowFrom = {
    x: blockX + blockW * 0.5,
    y: above ? blockY + blockH + 10 : blockY - 10,
  };
  const arrowTo = {
    x: target.x + target.width * 0.4,
    y: above ? target.y - 18 : target.y + target.height + 18,
  };

  const subY = blockY + badgeH + gapBetween;

  return (
    <>
      <FocusRing
        x={target.x}
        y={target.y}
        width={target.width}
        height={target.height}
        delay={0}
        duration={14}
      />
      <Arrow
        from={arrowFrom}
        to={arrowTo}
        bend={above ? -0.3 : 0.3}
        delay={8}
        duration={14}
        outline
        pulse
      />
      <Box x={blockX} y={blockY} width={badgeW} height={badgeH}>
        <Badge text={label} icon="sparkles" height={badgeH} maxWidth={box.width} delay={4} bordered />
      </Box>
      {hasSub ? (
        <Box x={blockX} y={subY} width={subW} height={subH}>
          <Badge
            text={sublabel!}
            height={subH}
            maxWidth={box.width}
            delay={10}
            color={theme.surface}
            textColor={theme.text}
            bordered
          />
        </Box>
      ) : null}
    </>
  );
}
