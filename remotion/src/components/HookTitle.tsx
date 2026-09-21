/**
 * Opening hook — a short title timed to the first spoken words.
 * Each styleId is a distinct treatment so two videos never share one look.
 */

import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

import type {
  HookStyle,
  LanguageCode,
  NorthStarDesign,
  VisualAnchor,
} from '../blueprintSchema';
import {fontFamilyFor, fontWeightFor, hookDisplayFamily} from '../styles/fonts';

type HookTitleProps = {
  title: string;
  subtitle?: string;
  durationSec: number;
  language: LanguageCode;
  styleId?: HookStyle;
  anchor?: VisualAnchor;
  design?: NorthStarDesign;
};

type Palette = {
  ink: string;
  accent: string;
  surface: string;
  muted: string;
};

export const HookTitle: React.FC<HookTitleProps> = ({
  title,
  subtitle,
  durationSec,
  language,
  styleId = 'impact',
  anchor = 'top_right',
  design,
}) => {
  const frame = useCurrentFrame();
  const {fps, width, height, durationInFrames} = useVideoConfig();
  const holdFrames = Math.min(
    durationInFrames,
    Math.max(1, Math.round(Math.max(1.2, durationSec) * fps)),
  );
  const trimmed = title.trim();
  if (!trimmed || frame >= holdFrames) {
    return null;
  }

  const enter = spring({
    frame,
    fps,
    config:
      styleId === 'impact'
        ? {damping: 14, mass: 0.7, stiffness: 160}
        : styleId === 'poster'
          ? {damping: 18, mass: 1.1, stiffness: 70}
          : {damping: 22, mass: 1.05, stiffness: 80},
    durationInFrames: Math.round((styleId === 'impact' ? 0.55 : 0.95) * fps),
  });
  const fadeOut = interpolate(
    frame,
    [Math.max(0, holdFrames - Math.round(0.45 * fps)), holdFrames],
    [1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );
  const palette = paletteFor(trimmed, styleId, design);
  const split = splitTitle(trimmed);
  const fontFamily = hookDisplayFamily(language, styleId, design);
  const slot = slotFor(anchor, width, height, styleId);
  const titleSize = Math.round(width * sizeFrac(styleId, trimmed.length));
  const typed = typeOn(trimmed, enter, styleId === 'bar' || styleId === 'underline');
  const wipe = interpolate(enter, [0, 1], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{pointerEvents: 'none', zIndex: 18}}>
      {styleId === 'bar' ? (
        <FullBar
          slotTop={height * 0.055}
          width={width}
          height={height}
          enter={enter}
          fadeOut={fadeOut}
          palette={palette}
          fontFamily={fontFamily}
          language={language}
          titleSize={titleSize}
          typed={typed}
          rest={trimmed.slice(typed.length)}
          subtitle={subtitle}
          wipe={wipe}
        />
      ) : styleId === 'impact' ? (
        <ImpactTitle
          width={width}
          height={height}
          enter={enter}
          fadeOut={fadeOut}
          palette={palette}
          fontFamily={fontFamily}
          titleSize={titleSize}
          split={split}
          subtitle={subtitle}
          language={language}
        />
      ) : styleId === 'outline' ? (
        <OutlineTitle
          width={width}
          height={height}
          enter={enter}
          fadeOut={fadeOut}
          palette={palette}
          fontFamily={fontFamily}
          titleSize={titleSize}
          title={trimmed}
          subtitle={subtitle}
          language={language}
        />
      ) : styleId === 'poster' ? (
        <PosterTitle
          width={width}
          height={height}
          enter={enter}
          fadeOut={fadeOut}
          palette={palette}
          fontFamily={fontFamily}
          titleSize={titleSize}
          title={trimmed}
          subtitle={subtitle}
          language={language}
        />
      ) : styleId === 'stack' ? (
        <StackTitle
          slot={slot}
          enter={enter}
          fadeOut={fadeOut}
          palette={palette}
          fontFamily={fontFamily}
          language={language}
          width={width}
          height={height}
          split={split}
          subtitle={subtitle}
        />
      ) : styleId === 'duo' ? (
        <DuoTitle
          slot={slot}
          enter={enter}
          fadeOut={fadeOut}
          palette={palette}
          fontFamily={fontFamily}
          language={language}
          width={width}
          titleSize={titleSize}
          split={split}
          subtitle={subtitle}
        />
      ) : styleId === 'underline' ? (
        <UnderlineTitle
          slot={slot}
          enter={enter}
          fadeOut={fadeOut}
          palette={palette}
          fontFamily={fontFamily}
          language={language}
          width={width}
          titleSize={titleSize}
          typed={typed}
          rest={trimmed.slice(typed.length)}
          subtitle={subtitle}
          wipe={wipe}
        />
      ) : styleId === 'minimal' ? (
        <MinimalTitle
          slot={slot}
          enter={enter}
          fadeOut={fadeOut}
          palette={palette}
          fontFamily={fontFamily}
          language={language}
          width={width}
          titleSize={Math.round(width * 0.034)}
          title={trimmed}
          subtitle={subtitle}
        />
      ) : styleId === 'rail' ? (
        <RailTitle
          slot={slot}
          enter={enter}
          fadeOut={fadeOut}
          palette={palette}
          fontFamily={fontFamily}
          language={language}
          width={width}
          height={height}
          titleSize={titleSize}
          title={trimmed}
          subtitle={subtitle}
        />
      ) : (
        <BoxedTitle
          slot={slot}
          enter={enter}
          fadeOut={fadeOut}
          palette={palette}
          fontFamily={fontFamily}
          language={language}
          width={width}
          height={height}
          titleSize={titleSize}
          title={trimmed}
          subtitle={subtitle}
          design={design}
        />
      )}
    </AbsoluteFill>
  );
};

