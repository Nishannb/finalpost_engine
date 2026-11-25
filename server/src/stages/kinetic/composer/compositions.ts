/**
 * P3 Composition library. Each composition is a deterministic solver: a beat + its time window + a variant (zone, alignment, motion, voice, plate) -> RenderSpec events (type.words
 * lines the existing compositor draws) + scene elements (shapes / counters / plates). A composition returns null when it cannot be laid out legibly in the free space; the
 * controller then tries the next candidate. Nothing here invents words: every line is a spoken token (punctuation trimmed).
 */
import {contrastStrokeColor, lumToHex, worstContrast} from '../guardrails.ts';
import {projectBlockAabb} from '../geometry.ts';
import {SubjectBandDepth} from '../depth.ts';
import {normToken} from '../transcript.ts';
import type {KineticWord, RenderEvent, SceneElement} from '../schema.ts';
import {isContent, STOP_WORDS} from './beats.ts';
import {backPad, bboxOf, buildEvent, counterEl, displayText, fitRows, inset, keyFloorPx, plateEl, rectH, rectW, shapeEl, smallFloorPx, unionRect, wordWidthEm, type EventInput, type Placed, type WordSpec, type Zones} from './kit.ts';
import {styleFor, type WordStyle} from './voice.ts';
import type {Align, Built, ComposeCtx, CompositionName, PxRect, Slot, Variant, Verb, ZoneKey} from './types.ts';

type Solver = (slot: Slot, ctx: ComposeCtx, zones: Zones) => Built | null;

// ------------------------------------------------------------------------------------------------ helpers

const idxRange = (a: number, b: number): number[] => { const o: number[] = []; for (let i = a; i <= b; i += 1) o.push(i); return o; };
/** the beat's words this solve may draw (slot.only = a reduced take) */
const allowed = (slot: Slot, ids: number[]): number[] => (slot.only ? ids.filter(i => slot.only!.includes(i)) : ids);
const beatIds = (slot: Slot): number[] => allowed(slot, idxRange(slot.beat.wordRange[0], slot.beat.wordRange[1]));
const LEAD = 2;
const enterAt = (ctx: ComposeCtx, slot: Slot, i: number) => Math.max(slot.inFrame, (ctx.words[i]?.startFrame ?? slot.inFrame) - LEAD);
const isStop = (t: string) => STOP_WORDS.has(normToken(t));

/** contrast is judged against the plate behind the block (the region's own luminance), not the frame mean; a thin face gets a stroke sooner */
function shadowFor(ctx: ComposeCtx, colors: string[], backed = false, placed?: Placed[]): RenderEvent['shadow'] {
  const v = ctx.voice;
  const lum = placed && placed.length ? Math.max(ctx.lumAt(bboxOf(placed)), ctx.scene.luminance * 0.5) : ctx.scene.luminance;
  const thin = placed?.some(p => p.style.weight <= 500 || p.style.font === 'playfair' || p.style.font === 'playfairItalic' || p.style.font === 'pacifico') ?? false;
  const needs = !backed && (worstContrast(colors, lumToHex(lum)) < 3 || worstContrast(colors, lumToHex(ctx.scene.luminance)) < 3 || (thin && worstContrast(colors, lumToHex(lum)) < 4.5));
  const stroke = v.outline ? {strokeColor: v.outline.color, strokePx: v.outline.px} : needs ? {strokeColor: contrastStrokeColor(lum), strokePx: thin ? 2 : 3} : {strokePx: 0};
  return {color: needs ? 'rgba(0,0,0,0.75)' : v.shadowColor, blurPx: needs ? 22 : 18, offsetY: 6, ...stroke, glowPx: 0};
}
const colorsOf = (ps: Placed[]): string[] => [...new Set(ps.flatMap(p => (p.style.gradient ? [...p.style.gradient] : [p.style.color])))];

function zoneRect(z: Zones, order: ZoneKey[]): {key: ZoneKey; rect: PxRect} | null {
  for (const k of order) { const r = z[k]; if (r) return {key: k, rect: r}; }
  return null;
}
/** the slot's preferred zone first, then the composition's fallbacks */
const zoneOrder = (slot: Slot, fallbacks: ZoneKey[]): ZoneKey[] => [...new Set([slot.variant.zone, ...fallbacks])].filter(k => k !== 'full' && (k === slot.variant.zone || fallbacks.includes(k)));

function spec(ctx: ComposeCtx, slot: Slot, i: number, role: WordSpec['role'], style: WordStyle, mult: number, verb: Verb, o: Partial<WordSpec> = {}): WordSpec {
  return {idx: i, text: displayText(ctx.words[i]!.text, slot.beat.type === 'question' && i === slot.beat.wordRange[1]), role, style, mult, verb, enterAbs: enterAt(ctx, slot, i), ...o};
}

/** words before / after the key inside the beat */
function around(slot: Slot, key: number, maxBefore: number, maxAfter: number): {before: number[]; after: number[]} {
  const [a, b] = slot.beat.wordRange;
  const ids = beatIds(slot);
  const before = ids.filter(i => i >= a && i < key).slice(-maxBefore);
  const after = ids.filter(i => i > key && i <= b).slice(0, maxAfter);
  return {before, after};
}
/** split indices into rows of at most `per` words (connectors stay with the following word) */
function chunk(ids: number[], per: number): number[][] {
  const rows: number[][] = [];
  let cur: number[] = [];
  for (const i of ids) { cur.push(i); if (cur.length >= per) { rows.push(cur); cur = []; } }
  if (cur.length) rows.push(cur);
  return rows;
}
const keyOf = (slot: Slot): number => slot.beat.keyIdx[0] ?? slot.beat.wordRange[0];

/** the video's look decides the accent of shapes (accent / accent2 / alternating per beat) and the corner radius */
const shapeColor = (ctx: ComposeCtx, slot: Slot): string => {
  const m = ctx.direction.look?.accentMode ?? 'accent';
  return m === 'accent2' ? ctx.voice.accent2 : m === 'alternate' && slot.beat.idx % 2 ? ctx.voice.accent2 : ctx.voice.accent;
};
/**
 * Text on a backing (chip / highlighter / callout bar / card): a CURATED pair, never a muddy mid-tone. The preset's accent is used when it is a clean light colour (dark ink on it reads
 * >= 8:1) or a deep one (white ink >= 8:1); a mid-tone accent (salmon, coral, mid blue) is refused. Otherwise the tone's pair:
 *   sun   #FFE14D / #141414 (hype)      paper #FFFFFF / #111111 (educational)   navy  #14213D / #FFFFFF (business)
 *   cream #FFF3D9 / #161616 (story, calm)   ink #121318 / #FFFFFF (the alternate of a light pair)   forest #0F4C3A / #FFFFFF (the alternate of a dark pair)
 */
