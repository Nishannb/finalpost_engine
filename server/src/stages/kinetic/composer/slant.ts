/**
 * One slant per frame. Every text event on screen at the same moment shares ONE perspective turn (the same yaw, pitch and direction), or none of it is slanted, and every slanted ROW turns
 * about its own centre so each row shows the same keystone.
 *
 * Why the second rule: a block turned in perspective about its centre gives each row a different apparent angle. Rows above the centre lean one way, rows below lean the other, the
 * middle row looks flat (the "THEY ARE OFFERING" / "EXCLUSIVE" frame). Splitting a slanted multi-row event into one event per row, each turned by the same yaw / pitch about its own
 * centre, keeps the slant uniform. The perspective is scaled with the row's height (clamped) so a smaller row's edges converge at the same angle as the tallest row's.
 *
 * Distinct beats never overlap in time (verify: composer-overlap), so "per frame" means per beat: the events of one beat (plain + backed `.b` + row parts) must agree.
 */
import {projectPoint, type Pt} from '../geometry.ts';
import type {RenderEvent, RenderLine} from '../schema.ts';

/** a part of a beat's treatment (backed words `.b`, extra slanted rows `.rN`): not a second treatment */
export const isPartId = (id: string): boolean => /\.(b|r\d+)$/.test(id);
export const beatOfId = (id: string): string => id.split('-')[0]!;

/** compositions whose type may SLANT in perspective. Those drawn on flat backing shapes (chip, highlighter, bars, card, counter) stay flat, and so do the plain words on screen with them */
export const ANGLE_OK: ReadonlySet<string> = new Set(['heroStack', 'giantWord', 'sideStack', 'wordSwap', 'topHeadline', 'contrastSplit', 'takeover', 'ctaCard', 'lineWipe']);

const FLAT_PERSPECTIVE = 1800;
const yawOf = (e: RenderEvent): number => e.keyframes[0]?.rotateY ?? 0;
const pitchOf = (e: RenderEvent): number => e.keyframes[0]?.rotateX ?? 0;
export const isSlanted = (e: RenderEvent): boolean => Math.abs(yawOf(e)) >= 0.5 || Math.abs(pitchOf(e)) >= 0.5;
const designedText = (e: RenderEvent): boolean => Boolean(e.composition) && e.composition !== 'matchCut' && e.presetResolved !== 'type.matchCut';

function flatten(e: RenderEvent): RenderEvent {
  return {...e, perspectivePx: FLAT_PERSPECTIVE, keyframes: e.keyframes.map(k => ({...k, rotateX: 0, rotateY: 0}))};
}

/** rows: lines grouped by vertical overlap (> 30% of the smaller line), top to bottom */
export function rowsOf(lines: readonly RenderLine[]): RenderLine[][] {
  const rows: RenderLine[][] = [];
  for (const l of [...lines].sort((a, b) => a.dy - b.dy)) {
    const row = rows.find(r => r.some(q => Math.min(q.dy + q.h, l.dy + l.h) - Math.max(q.dy, l.dy) > 0.3 * Math.min(q.h, l.h)));
    if (row) row.push(l); else rows.push([l]);
  }
  return rows;
}

/** one event per row, each turned about its own centre; the row centres keep their flat positions (scaled with the block's push) */
export function splitRows(e: RenderEvent): RenderEvent[] {
  if (!isSlanted(e) || e.rotateDeg) return [e];
  const rows = rowsOf(e.lines);
  if (rows.length < 2) return [e];
  const hMax = Math.max(...rows.map(r => Math.max(...r.map(l => l.h))));
  const parts = rows.map((row, k) => {
    const l = Math.min(...row.map(q => q.dx)), r = Math.max(...row.map(q => q.dx + q.w)), t = Math.min(...row.map(q => q.dy)), b = Math.max(...row.map(q => q.dy + q.h));
    const ox = (l + r) / 2 - e.block.w / 2, oy = (t + b) / 2 - e.block.h / 2;
    const h = Math.max(...row.map(q => q.h));
    const persp = Math.round(e.perspectivePx * Math.min(1, Math.max(0.7, h / hMax)));
    return {
      ...e, id: k === 0 ? e.id : `${e.id}.r${k}`, perspectivePx: persp, block: {w: round2(r - l), h: round2(b - t)},
      lines: row.map(q => ({...q, dx: round2(q.dx - l), dy: round2(q.dy - t)})),
      keyframes: e.keyframes.map(kf => ({...kf, x: round2(kf.x + ox * kf.scale), y: round2(kf.y + oy * kf.scale)})),
    };
  });
  return spaceRows(parts);
}

/**
 * The gap the rows must keep ON SCREEN, after the turn. A row turned in perspective grows on its near side (more for a taller / wider row), so rows spaced on the FLAT layout
 * can touch on that side (the "US A COMPLETELY / DIFFERENT" frame: 10 px flat, overlapping once turned). Proportional to the smaller row so small type keeps a tight read.
 */
export const rowGapPx = (hUpper: number, hLower: number): number => Math.max(8, 0.14 * Math.min(hUpper, hLower));

/** projected corners of an event's block at keyframe `i`: top-left, top-right, bottom-right, bottom-left */
function cornersAt(e: RenderEvent, i: number): Pt[] {
  const kf = e.keyframes[Math.min(i, e.keyframes.length - 1)]!;
  const w = e.block.w / 2, h = e.block.h / 2;
  return [{x: -w, y: -h}, {x: w, y: -h}, {x: w, y: h}, {x: -w, y: h}].map(p => projectPoint(p, kf, e.perspectivePx));
}

