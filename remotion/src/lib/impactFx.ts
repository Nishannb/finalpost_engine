/**
 * WP35: IMPACT FX (Metromedia grammar `effects`). Pure frame math, no React / Remotion, shared by the renderer, the server planner's tests and the offline proof.
 *
 *   flash_overexpose     1-2 frames on a hook word / major reveal: the picture blows out to white, the cut underneath is hidden
 *   saturation_glow_pop  2-4 frames on a name reveal: saturation + brightness spike with a soft warm bloom, then settles
 *   punch_in             scale 1.00 -> 1.10 over 6-8 frames on a money shot, held for the money window (the next cut resets it)
 *   bw_grade             a hard black-and-white flip on emotional / past-tense shots (~15 % of the runtime)
 *
 * Every event is {startSec, frames}; frames are counted at the COMPOSITION fps from `round(startSec * fps)` (the same rounding the cut plan uses), so an event lands exactly on its cut frame.
 */

export const FLASH_FRAMES = {min: 1, max: 2} as const;
export const SAT_POP_FRAMES = {min: 2, max: 4} as const;
export const PUNCH_RAMP_FRAMES = {min: 6, max: 8} as const;
export const PUNCH_SCALE = 1.1;
/** The share of the runtime the black-and-white grade may cover (grammar: ~15 %). */
export const BW_SHARE_TARGET = 0.15;
export const BW_CONTRAST = 1.18;

export type FlashEvent = {startSec: number; frames: number; reason: 'hook_word' | 'major_reveal'};
export type SatPopEvent = {startSec: number; frames: number};
export type PunchInEvent = {startSec: number; endSec: number; rampFrames: number; scale: number};
export type BwSpan = {startSec: number; endSec: number};
export type ImpactFx = {flashes: FlashEvent[]; satPops: SatPopEvent[]; punchIns: PunchInEvent[]; bwSpans: BwSpan[]};

export const EMPTY_IMPACT_FX: ImpactFx = {flashes: [], satPops: [], punchIns: [], bwSpans: []};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round3 = (value: number) => Math.round(value * 1000) / 1000;
export const impactFrameOf = (sec: number, fps: number) => Math.round(sec * fps);
export const clampFlashFrames = (frames: number) => clamp(Math.round(frames), FLASH_FRAMES.min, FLASH_FRAMES.max);
export const clampSatPopFrames = (frames: number) => clamp(Math.round(frames), SAT_POP_FRAMES.min, SAT_POP_FRAMES.max);
export const clampPunchRampFrames = (frames: number) => clamp(Math.round(frames), PUNCH_RAMP_FRAMES.min, PUNCH_RAMP_FRAMES.max);

/** Attack-and-decay of an n-frame pop: frame 0 is full strength, then it falls away linearly: n=1 [1], n=2 [1, .5], n=3 [1, .67, .33], n=4 [1, .75, .5, .25]; 0 outside the window. */
export function popAmount(frameInEvent: number, frames: number): number {
  if (frames < 1 || frameInEvent < 0 || frameInEvent >= frames) return 0;
  return round3(1 - frameInEvent / frames);
}

export type FlashLayer = {whiteOpacity: number; brightness: number};
/** The overexpose layer: a white wash (up to 0.9) over a brightness blow-out (up to 2.6x) at frame `frameInEvent` of a flash. */
export function flashLayerAt(frameInEvent: number, frames: number): FlashLayer | null {
  const amount = popAmount(frameInEvent, frames);
  if (amount <= 0) return null;
  return {whiteOpacity: round3(0.9 * amount), brightness: round3(1 + 1.6 * amount)};
}

export type SatPopLayer = {saturate: number; brightness: number; contrast: number; glowOpacity: number};
/** The saturation pop: saturate up to 2x, a touch brighter / punchier, plus a warm bloom (opacity up to 0.22), decaying over its frames. */
export function satPopLayerAt(frameInEvent: number, frames: number): SatPopLayer | null {
  const amount = popAmount(frameInEvent, frames);
  if (amount <= 0) return null;
  return {saturate: round3(1 + 1.0 * amount), brightness: round3(1 + 0.1 * amount), contrast: round3(1 + 0.08 * amount), glowOpacity: round3(0.22 * amount)};
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** The punch-in scale at `frameInWindow` of a money window of `windowFrames`: 1 -> `scale` over `rampFrames` (ease-out), held to the end of the window; 1 outside it (the next cut resets it). Never overshoots. */
export function punchScaleAt(frameInWindow: number, windowFrames: number, rampFrames: number, scale: number = PUNCH_SCALE): number {
  if (frameInWindow < 0 || frameInWindow >= windowFrames) return 1;
  const t = clamp(frameInWindow / Math.max(1, rampFrames), 0, 1);
  return round3(1 + (Math.min(scale, PUNCH_SCALE) - 1) * easeOut(t));
}

/** The punch scale of the footage at output frame `frame` (the strongest of every open punch-in). */
export function punchScaleForEvents(events: readonly PunchInEvent[] | undefined, frame: number, fps: number): number {
  let best = 1;
  for (const event of events ?? []) {
    const from = impactFrameOf(event.startSec, fps);
    const windowFrames = Math.max(1, impactFrameOf(event.endSec, fps) - from);
    best = Math.max(best, punchScaleAt(frame - from, windowFrames, event.rampFrames, event.scale));
  }
  return best;
}

/** 1 while `tSec` is inside a black-and-white span (a hard flip: the cut is the transition), else 0. */
export function bwAmountAt(spans: readonly BwSpan[] | undefined, tSec: number): number {
  return (spans ?? []).some(span => span.endSec > span.startSec && tSec >= span.startSec && tSec < span.endSec) ? 1 : 0;
}

export type ImpactLayers = {flash: FlashLayer | null; satPop: SatPopLayer | null; bw: boolean};

/** Everything the overlay track paints at output frame `frame`. */
export function impactLayersAt(fx: Partial<ImpactFx> | undefined, frame: number, fps: number): ImpactLayers {
  let flash: FlashLayer | null = null;
  for (const event of fx?.flashes ?? []) {
    const layer = flashLayerAt(frame - impactFrameOf(event.startSec, fps), clampFlashFrames(event.frames));
    if (layer && (!flash || layer.whiteOpacity > flash.whiteOpacity)) flash = layer;
  }
  let satPop: SatPopLayer | null = null;
  for (const event of fx?.satPops ?? []) {
    const layer = satPopLayerAt(frame - impactFrameOf(event.startSec, fps), clampSatPopFrames(event.frames));
    if (layer && (!satPop || layer.saturate > satPop.saturate)) satPop = layer;
  }
  return {flash, satPop, bw: bwAmountAt(fx?.bwSpans, frame / fps) > 0};
}

/** Share of `durationSec` the spans cover (union). */
export function bwShare(spans: readonly BwSpan[], durationSec: number): number {
  if (!(durationSec > 0)) return 0;
  const sorted = [...spans].filter(span => span.endSec > span.startSec).sort((a, b) => a.startSec - b.startSec);
  let covered = 0;
  let edge = 0;
  for (const span of sorted) {
    const from = Math.max(span.startSec, edge);
    if (span.endSec > from) covered += span.endSec - from;
    edge = Math.max(edge, span.endSec);
  }
  return round3(covered / durationSec);
}
