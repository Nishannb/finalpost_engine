/**
 * Kinetic Composer entry: the edit pipeline's words + speaker box + zooms -> a validated RenderSpec (with its scene layer) and the final zoom list.
 *
 *   words -> beats (P2) -> edit direction (P6, optional Director) -> dry assignment -> punch-in plan (P4) -> speaker geometry with the final zooms -> Match Cut reservation (existing
 *   engine, V1 rules) -> per beat: rank compositions with the real history (P6), solve (P3 / P7 lane) -> verify (P8) -> repair (next candidate, then lane) -> metrics (P0).
 *
 * Pure apart from the optional Director call. Returns `spec: null` with a reason on any failure; the caller keeps the Kinetic V2 engine (never a silent older pipeline).
 */
import {StaticCamera} from '../camera.ts';
import {SubjectBandDepth} from '../depth.ts';
import type {DirectorCall} from '../director.ts';
import {solveLayout} from '../layout.ts';
import {directorMatchCut, matchCutBudget, MATCH_CUT_GAP_SEC, planMatchCuts} from '../matchCut.ts';
import {identityToBrand, type KineticIdentity} from '../presetIdentity.ts';
import {buildScene, type AlphaGrid, type Box, type ShotScene} from '../scene.ts';
import {sceneBehindEligibility} from '../guardrails.ts';
import {brandConfigSchema, renderSpecSchema, type KineticShot, type KineticWord, type RenderEvent, type RenderSpec, type SceneElement} from '../schema.ts';
import {DEFAULT_OBSERVATION_BUDGET, resolveSpeakerGeometry} from '../speakerGeometry.ts';
import type {SpeakerBoxSource} from '../speakerBox.ts';
import {toKineticWords} from '../transcript.ts';
import {shortsSafeRect} from '../../broll/heroSweep.ts';
import type {Violation} from '../guardrails.ts';
import {analyzeBeats, beatLine, isContent} from './beats.ts';
import {captionLane} from './captionLane.ts';
import {SOLVERS} from './compositions.ts';
import {assign, chooseDesigned, commit, DEFAULT_ZONES, designScore, newHistory, rankCandidates, variantFor, type Designable} from './controller.ts';
import {resolveDirection} from './direction.ts';
import {unifySlant} from './slant.ts';
import {zonesFor} from './kit.ts';
import {measureVariety, motionGate, motionStats, type MotionStats, type VarietyMetrics} from './metrics.ts';
import {planPunchIns, type ComposerZoom} from './stagecraft.ts';
import {verifyComposed} from './verify.ts';
import {applyPalette, voiceFromIdentity} from './voice.ts';
import type {Beat, Built, ComposeCtx, CompositionName, EditDirection, Slot} from './types.ts';

export type ComposerInput = {
  captionWords: ReadonlyArray<{text: string; start: number; end: number}>;
  fps: number;
  width: number;
  height: number;
  durationSec: number;
  speaker?: {box: unknown; source: SpeakerBoxSource; srcW: number; srcH: number; objectPosition?: {x: number; y: number}};
  /** the edit's existing zooms (output seconds); the composer keeps those that do not collide and adds beat punch-ins */
  zoomTriggers?: ReadonlyArray<{start: number; end: number; scale: number; focus?: {x: number; y: number} | undefined; sentenceIndex?: number}>;
  zoomEnabled?: boolean;
  /** plate mean + an optional 16x16 RGB grid of the speaker still (row-major, 768 bytes): local contrast per region */
  plate?: {luminance?: number; color?: string; grid?: ArrayLike<number>};
  identity?: KineticIdentity;
  /** null / undefined = the deterministic direction; a call = the Director (one LLM call) */
  director?: DirectorCall | null;
  /** POLISH_KINETIC_AI_PALETTE: the Director's palette choice replaces the preset's colours (default off = the preset's colours) */
  aiPalette?: boolean;
  /** V1 Match Cut (existing planner + solver; default true) */
  matchCut?: boolean;
  /** beat punch-ins (default true) */
  punchIns?: boolean;
  /** extra seed salt (tests / A-B) */
  salt?: string;
  /** internal: the final zoom list of a re-solve (punch-ins that left no room for their beat were removed) */
  fixedZooms?: {zooms: ComposerZoom[]; added: number; keptExisting: number};
  /**
   * The RVM person matte in composition fractions (pipeline/kineticMatteStage.ts), used only with a measured speaker box. With it, a few high-impact words may sit BEHIND the speaker
   * (the verifier judges occlusion against the matte); the caller must then ship the matching foreground. Absent = front-only.
   */
  matte?: {grid: AlphaGrid; alphaAreaFrac: number};
  /** internal: motion-variety gate retry count */
  motionTry?: number;
  /** internal: word ranges (inclusive) a designed composition could not draw; they become caption-lane beats of their own (every spoken word is shown) */
  coverageLane?: Array<[number, number]>;
  /** internal: coverage re-solve count */
  coverageTry?: number;
};

