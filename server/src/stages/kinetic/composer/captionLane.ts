/**
 * P7 Caption lane: the quiet beats between designed moments. Not the old single-word flash on the chest: the words of the beat are grouped into short phrase lines (<= 4 words),
 * set in the preset's own face in ONE stable lane below the hands (the lower free region, else above the head), revealed word by word with the voice, the beat's key word in the
 * accent. One line on screen at a time; the lane never overlaps a designed beat (the controller owns the timeline).
 */
import type {RenderEvent} from '../schema.ts';
import {lumToHex, worstContrast, contrastStrokeColor} from '../guardrails.ts';
import {buildEvent, displayText, fitRows, inset, smallFloorPx, wordWidthEm, type Placed, type WordSpec, type Zones} from './kit.ts';
import {styleFor} from './voice.ts';
import type {Beat, Built, ComposeCtx, PxRect} from './types.ts';

const LANE_EM = 0.044; // ~84 px at 1920

export function laneRect(z: Zones, ctx: ComposeCtx): PxRect | null {
  const low = z.low ?? z.below;
  if (low) {
    const h = Math.min(low.bottom - low.top, 0.11 * ctx.H);
    return inset({...low, top: low.bottom - h}, 0.03 * ctx.W, 0);
  }
  if (z.top) return inset({...z.top, bottom: Math.min(z.top.bottom, z.top.top + 0.11 * ctx.H)}, 0.03 * ctx.W, 0);
  return null;
}

/** group the beat's words into lines that fit the lane at the lane size */
function lines(ids: number[], ctx: ComposeCtx, width: number, px: number): number[][] {
  const out: number[][] = [];
  let cur: number[] = [];
  let w = 0;
  const st = styleFor(ctx.voice, 'clean', 'run');
  for (const i of ids) {
    const ww = wordWidthEm({text: displayText(ctx.words[i]!.text), style: st}) * px + 0.26 * px;
    if (cur.length && (w + ww > width || cur.length >= 4)) { out.push(cur); cur = []; w = 0; }
    cur.push(i); w += ww;
  }
  if (cur.length) out.push(cur);
  return out;
}

export function captionLane(beat: Beat, inFrame: number, outFrame: number, ctx: ComposeCtx, z: Zones): Built | null {
  const rect = laneRect(z, ctx);
  if (!rect) return null;
  const ids: number[] = [];
  for (let i = beat.wordRange[0]; i <= beat.wordRange[1]; i += 1) ids.push(i);
  const px = Math.max(smallFloorPx(ctx.H), Math.round(LANE_EM * ctx.H));
  const groups = lines(ids, ctx, (rect.right - rect.left) * 0.95, px);
  const key = beat.keyIdx[0];
  const placed: Placed[] = [];
  groups.forEach((g, k) => {
    const nextEnter = k + 1 < groups.length ? Math.max(inFrame, ctx.words[groups[k + 1]![0]!]!.startFrame - 2) : null;
    const row: WordSpec[] = g.map(i => {
      const st = styleFor(ctx.voice, 'clean', 'run');
      return {idx: i, text: displayText(ctx.words[i]!.text, beat.type === 'question' && i === beat.wordRange[1]), role: 'running', style: i === key && beat.type !== 'plain' ? {...st, color: ctx.voice.accent} : i === key ? {...st, color: ctx.voice.accent} : st, mult: 1, verb: 'pop',
        // the line is cut one frame BEFORE the next line enters: on the same frame both would be on screen (the verifier's word-collision)
        enterAbs: Math.max(inFrame, ctx.words[i]!.startFrame - 2), ...(nextEnter !== null ? {exitAbs: Math.max(Math.max(inFrame, ctx.words[i]!.startFrame - 2) + 1, nextEnter - 1), exitVerb: 'cut' as const} : {})};
    });
    const f = fitRows([row], rect, {align: 'center', valign: 'center', maxBase: px, keyFloor: px, smallFloor: smallFloorPx(ctx.H)});
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
