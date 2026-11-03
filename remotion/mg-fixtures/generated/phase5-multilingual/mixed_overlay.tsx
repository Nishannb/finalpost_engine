import {
  Arrow,
  Badge,
  Box,
  Card,
  FitText,
  FocusRing,
  Reveal,
  contentBox,
  fitTextGroup,
  isWide,
  splitColumn,
  withAlpha,
  type GraphicProps,
} from '@finalpost/motion';

type Content = {
  target: {x: number; y: number; w: number; h: number};
  labels: string[];
  accuracy: string;
};

export default function Graphic({width, height, durationInFrames, theme, safeArea, content}: GraphicProps<Content>) {
  const {target, labels, accuracy} = content!;
  const box = contentBox(width, height, safeArea, Math.min(width, height) * 0.04);
  const wide = isWide(width, height);
  const unit = Math.min(width, height);

  // Target is given as fractions of the region: convert to px.
  const tx = target.x * width;
  const ty = target.y * height;
  const tw = target.w * width;
  const th = target.h * height;
  const tcx = tx + tw / 2;

  // Label card sizing (derived from region).
  const n = Math.max(1, labels.length);
  const cardW = Math.min(box.width, (wide ? 0.42 : 0.72) * width);
  const rowH = Math.max(40, height * (wide ? 0.07 : 0.045));
  const pad = Math.max(12, unit * 0.035);
  const rowGap = rowH * 0.12;
  const cardH = Math.min(box.height * 0.5, pad * 2 + rowH * n + rowGap * (n - 1));
  const badgeH = Math.max(40, Math.min(rowH * 0.8, height * 0.034));
  const groupGap = Math.max(12, height * 0.015);
  const groupH = cardH + groupGap + badgeH;
  const arrowGap = Math.max(40, height * 0.05);

  // Place the group below or above the target, whichever has more room.
  const spaceBelow = box.y + box.height - (ty + th + arrowGap);
  const spaceAbove = ty - arrowGap - box.y;
  const below = spaceBelow >= groupH || spaceBelow >= spaceAbove;
  let groupY = below ? ty + th + arrowGap : ty - arrowGap - groupH;
  groupY = Math.max(box.y, Math.min(box.y + box.height - groupH, groupY));
  const cardX = Math.max(box.x, Math.min(box.x + box.width - cardW, tcx - cardW / 2));
  const cardY = below ? groupY : groupY + badgeH + groupGap;
  const badgeY = below ? groupY + cardH + groupGap : groupY;

  // Rows inside the card.
  const inner = {x: cardX + pad, y: cardY + pad, width: cardW - pad * 2, height: cardH - pad * 2};
  const rows = splitColumn(inner, n, rowGap);
  const rH = rows[0]!.height;
  const labelSize = fitTextGroup(labels, {width: inner.width, height: rH, maxLines: 1, font: theme.fontDisplay, weight: 800});

  // Arrow from card edge to target edge.
  const cardCx = cardX + cardW / 2;
  const arrowFrom = below ? {x: cardCx, y: cardY - 8} : {x: cardCx, y: cardY + cardH + 8};
  const arrowTo = below ? {x: tcx, y: ty + th + 14} : {x: tcx, y: ty - 14};

  // Timing as fractions of the duration (with short fixed entrances).
  const cardDelay = 6;
  const rowStart = 10;
  const each = Math.max(3, Math.round(durationInFrames * 0.05));
  const badgeDelay = Math.round(durationInFrames * 0.35);
  const radius = Math.max(8, (theme.radius * width) / 1080);

  return (
    <>
      <FocusRing
        x={tx}
        y={ty}
        width={tw}
        height={th}
        delay={0}
        duration={14}
        padding={Math.min(tw, th) * 0.06}
        strokeWidth={Math.max(4, unit * 0.008)}
        color={theme.secondary}
        outline
        pulse
      />
      <Arrow from={arrowFrom} to={arrowTo} bend={0.2} delay={8} duration={12} strokeWidth={Math.max(4, unit * 0.007)} outline pulse />
      <Box x={cardX} y={cardY} width={cardW} height={cardH}>
        <Reveal delay={cardDelay} effect={['fade', 'scale']}>
          <Card
            width={cardW}
            height={cardH}
            variant="solid"
            color={withAlpha(theme.surface, 0.88)}
            radius={radius}
            borderColor={withAlpha(theme.accent, 0.7)}
            borderWidth={Math.max(2, unit * 0.003)}
          />
        </Reveal>
      </Box>
      {labels.map((label, i) => {
        const row = rows[i]!;
        return (
          <Box key={`${i}-${label}`} {...row}>
            <Reveal delay={rowStart + i * each} effect={['fade', 'slide-up']}>
              <FitText
                text={label}
                width={row.width}
                height={row.height}
                maxLines={1}
                maxFontSize={labelSize}
                font="display"
                weight={800}
                color={i === 0 ? theme.accent : theme.text}
              />
            </Reveal>
          </Box>
        );
      })}
      <Box x={cardX} y={badgeY} width={cardW} height={badgeH}>
        <div style={{display: 'flex', justifyContent: 'center', width: cardW, height: badgeH}}>
          <Badge text={accuracy} icon="badge-check" height={badgeH} maxWidth={cardW} delay={badgeDelay} color={theme.success} bordered />
        </div>
      </Box>
    </>
  );
}
