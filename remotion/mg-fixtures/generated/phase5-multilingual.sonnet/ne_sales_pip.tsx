import {
  Background,
  Box,
  Card,
  FitText,
  Progress,
  Reveal,
  contentBox,
  fitTextGroup,
  progress,
  sliceTop,
  withAlpha,
  type GraphicProps,
} from '@finalpost/motion';
import {useCurrentFrame} from 'remotion';

type Content = {value: number; display: string; label: string};

const DEVANAGARI = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];

// Re-render the digits of the animated value in the script used by `display`.
function localizeDigits(n: number, useDevanagari: boolean): string {
  const s = String(n);
  if (!useDevanagari) return s;
  return s.replace(/[0-9]/g, (d) => DEVANAGARI[Number(d)] ?? d);
}

export default function Graphic({width, height, durationInFrames, theme, safeArea, content}: GraphicProps<Content>) {
  const frame = useCurrentFrame();
  const {value, display, label} = content!;
  const target = Math.max(0, Math.min(100, value));

  const pad = Math.min(width, height) * 0.06;
  const box = contentBox(width, height, safeArea, pad);
  const [ringArea, labelBox] = sliceTop(box, 0.68, box.height * 0.04);

  const ring = Math.min(ringArea.width, ringArea.height);
  const ringX = ringArea.x + (ringArea.width - ring) / 2;
  const ringY = ringArea.y + (ringArea.height - ring) / 2;

  // Count-up and ring fill share one timeline (fractions of duration).
  const t = progress(frame, 6, Math.max(12, Math.round(durationInFrames * 0.55)));
  const current = Math.round(target * t);

  // Number text: keep script of the supplied display (e.g. Devanagari digits) and its suffix.
  const hasDevanagari = /[०-९]/.test(display);
  const suffix = display.replace(/[0-9०-९\s]/g, '');
  const shown = `${localizeDigits(current, hasDevanagari)}${suffix}`;

  const numW = ring * 0.62;
  const numH = ring * 0.34;
  const numSize = fitTextGroup([display], {
    width: numW,
    height: numH,
    maxLines: 1,
    font: theme.fontDisplay,
    weight: 900,
  });

  const radius = Math.min(theme.radius * 0.6, Math.min(width, height) * 0.1);

  return (
    <>
      <Reveal effect={['fade', 'scale']} duration={12}>
        <Card width={width} height={height} variant="solid" radius={radius} shadow={false}>
          {null}
        </Card>
      </Reveal>
      <Box x={ringX} y={ringY} width={ring} height={ring}>
        <Progress
          variant="ring"
          value={(target / 100) * t}
          width={ring}
          height={ring}
          thickness={ring * 0.11}
          color={theme.accent}
          trackColor={withAlpha(theme.text, 0.15)}
        />
      </Box>
      <Box x={ringX + (ring - numW) / 2} y={ringY + (ring - numH) / 2} width={numW} height={numH}>
        <FitText
          text={shown}
          width={numW}
          height={numH}
          maxLines={1}
          maxFontSize={numSize}
          weight={900}
          color={theme.accent}
        />
      </Box>
      <Box {...labelBox}>
        <Reveal delay={10} effect={['fade', 'slide-up']}>
          <FitText
            text={label}
            width={labelBox.width}
            height={labelBox.height}
            maxLines={2}
            font="body"
            weight={700}
            color={theme.text}
          />
        </Reveal>
      </Box>
    </>
  );
}
