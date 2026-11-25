/**
 * Composer kit: the deterministic building blocks every composition uses. Measurement (the solver's own font tables), row fitting inside a region, the frame-exact motion
 * vocabulary (sampled into word keyframes the compositor only interpolates), event assembly in the RenderSpec contract, the free regions around the speaker, and scene-element
 * builders (plates, shapes, counters). Pure.
 */
import {FONT_METRICS, textWidthEm} from '../measure.ts';
import {entryFrames, exitFrames, expoIn, expoOut, cubicBezier} from '../motion.ts';
import {boxSpan} from '../scene.ts';
import type {AnimName, ExitName, FontKey, KineticWord, LineRole, RenderEvent, RenderLine, SceneElement, SceneKey, WordKeyframe} from '../schema.ts';
import type {Align, ComposeCtx, CompositionName, ExitVerb, PxRect, Verb, ZoneKey} from './types.ts';
import type {WordStyle} from './voice.ts';

export const round2 = (n: number): number => Math.round(n * 100) / 100;
export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** readability floors (px at the composition height): the production stage refuses anything below 0.96 x these */
export const keyFloorPx = (H: number): number => Math.ceil(0.075 * H * 0.975);
export const smallFloorPx = (H: number): number => Math.ceil(0.035 * H * 0.975);

