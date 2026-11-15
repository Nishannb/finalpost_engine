/**
 * SUBJECT STAGE speaker protection (Phase 5.25). Pure: no I/O.
 *
 * The protected region is the speaker's ACTUAL visible performance over a span, not "the area below the face":
 *   matte_grid   the person matte mapped into the composition (`compositionMatte`, the Kinetic V2 grid: 36 x 64 cells, every 3rd output frame, through the keep segments, the cover crop and the
 *                zooms). Every cell the person covers in ANY sampled frame of the span is protected (face, head, shoulders, torso, arms, hands and the gestures / movement that actually
 *                happen in the span), dilated by one cell. The face keep-out (top 42 % of the measured box) is always protected as well.
 *   speaker_box  no usable grid (decode failed, a provided cutout, an unreliable matte): the measured box, widened by a gesture margin, plus the face keep-out. Conservative: on a tight shot
 *                nothing is left, so the treatment is omitted.
 * Reliability: a span's matte is reliable when the grid samples it continuously (>= 90 % of the expected samples, no missing frames) and the person is present (<= 10 % empty samples).
 *
 * This is geometry from the matte and the measured box. It is NOT a hand / pose detector: a hand the matte misses is not protected (see the Phase 5.25 report).
 */
import type {AlphaGrid} from '../kinetic/scene.ts';
import type {Rect} from './stageDesign.ts';

export const PROTECTION = {
  /** dilation of the union mask, in cells (1 cell = 2.8 % of the width, 1.6 % of the height) */
  dilateCells: 1,
  /** speaker_box basis: the box widened by this fraction of the frame width on each side (arms / hands leave the static box) */
  gestureMarginW: 0.06,
  /** reliability: share of the expected grid samples that must exist in the span */
  minSampleShare: 0.9,
  /** reliability: at most this share of the span's samples may be empty (no person) */
  maxEmptyShare: 0.1,
  /** the grid samples every n-th output frame (compositionMatte default) */
  stepFrames: 3,
} as const;

export type SpanProtection = {
  basis: 'matte_grid' | 'speaker_box';
  cols: number;
  rows: number;
  /** 1 = protected for a FRONT element (union of the person over the span, dilated, + the face keep-out) */
  blocked: Uint8Array;
  /** per cell: share of the span's samples in which the person covers it (matte_grid only) */
  meanCover: Float32Array;
  /** the span's matte is complete and the person present (matte_grid only; speaker_box = false) */
  reliable: boolean;
  reason?: 'no_grid' | 'too_few_samples' | 'person_missing';
  samples: number;
  expected: number;
  /** the span's samples (for occlusion checks): one bitset per sampled frame */
  frames: Uint8Array[];
};

function decode(bits: string, n: number): Uint8Array {
  const b = Buffer.from(bits, 'base64');
  const out = new Uint8Array(n);
  for (let i = 0; i < n && i < b.length; i += 1) out[i] = b[i]! > 0 ? 1 : 0;
  return out;
}
function markRect(mask: Uint8Array, cols: number, rows: number, r: Rect) {
  const x0 = Math.max(0, Math.floor(r.x * cols)), x1 = Math.min(cols, Math.ceil((r.x + r.w) * cols));
  const y0 = Math.max(0, Math.floor(r.y * rows)), y1 = Math.min(rows, Math.ceil((r.y + r.h) * rows));
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) mask[y * cols + x] = 1;
}

/** The protection of one span [start, end) (output seconds). */
export function spanProtection(input: {grid: AlphaGrid | null | undefined; fps: number; start: number; end: number; subjectBox: Rect | null; faceKeepOut: Rect | null}): SpanProtection {
  const cols = input.grid?.cols ?? 36, rows = input.grid?.rows ?? 64, n = cols * rows;
  const blocked = new Uint8Array(n);
  const meanCover = new Float32Array(n);
  const f0 = Math.round(input.start * input.fps), f1 = Math.round(input.end * input.fps);
  const expected = Math.max(1, Math.ceil((f1 - f0) / PROTECTION.stepFrames));
  if (input.faceKeepOut) markRect(blocked, cols, rows, input.faceKeepOut);
  const boxFallback = (reason: SpanProtection['reason'], samples = 0, frames: Uint8Array[] = []): SpanProtection => {
    if (input.subjectBox) markRect(blocked, cols, rows, {x: input.subjectBox.x - PROTECTION.gestureMarginW, y: input.subjectBox.y, w: input.subjectBox.w + 2 * PROTECTION.gestureMarginW, h: input.subjectBox.h});
    return {basis: 'speaker_box', cols, rows, blocked, meanCover, reliable: false, ...(reason ? {reason} : {}), samples, expected, frames};
  };
  if (!input.grid || input.grid.samples.length === 0) return boxFallback('no_grid');
  const frames = input.grid.samples.filter(s => s.frame >= f0 && s.frame < f1).map(s => decode(s.bits, n));
  if (frames.length < PROTECTION.minSampleShare * expected) return boxFallback('too_few_samples', frames.length, frames);
  const empty = frames.filter(f => !f.some(v => v === 1)).length;
  if (empty > PROTECTION.maxEmptyShare * frames.length) return boxFallback('person_missing', frames.length, frames);
  const union = new Uint8Array(n);
  for (const f of frames) for (let i = 0; i < n; i += 1) { if (f[i]) { union[i] = 1; meanCover[i]! += 1 / frames.length; } }
  const d = PROTECTION.dilateCells;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (!union[y * cols + x]) continue;
      for (let dy = -d; dy <= d; dy += 1) for (let dx = -d; dx <= d; dx += 1) {
        const yy = y + dy, xx = x + dx;
        if (yy >= 0 && yy < rows && xx >= 0 && xx < cols) blocked[yy * cols + xx] = 1;
      }
    }
  }
  return {basis: 'matte_grid', cols, rows, blocked, meanCover, reliable: true, samples: frames.length, expected, frames};
}

