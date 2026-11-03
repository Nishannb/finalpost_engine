/**
 * TEXT MATCH CUT (pure, no React). Style bible: three edit grammars (T1 "Typewriter Memo", T2 "Editorial Blast", T3 "Newsprint Tag").
 * One keyword persists across every scene inside a sharp highlight box whose CENTRE is pinned to a fixed anchor; everything else
 * (layout, typeface, size, rotation, surrounding text, background) is replaced on a hard cut. Surrounding text is the speaker's own
 * words (cropped + blurred, deliberately not legible), so nothing here can show copy that was not said.
 */
export type MatchCutVariant = 'memo' | 'editorial' | 'newsprint';
export const MATCH_CUT_VARIANTS: readonly MatchCutVariant[] = ['memo', 'editorial', 'newsprint'];

export type MatchFont = 'mono' | 'serif' | 'sans' | 'script';
/** 0 sharp, 1 soft, 2 heavy, 3 directional smear (horizontal ghosting; T2 giant words, T3 repeated rows). */
export type BlurClass = 0 | 1 | 2 | 3;

export type MatchRow = {
  /** Vertical offset from the anchor, in base-font units (negative = above). */
  dy: number;
  font: MatchFont;
  /** Font size in base-font units. */
  size: number;
  weight?: number;
  caps?: boolean;
  italic?: boolean;
  /** Horizontal centre as a fraction of the frame width (default 0.5). */
  x?: number;
  rot?: number;
  blur?: BlurClass;
  opacity?: number;
  /** 'kw' = the keyword row (box centre = anchor + dy); others fill from the spoken pool. */
  kind?: 'kw' | 'pool' | 'block';
  /** block: width as a fraction of the frame width; text wraps (micro paragraph). */
  blockW?: number;
  /** Which spoken word the row starts at (cycles). */
  from?: number;
  /** How many spoken words the row shows (default: fill past both frame edges). */
  words?: number;
  tracking?: number;
  /** Keyword case override for this scene. */
  kwCase?: 'as_given' | 'upper' | 'lower' | 'title';
};

export type MatchDecor =
  | {kind: 'rule'; dy: number; x0: number; x1: number; thick?: number}
  | {kind: 'bar'; y0: number; y1: number; color: string}
  | {kind: 'halftone'; y0: number; y1: number; blur: number};

export type MatchLayout = {id: string; rows: readonly MatchRow[]; decor?: readonly MatchDecor[]; bg?: string};

export type MatchVariantSpec = {
  id: MatchCutVariant;
  label: string;
  sceneSec: number;
  anchor: {x: number; y: number};
  /** y drift allowed late in the sequence (T3: 0.376 then 0.356). */
  lateAnchorY?: readonly number[];
  keyword: {bg: string; fg: string; padEm: readonly [number, number]};
  ink: string;
  background: {color: string; vignette: number};
  /** T3 changes the whole frame colour on every cut. */
  sceneBackgrounds?: readonly string[];
  pushIn?: {from: number; to: number};
  layouts: Readonly<Record<string, MatchLayout>>;
  cycle: readonly string[];
};

