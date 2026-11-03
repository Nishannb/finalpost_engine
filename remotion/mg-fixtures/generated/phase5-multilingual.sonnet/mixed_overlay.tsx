import {
  Arrow,
  Badge,
  Box,
  Card,
  FitText,
  FocusRing,
  Reveal,
  contentBox,
  exitProgress,
  fitTextGroup,
  measureLine,
  type GraphicProps,
} from '@finalpost/motion';
import {useCurrentFrame} from 'remotion';

type Content = {
  target: {x: number; y: number; w: number; h: number};
  labels: string[];
  accuracy: string;
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export default function Graphic({width, height, durationInFrames, theme, safeArea, content}: GraphicProps<Content>) {
  const frame = useCurrentFrame();
  const {target: t, labels, accuracy} = content!;
  const unit = Math.min(width, height);
  const box = contentBox(width, height, safeArea, unit * 0.025);

  // Target in region px (content gives fractions of the region).
  const target = {x: t.x * width, y: t.y * height, width: t.w * width, height: t.h * height};

  const n = Math.max(1, labels.length);
  const pad = unit * 0.02;
  const rowH = unit * 0.085;
  const cardW = Math.min(box.width, width * 0.62);
  const cardH = rowH * n + pad * 2;
  const gap = Math.min(height * 0.05, unit * 0.09);

  const spaceAbove = target.y - box.y;
  const spaceBelow = box.y + box.height - (target.y + target.height);
  const labelAbove = spaceAbove >= spaceBelow;

  const cardX = clamp(target.x + target.width - cardW, box.x, box.x + box.width - cardW);
  const cardY = labelAbove
    ? Math.max(box.y, target.y - gap - cardH)
    : Math.min(box.y + box.height - cardH, target.y + target.height + gap);

  const innerW = cardW - pad * 2;
  const labelSize = fitTextGroup(labels, {width: innerW, height: rowH * 0.9, maxLines: 1, font: theme.fontBody, weight: 700});

  // Accuracy badge on the opposite side of the target from the label.
  const badgeH = Math.max(52, unit * 0.06);
  const badgeW = Math.min(box.width, measureLine(accuracy, badgeH * 0.42, theme.fontBody, 700) + badgeH * 1.6);
  const badgeX = clamp(target.x + target.width / 2 - badgeW / 2, box.x, box.x + box.width - badgeW);
  const badgeY = labelAbove
    ? Math.min(box.y + box.height - badgeH, target.y + target.height + gap * 0.5)
    : Math.max(box.y, target.y - gap * 0.5 - badgeH);

  // Arrow from label card to ring.
  const arrowFrom = labelAbove
    ? {x: clamp(target.x + target.width / 2, cardX + 20, cardX + cardW - 20), y: cardY + cardH + 6}
    : {x: clamp(target.x + target.width / 2, cardX + 20, cardX + cardW - 20), y: cardY - 6};
  const arrowTo = {
    x: target.x + target.width / 2,
    y: labelAbove ? target.y - unit * 0.025 : target.y + target.height + unit * 0.025,
  };
  const showArrow = Math.abs(arrowTo.y - arrowFrom.y) > unit * 0.03;

  const exitFade = exitProgress(frame, durationInFrames, 8);
  const d = (f: number) => Math.round(durationInFrames * f);

  return (
    <div style={{position: 'absolute', left: 0, top: 0, width, height, opacity: exitFade}}>
      <FocusRing
        x={target.x}
        y={target.y}
        width={target.width}
        height={target.height}
        shape="rounded"
        color={theme.accent}
        delay={0}
        duration={d(0.15)}
        outline
      />
      {showArrow ? (
        <Arrow
          from={arrowFrom}
          to={arrowTo}
          bend={0.2}
          delay={d(0.1)}
          duration={d(0.15)}
          color={theme.accent}
          strokeWidth={Math.max(6, unit * 0.008)}
          outline
          pulse
        />
      ) : null}
      <Box x={cardX} y={cardY} width={cardW} height={cardH}>
        <Reveal delay={d(0.05)} effect={['fade', labelAbove ? 'slide-down' : 'slide-up']}>
          <Card width={cardW} height={cardH} variant="solid" color={theme.surface} borderColor={theme.accent} borderWidth={Math.max(2, unit * 0.003)} radius={unit * 0.03} padding={pad}>
            {labels.map((label, i) => (
              <Reveal key={`${i}-${label}`} delay={d(0.1) + i * 5} effect={['fade', 'slide-left']}>
                <FitText
                  text={label}
                  width={innerW}
                  height={rowH}
                  maxLines={1}
                  maxFontSize={labelSize}
                  font="body"
                  weight={700}
                  color={i === 0 ? theme.accent : theme.text}
                />
              </Reveal>
            ))}
          </Card>
        </Reveal>
      </Box>
      <Box x={badgeX} y={badgeY} width={badgeW} height={badgeH}>
        <Badge text={accuracy} icon="badge-check" height={badgeH} maxWidth={badgeW} color={theme.success} delay={d(0.35)} bordered />
      </Box>
    </div>
  );
}
