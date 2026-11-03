/**
 * SUBJECT STAGE behind-layer (S1-S4). Drawn in ShortVideo ABOVE the speaker footage and BELOW SubjectForegroundTrack (the RVM person), so the layer is always "behind her" and it carries ALL the motion:
 *   S1 full plate (opacity 1, covers the room), S2 opaque card behind the head (slow_push), S3 ghost scroll (~0.5, auto_scroll, side feather + warm wash), S4 nothing big + small accents (top band).
 * The room dim for S2-S5 is NOT done here: ShortVideo applies `stageBackdropFilterAt` (brightness only — never CSS blur under the cutout) on the speaker grade.
 * Nothing in here ever moves or filters the subject. No span (or no stage prop) = null.
 */
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';

import type {SubjectStage, SubjectStageAccent, SubjectStageSpan, ZoomTrigger} from '../../blueprintSchema';
import {fontFamily} from '../../motion/fonts';
import {ZoomFrame} from '../ZoomFrame';
import {StageAsset, stageAssetContentHeightPx} from './StageAsset';
import {
  S2_PLACEMENT_DEFAULT,
  STAGE_BEHIND_OPACITY,
  STAGE_TOKENS,
  accentSlotRect,
  accentState,
  autoScrollOffsetPx,
  clamp,
  defaultLineStarts,
  ghostFeatherMask,
  slowPushScale,
  stageSpanAt,
  textStackLineState,
  warmWashGradient,
} from './stageMotion';

type Props = {
  stage?: SubjectStage;
  zoomTriggers?: ZoomTrigger[];
  zoomEnabled?: boolean;
};

const BehindSpan: React.FC<{span: SubjectStageSpan; localSec: number; width: number; height: number}> = ({span, localSec, width, height}) => {
  const stageSec = span.end - span.start;
  const baseOpacity = span.opacity ?? STAGE_BEHIND_OPACITY[span.stage];
  if (span.stage === 'S4' || span.stage === 'S5' || baseOpacity <= 0) return null;

  if (span.stage === 'S1') {
    const scale = span.motion.kind === 'slow_push' ? slowPushScale(localSec, stageSec, span.motion.scalePct) : 1;
    return (
      <AbsoluteFill style={{opacity: baseOpacity, overflow: 'hidden'}}>
        <div style={{position: 'absolute', left: 0, top: 0, width, height, transform: `scale(${scale})`, transformOrigin: '50% 50%'}}>
          <StageAsset asset={span.asset} width={width} height={height} />
        </div>
      </AbsoluteFill>
    );
  }

  if (span.stage === 'S2') {
    const p = span.placement ?? S2_PLACEMENT_DEFAULT;
    const hPct = ('hPct' in p ? p.hPct : undefined) ?? S2_PLACEMENT_DEFAULT.hPct;
    const cardW = (p.wPct / 100) * width;
    const cardH = (hPct / 100) * height;
    const left = (p.xPct / 100) * width - cardW / 2;
    const top = (p.yPct / 100) * height;
    const scale = span.motion.kind === 'slow_push' ? slowPushScale(localSec, stageSec, span.motion.scalePct) : 1;
    return (
      <div style={{position: 'absolute', left, top, width: cardW, height: cardH, opacity: baseOpacity, overflow: 'hidden', borderRadius: Math.round(width * 0.012), boxShadow: '0 18px 50px rgba(0,0,0,0.35)', transform: `scale(${scale})`, transformOrigin: '50% 0%'}}>
        <StageAsset asset={span.asset} width={cardW} height={cardH} />
      </div>
    );
  }

  // S3 ghost scroll: full frame at ~0.5, a tall page scrolling up linearly, feathered toward the subject, with a soft warm wash
  const offset = span.motion.kind === 'auto_scroll' ? autoScrollOffsetPx(localSec, {frameHeightPx: height, pctHPerSec: span.motion.pctPerSec, contentHeightPx: stageAssetContentHeightPx(span.asset, width)}) : 0;
  const mask = ghostFeatherMask(0.5, 0.22);
  return (
    <AbsoluteFill style={{opacity: baseOpacity, overflow: 'hidden', WebkitMaskImage: mask, maskImage: mask}}>
      <div style={{position: 'absolute', left: 0, top: 0, width, height: Math.max(height, stageAssetContentHeightPx(span.asset, width) ?? height * 3), transform: `translateY(${-offset}px)`}}>
        <StageAsset asset={span.asset} width={width} height={height} fit="width" />
      </div>
      {span.wash !== 'none' ? <div style={{position: 'absolute', left: 0, top: 0, width, height, background: warmWashGradient()}} /> : null}
    </AbsoluteFill>
  );
};

