import {
  Arrow,
  Badge,
  Box,
  FocusRing,
  Reveal,
  contentBox,
  measureLine,
  withAlpha,
  type GraphicProps,
} from '@finalpost/motion';

type Content = {
  label: string;
  sublabel?: string;
  target: {x: number; y: number; w: number; h: number};
};

export default function Graphic({width, height, durationInFrames, theme, safeArea, content}: GraphicProps<Content>) {
  const {label, sublabel, target} = content!;
  const box = contentBox(width, height, safeArea, Math.min(width, height) * 0.04);
  const unit = Math.min(width, height);

  // Target in region px.
  const tx = target.x * width;
  const ty = target.y * height;
  const tw = target.w * width;
  const th = target.h * height;
  const tcx = tx + tw / 2;
  const ringPad = Math.max(8, unit * 0.015);

  // Label sizing (measured).
  const badgeH = Math.max(44, Math.min(96, unit * 0.075));
  const subH = sublabel ? badgeH * 0.62 : 0;
  const subGap = sublabel ? badgeH * 0.18 : 0;
  const badgeW = Math.min(box.width, measureLine(label, badgeH * 0.44, theme.fontBody, 700) + badgeH * 1.5);
  const subW = sublabel ? Math.min(box.width, measureLine(sublabel, subH * 0.44, theme.fontBody, 600) + subH * 1.0) : 0;
  const labelH = badgeH + subGap + subH;
  const labelW = Math.max(badgeW, subW);

  // Vertical placement: whichever side of the target has more room, kept clear of the ring.
  const spaceAbove = ty - ringPad - box.y;
  const spaceBelow = box.y + box.height - (ty + th + ringPad);
  const above = spaceAbove >= spaceBelow;
  const idealGap = Math.max(unit * 0.12, labelH * 0.8);
  let labelY: number;
  if (above) {
    const gap = Math.max(unit * 0.03, Math.min(idealGap, spaceAbove - labelH));
    labelY = Math.max(box.y, ty - ringPad - gap - labelH);
  } else {
    const gap = Math.max(unit * 0.03, Math.min(idealGap, spaceBelow - labelH));
    labelY = Math.min(box.y + box.height - labelH, ty + th + ringPad + gap);
  }

  // Horizontal placement: offset toward the roomier side so the arrow curves in.
  const targetOnRight = tcx > width / 2;
  const idealX = targetOnRight ? tcx - labelW * 0.85 : tcx - labelW * 0.15;
  const labelX = Math.max(box.x, Math.min(box.x + box.width - labelW, idealX));
  const labelCx = labelX + labelW / 2;

  const badgeX = labelCx - badgeW / 2;
  const subX = labelCx - subW / 2;
  const subY = labelY + badgeH + subGap;

  // Arrow endpoints.
  const arrowGap = Math.max(8, unit * 0.012);
  const from = above
    ? {x: labelCx, y: labelY + labelH + arrowGap}
    : {x: labelCx, y: labelY - arrowGap};
  const toX = Math.max(tx + tw * 0.2, Math.min(tx + tw * 0.8, labelCx + (tcx - labelCx) * 0.5));
  const to = above
    ? {x: toX, y: ty - ringPad - arrowGap}
    : {x: toX, y: ty + th + ringPad + arrowGap};
  const bendBase = 0.28;
  const bend = (above ? 1 : -1) * (targetOnRight ? -1 : 1) * bendBase;

  // Timing as fractions of duration.
  const ringDur = Math.max(10, Math.round(durationInFrames * 0.14));
  const arrowDelay = Math.max(6, Math.round(durationInFrames * 0.1));
  const arrowDur = Math.max(10, Math.round(durationInFrames * 0.14));
  const subDelay = Math.max(8, Math.round(durationInFrames * 0.12));

  return (
    <>
      <FocusRing
        x={tx}
        y={ty}
        width={tw}
        height={th}
        padding={ringPad}
        strokeWidth={Math.max(4, unit * 0.008)}
        delay={0}
        duration={ringDur}
        outline
        pulse
      />
      <Arrow
        from={from}
        to={to}
        bend={bend}
        delay={arrowDelay}
        duration={arrowDur}
        strokeWidth={Math.max(5, unit * 0.008)}
        outline
        pulse
      />
      <Box x={badgeX} y={labelY} width={badgeW} height={badgeH}>
        <Badge text={label} icon="sparkles" height={badgeH} maxWidth={badgeW} delay={3} bordered />
      </Box>
      {sublabel ? (
        <Box x={subX} y={subY} width={subW} height={subH}>
          <Reveal delay={subDelay} effect={['fade', 'slide-up']}>
            <Badge
              text={sublabel}
              height={subH}
              maxWidth={subW}
              animate={false}
              color={withAlpha(theme.surface, 0.92)}
              textColor={theme.text}
            />
          </Reveal>
        </Box>
      ) : null}
    </>
  );
}
