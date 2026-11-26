/**
 * P7 Caption lane: the quiet beats between designed moments. Not the old single-word flash on the chest: the words of the beat are grouped into short phrase lines (<= 4 words),
 * set in the preset's own face in ONE stable lane below the hands (the lower free region, else above the head), each line shown whole on its cue (readable), the beat's key word in the
 * accent. One line on screen at a time; the lane never overlaps a designed beat (the controller owns the timeline).
 */
import type {RenderEvent} from '../schema.ts';
import {lumToHex, worstContrast, contrastStrokeColor} from '../guardrails.ts';
import {buildEvent, displayText, fitRows, inset, smallFloorPx, wordWidthEm, type Placed, type WordSpec, type Zones} from './kit.ts';
import {styleFor} from './voice.ts';
import type {Beat, Built, ComposeCtx, PxRect} from './types.ts';

const LANE_EM = 0.044; // ~84 px at 1920
/** 2026-11-26 readability: what is on screen at once (a unit: one or two rows, <= LANE_MAX_WORDS) stays at least LANE_UNIT_SEC before the next unit replaces it ... */
export const LANE_UNIT_SEC = 1.0;
/** ... and a closing unit shorter than LANE_HOLD_SEC joins the unit before it when they fit. */
export const LANE_HOLD_SEC = 0.5;
const LANE_MAX_WORDS = 6;
const LANE_MAX_ROWS = 2;

/** Greedy rows of `ids` at the lane size (word gap 0.26 em). */
function packRows(ids: readonly number[], ctx: ComposeCtx, width: number, px: number): number[][] {
  const st = styleFor(ctx.voice, 'clean', 'run');
  const rows: number[][] = [];
  let cur: number[] = [];
  let w = 0;
  for (const i of ids) {
    const ww = wordWidthEm({text: displayText(ctx.words[i]!.text), style: st}) * px + 0.26 * px;
    if (cur.length && w + ww > width) { rows.push(cur); cur = []; w = 0; }
    cur.push(i); w += ww;
  }
  if (cur.length) rows.push(cur);
  return rows;
}

/** The beat's words as on-screen units (each a list of rows): a unit keeps taking words until it has been up LANE_UNIT_SEC or it is full; a short closing unit joins the previous one. */
function laneUnits(ids: readonly number[], ctx: ComposeCtx, width: number, px: number, outFrame: number, smallPx: number): number[][][] {
  const minFr = Math.round(LANE_UNIT_SEC * ctx.fps);
  const hold = Math.round(LANE_HOLD_SEC * ctx.fps);
  const fits = (g: readonly number[]) => g.length <= LANE_MAX_WORDS && packRows(g, ctx, width, px).length <= LANE_MAX_ROWS;
  const units: number[][] = [];
  let cur: number[] = [];
  for (const i of ids) {
    if (cur.length && (ctx.words[i]!.startFrame - ctx.words[cur[0]!]!.startFrame >= minFr || !fits([...cur, i]))) { units.push(cur); cur = []; }
    cur.push(i);
  }
  if (cur.length) units.push(cur);
  const last = units[units.length - 1];
  const prev = units[units.length - 2];
  const rows = units.map(u => packRows(u, ctx, width, px));
  if (last && prev && outFrame - ctx.words[last[0]!]!.startFrame < hold && prev.length + last.length <= LANE_MAX_WORDS + 2) {
    // a closing unit too short to read joins the previous one; if the pair needs more than two rows at the lane size it is set at the small floor (still readable)
    const merged = [...prev, ...last];
    rows.splice(rows.length - 2, 2, fits(merged) ? packRows(merged, ctx, width, px) : packRows(merged, ctx, width, smallPx));
  }
  return rows;
}

export function laneRect(z: Zones, ctx: ComposeCtx): PxRect | null {
  const low = z.low ?? z.below;
  if (low) {
    const h = Math.min(low.bottom - low.top, 0.11 * ctx.H);
    return inset({...low, top: low.bottom - h}, 0.03 * ctx.W, 0);
  }
  if (z.top) return inset({...z.top, bottom: Math.min(z.top.bottom, z.top.top + 0.11 * ctx.H)}, 0.03 * ctx.W, 0);
  return null;
}




export function captionLane(beat: Beat, inFrame: number, outFrame: number, ctx: ComposeCtx, z: Zones): Built | null {
  const rect = laneRect(z, ctx);
  if (!rect) return null;
  const ids: number[] = [];
  for (let i = beat.wordRange[0]; i <= beat.wordRange[1]; i += 1) ids.push(i);
  const px = Math.max(smallFloorPx(ctx.H), Math.round(LANE_EM * ctx.H));
  const width = (rect.right - rect.left) * 0.95;
  const units = laneUnits(ids, ctx, width, px, outFrame, smallFloorPx(ctx.H));
  // each unit comes in whole on its first word's cue (a delay would only take the time from the next unit: merging is what buys reading time)
  const unitEnter = units.map(u => Math.max(inFrame, ctx.words[u[0]![0]!]!.startFrame - 2));
  const key = beat.keyIdx[0];
  const placed: Placed[] = [];
  units.forEach((u, k) => {
    const nextEnter = k + 1 < units.length ? unitEnter[k + 1]! : null;
    const rows: WordSpec[][] = u.map(g => g.map(i => {
      const st = styleFor(ctx.voice, 'clean', 'run');
      return {idx: i, text: displayText(ctx.words[i]!.text, beat.type === 'question' && i === beat.wordRange[1]), role: 'running' as const, style: i === key ? {...st, color: ctx.voice.accent} : st, mult: 1, verb: 'pop' as const,
        // 2026-11-26 readability: the whole unit appears on its cue (a word-by-word reveal left the last word on screen for one word's length).
        // It is cut one frame BEFORE the next unit enters: on the same frame both would be on screen (the verifier's word-collision).
        enterAbs: unitEnter[k]!, ...(nextEnter !== null ? {exitAbs: Math.max(unitEnter[k]! + 1, nextEnter - 1), exitVerb: 'cut' as const} : {})};
    }));
    const f = fitRows(rows, rect, {align: 'center', valign: 'center', maxBase: px, keyFloor: rows.length > LANE_MAX_ROWS ? smallFloorPx(ctx.H) : px, smallFloor: smallFloorPx(ctx.H)})
      ?? (rows.length > 1 ? fitRows([rows.flat()], rect, {align: 'center', valign: 'center', maxBase: px, keyFloor: px, smallFloor: smallFloorPx(ctx.H)}) : null);
    if (f) placed.push(...f.placed);
  });
  if (placed.length === 0) return null;
  const lum = Math.max(ctx.lumAt(rect), ctx.scene.luminance * 0.5);
  const colors = [...new Set(placed.map(p => p.style.color))];
  const low = worstContrast(colors, lumToHex(lum)) < 3 || worstContrast(colors, lumToHex(ctx.scene.luminance)) < 3;
  const stroke = ctx.voice.outline ? {strokeColor: ctx.voice.outline.color, strokePx: ctx.voice.outline.px} : low ? {strokeColor: contrastStrokeColor(lum), strokePx: 3} : {strokePx: 0};
  const ev: RenderEvent = buildEvent({id: `${beat.id}-lane`, composition: 'captionLane', placed, words: ctx.words, inFrame, outFrame, fps: ctx.fps, exitVerb: 'fade', dir: 1, wordRange: beat.wordRange, shadow: {color: ctx.voice.shadowColor, blurPx: 14, offsetY: 4, ...stroke, glowPx: 0}, push: 1.0});
  return {events: [ev], scene: [], drawn: placed.map(p => p.idx), zone: 'low', notes: []};
}
