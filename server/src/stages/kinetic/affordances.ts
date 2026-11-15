/**
 * Director <-> solver spatial contract (Phase 4).
 *
 * The solver knows exactly which free regions exist around THIS speaker (measured box, crop, punch-in zoom) and how large a block can be at the readability floor. The Director used to be told only
 * "beside / above placements are legal" and asked for them on ~90% of events, 64 of ~69 of which the solver then had to move. This module lets the solver SAY what it can do:
 *
 *   zoneAffordances   per zone (besideLeft / besideRight / upper / running): the real free rectangle in px, the longest hero word that fits at the readability floor, the same with a support line,
 *                     and a status: viable (a typical word fits) / conditional (short words only) / unavailable.
 *   probeFit          the exact solver answer for one concrete event in one requested zone (used by the adaptation ladder, the diagnostics and the evaluation)
 *   affordanceBlock   the words handed to the Director for one shot
 *
 * Nothing here has its own geometry: regions come from `zoneRegions` and fits from `solvePlaybookEvent` itself (probes with a fresh state), so the contract cannot drift from the solver.
 * Pure. No I/O.
 */
import {shortsSafeRect} from '../broll/heroSweep.ts';
import {cameraSampleAt} from './camera.ts';
import {SubjectBandDepth} from './depth.ts';
import type {SolverDecision} from './diagnostics.ts';
import {FORCE_FRONT_ALPHA_AREA, sceneBehindEligibility} from './guardrails.ts';
import {BEHIND_WINDOW_SEC, newPlaybookState, solvePlaybookEvent, zoneRegions} from './playbook.ts';
import {boxSpan, type ShotScene} from './scene.ts';
import type {FontPair, KineticWord, StyleName, TextEvent, ZoneName} from './schema.ts';

export type AffordanceZone = 'besideLeft' | 'besideRight' | 'upper' | 'running';
export const AFFORDANCE_ZONES: readonly AffordanceZone[] = ['besideLeft', 'besideRight', 'upper', 'running'];
export type AffordanceStatus = 'viable' | 'conditional' | 'unavailable';

export type ZoneAffordance = {
  zone: AffordanceZone;
  status: AffordanceStatus;
  /** free rectangle in px (the solver's region, before padding) */
  widthPx: number;
  heightPx: number;
  /** longest hero word (letters, average-width capitals) that fits ONE line at the readability floor; 0 = nothing fits */
  maxHeroLetters: number;
  /** the same word with a 5-letter support line under it */
  maxHeroLettersWithSupport: number;
  /** lines a running block may use at most (the solver's block-row limit) */
  maxLines: number;
  reason: string;
};

export type FitContext = {scene: ShotScene; width: number; height: number; fps: number; frames: [number, number]; style?: StyleName; fontPair?: FontPair};
export type FitResult = {requested: ZoneName | string; zone: ZoneName | null; inRequestedZone: boolean; belowFloor: boolean; scale: number | null; dropped?: string};

const FILL = 'ETAONRISHDLUCMFWYGPBVKXQJZ';
const filler = (n: number) => Array.from({length: n}, (_, i) => FILL[i % FILL.length]).join('');
const PAIRS: FontPair[] = ['street', 'editorial', 'neon'];

/** The solver's answer for these lines requested in `zone`. Fresh state, no side effects. */
export function probeFit(ctx: FitContext, zone: ZoneName | string, lines: Array<{text: string; role: 'hero' | 'support' | 'connector' | 'running' | 'punch'}>, opts: {adapt?: boolean; ev?: Partial<TextEvent>} = {}): FitResult {
  const f0 = 60, f1 = 60 + 18 * lines.length;
  const words: KineticWord[] = lines.flatMap((l, i) => l.text.split(/\s+/).filter(Boolean).map((t, j) => ({idx: 0, text: t, startFrame: f0 + i * 12 + j * 6, endFrame: f0 + i * 12 + j * 6 + 10, emphasisScore: 0.5}))).map((w, i) => ({...w, idx: i}));
  if (words.length === 0) return {requested: zone, zone: null, inRequestedZone: false, belowFloor: false, scale: null, dropped: 'no words'};
  // keep the probe on the same box the real window would see: the scene's box track over [f0, f1] (a zoom window is probed through its own frames)
  const shot = {id: ctx.scene.shotId, startFrame: 0, endFrame: Math.max(f1 + 120, ctx.frames[1] + 60)};
  const shiftedScene = ctx.frames[0] === 0 && ctx.frames[1] === 0 ? ctx.scene : shiftScene(ctx.scene, ctx.frames, f0);
  const ev: TextEvent = {id: 'probe', shotId: shot.id, wordRange: [0, words.length - 1], lines: lines.map(l => ({text: l.text, role: l.role})), preset: 'type.words', layering: 'front', anchor: 'screen', regionHint: zone as TextEvent['regionHint'], ...opts.ev} as TextEvent;
  let belowFloor = false;
  const res = solvePlaybookEvent({
    ev, style: ctx.style ?? 'retroNeon', fontPair: ctx.fontPair ?? 'street', words, shot, scene: shiftedScene, width: ctx.width, height: ctx.height, fps: ctx.fps, seed: 1, depth: new SubjectBandDepth(),
    cameraAt: frame => cameraSampleAt(undefined, frame), limitOut: shot.endFrame, isLast: false, state: newPlaybookState(), phase: 0, varyPose: false,
    ...(opts.adapt ? {adapt: true} : {}),
    decide: d => { if (d.code === 'adjusted.below_floor' || d.code === 'adjusted.no_zone_fits') belowFloor = true; },
  });
  const first = res.events[0];
  if (!first) return {requested: zone, zone: null, inRequestedZone: false, belowFloor, scale: null, ...(res.dropped ? {dropped: res.dropped} : {})};
  const z = (first.zone ?? null) as ZoneName | null;
  const scale = first.keyframes.length ? first.keyframes[Math.floor(first.keyframes.length / 2)]!.scale : null;
  return {requested: zone, zone: z, inRequestedZone: z === zone, belowFloor, scale};
}