const MEMO: Record<string, MatchLayout> = {
  memo_header: {
    id: 'memo_header',
    rows: [
      {dy: -3.6, font: 'mono', size: 0.7, caps: true, blur: 0, opacity: 0.85, words: 2, tracking: 0.12},
      {dy: -1.7, font: 'mono', size: 0.9, blur: 1, opacity: 0.75, from: 2},
      {dy: 0, font: 'mono', size: 1, kind: 'kw'},
      {dy: 1.7, font: 'mono', size: 0.9, blur: 1, opacity: 0.75, from: 5},
      {dy: 3.8, font: 'mono', size: 0.7, caps: true, blur: 2, opacity: 0.5, words: 3, tracking: 0.12},
    ],
  },
  blur_column: {
    id: 'blur_column',
    rows: [
      {dy: -3.1, font: 'mono', size: 0.85, blur: 2, opacity: 0.45, from: 1},
      {dy: -1.55, font: 'mono', size: 0.9, blur: 1, opacity: 0.7, from: 3},
      {dy: 0, font: 'mono', size: 1, kind: 'kw'},
      {dy: 1.55, font: 'mono', size: 0.9, blur: 1, opacity: 0.6, from: 4},
      {dy: 3.1, font: 'mono', size: 0.85, blur: 2, opacity: 0.4, from: 6},
    ],
  },
  serif_block: {
    id: 'serif_block',
    rows: [
      {dy: -4.6, font: 'serif', size: 2.3, weight: 800, blur: 2, opacity: 0.55, words: 2},
      {dy: -1.5, font: 'serif', size: 1, blur: 1, opacity: 0.8, from: 2},
      {dy: 0, font: 'serif', size: 1.05, kind: 'kw'},
      {dy: 1.5, font: 'serif', size: 1, blur: 1, opacity: 0.65, from: 4},
      {dy: 3.1, font: 'serif', size: 0.9, blur: 2, opacity: 0.4, from: 6},
    ],
  },
  bold_sans_line: {
    id: 'bold_sans_line',
    rows: [
      {dy: -3.2, font: 'sans', size: 0.42, blur: 2, opacity: 0.5, from: 2},
      {dy: -2.3, font: 'sans', size: 0.42, blur: 2, opacity: 0.55, from: 5},
      {dy: 0, font: 'sans', size: 1.15, weight: 800, kind: 'kw'},
      {dy: 2.3, font: 'sans', size: 0.42, blur: 2, opacity: 0.55, from: 1},
      {dy: 3.2, font: 'sans', size: 0.42, blur: 2, opacity: 0.45, from: 4},
    ],
  },
};

const EDITORIAL: Record<string, MatchLayout> = {
  didone_stack: {
    id: 'didone_stack',
    rows: [
      {dy: -5, font: 'serif', size: 1.6, weight: 800, caps: true, blur: 2, opacity: 0.8, words: 1},
      {dy: -1.9, font: 'serif', size: 1.15, weight: 700, blur: 0, from: 1, words: 3},
      {dy: 0, font: 'serif', size: 1.15, kind: 'kw'},
      {dy: 1.9, font: 'serif', size: 1.15, weight: 700, blur: 0, from: 4, words: 3},
      {dy: 5.2, font: 'serif', size: 3.6, weight: 900, caps: true, blur: 3, words: 1, from: 2, x: 0.5},
    ],
  },
  grotesque_split: {
    id: 'grotesque_split',
    rows: [
      {dy: -2.9, font: 'sans', size: 2.4, weight: 900, caps: true, blur: 0, words: 1, from: 1},
      {dy: 0, font: 'sans', size: 0.95, weight: 800, kind: 'kw'},
      {dy: 2.9, font: 'sans', size: 2.4, weight: 900, caps: true, blur: 0, words: 1, from: 3},
      {dy: -6.2, font: 'serif', size: 0.3, kind: 'block', blockW: 0.32, x: 0.75, blur: 2, opacity: 0.7},
      {dy: 6.6, font: 'sans', size: 0.34, caps: true, blur: 2, opacity: 0.7, words: 3, tracking: 0.2},
    ],
  },
  centered_serif_quote: {
    id: 'centered_serif_quote',
    rows: [
      {dy: -2.3, font: 'serif', size: 1.35, blur: 0, from: 0, words: 3},
      {dy: -1.15, font: 'serif', size: 1.35, blur: 0, from: 3, words: 3},
      {dy: 0, font: 'serif', size: 1.35, kind: 'kw', kwCase: 'lower'},
      {dy: 1.15, font: 'serif', size: 1.35, blur: 0, from: 6, words: 3},
      {dy: 5.6, font: 'serif', size: 0.3, kind: 'block', blockW: 0.38, x: 0.28, blur: 3, opacity: 0.8},
    ],
  },
  mixed_scale_serif: {
    id: 'mixed_scale_serif',
    rows: [
      {dy: -3.6, font: 'serif', size: 0.6, caps: true, x: 0.28, blur: 0, words: 2, tracking: 0.1},
      {dy: -1.9, font: 'serif', size: 3, blur: 0, words: 1, from: 1, kwCase: 'lower'},
      {dy: 0, font: 'serif', size: 0.8, kind: 'kw', kwCase: 'lower'},
      {dy: 5.2, font: 'serif', size: 4, weight: 900, caps: true, x: 0.78, rot: -6, blur: 3, words: 1, from: 3},
    ],
  },
  script_and_caps: {
    id: 'script_and_caps',
    rows: [
      {dy: -3.1, font: 'sans', size: 1.2, weight: 800, caps: true, words: 2, blur: 0},
      {dy: -5.6, font: 'script', size: 2.8, x: 0.7, rot: -20, blur: 1, words: 1, from: 2},
      {dy: 0, font: 'serif', size: 1.4, kind: 'kw'},
      {dy: 4.8, font: 'sans', size: 0.7, weight: 800, caps: true, x: 0.8, blur: 2, words: 2, from: 4},
      {dy: 5.8, font: 'serif', size: 0.3, kind: 'block', blockW: 0.34, x: 0.26, blur: 3, opacity: 0.8},
    ],
  },
  vertical_word_sans_block: {
    id: 'vertical_word_sans_block',
    rows: [
      {dy: 0, font: 'sans', size: 2.6, weight: 900, caps: true, x: 0.04, rot: -90, blur: 0, words: 1, from: 2},
      {dy: -1.15, font: 'sans', size: 1.05, weight: 800, blur: 0, from: 0, words: 3},
      {dy: 0, font: 'sans', size: 1.05, weight: 800, kind: 'kw'},
      {dy: 1.15, font: 'sans', size: 1.05, weight: 800, blur: 0, from: 5, words: 3},
      {dy: 3.4, font: 'serif', size: 0.3, kind: 'block', blockW: 0.5, blur: 2, opacity: 0.8},
    ],
  },
};