/** the Director is ONE call per edit: re-solves (punch-in, motion gate, coverage) reuse its answer instead of asking again */
const memoized = new WeakSet<DirectorCall>();
function memoDirector(call: DirectorCall): DirectorCall {
  if (memoized.has(call)) return call;
  const cache = new Map<string, Promise<string>>();
  const m: DirectorCall = req => {
    const key = `${req.system}\u0000${req.user}`;
    let p = cache.get(key);
    if (!p) { p = call(req); cache.set(key, p); p.catch(() => cache.delete(key)); }
    return p;
  };
  memoized.add(m);
  return m;
}

/** cut the coverage lane ranges out of the beats: each range becomes a lane-only beat; what is left of a beat keeps its id, tags and key words (when they are still inside) */
export function splitForCoverage(beats: readonly Beat[], ranges: ReadonlyArray<[number, number]>, words: readonly KineticWord[]): Beat[] {
  if (!ranges.length) return [...beats];
  const out: Beat[] = [];
  for (const b of beats) {
    const [a, z] = b.wordRange;
    const cuts = ranges.filter(([x, y]) => y >= a && x <= z).map(([x, y]) => [Math.max(a, x), Math.min(z, y)] as [number, number]).sort((p, q) => p[0] - q[0]);
    if (!cuts.length) { out.push(b); continue; }
    const pieces: Array<{range: [number, number]; lane: boolean}> = [];
    let cur = a;
    for (const [x, y] of cuts) {
      if (x > cur) pieces.push({range: [cur, x - 1], lane: false});
      if (y >= Math.max(cur, x)) pieces.push({range: [Math.max(cur, x), y], lane: true});
      cur = Math.max(cur, y + 1);
    }
    if (cur <= z) pieces.push({range: [cur, z], lane: false});
    let keptId = false;
    pieces.forEach((pc, k) => {
      const [x, y] = pc.range;
      const inR = (i: number) => i >= x && i <= y;
      const core = !pc.lane && !keptId;
      if (core) keptId = true;
      out.push({
        ...b, id: core ? b.id : `${b.id}x${k}`, wordRange: [x, y], startFrame: words[x]!.startFrame, endFrame: words[y]!.endFrame,
        keyIdx: b.keyIdx.filter(inR).length ? b.keyIdx.filter(inR) : [x], ...(pc.lane ? {laneOnly: true, intensity: Math.min(b.intensity, 0.3), type: 'plain' as const} : {}),
        stat: b.stat && b.stat.wordIdx.every(inR) ? b.stat : undefined, listMarker: b.listMarker && b.listMarker.wordIdx.every(inR) ? b.listMarker : undefined,
        contrast: b.contrast && inR(b.contrast.b) ? b.contrast : undefined, hook: b.hook && inR(a),
      });
    });
  }
  return out.map((b, i) => ({...b, idx: i}));
}

export type ComposerBeatReport = {id: string; type: string; intensity: number; composition: CompositionName | 'voiced'; zone?: string; text: string; tried: string[]};
export type ComposerReport = {
  ok: boolean;
  failure?: string;
  direction: Pick<EditDirection, 'source' | 'tone' | 'energy' | 'toolkit' | 'designedShare' | 'plateRate' | 'seed'> & {reason?: string; palette?: string};
  beats: ComposerBeatReport[];
  metrics: VarietyMetrics | null;
  violations: Violation[];
  repairs: number;
  zooms: {added: number; keptExisting: number; total: number};
  matchCut: {planned: number; kept: number};
  coverage: {words: number; drawn: number; voiced: number};
  speakerBox: {measured: boolean; note: string};
  notes: string[];
  /** what the verifier objected to on each repair pass (diagnostics) */
  repairLog?: string[];
  /** P3 motion gate: distinct entries / exits, side flips, angled and behind treatments of the designed edit */
  motion?: MotionStats & {ok: boolean; tries: number};
};
export type ComposerResult = {spec: RenderSpec | null; zoomTriggers: ComposerZoom[]; report: ComposerReport; debug?: {beats: Beat[]; words: KineticWord[]; scene: ShotScene}};

const GAP = 7; // >= the verifier's 6-frame gap between unrelated designed events
/** a designed beat that follows another designed beat may enter up to this many frames after its first word (0.27 s): better than losing the moment to the gap rule */
const LATE_START = 8;
const MAX_REPAIR_PASSES = 12;

type Win = {inFrame: number; outFrame: number};

