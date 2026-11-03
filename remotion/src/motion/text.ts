/**
 * Text fitting by real measurement (Remotion's measureText against the loaded
 * font), never character-count estimates.
 *
 * fitTextBlock finds the largest font size at which the text wraps on word
 * boundaries (between characters for CJK) into at most `maxLines` lines that
 * fit `width` (and `height` if given). Words are never split mid-word: if a single word cannot fit even at
 * `minFontSize`, the result is flagged `overflow` (or ellipsised when
 * `truncate` is set). Results are deterministic for the same inputs.
 */

import {measureText} from '@remotion/layout-utils';

import {availableWeight, fontFamily, type FontId} from './fonts';

export type FitTextOptions = {
  text: string;
  /** Available width in px. */
  width: number;
  /** Available height in px (optional). */
  height?: number;
  maxLines?: number;
  maxFontSize?: number;
  minFontSize?: number;
  font?: FontId;
  weight?: number;
  /** Line height as a multiple of font size. */
  lineHeight?: number;
  /** Letter spacing in em. */
  letterSpacing?: number;
  uppercase?: boolean;
  /** Ellipsise the last line when even minFontSize cannot fit. Default false. */
  truncate?: boolean;
};

export type FittedText = {
  fontSize: number;
  lines: string[];
  lineHeightPx: number;
  /** Widest rendered line in px. */
  width: number;
  /** Total block height in px. */
  height: number;
  /** True when the text could not fit within the constraints at minFontSize. */
  overflow: boolean;
  fontFamily: string;
  fontWeight: number;
  letterSpacingPx: number;
};

type Measure = (text: string) => number;

function measurer(fontSize: number, font: FontId, weight: number, letterSpacingEm: number): Measure {
  const family = fontFamily(font);
  const letterSpacing = letterSpacingEm ? `${letterSpacingEm * fontSize}px` : undefined;
  return text =>
    text.length === 0 ? 0 : measureText({text, fontFamily: family, fontSize, fontWeight: weight, letterSpacing}).width;
}

/** A break opportunity: `glue` is what joins the token to the previous one on the same line. */
type Token = {text: string; glue: string};

const CJK_CHAR = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/u;
const CJK_PIECES = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]|[^\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]+/gu;
/** Kinsoku: characters that may not start a line / may not end one. */
const NO_LINE_START = /^[、。，．・：；？！ー〜）」』】〕〉》’”ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ…%％]/u;
const NO_LINE_END = /[（「『【〔〈《‘“]$/u;

/**
 * Splits a paragraph into break opportunities. Space-separated scripts (Latin,
 * Devanagari) break only between words, exactly as before; CJK text, which has
 * no spaces, may break between any two characters except where kinsoku forbids.
 */
function tokenize(paragraph: string): Token[] {
  const tokens: Token[] = [];
  for (const word of paragraph.split(/\s+/).filter(Boolean)) {
    const pieces = CJK_CHAR.test(word) ? word.match(CJK_PIECES) ?? [word] : [word];
    pieces.forEach((piece, index) => {
      const glue = index === 0 ? ' ' : '';
      const previous = tokens[tokens.length - 1];
      if (previous && glue === '' && (NO_LINE_START.test(piece) || NO_LINE_END.test(previous.text))) {
        previous.text += piece;
        return;
      }
      tokens.push({text: piece, glue});
    });
  }
  return tokens;
}

const joinTokens = (tokens: Token[]) => tokens.map((token, i) => (i === 0 ? token.text : token.glue + token.text)).join('');

/** Greedy wrap. Returns null when a single unbreakable token is wider than `width`. */
function wrap(paragraphs: Token[][], width: number, measure: Measure): string[] | null {
  const lines: string[] = [];
  for (const tokens of paragraphs) {
    let line = '';
    for (const token of tokens) {
      if (measure(token.text) > width) {
        return null;
      }
      const candidate = line ? `${line}${token.glue}${token.text}` : token.text;
      if (measure(candidate) <= width) {
        line = candidate;
      } else {
        lines.push(line);
        line = token.text;
      }
    }
    lines.push(line);
  }
  return lines;
}