export const BACKED_PAIRS = {
  sun: {bg: '#FFE14D', ink: '#141414'}, paper: {bg: '#FFFFFF', ink: '#111111'}, navy: {bg: '#14213D', ink: '#FFFFFF'},
  cream: {bg: '#FFF3D9', ink: '#161616'}, ink: {bg: '#121318', ink: '#FFFFFF'}, forest: {bg: '#0F4C3A', ink: '#FFFFFF'},
} as const;
export type BackedPair = {bg: string; ink: string};
const TONE_PAIR = {hype: 'sun', educational: 'paper', business: 'navy', story: 'cream', calm: 'cream'} as const;
const lin = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
export const relLum = (hex: string): number => { const m = /^#?([0-9a-f]{6})/i.exec(hex); if (!m) return 0.5; const n = parseInt(m[1]!, 16); return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
export const contrastRatio = (a: string, b: string): number => { const x = relLum(a), y = relLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
export function backedPair(ctx: ComposeCtx, slot: Slot): BackedPair {
  for (const c of [shapeColor(ctx, slot), ctx.voice.accent, ctx.voice.accent2]) {
    const L = relLum(c);
    if (L >= 0.45 && contrastRatio(c, '#141414') >= 8) return {bg: c.slice(0, 7).toUpperCase(), ink: '#141414'};
    if (L <= 0.06 && contrastRatio(c, '#FFFFFF') >= 8) return {bg: c.slice(0, 7).toUpperCase(), ink: '#FFFFFF'};
  }
  const base = BACKED_PAIRS[TONE_PAIR[ctx.direction.tone]];
  if ((ctx.direction.look?.accentMode ?? 'accent') === 'alternate' && slot.beat.idx % 2) return relLum(base.bg) > 0.3 ? BACKED_PAIRS.ink : BACKED_PAIRS.forest;
  return base;
}
/** a soft drop shadow under a backing shape is fine; the letters on it never get an outline */
const NO_STROKE: RenderEvent['shadow'] = {color: 'rgba(0,0,0,0)', blurPx: 0, offsetY: 0, strokePx: 0, glowPx: 0};

/**
 * Build a treatment's events with its backed words split out: the plain words keep their shadow / stroke, the words on a chip / highlighter / card get their own event with NO stroke,
 * no glow, no push (they stay locked to the static backing shape). Both turn about the same pivot. Returns the plain event (if any) and the backed event (if any).
 */
function splitBacked(e: EventInput, isBacked: (p: Placed) => boolean): RenderEvent[] {
  const backed = e.placed.filter(isBacked).map(p => ({...p, glow: null}));
  const plain = e.placed.filter(p => !isBacked(p));
  const out: RenderEvent[] = [];
  // one slant per frame: the backed words stay flat with their shape, so the plain words on screen with them are flat too (a slanted line next to a flat chip reads as misaligned)
  const flat = backed.length ? {tilt: 0, pitch: 0, perspectivePx: 1800, shift: {x: 0, y: 0}} : {};
  if (plain.length) out.push(buildEvent({...e, ...flat, placed: plain, context: e.placed, notes: (e.notes ?? []).filter(n => !n.startsWith('backed:'))}));
  if (backed.length) out.push(buildEvent({...e, id: `${e.id}.b`, placed: backed, context: e.placed, shadow: NO_STROKE, push: 1, drift: 0, tilt: 0, pitch: 0, perspectivePx: 1800, shift: {x: 0, y: 0}, notes: [...(e.notes ?? []).filter(n => !n.startsWith('backed:')), ...backed.map(p => `backed:${p.text}`)]}));
  return out;
}

/**
 * The treatment's SLANT: a perspective turn (rotateY yaw, a little rotateX pitch) so the type recedes into the frame or comes out of it, one side bigger than the other. No in-plane
 * rotation (that read as crooked text). The largest share of the variant's yaw for which the PROJECTED block (at its peak push) stays inside its free region wins. A treatment drawn on
 * flat backing shapes (chip, highlighter, bars, card, side rule) stays flat: the 2D shapes cannot follow a 3D turn.
 */
function turn(v: Variant, region: PxRect, placed: Placed[], shapes: SceneElement[], push = 1.03): {yaw: number; pitch: number; perspective: number; shapes: SceneElement[]; shift: {x: number; y: number}} {
  const flat = {yaw: 0, pitch: 0, perspective: 1800, shapes, shift: {x: 0, y: 0}};
  if (!v.tilt || shapes.some(el => el.kind === 'shape')) return flat;
  const bb = bboxOf(placed);
  const block = {w: bb.right - bb.left, h: bb.bottom - bb.top};
  const c = {x: (bb.left + bb.right) / 2, y: (bb.top + bb.bottom) / 2};
  for (const k of [1, 0.8, 0.6]) {
    const yaw = Math.round(v.tilt * k * 10) / 10, pitch = Math.round((v.pitch ?? 0) * k * 10) / 10;
    const r = projectBlockAabb(block, {x: c.x, y: c.y, scale: push + 0.02, rotateX: pitch, rotateY: yaw, z: 0}, SLANT_PERSPECTIVE);
    // the near side grows outward: slide the block just enough to bring the projection back inside its region (when it is narrower / shorter than the region)
    if (r.right - r.left > region.right - region.left - 2 || r.bottom - r.top > region.bottom - region.top - 2) continue;
    const dx = r.left < region.left ? region.left - r.left + 1 : r.right > region.right ? region.right - r.right - 1 : 0;
    const dy = r.top < region.top ? region.top - r.top + 1 : r.bottom > region.bottom ? region.bottom - r.bottom - 1 : 0;
    return {yaw, pitch, perspective: SLANT_PERSPECTIVE, shapes, shift: {x: Math.round(dx), y: Math.round(dy)}};
  }
  return flat;
}
/** a short perspective (px): the near side of a slanted word reads clearly bigger than the far side */
export const SLANT_PERSPECTIVE = 950;
/** an angled treatment is fitted a little narrower so the turn has room */
const roomFor = (v: Variant, r: PxRect, ctx: ComposeCtx): PxRect => (v.tilt ? inset(r, 0.1 * ctx.W, 0.045 * ctx.H) : r);

const radius = (ctx: ComposeCtx, dflt: number): number => (ctx.direction.look ? Math.min(dflt * 2, ctx.direction.look.radius) : dflt);

function result(events: RenderEvent[], scene: SceneElement[], drawn: number[], zone: ZoneKey, notes: string[] = []): Built {
  return {events, scene, drawn: [...new Set(drawn)].sort((a, b) => a - b), zone, notes};
}

function plateFor(slot: Slot, ctx: ComposeCtx, id: string, focus?: {x: number; y: number}): SceneElement[] {
  const p = slot.variant.plate;
  if (!p) return [];
  const amount = p === 'dim' ? 0.42 : p === 'spotlight' ? 0.55 : p === 'vignette' ? 0.6 : p === 'wash' ? 0.32 : 0.45;
  const color = p === 'wash' ? ctx.voice.accent : '#000000';
  return [plateEl(`${id}-plate`, p, slot.inFrame, slot.outFrame, amount, ctx.fps, {color, ...(focus ? {focus} : {})})];
}

/** fit with several size ratios between the key and its support words; the first that holds both floors wins */
function fitLadder(build: (smallMult: number, per: number) => WordSpec[][], rect: PxRect, ctx: ComposeCtx, align: Align, valign: 'top' | 'center' | 'bottom', maxBase: number, ratios = [0.42, 0.5, 0.6, 0.72], pers = [3, 2, 1]) {
  for (const narrow of [false, true]) {
    for (const per of pers) {
      for (const r of ratios) {
        let rows = build(r, per);
        // second pass: hero / punch words in the condensed face (long words at the readability floor)
        if (narrow) rows = rows.map(row => row.map(w => (w.role === 'hero' || w.role === 'punch') && w.style.font !== ctx.voice.condensed ? {...w, style: {...w.style, font: ctx.voice.condensed, weight: 400, italic: false, uppercase: true}} : w));
        const f = fitRows(rows, rect, {align, valign, maxBase, keyFloor: keyFloorPx(ctx.H), smallFloor: smallFloorPx(ctx.H)});
        if (f) return f;
      }
    }
  }
  return null;
}
/** try a fit with several words-per-row counts (wide phrases go to more, shorter rows) */
function perRows<T>(n: number, tryPer: (per: number) => T | null, first?: number): T | null {
  for (const per of [...new Set([first ?? 4, 3, 2, 1])].filter(p => p >= 1 && p <= Math.max(1, n))) { const r = tryPer(per); if (r) return r; }
  return null;
}

/** a long key word that does not fit in the display face is retried in the condensed face */
const condensed = (st: WordStyle, ctx: ComposeCtx): WordStyle => ({...st, font: ctx.voice.condensed, weight: 400, italic: false, uppercase: true});

// ------------------------------------------------------------------------------------------------ compositions

/** the kinetic stack: lead-in words small, the key word large, the tail small; aligned left / centre / right in a free region */
const heroStack: Solver = (slot, ctx, z) => {
  const key = keyOf(slot);
  if (slot.variant.behind && ctx.behindOk) { const b = giantBehind(slot, ctx, z, key); if (b) return b; }
  const {before, after} = around(slot, key, 4, 3);
  const zr = zoneRect(z, zoneOrder(slot, ['top', 'low', 'left', 'right', 'chest']));
  if (!zr) return null;
  const v = slot.variant;
  const rect = roomFor(v, zr.key === 'left' || zr.key === 'right' ? zr.rect : inset(zr.rect, 0.02 * ctx.W, 0.01 * ctx.H), ctx);
  const keyStyle = styleFor(ctx.voice, v.voice, 'key');
  const build = (ks: WordStyle) => (r: number, per: number) => {
    const small = (ids: number[]) => chunk(ids, per).map(row => row.map(i => spec(ctx, slot, i, isStop(ctx.words[i]!.text) ? 'connector' : 'support', styleFor(ctx.voice, v.voice, isStop(ctx.words[i]!.text) ? 'conn' : 'ctx'), r, v.subEnter)));
    return [...small(before), [spec(ctx, slot, key, 'hero', ks, 1, v.enter)], ...small(after)];
  };
  const f = fitLadder(build(keyStyle), rect, ctx, v.align, 'center', 0.17 * ctx.H) ?? fitLadder(build(condensed(keyStyle, ctx)), rect, ctx, v.align, 'center', 0.17 * ctx.H);
  if (!f) return null;
  const t = turn(v, zr.rect, f.placed, []);
  const ev = buildEvent({id: `${slot.beat.id}-stack`, composition: 'heroStack', placed: f.placed, words: ctx.words, inFrame: slot.inFrame, outFrame: slot.outFrame, fps: ctx.fps, exitVerb: v.exit, dir: v.dir, exitDir: v.exitDir, wordRange: slot.beat.wordRange, shadow: shadowFor(ctx, colorsOf(f.placed), false, f.placed), tilt: t.yaw, pitch: t.pitch, perspectivePx: t.perspective, shift: t.shift, push: 1.03, drift: v.dir * 6});
  return result([ev], plateFor(slot, ctx, slot.beat.id), [key, ...before, ...after], zr.key);
};

/**
 * Behind the speaker (only with a usable matte, `ctx.behindOk`): the key word alone, big, set across the top of the head so the speaker's head and shoulders pass IN FRONT of it. The
 * existing verifier judges it with the matte (hero occlusion <= 28%, first / last letters <= 22%); an objection sends the beat back to the front placement.
 */
function giantBehind(slot: Slot, ctx: ComposeCtx, z: Zones, key: number): Built | null {
  const v = slot.variant;
  const faceH = z.face.bottom - z.face.top;
  const region: PxRect = {left: ctx.safe.left, right: ctx.safe.right, top: Math.max(ctx.safe.top, z.face.top - 0.45 * faceH), bottom: Math.min(ctx.safe.bottom, z.face.top + 0.5 * faceH)};
  if (rectH(region) < keyFloorPx(ctx.H)) return null;
  const st = styleFor(ctx.voice, v.voice === 'editorial' ? 'loud' : v.voice, 'key');
  const verb: Verb = v.enter === 'slide' || v.enter === 'whip' || v.enter === 'drop' ? v.enter : 'rise';
  const f = fitLadder((_r: number, _per: number) => [[spec(ctx, slot, key, 'hero', st, 1, verb)]], inset(region, 0.02 * ctx.W, 0), ctx, 'center', 'center', 0.3 * ctx.H, [1], [1]);
  if (!f) return null;
  // slide the word DOWN onto the real head (the matte, not the padded face box): the lowest position where the person visibly covers the word (>= 8%) while it stays readable
  // (<= 26% covered, first / last letters <= 20%), measured over the beat's frames with the same depth model the verifier uses
  const keyP = f.placed[0]!;
  {
    const depth = new SubjectBandDepth();
    const frames: number[] = [];
    for (let fr = slot.inFrame; fr <= slot.outFrame; fr += Math.max(3, Math.round((slot.outFrame - slot.inFrame) / 8))) frames.push(fr);
    const occAt = (y: number) => {
      const box = (x0: number, w: number) => ({x: x0 / ctx.W, y: y / ctx.H, w: w / ctx.W, h: keyP.h / ctx.H});
      const edgeW = keyP.w * 0.22;
      let max = 0, sum = 0, edge = 0;
      for (const fr of frames) {
        const o = depth.occlusion(ctx.scene, box(keyP.x, keyP.w), fr);
        max = Math.max(max, o); sum += o;
        edge = Math.max(edge, depth.occlusion(ctx.scene, box(keyP.x, edgeW), fr), depth.occlusion(ctx.scene, box(keyP.x + keyP.w - edgeW, edgeW), fr));
      }
      return {max, mean: sum / frames.length, edge};
    };
    let best: {y: number; mean: number} | null = null;
    for (let y = Math.max(ctx.safe.top, region.top); y + keyP.h <= Math.min(ctx.safe.bottom, z.face.bottom); y += Math.max(6, keyP.h * 0.06)) {
      const o = occAt(y);
      if (o.max <= 0.26 && o.edge <= 0.2 && o.mean >= 0.08 && (!best || y > best.y)) best = {y, mean: o.mean};
    }
    if (!best) return null; // no position where it reads as behind: the front placement runs
    keyP.y = best.y;
  }
  // the lead-in words (up to 3) sit IN FRONT, in the open band above the key word (the "stack over the cutout" read): only when that band is clear of the face
  const {before} = around(slot, key, 3, 0);
  let lead: Placed[] = [];
  const band: PxRect = {left: ctx.safe.left, right: ctx.safe.right, top: ctx.safe.top, bottom: Math.min(keyP.y - 0.01 * ctx.H, z.face.top - 6)};
  if (before.length && rectH(band) >= smallFloorPx(ctx.H) * 1.15) {
    const lf = fitRows([before.map(i => spec(ctx, slot, i, isStop(ctx.words[i]!.text) ? 'connector' : 'support', styleFor(ctx.voice, 'clean', 'ctx'), 1, v.subEnter))], band, {align: 'center', valign: 'bottom', maxBase: Math.max(smallFloorPx(ctx.H), 0.4 * keyP.px), keyFloor: keyFloorPx(ctx.H), smallFloor: smallFloorPx(ctx.H)});
    if (lf) lead = lf.placed;
  }
  const ev = buildEvent({id: `${slot.beat.id}-behind`, composition: slot.composition, placed: [...lead, ...f.placed], words: ctx.words, inFrame: slot.inFrame, outFrame: slot.outFrame, fps: ctx.fps, exitVerb: v.exit, dir: v.dir, exitDir: v.exitDir, wordRange: slot.beat.wordRange, shadow: shadowFor(ctx, colorsOf([...lead, ...f.placed]), false, [...lead, ...f.placed]), push: 1.02, layering: 'behind', notes: ['behind']});
  // per-line layer: the key word behind the person, the lead-in in front of them
  const leadTexts = new Set(lead.map(p => p.text));
  ev.lines = ev.lines.map(l => ({...l, layer: leadTexts.has(l.text) && l.role !== 'hero' ? 'front' as const : 'behind' as const}));
  return result([ev], plateFor(slot, ctx, slot.beat.id), [key, ...lead.map(p => p.idx)], 'top', ['behind']);
}

/** one word fills the free width, with a small context line above it */
const giantWord: Solver = (slot, ctx, z) => {
  const key = keyOf(slot);
  if (slot.variant.behind && ctx.behindOk) { const b = giantBehind(slot, ctx, z, key); if (b) return b; }
  const {before, after} = around(slot, key, 3, 2);
  const zr = zoneRect(z, zoneOrder(slot, ['chest', 'below', 'low', 'top']));
  if (!zr) return null;
  const v = slot.variant;
  const rect = roomFor(v, inset(zr.rect, 0.01 * ctx.W, 0), ctx);
  const ks = styleFor(ctx.voice, v.voice === 'editorial' ? 'loud' : v.voice, 'key');
  const verb: Verb = v.enter === 'rise' || v.enter === 'blurIn' || v.enter === 'mask' ? 'slam' : v.enter;
  const build = (st: WordStyle) => (r: number, per: number) => [
    ...chunk(before, per).map(row => row.map(i => spec(ctx, slot, i, 'support', styleFor(ctx.voice, 'clean', 'ctx'), r, v.subEnter))),
    [spec(ctx, slot, key, 'hero', st, 1, verb, {glow: v.voice === 'gradient' || v.voice === 'loud' ? {color: ctx.voice.accent, radiusPx: 26, opacity: 0.45} : null})],
    ...chunk(after, per).map(row => row.map(i => spec(ctx, slot, i, 'support', styleFor(ctx.voice, 'clean', 'ctx'), r, v.subEnter))),
  ];
  const f = fitLadder(build(ks), rect, ctx, 'center', 'center', 0.26 * ctx.H, [0.26, 0.32, 0.4]) ?? fitLadder(build(condensed(ks, ctx)), rect, ctx, 'center', 'center', 0.26 * ctx.H, [0.26, 0.32, 0.4]);
  if (!f) return null;
  const keyP = f.placed.find(p => p.idx === key)!;
  if (keyP.px < 0.1 * ctx.H) return null; // not giant: leave it to another composition
  const t = turn(v, zr.rect, f.placed, [], 1.045);
  const ev = buildEvent({id: `${slot.beat.id}-giant`, composition: 'giantWord', placed: f.placed, words: ctx.words, inFrame: slot.inFrame, outFrame: slot.outFrame, fps: ctx.fps, exitVerb: v.exit, dir: v.dir, exitDir: v.exitDir, wordRange: slot.beat.wordRange, shadow: shadowFor(ctx, colorsOf(f.placed), false, f.placed), tilt: t.yaw, pitch: t.pitch, perspectivePx: t.perspective, shift: t.shift, push: 1.045});
  const cx = (keyP.x + keyP.w / 2) / ctx.W, cy = (keyP.y + keyP.h / 2) / ctx.H;
  return result([ev], plateFor(slot, ctx, slot.beat.id, {x: cx, y: cy}), [key, ...before, ...after], zr.key);
};

/** rapid word swap: each word replaces the previous one in the same spot, in sync with the voice */
const wordSwap: Solver = (slot, ctx, z) => {
  const b = slot.beat.wordRange[1];
  const ids = beatIds(slot);
  if (ids.length < 2 || ids.length > 7) return null;
  // units: a connector rides with the next word
  const units: number[][] = [];
  let pend: number[] = [];
  for (const i of ids) { pend.push(i); if (!isStop(ctx.words[i]!.text) || pend.length >= 2 || i === ids[ids.length - 1] || i === b) { units.push(pend); pend = []; } }
  if (pend.length) units.push(pend);
  if (units.length < 2) return null;
  const zr = zoneRect(z, zoneOrder(slot, ['chest', 'low', 'top']));
  if (!zr) return null;
  const v = slot.variant;
  const key = keyOf(slot);
  const rect = inset(zr.rect, 0.03 * ctx.W, 0.01 * ctx.H);
  const verbs: Verb[] = [v.enter === 'mask' ? 'pop' : v.enter, 'cut', v.subEnter === 'mask' || v.subEnter === 'track' ? 'slide' : v.subEnter, 'slam', 'cut'];
  // one shared base: the widest unit decides
  let base = 0.2 * ctx.H;
  const unitStyle = (u: number[], k: number) => u.map(i => i === key ? styleFor(ctx.voice, v.voice, 'key') : styleFor(ctx.voice, k % 2 ? 'clean' : v.voice, isStop(ctx.words[i]!.text) ? 'conn' : 'ctx'));
  for (const [k, u] of units.entries()) {
    const st = unitStyle(u, k);
    const wEm = u.reduce((s, i, j) => s + wordWidthEm({text: displayText(ctx.words[i]!.text), style: st[j]!}) * (i === key ? 1 : 0.62), 0) + 0.2 * (u.length - 1);
    base = Math.min(base, (rectW(rect) * 0.92) / wEm);
  }
  if (base < keyFloorPx(ctx.H) || base * 0.62 < smallFloorPx(ctx.H)) return null;
  const placed: Placed[] = [];
  units.forEach((u, k) => {
    const st = unitStyle(u, k);
    const nextStart = k + 1 < units.length ? enterAt(ctx, slot, units[k + 1]![0]!) : null;
    const row = u.map((i, j) => spec(ctx, slot, i, i === key ? 'hero' : 'support', st[j]!, i === key ? 1 : 0.62, verbs[k % verbs.length]!, {enterAbs: enterAt(ctx, slot, u[0]!), ...(nextStart !== null ? {exitAbs: nextStart, exitVerb: 'cut' as const} : {})}));
    const f = fitRows([row], rect, {align: 'center', valign: 'center', maxBase: base, keyFloor: keyFloorPx(ctx.H), smallFloor: smallFloorPx(ctx.H)});
    if (f) placed.push(...f.placed);
  });
  if (placed.length !== ids.length) return null;
  const t = turn(v, zr.rect, placed, [], 1.02);
  const ev = buildEvent({id: `${slot.beat.id}-swap`, composition: 'wordSwap', placed, words: ctx.words, inFrame: slot.inFrame, outFrame: slot.outFrame, fps: ctx.fps, exitVerb: v.exit, dir: v.dir, exitDir: v.exitDir, wordRange: slot.beat.wordRange, shadow: shadowFor(ctx, colorsOf(placed), false, placed), tilt: t.yaw, pitch: t.pitch, perspectivePx: t.perspective, shift: t.shift, push: 1.02});
  return result([ev], plateFor(slot, ctx, slot.beat.id), ids, zr.key);
};

/** the sentence wipes on word by word (mask reveal), the key word set larger in the editorial face. No underline. */
const lineWipe: Solver = (slot, ctx, z) => {
  const ids = beatIds(slot);
  if (ids.length > 9 || ids.length === 0) return null;
  const zr = zoneRect(z, zoneOrder(slot, ['low', 'top', 'below']));
  if (!zr) return null;
  const v = slot.variant;
  const key = keyOf(slot);
  const rect = roomFor(v, inset(zr.rect, 0.02 * ctx.W, 0.01 * ctx.H), ctx);
  const variant = v.voice === 'loud' ? 'editorial' : v.voice;
  const wipeVerb: Verb = v.subEnter === 'slide' || v.subEnter === 'track' || v.subEnter === 'mask' ? v.subEnter : 'mask';
  const perRow = ids.length <= 4 ? 4 : Math.ceil(ids.length / 2);
  const tryFitAt = (perRowN: number) => (keyMult: number, keyRole: 'hero' | 'support') => {
    const rows = chunk(ids, perRowN).map(row => row.map(i => spec(ctx, slot, i, i === key ? keyRole : isStop(ctx.words[i]!.text) ? 'connector' : 'support', i === key ? styleFor(ctx.voice, variant, 'key') : styleFor(ctx.voice, 'clean', 'run'), i === key ? keyMult : 1, i === key && v.enter !== 'cut' ? v.enter : wipeVerb)));
    return fitRows(rows, rect, {align: v.align, valign: zr.key === 'top' ? 'top' : 'bottom', maxBase: 0.07 * ctx.H, keyFloor: keyFloorPx(ctx.H), smallFloor: smallFloorPx(ctx.H)});
  };
  const f = perRows(ids.length, per => tryFitAt(per)(1.9, 'hero') ?? tryFitAt(per)(1.4, 'support'), perRow);
  if (!f) return null;
  // no underline (removed from the engine): the key word reads by size and face alone
  const t = turn(v, zr.rect, f.placed, [], 1.015);
  const ev = buildEvent({id: `${slot.beat.id}-wipe`, composition: 'lineWipe', placed: f.placed, words: ctx.words, inFrame: slot.inFrame, outFrame: slot.outFrame, fps: ctx.fps, exitVerb: v.exit, dir: v.dir, exitDir: v.exitDir, wordRange: slot.beat.wordRange, shadow: shadowFor(ctx, colorsOf(f.placed), false, f.placed), tilt: t.yaw, pitch: t.pitch, perspectivePx: t.perspective, shift: t.shift, push: 1.0});
  return result([ev], [...plateFor(slot, ctx, slot.beat.id), ...t.shapes], ids, zr.key);
};

/** a vertical stack, one word per row, pinned to one side (a gutter when the speaker leaves one, else the side of the lower frame); words whip in from that side */
const sideStack: Solver = (slot, ctx, z) => {
  const content = beatIds(slot);
  const b = content[content.length - 1] ?? slot.beat.wordRange[1];
  if (content.length < 2 || content.length > 8) return null;
  const v = slot.variant;
  const side: 'left' | 'right' = v.dir < 0 ? 'left' : 'right';
  let zr = zoneRect(z, [side, side === 'left' ? 'right' : 'left']);
  let rect: PxRect;
  if (zr) rect = zr.rect;
  else {
    const below = zoneRect(z, ['below']);
    if (!below) return null;
    const half = (below.rect.right - below.rect.left) * 0.62;
    rect = side === 'left' ? {...below.rect, right: below.rect.left + half} : {...below.rect, left: below.rect.right - half};
    zr = {key: 'below', rect};
  }
  const key = keyOf(slot);
  // rows: connectors join the next content word
  const rows: number[][] = [];
  let pend: number[] = [];
  for (const i of content) { pend.push(i); if (!isStop(ctx.words[i]!.text) || i === b) { rows.push(pend); pend = []; } }
  if (pend.length) rows.push(pend);
  if (rows.length > 5) return null;
  const align: Align = zr.key === 'left' || (zr.key === 'below' && side === 'left') ? 'left' : 'right';
  const sideVerb: Verb = v.subEnter === 'slide' ? 'slide' : 'whip';
  const build = (r: number, _per: number) => rows.map(row => row.map(i => spec(ctx, slot, i, i === key ? 'hero' : isStop(ctx.words[i]!.text) ? 'connector' : 'support', i === key ? styleFor(ctx.voice, v.voice, 'key') : styleFor(ctx.voice, v.voice === 'editorial' ? 'clean' : v.voice, isStop(ctx.words[i]!.text) ? 'conn' : 'ctx'), i === key ? 1 : r, i === key && (v.enter === 'slam' || v.enter === 'pop' || v.enter === 'drop') ? v.enter : sideVerb)));
  const f = fitLadder(build, roomFor(v, inset(rect, 0.01 * ctx.W, 0.01 * ctx.H), ctx), ctx, align, 'center', 0.16 * ctx.H, [0.55, 0.65, 0.8]);
  if (!f) return null;
  const bb = bboxOf(f.placed);
  const bar0 = shapeEl(`${slot.beat.id}-rule`, 'bar', {x: side === 'left' ? bb.left - 22 : bb.right + 12, y: bb.top, w: 10, h: bb.bottom - bb.top}, {inFrame: slot.inFrame, outFrame: slot.outFrame, startAbs: slot.inFrame, drawFrames: 8, color: shapeColor(ctx, slot), layer: 'under', radiusPx: 5, origin: 'center'});
  const t0 = turn(v, rect, f.placed, [], 1.02);
  const t = t0.yaw ? t0 : {...t0, shapes: [bar0]};
  const inDir: -1 | 1 = side === 'left' ? -1 : 1;
  const ev = buildEvent({id: `${slot.beat.id}-side`, composition: 'sideStack', placed: f.placed, words: ctx.words, inFrame: slot.inFrame, outFrame: slot.outFrame, fps: ctx.fps, exitVerb: v.exit, dir: inDir, exitDir: v.exitDir, wordRange: slot.beat.wordRange, shadow: shadowFor(ctx, colorsOf(f.placed), false, f.placed), tilt: t.yaw || (side === 'left' ? 10 : -10), pitch: t.pitch, perspectivePx: t.yaw ? t.perspective : 1800, shift: t.shift, push: 1.02});
  return result([ev], t.shapes, content, zr.key);
};

/** a headline above the head (only when the framing leaves room) */
const topHeadline: Solver = (slot, ctx, z) => {
  const top = z.top;
  if (!top) return null;
  const ids = beatIds(slot);
  if (ids.length > 6 || ids.length === 0) return null;
  const v = slot.variant;
  const key = keyOf(slot);
  const rect = inset(top, 0.02 * ctx.W, 0.005 * ctx.H);
  const build = (r: number, per: number) => chunk(ids, per).map(row => row.map(i => spec(ctx, slot, i, i === key ? 'hero' : 'support', i === key ? styleFor(ctx.voice, 'loud', 'key') : styleFor(ctx.voice, 'loud', 'ctx'), i === key ? 1 : r, i === key ? (v.enter === 'cut' ? 'drop' : v.enter) : v.subEnter)));
  const f = fitLadder(build, roomFor(v, rect, ctx), ctx, v.align, 'center', 0.12 * ctx.H, [0.5, 0.62, 0.75]);
  if (!f) return null;
  const t = turn(v, top, f.placed, [], 1.02);
  const ev = buildEvent({id: `${slot.beat.id}-top`, composition: 'topHeadline', placed: f.placed, words: ctx.words, inFrame: slot.inFrame, outFrame: slot.outFrame, fps: ctx.fps, exitVerb: v.exit === 'cut' ? 'lift' : v.exit, dir: v.dir, exitDir: v.exitDir, wordRange: slot.beat.wordRange, shadow: shadowFor(ctx, colorsOf(f.placed), false, f.placed), tilt: t.yaw, pitch: t.pitch, perspectivePx: t.perspective, shift: t.shift, push: 1.02});
  return result([ev], [], ids, 'top');
};

/** A vs B: the old word sits muted, then dims away as the new word lands big in the accent (no strike line: it read as clutter) */
const contrastSplit: Solver = (slot, ctx, z) => {
  const c = slot.beat.contrast;
  if (!c) return null;
  const zr = zoneRect(z, zoneOrder(slot, ['top', 'below', 'low']));
  if (!zr) return null;
  const v = slot.variant;
  const rect = roomFor(v, inset(zr.rect, 0.015 * ctx.W, 0.01 * ctx.H), ctx);
  const [a, b] = slot.beat.wordRange;
  const aIn = c.a >= a && c.a <= b;
  const bEnter = enterAt(ctx, slot, c.b);
  const aEnter = aIn ? enterAt(ctx, slot, c.a) : slot.inFrame;
  const lead = allowed(slot, idxRange(Math.max(a, c.b - 3), c.b - 1)).filter(i => i !== c.a);
  const muted = {...styleFor(ctx.voice, 'clean', 'ctx'), uppercase: ctx.voice.upper ?? true};
  const hot = styleFor(ctx.voice, v.voice === 'editorial' ? 'editorial' : 'loud', 'key');
  // the old word leaves (to the exit side) a few frames after the new one lands; it never shares the frame long enough to need a cross-out
  const aExit = Math.min(slot.outFrame - 6, bEnter + Math.round(0.35 * ctx.fps));
  const aSpec = (mult: number) => spec(ctx, slot, c.a, 'support', muted, mult, v.subEnter, {enterAbs: aEnter, textOpacity: 0.62, ...(aExit > aEnter + 8 ? {exitAbs: aExit, exitVerb: v.exit === 'cut' ? 'fade' as const : v.exit} : {})});
  const bSpec = spec(ctx, slot, c.b, 'hero', hot, 1, v.enter === 'rise' ? 'slam' : v.enter, {enterAbs: bEnter});
  const rows = (r: number, _per: number) => [[aSpec(r)], ...(lead.length ? [lead.map(i => spec(ctx, slot, i, 'connector', styleFor(ctx.voice, 'clean', 'conn'), Math.min(r, 0.45), v.subEnter))] : []), [bSpec]];
  const f = fitLadder(rows, rect, ctx, v.align, 'center', 0.17 * ctx.H, [0.55, 0.65, 0.8]);
  if (!f) return null;
  const t = turn(v, zr.rect, f.placed, [], 1.025);
  const ev = buildEvent({id: `${slot.beat.id}-vs`, composition: 'contrastSplit', placed: f.placed, words: ctx.words, inFrame: slot.inFrame, outFrame: slot.outFrame, fps: ctx.fps, exitVerb: v.exit, dir: v.dir, exitDir: v.exitDir, wordRange: slot.beat.wordRange, shadow: shadowFor(ctx, colorsOf(f.placed), false, f.placed), tilt: t.yaw, pitch: t.pitch, perspectivePx: t.perspective, shift: t.shift, push: 1.025});
  return result([ev], plateFor(slot, ctx, slot.beat.id), [...(aIn ? [c.a] : []), c.b, ...lead], zr.key);
};

/** the spoken number counts up, big, with its context underneath */
const counterStat: Solver = (slot, ctx, z) => {
  const st = slot.beat.stat;
  if (!st) return null;
  const zr = zoneRect(z, zoneOrder(slot, ['chest', 'below', 'top', 'low']));
  if (!zr) return null;
  const v = slot.variant;
  const rect = inset(zr.rect, 0.02 * ctx.W, 0.005 * ctx.H);
  const [a, b] = slot.beat.wordRange;
  const allCtx = allowed(slot, idxRange(a, b)).filter(i => !st.wordIdx.includes(i));
  const font = ctx.voice.display;
  const weight = ctx.voice.displayWeight;
  const finalText = `${st.prefix}${st.to.toLocaleString('en-US', {maximumFractionDigits: st.decimals, minimumFractionDigits: st.decimals})}${st.suffix}`;
  const em = wordWidthEm({text: finalText, style: {font, weight, italic: false, uppercase: true, color: '#fff', gradient: null}}) * 1.08;
  const rh = rectH(rect), rw = rectW(rect);
  const smallPx = smallFloorPx(ctx.H);
  // ladder: every context word, then the content words (<= 3, then <= 2), then none. A context line that does not fit moves to the next take (never kills the counter).
  const content = allCtx.filter(i => isContent(ctx.words[i]!.text));
  const takes = [allCtx.length <= 6 ? allCtx : [], content.slice(0, 3), content.slice(0, 2), []];
  let shown: number[] = [];
  let fontPx = 0;
  let cy0 = 0;
  let ctxPlaced: Placed[] = [];
  let cW = 0, cH = 0, cx = 0;
  for (const take of takes) {
    const rowsN = take.length ? chunk(take, 3).length : 0;
    const ctxH = rowsN * smallPx * 1.2 + (rowsN ? 0.04 * rh : 0);
    const fp = Math.floor(Math.min(0.2 * ctx.H, (rw * 0.9) / em, (rh * 0.96 - ctxH) / 1.02));
    if (fp < keyFloorPx(ctx.H) * 1.05) continue;
    const h = fp * 1.0, w = em * fp;
    const y0 = rect.top + (rh - (h + ctxH)) / 2;
    const x = v.align === 'left' ? rect.left + w / 2 : v.align === 'right' ? rect.right - w / 2 : (rect.left + rect.right) / 2;
    let placed: Placed[] = [];
    if (take.length) {
      const ctxRect: PxRect = {left: rect.left, right: rect.right, top: y0 + h + 0.03 * rh, bottom: Math.min(rect.bottom, y0 + h + ctxH + 0.02 * rh)};
      const f = perRows(take.length, per => fitRows(chunk(take, per).map(row => row.map(i => spec(ctx, slot, i, isStop(ctx.words[i]!.text) ? 'connector' : 'support', styleFor(ctx.voice, 'clean', 'ctx'), 1, v.subEnter))), ctxRect, {align: v.align, valign: 'top', maxBase: Math.max(smallPx, fp * 0.34), keyFloor: keyFloorPx(ctx.H), smallFloor: smallPx}), 3);
      if (!f) continue;
      placed = f.placed;
    }
    shown = take; fontPx = fp; cy0 = y0; ctxPlaced = placed; cW = w; cH = h; cx = x;
    break;
  }
  if (!fontPx) return null;
  const countStart = Math.max(slot.inFrame, enterAt(ctx, slot, st.wordIdx[0]!));
  const countEnd = Math.min(slot.outFrame - 10, Math.max(countStart + Math.round(0.7 * ctx.fps), (ctx.words[st.wordIdx[st.wordIdx.length - 1]!]?.endFrame ?? countStart) + 6));
  const bg = lumToHex(ctx.scene.luminance);
  const counter = counterEl(`${slot.beat.id}-count`, {inFrame: countStart, outFrame: slot.outFrame, countStart, countEnd, from: st.from, to: st.to, decimals: st.decimals, prefix: st.prefix, suffix: st.suffix, cx, cy: cy0 + cH / 2, w: cW, h: cH, fontPx, font, weight, color: ctx.voice.accent,
    strokeColor: ctx.voice.outline?.color ?? (worstContrast([ctx.voice.accent], bg) < 3 ? contrastStrokeColor(ctx.scene.luminance) : null), glowColor: v.voice === 'gradient' || v.voice === 'loud' ? ctx.voice.accent : null});
  const events = ctxPlaced.length ? [buildEvent({id: `${slot.beat.id}-stat`, composition: 'counterStat', placed: ctxPlaced, words: ctx.words, inFrame: slot.inFrame, outFrame: slot.outFrame, fps: ctx.fps, exitVerb: v.exit, dir: v.dir, exitDir: v.exitDir, wordRange: slot.beat.wordRange, shadow: shadowFor(ctx, colorsOf(ctxPlaced), false, ctxPlaced), push: 1.015})] : [];
  return result(events, [...plateFor(slot, ctx, slot.beat.id, {x: cx / ctx.W, y: (cy0 + cH / 2) / ctx.H}), counter], [...st.wordIdx, ...shown], zr.key, [`counter:${finalText}`]);
};

/** a list item: the spoken marker in a chip, the item's words as a headline next to / under it. All items of a list share the same layout. */
const listItem: Solver = (slot, ctx, z) => {
  const lm = slot.beat.listMarker;
  if (!lm) return null;
  const zr = zoneRect(z, zoneOrder(slot, ['top', 'low', 'below']));
  if (!zr) return null;
  const v = slot.variant;
  const [a, b] = slot.beat.wordRange;
  const item = allowed(slot, idxRange(a, b)).filter(i => !lm.wordIdx.includes(i) && i > lm.wordIdx[lm.wordIdx.length - 1]!);
  const leadIn = allowed(slot, idxRange(a, lm.wordIdx[0]! - 1));
  const items = item.length > 5 ? item.filter(i => isContent(ctx.words[i]!.text)).slice(0, 4) : item;
  if (items.length === 0) return null;
  const key = items.includes(keyOf(slot)) ? keyOf(slot) : items.filter(i => isContent(ctx.words[i]!.text))[0] ?? items[0]!;
  const pair = backedPair(ctx, slot);
  const chipStyle: WordStyle = {...styleFor(ctx.voice, 'loud', 'ctx'), color: pair.ink, uppercase: true, gradient: null};
  const align: Align = v.align === 'center' ? (v.dir < 0 ? 'left' : 'right') : v.align;
  const build = (r: number, per: number) => [
    [...leadIn, ...lm.wordIdx].map(i => spec(ctx, slot, i, 'support', lm.wordIdx.includes(i) ? chipStyle : styleFor(ctx.voice, 'clean', 'conn'), Math.max(r * 0.8, 0.5), 'pop')),
    ...chunk(items, per).map(row => row.map(i => spec(ctx, slot, i, i === key ? 'hero' : isStop(ctx.words[i]!.text) ? 'connector' : 'support', i === key ? styleFor(ctx.voice, v.voice, 'key') : styleFor(ctx.voice, v.voice === 'editorial' ? 'clean' : v.voice, 'ctx'), i === key ? 1 : r, i === key ? v.enter : v.subEnter))),
  ];
  // the chip's padding lives in the row gap and in the region's margin (an angled list gets a narrower fit first, then the straight fit)
  // chip px = 0.5..0.58 x base, its vertical padding 0.34 x chip px ~= 0.17..0.2 x base: a 0.24 em row gap holds it
  const fitIn = (rect: PxRect) => {
    for (const narrow of [false, true]) for (const per of [3, 2, 1]) for (const r of [0.5, 0.6, 0.72]) {
      let rows = build(r, per);
      if (narrow) rows = rows.map(row => row.map(w => (w.role === 'hero' ? {...w, style: condensed(w.style, ctx)} : w)));
      const x = fitRows(rows, rect, {align, valign: zr.key === 'top' ? 'top' : 'center', maxBase: 0.15 * ctx.H, rowGapEm: 0.24, keyFloor: keyFloorPx(ctx.H), smallFloor: smallFloorPx(ctx.H)});
      if (x) return x;
    }
    return null;
  };
  const base = inset(zr.rect, 0.03 * ctx.W, 0.016 * ctx.H);
  const f = fitIn(roomFor(v, base, ctx)) ?? (v.tilt ? fitIn(base) : null);
  if (!f) return null;
  const chipWords = f.placed.filter(p => lm.wordIdx.includes(p.idx));
  const cb = bboxOf(chipWords);
  const pad = backPad(Math.max(...chipWords.map(p => p.px)));
  const chip0 = shapeEl(`${slot.beat.id}-chip`, 'box', {x: cb.left - pad.x, y: cb.top - pad.y, w: cb.right - cb.left + 2 * pad.x, h: cb.bottom - cb.top + 2 * pad.y}, {inFrame: slot.inFrame, outFrame: slot.outFrame, startAbs: slot.inFrame, drawFrames: 6, color: pair.bg, radiusPx: radius(ctx, 14), layer: 'under'});
  // the item words may slant (perspective); the chip stays flat with its box (backed events never turn)
  const itemPlaced = f.placed.filter(p => !lm.wordIdx.includes(p.idx));
  const t = {...turn(v, zr.rect, itemPlaced, [], 1.02), shapes: [chip0]};
  const events = splitBacked({id: `${slot.beat.id}-list`, composition: 'listItem', placed: f.placed, words: ctx.words, inFrame: slot.inFrame, outFrame: slot.outFrame, fps: ctx.fps, exitVerb: v.exit, dir: v.dir, exitDir: v.exitDir, wordRange: slot.beat.wordRange, shadow: shadowFor(ctx, colorsOf(f.placed.filter(p => !lm.wordIdx.includes(p.idx))), false, f.placed.filter(p => !lm.wordIdx.includes(p.idx))), tilt: t.yaw, pitch: t.pitch, perspectivePx: t.perspective, shift: t.shift, push: 1.0}, p => lm.wordIdx.includes(p.idx));
  // the chip draws on with its marker words (their real entry as built), never as an empty box before the marker is spoken
  const chipEv = events.find(e => e.id.endsWith('.b'));
  const chipEnter = chipEv && chipEv.lines.length ? chipEv.inFrame + Math.min(...chipEv.lines.map(l => l.enterFrame)) : slot.inFrame;
  const chip = shapeEl(`${slot.beat.id}-chip`, 'box', {x: cb.left - pad.x, y: cb.top - pad.y, w: cb.right - cb.left + 2 * pad.x, h: cb.bottom - cb.top + 2 * pad.y}, {inFrame: slot.inFrame, outFrame: slot.outFrame, startAbs: Math.max(slot.inFrame, chipEnter - 2), drawFrames: 6, color: pair.bg, radiusPx: radius(ctx, 14), layer: 'under'});
  return result(events, [chip], [...leadIn, ...lm.wordIdx, ...items], zr.key);
};

/** a question set in a card (the card draws on, the words rise in with the voice) */
const questionCard: Solver = (slot, ctx, z) => {
  const ids = beatIds(slot);
  if (ids.length > 9 || ids.length === 0) return null;
  const zr = zoneRect(z, zoneOrder(slot, ['top', 'low', 'below']));
  if (!zr) return null;
  const v = slot.variant;
  const rect = roomFor(v, inset(zr.rect, 0.07 * ctx.W, 0.035 * ctx.H), ctx);
  const key = keyOf(slot);
  const CARD = '#101218';
  const keyColor = contrastRatio(ctx.voice.accent, CARD) >= 4.5 ? ctx.voice.accent : '#FFFFFF';
  const perRow = ids.length <= 3 ? 3 : Math.ceil(ids.length / 2);
  const tryFit = (per: number, keyMult: number, keyRole: 'hero' | 'support') => fitRows(chunk(ids, per).map(row => row.map(i => spec(ctx, slot, i, i === key ? keyRole : isStop(ctx.words[i]!.text) ? 'connector' : 'support', i === key ? {...styleFor(ctx.voice, v.voice === 'loud' ? 'clean' : v.voice, 'key'), color: keyColor, gradient: null} : {...styleFor(ctx.voice, 'clean', 'run'), color: '#FFFFFF'}, i === key ? keyMult : 1, i === key ? v.enter : v.subEnter))), rect, {align: 'center', valign: 'center', maxBase: 0.06 * ctx.H, keyFloor: keyFloorPx(ctx.H), smallFloor: smallFloorPx(ctx.H)});
  const f = perRows(ids.length, per => tryFit(per, 1.7, 'hero') ?? tryFit(per, 1.25, 'support'), perRow);
  if (!f) return null;
  const bb = bboxOf(f.placed);
  const pad = backPad(Math.max(...f.placed.map(p => p.px)));
  const card0 = shapeEl(`${slot.beat.id}-card`, 'box', {x: bb.left - pad.x, y: bb.top - pad.y, w: bb.right - bb.left + 2 * pad.x, h: bb.bottom - bb.top + 2 * pad.y}, {inFrame: slot.inFrame, outFrame: slot.outFrame, startAbs: slot.inFrame, drawFrames: 7, color: CARD, radiusPx: radius(ctx, 28), layer: 'under', opacity: 0.88});
  const tick0 = shapeEl(`${slot.beat.id}-tick`, 'bar', {x: bb.left - pad.x, y: bb.top - pad.y, w: 14, h: bb.bottom - bb.top + 2 * pad.y}, {inFrame: slot.inFrame, outFrame: slot.outFrame, startAbs: slot.inFrame + 4, drawFrames: 6, color: ctx.voice.accent, radiusPx: 7, layer: 'under', origin: 'center'});
  const t = turn(v, zr.rect, f.placed, [card0, tick0], 1.0);
  const ev = buildEvent({id: `${slot.beat.id}-q`, composition: 'questionCard', placed: f.placed, words: ctx.words, inFrame: slot.inFrame, outFrame: slot.outFrame, fps: ctx.fps, exitVerb: v.exit === 'cut' ? 'fade' : v.exit, dir: v.dir, exitDir: v.exitDir, wordRange: slot.beat.wordRange, shadow: NO_STROKE, tilt: t.yaw, pitch: t.pitch, perspectivePx: t.perspective, shift: t.shift, push: 1.0, notes: f.placed.map(p => `backed:${p.text}`)});
  return result([ev], [...t.shapes, ...plateFor(slot, ctx, slot.beat.id)], ids, zr.key);
};

/** a lower-third callout: backing bar(s) grow from the side, the words mask in on them */
const calloutBar: Solver = (slot, ctx, z) => {
  const ids = beatIds(slot);
  if (ids.length > 8 || ids.length === 0) return null;
  const zr = zoneRect(z, zoneOrder(slot, ['low', 'top', 'below']));
  if (!zr) return null;
  const v = slot.variant;
  const align: Align = v.align === 'center' ? (v.dir < 0 ? 'left' : 'right') : v.align;
  const rect = roomFor(v, inset(zr.rect, 0.06 * ctx.W, 0.035 * ctx.H), ctx);
  const key = keyOf(slot);
  const pair = backedPair(ctx, slot);
  const perRow = ids.length <= 4 ? 4 : Math.ceil(ids.length / 2);
  const tryFit = (per: number, keyMult: number, keyRole: 'hero' | 'support') => fitRows(chunk(ids, per).map(row => row.map(i => spec(ctx, slot, i, i === key ? keyRole : isStop(ctx.words[i]!.text) ? 'connector' : 'support', {...styleFor(ctx.voice, i === key ? 'loud' : 'clean', i === key ? 'key' : 'ctx'), color: pair.ink, gradient: null}, i === key ? keyMult : 1, v.subEnter === 'slide' ? 'slide' : 'mask'))), rect, {align, valign: 'center', maxBase: 0.055 * ctx.H, rowGapEm: 0.8, keyFloor: keyFloorPx(ctx.H), smallFloor: smallFloorPx(ctx.H)});
  // uniform: every word on the bars is set at ONE size (the key word stands out by its heavier face, not by a bigger box)
  const f = perRows(ids.length, per => tryFit(per, 1, 'support'), perRow);
  if (!f) return null;
  // exactly one bar per visual row (words grouped by vertical overlap, so a row never splits into boxes of different sizes); every bar has the same height and padding
  const rowsOf: Placed[][] = [];
  for (const p of [...f.placed].sort((a, b) => a.y - b.y)) {
    const row = rowsOf.find(r => r.some(q => Math.min(q.y + q.h, p.y + p.h) - Math.max(q.y, p.y) > 0.3 * Math.min(q.h, p.h)));
    if (row) row.push(p); else rowsOf.push([p]);
  }
  const pad = backPad(Math.max(...f.placed.map(p => p.px)));
  const barH = Math.max(...rowsOf.map(ps => { const bb = bboxOf(ps); return bb.bottom - bb.top; })) + 2 * pad.y;
  const shapes0: SceneElement[] = rowsOf.map((ps, k) => {
    const bb = bboxOf(ps);
    const cy = (bb.top + bb.bottom) / 2;
    return shapeEl(`${slot.beat.id}-bar${k}`, 'bar', {x: bb.left - pad.x, y: cy - barH / 2, w: bb.right - bb.left + 2 * pad.x, h: barH}, {inFrame: slot.inFrame, outFrame: slot.outFrame, startAbs: Math.max(slot.inFrame, Math.min(...ps.map(p => p.enterAbs)) - 4), drawFrames: 7, color: pair.bg, layer: 'under', origin: align === 'right' ? 'right' : 'left', radiusPx: radius(ctx, 6)});
  });
  const t = turn(v, zr.rect, f.placed, shapes0, 1.0);
  const ev = buildEvent({id: `${slot.beat.id}-callout`, composition: 'calloutBar', placed: f.placed, words: ctx.words, inFrame: slot.inFrame, outFrame: slot.outFrame, fps: ctx.fps, exitVerb: v.exit === 'cut' ? 'fade' : v.exit, dir: align === 'right' ? 1 : -1, exitDir: v.exitDir, wordRange: slot.beat.wordRange, shadow: NO_STROKE, tilt: t.yaw, pitch: t.pitch, perspectivePx: t.perspective, shift: t.shift, push: 1.0, notes: f.placed.map(p => `backed:${p.text}`)});
  return result([ev], t.shapes, ids, zr.key);
};

/** the phrase in white, a highlighter swipes behind the key word as it is spoken (the key word sits on it in the pair's ink, no outline) */
const markerHighlight: Solver = (slot, ctx, z) => {
  const ids = beatIds(slot);
  if (ids.length > 9 || ids.length === 0) return null;
  const zr = zoneRect(z, zoneOrder(slot, ['top', 'low', 'below']));
  if (!zr) return null;
  const v = slot.variant;
  const rect = roomFor(v, inset(zr.rect, 0.05 * ctx.W, 0.03 * ctx.H), ctx);
  const key = keyOf(slot);
  const pair = backedPair(ctx, slot);
  const perRow = ids.length <= 3 ? 3 : Math.ceil(ids.length / 2);
  // wide word gaps and row gaps: the highlighter's padding lives in them and never covers a neighbouring word
  const tryFit = (per: number, keyMult: number, keyRole: 'hero' | 'support') => fitRows(chunk(ids, per).map(row => row.map(i => spec(ctx, slot, i, i === key ? keyRole : isStop(ctx.words[i]!.text) ? 'connector' : 'support', i === key ? {...styleFor(ctx.voice, 'loud', 'key'), color: pair.ink, gradient: null} : styleFor(ctx.voice, 'clean', 'ctx'), i === key ? keyMult : 1, i === key ? (v.enter === 'cut' ? 'pop' : v.enter) : v.subEnter))), rect, {align: v.align, valign: 'center', maxBase: 0.065 * ctx.H, rowGapEm: 0.75, wordGapEm: 0.55, keyFloor: keyFloorPx(ctx.H), smallFloor: smallFloorPx(ctx.H)});
  const f = perRows(ids.length, per => tryFit(per, 1.85, 'hero') ?? tryFit(per, 1.3, 'support'), perRow);
  if (!f) return null;
  const kp = f.placed.find(p => p.idx === key)!;
  const pad = backPad(kp.px, true);
  const hl0 = shapeEl(`${slot.beat.id}-hl`, 'bar', {x: kp.x - pad.x, y: kp.y - pad.y, w: kp.w + 2 * pad.x, h: kp.h + 2 * pad.y}, {inFrame: slot.inFrame, outFrame: slot.outFrame, startAbs: Math.max(slot.inFrame, kp.enterAbs - 3), drawFrames: 8, color: pair.bg, layer: 'under', radiusPx: radius(ctx, 8)});
  const t = turn(v, zr.rect, f.placed, [hl0], 1.0);
  const plain = f.placed.filter(p => p.idx !== key);
  const events = splitBacked({id: `${slot.beat.id}-mark`, composition: 'markerHighlight', placed: f.placed, words: ctx.words, inFrame: slot.inFrame, outFrame: slot.outFrame, fps: ctx.fps, exitVerb: v.exit, dir: v.dir, exitDir: v.exitDir, wordRange: slot.beat.wordRange, shadow: shadowFor(ctx, colorsOf(plain.length ? plain : f.placed), false, plain.length ? plain : f.placed), tilt: t.yaw, pitch: t.pitch, perspectivePx: t.perspective, shift: t.shift, push: 1.0}, p => p.idx === key);
  // the highlighter swipes in WITH its word (its real entry as built, which the overlap rules may have moved): never an empty box waiting for the word
  const keyLine = events.find(e => e.id.endsWith('.b'))?.lines[0];
  const keyEnter = keyLine ? events.find(e => e.id.endsWith('.b'))!.inFrame + keyLine.enterFrame : kp.enterAbs;
  const hl = shapeEl(`${slot.beat.id}-hl`, 'bar', {x: kp.x - pad.x, y: kp.y - pad.y, w: kp.w + 2 * pad.x, h: kp.h + 2 * pad.y}, {inFrame: slot.inFrame, outFrame: slot.outFrame, startAbs: Math.max(slot.inFrame, keyEnter), drawFrames: 8, color: pair.bg, layer: 'under', radiusPx: radius(ctx, 8)});
  return result(events, [...t.shapes.map(el => (el.id === hl.id ? hl : el)), ...plateFor(slot, ctx, slot.beat.id)], ids, zr.key);
};

/** the call to action: the plate softens, the key word lands big over a softened plate (no underline) */
const ctaCard: Solver = (slot, ctx, z) => {
  const key = keyOf(slot);
  const {before, after} = around(slot, key, 4, 3);
  const zr = zoneRect(z, zoneOrder(slot, ['chest', 'below', 'low']));
  if (!zr) return null;
  const v = slot.variant;
  const rect = inset(zr.rect, 0.03 * ctx.W, 0.01 * ctx.H);
  const ks = styleFor(ctx.voice, v.voice === 'editorial' ? 'gradient' : v.voice, 'key');
  const build = (st: WordStyle) => (r: number, per: number) => [
    ...chunk(before, per).map(row => row.map(i => spec(ctx, slot, i, isStop(ctx.words[i]!.text) ? 'connector' : 'support', styleFor(ctx.voice, 'clean', 'ctx'), r, v.subEnter))),
    [spec(ctx, slot, key, 'hero', st, 1, v.enter === 'cut' || v.enter === 'mask' ? 'pop' : v.enter)],
    ...chunk(after, per).map(row => row.map(i => spec(ctx, slot, i, isStop(ctx.words[i]!.text) ? 'connector' : 'support', styleFor(ctx.voice, 'clean', 'ctx'), r, v.subEnter))),
  ];
  const fr = roomFor(v, rect, ctx);
  const f = fitLadder(build(ks), fr, ctx, 'center', 'center', 0.15 * ctx.H) ?? fitLadder(build(condensed(ks, ctx)), fr, ctx, 'center', 'center', 0.15 * ctx.H);
  if (!f) return null;
  // no underline (removed from the engine)
  const t = turn(v, zr.rect, f.placed, [], 1.0);
  const ev = buildEvent({id: `${slot.beat.id}-cta`, composition: 'ctaCard', placed: f.placed, words: ctx.words, inFrame: slot.inFrame, outFrame: slot.outFrame, fps: ctx.fps, exitVerb: v.exit === 'cut' ? 'scaleOut' : v.exit, dir: v.dir, exitDir: v.exitDir, wordRange: slot.beat.wordRange, shadow: shadowFor(ctx, colorsOf(f.placed), false, f.placed), tilt: t.yaw, pitch: t.pitch, perspectivePx: t.perspective, shift: t.shift, push: 1.0});
  const blur = plateEl(`${slot.beat.id}-blur`, 'blur', slot.inFrame, slot.outFrame, 0.55, ctx.fps);
  const dim = plateEl(`${slot.beat.id}-dim`, 'dim', slot.inFrame, slot.outFrame, 0.35, ctx.fps);
  return result([ev], [blur, dim, ...t.shapes], [key, ...before, ...after], zr.key);
};

/** full-frame type card for the hook / the peak: a backdrop takes the frame for a moment and the words stack big over it */
const takeover: Solver = (slot, ctx, z) => {
  const ids = beatIds(slot);
  if (ids.length > 7 || ids.length < 2) return null;
  const dur = slot.outFrame - slot.inFrame;
  if (dur > Math.round(2.6 * ctx.fps) || dur < Math.round(0.8 * ctx.fps)) return null;
  const v = slot.variant;
  const rect = inset(z.full!, 0.02 * ctx.W, 0.08 * ctx.H);
  const key = keyOf(slot);
  const accentCard = v.voice === 'gradient' || v.voice === 'loud';
  const pair = backedPair(ctx, slot);
  const back = accentCard ? pair.bg : '#0D0E12';
  const keyColor = accentCard ? pair.ink : contrastRatio(ctx.voice.accent, back) >= 4.5 ? ctx.voice.accent : '#FFFFFF';
  const restColor = accentCard ? pair.ink : '#FFFFFF';
  const rows: number[][] = [];
  let cur: number[] = [];
  for (const i of ids) {
    if (i === key) { if (cur.length) rows.push(cur); rows.push([i]); cur = []; continue; }
    cur.push(i);
    if (cur.length >= 3) { rows.push(cur); cur = []; }
  }
  if (cur.length) rows.push(cur);
  const build = (r: number, _per: number) => rows.map(row => row.map(i => spec(ctx, slot, i, i === key ? 'hero' : 'support', {...styleFor(ctx.voice, i === key ? 'loud' : 'clean', i === key ? 'key' : 'ctx'), color: i === key ? keyColor : restColor, gradient: null, uppercase: ctx.voice.upper ?? true}, i === key ? 1 : r, i === key ? (v.enter === 'cut' || v.enter === 'mask' ? 'slam' : v.enter) : (v.subEnter === 'slide' ? 'slide' : 'cut'))));
  const f = fitLadder(build, rect, ctx, 'center', 'center', 0.24 * ctx.H, [0.4, 0.5, 0.62]);
  if (!f) return null;
  const t = turn(v, rect, f.placed, [], 1.05);
  const ev = buildEvent({id: `${slot.beat.id}-take`, composition: 'takeover', placed: f.placed, words: ctx.words, inFrame: slot.inFrame, outFrame: slot.outFrame, fps: ctx.fps, exitVerb: 'cut', dir: v.dir, exitDir: v.exitDir, wordRange: slot.beat.wordRange, shadow: NO_STROKE, tilt: t.yaw, pitch: t.pitch, perspectivePx: t.perspective, shift: t.shift, push: 1.05, notes: ['takeover', ...f.placed.map(p => `backed:${p.text}`)]});
  // the card owns the frame until the last frame the words are on screen (the words cut out with it)
  const card = plateEl(`${slot.beat.id}-card`, 'backdrop', slot.inFrame, slot.outFrame, 0.96, ctx.fps, {color: back, fadeIn: 1 / ctx.fps, fadeOut: 1 / ctx.fps});
  return result([ev], [card], ids, 'full');
};

export const SOLVERS: Record<Exclude<CompositionName, 'captionLane' | 'matchCut'>, Solver> = {
  giantWord, wordSwap, lineWipe, sideStack, topHeadline, contrastSplit, counterStat, listItem, questionCard, calloutBar, markerHighlight, ctaCard, takeover, heroStack,
};

export type {Solver};
export {idxRange};