const NEWSPRINT: Record<string, MatchLayout> = {
  photo_headline: {
    id: 'photo_headline',
    bg: '#E8DCDA',
    rows: [
      {dy: -3.2, font: 'sans', size: 0.5, weight: 800, caps: true, x: 0.62, blur: 1, opacity: 0.9, words: 2, tracking: 0.12},
      {dy: -2.1, font: 'sans', size: 1.5, weight: 900, caps: true, x: 0.6, blur: 0, words: 1, from: 2},
      {dy: 0, font: 'serif', size: 1.25, weight: 600, kind: 'kw', kwCase: 'upper'},
    ],
    decor: [{kind: 'halftone', y0: 0.52, y1: 0.8, blur: 4}],
  },
  newsletter_peach: {
    id: 'newsletter_peach',
    bg: '#F0D8BC',
    rows: [
      {dy: -3.4, font: 'sans', size: 0.42, x: 0.28, blur: 0, words: 3},
      {dy: -1.9, font: 'sans', size: 1.35, weight: 900, caps: true, blur: 0, words: 2, from: 3},
      {dy: 0, font: 'serif', size: 1.25, weight: 600, kind: 'kw', kwCase: 'upper'},
      {dy: 2.2, font: 'serif', size: 0.7, italic: true, blur: 1, opacity: 0.75, from: 1},
      {dy: 3.2, font: 'serif', size: 0.7, italic: true, blur: 2, opacity: 0.6, from: 4},
      {dy: 4.2, font: 'serif', size: 0.7, italic: true, blur: 2, opacity: 0.45, from: 6},
    ],
    decor: [
      {kind: 'bar', y0: 0, y1: 0.05, color: '#B8A18C'},
      {kind: 'rule', dy: 0.85, x0: 0.14, x1: 0.86, thick: 3},
    ],
  },
  clipped_phrase_blush: {
    id: 'clipped_phrase_blush',
    bg: '#F9E8E4',
    rows: [
      {dy: 0, font: 'serif', size: 1.25, weight: 600, kind: 'kw', kwCase: 'upper'},
      {dy: 2.5, font: 'sans', size: 0.62, weight: 800, blur: 1, opacity: 0.85, x: 0.56, words: 3},
    ],
  },
  image_strip_rules: {
    id: 'image_strip_rules',
    bg: '#F9E8E4',
    rows: [
      {dy: 0, font: 'serif', size: 1.1, weight: 600, kind: 'kw', kwCase: 'title'},
      {dy: 2.4, font: 'sans', size: 0.62, weight: 800, blur: 0, from: 0, words: 4},
      {dy: 3.2, font: 'sans', size: 0.62, weight: 800, blur: 1, from: 3, words: 4},
      {dy: 4, font: 'sans', size: 0.62, weight: 800, blur: 2, opacity: 0.8, from: 5, words: 4},
      {dy: 4.8, font: 'sans', size: 0.62, weight: 800, blur: 2, opacity: 0.55, from: 1, words: 4},
    ],
    decor: [
      {kind: 'halftone', y0: 0, y1: 0.12, blur: 5},
    ],
  },
  repeating_serif_rows: {
    id: 'repeating_serif_rows',
    bg: '#E8E4D0',
    rows: [
      {dy: -3.6, font: 'sans', size: 0.9, weight: 900, blur: 1, opacity: 0.85, words: 2},
      {dy: -1.4, font: 'serif', size: 0.85, blur: 3, opacity: 0.6, from: 2},
      {dy: 0, font: 'serif', size: 1.15, italic: true, kind: 'kw', kwCase: 'title'},
      {dy: 1.4, font: 'serif', size: 0.85, blur: 3, opacity: 0.6, from: 5},
      {dy: 2.8, font: 'serif', size: 0.85, blur: 3, opacity: 0.5, from: 1},
    ],
    decor: [{kind: 'rule', dy: -2.5, x0: 0, x1: 1, thick: 3}],
  },
};

