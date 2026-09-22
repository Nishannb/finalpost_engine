/**
 * Frame-accurate caption switch for Remotion burns.
 *
 * Theme ids (karaoke, beast, hustle…) share the line-grouped word renderer.
 * Utility ids (kinetic-slam, moving-pill) use isolated Sequences so inactive
 * words never sit in the React tree.
 */

import React, {useMemo} from 'react';
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

import {CaptionTheme} from 'remotion-captions-themes';

import type {CaptionTemplateId, CaptionDirection, LanguageCode, NorthStarDesign, RenderStyle} from '../blueprintSchema';
import {KineticCaptions} from '../components/KineticCaptions';
import {activeLineAt, framesBetween, groupCaptionLines, secToFrame} from '../lib/timeline';
import {fontFamilyFor, fontWeightFor, poppinsFontFamily} from '../styles/fonts';
import {
  isPackageCaptionThemeId,
  packageThemeNameFor,
} from './packageThemes';
import type {
  CaptionCustomizationOptions,
  DynamicCaptionRendererProps,
  DynamicCaptionTemplateId,
  WhisperTranscriptWord,
} from './types';

const UTILITY_TEMPLATES = new Set<DynamicCaptionTemplateId>([
  'kinetic-slam',
  'moving-pill',
  'simple-one-word',
  'kinetic-01',
  'aarit',
  'soft-ai',
  'weight-shift',
  'editorial-emphasis',
]);

export const DynamicCaptionRenderer: React.FC<
  DynamicCaptionRendererProps & {
    style?: RenderStyle;
    direction?: CaptionDirection;
    design?: NorthStarDesign;
  }
> = ({
  transcriptData,
  selectedTemplate,
  customizationOptions,
  language = 'en',
  style,
  direction,
  design,
}) => {
  const words = useMemo(() => toCaptionWords(transcriptData), [transcriptData]);
  const packageCaptionsData = useMemo(
    () => toPackageCaptionsData(words),
    [words],
  );
  if (words.length === 0) {
    return null;
  }
  if (isPackageCaptionThemeId(selectedTemplate)) {
    const position = direction?.position ?? 'center';
    const bottomFrac = Math.max(
      0.08,
      Math.min(0.34, direction?.bottomFrac ?? style?.captionBottomFrac ?? 0.18),
    );
    return (
      <AbsoluteFill>
        <div
          style={{
            position: 'absolute',
            left: '50%',
            width: '100%',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            pointerEvents: 'none',
            ...(position === 'center'
              ? {top: '50%', transform: 'translate(-50%, -50%)'}
              : position === 'top'
                ? {top: '12%', transform: 'translateX(-50%)'}
                : {
                    bottom: `${Math.round(bottomFrac * 100)}%`,
                    transform: 'translateX(-50%)',
                  }),
          }}>
          <CaptionTheme
            data={packageCaptionsData}
            theme={packageThemeNameFor(selectedTemplate)}
            primaryColor={
              customizationOptions?.primaryColor ||
              direction?.textColor ||
              '#FFFFFF'
            }
            secondaryColor={
              customizationOptions?.secondaryColor ||
              direction?.highlightColor ||
              '#FFD700'
            }
            fontSize={customizationOptions?.fontSize ?? 72}
          />
        </div>
      </AbsoluteFill>
    );
  }
  if (UTILITY_TEMPLATES.has(selectedTemplate)) {
    if (selectedTemplate === 'kinetic-slam') {
      return (
        <KineticSlamCaptions
          words={words}
          options={customizationOptions}
          language={language}
          position={direction?.position}
        />
      );
    }
    if (selectedTemplate === 'moving-pill') {
      return (
        <MovingPillCaptions
          words={words}
          options={customizationOptions}
          language={language}
          position={direction?.position}
        />
      );
    }
    if (selectedTemplate === 'simple-one-word') {
      return (
        <SimpleOneWordCaptions
          words={words}
          options={customizationOptions}
          language={language}
          position={direction?.position}
        />
      );
    }
    if (selectedTemplate === 'kinetic-01') {
      return (
        <Kinetic01Captions
          words={words}
          options={customizationOptions}
          language={language}
          position={direction?.position}
        />
      );
    }
    if (selectedTemplate === 'aarit') {
      return (
        <AaritCaptions
          words={words}
          options={customizationOptions}
          language={language}
          position={direction?.position}
        />
      );
    }
    if (selectedTemplate === 'soft-ai') {
      return (
        <SoftAiCaptions
          words={words}
          options={customizationOptions}
          language={language}
          position={direction?.position}
        />
      );
    }
    if (selectedTemplate === 'weight-shift') {
      return (
        <WeightShiftCaptions
          words={words}
          options={customizationOptions}
          language={language}
          position={direction?.position}
        />
      );
    }
    return (
      <EditorialEmphasisCaptions
        words={words}
        options={customizationOptions}
        language={language}
        position={direction?.position}
      />
    );
  }

  const kineticId = selectedTemplate as CaptionTemplateId;
  return (
    <KineticCaptions
      words={words}
      language={language}
      design={design}
      fontFamily={
        customizationOptions?.fontFamily ||
        (selectedTemplate === 'poppin' ? poppinsFontFamily() : undefined)
      }
      style={styleForTemplate(style, kineticId)}
      direction={directionForTemplate(
        kineticId,
        selectedTemplate,
        direction,
        customizationOptions,
      )}
    />
  );
};

