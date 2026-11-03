/**
 * The art-directed opening (blueprint.openingTreatment). Frame 0 is a finished composition: the text, its panel and its outline are fully visible
 * on the very first frame. Animation only adds an accent-bar mask reveal, a small settle and an exit fade, so pausing at timestamp zero never shows
 * an empty or half-built title.
 *
 * Built from the motion toolkit: CurvedText (curved), FitText (plain), LayeredText + MaskReveal (layered / accent). Shape clipping only; nothing here
 * claims subject-aware depth.
 */

import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';

import type {OpeningTreatmentSpec} from '../blueprintSchema';
import {CurvedText} from '../motion/components/CurvedText';
import {LayeredText, MaskReveal} from '../motion/components/MaskedText';
import {FitText} from '../motion/components/Text';
import {fitTextGroup} from '../motion/text';
import {MotionProvider} from '../motion/context';
import {layoutCurvedText} from '../motion/curvedText';
import {NO_SAFE_AREA} from '../motion/layout';
import {defaultTheme} from '../motion/theme';
import {useMotionFonts} from '../motion/useMotionFonts';
import {exitProgress, progress} from '../motion/animation';
import {openingBox} from '../lib/openingGeometry';

const MARGIN = 28;

export const OpeningTreatment: React.FC<{spec: OpeningTreatmentSpec}> = ({spec}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const fontsReady = useMotionFonts(spec.text);
  const boxW = Math.round(width * spec.widthFrac);
  const boxH = Math.round(height * spec.heightFrac);
  const box = openingBox(spec);
  const left = Math.round(width * box.x);
  const top = Math.round(height * box.y);
  const hold = Math.round(spec.durationSec * fps);
  const fade = exitProgress(frame, hold, 8);
  const settle = 1 + 0.05 * (1 - progress(frame, 0, 12, 'out'));
  const theme = {...defaultTheme, text: spec.textColor, accent: spec.accentColor};
  const padX = spec.panel ? Math.round(boxW * 0.04) : 0;
  const padY = spec.panel ? Math.round(boxH * 0.1) : 0;
  const innerW = boxW - 2 * padX;
  const innerH = boxH - 2 * padY;
  // Only the plain kind carries the accent bar; its height is taken out of the text box so the bar never crosses the type.
  const barH = spec.kind === 'plain' || spec.kind === 'mask_reveal' ? Math.max(6, Math.round(boxH * 0.045)) : 0;
  const barGap = barH ? Math.round(barH * 1.8) : 0;
  const textH = innerH - barH - barGap;

  if (!fontsReady) {
    return null;
  }

  const outline = spec.strokeColor ? {WebkitTextStroke: `${Math.max(2, Math.round(boxH * 0.022))}px ${spec.strokeColor}`, paintOrder: 'stroke fill'} : {};
  const shadow = spec.strokeColor || spec.panel ? {} : {textShadow: '0 4px 14px rgba(0,0,0,0.55)'};

  // A curved opening that cannot fit legibly falls back to straight text rather than shipping tiny or clipped type.
  const curveLayout =
    spec.kind === 'curved' && spec.curve
      ? layoutCurvedText({text: spec.text, width: innerW, height: innerH, shape: spec.curve.shape, curvature: spec.curve.curvature, direction: spec.curve.direction, rotationDeg: spec.curve.rotationDeg, font: theme.fontDisplay, weight: spec.weight, fontSize: Math.round(innerH * 0.8), uppercase: true, margin: MARGIN / 2})
      : null;
  const useCurve = Boolean(curveLayout && !curveLayout.clipped && curveLayout.legible);

  // mask_reveal: the lead line is fully visible from frame 0 (a paused first frame is a finished composition); the second line is revealed THROUGH a mask.
  const revealRows = spec.kind === 'mask_reveal' && spec.lines ? spec.lines : null;
  const rowH = Math.floor(textH / 2);
  const revealSize = revealRows
    ? fitTextGroup([...revealRows], {width: innerW, height: rowH, maxLines: 1, font: theme.fontDisplay, weight: spec.weight, uppercase: true, lineHeight: 1.02})
    : 0;
  const rowText = (value: string) => (
    <FitText text={value} width={innerW} height={rowH} maxLines={1} maxFontSize={revealSize} minFontSize={revealSize} font={spec.font} weight={spec.weight} color={spec.textColor} align={spec.align} uppercase lineHeight={1.02} style={{...outline, ...shadow}} />
  );

  const text = revealRows ? (
    <div style={{width: innerW, height: textH}}>
      <div style={{height: rowH}}>{rowText(revealRows[0])}</div>
      <MaskReveal kind={spec.textReveal ?? 'wipe-right'} width={innerW} height={rowH} delay={6} duration={14}>
        {rowText(revealRows[1])}
      </MaskReveal>
    </div>
  ) : useCurve ? (
    <CurvedText
      text={spec.text}
      width={innerW}
      height={innerH}
      shape={spec.curve!.shape}
      curvature={spec.curve!.curvature}
      direction={spec.curve!.direction}
      rotationDeg={spec.curve!.rotationDeg}
      font={spec.font}
      weight={spec.weight}
      fontSize={Math.round(innerH * 0.8)}
      uppercase
      color={spec.textColor}
      strokeColor={spec.strokeColor}
      strokeWidth={spec.strokeColor ? Math.max(2, Math.round(innerH * 0.02)) : 0}
      shadow={!spec.strokeColor && !spec.panel}
      margin={MARGIN / 2}
    />
  ) : (
    <FitText
      text={spec.text}
      width={innerW}
      height={textH}
      maxLines={2}
      font={spec.font}
      weight={spec.weight}
      color={spec.textColor}
      align={spec.align}
      uppercase
      lineHeight={1.02}
      style={{...outline, ...shadow}}
    />
  );

  const accentBar = (
    <MaskReveal kind={spec.accentReveal ?? 'wipe-right'} width={Math.round(innerW * 0.5)} height={barH || 6} delay={4} duration={14} progress={spec.kind === 'mask_reveal' ? 1 : undefined}>
      <div style={{width: '100%', height: '100%', background: spec.accentColor, borderRadius: 999}} />
    </MaskReveal>
  );

  const body =
    spec.kind === 'layered' ? (
      <LayeredText
        width={boxW}
        height={boxH}
        background={<div style={{position: 'absolute', inset: 0, background: spec.panel?.color ?? '#000000', opacity: spec.panel?.opacity ?? 0.8, borderRadius: Math.round(boxH * 0.14)}} />}
        text={<div style={{position: 'absolute', left: padX, top: padY}}>{text}</div>}
        foreground={<div style={{position: 'absolute', left: 0, top: 0, width: Math.round(boxW * 0.022), height: boxH, background: spec.accentColor, borderRadius: 999}} />}
        foregroundRegion={{x: 0, y: 0, width: Math.round(boxW * 0.03), height: boxH, shape: 'rect'}}
      />
    ) : (
      <div style={{position: 'relative', width: boxW, height: boxH}}>
        {spec.panel ? <div style={{position: 'absolute', inset: 0, background: spec.panel.color, opacity: spec.panel.opacity, borderRadius: Math.round(boxH * 0.14)}} /> : null}
        <div style={{position: 'absolute', left: padX, top: padY}}>{text}</div>
        {barH ? <div style={{position: 'absolute', left: padX + (spec.align === 'center' ? Math.round(innerW * 0.25) : 0), top: padY + textH + barGap}}>{accentBar}</div> : null}
      </div>
    );

  return (
    <div style={{position: 'absolute', left, top, width: boxW, height: boxH, opacity: fade, transform: `scale(${settle})`, transformOrigin: 'center'}}>
      <MotionProvider theme={theme} safeArea={NO_SAFE_AREA} width={boxW} height={boxH} idScope="opening">
        {body}
      </MotionProvider>
    </div>
  );
};