export const MATCH_CUT_SPECS: Readonly<Record<MatchCutVariant, MatchVariantSpec>> = {
  memo: {
    id: 'memo',
    label: 'T1 Typewriter Memo',
    sceneSec: 0.16,
    anchor: {x: 0.5, y: 0.424},
    keyword: {bg: '#EFDE28', fg: '#1A1A1A', padEm: [0.15, 0.1]},
    ink: '#222222',
    background: {color: '#DCDCDE', vignette: 0.1},
    layouts: MEMO,
    cycle: ['memo_header', 'blur_column', 'serif_block', 'bold_sans_line'],
  },
  editorial: {
    id: 'editorial',
    label: 'T2 Editorial Blast',
    sceneSec: 0.2,
    anchor: {x: 0.5, y: 0.432},
    lateAnchorY: [0.392],
    keyword: {bg: '#F1F858', fg: '#111111', padEm: [0.2, 0.08]},
    ink: '#111111',
    background: {color: '#E8E8E8', vignette: 0.15},
    pushIn: {from: 1, to: 1.14},
    layouts: EDITORIAL,
    cycle: ['didone_stack', 'grotesque_split', 'centered_serif_quote', 'mixed_scale_serif', 'script_and_caps', 'vertical_word_sans_block'],
  },
  newsprint: {
    id: 'newsprint',
    label: 'T3 Newsprint Tag',
    sceneSec: 0.23,
    anchor: {x: 0.48, y: 0.43},
    lateAnchorY: [0.376, 0.356],
    keyword: {bg: '#F58515', fg: '#2A1A0A', padEm: [0.2, 0.12]},
    ink: '#222222',
    background: {color: '#F9E8E4', vignette: 0.06},
    sceneBackgrounds: ['#E8DCDA', '#F0D8BC', '#F9E8E4', '#F9E8E4', '#E8E4D0'],
    layouts: NEWSPRINT,
    cycle: ['photo_headline', 'newsletter_peach', 'clipped_phrase_blush', 'image_strip_rules', 'repeating_serif_rows'],
  },
};

export type MatchScene = {
  index: number;
  startSec: number;
  endSec: number;
  layoutId: string;
  keyword: string;
  anchor: {x: number; y: number};
  bg: string;
};

export const MATCH_CUT_MIN_SCENES = 4;
export const MATCH_CUT_MAX_SCENES = 9;

