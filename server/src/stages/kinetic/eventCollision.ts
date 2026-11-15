/**
 * Post-integration fix: cross-event text collisions. The solver's density rule deliberately exempts events whose word ranges overlap, and coverage fill (coverageFill.ts) gives
 * every transcript word a lockup did not DRAW its own quiet `running` event. Together they let a fill word sit on top of the lockup that left it out (2.mp4: "and" drawn in the
 * middle of the stacked AFTER EFFECTS / PREMIERE PRO / DAVINCI RESOLVE list).
 *
 * Rule: a coverage-fill event (id `cov-*`) that is a single CONNECTOR word (and / or / the / of ...) is dropped when it lies inside another event's word range (that lockup
 * owns the phrase and presents it without the connector) AND, on a frame where both are visible, their projected boxes intersect. Director / lockup events are never moved or dropped here. The dropped word stays visible in the coverage report (coverage.ts), never silently hidden.
 *
 * Pure.
 */
import {intersect, interpolateKeyframes, projectBlockAabb} from './geometry.ts';
import type {RenderEvent} from './schema.ts';

export const isCoverageFill = (ev: Pick<RenderEvent, 'id'>): boolean => ev.id.startsWith('cov-');

/** Function words a lockup's phrase already carries (a list "A, B and C" drawn as three rows). Only these are ever absorbed; content words always stay drawn. */
export const CONNECTOR_WORDS: ReadonlySet<string> = new Set(['and', 'or', 'nor', 'but', 'the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'with', '&', 'plus', 'vs']);
const isConnectorFill = (ev: RenderEvent): boolean =>
  ev.lines.length === 1 && CONNECTOR_WORDS.has(ev.lines[0]!.text.toLowerCase().replace(/[^a-z&]/g, ''));

const VISIBLE = 0.02;

function boxAt(ev: RenderEvent, frame: number) {
  const kf = interpolateKeyframes(ev.keyframes, frame);
  return kf.opacity > VISIBLE ? projectBlockAabb(ev.block, kf, ev.perspectivePx) : null;
}

export type FillCollision = {eventId: string; against: string; frame: number};

/** The first frame (and the other event) where `fill` collides with a non-fill event, or null. */
export function firstCollision(fill: RenderEvent, others: readonly RenderEvent[]): FillCollision | null {
  for (const other of others) {
    if (other.id === fill.id || isCoverageFill(other)) continue;
    // Only a word the colliding lockup OWNS (inside its word range) and chose not to draw: that lockup already presents the phrase. A fill under an unrelated lockup keeps
    // the coverage contract (every spoken word drawn) exactly as before.
    if (!(fill.wordRange[0] >= other.wordRange[0] && fill.wordRange[1] <= other.wordRange[1])) continue;
    if (!isConnectorFill(fill)) continue; // content words are never absorbed: the coverage contract (every spoken word drawn) holds
    const f0 = Math.max(fill.inFrame, other.inFrame);
    const f1 = Math.min(fill.outFrame, other.outFrame);
    for (let f = f0; f <= f1; f += 1) {
      const a = boxAt(fill, f);
      if (!a) continue;
      const b = boxAt(other, f);
      if (b && intersect(a, b)) return {eventId: fill.id, against: other.id, frame: f};
    }
  }
  return null;
}

/** Splits `events` into the kept ones and the coverage fills that collide with a lockup. Order of the kept events is preserved. */
export function dropFillCollisions(events: readonly RenderEvent[]): {kept: RenderEvent[]; dropped: FillCollision[]} {
  const dropped: FillCollision[] = [];
  const kept: RenderEvent[] = [];
  for (const ev of events) {
    const hit = isCoverageFill(ev) ? firstCollision(ev, events) : null;
    if (hit) dropped.push(hit);
    else kept.push(ev);
  }
  return {kept, dropped};
}