/** Event windows for every beat. Two adjacent designed beats keep a GAP; a designed beat that would lose its last word to the gap demotes the weaker neighbour to the lane. */
export function planWindows(beats: readonly Beat[], designed: boolean[], fps: number, durationFrames: number, words: readonly KineticWord[]): Win[] {
  for (let pass = 0; pass < beats.length; pass += 1) {
    const wins: Win[] = [];
    let conflict = -1;
    for (let i = 0; i < beats.length; i += 1) {
      const b = beats[i]!, n = beats[i + 1];
      const prev = wins[i - 1];
      const both = (j: number) => designed[j] && designed[j + 1];
      const inFrame = Math.max(prev ? prev.outFrame + (designed[i] && designed[i - 1] ? GAP : 1) : 0, b.startFrame - 3);
      const natural = b.endFrame + Math.round((designed[i] ? 0.42 : 0.18) * fps);
      // two designed neighbours: this one holds to its last word's end, the next one starts up to LATE_START frames late
      const limit = n ? (both(i) ? Math.max(n.startFrame + LATE_START - GAP, Math.min(b.endFrame, n.startFrame - 3 - GAP)) : n.startFrame - 3 - 1) : durationFrames;
      const outFrame = Math.min(durationFrames, Math.max(inFrame + 4, Math.min(natural, limit)));
      const lastWordStart = words[b.wordRange[1]]!.startFrame;
      // the first CONTENT word must still be on screen when a late start lands (a leading 'a' / 'to' may be voiced)
      let fc = b.wordRange[0];
      while (fc < b.wordRange[1] && !isContent(words[fc]!.text)) fc += 1;
      const firstWordEnd = words[fc]!.endFrame;
      if (designed[i] && n && both(i) && outFrame < lastWordStart + 6) conflict = i;
      if (designed[i] && prev && designed[i - 1] && inFrame > firstWordEnd) conflict = i - 1;
      wins.push({inFrame, outFrame});
    }
    if (conflict < 0) return wins;
    const a = beats[conflict]!, bb = beats[conflict + 1]!;
    const demote = conflict === 0 ? conflict + 1 : designScore(a) < designScore(bb) ? conflict : conflict + 1;
    designed[demote] = false;
  }
  return beats.map(b => ({inFrame: b.startFrame, outFrame: b.endFrame}));
}

