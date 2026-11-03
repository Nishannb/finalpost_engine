import {useCurrentFrame} from 'remotion';
import {
  Background,
  Box,
  KineticText,
  Reveal,
  contentBox,
  fitTextBlock,
  isWide,
  progress,
  sliceTop,
  withAlpha,
  type GraphicProps,
} from '@finalpost/motion';

type Content = {text: string; highlight?: string};

export default function Graphic({width, height, durationInFrames, theme, safeArea, content}: GraphicProps<Content>) {
  const frame = useCurrentFrame();
  const {text, highlight} = content!;

  const wide = isWide(width, height);
  const pad = Math.min(width, height) * 0.07;
  const box = contentBox(width, height, safeArea, pad);

  // Thin accent rule above the sentence, then the sentence fills the rest.
  const ruleH = Math.max(6, Math.min(width, height) * 0.008);
  const [ruleBox, textArea] = sliceTop(box, Math.max(ruleH * 4, box.height * 0.04), 0);
  const maxLines = wide ? 7 : 12;
  const lineHeight = 1.15;

  // Measure once so line-by-line timing matches the actual layout.
  const fit = fitTextBlock({
    text,
    width: textArea.width,
    height: textArea.height,
    maxLines,
    font: theme.fontDisplay,
    weight: 800,
    lineHeight,
  });
  const lineCount = Math.max(1, fit.lines.length);

  // All lines in by ~40% of the duration so the takeaway can be read.
  const startDelay = 3;
  const revealSpan = Math.max(6, Math.round(durationInFrames * 0.4));
  const each = Math.max(1, Math.round(revealSpan / lineCount));

  const ruleW = ruleBox.width * 0.22 * progress(frame, 0, Math.max(8, Math.round(durationInFrames * 0.2)), 'outExpo');

  return (
    <>
      <Background variant="spotlight" accent={theme.accent} />
      <Box {...ruleBox}>
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: (ruleBox.height - ruleH) / 2,
            width: ruleW,
            height: ruleH,
            borderRadius: ruleH / 2,
            background: theme.accent,
            boxShadow: `0 0 0 ${ruleH}px ${withAlpha(theme.accent, 0.15)}`,
          }}
        />
      </Box>
      <Box {...textArea}>
        <Reveal effect="fade" duration={6} exit>
          <KineticText
            text={text}
            width={textArea.width}
            height={textArea.height}
            maxLines={maxLines}
            mode="lines"
            effect="up"
            delay={startDelay}
            each={each}
            font="display"
            weight={800}
            align="left"
            verticalAlign="center"
            lineHeight={lineHeight}
            color={theme.text}
            highlight={highlight ? [highlight] : []}
            highlightStyle="marker"
            highlightColor={theme.accent}
          />
        </Reveal>
      </Box>
    </>
  );
}