function FullBar({
  slotTop,
  width,
  height,
  enter,
  fadeOut,
  palette,
  fontFamily,
  language,
  titleSize,
  typed,
  rest,
  subtitle,
  wipe,
}: {
  slotTop: number;
  width: number;
  height: number;
  enter: number;
  fadeOut: number;
  palette: Palette;
  fontFamily: string;
  language: LanguageCode;
  titleSize: number;
  typed: string;
  rest: string;
  subtitle?: string;
  wipe: number;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        top: slotTop,
        left: 0,
        right: 0,
        opacity: fadeOut,
        transform: `translateY(${interpolate(enter, [0, 1], [-24, 0])}px)`,
        backgroundColor: palette.accent,
        padding: `${height * 0.018}px ${width * 0.06}px`,
        overflow: 'hidden',
      }}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: `${wipe * 100}%`,
          backgroundColor: palette.surface,
          opacity: 0.18,
        }}
      />
      <div
        style={{
          position: 'relative',
          fontFamily,
          fontWeight: 700,
          fontSize: titleSize,
          lineHeight: 1.05,
          color: palette.ink,
          textTransform: 'uppercase',
          letterSpacing: -0.6,
        }}>
        {typed}
        <span style={{opacity: 0}}>{rest}</span>
      </div>
      {subtitle?.trim() ? (
        <div
          style={{
            marginTop: 6,
            fontFamily: fontFamilyFor(language, 'sans'),
            fontWeight: fontWeightFor(language, 'sans'),
            fontSize: Math.round(width * 0.02),
            color: palette.ink,
            opacity: 0.72,
            letterSpacing: 1.4,
            textTransform: 'uppercase',
          }}>
          {subtitle}
        </div>
      ) : null}
    </div>
  );
}

function ImpactTitle({
  width,
  height,
  enter,
  fadeOut,
  palette,
  fontFamily,
  titleSize,
  split,
  subtitle,
  language,
}: {
  width: number;
  height: number;
  enter: number;
  fadeOut: number;
  palette: Palette;
  fontFamily: string;
  titleSize: number;
  split: {lead: string; punch: string};
  subtitle?: string;
  language: LanguageCode;
}) {
  const scale = interpolate(enter, [0, 1], [1.28, 1]);
  return (
    <div
      style={{
        position: 'absolute',
        top: height * 0.1,
        left: width * 0.06,
        right: width * 0.06,
        opacity: fadeOut,
        transform: `scale(${scale})`,
        transformOrigin: '50% 0%',
        textAlign: 'center',
      }}>
      <div
        style={{
          fontFamily,
          fontWeight: 400,
          fontSize: titleSize,
          lineHeight: 0.92,
          textTransform: 'uppercase',
          letterSpacing: -1.4,
          color: palette.ink,
          WebkitTextStroke: `${Math.max(2, width * 0.0035)}px ${palette.surface}`,
          textShadow: `0 10px 0 ${palette.surface}, 0 18px 40px rgba(0,0,0,0.45)`,
        }}>
        {split.lead ? (
          <>
            <span>{split.lead} </span>
            <span style={{color: palette.accent}}>{split.punch}</span>
          </>
        ) : (
          split.punch
        )}
      </div>
      {subtitle?.trim() ? (
        <div
          style={{
            marginTop: height * 0.012,
            fontFamily: fontFamilyFor(language, 'sans'),
            fontSize: Math.round(width * 0.022),
            color: palette.muted,
            letterSpacing: 3,
            textTransform: 'uppercase',
          }}>
          {subtitle}
        </div>
      ) : null}
    </div>
  );
}