function styleForTemplate(
  style: RenderStyle | undefined,
  captionTemplate: CaptionTemplateId,
): RenderStyle {
  if (style) {
    return {...style, captionTemplate};
  }
  return {
    captionTemplate,
    layoutStyle: 'fullscreen',
    captionBottomFrac: 0.18,
    captionCenterXFrac: 0.5,
    brollEnabled: true,
    zoomEnabled: true,
    trimEnabled: true,
    colorGradeLut: '',
  };
}

function directionForTemplate(
  kineticId: CaptionTemplateId,
  selectedTemplate: DynamicCaptionTemplateId,
  direction: CaptionDirection | undefined,
  options?: CaptionCustomizationOptions,
): CaptionDirection {
  const fontScale = options?.fontSize
    ? Math.max(0.7, Math.min(1.8, options.fontSize / 34))
    : direction?.fontScale ?? 1;
  return {
    position: direction?.position ?? 'bottom',
    bottomFrac: direction?.bottomFrac ?? 0.18,
    boxColor:
      direction?.boxColor ??
      (selectedTemplate === 'box'
        ? 'rgba(0,0,0,0.72)'
        : selectedTemplate === 'grape'
          ? 'rgba(109,40,217,0.92)'
          : selectedTemplate === 'basic'
            ? 'rgba(55,65,81,0.82)'
            : null),
    animation:
      direction?.animation ??
      (selectedTemplate === 'karaoke'
        ? 'karaoke'
        : selectedTemplate === 'hustle' ||
            selectedTemplate === 'bounce' ||
            selectedTemplate === 'pop' ||
            selectedTemplate === 'poppin'
          ? 'bounce'
          : selectedTemplate === 'gaming-stream'
            ? 'highlight'
            : selectedTemplate === 'grape' || selectedTemplate === 'basic'
              ? 'box'
              : 'scale'),
    uppercase:
      direction?.uppercase ??
      (selectedTemplate === 'beast' ||
        selectedTemplate === 'hustle' ||
        selectedTemplate === 'mrbeast' ||
        selectedTemplate === 'poppin' ||
        selectedTemplate === 'hormozi'),
    ...direction,
    template: kineticId,
    textColor: options?.primaryColor || direction?.textColor,
    highlightColor: options?.secondaryColor || direction?.highlightColor,
    fontScale,
  };
}

type CaptionWord = {
  text: string;
  start: number;
  end: number;
  sentenceIndex: number;
};

function toPackageCaptionsData(words: CaptionWord[]): {
  lines: Array<{words: Array<{text: string; start: number; end: number}>}>;
} {
  const lines = groupCaptionLines(words);
  return {
    lines: lines.map(line => ({
      words: line.words.map(word => ({
        text: word.text,
        start: word.start,
        end: word.end,
      })),
    })),
  };
}

