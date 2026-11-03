/**
 * Subject-aware text: footage, then text, then the speaker on top (keyed alpha WebM).
 *
 * Genuine only when `resolveSubjectMask` finds an alpha video AND the keyed cutout passed the engine's usability check. Otherwise this track draws
 * nothing, and the plan is expected to have chosen a fallback (panel / clipped text / another placement) earlier. The occupancy ellipse in
 * `lib/subjectMask` is NOT a matte and is never used here.
 */

import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';

import type {BehindSubjectText, KeepSegment, LayoutStyle, ZoomTrigger} from '../blueprintSchema';
import {CurvedText} from '../motion/components/CurvedText';
import {MotionProvider} from '../motion/context';
import {NO_SAFE_AREA} from '../motion/layout';
import {defaultTheme} from '../motion/theme';
import {useMotionFonts} from '../motion/useMotionFonts';
import {keyedCutoutIsUsable, resolveSubjectMask, type SubjectMaskContext, type SubjectMaskProvider} from '../lib/subjectMask';
import {VideoTrack} from './VideoTrack';
import {ZoomFrame} from './ZoomFrame';

export function activeBehindSubjectTextAt(clips: BehindSubjectText[] | undefined, timeSec: number): BehindSubjectText | undefined {
  return clips?.find(clip => timeSec >= clip.start && timeSec < clip.end);
}

/** Whether the compositor can place text behind the speaker for this blueprint. Mirrors the render-time gate exactly. */
export function subjectMatteIsUsable(context: SubjectMaskContext, providers?: SubjectMaskProvider[]): boolean {
  return resolveSubjectMask(context, providers).kind === 'alpha_video' && keyedCutoutIsUsable(context.speakerCutout);
}

type Props = {
  clips: BehindSubjectText[] | undefined;
  talkingHead: React.ReactNode;
  speakerCutout?: SubjectMaskContext['speakerCutout'];
  alphaVideoUrl?: string;
  maskProviders?: SubjectMaskProvider[];
  segments: KeepSegment[];
  layoutStyle: LayoutStyle;
  zoomTriggers: ZoomTrigger[];
  zoomEnabled: boolean;
};

export const TextBehindSubjectTrack: React.FC<Props> = ({clips, talkingHead, speakerCutout, alphaVideoUrl, maskProviders, segments, layoutStyle, zoomTriggers, zoomEnabled}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const clip = activeBehindSubjectTextAt(clips, frame / fps);
  const fontsReady = useMotionFonts((clips ?? []).map(c => c.text).join(' '), (clips ?? []).length > 0);
  const mask = resolveSubjectMask({speakerCutout, alphaVideoUrl}, maskProviders);
  if (!clip || !fontsReady || mask.kind !== 'alpha_video' || !keyedCutoutIsUsable(speakerCutout)) {
    return <>{talkingHead}</>;
  }
  const boxW = Math.round(width * clip.widthFrac);
  const boxH = Math.round(height * clip.heightFrac);
  const local = frame - Math.round(clip.start * fps);
  return (
    <AbsoluteFill>
      {talkingHead}
      <div style={{position: 'absolute', left: (width - boxW) / 2, top: Math.round(height * clip.centerY - boxH / 2), width: boxW, height: boxH}}>
        <MotionProvider theme={defaultTheme} safeArea={NO_SAFE_AREA} width={boxW} height={boxH} idScope="behind-subject-text">
          <CurvedText
            text={clip.text}
            width={boxW}
            height={boxH}
            shape="arc"
            curvature={clip.curvature}
            font={clip.font}
            weight={900}
            uppercase
            fontSize={Math.round(boxH * 0.9)}
            color={clip.color}
            strokeColor={clip.strokeColor}
            strokeWidth={clip.strokeColor ? 4 : 0}
            reveal={clip.reveal}
            progress={clip.reveal === 'none' ? undefined : Math.min(1, Math.max(0, local / Math.round(0.5 * fps)))}
            margin={8}
          />
        </MotionProvider>
      </div>
      <ZoomFrame triggers={zoomTriggers} enabled={zoomEnabled}>
        <VideoTrack src={mask.videoUrl} segments={segments} layoutStyle={layoutStyle} transparent muted />
      </ZoomFrame>
    </AbsoluteFill>
  );
};
