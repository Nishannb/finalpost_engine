import {useCurrentFrame} from 'remotion';
import {
  Box,
  Card,
  FitText,
  Progress,
  Reveal,
  contentBox,
  fitTextBlock,
  progress,
  springIn,
  withAlpha,
  type GraphicProps,
} from '@finalpost/motion';

type Content = {value: number; display: string; label: string};

const DEVANAGARI_DIGITS = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];

function toDevanagari(n: number): string {
  return String(n)
    .split('')
    .map((ch) => {
      const d = Number(ch);
      return ch >= '0' && ch <= '9' ? DEVANAGARI_DIGITS[d] ?? ch : ch;
    })
    .join('');
}

export default function Graphic({width, height, durationInFrames, fps, theme, safeArea, content}: GraphicProps<Content>) {
  const frame = useCurrentFrame();
  const {value, display, label} = content!;

  // Card fills the safe content box of the PiP region.
  const box = contentBox(width, height, safeArea, Math.min(width, height) * 0.03);
  const cw = box.width;
  const ch = box.height;
  const pad = Math.min(cw, ch) * 0.07;
  const innerW = cw - pad * 2;
  const innerH = ch - pad * 2;
  const gap = innerH * 0.04;
  const ringAreaH = innerH * 0.68;
  const labelH = innerH - ringAreaH - gap;
  const ring = Math.max(10, Math.min(innerW, ringAreaH));
  const ringX = pad + (innerW - ring) / 2;
  const ringY = pad + (ringAreaH - ring) / 2;
  const radius = Math.max(8, theme.radius * (Math.min(width, height) / 1080) * 1.6);

  // Timing as fractions of the duration.
  const countStart = 6;
  const countEnd = Math.max(countStart + 10, Math.round(durationInFrames * 0.55));
  const t = progress(frame, countStart, countEnd - countStart, 'out');
  const fraction = Math.max(0, Math.min(1, value / 100));
  const done = t >= 1;

  // Number text: digits follow the script used in `display`; final frame shows display verbatim.
  const useDeva = /[०-९]/.test(display);
  const prefix = display.match(/^[^\d०-९]*/)?.[0] ?? '';
  const suffix = display.match(/[^\d०-९]*$/)?.[0] ?? '';
  const current = Math.round(value * t);
  const numberText = done ? display : `${prefix}${useDeva ? toDevanagari(current) : String(current)}${suffix}`;

  const numW = ring * 0.62;
  const numH = ring * 0.34;
  const fitted = fitTextBlock({text: display, width: numW, height: numH, maxLines: 1, font: theme.fontDisplay, weight: 900});
  const pop = done ? 1 + 0.08 * Math.max(0, 1 - springIn(frame, fps, countEnd, 'snappy')) : 1;

  return (
    <Box {...box}>
      <Reveal effect={['fade', 'pop']} duration={12}>
        <div style={{position: 'relative', width: cw, height: ch}}>
          <Card
            width={cw}
            height={ch}
            variant="solid"
            radius={radius}
            borderColor={withAlpha(theme.text, 0.12)}
            borderWidth={2}
          />
          <Box x={ringX} y={ringY} width={ring} height={ring}>
            <Progress
              variant="ring"
              value={fraction * t}
              width={ring}
              height={ring}
              thickness={ring * 0.09}
              color={theme.primary}
              trackColor={withAlpha(theme.text, 0.12)}
            />
          </Box>
          <Box x={ringX + (ring - numW) / 2} y={ringY + (ring - numH) / 2} width={numW} height={numH}>
            <div style={{transform: `scale(${pop})`, width: numW, height: numH}}>
              <FitText
                text={numberText}
                width={numW}
                height={numH}
                maxLines={1}
                maxFontSize={fitted.fontSize}
                weight={900}
                tabular
                color={theme.accent}
              />
            </div>
          </Box>
          <Box x={pad} y={pad + ringAreaH + gap} width={innerW} height={labelH}>
            <Reveal delay={Math.round(durationInFrames * 0.15)} effect={['fade', 'slide-up']} distance={labelH * 0.3}>
              <FitText
                text={label}
                width={innerW}
                height={labelH}
                maxLines={2}
                font="body"
                weight={700}
                color={theme.text}
              />
            </Reveal>
          </Box>
        </div>
      </Reveal>
    </Box>
  );
}