function toCaptionWords(raw: WhisperTranscriptWord[]): CaptionWord[] {
  return raw
    .map((item, index) => {
      const text = String(item.text ?? item.word ?? '').trim();
      const start = Number(item.start);
      const end = Number(item.end);
      if (!text || !Number.isFinite(start) || !Number.isFinite(end)) {
        return null;
      }
      const startSec = start > 120 && Number.isInteger(start) ? start / 1000 : start;
      const endSec = end > 120 && Number.isInteger(end) ? end / 1000 : end;
      return {
        text,
        start: startSec,
        end: Math.max(startSec + 0.08, endSec),
        sentenceIndex: index,
      };
    })
    .filter((item): item is CaptionWord => item != null);
}

function dockStyle(
  position: CaptionDirection['position'] | undefined,
  height: number,
  bottomFrac: number,
): React.CSSProperties {
  if (position === 'center') {
    return {
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
    };
  }
  if (position === 'top') {
    return {
      position: 'absolute',
      top: height * Math.min(0.22, Math.max(0.08, bottomFrac || 0.12)),
      left: '50%',
      transform: 'translateX(-50%)',
    };
  }
  const bottom =
    position === 'lower_third'
      ? height * Math.max(0.2, Math.min(0.34, bottomFrac || 0.26))
      : height * Math.max(0.08, Math.min(0.22, bottomFrac || 0.14));
  return {
    position: 'absolute',
    bottom,
    left: '50%',
    transform: 'translateX(-50%)',
  };
}

function fillDock(
  position: CaptionDirection['position'] | undefined,
  height: number,
): React.CSSProperties {
  if (position === 'top') {
    return {
      justifyContent: 'flex-start',
      alignItems: 'center',
      paddingTop: height * 0.12,
    };
  }
  if (position === 'center') {
    return {justifyContent: 'center', alignItems: 'center'};
  }
  if (position === 'lower_third') {
    return {
      justifyContent: 'flex-end',
      alignItems: 'center',
      paddingBottom: height * 0.26,
    };
  }
  return {
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: height * 0.14,
  };
}

