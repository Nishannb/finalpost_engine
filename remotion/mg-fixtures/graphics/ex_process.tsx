// Example task 1: "4-second 1080×960 graphic explaining a three-step process.
// Clean dark theme, numbered steps appear sequentially, connected by animated
// arrows, current step emphasised." Built from primitives, not a composition.
import {useCurrentFrame} from 'remotion';
import {
  Arrow,
  Background,
  Box,
  Card,
  FitText,
  Icon,
  Reveal,
  contentBox,
  progress,
  sliceTop,
  splitRow,
  type GraphicProps,
  type IconName,
} from '@finalpost/motion';

type Content = {title: string; steps: Array<{label: string; icon: IconName}>};

export default function Graphic({width, height, durationInFrames, theme, safeArea, content}: GraphicProps<Content>) {
  const frame = useCurrentFrame();
  const {title, steps} = content!;
  const box = contentBox(width, height, safeArea, 24);
  const [titleBox, body] = sliceTop(box, 0.2, 24);
  const slots = splitRow(body, steps.length, body.width * 0.08);
  const stepAt = (i: number) => Math.round(10 + (i * durationInFrames * 0.6) / steps.length);
  const active = steps.reduce((acc, _, i) => (frame >= stepAt(i) ? i : acc), 0);
  const cardH = Math.min(body.height, slots[0]!.width * 1.25);

  return (
    <>
      <Background variant="gradient" />
      <Box {...titleBox}>
        <Reveal>
          <FitText text={title} width={titleBox.width} height={titleBox.height} maxLines={1} weight={800} />
        </Reveal>
      </Box>
      {slots.slice(1).map((slot, i) => (
        <Arrow
          key={`arrow-${i}`}
          from={{x: slots[i]!.x + slots[i]!.width + 6, y: body.y + cardH / 2}}
          to={{x: slot.x - 6, y: body.y + cardH / 2}}
          delay={stepAt(i + 1) - 8}
          duration={8}
          strokeWidth={6}
          color={i < active ? theme.primary : theme.mutedText}
        />
      ))}
      {steps.map((step, i) => {
        const slot = slots[i]!;
        const isActive = i === active;
        const emphasis = isActive ? 1 + 0.06 * progress(frame, stepAt(i), 8) : 1;
        return (
          <Box key={i} x={slot.x} y={body.y} width={slot.width} height={cardH}>
            <Reveal delay={stepAt(i)} effect={['fade', 'slide-up']} spring="snappy" style={{transform: `scale(${emphasis})`}}>
              <Card width={slot.width} height={cardH} variant={isActive ? 'soft' : 'solid'} color={isActive ? theme.accent : undefined} borderColor={isActive ? theme.accent : undefined} padding={16}>
                <FitText text={String(i + 1).padStart(2, '0')} width={slot.width - 32} height={cardH * 0.22} maxLines={1} weight={900} color={isActive ? theme.accent : theme.mutedText} />
                <div style={{height: cardH * 0.06}} />
                <Icon name={step.icon} size={cardH * 0.22} color={isActive ? theme.accent : theme.text} />
                <div style={{height: cardH * 0.06}} />
                <FitText text={step.label} width={slot.width - 32} height={cardH * 0.3} maxLines={2} font="body" weight={700} />
              </Card>
            </Reveal>
          </Box>
        );
      })}
    </>
  );
}