export function fitTextBlock(options: FitTextOptions): FittedText {
  const {
    width,
    height,
    maxLines = 2,
    font = 'inter',
    lineHeight = 1.15,
    letterSpacing = 0,
    uppercase = false,
    truncate = false,
  } = options;
  const weight = availableWeight(font, options.weight ?? 700);
  const text = (uppercase ? options.text.toUpperCase() : options.text).trim();
  const paragraphs = text.split(/\n/).map(tokenize);
  // Default cap: the box height when given (the fit still enforces lines and width), else a quarter of the width.
  const maxFontSize = Math.max(1, Math.floor(options.maxFontSize ?? (height !== undefined ? height / lineHeight : width * 0.25)));
  const minFontSize = Math.max(1, Math.min(maxFontSize, Math.floor(options.minFontSize ?? 12)));

  const attempt = (size: number) => {
    const lines = wrap(paragraphs, width, measurer(size, font, weight, letterSpacing));
    const fits =
      lines !== null &&
      lines.length <= maxLines &&
      (height === undefined || lines.length * size * lineHeight <= height + 0.5);
    return {lines, fits};
  };

  // Largest fitting size by binary search (fit is monotonic in font size).
  let lo = minFontSize;
  let hi = maxFontSize;
  let best: number | null = attempt(minFontSize).fits ? minFontSize : null;
  if (best !== null) {
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (attempt(mid).fits) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    best = lo;
  }

  const fontSize = best ?? minFontSize;
  const measure = measurer(fontSize, font, weight, letterSpacing);
  let lines = attempt(fontSize).lines ?? paragraphs.map(joinTokens);
  const overflow = best === null;
  if (overflow && truncate) {
    lines = truncateLines(paragraphs.map(joinTokens), width, maxLines, measure);
  }
  const lineHeightPx = fontSize * lineHeight;
  return {
    fontSize,
    lines,
    lineHeightPx,
    width: Math.max(0, ...lines.map(measure)),
    height: lines.length * lineHeightPx,
    overflow,
    fontFamily: fontFamily(font),
    fontWeight: weight,
    letterSpacingPx: letterSpacing * fontSize,
  };
}

/** Fills up to maxLines, breaking long words by character, ending in an ellipsis. */
function truncateLines(words: string[], width: number, maxLines: number, measure: Measure): string[] {
  const lines: string[] = [];
  let line = '';
  const chars = words.join(' ').split('');
  for (const ch of chars) {
    const candidate = line + ch;
    if (measure(candidate) <= width) {
      line = candidate;
      continue;
    }
    lines.push(line.trimEnd());
    line = ch.trim();
    if (lines.length === maxLines) {
      break;
    }
  }
  if (lines.length < maxLines && line) {
    lines.push(line);
    return lines;
  }
  let last = lines[maxLines - 1] ?? '';
  while (last.length > 0 && measure(`${last}…`) > width) {
    last = last.slice(0, -1);
  }
  lines[maxLines - 1] = `${last.trimEnd()}…`;
  return lines.slice(0, maxLines);
}

/** Width of a single line of text in px (for snug pills, badges, labels). */
export function measureLine(
  text: string,
  fontSize: number,
  font: FontId = 'inter',
  weight = 700,
  letterSpacingEm = 0,
): number {
  return measurer(fontSize, font, availableWeight(font, weight), letterSpacingEm)(text);
}

/**
 * One font size that fits every text in a set (e.g. step labels), so sibling
 * labels match. Each text gets the same box; returns the smallest fitted size.
 * Pass the result as `maxFontSize` to each FitText.
 */
export function fitTextGroup(texts: string[], options: Omit<FitTextOptions, 'text'>): number {
  return Math.min(...texts.map(text => fitTextBlock({...options, text}).fontSize));
}
