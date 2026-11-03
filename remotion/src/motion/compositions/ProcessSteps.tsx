import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';

import {progress, springIn} from '../animation';
import {Arrow} from '../components/Indicators';
import {Icon, type IconName} from '../components/Media';
import {Box, Reveal} from '../components/Reveal';
import {PlateGround, usePlatePalette} from '../components/Plate';
import {FitText} from '../components/Text';
import {useMotionTheme} from '../context';
import {contentBox, sliceTop, splitColumn, splitRow, type SafeArea} from '../layout';
import {fitTextGroup} from '../text';
import {withAlpha} from '../theme';

export type ProcessStepsProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  title?: string;
  steps: Array<{label: string; icon?: IconName}>;
  /** Frame at which each step activates (e.g. when it is spoken). Default: evenly spaced. */
  cues?: number[];
  /** steps: numbered/icon nodes joined by arrows · timeline: "01 02 03" milestones on a line. */
  variant?: 'steps' | 'timeline';
  background?: boolean;
};

/**
 * Sequential steps that light up one by one; the active step is emphasised and
 * arrows draw between nodes. Row layout in wide regions, column in tall ones.
 */
export const ProcessSteps: React.FC<ProcessStepsProps> = ({width, height, safeArea, title, steps, cues, variant = 'steps', background = true}) => {
  const theme = useMotionTheme();
  const palette = usePlatePalette();
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const n = Math.max(1, steps.length);
  const starts = steps.map((_, i) => cues?.[i] ?? Math.round(8 + (i * (durationInFrames * 0.7 - 8)) / n));
  const box = contentBox(width, height, safeArea, Math.min(width, height) * 0.06);
  const [titleBox, body] = title ? sliceTop(box, Math.min(0.2, 140 / box.height), box.height * 0.04) : [null, box];
  // Row only when each step still gets a reasonably wide slot; otherwise stack.
  const wide = body.width / n >= body.height * 0.45;
  const slots = wide ? splitRow(body, n, body.width * 0.05) : splitColumn(body, n, body.height * 0.04);
  const node = Math.min(wide ? slots[0]!.width * 0.6 : slots[0]!.height * 0.8, wide ? body.height * 0.42 : 200);
  const active = starts.reduce((acc, s, i) => (frame >= s ? i : acc), -1);
  const labelW = wide ? slots[0]!.width : slots[0]!.width - node * 1.35;
  const labelH = wide ? node * 0.9 : Math.min(slots[0]!.height, node * 1.1);
  // One size for every label so the steps read as a set.
  const labelSize = fitTextGroup(
    steps.map(s => s.label),
    {width: labelW, height: labelH, maxLines: 2, font: theme.fontBody, weight: 800},
  );

  const centerOf = (i: number) => {
    const s = slots[i]!;
    return wide ? {x: s.x + s.width / 2, y: s.y + node / 2 + (s.height - node * 1.9) / 2} : {x: s.x + node / 2, y: s.y + s.height / 2};
  };

  return (
    <>
      {background ? <PlateGround /> : null}
      {titleBox ? (
        <Box {...titleBox}>
          <Reveal>
            <FitText text={title!} width={titleBox.width} height={titleBox.height} maxLines={2} align={wide ? 'center' : 'left'} weight={800} />
          </Reveal>
        </Box>
      ) : null}
      {steps.slice(1).map((_, i) => {
        const a = centerOf(i);
        const b = centerOf(i + 1);
        const r = node / 2 + node * 0.12;
        const from = wide ? {x: a.x + r, y: a.y} : {x: a.x, y: a.y + r};
        const to = wide ? {x: b.x - r, y: b.y} : {x: b.x, y: b.y - r};
        return variant === 'timeline' ? (
          <svg key={`l${i}`} width={1} height={1} style={{position: 'absolute', left: 0, top: 0, overflow: 'visible'}}>
            <line x1={from.x} y1={from.y} x2={from.x + (to.x - from.x) * progress(frame, starts[i]!, Math.max(6, starts[i + 1]! - starts[i]!))} y2={from.y + (to.y - from.y) * progress(frame, starts[i]!, Math.max(6, starts[i + 1]! - starts[i]!))} stroke={palette.marker} strokeWidth={Math.max(4, node * 0.05)} strokeLinecap="round" />
          </svg>
        ) : (
          <Arrow key={`a${i}`} from={from} to={to} delay={starts[i + 1]! - 10} duration={10} strokeWidth={Math.max(4, node * 0.06)} color={i < active ? palette.marker : palette.mutedInk} />
        );
      })}
      {steps.map((step, i) => {
        const c = centerOf(i);
        const s = slots[i]!;
        const appear = springIn(frame, fps, starts[i]!, 'bouncy');
        const isActive = i === active;
        const done = i < active;
        const ringColor = isActive ? palette.marker : done ? palette.marker : withAlpha(palette.ink, 0.25);
        const labelBox = wide
          ? {x: s.x, y: c.y + node / 2 + node * 0.2, width: s.width, height: Math.min(node * 0.9, s.y + s.height - (c.y + node / 2 + node * 0.2))}
          : {x: s.x + node * 1.35, y: s.y, width: s.width - node * 1.35, height: s.height};
        return (
          <React.Fragment key={i}>
            <Box x={c.x - node / 2} y={c.y - node / 2} width={node} height={node}>
              <div
                style={{
                  width: node,
                  height: node,
                  borderRadius: node / 2,
                  boxSizing: 'border-box',
                  border: `${Math.max(4, node * 0.06)}px solid ${ringColor}`,
                  background: isActive ? withAlpha(palette.marker, 0.18) : palette.paper,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: Math.min(1, Math.max(0.25, appear)),
                  transform: `scale(${(0.6 + 0.4 * Math.min(1.05, Math.max(0, appear))) * (isActive ? 1.08 : 1)})`,
                }}>
                {step.icon && variant === 'steps' ? (
                  <Icon name={step.icon} size={node * 0.46} color={palette.paperInk} />
                ) : (
                  <FitText text={variant === 'timeline' ? String(i + 1).padStart(2, '0') : String(i + 1)} width={node * 0.7} height={node * 0.5} maxLines={1} weight={900} color={palette.paperInk} />
                )}
              </div>
            </Box>
            <Box {...labelBox} style={{display: 'flex', alignItems: wide ? 'flex-start' : 'center'}}>
              <Reveal delay={starts[i]! + 4} effect={wide ? ['fade', 'slide-up'] : ['fade', 'slide-left']}>
                <FitText
                  text={step.label}
                  width={labelBox.width}
                  height={wide ? labelBox.height : Math.min(labelBox.height, node * 1.1)}
                  maxLines={2}
                  maxFontSize={labelSize}
                  align={wide ? 'center' : 'left'}
                  verticalAlign={wide ? 'top' : 'center'}
                  font="body"
                  weight={isActive ? 800 : 600}
                  color={isActive || done ? palette.ink : palette.mutedInk}
                />
              </Reveal>
            </Box>
          </React.Fragment>
        );
      })}
    </>
  );
};