function OutlineTitle({
  width,
  height,
  enter,
  fadeOut,
  palette,
  fontFamily,
  titleSize,
  title,
  subtitle,
  language,
}: {
  width: number;
  height: number;
  enter: number;
  fadeOut: number;
  palette: Palette;
  fontFamily: string;
  titleSize: number;
  title: string;
  subtitle?: string;
  language: LanguageCode;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        top: height * 0.12,
        left: width * 0.07,
        right: width * 0.07,
        opacity: fadeOut,
        transform: `translateY(${interpolate(enter, [0, 1], [18, 0])}px)`,
        textAlign: 'center',
      }}>
      <div
        style={{
          fontFamily,
          fontWeight: 400,
          fontSize: titleSize,
          lineHeight: 0.95,
          textTransform: 'uppercase',
          letterSpacing: -0.8,
          color: 'transparent',
          WebkitTextStroke: `${Math.max(2, width * 0.004)}px ${palette.accent}`,
        }}>
        {title}
      </div>
      {subtitle?.trim() ? (
        <div
          style={{
            marginTop: 10,
            fontFamily: fontFamilyFor(language, 'sans'),
            fontSize: Math.round(width * 0.02),
            color: palette.ink,
            letterSpacing: 4,
            textTransform: 'uppercase',
          }}>
          {subtitle}
        </div>
      ) : null}
    </div>
  );
}

function PosterTitle({
  width,
  height,
  enter,
  fadeOut,
  palette,
  fontFamily,
  titleSize,
  title,
  subtitle,
  language,
}: {
  width: number;
  height: number;
  enter: number;
  fadeOut: number;
  palette: Palette;
  fontFamily: string;
  titleSize: number;
  title: string;
  subtitle?: string;
  language: LanguageCode;
}) {
  const tilt = interpolate(enter, [0, 1], [-7, -1.5]);
  return (
    <div
      style={{
        position: 'absolute',
        top: height * 0.09,
        left: width * 0.1,
        right: width * 0.1,
        opacity: fadeOut,
        transform: `rotate(${tilt}deg) scale(${0.94 + enter * 0.06})`,
        backgroundColor: palette.surface,
        color: palette.ink,
        padding: `${height * 0.028}px ${width * 0.04}px`,
        boxShadow: '0 22px 50px rgba(0,0,0,0.28)',
      }}>
      <div
        style={{
          fontFamily: fontFamilyFor(language, 'sans'),
          fontSize: Math.round(width * 0.018),
          letterSpacing: 4,
          textTransform: 'uppercase',
          color: palette.accent,
          marginBottom: 8,
        }}>
        {subtitle?.trim() || 'Watch'}
      </div>
      <div
        style={{
          fontFamily,
          fontWeight: 700,
          fontSize: titleSize,
          lineHeight: 1.05,
          textTransform: 'none',
        }}>
        {title}
      </div>
    </div>
  );
}