/** y of the segment a-b at x (clamped to the segment) */
function yOn(a: Pt, b: Pt, x: number): number {
  if (Math.abs(b.x - a.x) < 1e-6) return Math.max(a.y, b.y);
  const t = Math.min(1, Math.max(0, (x - a.x) / (b.x - a.x)));
  return a.y + t * (b.y - a.y);
}

/** smallest on-screen vertical gap between the upper row's bottom edge and the lower row's top edge, over the x range both rows cover, at every keyframe (negative = overlap) */
export function projectedRowGap(upper: RenderEvent, lower: RenderEvent): number {
  let min = Infinity;
  const n = Math.max(upper.keyframes.length, lower.keyframes.length);
  for (let i = 0; i < n; i += 1) {
    const u = cornersAt(upper, i), d = cornersAt(lower, i);
    const left = Math.max(Math.min(u[3]!.x, u[2]!.x), Math.min(d[0]!.x, d[1]!.x));
    const right = Math.min(Math.max(u[3]!.x, u[2]!.x), Math.max(d[0]!.x, d[1]!.x));
    if (right < left) continue; // no horizontal overlap: the rows cannot touch
    for (const x of [left, right, (left + right) / 2]) min = Math.min(min, yOn(d[0]!, d[1]!, x) - yOn(u[3]!, u[2]!, x));
  }
  return min;
}

/** push the rows of one turned block apart until every pair keeps rowGapPx on screen, then re-centre the block on its original centre */
export function spaceRows(rows: RenderEvent[]): RenderEvent[] {
  if (rows.length < 2) return rows;
  const out = rows.map(r => ({...r, keyframes: r.keyframes.map(k => ({...k}))}));
  let pushed = 0;
  for (let k = 1; k < out.length; k += 1) {
    for (let pass = 0; pass < 4; pass += 1) {
      const need = rowGapPx(out[k - 1]!.block.h, out[k]!.block.h) - projectedRowGap(out[k - 1]!, out[k]!);
      if (!(need > 0.5) || !Number.isFinite(need)) break;
      const dy = need * 1.05;
      for (let j = k; j < out.length; j += 1) for (const kf of out[j]!.keyframes) kf.y = round2(kf.y + dy);
      pushed += dy;
    }
  }
  if (pushed > 0) for (const r of out) for (const kf of r.keyframes) kf.y = round2(kf.y - pushed / 2);
  return out;
}

/** the per-frame rule: a beat whose events disagree on the turn goes flat, then every slanted multi-row event is split into rows */
export function unifySlant(events: readonly RenderEvent[]): RenderEvent[] {
  const byBeat = new Map<string, RenderEvent[]>();
  for (const e of events) if (designedText(e)) { const k = beatOfId(e.id); byBeat.set(k, [...(byBeat.get(k) ?? []), e]); }
  const mixed = new Set<string>();
  for (const [k, evs] of byBeat) {
    const y0 = yawOf(evs[0]!), p0 = pitchOf(evs[0]!);
    if (evs.some(e => Math.abs(yawOf(e) - y0) > 0.05 || Math.abs(pitchOf(e) - p0) > 0.05)) mixed.add(k);
  }
  return events.flatMap(e => {
    if (!designedText(e)) return [e];
    const one = mixed.has(beatOfId(e.id)) ? flatten(e) : e;
    return splitRows(one);
  });
}

/** verifier: the events on screen together share one turn, and no slanted event carries more than one row */
export function slantViolations(events: readonly RenderEvent[]): Array<{eventId: string; rule: string; detail: string}> {
  const out: Array<{eventId: string; rule: string; detail: string}> = [];
  const live = events.filter(designedText);
  for (const e of live) {
    if (isSlanted(e) && !e.rotateDeg && rowsOf(e.lines).length > 1) out.push({eventId: e.id, rule: 'slant-rows', detail: `${rowsOf(e.lines).length} rows turned about one centre (each row would lean differently)`});
  }
  // the rows of one turned block (`<id>`, `<id>.r1`, ...) keep their gap on screen
  const rowsByBase = new Map<string, RenderEvent[]>();
  for (const e of live) if (isSlanted(e) && !e.rotateDeg) { const base = e.id.replace(/\.r\d+$/, ''); rowsByBase.set(base, [...(rowsByBase.get(base) ?? []), e]); }
  for (const group of rowsByBase.values()) {
    if (group.length < 2) continue;
    const order = [...group].sort((a, b) => (a.keyframes[0]?.y ?? 0) - (b.keyframes[0]?.y ?? 0));
    for (let k = 1; k < order.length; k += 1) {
      const gap = projectedRowGap(order[k - 1]!, order[k]!);
      const want = rowGapPx(order[k - 1]!.block.h, order[k]!.block.h);
      if (gap < 0.75 * want) out.push({eventId: order[k]!.id, rule: 'slant-row-gap', detail: `${order[k - 1]!.id} and ${order[k]!.id} are ${Math.round(gap)} px apart once turned (want >= ${Math.round(want)})`});
    }
  }
  for (let i = 0; i < live.length; i += 1) for (let j = i + 1; j < live.length; j += 1) {
    const a = live[i]!, b = live[j]!;
    if (a.inFrame >= b.outFrame || b.inFrame >= a.outFrame) continue;
    if (Math.abs(yawOf(a) - yawOf(b)) > 0.05 || Math.abs(pitchOf(a) - pitchOf(b)) > 0.05) out.push({eventId: b.id, rule: 'slant-mixed', detail: `${a.id} (yaw ${yawOf(a)}) and ${b.id} (yaw ${yawOf(b)}) are on screen together with different slants`});
  }
  return out;
}

const round2 = (v: number): number => Math.round(v * 100) / 100;