/** the same scene with no punch-in box track: its `subjectBox` is the plain, unzoomed box */
function withoutBoxTrack(scene: ShotScene): ShotScene {
  const {boxTrack: _track, ...rest} = scene;
  return rest;
}

/** A scene whose box track is re-based so that frames [a, b] of the real timeline appear at [f0, f0 + b - a] of the probe window. */
function shiftScene(scene: ShotScene, frames: [number, number], f0: number): ShotScene {
  const box = boxSpan(scene, frames[0], frames[1]);
  return {...scene, subjectBox: box, boxTrack: [{frame: f0, box}], faceKeepOut: {x: box.x, y: box.y, w: box.w, h: box.h * 0.42}};
}

/** Longest `filler` word of the zone that fits at the floor (binary search over the solver itself), optionally with a 5-letter support line. */
function capacity(ctx: FitContext, zone: ZoneName, withSupport: boolean): number {
  const fits = (n: number): boolean => {
    const lines = [{text: filler(n), role: 'hero' as const}, ...(withSupport ? [{text: filler(5).toLowerCase(), role: 'support' as const}] : [])];
    return PAIRS.every(fp => {
      const r = probeFit({...ctx, fontPair: fp}, zone, lines);
      return r.inRequestedZone && !r.belowFloor;
    });
  };
  if (!fits(2)) return 0;
  let lo = 2, hi = 24;
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (fits(mid)) lo = mid; else hi = mid - 1; }
  return lo;
}

/** Per-zone affordances for the box the scene has over `ctx.frames`. */
export function zoneAffordances(ctx: FitContext): ZoneAffordance[] {
  const safe = shortsSafeRect(ctx.width, ctx.height);
  // Phase 4.3 fix: the BASELINE is the no-zoom box. It used to be read at frame 60 of the real timeline, so a punch-in zoom active there (about 2 s in) silently turned the "baseline" into a zoomed one.
  const sceneForFrames = ctx.frames[0] === 0 && ctx.frames[1] === 0 ? withoutBoxTrack(ctx.scene) : shiftScene(ctx.scene, ctx.frames, 60);
  const b = boxSpan(sceneForFrames, 60, 60);
  const sb = {left: b.x * ctx.width, right: (b.x + b.w) * ctx.width, top: b.y * ctx.height, bottom: (b.y + b.h) * ctx.height};
  const regions = zoneRegions(sb, {left: safe.left, right: safe.right, top: safe.top, bottom: safe.bottom}, ctx.width);
  const measured = !ctx.scene.estimated;
  const probeCtx = {...ctx, frames: [0, 0] as [number, number], scene: sceneForFrames};
  return AFFORDANCE_ZONES.map((zone): ZoneAffordance => {
    const rect = zone === 'running' ? {left: safe.left, right: safe.right, top: sb.top + 0.42 * (sb.bottom - sb.top), bottom: safe.bottom} : regions[zone];
    const widthPx = Math.max(0, Math.round(rect.right - rect.left)), heightPx = Math.max(0, Math.round(rect.bottom - rect.top));
    if (zone !== 'running' && !measured) return {zone, status: 'unavailable', widthPx, heightPx, maxHeroLetters: 0, maxHeroLettersWithSupport: 0, maxLines: 0, reason: 'the speaker position is not measured, so nothing is parked beside or above a guess'};
    const hero = capacity(probeCtx, zone, false);
    const withSupport = hero > 0 ? capacity(probeCtx, zone, true) : 0;
    const status: AffordanceStatus = hero >= 5 ? 'viable' : hero >= 3 ? 'conditional' : 'unavailable';
    const reason = status === 'unavailable'
      ? (zone === 'upper' ? 'no headroom above the speaker at readable size' : zone === 'running' ? 'no room under the face' : 'the free side of the frame is too narrow for readable type')
      : status === 'conditional' ? 'only short words fit at readable size' : 'a typical hero word fits';
    return {zone, status, widthPx, heightPx, maxHeroLetters: hero, maxHeroLettersWithSupport: withSupport, maxLines: zone === 'running' ? 4 : hero > 0 ? 2 : 0, reason};
  });
}