function StackTitle({
  slot,
  enter,
  fadeOut,
  palette,
  fontFamily,
  language,
  width,
  height,
  split,
  subtitle,
}: {
  slot: Slot;
  enter: number;
  fadeOut: number;
  palette: Palette;
  fontFamily: string;
  language: LanguageCode;
  width: number;
  height: number;
  split: {lead: string; punch: string};
  subtitle?: string;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        top: slot.top,
        left: slot.left,
        right: slot.right,
        width: slot.width,
        opacity: fadeOut,
        transform: `translateX(${interpolate(enter, [0, 1], [slot.fromX, 0])}px)`,
      }}>
      <div
        style={{
          fontFamily: fontFamilyFor(language, 'sans'),
          fontWeight: 700,
          fontSize: Math.round(width * 0.022),
          letterSpacing: 3,
          textTransform: 'uppercase',
          color: palette.muted,
          marginBottom: 6,
        }}>
        {split.lead || subtitle || ''}
      </div>
      <div
        style={{
          fontFamily,
          fontWeight: 700,
          fontSize: Math.round(width * 0.072),
          lineHeight: 0.9,
          color: palette.ink,
          textTransform: 'none',
          textShadow: '0 6px 24px rgba(0,0,0,0.35)',
        }}>
        {split.punch}
      </div>
      <div
        style={{
          marginTop: height * 0.01,
          width: interpolate(enter, [0.2, 1], [0, width * 0.18]),
          height: 4,
          backgroundColor: palette.accent,
        }}
      />
    </div>
  );
}

function DuoTitle({
  slot,
  enter,
  fadeOut,
  palette,
  fontFamily,
  language,
  width,
  titleSize,
  split,
  subtitle,
}: {
  slot: Slot;
  enter: number;
  fadeOut: number;
  palette: Palette;
  fontFamily: string;
  language: LanguageCode;
  width: number;
  titleSize: number;
  split: {lead: string; punch: string};
  subtitle?: string;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        top: slot.top,
        left: slot.left,
        right: slot.right,
        width: slot.width,
        opacity: fadeOut,
        transform: `translateX(${interpolate(enter, [0, 1], [slot.fromX, 0])}px) scale(${0.94 + enter * 0.06})`,
        transformOrigin: slot.origin,
      }}>
      <div
        style={{
          fontFamily,
          fontWeight: 400,
          fontSize: titleSize,
          lineHeight: 1.02,
          textTransform: 'uppercase',
          letterSpacing: -0.8,
        }}>
        <span style={{color: palette.ink}}>{split.lead ? `${split.lead} ` : ''}</span>
        <span
          style={{
            color: palette.surface,
            backgroundColor: palette.accent,
            padding: '0 0.12em',
          }}>
          {split.punch}
        </span>
      </div>
      {subtitle?.trim() ? (
        <div
          style={{
            marginTop: 8,
            fontFamily: fontFamilyFor(language, 'sans'),
            fontSize: Math.round(width * 0.02),
            color: palette.muted,
            letterSpacing: 2,
            textTransform: 'uppercase',
          }}>
          {subtitle}
        </div>
      ) : null}
    </div>
  );
}

function UnderlineTitle({
  slot,
  enter,
  fadeOut,
  palette,
  fontFamily,
  language,
  width,
  titleSize,
  typed,
  rest,
  subtitle,
  wipe,
}: {
  slot: Slot;
  enter: number;
  fadeOut: number;
  palette: Palette;
  fontFamily: string;
  language: LanguageCode;
  width: number;
  titleSize: number;
  typed: string;
  rest: string;
  subtitle?: string;
  wipe: number;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        top: slot.top,
        left: slot.left,
        right: slot.right,
        width: slot.width,
        opacity: fadeOut,
        transform: `translateY(${interpolate(enter, [0, 1], [12, 0])}px)`,
      }}>
      <div
        style={{
          fontFamily,
          fontWeight: 800,
          fontSize: titleSize,
          lineHeight: 1.1,
          color: palette.ink,
          textTransform: 'none',
          letterSpacing: -0.4,
          textShadow: '0 2px 16px rgba(0,0,0,0.4)',
          display: 'inline-block',
        }}>
        {typed}
        <span style={{opacity: 0}}>{rest}</span>
        <div
          style={{
            marginTop: 6,
            height: 5,
            width: `${wipe * 100}%`,
            backgroundColor: palette.accent,
            borderRadius: 99,
          }}
        />
      </div>
      {subtitle?.trim() ? (
        <div
          style={{
            marginTop: 8,
            fontFamily: fontFamilyFor(language, 'sans'),
            fontSize: Math.round(width * 0.02),
            color: palette.muted,
          }}>
          {subtitle}
        </div>
      ) : null}
    </div>
  );
}

