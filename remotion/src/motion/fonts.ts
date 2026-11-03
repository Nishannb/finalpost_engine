/**
 * Locally bundled fonts (remotion/public/fonts, SIL OFL 1.1) — no network.
 *
 * Families are registered under "FP …" names so a system-installed copy on a
 * dev machine can never change metrics versus Lambda. The display families are
 * Latin; Devanagari (Noto Sans Devanagari) and Japanese (Noto Sans JP, split
 * into unicode-range subsets) sit behind every family as fallbacks and are
 * loaded only for the characters a graphic's content actually uses.
 */

import {staticFile} from 'remotion';

import {loadFontFile, loadWithFontFace, type FontFileSpec} from './fontLoad';
import scriptFonts from './scriptFonts.json';

export type FontId = 'inter' | 'space_grotesk' | 'bebas';

type FontSpec = {family: string; weights: number[]; file: (weight: number) => string};

const FONTS: Record<FontId, FontSpec> = {
  inter: {
    family: 'FP Inter',
    weights: [400, 500, 600, 700, 800, 900],
    file: weight => `fonts/inter-latin-${weight}-normal.woff2`,
  },
  space_grotesk: {
    family: 'FP Space Grotesk',
    weights: [500, 700],
    file: weight => `fonts/space-grotesk-latin-${weight}-normal.woff2`,
  },
  bebas: {
    family: 'FP Bebas Neue',
    weights: [400],
    file: weight => `fonts/bebas-neue-latin-${weight}-normal.woff2`,
  },
};

const DEVANAGARI_FAMILY = 'FP Noto Sans Devanagari';
const JAPANESE_FAMILY = 'FP Noto Sans JP';
/** Weights shipped for the script fallbacks; other weights resolve to the nearest. */
const SCRIPT_WEIGHTS = [400, 700];

/** CSS font-family stack for a font id (per-glyph fallback covers Devanagari and Japanese). */
export function fontFamily(id: FontId): string {
  return `'${FONTS[id].family}', '${DEVANAGARI_FAMILY}', '${JAPANESE_FAMILY}', 'Helvetica Neue', Arial, sans-serif`;
}

/** Nearest weight the family actually ships (Bebas has only 400, Space Grotesk 500/700). */
export function availableWeight(id: FontId, weight: number): number {
  return FONTS[id].weights.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best));
}

type ScriptSubset = {file: (weight: number) => string; family: string; unicodeRange: string; ranges: Array<[number, number]>};

function parseRanges(ranges: string): Array<[number, number]> {
  return ranges.split(',').map(part => {
    const [lo = '0', hi] = part.split('-');
    return [parseInt(lo, 16), parseInt(hi ?? lo, 16)];
  });
}

const unicodeRange = (ranges: string) => ranges.split(',').map(part => `U+${part}`).join(',');

const SCRIPT_SUBSETS: ScriptSubset[] = [
  {
    family: DEVANAGARI_FAMILY,
    file: weight => `fonts/noto-sans-devanagari-devanagari-${weight}-normal.woff2`,
    unicodeRange: unicodeRange(scriptFonts.devanagari),
    ranges: parseRanges(scriptFonts.devanagari),
  },
  ...(scriptFonts.jp as Array<[number, string]>).map(([index, ranges]) => ({
    family: JAPANESE_FAMILY,
    file: (weight: number) => `fonts/noto-jp/noto-sans-jp-${index}-${weight}-normal.woff2`,
    unicodeRange: unicodeRange(ranges),
    ranges: parseRanges(ranges),
  })),
];

/** The script subsets that cover at least one non-ASCII character of `text`. */
function subsetsFor(text: string): ScriptSubset[] {
  const needed = new Set<ScriptSubset>();
  for (const char of new Set(text)) {
    const cp = char.codePointAt(0)!;
    if (cp < 0x0250) {
      continue; // Latin: the display families cover it.
    }
    const subset = SCRIPT_SUBSETS.find(item => item.ranges.some(([lo, hi]) => cp >= lo && cp <= hi));
    if (subset) {
      needed.add(subset);
    }
  }
  return [...needed];
}

let pending: Promise<void> | null = null;
const scriptLoads = new Map<string, Promise<void>>();

// WP4N: no delayRender / cancelRender here. A file that fails or does not settle in time is warned and abandoned (the family then falls back per glyph); the caller that holds the render
// (the generated-graphic loader or useMotionFonts) is the one that releases it.
const loadFile = (spec: FontFileSpec): Promise<void> => loadFontFile(spec, loadWithFontFace, {warn: message => console.warn(message)}).then(() => undefined);

/**
 * Loads the motion fonts, plus the Devanagari / Japanese subsets needed for `text`. The host
 * awaits this before mounting any generated graphic, passing every string in the graphics' props,
 * so text measurement never sees fallback metrics. Never rejects: a font file that fails or does
 * not load within the limit is warned and skipped, and the returned promise still resolves.
 */
export function loadMotionFonts(text = ''): Promise<void> {
  pending ??= Promise.all(
    Object.values(FONTS).flatMap(spec =>
      spec.weights.map(weight => loadFile({family: spec.family, url: staticFile(spec.file(weight)), weight: String(weight)})),
    ),
  ).then(() => undefined);
  const scripts = subsetsFor(text).flatMap(subset =>
    SCRIPT_WEIGHTS.map(weight => {
      const url = staticFile(subset.file(weight));
      let load = scriptLoads.get(url);
      if (!load) {
        load = loadFile({family: subset.family, url, weight: String(weight), unicodeRange: subset.unicodeRange});
        scriptLoads.set(url, load);
      }
      return load;
    }),
  );
  return Promise.all([pending, ...scripts]).then(() => undefined);
}

/** Every string inside a props value, for font subsetting. */
export function textOf(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(textOf).join(' ');
  }
  if (value && typeof value === 'object') {
    return Object.values(value).map(textOf).join(' ');
  }
  return '';
}