export type ShotAffordances = {shotId: string; baseline: ZoneAffordance[]; windows: Array<{label: string; startSec: number; endSec: number; zones: ZoneAffordance[]}>};

/** Affordances for one shot: the baseline (no zoom) and one row per punch-in window (the zoomed face is bigger: less room). */
export function shotAffordances(input: {scene: ShotScene; width: number; height: number; fps: number; zooms?: ReadonlyArray<{start: number; end: number}>; style?: StyleName}): ShotAffordances {
  const base = {scene: input.scene, width: input.width, height: input.height, fps: input.fps, ...(input.style ? {style: input.style} : {})};
  const baseline = zoneAffordances({...base, frames: [0, 0]});
  const windows = (input.zooms ?? []).map((z, i) => ({label: `zoom ${i + 1}`, startSec: z.start, endSec: z.end, zones: zoneAffordances({...base, frames: [Math.round(z.start * input.fps), Math.round(z.end * input.fps)]})}));
  return {shotId: input.scene.shotId, baseline, windows};
}

const fmtZone = (a: ZoneAffordance): string => {
  const name = a.zone === 'upper' ? 'upper (above the head)' : a.zone === 'running' ? 'running (chest height)' : a.zone;
  if (a.status === 'unavailable') return `${name}: UNAVAILABLE (${a.reason})`;
  const cap = a.zone === 'running' ? `up to ${a.maxHeroLetters} letters on one line, up to ${a.maxLines} lines` : `a hero word of up to ${a.maxHeroLetters} letters (up to ${a.maxHeroLettersWithSupport} with a short support line under it)`;
  return `${name}: ${a.status === 'viable' ? 'OK' : 'SHORT WORDS ONLY'}, ${cap}`;
};

/** The words handed to the Director for one shot. Deterministic. */
export function affordanceBlock(s: ShotAffordances, /** Phase 5.12 (G1-a): the shot's categorical behind eligibility (guardrails.ts sceneBehindEligibility). Absent or no matte = the exact previous last line. */ behind?: ReturnType<typeof sceneBehindEligibility>, alphaAreaFrac?: number): string {
  const lines = [`  SPACE for ${s.shotId} (what the renderer can actually place here at readable size; request a regionHint only from the OK lines):`, ...s.baseline.map(a => `   - ${fmtZone(a)}`)];
  for (const w of s.windows) {
    const worse = w.zones.filter((z, i) => z.status !== s.baseline[i]!.status || z.maxHeroLetters < s.baseline[i]!.maxHeroLetters);
    if (worse.length) lines.push(`   - while the punch-in zoom is up (${w.startSec.toFixed(1)}-${w.endSec.toFixed(1)} s) the speaker is larger: ${worse.map(z => `${z.zone} ${z.status === 'unavailable' ? 'UNAVAILABLE' : `up to ${z.maxHeroLetters} letters`}`).join('; ')}`);
  }
  if (behind?.eligible) lines.push(`   - behind-the-head and stack-over-cutout ARE available here (person matte): at most one such event per ${BEHIND_WINDOW_SEC} s, on the strongest single hero; the solver still refuses a placement that would hide the hero's first or last letters or touch the face.`);
  else if (behind && behind.reason === 'alpha_area') lines.push(`   - behind-the-head and stack-over-cutout are NOT available: the speaker fills ${Math.round((alphaAreaFrac ?? 0) * 100)}% of the frame (over ${Math.round(FORCE_FRONT_ALPHA_AREA * 100)}%), so nothing legible fits behind; use the zones above.`);
  else lines.push('   - behind-the-head and stack-over-cutout are not available without a person matte.');
  return lines.join('\n');
}

export const SPATIAL_CONTRACT_LEGEND = `

SPACE CONTRACT (this job): under each shot you get a SPACE block. It is measured from the real speaker position, crop and punch-in zoom, by the same code that places the type.
- Use regionHint besideLeft / besideRight / upper ONLY for a zone marked OK, and only for a hero word that fits its letter limit. A zone marked SHORT WORDS ONLY takes a short hero word and no support line.
- For a longer word, or when no side zone is OK, use regionHint "running" (always available) or "auto": do not request a zone that is UNAVAILABLE; the renderer would move the type there anyway and your intent is lost.
- Prefer variety among the zones that ARE available (alternate sides, use the headroom when it exists) instead of asking for the same zone every time.
- A hero is the one or two words that carry the meaning of the sentence, not a connective.`;

/** For the evaluation: did the contract predict what the solver did? `predictedViable` = the zone's status and the hero word length said it fits. */
export function predictViable(aff: ZoneAffordance[], zone: string, heroLetters: number, withSupport: boolean): boolean {
  const a = aff.find(x => x.zone === zone);
  if (!a) return true; // not a spatial request (auto / behind / flank): nothing to predict
  if (a.status === 'unavailable') return false;
  return heroLetters <= (withSupport ? a.maxHeroLettersWithSupport : a.maxHeroLetters);
}

export type { SolverDecision };
