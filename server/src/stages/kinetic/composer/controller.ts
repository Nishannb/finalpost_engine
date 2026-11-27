/**
 * P6 Variety controller: assigns every beat either a designed composition or the quiet caption lane, then picks its variant (zone, alignment, entry / exit motion, voice, plate,
 * side, tilt). Deterministic and seeded by the transcript. It scores candidates by meaning (beat type affinity), the video's direction (toolkit weights, energy) and the beat's
 * intensity, and enforces the variety rules:
 *   - never the same composition twice in a row (a list's items are one series and share one layout),
 *   - no composition above MAX_SHARE of the designed beats,
 *   - at least MIN_DISTINCT_PER_30S distinct compositions per 30 s where the content allows,
 *   - zone / alignment / motion / voice never repeat back to back,
 *   - quiet beats between loud runs (an arc, not a wall),
 *   - takeover cards (a plain card + kinetic type: the edit's own B-roll) at least TAKEOVER_SPACING_SEC apart; when the picture has not changed for FRESH_PICTURE_SEC
 *     (2026-11-27, owner: "something new every few seconds") the next beat that fits a card is pulled toward one.
 */
import {hashString, rng} from './kit.ts';
import {ANGLE_OK} from './slant.ts';
import type {Align, Beat, BeatType, CompositionName, EditDirection, ExitVerb, PlateChoice, Variant, Verb, VoiceVariant, ZoneKey} from './types.ts';

export const MAX_SHARE = 0.34;
export const MAX_DESIGNED_RUN = 4;
export const TAKEOVER_SPACING_SEC = 8;
/** seconds without a full-frame change (a takeover card) after which a card is strongly preferred on the next beat that fits one */
export const FRESH_PICTURE_SEC = 7;
/** the pull a stale picture gives a takeover card (larger than any affinity gap except a tagged / typed composition) */
export const FRESH_PICTURE_BOOST = 2.2;
export const MIN_DISTINCT_PER_30S = 6;

type Designable = Exclude<CompositionName, 'captionLane' | 'matchCut'>;