export async function composeKinetic(input: ComposerInput): Promise<ComposerResult> {
  const notes: string[] = [];
  const empty = (failure: string): ComposerResult => ({spec: null, zoomTriggers: [], report: {ok: false, failure, direction: {source: 'deterministic', tone: 'educational', energy: 0, toolkit: [], designedShare: 0, plateRate: 0, seed: 0}, beats: [], metrics: null, violations: [], repairs: 0, zooms: {added: 0, keptExisting: 0, total: 0}, matchCut: {planned: 0, kept: 0}, coverage: {words: 0, drawn: 0, voiced: 0}, speakerBox: {measured: false, note: 'none'}, notes}});
  const {fps, width: W, height: H} = input;
  if (!(fps > 0) || !(W > 0) || !(H > 0) || !(input.durationSec > 0)) return empty('invalid_geometry_or_duration');
  const words = toKineticWords(input.captionWords.map(w => ({text: w.text, start: w.start, end: w.end})), fps);
  if (words.length === 0) return empty('no_words');
  if (input.director && !memoized.has(input.director)) input = {...input, director: memoDirector(input.director)};
  try {
    const durationFrames = Math.max(Math.ceil(input.durationSec * fps), words[words.length - 1]!.endFrame + 1);
    const shot: KineticShot = {id: 'shot-0', startFrame: 0, endFrame: durationFrames};
    const beats0 = analyzeBeats(words, fps);
    const presetVoice = voiceFromIdentity(input.identity);
    const direction = await resolveDirection(words, beats0, input.director, input.salt ?? '', input.aiPalette ? {...(input.plate?.color ? {footageColor: input.plate.color} : {}), ...(input.plate?.luminance !== undefined ? {footageLuminance: input.plate.luminance} : {}), presetText: presetVoice.text, presetAccent: presetVoice.accent} : undefined, {behind: Boolean(input.matte), matchCut: input.matchCut !== false});
    for (const b of beats0) { const t = direction.beatTags?.[b.id]?.type; if (t) b.type = t; }
    // every spoken word is shown: words a designed composition could not draw (a previous solve) become lane beats of their own
    const beats = splitForCoverage(beats0, input.coverageLane ?? [], words);
    const aiBehind = new Set(direction.behindBeats ?? []);
    if (input.director && input.matte) notes.push(aiBehind.size ? `behind:ai:${[...aiBehind].join('+')}` : 'behind:ai:none');
    const voice = input.aiPalette ? applyPalette(presetVoice, direction.palette) : presetVoice;

    // dry assignment (geometry-free) -> punch-ins
    const dry = assign(beats, direction, fps);
    const existing: ComposerZoom[] = (input.zoomTriggers ?? []).map(z => ({start: z.start, end: z.end, scale: z.scale, ...(z.focus ? {focus: z.focus} : {}), sentenceIndex: z.sentenceIndex ?? 0}));
    // the speaker box without zooms, for the zoom focus
    const geo0 = input.speaker ? resolveSpeakerGeometry({box: input.speaker.box, source: input.speaker.source, srcW: input.speaker.srcW, srcH: input.speaker.srcH, width: W, height: H, ...(input.speaker.objectPosition ? {objectPosition: input.speaker.objectPosition} : {}), zoomTriggers: [], zoomEnabled: false, fps, durationFrames, observationBudget: DEFAULT_OBSERVATION_BUDGET}) : null;
    const focus = geo0?.box ? {x: Math.round((geo0.box.x + geo0.box.w / 2) * 1000) / 1000, y: Math.round(Math.max(0.05, geo0.box.y + 0.15 * geo0.box.h) * 1000) / 1000} : undefined;
    // with a matte the zoom list is frozen: the matte grid (and the person foreground) were mapped through exactly these zooms, so new punch-ins would misplace the cutout
    if (input.matte && input.punchIns !== false) notes.push('punch_ins_off:matte_mapped_to_existing_zooms');
    const punch = input.fixedZooms ? input.fixedZooms : input.punchIns === false || input.zoomEnabled === false || input.matte
      ? {zooms: existing, added: 0, keptExisting: existing.length}
      : planPunchIns({designed: dry.filter(d => d.designed).map(d => ({startSec: d.beat.startFrame / fps, endSec: d.beat.endFrame / fps, intensity: d.beat.intensity, composition: d.candidates[0]!, sentenceIndex: d.beat.sentenceIndex})), existing, durationSec: durationFrames / fps, ...(focus ? {focus} : {}), energy: direction.energy});
    const zooms = punch.zooms;

    // speaker geometry with the FINAL zooms (every placement clears the zoomed face)
    let scene: ShotScene;
    let speakerNote = 'no_speaker_box';
    let measured = false;
    if (input.speaker) {
      const g = resolveSpeakerGeometry({box: input.speaker.box, source: input.speaker.source, srcW: input.speaker.srcW, srcH: input.speaker.srcH, width: W, height: H, ...(input.speaker.objectPosition ? {objectPosition: input.speaker.objectPosition} : {}), zoomTriggers: zooms, zoomEnabled: input.zoomEnabled !== false, fps, durationFrames, observationBudget: DEFAULT_OBSERVATION_BUDGET});
      speakerNote = g.note;
      measured = Boolean(g.box);
      const useMatte = Boolean(input.matte && g.box && input.matte.grid.samples.length > 0 && Number.isFinite(input.matte.alphaAreaFrac));
      scene = useMatte
        ? buildScene({shotId: shot.id, subjectBox: g.box as Box, noMatte: false, grid: input.matte!.grid, alphaAreaFrac: input.matte!.alphaAreaFrac, ...(g.track.length ? {boxTrack: g.track} : {}), ...(g.crownSoft ? {crownSoft: g.crownSoft} : {}), luminance: input.plate?.luminance, ...(input.plate?.color ? {plateColor: input.plate.color} : {}), width: W, height: H})
        : buildScene({shotId: shot.id, noMatte: true, ...(g.box ? {speakerBox: g.box as Box} : {}), ...(g.track.length ? {boxTrack: g.track} : {}), ...(g.crownSoft ? {crownSoft: g.crownSoft} : {}), luminance: input.plate?.luminance, ...(input.plate?.color ? {plateColor: input.plate.color} : {}), width: W, height: H});
    } else {
      scene = buildScene({shotId: shot.id, noMatte: true, luminance: input.plate?.luminance, ...(input.plate?.color ? {plateColor: input.plate.color} : {}), width: W, height: H});
    }
    const safe = shortsSafeRect(W, H);
    const grid = input.plate?.grid && input.plate.grid.length >= 768 ? input.plate.grid : null;
    const lin = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const lumAt = (r: {left: number; top: number; right: number; bottom: number}): number => {
      if (!grid) return scene.luminance;
      const x0 = Math.max(0, Math.floor((r.left / W) * 16)), x1 = Math.min(15, Math.floor((r.right / W) * 16)), y0 = Math.max(0, Math.floor((r.top / H) * 16)), y1 = Math.min(15, Math.floor((r.bottom / H) * 16));
      let sum = 0, n = 0, max = 0;
      for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) { const k = (y * 16 + x) * 3; const l = 0.2126 * lin(grid[k]!) + 0.7152 * lin(grid[k + 1]!) + 0.0722 * lin(grid[k + 2]!); sum += l; n += 1; max = Math.max(max, l); }
      // the brightest cells matter most for white text: weight the max
      return n ? 0.5 * (sum / n) + 0.5 * max : scene.luminance;
    };
    const behindOk = !scene.noMatte && sceneBehindEligibility(scene).eligible;
    if (input.matte && !behindOk) notes.push(scene.noMatte ? 'matte_unused:no_measured_box_or_empty_grid' : 'matte_unused:speaker_fills_frame');
    const ctx: ComposeCtx = {W, H, fps, safe, scene, words, voice, direction, durationFrames, lumAt, behindOk};

    // V1 Match Cut: the existing planner + solver; its window is reserved (it owns the frame, its words are voiced)
    let matchCutEvents: RenderEvent[] = [];
    let mcPlanned = 0;
    if (input.matchCut !== false) {
      let mc = planMatchCuts(words, [shot], fps);
      // the Director's suggestion (it judges the meaning; directorMatchCut keeps every structural rule). It never adds a cut beyond the budget or closer than the spacing rule.
      if (direction.matchCut) {
        const sb = beats0.find(b => b.id === direction.matchCut!.beatId);
        const ai = sb ? directorMatchCut(words, [shot], fps, {beatRange: sb.wordRange, keyword: direction.matchCut.keyword, moment: direction.matchCut.moment}) : {event: null, reason: 'beat_unknown'};
        notes.push(ai.event ? `match_cut:ai_accepted:${direction.matchCut.keyword}:${ai.reason}` : `match_cut:ai_rejected:${direction.matchCut.keyword}:${ai.reason}`);
        if (ai.event && !mc.some(e => e.id === ai.event!.id)) {
          const at = (e: typeof mc[number]) => words[e.wordRange[0]]!.startFrame;
          const budget = matchCutBudget(words[words.length - 1]!.endFrame / fps);
          // the AI's moment first (it read the whole talk), then the rule-found ones that still fit the budget and spacing
          const merged = [ai.event, ...mc].filter((e, k, all) => all.slice(0, k).every(o => Math.abs(at(o) - at(e)) >= MATCH_CUT_GAP_SEC * fps)).slice(0, budget);
          mc = merged;
        }
      } else if (input.director) notes.push('match_cut:ai_none');
      mcPlanned = mc.length;
      if (mc.length) {
        const brand = input.identity ? identityToBrand(input.identity) : brandConfigSchema.parse({});
        const solved = solveLayout({plan: {version: '1', style: 'cinematicClean', events: mc}, words, shots: [shot], scenes: {[shot.id]: scene}, cameras: {[shot.id]: new StaticCamera().track(shot)}, depth: new SubjectBandDepth(), brand, ...(input.identity ? {identity: input.identity} : {}), width: W, height: H, fps, seed: 1, planSource: 'composer'});
        matchCutEvents = solved.spec.events.filter(e => e.presetResolved === 'type.matchCut');
      }
    }
    const mcWins = matchCutEvents.map(e => ({inFrame: e.inFrame, outFrame: e.outFrame}));

    // designed vs lane + windows
    const designed = chooseDesigned(beats, direction).map((d, i) => d && !beats[i]!.laneOnly);
    const wins = planWindows(beats, designed, fps, durationFrames, words);
    // clip windows around the match cut (GAP before / after); a beat inside it is voiced
    const clipped: Array<Win | null> = wins.map((w, i) => {
      let {inFrame, outFrame} = w;
      for (const m of mcWins) {
        if (outFrame <= m.inFrame - GAP || inFrame >= m.outFrame + GAP) continue;
        const b = beats[i]!;
        if (b.startFrame >= m.inFrame && b.endFrame <= m.outFrame) return null;
        if (b.startFrame < m.inFrame) outFrame = Math.min(outFrame, m.inFrame - GAP); else inFrame = Math.max(inFrame, m.outFrame + GAP);
      }
      return outFrame - inFrame >= 6 ? {inFrame, outFrame} : null;
    });

    // per-beat solve with the REAL history (fallbacks keep the variety rules)
    const hist = newHistory();
    const built: Array<{comp: CompositionName; b: Built} | null> = beats.map(() => null);
    const tried: string[][] = beats.map(() => []);
    const failed: Array<Set<string>> = beats.map(() => new Set());
    /** beats whose behind-the-speaker placement the verifier refused (they go back to the front) */
    const noBehind = new Set<number>();
    const BEHIND_SPACING = Math.round(6 * fps);
    const behindAt = (): number[] => built.flatMap((x, j) => (x?.b.notes.includes('behind') ? [beats[j]!.startFrame] : []));
    const solveBeat = (i: number): void => {
      const b = beats[i]!;
      const w = clipped[i];
      if (!w) { built[i] = null; return; }
      const zones = zonesFor(ctx, w.inFrame, w.outFrame);
      if (designed[i]) {
        const ranked = rankCandidates(b, beats[i - 1], direction, hist, (() => { let s = (direction.seed ^ (i * 2654435761)) >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })(), fps);
        // a beat the Director picked for text-behind tries the behind-capable compositions first (only when a matte makes behind possible at all)
        const wantsBehind = ctx.behindOk && aiBehind.has(b.id) && !noBehind.has(i);
        // never the same treatment as the designed beat right before / after (a repair re-solves out of order, so the history alone cannot see the neighbours); lists repeat by design
        const neighbour = (j: number) => { const x = built[j]; return x && x.comp !== 'captionLane' && x.comp !== 'listItem' ? x.comp : null; };
        const nPrev = neighbour(i - 1), nNext = neighbour(i + 1);
        const cands = (wantsBehind ? [...new Set<Designable>(['giantWord', 'heroStack', ...ranked])] : ranked).filter(c => !failed[i]!.has(c) && c !== nPrev && c !== nNext);
        const takes = takesFor(b, words);
        const top = cands.slice(0, 6);
        const variants = new Map(top.map(c => [c, variantFor(c, b, direction, hist, (() => { let s = (direction.seed ^ hashOf(`${b.id}:${c}`)) >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })())]));
        // take-major: the whole phrase in any of the 4 best compositions beats a reduced take of the first one
        const order: Array<[Designable, number[] | undefined]> = [];
        for (const only of takes) for (const c of top.slice(0, 4)) order.push([c, only]);
        for (const c of top.slice(4)) for (const only of takes) order.push([c, only]);
        for (const [c, only] of order) {
          if (!tried[i]!.includes(c)) tried[i]!.push(c);
          const v0 = variants.get(c)!;
          // behind the speaker: a high-impact giant word, with a matte, spaced (the verifier still judges every placement against the matte)
          const behind = ctx.behindOk && (c === 'giantWord' || c === 'heroStack') && !noBehind.has(i) && (b.intensity >= 0.6 || aiBehind.has(b.id)) && behindAt().every(f => Math.abs(f - b.startFrame) >= BEHIND_SPACING);
          const variant = behind ? {...v0, behind: true} : v0;
          // the variant's region first, then every other region this composition may use (a small band above the head must not end the search)
          for (const zone of [...new Set([variant.zone, ...DEFAULT_ZONES[c]])]) {
            const slot: Slot = {beat: b, ...(beats[i - 1] ? {prev: beats[i - 1]} : {}), ...(beats[i + 1] ? {next: beats[i + 1]} : {}), composition: c, inFrame: w.inFrame, outFrame: w.outFrame, variant: {...variant, zone}, ...(only ? {only} : {})};
            const r = SOLVERS[c](slot, ctx, zones);
            // the history records the turn the event REALLY has (a treatment on a chip / highlighter / bar draws flat whatever its variant asked), so the next angled beat leans the other way
            if (r) { const drawnYaw = r.events.find(e => e.composition)?.keyframes[0]?.rotateY ?? 0; built[i] = {comp: c, b: r}; commit(hist, c, {...variant, zone: r.zone, tilt: Math.abs(drawnYaw) >= 0.5 ? drawnYaw : 0}, b); return; }
          }
        }
        for (const c of top) failed[i]!.add(c);
      }
      if (failed[i]!.has('captionLane')) { built[i] = null; return; }
      tried[i]!.push('captionLane');
      const lane = captionLane(b, w.inFrame, w.outFrame, ctx, zones);
      built[i] = lane ? {comp: 'captionLane', b: lane} : null;
    };
    for (let i = 0; i < beats.length; i += 1) solveBeat(i);
    // a punch-in that pushed its designed beat out (no room under the zoomed face) is removed, and the edit is solved again with the remaining zooms (once)
    if (!input.fixedZooms && punch.added > 0) {
      const wanted = new Map(dry.map(d => [d.beat.id, d.candidates[0]]));
      const BOUND: ReadonlySet<string> = new Set(['counterStat', 'listItem', 'contrastSplit', 'questionCard', 'ctaCard']);
      const displaced = (b: Beat, i: number) => designed[i] && (!built[i] || built[i]!.comp === 'captionLane' || (BOUND.has(wanted.get(b.id) ?? '') && built[i]!.comp !== wanted.get(b.id)));
      const hurt = zooms.filter(z => !existing.includes(z) && beats.some((b, i) => displaced(b, i) && b.startFrame / fps < z.end + 1 && b.endFrame / fps > z.start));
      if (hurt.length) {
        const kept = zooms.filter(z => !hurt.includes(z));
        return composeKinetic({...input, fixedZooms: {zooms: kept, added: punch.added - hurt.length, keptExisting: punch.keptExisting}});
      }
    }

    const assemble = (): RenderSpec => {
      const events: RenderEvent[] = [...matchCutEvents];
      const sceneEls: SceneElement[] = [];
      for (const x of built) if (x) { events.push(...unifySlant(x.b.events)); sceneEls.push(...x.b.scene); }
      events.sort((a, b) => a.inFrame - b.inFrame || a.id.localeCompare(b.id));
      return renderSpecSchema.parse({
        version: '1', seed: direction.seed % 2147483647, fps, width: W, height: H, durationInFrames: durationFrames, safeRect: {left: safe.left, right: safe.right, top: safe.top, bottom: safe.bottom}, noMatte: scene.noMatte,
        shots: [{id: shot.id, startFrame: 0, endFrame: durationFrames, noMatte: scene.noMatte}], events, captions: [], planSource: `composer:${direction.source}`, ...(sceneEls.length ? {scene: sceneEls} : {}),
      });
    };
    let spec = assemble();
    let violations = verifyComposed(spec, scene, [shot]);
    let repairs = 0;
    const repairLog: string[] = [];
    for (let pass = 0; pass < MAX_REPAIR_PASSES && violations.length > 0; pass += 1) {
      repairLog.push(...violations.slice(0, 6).map(v => `${pass}:${v.rule}@${v.eventId}:${v.detail.slice(0, 80)}`));
      const beatIds = [...new Set(violations.map(v => v.eventId.split('-')[0]!))];
      const idxs = beatIds.map(id => beats.findIndex(b => b.id === id)).filter(i => i >= 0);
      if (idxs.length === 0) break;
      for (const i of idxs) {
        const cur = built[i];
        // a refused BEHIND placement goes back to the front with the same composition
        if (cur?.b.notes.includes('behind')) noBehind.add(i);
        else if (cur) failed[i]!.add(cur.comp);
        else failed[i]!.add('captionLane');
        repairs += 1;
        solveBeat(i);
      }
      spec = assemble();
      violations = verifyComposed(spec, scene, [shot]);
    }
    if (violations.length > 0) {
      // last resort: drop what is still objected to (its words are voiced), then re-verify; anything left fails the composer
      for (const v of violations) { const i = beats.findIndex(b => b.id === v.eventId.split('-')[0]); if (i >= 0) built[i] = null; }
      spec = assemble();
      violations = verifyComposed(spec, scene, [shot]);
      notes.push('dropped_after_repair');
    }
    // P3 motion gate: an edit with enough designed beats must visibly move (entries, exits, sides, angles); a failing edit is re-planned with another seed, and fails closed (the V2
    // engine runs) only when no seed gets there
    const mstats = motionStats(spec);
    const gateOk = violations.length > 0 || motionGate(mstats, direction.tone);
    const tries = input.motionTry ?? 0;
    // angled type should lean BOTH ways across the edit (one direction everywhere reads as a tilted layout, not motion): another seed is tried, never a failure on its own
    const yaws = spec.events.filter(e => e.composition && e.composition !== 'captionLane').map(e => e.keyframes[0]?.rotateY ?? 0);
    const oneWay = mstats.angled >= 2 && !(yaws.some(y => y >= 12) && yaws.some(y => y <= -12));
    if ((!gateOk || (oneWay && violations.length === 0)) && tries < 2) { const {fixedZooms: _fz, ...rest} = input; return composeKinetic({...rest, salt: `${input.salt ?? ''}~m${tries + 1}`, motionTry: tries + 1}); }
    if (!gateOk) { notes.push(`motion_gate_failed:${JSON.stringify(mstats)}`); violations.push({eventId: 'motion', rule: 'motion-variety', detail: `enter ${mstats.enterDistinct}, exit ${mstats.exitDistinct}, flips ${mstats.dirFlips}, angled ${mstats.angled}`}); }
    const drawn = new Set<number>();
    for (const x of built) if (x) for (const d of x.b.drawn) drawn.add(d);
    // words spoken inside a match cut are shown by the montage itself
    for (const m of mcWins) for (const w of words) if (w.startFrame >= m.inFrame && w.startFrame < m.outFrame) drawn.add(w.idx);
    const missing = words.filter(w => !drawn.has(w.idx)).map(w => w.idx);
    if (missing.length > 0 && violations.length === 0) {
      const coverageTry = input.coverageTry ?? 0;
      if (coverageTry < 3) {
        // a missing run at the start / end of a designed beat is cut out as a lane beat; a run in the MIDDLE of a beat (or a beat nothing drew) sends the whole beat to the lane
        const lane: Array<[number, number]> = [...(input.coverageLane ?? [])];
        const runs: Array<[number, number]> = [];
        for (const m of missing) { const r = runs[runs.length - 1]; if (r && m === r[1] + 1) r[1] = m; else runs.push([m, m]); }
        for (const [x, y] of runs) {
          const bi = beats.findIndex(b => x >= b.wordRange[0] && x <= b.wordRange[1]);
          const b = beats[bi];
          if (!b) { lane.push([x, y]); continue; }
          const edge = x === b.wordRange[0] || y >= b.wordRange[1];
          // what the designed treatment keeps after the cut must still be a moment (>= 2 words, >= 0.5 s); otherwise the whole beat reads as one caption line
          const coreLo = x === b.wordRange[0] ? Math.min(y, b.wordRange[1]) + 1 : b.wordRange[0];
          const coreHi = x === b.wordRange[0] ? b.wordRange[1] : x - 1;
          const coreOk = coreHi - coreLo + 1 >= 2 && words[coreHi]!.endFrame - words[coreLo]!.startFrame >= 0.5 * fps;
          lane.push(built[bi] && built[bi]!.comp !== 'captionLane' && edge && !b.laneOnly && coreOk ? [x, Math.min(y, b.wordRange[1])] : [b.wordRange[0], b.wordRange[1]]);
          if (y > b.wordRange[1]) lane.push([b.wordRange[1] + 1, y]);
        }
        const {fixedZooms: _fz, ...rest} = input;
        return composeKinetic({...rest, coverageLane: lane, coverageTry: coverageTry + 1});
      }
      violations.push({eventId: 'coverage', rule: 'word-coverage', detail: `${missing.length} spoken word(s) never shown: ${missing.slice(0, 8).map(i => words[i]!.text).join(' ')}`});
      notes.push(`coverage_missing:${missing.length}`);
    }
    if (input.coverageLane?.length) notes.push(`coverage_lane_splits:${input.coverageLane.length}`);
    const metrics = measureVariety(spec, scene, {startFrame: words[0]!.startFrame, endFrame: words[words.length - 1]!.endFrame});
    const beatsReport: ComposerBeatReport[] = beats.map((b, i) => ({id: b.id, type: b.type, intensity: Math.round(b.intensity * 100) / 100, composition: built[i]?.comp ?? 'voiced', ...(built[i] ? {zone: built[i]!.b.zone} : {}), text: beatLine(b, words), tried: tried[i]!}));
    const report: ComposerReport = {
      ok: violations.length === 0, ...(violations.length ? {failure: `violations:${violations.slice(0, 3).map(v => `${v.rule}@${v.eventId}`).join(',')}`} : {}),
      direction: {source: direction.source, tone: direction.tone, energy: direction.energy, toolkit: direction.toolkit, designedShare: direction.designedShare, plateRate: direction.plateRate, seed: direction.seed, ...(direction.reason ? {reason: direction.reason} : {}), ...(input.aiPalette ? {palette: direction.palette ?? 'preset'} : {})},
      beats: beatsReport, metrics, violations, repairs, zooms: {added: punch.added, keptExisting: punch.keptExisting, total: zooms.length}, matchCut: {planned: mcPlanned, kept: matchCutEvents.length},
      coverage: {words: words.length, drawn: drawn.size, voiced: words.length - drawn.size}, speakerBox: {measured, note: speakerNote}, notes, ...(repairLog.length ? {repairLog} : {}),
      motion: {...mstats, ok: gateOk, tries},
    };
    return {spec: violations.length === 0 ? spec : null, zoomTriggers: zooms, report, debug: {beats, words, scene}};
  } catch (err) {
    return empty(`composer_error:${err instanceof Error ? err.message.slice(0, 160) : String(err)}`);
  }
}

