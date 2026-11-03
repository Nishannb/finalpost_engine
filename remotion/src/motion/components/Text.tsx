import React, {useMemo} from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';

import {progress, springIn, type SpringPreset} from '../animation';
import {useMotionTheme} from '../context';
import type {FontId} from '../fonts';
import {fitTextBlock, type FittedText} from '../text';
import {isUnitRecipe, recipeStateCss, unitRecipeState, type MotionRecipeId} from '../recipes/motionRecipes';
import {withAlpha} from '../theme';

type Align = 'left' | 'center' | 'right';
type VAlign = 'top' | 'center' | 'bottom';

export type FitTextProps = {
  text: string;
  /** Box the text must fit in (px). */
  width: number;
  height?: number;
  maxLines?: number;
  maxFontSize?: number;
  minFontSize?: number;
  /** 'display' / 'body' use the theme fonts; or a FontId. Default 'display'. */
  font?: 'display' | 'body' | FontId;
  weight?: number;
  color?: string;
  align?: Align;
  verticalAlign?: VAlign;
  lineHeight?: number;
  letterSpacing?: number;
  uppercase?: boolean;
  truncate?: boolean;
  /** Tabular digits for numbers that change. */
  tabular?: boolean;
  style?: React.CSSProperties;
};

export function useFontId(font: FitTextProps['font'] = 'display'): FontId {
  const theme = useMotionTheme();
  return font === 'display' ? theme.fontDisplay : font === 'body' ? theme.fontBody : font;
}

/** Fits the text into width × height (largest size, word wrap, ≤ maxLines) and renders it. */
export const FitText: React.FC<FitTextProps> = props => {
  const theme = useMotionTheme();
  const font = useFontId(props.font);
  const fit = useFitted({...props, font});
  return (
    <TextLines
      fit={fit}
      width={props.width}
      height={props.height}
      align={props.align ?? 'center'}
      verticalAlign={props.verticalAlign ?? 'center'}
      color={props.color ?? theme.text}
      tabular={props.tabular}
      style={props.style}
    />
  );
};

function useFitted(p: Omit<FitTextProps, 'font'> & {font: FontId}): FittedText {
  const {text, width, height, maxLines, maxFontSize, minFontSize, font, weight, lineHeight, letterSpacing, uppercase, truncate} = p;
  return useMemo(
    () => fitTextBlock({text, width, height, maxLines, maxFontSize, minFontSize, font, weight, lineHeight, letterSpacing, uppercase, truncate}),
    [text, width, height, maxLines, maxFontSize, minFontSize, font, weight, lineHeight, letterSpacing, uppercase, truncate],
  );
}

const TextLines: React.FC<{
  fit: FittedText;
  width: number;
  height?: number;
  align: Align;
  verticalAlign: VAlign;
  color: string;
  tabular?: boolean;
  style?: React.CSSProperties;
  renderLine?: (line: string, index: number) => React.ReactNode;
}> = ({fit, width, height, align, verticalAlign, color, tabular, style, renderLine}) => (
  <div
    style={{
      width,
      height: height ?? fit.height,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: verticalAlign === 'top' ? 'flex-start' : verticalAlign === 'bottom' ? 'flex-end' : 'center',
      alignItems: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center',
      fontFamily: fit.fontFamily,
      fontWeight: fit.fontWeight,
      fontSize: fit.fontSize,
      lineHeight: `${fit.lineHeightPx}px`,
      letterSpacing: fit.letterSpacingPx || undefined,
      fontVariantNumeric: tabular ? 'tabular-nums' : undefined,
      color,
      textAlign: align,
      ...style,
    }}>
    {fit.lines.map((line, i) => (
      <div key={i} style={{whiteSpace: 'pre', height: fit.lineHeightPx}}>
        {renderLine ? renderLine(line, i) : line}
      </div>
    ))}
  </div>
);

export type KineticTextProps = Omit<FitTextProps, 'truncate' | 'tabular'> & {
  /** words: per-word entrance · chars: per-character · typewriter: characters appear in order · lines: per-line. */
  mode?: 'words' | 'chars' | 'typewriter' | 'lines';
  /** Per-unit entrance. Default 'up'. */
  effect?: 'up' | 'pop' | 'fade';
  delay?: number;
  /** Frames between units (words/lines: default 3, chars: 1). */
  each?: number;
  spring?: SpringPreset;
  /** Words or phrases to emphasise (case-insensitive, punctuation ignored). */
  highlight?: string[];
  highlightColor?: string;
  /** marker style only: colour of the type drawn on the bar (default: the theme background). */
  highlightInk?: string;
  /** Marker bar opacity, 0-1 (default 0.9). */
  highlightOpacity?: number;
  /** WP12B: normalised word -> frame its marker bar starts to sweep (default: right after the word lands). With `highlightEndFrames` the marker WALKS from word to word. */
  highlightStartFrames?: Record<string, number>;
  /** WP12B: normalised word -> frame its marker bar dims (the next word's marker begins). */
  highlightEndFrames?: Record<string, number>;
  /** color: recolour · marker: sweep a bar behind · underline: draw a line under. */
  highlightStyle?: 'color' | 'marker' | 'underline';
  /** Scale bump for highlighted words when they land, e.g. 1.15. */
  emphasisScale?: number;
  /**
   * WP14D: drive every unit's entrance (word / char / line) from a transform-driven motion recipe (e.g. elastic_type_snap) on the unit's own clock, so the stagger stays but the settle is video physics
   * instead of the soft `effect`. Omitted (default) or a glyph / number recipe: the soft `effect` as before.
   */
  recipeId?: MotionRecipeId;
};