export const AFFINITY: Record<BeatType, Partial<Record<Designable, number>>> = {
  stat: {counterStat: 3.2, giantWord: 1.2, heroStack: 0.8},
  list: {listItem: 3.2, sideStack: 1.0, calloutBar: 1.0},
  contrast: {contrastSplit: 3.0, wordSwap: 1.0, giantWord: 1.0, markerHighlight: 0.9},
  question: {questionCard: 3.0, lineWipe: 1.2, topHeadline: 1.0},
  cta: {ctaCard: 3.0, calloutBar: 1.2, giantWord: 1.0},
  warning: {giantWord: 1.8, takeover: 1.4, markerHighlight: 1.2, heroStack: 1.0, wordSwap: 1.0},
  hook: {takeover: 2.0, giantWord: 1.6, wordSwap: 1.4, heroStack: 1.1, topHeadline: 1.0},
  claim: {markerHighlight: 1.5, giantWord: 1.4, heroStack: 1.3, wordSwap: 1.2, sideStack: 1.1, calloutBar: 1.0, lineWipe: 1.0, topHeadline: 1.0},
  definition: {calloutBar: 1.6, lineWipe: 1.4, markerHighlight: 1.2, sideStack: 1.0, heroStack: 0.9},
  story: {lineWipe: 1.6, heroStack: 1.2, sideStack: 1.1, topHeadline: 1.0, markerHighlight: 0.8},
  plain: {heroStack: 1.2, lineWipe: 1.1, sideStack: 1.1, wordSwap: 1.0, markerHighlight: 0.9, topHeadline: 1.0, calloutBar: 0.8, giantWord: 0.8},
};
/** compositions that need a specific kind of content */
const REQUIRES: Partial<Record<Designable, (b: Beat) => boolean>> = {
  counterStat: b => Boolean(b.stat),
  listItem: b => Boolean(b.listMarker),
  contrastSplit: b => Boolean(b.contrast),
  questionCard: b => b.type === 'question',
  ctaCard: b => b.type === 'cta',
  takeover: b => (b.hook || b.intensity >= 0.8) && b.wordRange[1] - b.wordRange[0] >= 1 && b.wordRange[1] - b.wordRange[0] <= 6,
};
export const ENERGY: Record<Designable, number> = {
  giantWord: 0.9, takeover: 1, wordSwap: 0.85, contrastSplit: 0.8, counterStat: 0.85, heroStack: 0.65, sideStack: 0.6, markerHighlight: 0.55, calloutBar: 0.5, listItem: 0.6, lineWipe: 0.4, questionCard: 0.5, ctaCard: 0.7, topHeadline: 0.55,
};
export const DEFAULT_ZONES: Record<Designable, ZoneKey[]> = {
  // small / multi-word treatments live above the head or in the bottom band (never on the hands); only giant / counter / swap / CTA moments may take the chest
  giantWord: ['chest', 'top', 'below'], wordSwap: ['chest', 'top', 'low'], lineWipe: ['low', 'top', 'below'], sideStack: ['left', 'right', 'below'], topHeadline: ['top'], contrastSplit: ['top', 'below', 'low'],
  counterStat: ['chest', 'top', 'below', 'low'], listItem: ['top', 'low', 'below'], questionCard: ['top', 'low', 'below'], calloutBar: ['low', 'top', 'below'], markerHighlight: ['top', 'low', 'below'], ctaCard: ['chest', 'top', 'below'], takeover: ['full'], heroStack: ['top', 'low', 'chest', 'left', 'right'],
};
/** zone families: the eye should travel (up / down / side), not sit in one band */
export const zoneFamily = (z: ZoneKey): 'up' | 'down' | 'side' | 'full' => (z === 'top' ? 'up' : z === 'left' || z === 'right' ? 'side' : z === 'full' ? 'full' : 'down');
const VOICE_ROTATION: Record<EditDirection['tone'], VoiceVariant[]> = {
  hype: ['loud', 'gradient', 'mixed', 'clean', 'loud'],
  educational: ['clean', 'loud', 'editorial', 'mixed'],
  business: ['clean', 'loud', 'mixed', 'editorial', 'gradient'],
  story: ['editorial', 'clean', 'mixed', 'loud'],
  calm: ['editorial', 'clean', 'mixed'],
};
const PLATES: PlateChoice[] = ['dim', 'spotlight', 'vignette', 'wash'];
/** supporting words have their own motion pool per tone (they used to always rise / blur in) */
const SUB_VERBS: Record<EditDirection['tone'], Verb[]> = {
  hype: ['slide', 'drop', 'whip', 'rise', 'pop'], educational: ['slide', 'rise', 'mask', 'drop', 'track'], business: ['slide', 'mask', 'rise', 'track', 'whip'],
  story: ['rise', 'slide', 'blurIn', 'track', 'mask'], calm: ['blurIn', 'rise', 'track', 'slide'],
};
const ANGLE_P: Record<EditDirection['tone'], number> = {hype: 0.8, educational: 0.68, business: 0.66, story: 0.62, calm: 0.45};
/** perspective yaw (deg): the near side of the word clearly bigger than the far side */
const ANGLE_DEG: Record<EditDirection['tone'], [number, number]> = {hype: [32, 40], educational: [30, 38], business: [28, 36], story: [26, 34], calm: [20, 28]};

export type Assignment = {beat: Beat; designed: boolean; candidates: Designable[]; variant: Variant};

/** how much a beat wants to be a designed moment */
export function designScore(b: Beat): number {
  return b.intensity + (b.type !== 'plain' ? 0.25 : 0) + (b.keyIdx.length ? 0.05 : -0.3) + (b.hook ? 0.3 : 0);
}

/** designed vs quiet, hitting the direction's designed share by speech time, with no designed run longer than MAX_DESIGNED_RUN */
export function chooseDesigned(beats: readonly Beat[], direction: EditDirection): boolean[] {
  const dur = (b: Beat) => b.endFrame - b.startFrame;
  const total = beats.reduce((s, b) => s + dur(b), 0);
  const order = beats.map((b, i) => ({i, s: designScore(b)})).sort((x, y) => y.s - x.s);
  const designed = beats.map(() => false);
  let acc = 0;
  for (const {i} of order) { if (acc >= direction.designedShare * total) break; designed[i] = true; acc += dur(beats[i]!); }
  // the opening beat is always designed
  if (beats.length) designed[0] = true;
  // break long runs: demote the weakest beat of any run longer than MAX_DESIGNED_RUN
  let run: number[] = [];
  const flush = () => {
    if (run.length > MAX_DESIGNED_RUN) {
      const pieces = Math.floor(run.length / (MAX_DESIGNED_RUN + 1));
      const weakest = [...run].filter(i => i !== 0 && beats[i]!.type === 'plain').sort((x, y) => designScore(beats[x]!) - designScore(beats[y]!)).slice(0, Math.max(1, pieces));
      for (const i of weakest) designed[i] = false;
    }
    run = [];
  };
  beats.forEach((_, i) => { if (designed[i]) run.push(i); else flush(); });
  flush();
  return designed;
}

