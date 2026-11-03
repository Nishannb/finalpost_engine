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
  const box = contentBox(width, height, safeArea, 24);

  // Target in region px (fractions of the overlay region).
  const target = {
    x: t.x * width,
    y: t.y * height,
    width: t.w * width,
    height: t.h * height,
  };
  const targetCx = target.x + target.width / 2;

  // Label sizing.
  const badgeH = Math.max(56, Math.min(92, Math.min(width, height) * 0.075));
  const badgeW = Math.min(box.width, measureLine(label, badgeH * 0.44, theme.fontBody, 700) + badgeH * 1.5);
  const hasSub = !!sublabel && sublabel.length > 0;
  const subH = badgeH * 0.58;
  const subW = hasSub
    ? Math.min(box.width, measureLine(sublabel as string, subH * 0.44, theme.fontBody, 700) + subH * 1.1)
    : 0;
  const blockW = Math.max(badgeW, subW);
  const subGap = 10;
  const blockH = badgeH + (hasSub ? subH + subGap : 0);

  // Put the label on the side of the target with more room.
  const gap = Math.max(140, height * 0.09);
  const spaceAbove = target.y - box.y;
  const spaceBelow = box.y + box.height - (target.y + target.height);
  const above = spaceAbove >= spaceBelow;

  const rawY = above ? target.y - gap - blockH : target.y + target.height + gap;
  const blockY = Math.max(box.y, Math.min(box.y + box.height - blockH, rawY));
  const blockX = Math.max(box.x, Math.min(box.x + box.width - blockW, targetCx - blockW / 2));
  const blockCx = blockX + blockW / 2;

  // Arrow from the label block to the ring edge.
  const ringPad = 16;
  const from = above
    ? {x: blockCx, y: blockY + blockH + 14}
    : {x: blockCx, y: blockY - 14};
  const to = above
    ? {x: targetCx, y: target.y - ringPad - 10}
    : {x: targetCx, y: target.y + target.height + ringPad + 10};

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
      <Arrow from={from} to={to} bend={0.3} delay={10} duration={14} outline pulse />
      <Box x={blockX + (blockW - badgeW) / 2} y={blockY} width={badgeW} height={badgeH}>
        <Badge text={label} icon="sparkles" height={badgeH} maxWidth={badgeW} delay={4} bordered />
      </Box>
      {hasSub ? (
        <Box x={blockX + (blockW - subW) / 2} y={blockY + badgeH + subGap} width={subW} height={subH}>
          <Badge
            text={sublabel as string}
            height={subH}
            maxWidth={subW}
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
