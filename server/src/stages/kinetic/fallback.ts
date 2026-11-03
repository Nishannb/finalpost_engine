/**
 * Deterministic fallback plan: emphasis words -> fallback.boldCenter.front, plus lower-centre serif captions. Uses ONLY transcript words. Respects the density rules
 * (<= 1 hero active, <= 2 clusters + 1 caption, >= MIN_GAP_FRAMES between unrelated events) and never crosses a shot boundary.
 */
import {hexToHsl} from './accent.ts';
import type {EnterName, ExitName, FontPair, KineticPlan, KineticShot, KineticWord, TextEvent} from './schema.ts';
import {HERO_EMPHASIS_THRESHOLD, normToken} from './transcript.ts';
import {matchCutViolations, matchCutWindow, planMatchCuts} from './matchCut.ts';
import {BRAND_PHRASES, FUNCTION_WORDS, MAX_HEADLINE_UNITS, MAX_PEER_UNITS, countHeadlineUnits, isPeerList} from './words.ts';

export const MIN_GAP_FRAMES = 6;
export const HERO_HOLD_FRAMES = 18;
const MAX_CAPTION_WORDS = 5;
const MAX_HEROES_PER_SHOT = 14;
/** at 30 fps: one title moment per 15 s, one behindSignature per 8 s (the solver re-checks both against the real fps) */
const TITLE_GAP_FRAMES = 450;
const BEHIND_GAP_FRAMES = 240;

export const shotOfFrame = (shots: KineticShot[], frame: number): KineticShot | undefined => shots.find(s => frame >= s.startFrame && frame < s.endFrame) ?? shots[shots.length - 1];

/** Frame window an event of this range occupies (also used by the solver). */
export const rangeFrames = (words: KineticWord[], [a, b]: [number, number]): {inFrame: number; outFrame: number} => ({
  inFrame: words[a]?.startFrame ?? 0,
  outFrame: (words[b]?.endFrame ?? 0) + 0,
});

export type FallbackResult = {plan: KineticPlan; reason?: string};
/** What the fallback knows about the plate (mean luminance 0..1 and mean colour): the font pairing is chosen from it, per video. */
export type PlateInfo = {luminance?: number; color?: string};

/** Font pairing for a plate: a bright, soft plate -> editorial; a vivid magenta / purple plate -> neon; everything else (dark / saturated / loud) -> street. */
export function fontPairForPlate(plate?: PlateInfo): FontPair {
  const lum = plate?.luminance ?? 0.3;
  const hsl = plate?.color ? hexToHsl(plate.color) : null;
  if (lum > 0.5 && (!hsl || hsl.s < 0.35)) return 'editorial';
  if (hsl && hsl.s > 0.35 && hsl.h >= 270 && hsl.h <= 340) return 'neon';
  return 'street';
}

/** The fallback rotates through the motion library: heroes through IN-2 / IN-4 / IN-6 / IN-9 / IN-7 with OUT-1 / OUT-2 / OUT-4, lead-ins through IN-1 / IN-3. */
const FALLBACK_ENTERS: EnterName[] = ['IN-2', 'IN-4', 'IN-6', 'IN-9', 'IN-7'];
const FALLBACK_EXITS: ExitName[] = ['OUT-1', 'OUT-2', 'OUT-4'];
const FALLBACK_LEADS: EnterName[] = ['IN-1', 'IN-3'];