/** What is drawn for a spoken token: surrounding punctuation removed (a question mark may stay), never a different word. */
export function displayText(raw: string, keepQuestion = false): string {
  let t = raw.trim().replace(/^["'“‘(\[]+/, '');
  t = t.replace(keepQuestion ? /[,.;:!…"'”’)\]]+$/ : /[,.;:!?…"'”’)\]]+$/, '');
  return t || raw.trim();
}

// ------------------------------------------------------------------------------------------------ motion vocabulary

/** each verb borrows the duration of a library entry so the shared guardrails (restingRange) see the exact rest window */
export const VERB_ANIM: Record<Verb, AnimName> = {rise: 'IN-1', pop: 'IN-4', slam: 'IN-7', whip: 'IN-3', drop: 'IN-5', mask: 'IN-2', track: 'IN-8', glitch: 'IN-9', zoomThrough: 'IN-10', flip: 'E2', spin: 'E4', blurIn: 'E1', cut: 'IN-6', slide: 'E3'};
export const EXIT_NAME: Record<ExitVerb, ExitName> = {fade: 'OUT-4', sink: 'X3', blurOut: 'X5', scaleOut: 'OUT-1', whipOut: 'OUT-2', lift: 'X6', cut: 'OUT-5', slideOut: 'X4'};
const backOut = cubicBezier(0.34, 1.56, 0.64, 1);

type Pose = Partial<Omit<WordKeyframe, 'frame'>>;
const REST: Omit<WordKeyframe, 'frame'> = {x: 0, y: 0, scale: 1, opacity: 1, rotateX: 0, rotateY: 0, blurPx: 0, z: 0, trackingEm: 0, mask: 1, glowK: 1, ghost: 0, scaleX: 1, split: 0};

/** entry pose at linear progress u (0..1) */
export function entryPose(verb: Verb, u: number, dir: -1 | 1, k: number, amp = 1): Pose {
  const e = expoOut(clamp(u, 0, 1));
  const o = (m: number) => Math.min(1, u * m);
  switch (verb) {
    case 'rise': return {y: 46 * amp * (1 - e), opacity: e, blurPx: 6 * (1 - e)};
    case 'pop': return {scale: 0.5 + 0.5 * backOut(clamp(u, 0, 1)), opacity: o(3)};
    case 'slam': return {scale: 1.9 - 0.9 * e, opacity: o(4), blurPx: 10 * (1 - e)};
    case 'whip': return {x: dir * 170 * amp * (1 - e), scaleX: 1 + 0.6 * (1 - e), blurPx: 8 * (1 - e), opacity: o(3)};
    case 'drop': return {y: -80 * amp * (1 - backOut(clamp(u, 0, 1))), opacity: o(3)};
    case 'mask': return {mask: e, x: -14 * (1 - e)};
    case 'track': return {trackingEm: 0.45 * (1 - e), opacity: e, blurPx: 4 * (1 - e)};
    case 'glitch': return {split: 18 * (1 - u), x: (k % 2 ? 7 : -7) * (1 - u), opacity: u < 0.3 ? 0.55 : 1};
    case 'zoomThrough': return {scale: 3 - 2 * e, opacity: o(2.5), blurPx: 12 * (1 - e)};
    case 'flip': return {rotateX: 82 * (1 - e), opacity: o(2)};
    case 'spin': return {rotateY: -78 * (1 - e) * dir, opacity: o(2)};
    case 'blurIn': return {blurPx: 14 * (1 - e), opacity: e, scale: 1.06 - 0.06 * e};
    case 'slide': return {x: dir * 280 * amp * (1 - e), opacity: o(2.5), blurPx: 5 * (1 - e)};
    case 'cut': default: return {opacity: 1};
  }
}

/** exit pose at linear progress u (0..1) */
export function exitPose(verb: ExitVerb, u: number, dir: -1 | 1): Pose {
  const e = expoIn(clamp(u, 0, 1));
  switch (verb) {
    case 'fade': return {opacity: 1 - e};
    case 'sink': return {y: 34 * e, opacity: 1 - e};
    case 'blurOut': return {blurPx: 12 * e, opacity: 1 - e};
    case 'scaleOut': return {scale: 1 + 0.3 * e, opacity: 1 - e};
    case 'whipOut': return {x: dir * 190 * e, scaleX: 1 + 1.1 * e, opacity: 1 - e, blurPx: 6 * e};
    case 'lift': return {y: -42 * e, opacity: 1 - e};
    case 'slideOut': return {x: dir * 280 * e, opacity: 1 - e, blurPx: 5 * e};
    case 'cut': default: return {opacity: u >= 1 ? 0 : 1};
  }
}

/** Word keyframes (absolute frames): entry sampled per frame, rest, exit sampled per frame. */
export function wordKeyframes(o: {verb: Verb; enterAbs: number; exitVerb: ExitVerb; exitStartAbs: number; exitEndAbs: number; fps: number; dir: -1 | 1; exitDir?: -1 | 1; k: number; amp?: number}): WordKeyframe[] {
  const out: WordKeyframe[] = [];
  const push = (frame: number, p: Pose) => {
    const kf: WordKeyframe = {frame, ...REST, ...p};
    for (const key of Object.keys(kf) as Array<keyof WordKeyframe>) kf[key] = round2(kf[key]);
    if (out.length && out[out.length - 1]!.frame >= frame) out[out.length - 1] = kf; else out.push(kf);
  };
  const len = entryFrames(VERB_ANIM[o.verb], o.fps);
  // the exit is never pushed later than planned (a late exit runs into the words that replace this one): a word that has not settled by then is cut short of its entry
  const exitStart = Math.max(o.enterAbs + 1, o.exitStartAbs);
  if (o.verb === 'cut') push(o.enterAbs, {});
  else for (let f = 0; f <= len && o.enterAbs + f < exitStart; f += 1) push(o.enterAbs + f, entryPose(o.verb, f / len, o.dir, o.k, o.amp ?? 1));
  push(exitStart, {});
  const xl = Math.max(1, o.exitEndAbs - exitStart);
  if (o.exitVerb === 'cut') { push(Math.max(exitStart, o.exitEndAbs - 1), {}); push(o.exitEndAbs, {opacity: 0}); }
  else for (let f = 1; f <= xl; f += 1) push(exitStart + f, exitPose(o.exitVerb, f / xl, o.exitDir ?? o.dir));
  return out;
}

// ------------------------------------------------------------------------------------------------ measurement + fitting

export type WordSpec = {
  /** transcript index (-1 = none) */
  idx: number;
  text: string;
  role: LineRole;
  style: WordStyle;
  /** size relative to the block's base size */
  mult: number;
  verb: Verb;
  enterAbs: number;
  /** early exit (a swap): absolute frame its exit starts, else null */
  exitAbs?: number | null;
  exitVerb?: ExitVerb;
  glow?: {color: string; radiusPx: number; opacity: number} | null;
  textOpacity?: number;
};
export type Placed = WordSpec & {x: number; y: number; w: number; h: number; px: number};

export const wordWidthEm = (w: Pick<WordSpec, 'text' | 'style'>): number => textWidthEm(w.text, w.style.font, w.style.weight, w.style.uppercase, 0);
export const lineEm = (f: FontKey): number => FONT_METRICS[f].lineEm;

export type FitOpts = {align: Align; valign: 'top' | 'center' | 'bottom'; maxBase: number; rowGapEm?: number; wordGapEm?: number; keyFloor: number; smallFloor: number};

/** Fit rows of words inside `rect` at the largest base size that fits (and <= maxBase). null = it cannot fit at the readability floors. */
export function fitRows(rows: WordSpec[][], rect: PxRect, o: FitOpts): {base: number; placed: Placed[]; bbox: PxRect} | null {
  const rw = rect.right - rect.left, rh = rect.bottom - rect.top;
  if (rw <= 0 || rh <= 0 || rows.length === 0) return null;
  const gapEm = o.wordGapEm ?? 0.26;
  const rowGap = o.rowGapEm ?? 0.05;
  const rowW1 = rows.map(r => r.reduce((s, w) => s + wordWidthEm(w) * w.mult, 0) + Math.max(0, r.length - 1) * gapEm * Math.max(...r.map(w => w.mult)) * 0.6);
  const rowH1 = rows.map(r => Math.max(...r.map(w => lineEm(w.style.font) * w.mult)));
  const totalH1 = rowH1.reduce((s, h) => s + h, 0) + rowGap * Math.max(0, rows.length - 1);
  const base = Math.floor(Math.min(o.maxBase, (rw * 0.94) / Math.max(...rowW1), (rh * 0.96) / totalH1));
  if (!(base > 0)) return null;
  for (const r of rows) for (const w of r) {
    const px = base * w.mult;
    const floor = w.role === 'hero' || w.role === 'punch' ? o.keyFloor : o.smallFloor;
    if (px < floor) return null;
  }
  const blockH = totalH1 * base;
  let y = o.valign === 'top' ? rect.top : o.valign === 'bottom' ? rect.bottom - blockH : rect.top + (rh - blockH) / 2;
  const placed: Placed[] = [];
  rows.forEach((r, ri) => {
    const width = rowW1[ri]! * base;
    let x = o.align === 'left' ? rect.left : o.align === 'right' ? rect.right - width : rect.left + (rw - width) / 2;
    const rowH = rowH1[ri]! * base;
    const gap = gapEm * Math.max(...r.map(w => w.mult)) * 0.6 * base;
    for (const w of r) {
      const px = Math.round(base * w.mult);
      const ww = wordWidthEm(w) * px, hh = lineEm(w.style.font) * px;
      placed.push({...w, x, y: y + (rowH - hh) * 0.75, w: ww, h: hh, px});
      x += ww + gap;
    }
    y += rowH + rowGap * base;
  });
  return {base, placed, bbox: bboxOf(placed)};
}

export const bboxOf = (ps: ReadonlyArray<{x: number; y: number; w: number; h: number}>): PxRect => ({
  left: Math.min(...ps.map(p => p.x)), top: Math.min(...ps.map(p => p.y)), right: Math.max(...ps.map(p => p.x + p.w)), bottom: Math.max(...ps.map(p => p.y + p.h)),
});
export const inset = (r: PxRect, dx: number, dy = dx): PxRect => ({left: r.left + dx, right: r.right - dx, top: r.top + dy, bottom: r.bottom - dy});
export const rectH = (r: PxRect): number => r.bottom - r.top;
export const rectW = (r: PxRect): number => r.right - r.left;

// ------------------------------------------------------------------------------------------------ regions around the speaker

export type Zones = Partial<Record<ZoneKey, PxRect>> & {face: PxRect; body: PxRect};

/** Free regions for a frame window: the face keep-out (upper 42% of the speaker box, zoom-aware via the box track) is never part of any region except `full` (takeover cards). */
export function zonesFor(ctx: ComposeCtx, f0: number, f1: number): Zones {
  const {W, H, safe} = ctx;
  const b = boxSpan(ctx.scene, f0, f1);
  const pad = 0.014 * H;
  const body: PxRect = {left: b.x * W, right: (b.x + b.w) * W, top: b.y * H, bottom: (b.y + b.h) * H};
  const face: PxRect = {left: body.left - pad, right: body.right + pad, top: body.top - pad, bottom: body.top + 0.42 * (body.bottom - body.top) + pad};
  const z: Zones = {face, body, full: {left: safe.left, right: safe.right, top: safe.top, bottom: safe.bottom}};
  const top: PxRect = {left: safe.left, right: safe.right, top: safe.top, bottom: Math.min(face.top - 8, safe.bottom)};
  if (rectH(top) >= 0.085 * H) z.top = top;
  const belowTop = Math.max(safe.top, face.bottom + 0.008 * H);
  const below: PxRect = {left: safe.left, right: safe.right, top: belowTop, bottom: safe.bottom};
  if (rectH(below) >= 0.11 * H) {
    z.below = below;
    const bh = rectH(below);
    z.chest = {...below, bottom: below.top + Math.max(0.58 * bh, Math.min(bh, 0.16 * H))};
    z.low = {...below, top: Math.max(below.top, below.bottom - Math.max(0.5 * bh, Math.min(bh, 0.16 * H)))};
  }
  const left: PxRect = {left: safe.left, right: face.left - 10, top: safe.top, bottom: safe.bottom};
  if (rectW(left) >= 0.2 * W) z.left = left;
  const right: PxRect = {left: face.right + 10, right: safe.right, top: safe.top, bottom: safe.bottom};
  if (rectW(right) >= 0.2 * W) z.right = right;
  return z;
}

// ------------------------------------------------------------------------------------------------ events

export type EventInput = {
  id: string;
  composition: CompositionName;
  placed: Placed[];
  words: readonly KineticWord[];
  inFrame: number;
  outFrame: number;
  fps: number;
  exitVerb: ExitVerb;
  dir: -1 | 1;
  wordRange: [number, number];
  shadow: RenderEvent['shadow'];
  /** rotateY of the block (deg): the slant (the type recedes / comes out) */
  tilt?: number;
  /** rotateX of the block (deg) */
  pitch?: number;
  /** perspective (px) of the block; a slant uses a short one */
  perspectivePx?: number;
  /** a slanted block slides this much (px) so its PROJECTED box stays inside its region */
  shift?: {x: number; y: number};
  /** in-plane rotation (deg) about `pivot` (default: the block centre). Several events of one treatment share a pivot so they turn as one. */
  rotate?: number;
  pivot?: {x: number; y: number};
  /** side the words leave to (default `dir`) */
  exitDir?: -1 | 1;
  layering?: 'front' | 'behind';
  /** slow push over the hold */
  push?: number;
  /** horizontal drift over the hold (px) */
  drift?: number;
  notes?: string[];
  /** every word of the treatment when it is split over several events (plain + backed): entry paths clear the words of the sibling event too */
  context?: Placed[];
};

export function buildEvent(e: EventInput): RenderEvent {
  const bb = bboxOf(e.placed);
  const bw = bb.right - bb.left, bh = bb.bottom - bb.top;
  const cx = (bb.left + bb.right) / 2, cy = (bb.top + bb.bottom) / 2;
  const exitLen = exitFrames(EXIT_NAME[e.exitVerb], e.fps);
  const exitStart = e.outFrame - Math.max(1, exitLen);
  // an entering word never travels across a word already on screen: a side entry comes from the clear side (or travels only as far as the gap), a rise / drop stops short of the row it would cross
  const path = (p: Placed): {dir: -1 | 1; amp: number} => {
    const on = (e.context ?? e.placed).filter(q => q !== p && q.idx !== p.idx && q.enterAbs < p.enterAbs && (q.exitAbs === undefined || q.exitAbs === null || q.exitAbs > p.enterAbs));
    const sameRow = on.filter(q => Math.min(q.y + q.h, p.y + p.h) - Math.max(q.y, p.y) > 0.25 * Math.min(q.h, p.h));
    const sameCol = on.filter(q => Math.min(q.x + q.w, p.x + p.w) - Math.max(q.x, p.x) > 0);
    const room = (side: -1 | 1) => Math.min(Infinity, ...sameRow.filter(q => (side < 0 ? q.x + q.w <= p.x + 1 : q.x >= p.x + p.w - 1)).map(q => (side < 0 ? p.x - (q.x + q.w) : q.x - (p.x + p.w)) - 6));
    const vroom = (side: -1 | 1) => Math.min(Infinity, ...sameCol.filter(q => (side < 0 ? q.y + q.h <= p.y + 1 : q.y >= p.y + p.h - 1)).map(q => (side < 0 ? p.y - (q.y + q.h) : q.y - (p.y + p.h)) - 4));
    const travel = (d: number, r: number) => (r === Infinity ? 1 : clamp(r / d, 0, 1));
    if (p.verb === 'slide' || p.verb === 'whip') {
      const d = p.verb === 'slide' ? 280 : 170;
      const own = travel(d, room(e.dir)), other = travel(d, room(e.dir === 1 ? -1 : 1));
      return own >= 1 || own >= other ? {dir: e.dir, amp: own} : {dir: e.dir === 1 ? -1 : 1, amp: other};
    }
    if (p.verb === 'rise') return {dir: e.dir, amp: travel(46, vroom(1))};
    if (p.verb === 'drop') return {dir: e.dir, amp: travel(80, vroom(-1))};
    return {dir: e.dir, amp: 1};
  };
  const lines: RenderLine[] = e.placed.map((p, k) => {
    const pp = path(p);
    const early = p.exitAbs !== undefined && p.exitAbs !== null && p.exitAbs < exitStart;
    const xv = early ? (p.exitVerb ?? 'cut') : e.exitVerb;
    const xs = early ? p.exitAbs! : exitStart;
    // every word settles before it leaves: a late word enters a little early rather than being judged (and seen) mid-motion. It NEVER enters before the words it replaces
    // (a previous phrase line / swap unit that exits before this word was due) have fully left the frame: two lines in one spot would print over each other.
    const floor = e.placed.reduce((m, q) => (q !== p && q.exitAbs !== undefined && q.exitAbs !== null && q.exitAbs <= p.enterAbs ? Math.max(m, q.exitAbs + Math.max(1, exitFrames(EXIT_NAME[q.exitVerb ?? 'cut'], e.fps))) : m), e.inFrame);
    const enterAbs = clamp(Math.max(floor, Math.min(p.enterAbs, xs - entryFrames(VERB_ANIM[p.verb], e.fps) - 2)), e.inFrame, e.outFrame - 2);
    const xe = early ? Math.min(e.outFrame, p.exitAbs! + Math.max(1, exitFrames(EXIT_NAME[xv], e.fps))) : e.outFrame;
    const spoken = p.idx >= 0 ? e.words[p.idx]?.startFrame ?? enterAbs : enterAbs;
    return {
      text: p.text, role: p.role, font: p.style.font, fontPx: p.px, italic: p.style.italic, weight: p.style.weight, letterSpacingEm: 0, uppercase: p.style.uppercase,
      dx: round2(p.x - bb.left), dy: round2(p.y - bb.top), w: round2(p.w), h: round2(p.h),
      fill: p.style.gradient ? {kind: 'gradient', colors: [...p.style.gradient], angleDeg: 90} : {kind: 'solid', colors: [p.style.color], angleDeg: 90},
      revealFrames: [], swapWords: [], swapFrames: [], wordFills: [],
      anim: VERB_ANIM[p.verb], startFrame: Math.max(0, spoken - e.inFrame), enterFrame: enterAbs - e.inFrame, color: p.style.gradient ? p.style.gradient[0] : p.style.color,
      glow: p.glow ?? null, textOpacity: p.textOpacity ?? 1, zPx: 0, exitFrame: early ? xs - e.inFrame : null,
      wordKeyframes: wordKeyframes({verb: p.verb, enterAbs, exitVerb: xv, exitStartAbs: xs, exitEndAbs: xe, fps: e.fps, dir: pp.dir, exitDir: e.exitDir ?? e.dir, k, amp: pp.amp}),
    };
  });
  // a rotated treatment turns about a shared pivot: this block's centre moves on the circle, and the block itself turns by the same angle
  const rot = e.rotate && Math.abs(e.rotate) >= 0.5 ? round2(e.rotate) : 0;
  const c0 = rot ? rotateAbout({x: cx, y: cy}, e.pivot ?? {x: cx, y: cy}, rot) : {x: cx, y: cy};
  const c = {x: c0.x + (e.shift?.x ?? 0), y: c0.y + (e.shift?.y ?? 0)};
  const kf = (frame: number, x: number, scale: number) => ({frame, x: round2(x), y: round2(c.y), scale: round2(scale), opacity: 1, rotateX: round2(e.pitch ?? 0), rotateY: round2(e.tilt ?? 0), blurPx: 0, z: 0});
  return {
    id: e.id, shotId: 'shot-0', preset: 'type.words', presetResolved: 'type.words', inFrame: e.inFrame, outFrame: e.outFrame, fps: e.fps, layering: e.layering ?? 'front', anchor: 'screen', material: 'flat', perspectivePx: e.perspectivePx ?? 1800,
    block: {w: round2(bw), h: round2(bh)}, lines, keyframes: [kf(e.inFrame, c.x, 1), kf(e.outFrame, c.x + (e.drift ?? 0), e.push ?? 1.02)],
    shadow: e.shadow, depthBlurPx: 0, tint: null, occlusionFraction: {mean: 0, max: 0}, safeProof: {ok: true, sampledKeyframes: 2, minMarginPx: 0},
    style: 'cinematicClean', zone: 'running', exit: EXIT_NAME[e.exitVerb], hold: {push: [1, e.push ?? 1.02], rotY: 0, rotX: 0, periodSec: 6}, flash: null, wordRange: e.wordRange, persistAcrossCut: false,
    notes: [...(e.notes ?? []), `dir:${e.dir}`, `exitDir:${e.exitDir ?? e.dir}`], composition: e.composition, ...(rot ? {rotateDeg: rot} : {}),
  };
}

// ------------------------------------------------------------------------------------------------ rotation + backing

export function rotateAbout(p: {x: number; y: number}, pivot: {x: number; y: number}, deg: number): {x: number; y: number} {
  const a = (deg * Math.PI) / 180, dx = p.x - pivot.x, dy = p.y - pivot.y;
  return {x: pivot.x + dx * Math.cos(a) - dy * Math.sin(a), y: pivot.y + dx * Math.sin(a) + dy * Math.cos(a)};
}
/** the axis-aligned box of `r` rotated by `deg` about `pivot` and scaled by `scale` about its own centre */
export function rotatedAabb(r: PxRect, deg: number, pivot: {x: number; y: number}, scale = 1): PxRect {
  const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
  const hw = ((r.right - r.left) / 2) * scale, hh = ((r.bottom - r.top) / 2) * scale;
  const pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => rotateAbout({x: cx + x!, y: cy + y!}, pivot, deg));
  return {left: Math.min(...pts.map(p => p.x)), right: Math.max(...pts.map(p => p.x)), top: Math.min(...pts.map(p => p.y)), bottom: Math.max(...pts.map(p => p.y))};
}
export const contains = (outer: PxRect, inner: PxRect, tol = 1): boolean => inner.left >= outer.left - tol && inner.right <= outer.right + tol && inner.top >= outer.top - tol && inner.bottom <= outer.bottom + tol;
export const unionRect = (rs: PxRect[]): PxRect => ({left: Math.min(...rs.map(r => r.left)), top: Math.min(...rs.map(r => r.top)), right: Math.max(...rs.map(r => r.right)), bottom: Math.max(...rs.map(r => r.bottom))});
/** the largest of want, 2/3 want, 1/3 want, 0 whose rotated group (at its peak push scale) still sits inside `region` */
export function angleFit(group: PxRect, region: PxRect, want: number, scale = 1.05): number {
  if (!want) return 0;
  const pivot = {x: (group.left + group.right) / 2, y: (group.top + group.bottom) / 2};
  for (const k of [1, 2 / 3, 1 / 3]) { const a = round2(want * k); if (contains(region, rotatedAabb(group, a, pivot, scale))) return a; }
  return 0;
}
/** turn scene shapes with their treatment (each shape's centre moves on the circle, the shape turns by the same angle) */
export function rotateShapes(els: SceneElement[], pivot: {x: number; y: number}, deg: number): SceneElement[] {
  if (!deg) return els;
  return els.map(el => {
    if (el.kind !== 'shape') return el;
    const c = rotateAbout({x: el.x + el.w / 2, y: el.y + el.h / 2}, pivot, deg);
    return {...el, x: round2(c.x - el.w / 2), y: round2(c.y - el.h / 2), rotateDeg: round2((el.rotateDeg ?? 0) + deg)};
  });
}
/** internal margin of text on a chip / highlighter / bar / card: glyphs never touch the border */
export const BACK_PAD_Y = 0.34;
export const BACK_PAD_X = 0.3;
export const backPad = (px: number, tight = false): {x: number; y: number} => ({x: (tight ? 0.24 : BACK_PAD_X) * px, y: BACK_PAD_Y * px});

// ------------------------------------------------------------------------------------------------ scene elements

const key = (frame: number, p: Partial<SceneKey> = {}): SceneKey => ({frame, opacity: 1, progress: 1, scale: 1, x: 0, y: 0, amount: 1, ...p});
/** strictly increasing keys */
function keys(list: SceneKey[]): SceneKey[] {
  const out: SceneKey[] = [];
  for (const k of list.sort((a, b) => a.frame - b.frame)) { if (out.length && out[out.length - 1]!.frame >= k.frame) out[out.length - 1] = k; else out.push(k); }
  return out.map(k => ({...k, opacity: round2(k.opacity), progress: round2(k.progress), scale: round2(k.scale), x: round2(k.x), y: round2(k.y), amount: round2(k.amount)}));
}

export function plateEl(id: string, effect: 'dim' | 'wash' | 'vignette' | 'blur' | 'spotlight' | 'backdrop', inFrame: number, outFrame: number, amount: number, fps: number, o: {color?: string; focus?: {x: number; y: number}; fadeIn?: number; fadeOut?: number} = {}): SceneElement {
  const fi = Math.max(1, Math.round((o.fadeIn ?? 0.2) * fps)), fo = Math.max(1, Math.round((o.fadeOut ?? 0.2) * fps));
  const mid = Math.max(inFrame + 1, Math.min(inFrame + fi, outFrame - fo - 1));
  return {kind: 'plate', id, inFrame, outFrame, effect, color: o.color ?? '#000000', ...(o.focus ? {focus: o.focus} : {}),
    keys: keys([key(inFrame, {amount: 0}), key(mid, {amount}), key(Math.max(mid + 1, outFrame - fo), {amount}), key(outFrame, {amount: 0})])};
}

/** a draw-on shape: grows in over `drawFrames` from `startAbs`, holds, fades out over the last frames of the window */
export function shapeEl(id: string, shape: 'bar' | 'box' | 'ring' | 'line' | 'arrow' | 'dot' | 'bracket', r: {x: number; y: number; w: number; h: number}, o: {inFrame: number; outFrame: number; startAbs: number; drawFrames: number; color: string; strokePx?: number; radiusPx?: number; fill?: boolean; layer?: 'under' | 'over'; origin?: 'left' | 'center' | 'right'; opacity?: number; fadeOut?: number}): SceneElement {
  const fo = Math.max(1, o.fadeOut ?? 5);
  const s = clamp(o.startAbs, o.inFrame, o.outFrame - 2);
  const samples: SceneKey[] = [key(o.inFrame, {progress: 0, opacity: o.opacity ?? 1})];
  const n = Math.max(1, o.drawFrames);
  for (let f = 0; f <= n; f += 1) samples.push(key(s + f, {progress: expoOut(f / n), opacity: o.opacity ?? 1}));
  samples.push(key(Math.max(s + n + 1, o.outFrame - fo), {opacity: o.opacity ?? 1}));
  samples.push(key(o.outFrame, {opacity: 0}));
  return {kind: 'shape', id, inFrame: o.inFrame, outFrame: o.outFrame, keys: keys(samples), shape, x: round2(r.x), y: round2(r.y), w: round2(r.w), h: round2(r.h), color: o.color, strokePx: o.strokePx ?? 0,
    radiusPx: o.radiusPx ?? 0, rotateDeg: 0, fill: o.fill ?? true, layer: o.layer ?? 'under', origin: o.origin ?? 'left'};
}

/** a counter: pops in, ticks from `from` to `to` (ease-out) between countStart and countEnd, holds, exits */
export function counterEl(id: string, o: {inFrame: number; outFrame: number; countStart: number; countEnd: number; from: number; to: number; decimals: number; prefix: string; suffix: string; cx: number; cy: number; w: number; h: number; fontPx: number; font: FontKey; weight: number; color: string; strokeColor: string | null; glowColor: string | null}): SceneElement {
  const samples: SceneKey[] = [];
  const pop = 6;
  for (let f = 0; f <= pop; f += 1) samples.push(key(o.inFrame + f, {scale: 0.6 + 0.4 * expoOut(f / pop), opacity: Math.min(1, f / 2), progress: 0}));
  const n = Math.max(1, o.countEnd - o.countStart);
  for (let f = 0; f <= n; f += 2) samples.push(key(o.countStart + f, {progress: expoOut(f / n)}));
  samples.push(key(o.countEnd, {progress: 1}));
  samples.push(key(o.countEnd + 3, {progress: 1, scale: 1.06}));
  samples.push(key(o.countEnd + 8, {progress: 1, scale: 1}));
  samples.push(key(Math.max(o.countEnd + 9, o.outFrame - 6), {progress: 1}));
  samples.push(key(o.outFrame, {progress: 1, opacity: 0, scale: 1.08}));
  return {kind: 'counter', id, inFrame: o.inFrame, outFrame: o.outFrame, keys: keys(samples.filter(k => k.frame <= o.outFrame)), from: o.from, to: o.to, decimals: o.decimals, prefix: o.prefix, suffix: o.suffix,
    cx: round2(o.cx), cy: round2(o.cy), w: round2(o.w), h: round2(o.h), fontPx: Math.round(o.fontPx), font: o.font, weight: o.weight, color: o.color, strokeColor: o.strokeColor, glowColor: o.glowColor, countStart: o.countStart, countEnd: o.countEnd};
}

/** deterministic PRNG (mulberry32) */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function hashString(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