/** Whole-frame snapped scene length for a variant. */
export function sceneFrames(variant: MatchCutVariant, fps: number): number {
  return Math.max(2, Math.round(MATCH_CUT_SPECS[variant].sceneSec * fps));
}

/**
 * The scene plan for a beat of `durSec`. Hard cuts on a uniform grid snapped to whole frames; the layout cycle never repeats a layout in adjacent scenes
 * except the T1 keyword swap point, where the layout family may repeat. `swap` (a second spoken keyword) swaps at the midpoint.
 */
export function planMatchCutScenes(input: {variant: MatchCutVariant; durSec: number; fps: number; keyword: string; swap?: string}): MatchScene[] {
  const spec = MATCH_CUT_SPECS[input.variant];
  const per = sceneFrames(input.variant, input.fps);
  const total = Math.round(input.durSec * input.fps);
  const n = Math.max(MATCH_CUT_MIN_SCENES, Math.min(MATCH_CUT_MAX_SCENES, Math.floor(total / per)));
  const swapAt = input.swap ? Math.ceil(n / 2) : n;
  const scenes: MatchScene[] = [];
  let cycleIdx = 0;
  for (let i = 0; i < n; i++) {
    // the layout family repeats once per keyword (T1), so the swap scene reuses the previous layout instead of advancing
    if (i > 0 && i !== swapAt) cycleIdx += 1;
    const layoutId = spec.cycle[cycleIdx % spec.cycle.length]!;
    const late = spec.lateAnchorY && i >= n - spec.lateAnchorY.length ? spec.lateAnchorY[i - (n - spec.lateAnchorY.length)]! : undefined;
    scenes.push({
      index: i,
      startSec: (i * per) / input.fps,
      endSec: ((i + 1) * per) / input.fps,
      layoutId,
      keyword: i >= swapAt && input.swap ? input.swap : input.keyword,
      anchor: {x: spec.anchor.x, y: late ?? spec.anchor.y},
      bg: spec.sceneBackgrounds ? spec.sceneBackgrounds[i % spec.sceneBackgrounds.length]! : (spec.layouts[layoutId]?.bg ?? spec.background.color),
    });
  }
  return scenes;
}

/** Scene index at frame `frame` (clamped), plus 0..1 progress inside the scene. */
export function sceneAt(scenes: readonly MatchScene[], variant: MatchCutVariant, fps: number, frame: number): {scene: MatchScene; progress: number} {
  const per = sceneFrames(variant, fps);
  const i = Math.max(0, Math.min(scenes.length - 1, Math.floor(frame / per)));
  const local = frame - i * per;
  return {scene: scenes[i]!, progress: Math.max(0, Math.min(1, local / per))};
}

/** Linear push-in scale (T2): 1.00 -> 1.14 over the scene, no easing, resets at each cut. */
export function pushInScale(variant: MatchCutVariant, progress: number): number {
  const p = MATCH_CUT_SPECS[variant].pushIn;
  return p ? p.from + (p.to - p.from) * progress : 1;
}

/** Cycle `pool` words starting at `from`, until `minChars` is reached (or `words` words when given). Deterministic; only ever the speaker's own words. */
export function fillFromPool(pool: readonly string[], from: number, opts: {words?: number; minChars?: number}): string {
  if (pool.length === 0) return '';
  const out: string[] = [];
  let chars = 0;
  const limit = opts.words ?? 64;
  for (let i = 0; i < limit; i++) {
    const w = pool[(from + i) % pool.length]!;
    out.push(w);
    chars += w.length + 1;
    if (opts.words === undefined && chars >= (opts.minChars ?? 60)) break;
  }
  return out.join(' ');
}

export function applyKeywordCase(keyword: string, mode: MatchRow['kwCase']): string {
  if (mode === 'upper') return keyword.toUpperCase();
  if (mode === 'lower') return keyword.toLowerCase();
  if (mode === 'title') return keyword.replace(/\p{L}[\p{L}'’]*/gu, w => w[0]!.toUpperCase() + w.slice(1).toLowerCase());
  return keyword;
}