export function buildFallbackPlan(input: {words: KineticWord[]; shots: KineticShot[]; reason?: string; fps?: number; plate?: PlateInfo}): FallbackResult {
  const {words, shots} = input;
  const fps = input.fps ?? 30;
  const events: TextEvent[] = [];
  if (words.length === 0 || shots.length === 0) return {plan: {version: '1', style: 'cinematicClean', events}, reason: input.reason ?? 'no_words'};

  // 0) match cuts: only where the speech NAMES a concept / contrasts two words; none otherwise. They own their words + ~1.8 s, so type.words never overlaps them.
  const matchCuts = planMatchCuts(words, shots, fps);
  const mcCovered = new Set<number>();
  const mcBusy: Array<[number, number]> = [];
  for (const m of matchCuts) {
    const win = matchCutWindow(m, words, shots.find(s => s.id === m.shotId), fps);
    if (!win) continue;
    for (let i = m.wordRange[0]; i <= m.wordRange[1]; i += 1) mcCovered.add(i);
    for (const w of words) if (w.startFrame < win.outFrame + MIN_GAP_FRAMES && w.endFrame + HERO_HOLD_FRAMES > win.inFrame - MIN_GAP_FRAMES) mcCovered.add(w.idx);
    mcBusy.push([win.inFrame, win.outFrame]);
  }

  // 1) heroes: the strongest emphasis words, greedy, with room for each other.
  // Adaptive floor: the fixed HERO_EMPHASIS_THRESHOLD (0.65) is often too high for flat talking-head delivery
  // (this clip peaked at ~0.62). When nothing clears it, take the top content words above a soft floor so the
  // fallback still produces headline blocks instead of a wall of running captions.
  const heroes: KineticWord[] = [];
  const contentOk = (w: KineticWord) => {
    const t = normToken(w.text);
    return Boolean(t) && t.length >= 4 && !FUNCTION_WORDS.has(t) && !mcCovered.has(w.idx);
  };
  /** Prefer longer content words; punctuation alone should not win the hero slot. */
  const heroRank = (w: KineticWord) => w.emphasisScore + Math.min(0.12, (normToken(w.text).length - 4) * 0.02) + (/^[A-Z]/.test(w.text.trim()) ? 0.04 : 0);
  let cands = words.filter(w => w.emphasisScore >= HERO_EMPHASIS_THRESHOLD && contentOk(w)).sort((a, b) => heroRank(b) - heroRank(a) || a.idx - b.idx);
  {
    const soft = 0.22;
    const softCands = words.filter(w => w.emphasisScore >= soft && contentOk(w)).sort((a, b) => heroRank(b) - heroRank(a) || a.idx - b.idx);
    const seen = new Set(cands.map(w => w.idx));
    for (const w of softCands) if (!seen.has(w.idx)) { cands.push(w); seen.add(w.idx); }
  }
  const perShot = new Map<string, number>();
  const busy: Array<[number, number]> = [...mcBusy];
  for (const w of cands) {
    const shot = shotOfFrame(shots, w.startFrame);
    if (!shot) continue;
    if ((perShot.get(shot.id) ?? 0) >= MAX_HEROES_PER_SHOT) continue;
    const out = Math.min(w.endFrame + HERO_HOLD_FRAMES, shot.endFrame);
    if (busy.some(([s, e]) => w.startFrame < e + MIN_GAP_FRAMES && out > s - MIN_GAP_FRAMES)) continue;
    heroes.push(w);
    busy.push([w.startFrame, out]);
    perShot.set(shot.id, (perShot.get(shot.id) ?? 0) + 1);
  }
  heroes.sort((a, b) => a.idx - b.idx);
  /** Multi-word tool / brand names that must stay one hero line (never split into running captions). */
  const glueSpanAt = (idx: number): [number, number] | null => {
    for (const phrase of BRAND_PHRASES) {
      for (let start = Math.max(0, idx - (phrase.length - 1)); start <= idx; start += 1) {
        const end = start + phrase.length - 1;
        if (end >= words.length) continue;
        if (phrase.every((t, k) => normToken(words[start + k]!.text) === t)) return [start, end];
      }
    }
    return null;
  };
  const phraseAt = (i: number): [number, number] | null => {
    for (const p of BRAND_PHRASES) {
      if (i + p.length <= words.length && p.every((t, k) => normToken(words[i + k]!.text) === t)) return [i, i + p.length - 1];
    }
    return null;
  };
  /** Adjacent equivalent tools in one breath (After Effects, Premiere Pro, and DaVinci Resolve). */
  const peerClusterAt = (idx: number): {start: number; end: number; names: Array<[number, number]>} | null => {
    const mine = glueSpanAt(idx);
    if (!mine) return null;
    const names: Array<[number, number]> = [mine];
    let end = mine[1];
    while (end + 1 < words.length) {
      let k = end + 1;
      while (k < words.length && FUNCTION_WORDS.has(normToken(words[k]!.text))) k += 1;
      const next = phraseAt(k);
      if (!next || words[next[0]]!.startFrame - words[end]!.endFrame > 18) break;
      names.push(next);
      end = next[1];
    }
    let start = mine[0];
    while (start > 0) {
      let k = start - 1;
      while (k >= 0 && FUNCTION_WORDS.has(normToken(words[k]!.text))) k -= 1;
      if (k < 0) break;
      const prev = glueSpanAt(k);
      if (!prev || prev[1] >= start || words[start]!.startFrame - words[prev[1]]!.endFrame > 18) break;
      names.unshift(prev);
      start = prev[0];
    }
    return names.length >= 2 ? {start, end, names} : null;
  };
  // 2) headline blocks: [leading connectors] + HERO + [one trailing support]; function words are connectors, nothing is invented
  const covered = new Set<number>(mcCovered);
  const heroIdx = new Set(heroes.map(h => h.idx));
  let lastBehind = -1e9, lastTitle = -1e9;
  let leadRot = 0, heroRot = 0;
  for (const w of heroes) {
    if (covered.has(w.idx)) continue;
    const shot = shotOfFrame(shots, w.startFrame)!;
    const sameShot = (x: KineticWord) => shotOfFrame(shots, x.startFrame)?.id === shot.id;
    const peer = peerClusterAt(w.idx);
    if (peer) {
      const lines: TextEvent['lines'] = peer.names.map((span, i) => ({
        text: words.slice(span[0], span[1] + 1).map(x => x.text.replace(/[.,;:!?]+$/, '')).join(' '),
        role: i === 0 ? 'hero' : 'support',
      }));
      for (let i = peer.start; i <= peer.end; i += 1) covered.add(i);
      events.push({id: `hero-${w.idx}`, shotId: shot.id, wordRange: [peer.start, peer.end], lines, preset: 'type.words', layering: 'front', anchor: 'screen', regionHint: 'running', enter: FALLBACK_ENTERS[heroRot % FALLBACK_ENTERS.length], exit: FALLBACK_EXITS[heroRot % FALLBACK_EXITS.length]});
      heroRot += 1;
      continue;
    }
    const glue = glueSpanAt(w.idx);
    let a = glue ? glue[0] : w.idx;
    let b = glue ? glue[1] : w.idx;
    if (!glue) {
      while (a - 1 >= 0 && w.idx - (a - 1) <= 3) {
        const p = words[a - 1]!;
        const next = words[a]!;
        if (covered.has(p.idx) || !sameShot(p) || !FUNCTION_WORDS.has(normToken(p.text)) || next.startFrame - p.endFrame > 9 || /[.!?,;:]$/.test(p.text)) break;
        a -= 1;
      }
      const nx = words[w.idx + 1];
      const heroEndsPhrase = /[.!?,;:]$/.test(w.text);
      if (nx && !heroEndsPhrase && sameShot(nx) && !covered.has(nx.idx) && !heroIdx.has(nx.idx) && !FUNCTION_WORDS.has(normToken(nx.text)) && normToken(nx.text) && nx.startFrame - w.endFrame <= 9) b = nx.idx;
    }
    const lines: TextEvent['lines'] = [];
    const lead = (): EnterName => FALLBACK_LEADS[leadRot++ % FALLBACK_LEADS.length]!;
    if (a < (glue ? glue[0] : w.idx)) lines.push({text: words.slice(a, glue ? glue[0] : w.idx).map(x => x.text.replace(/[.,;:!?]+$/, '')).join(' '), role: 'connector', enter: lead()});
    if (glue) lines.push({text: words.slice(glue[0], glue[1] + 1).map(x => x.text.replace(/[.,;:!?]+$/, '')).join(' '), role: 'hero'});
    else {
      lines.push({text: w.text.replace(/[.,;:!?]+$/, ''), role: 'hero'});
      if (b > w.idx) lines.push({text: words[b]!.text.replace(/[.,;:!?]+$/, ''), role: 'support', enter: lead()});
    }
    const solo = a === b && !glue;
    let regionHint: TextEvent['regionHint'] = 'auto';
    let title: boolean | undefined;
    if (solo && w.emphasisScore >= 0.85 && w.startFrame - lastTitle >= TITLE_GAP_FRAMES) { title = true; lastTitle = w.startFrame; }
    else if (w.emphasisScore >= 0.9 && w.startFrame - lastBehind >= BEHIND_GAP_FRAMES) { regionHint = 'behindSignature'; lastBehind = w.startFrame; }
    for (let i = a; i <= b; i += 1) covered.add(i);
    events.push({id: `hero-${w.idx}`, shotId: shot.id, wordRange: [a, b], lines, preset: 'type.words', layering: 'auto', anchor: 'screen', regionHint, enter: FALLBACK_ENTERS[heroRot % FALLBACK_ENTERS.length], exit: FALLBACK_EXITS[heroRot % FALLBACK_EXITS.length], ...(title ? {title} : {})});
    heroRot += 1;
  }

  // 2b) one large 3D hero on a real keyword (a solo content word of 5-10 letters) and, when the solver finds a matte, one behind-the-head hero and one stack over the cutout.
  const soloHeroes = events.filter(e => e.preset === 'type.words' && e.lines.length === 1 && e.lines[0]!.role === 'hero' && e.wordRange[0] === e.wordRange[1] && !e.title);
  const lettersOf = (e: TextEvent) => normToken(e.lines[0]!.text).length;
  const pool3d = soloHeroes.filter(e => lettersOf(e) >= 5 && lettersOf(e) <= 10).sort((x, y) => (words[y.wordRange[0]]!.emphasisScore - words[x.wordRange[0]]!.emphasisScore) || x.wordRange[0] - y.wordRange[0]);
  const three = pool3d[0];
  if (three) { three.preset = 'hero.extrudedStack.front'; three.regionHint = 'auto'; delete (three as {enter?: unknown}).enter; delete (three as {exit?: unknown}).exit; }
  const rest = events.filter(e => e !== three && e.preset === 'type.words' && e.lines.some(l => l.role === 'hero') && e.regionHint === 'auto' && !e.title);
  const behindPick = rest.filter(e => e.lines.length === 1).sort((x, y) => (words[y.wordRange[0]]!.emphasisScore - words[x.wordRange[0]]!.emphasisScore) || x.wordRange[0] - y.wordRange[0])[0];
  if (behindPick && !events.some(e => e.regionHint === 'behindSignature')) behindPick.regionHint = 'behindSignature';
  const stackPick = rest.filter(e => e !== behindPick && e.lines.length >= 2 && e.lines[0]!.role === 'connector' && e.lines.some(l => l.role === 'hero')).sort((x, y) => (words[y.wordRange[0]]!.emphasisScore - words[x.wordRange[0]]!.emphasisScore) || x.wordRange[0] - y.wordRange[0])[0];
  if (stackPick && !events.some(e => e.regionHint === 'stackOverCutout')) stackPick.regionHint = 'stackOverCutout';

  // 3) every other word is a normal GAP CAPTION (gapCaptions.ts), shown only while no lockup is on screen: no running events any more
  events.push(...matchCuts);
  events.sort((x, y) => x.wordRange[0] - y.wordRange[0]);
  // LED / kinetic default when the director is unavailable — white-only cinematicClean reads as captions. The font pairing follows the plate; the accent is derived from the plate by the solver.
  return {plan: {version: '1', style: 'retroNeon', fontPair: fontPairForPlate(input.plate), events}, ...(input.reason ? {reason: input.reason} : {})};
}

