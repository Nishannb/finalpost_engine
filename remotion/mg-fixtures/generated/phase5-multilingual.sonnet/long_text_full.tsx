import {
  Background,
  Box,
  KineticText,
  Reveal,
  contentBox,
  progress,
  useSvgId,
  type GraphicProps,
} from '@finalpost/motion';
import {useCurrentFrame} from 'remotion';

type Content = {text: string; highlight?: string};

export default function Graphic({width, height, durationInFrames, theme, safeArea, content}: GraphicProps<Content>) {
  const frame = useCurrentFrame();
  const {text, highlight} = content!;
  const pad = Math.min(width, height) * 0.05;
  const box = contentBox(width, height, safeArea, pad);
  const barId = useSvgId('bar');

  const barH = Math.max(6, height * 0.006);
  const barW = Math.min(box.width * 0.25, 240) * progress(frame, 0, Math.max(8, Math.round(durationInFrames * 0.25)));
  const gap = Math.max(16, box.height * 0.03);
  const textBox = {
    x: box.x,
    y: box.y + barH + gap,
    width: box.width,
    height: box.height - barH - gap,
  };

  // Words appear quickly so the whole sentence is readable within the short duration.
  const each = Math.max(1, Math.min(3, Math.floor((durationInFrames * 0.4) / Math.max(1, text.split(/\s+/).length))));

  return (
    <>
      <Background variant="gradient" />
      <svg width={width} height={height} style={{position: 'absolute', left: 0, top: 0}}>
        <defs>
          <linearGradient id={barId} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor={theme.primary} />
            <stop offset="1" stopColor={theme.accent} />
          </linearGradient>
        </defs>
        <rect x={box.x} y={box.y} width={barW} height={barH} rx={barH / 2} fill={`url(#${barId})`} />
      </svg>
      <Box {...textBox}>
        <Reveal effect={['fade']} duration={6}>
          <KineticText
            text={text}
            width={textBox.width}
            height={textBox.height}
            maxLines={12}
            align="left"
            verticalAlign="center"
            weight={800}
            mode="words"
            effect="up"
            each={each}
            delay={2}
            highlight={highlight ? [highlight] : []}
            highlightStyle="marker"
            highlightColor={theme.accent}
            emphasisScale={1.06}
          />
        </Reveal>
      </Box>
    </>
  );
}