type History = {comps: Designable[]; zones: ZoneKey[]; aligns: Align[]; verbs: Verb[]; subVerbs: Verb[]; exits: ExitVerb[]; tilts: number[]; voices: VoiceVariant[]; plates: PlateChoice[]; takeoverAt: number[]; listVariant: Variant | null};

export function rankCandidates(b: Beat, prevBeat: Beat | undefined, direction: EditDirection, hist: History, r: () => number, fps: number): Designable[] {
  const tag = direction.beatTags?.[b.id]?.composition;
  const type = direction.beatTags?.[b.id]?.type ?? b.type;
  const aff = AFFINITY[type] ?? AFFINITY.plain;
  const all = Object.keys(DEFAULT_ZONES) as Designable[];
  const designedSoFar = hist.comps.length;
  const last = hist.comps[hist.comps.length - 1];
  const scored = all.map(c => {
    if (REQUIRES[c] && !REQUIRES[c]!(b)) return {c, s: -Infinity};
    // a list is one series: its items share one layout even with a quiet beat between them
    const continuingList = c === 'listItem' && last === 'listItem' && Boolean(b.listMarker);
    if (c === last && !continuingList) return {c, s: -Infinity};
    if (c === 'takeover' && hist.takeoverAt.some(t => Math.abs(t - b.startFrame) < TAKEOVER_SPACING_SEC * fps)) return {c, s: -Infinity};
    let s = (aff[c] ?? 0.35) * (direction.weights[c] ?? 1);
    if (direction.toolkit.includes(c)) s += 0.3;
    if (tag === c) s += 2.5;
    // the picture has been the same talking head for a while: a plain type card changes the palette (it fits only 2-7 words / 0.8-2.6 s; the solver refuses otherwise)
    if (c === 'takeover') {
      const lastChange = hist.takeoverAt.length ? Math.max(...hist.takeoverAt) : 0;
      const words = b.wordRange[1] - b.wordRange[0] + 1;
      const len = (b.endFrame - b.startFrame) / fps;
      if ((b.startFrame - lastChange) / fps >= FRESH_PICTURE_SEC && words >= 2 && words <= 7 && len >= 0.8 && len <= 2.6) s += FRESH_PICTURE_BOOST;
    }
    if (continuingList) s += 3;
    s *= 1 - Math.abs(ENERGY[c] - (0.5 * b.intensity + 0.5 * direction.energy)) * 0.7;
    const recent = hist.comps.slice(-3).filter(x => x === c).length;
    s -= 0.6 * recent;
    const count = hist.comps.filter(x => x === c).length;
    if (designedSoFar >= 4 && count / designedSoFar > MAX_SHARE && !continuingList) s -= 2;
    // unused compositions get a small pull: variety inside the video
    if (count === 0) s += 0.25;
    s += 0.35 * r();
    return {c, s};
  });
  return scored.filter(x => Number.isFinite(x.s)).sort((x, y) => y.s - x.s).map(x => x.c);
}

function pick<T>(pool: readonly T[], avoid: readonly T[], r: () => number): T {
  const ok = pool.filter(p => !avoid.includes(p));
  const from = ok.length ? ok : pool;
  return from[Math.floor(r() * from.length)]!;
}