/** Whether a rect touches any protected cell (front elements must not). */
export function touchesProtected(p: SpanProtection, r: Rect): boolean {
  // 1 % of a cell (0.2 px at 1920): tolerance for the 4-decimal rounding of emitted rects (an edge exactly on a cell boundary does not reach into the next cell)
  const x0 = Math.max(0, Math.floor(r.x * p.cols + 0.01)), x1 = Math.min(p.cols, Math.ceil((r.x + r.w) * p.cols - 0.01));
  const y0 = Math.max(0, Math.floor(r.y * p.rows + 0.01)), y1 = Math.min(p.rows, Math.ceil((r.y + r.h) * p.rows - 0.01));
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) if (p.blocked[y * p.cols + x]) return true;
  return false;
}

/** Occlusion of a rect by the person over the span's samples: per sample the covered share of the rect's cells; mean and max (matte_grid only; speaker_box -> null = unknown). */
export function spanOcclusion(p: SpanProtection, r: Rect): {mean: number; max: number} | null {
  if (p.basis !== 'matte_grid' || p.frames.length === 0) return null;
  // 1 % of a cell (0.2 px at 1920): tolerance for the 4-decimal rounding of emitted rects (an edge exactly on a cell boundary does not reach into the next cell)
  const x0 = Math.max(0, Math.floor(r.x * p.cols + 0.01)), x1 = Math.min(p.cols, Math.ceil((r.x + r.w) * p.cols - 0.01));
  const y0 = Math.max(0, Math.floor(r.y * p.rows + 0.01)), y1 = Math.min(p.rows, Math.ceil((r.y + r.h) * p.rows - 0.01));
  const cells = Math.max(1, (x1 - x0) * (y1 - y0));
  let sum = 0, max = 0;
  for (const f of p.frames) {
    let c = 0;
    for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) if (f[y * p.cols + x]) c += 1;
    const v = c / cells;
    sum += v;
    max = Math.max(max, v);
  }
  return {mean: sum / p.frames.length, max};
}

/**
 * Maximal free rectangles (composition fractions) inside `within`: no protected cell. Histogram / stack scan over the grid; returns the largest first (at most `limit`).
 */
export function freeRects(p: SpanProtection, within: Rect, limit = 40): Rect[] {
  const {cols, rows} = p;
  const cx0 = Math.ceil(within.x * cols - 1e-9), cx1 = Math.floor((within.x + within.w) * cols + 1e-9);
  const cy0 = Math.ceil(within.y * rows - 1e-9), cy1 = Math.floor((within.y + within.h) * rows + 1e-9);
  const w = cx1 - cx0;
  if (w <= 0 || cy1 <= cy0) return [];
  const heights = new Array<number>(w).fill(0);
  const found = new Map<string, Rect & {area: number}>();
  for (let y = cy0; y < cy1; y += 1) {
    for (let i = 0; i < w; i += 1) heights[i] = p.blocked[y * cols + cx0 + i] ? 0 : heights[i]! + 1;
    const stack: number[] = [];
    for (let i = 0; i <= w; i += 1) {
      const h = i === w ? 0 : heights[i]!;
      let start = i;
      while (stack.length && heights[stack[stack.length - 1]!]! >= h) {
        const top = stack.pop()!;
        const hh = heights[top]!;
        start = stack.length ? stack[stack.length - 1]! + 1 : 0;
        if (hh > 0) {
          const rect = {x: (cx0 + start) / cols, y: (y - hh + 1) / rows, w: (i - start) / cols, h: hh / rows};
          const key = `${start}:${i}:${y}:${hh}`;
          found.set(key, {...rect, area: rect.w * rect.h});
        }
      }
      stack.push(i);
    }
  }
  return [...found.values()].sort((a, b) => b.area - a.area).slice(0, limit).map(({area: _a, ...r}) => r);
}

/**
 * Output-second intervals where the matte is present and continuous (runs of non-empty grid samples; a gap of more than 0.5 s or an empty sample ends a run). The renderer draws the person
 * foreground and every matte-dependent element only inside these intervals (an incomplete matte never leaves a plate without the person over it).
 */
export function reliableIntervals(grid: AlphaGrid | null | undefined, fps: number, stepFrames: number = PROTECTION.stepFrames): Array<{start: number; end: number}> {
  if (!grid || grid.samples.length === 0) return [];
  const n = grid.cols * grid.rows;
  const out: Array<{start: number; end: number}> = [];
  let cur: {start: number; end: number} | null = null;
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  for (const s of [...grid.samples].sort((a, b) => a.frame - b.frame)) {
    const present = decode(s.bits, n).some(v => v === 1);
    const t = s.frame / fps, tEnd = (s.frame + stepFrames) / fps;
    if (present && cur && t - cur.end <= 0.5 + 1e-9) cur.end = tEnd;
    else if (present) { if (cur) out.push(cur); cur = {start: t, end: tEnd}; }
    else if (cur) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out.map(i => ({start: r3(i.start), end: r3(i.end)}));
}