const normalize = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** Marks which words (in reading order) fall inside any highlight phrase. */
function highlightMask(words: string[], phrases: string[]): boolean[] {
  const norm = words.map(normalize);
  const mask = words.map(() => false);
  for (const phrase of phrases) {
    const target = phrase.split(/\s+/).map(normalize).filter(Boolean);
    if (target.length === 0) continue;
    for (let i = 0; i + target.length <= norm.length; i++) {
      if (target.every((t, j) => norm[i + j] === t)) {
        for (let j = 0; j < target.length; j++) mask[i + j] = true;
      }
    }
  }
  return mask;
}

/**
 * Animated typography with the same fitting as FitText (layout never reflows
 * while animating). Covers word reveal, character reveal, typewriter and
 * highlighted / emphasised phrases.
 */
export const KineticText: React.FC<KineticTextProps> = props => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const theme = useMotionTheme();
  const font = useFontId(props.font);
  const fit = useFitted({...props, font});
  const {
    mode = 'words',
    effect = 'up',
    delay = 0,
    spring = 'snappy',
    highlight = [],
    highlightStyle = 'color',
    emphasisScale = 1,
  } = props;
  const each = props.each ?? (mode === 'chars' || mode === 'typewriter' ? 1 : 3);
  const color = props.color ?? theme.text;
  const highlightColor = props.highlightColor ?? theme.accent;

  const lineWords = fit.lines.map(line => line.split(' '));
  const mask = highlightMask(lineWords.flat(), highlight);
  const totalChars = fit.lines.join(' ').length;
  const typed = mode === 'typewriter' ? Math.floor(Math.max(0, frame - delay) / Math.max(1, each)) : totalChars;

  const unitStyle = (start: number): React.CSSProperties => {
    if (isUnitRecipe(props.recipeId)) {
      const css = recipeStateCss(unitRecipeState(props.recipeId, frame - start, fps));
      return {opacity: css.opacity, transform: css.transform, filter: css.filter, clipPath: css.clipPath};
    }
    const t = springIn(frame, fps, start, spring);
    const clamped = Math.max(0, Math.min(1, t));
    if (effect === 'fade') return {opacity: clamped};
    if (effect === 'pop') return {opacity: clamped, transform: `scale(${Math.max(0, t)})`};
    return {opacity: clamped, transform: `translateY(${(1 - t) * fit.fontSize * 0.5}px)`};
  };

  let wordIndex = 0;
  let charIndex = 0;
  return (
    <TextLines
      fit={fit}
      width={props.width}
      height={props.height}
      align={props.align ?? 'center'}
      verticalAlign={props.verticalAlign ?? 'center'}
      color={color}
      style={props.style}
      renderLine={(_, lineIdx) => {
        const words = lineWords[lineIdx]!;
        const lineStart = delay + lineIdx * each;
        return (
          <span style={mode === 'lines' ? {display: 'inline-block', ...unitStyle(lineStart)} : undefined}>
            {words.map((word, wi) => {
              const index = wordIndex++;
              const isHi = mask[index] ?? false;
              const wordStart = delay + index * each;
              const firstChar = charIndex;
              charIndex += word.length + 1;
              const landed = progress(frame, wordStart + 4, 8);
              const scale = isHi ? 1 + (emphasisScale - 1) * Math.sin(Math.PI * landed) : 1;
              const wordColor = !isHi
                ? color
                : highlightStyle === 'color'
                  ? highlightColor
                  : highlightStyle === 'marker'
                    ? props.highlightInk ?? theme.background
                    : color;
              const entrance = mode === 'words' ? unitStyle(wordStart) : {};
              const content =
                mode === 'chars' || mode === 'typewriter'
                  ? word.split('').map((ch, ci) => {
                      const k = firstChar + ci;
                      const style =
                        mode === 'typewriter'
                          ? {opacity: k < typed ? 1 : 0}
                          : {display: 'inline-block', ...unitStyle(delay + k * each)};
                      return (
                        <span key={ci} style={style}>
                          {ch}
                        </span>
                      );
                    })
                  : word;
              return (
                <React.Fragment key={wi}>
                  {wi > 0 ? ' ' : null}
                  <span
                    style={{
                      position: 'relative',
                      zIndex: 0,
                      display: 'inline-block',
                      color: wordColor,
                      opacity: entrance.opacity,
                      filter: entrance.filter,
                      clipPath: entrance.clipPath,
                      transform: [entrance.transform, scale !== 1 ? `scale(${scale})` : ''].join(' ').trim() || undefined,
                    }}>
                    {isHi && highlightStyle !== 'color' ? (
                      <span
                        style={{
                          position: 'absolute',
                          left: '-0.08em',
                          right: '-0.08em',
                          ...(highlightStyle === 'marker'
                            ? {top: '12%', bottom: '8%', backgroundColor: withAlpha(highlightColor, props.highlightOpacity ?? 0.9), borderRadius: '0.12em'}
                            : {bottom: '4%', height: '0.09em', backgroundColor: highlightColor, borderRadius: '0.05em'}),
                          transform: `scaleX(${progress(frame, props.highlightStartFrames?.[normalize(word)] ?? wordStart + 2, 10)})`,
                          opacity: props.highlightEndFrames?.[normalize(word)] === undefined ? 1 : 1 - 0.7 * progress(frame, props.highlightEndFrames[normalize(word)]!, 8),
                          transformOrigin: 'left center',
                          zIndex: -1,
                        }}
                      />
                    ) : null}
                    <span style={{position: 'relative'}}>{content}</span>
                  </span>
                </React.Fragment>
              );
            })}
          </span>
        );
      }}
    />
  );
};