export function variantFor(c: Designable, b: Beat, direction: EditDirection, hist: History, r: () => number): Variant {
  if (c === 'listItem' && hist.listVariant) return hist.listVariant;
  const zones = DEFAULT_ZONES[c];
  // prefer the family used least in the last 4 designed beats, never the previous family when another is allowed
  const recent = hist.zones.slice(-4).map(zoneFamily);
  const lastFam = recent[recent.length - 1];
  const scoredZones = zones.map((z, k) => ({z, s: (zoneFamily(z) === lastFam ? 10 : 0) + recent.filter(f => f === zoneFamily(z)).length + k * 0.3 + r() * 0.5}));
  const zone = scoredZones.sort((x, y) => x.s - y.s)[0]!.z;
  const bias = direction.look.alignBias;
  const alignPool: Align[] = bias === 'mixed' ? ['center', 'left', 'right'] : bias === 'center' ? ['center', 'center', 'left', 'right'] : [bias, bias, 'center'];
  const align = pick<Align>(alignPool, bias === 'mixed' ? hist.aligns.slice(-1) : [], r);
  const enter = pick(direction.verbs, hist.verbs.slice(-2), r);
  const subEnter = pick<Verb>(SUB_VERBS[direction.tone], [...hist.subVerbs.slice(-2), enter], r);
  const exit = pick<ExitVerb>(direction.exits, hist.exits.slice(-1), r);
  const voice = pick(VOICE_ROTATION[direction.tone], hist.voices.slice(-1), r);
  const plateWanted = r() < direction.plateRate * (0.6 + 0.6 * b.intensity) && ['giantWord', 'counterStat', 'wordSwap', 'heroStack', 'contrastSplit', 'markerHighlight', 'questionCard'].includes(c);
  const plate = plateWanted ? pick(PLATES, hist.plates.slice(-2), r) : null;
  // words enter from alternating sides; they leave to the same side or across (seeded), so the eye is pulled both ways
  const dir: -1 | 1 = hist.comps.length % 2 ? 1 : -1;
  const exitDir: -1 | 1 = r() < 0.5 ? dir : dir === 1 ? -1 : 1;
  // angled type: most designed treatments of an energetic video lean; the sign alternates with the last angled one; the solver trims the angle until it fits
  const lastTilt = [...hist.tilts].reverse().find(t => t !== 0) ?? 0;
  // the first two slantable treatments of a non-calm edit always lean (backed treatments cannot, one slant per frame), the rest by the tone's odds
  const angledSoFar = hist.tilts.filter(t => t !== 0).length;
  const angled = ANGLE_OK.has(c) && ((direction.tone !== 'calm' && angledSoFar < 2) || r() < ANGLE_P[direction.tone]);
  const [lo, hi] = ANGLE_DEG[direction.tone];
  const mag = Math.round((lo + (hi - lo) * r()) * 10) / 10;
  const tilt = angled ? (lastTilt > 0 ? -mag : lastTilt < 0 ? mag : mag * dir) : 0;
  // sometimes the slanted block also tips back / forward a little (looking up at / down onto the type)
  const pitch = angled && r() < 0.4 ? Math.round((r() < 0.5 ? -1 : 1) * (5 + 5 * r()) * 10) / 10 : 0;
  return {zone, align, enter, subEnter, exit, voice, plate, dir, exitDir, tilt, ...(pitch ? {pitch} : {})};
}

const QUIET: Variant = {zone: 'low', align: 'center', enter: 'pop', subEnter: 'pop', exit: 'fade', voice: 'clean', plate: null, dir: 1, exitDir: 1, tilt: 0};
/** Assign every beat (geometry-free: the zones are resolved by the solvers). */
export function assign(beats: readonly Beat[], direction: EditDirection, fps: number): Assignment[] {
  const designed = chooseDesigned(beats, direction);
  const r = rng(direction.seed ^ hashString('controller'));
  const hist: History = newHistory();
  return beats.map((b, i) => {
    if (!designed[i]) return {beat: b, designed: false, candidates: [], variant: QUIET};
    const cands = rankCandidates(b, beats[i - 1], direction, hist, r, fps);
    const first = cands[0];
    if (!first) return {beat: b, designed: false, candidates: [], variant: QUIET};
    const variant = variantFor(first, b, direction, hist, r);
    commit(hist, first, variant, b);
    return {beat: b, designed: true, candidates: cands, variant};
  });
}

export function commit(hist: History, c: Designable, v: Variant, b: Beat): void {
  hist.comps.push(c); hist.zones.push(v.zone); hist.aligns.push(v.align); hist.verbs.push(v.enter); hist.subVerbs.push(v.subEnter); hist.exits.push(v.exit); hist.tilts.push(v.tilt); hist.voices.push(v.voice); hist.plates.push(v.plate);
  if (c === 'takeover') hist.takeoverAt.push(b.startFrame);
  if (c === 'listItem' && !hist.listVariant) hist.listVariant = v;
}
export const newHistory = (): History => ({comps: [], zones: [], aligns: [], verbs: [], subVerbs: [], exits: [], tilts: [], voices: [], plates: [], takeoverAt: [], listVariant: null});
export type {History, Designable};