function MinimalTitle({
  slot,
  enter,
  fadeOut,
  palette,
  fontFamily,
  language,
  width,
  titleSize,
  title,
  subtitle,
}: {
  slot: Slot;
  enter: number;
  fadeOut: number;
  palette: Palette;
  fontFamily: string;
  language: LanguageCode;
  width: number;
  titleSize: number;
  title: string;
  subtitle?: string;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        top: slot.top,
        left: slot.left,
        right: slot.right,
        width: slot.width,
        opacity: fadeOut * interpolate(enter, [0, 1], [0, 1]),
      }}>
      <div
        style={{
          fontFamily,
          fontWeight: 600,
          fontSize: titleSize,
          lineHeight: 1.2,
          color: palette.ink,
          letterSpacing: 1.6,
          textTransform: 'none',
          textShadow: '0 2px 14px rgba(0,0,0,0.45)',
        }}>
        {title}
      </div>
      {subtitle?.trim() ? (
        <div
          style={{
            marginTop: 6,
            fontFamily: fontFamilyFor(language, 'sans'),
            fontSize: Math.round(width * 0.018),
            color: palette.muted,
            letterSpacing: 2,
          }}>
          {subtitle}
        </div>
      ) : null}
    </div>
  );
}

function RailTitle({
  slot,
  enter,
  fadeOut,
  palette,
  fontFamily,
  language,
  width,
  height,
  titleSize,
  title,
  subtitle,
}: {
  slot: Slot;
  enter: number;
  fadeOut: number;
  palette: Palette;
  fontFamily: string;
  language: LanguageCode;
  width: number;
  height: number;
  titleSize: number;
  title: string;
  subtitle?: string;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        top: slot.top,
        left: slot.left,
        right: slot.right,
        width: slot.width,
        opacity: fadeOut,
        transform: `translateX(${interpolate(enter, [0, 1], [slot.fromX, 0])}px)`,
        paddingLeft: 16,
      }}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 6,
          backgroundColor: palette.accent,
          transform: `scaleY(${enter})`,
          transformOrigin: '50% 0%',
        }}
      />
      <div
        style={{
          fontFamily,
          fontWeight: 700,
          fontSize: titleSize,
          lineHeight: 1.08,
          color: palette.ink,
          textTransform: 'uppercase',
          letterSpacing: -0.4,
          textShadow: '0 3px 16px rgba(0,0,0,0.4)',
        }}>
        {title}
      </div>
      {subtitle?.trim() ? (
        <div
          style={{
            marginTop: height * 0.006,
            fontFamily: fontFamilyFor(language, 'sans'),
            fontSize: Math.round(width * 0.02),
            color: palette.muted,
            letterSpacing: 2,
            textTransform: 'uppercase',
          }}>
          {subtitle}
        </div>
      ) : null}
    </div>
  );
}

function BoxedTitle({
  slot,
  enter,
  fadeOut,
  palette,
  fontFamily,
  language,
  width,
  height,
  titleSize,
  title,
  subtitle,
  design,
}: {
  slot: Slot;
  enter: number;
  fadeOut: number;
  palette: Palette;
  fontFamily: string;
  language: LanguageCode;
  width: number;
  height: number;
  titleSize: number;
  title: string;
  subtitle?: string;
  design?: NorthStarDesign;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        top: slot.top,
        left: slot.left,
        right: slot.right,
        width: slot.width,
        opacity: fadeOut,
        transform: `translateX(${interpolate(enter, [0, 1], [slot.fromX, 0])}px) scale(${0.92 + enter * 0.08})`,
        transformOrigin: slot.origin,
        backgroundColor: palette.surface,
        borderRadius: design?.cornerRadius ?? 18,
        padding: `${height * 0.014}px ${width * 0.024}px`,
        boxShadow: `0 16px 36px rgba(0,0,0,0.32), inset 0 0 0 2px ${palette.accent}55`,
      }}>
      <div
        style={{
          fontFamily,
          fontWeight: fontWeightFor(language, 'impact', design),
          fontSize: titleSize,
          lineHeight: 1.12,
          color: palette.ink,
          textTransform: 'uppercase',
          letterSpacing: -0.4,
        }}>
        {title}
      </div>
      {subtitle?.trim() ? (
        <div
          style={{
            marginTop: height * 0.006,
            fontFamily: fontFamilyFor(language, 'sans', design),
            fontWeight: fontWeightFor(language, 'sans', design),
            fontSize: Math.round(width * 0.02),
            color: palette.muted,
            textTransform: 'uppercase',
            letterSpacing: 1.2,
          }}>
          {subtitle}
        </div>
      ) : null}
    </div>
  );
}