const AccentView: React.FC<{accent: SubjectStageAccent; t: number; width: number; height: number}> = ({accent, t, width, height}) => {
  const dur = accent.end - accent.start;
  const slot = accentSlotRect(accent.kind === 'text_stack' ? 2 : accent.slot);
  const box = {left: slot.left * width, top: slot.top * height, width: slot.width * width, height: slot.height * height};
  const lines = (accent.lines ?? []).filter(Boolean);

  if (accent.kind === 'text_stack') {
    const starts = accent.lineStarts && accent.lineStarts.length > 0 ? accent.lineStarts : defaultLineStarts(lines.length, dur);
    const font = clamp(Math.min(box.height / Math.max(2, lines.length) * 0.78, width * 0.075), 20, 90);
    return (
      <div style={{position: 'absolute', ...box, display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', alignItems: 'center', fontFamily: fontFamily('inter'), pointerEvents: 'none'}}>
        {lines.map((line, i) => {
          const s = textStackLineState(t, starts, i, dur);
          return s.visible ? (
            <div key={i} style={{fontSize: font, fontWeight: 900, lineHeight: 1.05, color: STAGE_TOKENS.paper, textShadow: '0 2px 14px rgba(0,0,0,0.55)', opacity: s.opacity, transform: `translateY(${s.translateYEm * font}px)`, whiteSpace: 'nowrap'}}>{line}</div>
          ) : (
            <div key={i} style={{fontSize: font, lineHeight: 1.05, opacity: 0}}>{' '}</div>
          );
        })}
      </div>
    );
  }

  const state = accentState(accent.kind, t, dur);
  if (state.opacity <= 0) return null;
  // the chip never wraps, so its font is fitted to the slot width (text ~0.62 em per glyph + the 0.7 em side padding twice)
  const chars = Math.max(3, Array.from(lines[0] ?? '\u2022').length);
  const font = clamp(Math.min(box.height * 0.34, box.width / (0.62 * chars + 1.4)), 20, 72);
  return (
    <div style={{position: 'absolute', ...box, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none'}}>
      <div
        style={{
          padding: `${font * 0.35}px ${font * 0.7}px`,
          borderRadius: font * 0.3,
          backgroundColor: accent.kind === 'drop_in_tilt' ? STAGE_TOKENS.paper : STAGE_TOKENS.signalHot,
          color: accent.kind === 'drop_in_tilt' ? STAGE_TOKENS.ink : STAGE_TOKENS.paper,
          fontFamily: fontFamily('inter'),
          fontWeight: 900,
          fontSize: font,
          lineHeight: 1.1,
          whiteSpace: 'nowrap',
          boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
          opacity: state.opacity,
          transform: `translateY(${state.translateYFrac * height}px) rotate(${state.rotateDeg}deg) scale(${state.scale})`,
        }}
      >
        {lines[0] ?? '•'}
      </div>
    </div>
  );
};

export const SubjectStageTrack: React.FC<Props> = ({stage, zoomTriggers, zoomEnabled}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  if (!stage) return null;
  const t = frame / fps;
  const span = stageSpanAt(stage.spans, t);
  const accents = stage.accents.filter(accent => t >= accent.start && t < accent.end);
  if (!span && accents.length === 0) return null;
  const layer = (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      {span ? <BehindSpan span={span} localSec={t - span.start} width={width} height={height} /> : null}
      {accents.map((accent, i) => (
        <AccentView key={`${accent.start}-${i}`} accent={accent} t={t - accent.start} width={width} height={height} />
      ))}
    </AbsoluteFill>
  );
  // the plate / card / accents punch in with the same camera as the speaker + the matte, so the stage stays registered to her
  return zoomTriggers ? (
    <ZoomFrame triggers={zoomTriggers} enabled={Boolean(zoomEnabled)}>
      {layer}
    </ZoomFrame>
  ) : (
    layer
  );
};
