/**
 * SUBJECT STAGE front layer (S5 foreground takeover + the flash_cut). Drawn in ShortVideo ABOVE SubjectForegroundTrack, i.e. in front of the person; almost nothing else sits there (emphasis, transitions,
 * FX, captions, hook are all drawn after it).
 *   S5: slide_up_front (~300 ms) of an asset covering the WHOLE frame edge to edge (100 % x 100 %), held full-bleed, hard-capped at S5_MAX_DURATION_SEC, then a hard cut out.
 *   flash_cut: a 70-100 ms white pulse on any span whose `enter` is 'flash_cut' (a topic jump).
 * No stage / no S5 span / no flash = null. Phase 5.23: an S5 span that is not a valid interruption (validInterruption) is never drawn.
 */
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';

import type {SubjectStage, SubjectStageCutaway} from '../../blueprintSchema';
import {StageAsset} from './StageAsset';
import {S5_COVERAGE_PCT, flashCutOpacity, slideUpFrontState, spanDependsOnMatte, spanDrawsFront, stageCutawayAt, stageSpanAt, validInterruption} from './stageMotion';
import {ChapterTab, SourceCard, StageCutaway} from './EditorialTreatments';

/**
 * Phase 5.24: `degraded` = the person cutout is missing at render time (ShortVideo mounts this with the degraded stage): only matte-INDEPENDENT elements are drawn (a front design that does not
 * need the matte, a valid S5, the stage's own cutaways); no flash. Front designs (chapter tab, front card) and the stage's cutaways are drawn here, above the person.
 */
export const SubjectStageFront: React.FC<{stage?: SubjectStage; degraded?: boolean}> = ({stage, degraded = false}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  if (!stage) return null;
  const t = frame / fps;
  const span = stageSpanAt(stage.spans, t);
  const flash = !degraded && span && span.enter === 'flash_cut' ? flashCutOpacity(t - span.start) : 0;
  // Phase 5.23: only an explicitly authorised, complete S5 may cover the person (validInterruption); anything else is not drawn and the person stays visible
  const takeover = span && span.stage === 'S5' && validInterruption(span) ? slideUpFrontState(t - span.start, span.end - span.start) : undefined;
  const front = span && span.design && spanDrawsFront(span) && (!degraded || !spanDependsOnMatte(span)) ? span.design : undefined;
  // stageCutawayAt returns the payload's own cutaway object (a validated, explicitly planned entry)
  const cutaway = stageCutawayAt(stage, t) as SubjectStageCutaway | undefined;
  if (!takeover?.visible && flash <= 0 && !front && !cutaway) return null;
  const local = span ? Math.round((t - span.start) * fps) : 0;
  const total = span ? Math.round((span.end - span.start) * fps) : 0;
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
      {front && front.kind === 'set' ? <ChapterTab design={front} look={stage.look} frame={local} total={total} /> : null}
      {front && front.kind === 'source_card' ? <SourceCard design={front} look={stage.look} t={t} frame={local} total={total} /> : null}
      {flash > 0 ? <AbsoluteFill style={{backgroundColor: '#FFFFFF', opacity: flash}} /> : null}
      {cutaway ? <StageCutaway cutaway={cutaway} t={t - cutaway.start} look={stage.look} /> : null}
    </AbsoluteFill>
  );
};