type Slot = {
  top?: number;
  left?: number;
  right?: number;
  width: number;
  fromX: number;
  origin: string;
};

function slotFor(
  anchor: VisualAnchor,
  width: number,
  height: number,
  styleId: HookStyle,
): Slot {
  const wide = styleId === 'stack' || styleId === 'duo' || styleId === 'underline';
  const boxW = width * (wide ? 0.78 : 0.42);
  const top = height * (styleId === 'minimal' ? 0.07 : 0.05);
  const bottom = height * 0.3;
  const inset = width * 0.045;
  if (anchor === 'top_left' || anchor === 'top') {
    return {top, left: inset, width: boxW, fromX: -36, origin: '0% 0%'};
  }
  if (anchor === 'bottom_left') {
    return {
      top: height - bottom - height * 0.14,
      left: inset,
      width: boxW,
      fromX: -36,
      origin: '0% 100%',
    };
  }
  if (anchor === 'bottom_right' || anchor === 'bottom') {
    return {
      top: height - bottom - height * 0.14,
      right: inset,
      width: boxW,
      fromX: 36,
      origin: '100% 100%',
    };
  }
  return {top, right: inset, width: boxW, fromX: 36, origin: '100% 0%'};
}

function sizeFrac(styleId: HookStyle, length: number): number {
  const long = length > 28 ? 0.78 : length > 18 ? 0.9 : 1;
  if (styleId === 'impact' || styleId === 'outline') {
    return 0.078 * long;
  }
  if (styleId === 'poster') {
    return 0.056 * long;
  }
  if (styleId === 'bar') {
    return 0.038 * long;
  }
  if (styleId === 'duo') {
    return 0.048 * long;
  }
  return 0.042 * long;
}

function splitTitle(title: string): {lead: string; punch: string} {
  const words = title.trim().split(/\s+/);
  if (words.length < 2) {
    return {lead: '', punch: title.trim()};
  }
  return {lead: words.slice(0, -1).join(' '), punch: words.at(-1)!};
}

function typeOn(title: string, enter: number, enabled: boolean): string {
  if (!enabled) {
    return title;
  }
  return title.slice(
    0,
    Math.round(
      interpolate(enter, [0.12, 0.9], [0, title.length], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      }),
    ),
  );
}

function paletteFor(title: string, styleId: HookStyle, design?: NorthStarDesign): Palette {
  if (design?.enabled) {
    return {
      ink: design.inkColor,
      accent: design.primaryColor,
      surface: design.surfaceColor,
      muted: design.inkColor,
    };
  }
  const palettes: Palette[] = [
    {ink: '#FFFFFF', accent: '#FFE14A', surface: '#0B0B0F', muted: '#D4D4D8'},
    {ink: '#111111', accent: '#EA580C', surface: '#FFF7ED', muted: '#9A3412'},
    {ink: '#F8FAFC', accent: '#38BDF8', surface: '#0F172A', muted: '#94A3B8'},
    {ink: '#FAF5FF', accent: '#E879F9', surface: '#2E1065', muted: '#D8B4FE'},
    {ink: '#ECFDF5', accent: '#34D399', surface: '#022C22', muted: '#6EE7B7'},
    {ink: '#FFF1F2', accent: '#FB7185', surface: '#1C1917', muted: '#FDA4AF'},
  ];
  let hash = 0;
  const seed = `${styleId}|${title}`;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 33 + seed.charCodeAt(i)) >>> 0;
  }
  const picked = palettes[hash % palettes.length]!;
  if (styleId === 'bar' || styleId === 'poster') {
    return picked;
  }
  if (styleId === 'minimal' || styleId === 'underline' || styleId === 'outline' || styleId === 'rail') {
    return {...picked, ink: '#FFFFFF', surface: '#0B0B0F'};
  }
  return picked;
}
