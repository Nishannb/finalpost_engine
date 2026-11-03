/**
 * SUBJECT STAGE front layer (S5 foreground takeover + the flash_cut). Drawn in ShortVideo ABOVE SubjectForegroundTrack, i.e. in front of the person; almost nothing else sits there (emphasis, transitions,
 * FX, captions, hook are all drawn after it).
 *   S5: slide_up_front (~300 ms) of an asset covering the WHOLE frame edge to edge (100 % x 100 %), held full-bleed, hard-capped at S5_MAX_DURATION_SEC, then a hard cut out.
 *   flash_cut: a 70-100 ms white pulse on any span whose `enter` is 'flash_cut' (a topic jump).
 * No stage / no S5 span / no flash = null.
 */
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';

import type {SubjectStage} from '../../blueprintSchema';
import {StageAsset} from './StageAsset';
import {S5_COVERAGE_PCT, flashCutOpacity, slideUpFrontState, stageSpanAt} from './stageMotion';

export const SubjectStageFront: React.FC<{stage?: SubjectStage}> = ({stage}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  if (!stage) return null;
  const t = frame / fps;
  const span = stageSpanAt(stage.spans, t);
  const flash = span && span.enter === 'flash_cut' ? flashCutOpacity(t - span.start) : 0;
  const takeover = span && span.stage === 'S5' ? slideUpFrontState(t - span.start, span.end - span.start) : undefined;
  if (!takeover?.visible && flash <= 0) return null;
  // FULL takeover: the asset covers the whole frame, edge to edge (S5_COVERAGE_PCT = 100): no side gutters, no rounded floating card, no strip of subject or room left at the bottom.
  const coverW = (S5_COVERAGE_PCT / 100) * width;
  const coverH = (S5_COVERAGE_PCT / 100) * height;
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      {takeover?.visible && span ? (
        <div
          style={{
            position: 'absolute',
            left: (width - coverW) / 2,
            top: (height - coverH) / 2,
            width: coverW,
            height: coverH,
            overflow: 'hidden',
            // a takeover is OPAQUE whatever a span says: nothing of the subject or the room may show through it
            opacity: 1,
            // slides UP from below the frame to full coverage; the hold frame is the whole frame
            transform: `translateY(${takeover.offsetFrac * height}px)`,
          }}
        >
          <StageAsset asset={span.asset} width={coverW} height={coverH} />
        </div>
      ) : null}
      {flash > 0 ? <AbsoluteFill style={{backgroundColor: '#FFFFFF', opacity: flash}} /> : null}
    </AbsoluteFill>
  );
};