// ---------------------------------------------------------------------------------------------------------------- fidelity

/** Every line token must be a transcript token of the event's word range (or of its swap sequence). Returns violation messages. */
export function transcriptFidelity(plan: KineticPlan, words: KineticWord[]): string[] {
  const out: string[] = [];
  for (const ev of plan.events) {
    const [a, b] = ev.wordRange;
    if (a > b || b >= words.length) {
      out.push(`${ev.id}: wordRange [${a},${b}] outside transcript (${words.length} words)`);
      continue;
    }
    const allowed = new Set<string>();
    for (let k = a; k <= b; k += 1) allowed.add(normToken(words[k]!.text));
    for (const line of ev.lines) for (const k of line.swapSlot?.wordIdxSequence ?? []) if (words[k]) allowed.add(normToken(words[k]!.text));
    for (const line of ev.lines) {
      for (const tok of line.text.split(/\s+/).map(normToken).filter(Boolean)) {
        if (!allowed.has(tok)) out.push(`${ev.id}: "${tok}" is not in the transcript range`);
      }
      for (const k of line.swapSlot?.wordIdxSequence ?? []) if (!words[k]) out.push(`${ev.id}: swap index ${k} outside transcript`);
    }
  }
  return out;
}

/** Density rules over a plan: returns violations (the solver enforces them; the director fallback satisfies them by construction). */
export function densityViolations(plan: KineticPlan, words: KineticWord[], fps = 30): string[] {
  const out: string[] = [];
  out.push(...matchCutViolations(plan, words, fps));
  const evs = plan.events.filter(e => e.preset !== 'type.matchCut').map(e => ({e, ...rangeFrames(words, e.wordRange), hero: e.lines.some(l => l.role === 'hero'), cap: e.lines.every(l => l.role === 'caption' || l.role === 'running')}));
  for (const a of evs) {
    const units = countHeadlineUnits(a.e.lines);
    const unitCap = isPeerList(a.e.lines) ? MAX_PEER_UNITS : MAX_HEADLINE_UNITS;
    if (units > unitCap && a.e.preset === 'type.words' && !a.cap) out.push(`${a.e.id}: >${unitCap} words in a headline block`);
    if (a.e.lines.filter(l => l.role === 'hero').length > 1 && a.e.preset === 'type.words') out.push(`${a.e.id}: >1 hero in a block`);
    const active = evs.filter(o => o.inFrame < a.outFrame && o.outFrame > a.inFrame);
    if (active.filter(o => o.hero).length > 1) out.push(`${a.e.id}: >1 hero active`);
    if (active.filter(o => !o.hero && !o.cap).length > 2) out.push(`${a.e.id}: >2 clusters active`);
    if (active.filter(o => o.cap).length > 1) out.push(`${a.e.id}: >1 caption active`);
  }
  return [...new Set(out)];
}