/** reduced takes of a beat when the whole phrase does not fit: the full phrase, then its content words (<= 5, with the marker / number / contrast words), then the key words alone. The rest is voiced. */
export function takesFor(b: Beat, words: readonly KineticWord[]): Array<number[] | undefined> {
  const ids: number[] = [];
  for (let i = b.wordRange[0]; i <= b.wordRange[1]; i += 1) ids.push(i);
  const must = new Set<number>([...(b.listMarker?.wordIdx ?? []), ...(b.stat?.wordIdx ?? []), ...(b.contrast ? [b.contrast.b] : []), ...(b.keyIdx.slice(0, 1))]);
  const content = ids.filter(i => must.has(i) || isContent(words[i]!.text));
  const take1 = [...new Set([...must, ...content.filter(i => !must.has(i)).sort((x, y) => b.keyIdx.indexOf(y) - b.keyIdx.indexOf(x)).slice(0, Math.max(0, 5 - must.size))])].sort((x, y) => x - y);
  const take2 = [...new Set([...must, ...b.keyIdx.slice(0, 2)])].sort((x, y) => x - y);
  const out: Array<number[] | undefined> = [undefined];
  if (take1.length && take1.length < ids.length) out.push(take1);
  if (take2.length && take2.length < take1.length) out.push(take2);
  return out;
}

function hashOf(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