function KineticSlamCaptions({
  words,
  options,
  language,
  position,
}: {
  words: CaptionWord[];
  options?: CaptionCustomizationOptions;
  language: LanguageCode;
  position?: CaptionDirection['position'];
}) {
  const {fps, width, height} = useVideoConfig();
  const color = options?.primaryColor || '#F8FAFC';
  const accent = options?.secondaryColor || '#FACC15';
  const fontSize = options?.fontSize ?? Math.round(width * 0.14);
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      {words.map((word, index) => (
        <Sequence
          key={`slam-${word.start}-${index}`}
          from={secToFrame(word.start, fps)}
          durationInFrames={framesBetween(word.start, word.end, fps)}>
          <SlamWord
            text={word.text}
            direction={index % 4}
            color={index % 2 === 0 ? color : accent}
            fontFamily={options?.fontFamily || fontFamilyFor(language, 'impact')}
            fontSize={fontSize}
            height={height}
            position={position}
          />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}

function SlamWord({
  text,
  direction,
  color,
  fontFamily,
  fontSize,
  height,
  position,
}: {
  text: string;
  direction: number;
  color: string;
  fontFamily: string;
  fontSize: number;
  height: number;
  position?: CaptionDirection['position'];
}) {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const enter = spring({
    frame,
    fps,
    config: {damping: 11, stiffness: 260, mass: 0.45},
    durationInFrames: Math.round(fps * 0.22),
  });
  const dx =
    direction === 1 ? (1 - enter) * -180 : direction === 2 ? (1 - enter) * 180 : 0;
  const dy = direction === 0 ? (1 - enter) * 90 : direction === 3 ? (1 - enter) * -70 : 0;
  const scale = direction === 3 ? 0.45 + 0.55 * enter : 0.82 + 0.18 * enter;
  return (
    <AbsoluteFill style={fillDock(position, height)}>
      <div
        style={{
          transform: `translate(${dx}px, ${dy}px) scale(${scale}) rotate(${(1 - enter) * (direction % 2 === 0 ? -8 : 8)}deg)`,
          color,
          fontFamily,
          fontWeight: 900,
          fontSize,
          lineHeight: 0.92,
          textTransform: 'uppercase',
          textAlign: 'center',
          letterSpacing: -fontSize * 0.04,
          textShadow: `0 ${fontSize * 0.06}px 0 #111, 0 0 ${fontSize * 0.35}px rgba(0,0,0,0.45)`,
          maxWidth: '88%',
        }}>
        {text}
      </div>
    </AbsoluteFill>
  );
}

function MovingPillCaptions({
  words,
  options,
  language,
  position,
}: {
  words: CaptionWord[];
  options?: CaptionCustomizationOptions;
  language: LanguageCode;
  position?: CaptionDirection['position'];
}) {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const timeSec = frame / fps;
  const lines = useMemo(() => groupCaptionLines(words, {maxWords: 4}), [words]);
  const line = activeLineAt(lines, timeSec);
  if (!line) {
    return null;
  }
  const fontSize = options?.fontSize ?? Math.round(width * 0.052);
  const activeIndex = line.words.findIndex(
    word => timeSec >= word.start && timeSec <= word.end,
  );
  const fallback = activeIndex >= 0 ? activeIndex : line.words.length - 1;
  const pillX = interpolate(fallback, [0, Math.max(1, line.words.length - 1)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <div
        style={{
          ...dockStyle(position, height, 0.16),
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: fontSize * 0.28,
          maxWidth: width * 0.86,
          padding: `${fontSize * 0.28}px ${fontSize * 0.4}px`,
          borderRadius: 999,
          backgroundColor: 'rgba(8,8,12,0.42)',
        }}>
        <div
          style={{
            position: 'absolute',
            top: fontSize * 0.12,
            bottom: fontSize * 0.12,
            width: `${Math.max(18, 100 / Math.max(1, line.words.length))}%`,
            left: `${pillX * (100 - Math.max(18, 100 / Math.max(1, line.words.length)))}%`,
            borderRadius: 999,
            backgroundColor: options?.secondaryColor || '#FACC15',
            transition: undefined,
          }}
        />
        {line.words.map((word, index) => {
          const active = index === fallback;
          return (
            <span
              key={`${word.start}-${index}`}
              style={{
                position: 'relative',
                zIndex: 1,
                color: active
                  ? '#111111'
                  : options?.primaryColor || '#F8FAFC',
                fontFamily: options?.fontFamily || fontFamilyFor(language, 'sans'),
                fontWeight: fontWeightFor(language, 'sans'),
                fontSize,
                lineHeight: 1.1,
                padding: `0 ${fontSize * 0.12}px`,
              }}>
              {word.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

type LineCaptionProps = {
  words: CaptionWord[];
  options?: CaptionCustomizationOptions;
  language: LanguageCode;
  position?: CaptionDirection['position'];
};

function SimpleOneWordCaptions({words, options, language, position}: LineCaptionProps) {
  const {fps, width, height} = useVideoConfig();
  const color = options?.primaryColor || '#FFFFFF';
  const accent = options?.secondaryColor || '#FACC15';
  const fontSize = options?.fontSize ?? Math.round(width * 0.11);
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      {words.map((word, index) => (
        <Sequence
          key={`one-${word.start}-${index}`}
          from={secToFrame(word.start, fps)}
          durationInFrames={framesBetween(word.start, word.end, fps)}>
          <CenteredWord
            text={word.text}
            color={index % 2 === 0 ? color : accent}
            fontFamily={options?.fontFamily || fontFamilyFor(language, 'sans')}
            fontSize={fontSize}
            height={height}
            uppercase={false}
            position={position}
          />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}

function CenteredWord({
  text,
  color,
  fontFamily,
  fontSize,
  height,
  uppercase,
  position,
}: {
  text: string;
  color: string;
  fontFamily: string;
  fontSize: number;
  height: number;
  uppercase: boolean;
  position?: CaptionDirection['position'];
}) {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const enter = spring({
    frame,
    fps,
    config: {damping: 14, stiffness: 180, mass: 0.5},
    durationInFrames: Math.round(fps * 0.2),
  });
  return (
    <AbsoluteFill style={fillDock(position, height)}>
      <div
        style={{
          transform: `scale(${0.86 + 0.14 * enter})`,
          color,
          fontFamily,
          fontWeight: 800,
          fontSize,
          lineHeight: 1,
          textTransform: uppercase ? 'uppercase' : 'none',
          textAlign: 'center',
          textShadow: `0 ${fontSize * 0.05}px ${fontSize * 0.2}px rgba(0,0,0,0.45)`,
          maxWidth: '88%',
        }}>
        {text}
      </div>
    </AbsoluteFill>
  );
}

function Kinetic01Captions({words, options, language, position}: LineCaptionProps) {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const timeSec = frame / fps;
  const lines = useMemo(() => groupCaptionLines(words, {maxWords: 4}), [words]);
  const line = activeLineAt(lines, timeSec);
  if (!line) {
    return null;
  }
  const main = [...line.words].sort((a, b) => b.text.length - a.text.length)[0];
  if (!main) {
    return null;
  }
  const sides = line.words.filter(word => word !== main);
  const fontSize = options?.fontSize ?? Math.round(width * 0.12);
  const family = options?.fontFamily || fontFamilyFor(language, 'impact');
  const active = timeSec >= main.start && timeSec <= main.end;
  return (
    <AbsoluteFill
      style={{pointerEvents: 'none', ...fillDock(position, height)}}>
      <div style={{position: 'relative', width: width * 0.86, height: height * 0.34}}>
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '46%',
            transform: `translate(-50%, -50%) scale(${active ? 1.06 : 0.96})`,
            color: options?.secondaryColor || '#F8FAFC',
            fontFamily: family,
            fontWeight: 900,
            fontSize,
            textTransform: 'uppercase',
            letterSpacing: -fontSize * 0.04,
            textAlign: 'center',
            textShadow: `0 ${fontSize * 0.06}px 0 #020617`,
          }}>
          {main.text}
        </div>
        {sides.map((word, index) => {
          const top = index % 2 === 0 ? '8%' : '72%';
          const left = index < 2 ? '6%' : 'auto';
          const right = index >= 2 ? '6%' : 'auto';
          return (
            <div
              key={`${word.start}-${index}`}
              style={{
                position: 'absolute',
                top,
                left,
                right,
                color: options?.primaryColor || '#94A3B8',
                fontFamily: family,
                fontWeight: 700,
                fontSize: fontSize * 0.38,
                textTransform: 'uppercase',
                opacity: timeSec >= word.start ? 1 : 0.35,
              }}>
              {word.text}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

function AaritCaptions({words, options, language, position}: LineCaptionProps) {
  const {fps, width, height} = useVideoConfig();
  const fontSize = options?.fontSize ?? Math.round(width * 0.1);
  const family = options?.fontFamily || fontFamilyFor(language, 'impact');
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      {words.map((word, index) => (
        <Sequence
          key={`aarit-${word.start}-${index}`}
          from={secToFrame(word.start, fps)}
          durationInFrames={framesBetween(word.start, word.end, fps)}>
          <AaritWord
            text={word.text}
            color={options?.secondaryColor || '#38BDF8'}
            fontFamily={family}
            fontSize={fontSize}
            height={height}
            position={position}
          />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}

function AaritWord({
  text,
  color,
  fontFamily,
  fontSize,
  height,
  position,
}: {
  text: string;
  color: string;
  fontFamily: string;
  fontSize: number;
  height: number;
  position?: CaptionDirection['position'];
}) {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const letters = Array.from(text);
  return (
    <AbsoluteFill
      style={{
        ...fillDock(position, height),
        flexDirection: 'row',
      }}>
      {letters.map((letter, index) => {
        const enter = spring({
          frame: Math.max(0, frame - index * 2),
          fps,
          config: {damping: 12, stiffness: 220, mass: 0.4},
          durationInFrames: Math.round(fps * 0.18),
        });
        return (
          <span
            key={`${letter}-${index}`}
            style={{
              display: 'inline-block',
              transform: `scale(${0.4 + 0.6 * enter})`,
              color,
              fontFamily,
              fontWeight: 900,
              fontSize,
              textTransform: 'uppercase',
              backgroundImage: `linear-gradient(90deg, ${color}, #F8FAFC)`,
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>
            {letter}
          </span>
        );
      })}
    </AbsoluteFill>
  );
}

function SoftAiCaptions({words, options, language, position}: LineCaptionProps) {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const timeSec = frame / fps;
  const lines = useMemo(() => groupCaptionLines(words, {maxWords: 4}), [words]);
  const line = activeLineAt(lines, timeSec);
  if (!line) {
    return null;
  }
  const fontSize = options?.fontSize ?? Math.round(width * 0.048);
  const enter = spring({
    frame: Math.max(0, Math.round((timeSec - line.start) * fps)),
    fps,
    config: {damping: 18, stiffness: 120, mass: 0.7},
    durationInFrames: Math.round(fps * 0.28),
  });
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <div
        style={{
          ...dockStyle(position, height, 0.16),
          transform: position === 'center'
            ? `translate(-50%, -50%) scale(${0.94 + 0.06 * enter})`
            : `translateX(-50%) scale(${0.94 + 0.06 * enter})`,
          opacity: 0.55 + 0.45 * enter,
          display: 'flex',
          gap: fontSize * 0.28,
          maxWidth: width * 0.86,
          padding: `${fontSize * 0.34}px ${fontSize * 0.5}px`,
          borderRadius: fontSize,
          backgroundColor: options?.primaryColor
            ? undefined
            : 'rgba(15,23,42,0.46)',
          backdropFilter: 'blur(18px)',
          WebkitBackdropFilter: 'blur(18px)',
        }}>
        {line.words.map((word, index) => {
          const active = timeSec >= word.start && timeSec <= word.end;
          return (
            <span
              key={`${word.start}-${index}`}
              style={{
                color: active
                  ? options?.secondaryColor || '#FFFFFF'
                  : options?.primaryColor || '#E2E8F0',
                fontFamily: options?.fontFamily || fontFamilyFor(language, 'sans'),
                fontWeight: active ? 700 : 500,
                fontSize,
                filter: active ? 'none' : 'blur(0.4px)',
              }}>
              {word.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

function WeightShiftCaptions({words, options, language, position}: LineCaptionProps) {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const timeSec = frame / fps;
  const lines = useMemo(() => groupCaptionLines(words, {maxWords: 5}), [words]);
  const line = activeLineAt(lines, timeSec);
  if (!line) {
    return null;
  }
  const fontSize = options?.fontSize ?? Math.round(width * 0.05);
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <div
        style={{
          ...dockStyle(position, height, 0.18),
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: fontSize * 0.22,
          maxWidth: width * 0.88,
        }}>
        {line.words.map((word, index) => {
          const active = timeSec >= word.start && timeSec <= word.end;
          return (
            <span
              key={`${word.start}-${index}`}
              style={{
                color: active
                  ? options?.secondaryColor || '#FFFFFF'
                  : options?.primaryColor || '#94A3B8',
                fontFamily: options?.fontFamily || fontFamilyFor(language, 'sans'),
                fontWeight: active ? 800 : 400,
                fontSize: active ? fontSize * 1.08 : fontSize,
                opacity: active ? 1 : 0.55,
              }}>
              {word.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

function EditorialEmphasisCaptions({words, options, language, position}: LineCaptionProps) {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const timeSec = frame / fps;
  const lines = useMemo(() => groupCaptionLines(words, {maxWords: 5}), [words]);
  const line = activeLineAt(lines, timeSec);
  if (!line) {
    return null;
  }
  const fontSize = options?.fontSize ?? Math.round(width * 0.048);
  const enter = spring({
    frame: Math.max(0, Math.round((timeSec - line.start) * fps)),
    fps,
    config: {damping: 16, stiffness: 140, mass: 0.6},
    durationInFrames: Math.round(fps * 0.3),
  });
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <div
        style={{
          ...dockStyle(position, height, 0.18),
          transform: position === 'center'
            ? `translate(-50%, calc(-50% + ${(1 - enter) * 28}px))`
            : `translateX(-50%) translateY(${(1 - enter) * 28}px)`,
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: fontSize * 0.2,
          maxWidth: width * 0.86,
        }}>
        {line.words.map((word, index) => {
          const active = timeSec >= word.start && timeSec <= word.end;
          const fill = active
            ? interpolate(timeSec, [word.start, word.end], [0, 100], {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
              })
            : 0;
          return (
            <span
              key={`${word.start}-${index}`}
              style={{
                position: 'relative',
                color: options?.primaryColor || '#FFFFFF',
                fontFamily: options?.fontFamily || fontFamilyFor(language, 'sans'),
                fontWeight: 700,
                fontSize,
                paddingBottom: fontSize * 0.12,
              }}>
              {word.text}
              <span
                style={{
                  position: 'absolute',
                  left: 0,
                  bottom: 0,
                  height: Math.max(3, fontSize * 0.08),
                  width: `${fill}%`,
                  backgroundColor: options?.secondaryColor || '#FACC15',
                }}
              />
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}
