/**
 * The ONE SFX scheduling contract (Production Validation Sprint 2). Pure. Used by the compiler (compile.ts, margins 0: its behaviour is unchanged)
 * and BEFORE payment by the event-SFX planner (production/eventSfx.ts) on the planned placements, with margins that cover the only differences the
 * compiler can still introduce:
 *   - a transient lands at most 1 frame later than planned (frame rounding of the measured transient offset; the compiler keeps the planned
 *     transient frame through the cue's `plannedTransientFrame`): spacingMarginSec = 1 / fps;
 *   - a sound may start earlier than planned by its measured transient offset (<= its length): layering windows are widened by windowMarginSec.
 * So a sound the planner keeps is never dropped by the compiler's budget, layering or density rules; a sound the compiler would drop is never paid for.
 *
 * Rules (lib/polishSfx.ts, audioPlan/sfxSafety.ts): at most SFX_MAX_HITS; transients at least SFX_MIN_SPACING_SEC apart; at most SFX_MAX_LAYERS
 * sounding at once; at most SFX_DENSITY.max starts within SFX_DENSITY.windowSec. Priority (1 = essential), then time, then id decide.
 */
import {SFX_MAX_HITS, SFX_MIN_SPACING_SEC} from '../../../lib/polishSfx.ts';
import {SFX_DENSITY, SFX_MAX_LAYERS} from './sfxSafety.ts';

/** `transientSpreadSec` (planner only): how much later than `transientSec` the compiled transient may land (a start-aligned sustained sound's
 *  measured peak can be anywhere inside it); widens the spacing check. Compiler items have none. */
export type ScheduleItem = {id: string; priority: number; transientSec: number; startSec: number; durationSec: number; transientSpreadSec?: number};
export type ScheduleDrop = {id: string; reason: 'sfx_cap' | 'sfx_spacing' | 'sfx_layer_overlap' | 'sfx_density'; detail: string};

const byPriority = <T extends {priority: number; id: string}>(time: (item: T) => number) => (a: T, b: T) => a.priority - b.priority || time(a) - time(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Voice-first budget: cap and transient spacing. */
export function scheduleBudget<T extends ScheduleItem>(items: readonly T[], options: {spacingMarginSec?: number; displayId?: (item: T) => string} = {}): {kept: T[]; dropped: ScheduleDrop[]} {
  const margin = options.spacingMarginSec ?? 0;
  const show = options.displayId ?? ((item: T) => item.id);
  const kept: T[] = [];
  const dropped: ScheduleDrop[] = [];
  for (const item of [...items].sort(byPriority<T>(item => item.transientSec))) {
    if (kept.length >= SFX_MAX_HITS) {
      dropped.push({id: item.id, reason: 'sfx_cap', detail: `more than ${SFX_MAX_HITS} cues`});
      continue;
    }
    const near = kept.find(other => Math.abs(other.transientSec - item.transientSec) < SFX_MIN_SPACING_SEC + margin + (other.transientSpreadSec ?? 0) + (item.transientSpreadSec ?? 0) - 1e-9);
    if (near) {
      dropped.push({id: item.id, reason: 'sfx_spacing', detail: `within ${SFX_MIN_SPACING_SEC}s of ${show(near)}`});
      continue;
    }
    kept.push(item);
  }
  return {kept, dropped};
}

/** At most SFX_MAX_LAYERS at once and SFX_DENSITY.max starts per window. `windowMarginSec(item)` widens an item's interval on both sides. */
export function scheduleLayering<T extends ScheduleItem>(items: readonly T[], options: {windowMarginSec?: (item: T) => number} = {}): {kept: T[]; dropped: ScheduleDrop[]} {
  const margin = options.windowMarginSec ?? (() => 0);
  const kept: T[] = [];
  const dropped: ScheduleDrop[] = [];
  for (const item of [...items].sort(byPriority<T>(item => item.startSec))) {
    const m = margin(item);
    const start = item.startSec - m;
    const end = item.startSec + item.durationSec + m;
    const overlapping = kept.filter(other => start < other.startSec + other.durationSec + margin(other) - 1e-9 && end > other.startSec - margin(other) + 1e-9);
    if (overlapping.length >= SFX_MAX_LAYERS) {
      dropped.push({id: item.id, reason: 'sfx_layer_overlap', detail: `would sound together with ${overlapping.map(other => other.id).join(', ')} (max ${SFX_MAX_LAYERS} at once)`});
      continue;
    }
    const near = kept.filter(other => Math.abs(other.startSec - item.startSec) < SFX_DENSITY.windowSec + m + margin(other) - 1e-9);
    if (near.length >= SFX_DENSITY.max) {
      dropped.push({id: item.id, reason: 'sfx_density', detail: `${near.length} other sounds within ${SFX_DENSITY.windowSec}s (max ${SFX_DENSITY.max})`});
      continue;
    }
    kept.push(item);
  }
  return {kept, dropped};
}
