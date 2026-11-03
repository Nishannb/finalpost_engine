/**
 * WP41: Skill B lime highlight plate. Wrap ANY screenshot / article / page plate (`children`, drawn at `width` x `height` px): when the highlight starts, the rest of the plate dims to ~0.28 and a lime
 * #BFFF00 bar wipes LEFT -> RIGHT behind the key phrase (`rects`, fractions of the plate; several rects = a phrase that wraps, wiped as one sweep). Inside the bar the plate is drawn at FULL opacity,
 * multiplied onto the lime (dark ink stays dark, white paper turns lime), so the phrase reads like a highlighter stroke. Nothing here knows about the speaker: it is a plate treatment.
 * Math lives in `lib/limeHighlight.ts` (pure, unit-tested). Mount it inside a <Sequence>: `startFrame` is relative to the Sequence.
 */
import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';

import {LIME_HIGHLIGHT, limeBarRect, limeDimOpacity, limeRectFractions, limeWipeProgress, type HighlightRect} from '../lib/limeHighlight';

type LimeHighlightWipeProps = {
  /** Plate size in px (the highlight rects are fractions of this box). */
  width: number;
  height: number;
  rects: readonly HighlightRect[];
  /** Frame (of the enclosing Sequence) at which the highlight starts: the dim begins, the wipe follows. */
  startFrame: number;
  /** Accent bar colour (default Skill B preferred lime; from blueprint.editPalette.accent when set). */
  color?: string;
  children: React.ReactNode;
};

export const LimeHighlightWipe: React.FC<LimeHighlightWipeProps> = ({width, height, rects, startFrame, color, children}) => {
  const frame = useCurrentFrame() - startFrame;
  const dim = limeDimOpacity(frame);
  const fractions = limeRectFractions(rects, limeWipeProgress(frame));
  const barColor = color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : LIME_HIGHLIGHT.color;
  return (
    <AbsoluteFill data-lime-highlight={frame >= 0 ? 'on' : 'pending'} style={{width, height, overflow: 'hidden'}}>
      <AbsoluteFill style={{opacity: dim}}>{children}</AbsoluteFill>
      {frame > 0
        ? rects.map((rect, index) => {
            const bar = limeBarRect(rect);
            const covered = fractions[index] ?? 0;
            if (covered <= 0) return null;
            const left = bar.x * width;
            const top = bar.y * height;
            return (
              <div
                key={index}
                data-lime-bar={index}
                style={{
                  position: 'absolute',
                  left,
                  top,
                  width: bar.w * width * covered,
                  height: bar.h * height,
                  overflow: 'hidden',
                  isolation: 'isolate',
                  backgroundColor: barColor,
                  borderRadius: Math.round(height * 0.004),
                }}>
                <div style={{position: 'absolute', left: -left, top: -top, width, height, mixBlendMode: 'multiply'}}>{children}</div>
              </div>
            );
          })
        : null}
    </AbsoluteFill>
  );
};
