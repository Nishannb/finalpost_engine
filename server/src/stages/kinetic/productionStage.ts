/**
 * Production kinetic stage: the edit pipeline's words, speaker box and zoom -> a validated `RenderSpec` for `blueprint.kinetic`.
 *
 * It composes pieces that already exist and are tested (toKineticWords, buildScene with a measured box (G1), runKineticDirector with event-level recovery (G5), the coverage fill, solveLayout
 * with decisions (G2/G6), verifyRenderSpec, wordCoverage). It adds NO layout logic of its own. The standalone CLI engine (runKinetic.ts) is untouched.
 *
 * Time base: the PRODUCTION blueprint is on the OUTPUT timeline (after silence / retake cuts), and `captionWords` are already remapped to it. One shot spans the whole edit, so composition frames ==
 * output frames (the CLI's source-frame base needs no remapping here). Seconds -> frames at the blueprint fps.
 *
 * Pure apart from the injectable Director call. No file or network access.
 */
import {StaticCamera} from './camera.ts';
import {interpolateKeyframes, restingRange} from './geometry.ts';
import {HERO_FLOOR_FRAC, SUPPORT_FLOOR_FRAC} from './motion.ts';
import {withCoverageFill, type CoverageFillResult} from './coverageFill.ts';
import {wordCoverage, type CoverageReport} from './coverage.ts';
import {SubjectBandDepth} from './depth.ts';
import {summarizeDecisions, type DecisionSummary, type SolverDecision} from './diagnostics.ts';
import {affordanceBlock, shotAffordances, type ShotAffordances} from './affordances.ts';
import {runKineticDirector, type DirectorCall} from './director.ts';
import {validateEmphasis, type EmphasisReport} from './emphasis.ts';
import {repairViolations, splitOversizedEvents} from './repair.ts';
import {MAX_BLOCK_WORDS} from './playbook.ts';
import {faceTransitWords, sceneBehindEligibility, verifyRenderSpec, type Violation} from './guardrails.ts';
import {solveLayout} from './layout.ts';
import type {EventProvenance, RejectedEvent} from './plan.ts';
import {buildScene, type AlphaGrid, type Box, type ShotScene} from './scene.ts';
import {identityToBrand, type KineticIdentity} from './presetIdentity.ts';
import {brandConfigSchema, renderSpecSchema, type BrandConfig, type KineticPlan, type KineticShot, type KineticWord, type RenderSpec} from './schema.ts';
import {resolveMeasuredSpeakerBox, sourceBoxToComposition, type SpeakerBoxSource} from './speakerBox.ts';
import {toKineticWords} from './transcript.ts';
import {carryPayoffAccents, payoffAccents, type CarriedAccent} from './runningAccent.ts';
import {DEFAULT_OBSERVATION_BUDGET, resolveSpeakerGeometry, type ObservationBudget} from './speakerGeometry.ts';
import type {ZoomTriggerLite} from './zoomTrack.ts';

export type ProductionCaptionWord = {text: string; start: number; end: number};

export type ProductionKineticInput = {
  /** output-timeline words (seconds), exactly the blueprint's `captionWords` */
  captionWords: readonly ProductionCaptionWord[];
  fps: number;
  /** composition size (the blueprint's width / height) */
  width: number;
  height: number;
  durationSec: number;
  /** the pipeline's speaker box: fractions of the SOURCE frame. `fallback` = a default, never treated as measured. */
  speaker?: {box: unknown; source: SpeakerBoxSource; srcW: number; srcH: number; /** cover object-position, 0..1 (fullscreen layout: x 0.5, y 0.42) */ objectPosition?: {x: number; y: number}; /** a moving speaker (optional, Phase 4.4): source-fraction boxes at sample frames; absent = the one static box */ motion?: ReadonlyArray<{frame: number; box: unknown; margin?: {x: number; y: number}; cover?: ReadonlyArray<unknown>}>};
  /**
   * Phase 5 (optional, absent = no matte = exactly the previous behaviour): the RVM person matte mapped to COMPOSITION fractions at OUTPUT frames (matteMap.ts `compositionMatte`). Used only together
   * with a measured speaker box: the box / face keep-out stay the measured ones, the matte adds the real alpha grid (occlusion) and the alpha area, and lifts `noMatte`, so behind-the-person
   * placement becomes legal under the unchanged solver rules. The caller must then ship the matching foreground (or re-solve without the matte).
   */
  matte?: {grid: AlphaGrid; alphaAreaFrac: number};
  /** the blueprint's punch-in zooms (output seconds); the type must clear the zoomed face */
  zoomTriggers?: readonly ZoomTriggerLite[];
  zoomEnabled?: boolean;
  plate?: {luminance?: number; color?: string};
  /** undefined = the configured Gemini Director; null = none (deterministic fallback) */
  director?: DirectorCall | null;
  richDirectorInput?: boolean;
  brand?: BrandConfig;
  /** V1: the user's caption identity (derived from the selected CaptionKit preset); with it the brand sheet is `identityToBrand` of it */
  identity?: KineticIdentity;
  seed?: number;
  policy?: {
    /** 3D extruded presets: false (default) until the Lambda path is verified; the Director's request is replaced by flat type and recorded */
    allowThreeD?: boolean;
    /** every spoken word is drawn (default true): uncovered words get a quiet running line, a match cut that would swallow words is dropped */
    coverAllWords?: boolean;
    /**
     * V1 Match Cut: keep an ELIGIBLE match cut whose full-frame card owns more spoken words than it draws (default false = it is dropped, which is why no Match Cut reached production before).
     * The words spoken inside the card's own window stay undrawn by design (the card shows the speaker's words as cropped, blurred context; the voice plays on); the words of its range
     * outside that window are covered by the ordinary coverage fill. Eligibility (four moments, one per plan, 20 s apart) is decided before this and is not touched.
     */
    keepSwallowingMatchCuts?: boolean;
    /**
     * 'phase3' (default) = the Phase 3 behaviour exactly. 'phase4' = Director-solver integration: the Director is given the spatial contract (affordances.ts), hero words are validated against the speech
     * (emphasis.ts), the solver may adapt size in the requested zone (ADAPT_FLOOR), and a hero collision demotes the weaker hero instead of removing an event (repair.ts).
     */
    directorSolver?: 'phase3' | 'phase4';
    /** Phase 4.8 (M2): the declared observation error budget (speakerGeometry.ts). Default DEFAULT_OBSERVATION_BUDGET; null = none (the Phase 4.4-4.7 geometry). */
    observationBudget?: ObservationBudget | null;
    /** Phase 4.8 (M4): condensed fit face for a hero word too wide at its readability floor. Default true. */
    fitHeroFace?: boolean;
    /** Phase 4.8 (M4): relocate before accepting a block below the readability floor, in every solver mode (was adaptive-only). Default true. */
    relocateBeforeFloor?: boolean;
    /** Phase 4.9 (default ON, authorized): the readability contract for EVERY exported line, solver and legacy presets alike. An event below the floor is first handed to the readable running line (its words kept), a fill line is
     *  bisected; legacy presets size supporting lines to their floor. false = the Phase 4.8 behaviour (recorded exceptions shipped). */
    readabilityFloor?: boolean;
    /** Phase 4.9 (default ON, authorized): the final guard. Anything still below the floor after the readable fallbacks -> the kinetic treatment is refused for this video and the readable template path runs. */
    refuseBelowFloor?: boolean;
    /** Phase 5.15 (G3, default OFF = the motion choices exactly as before; the Kinetic V2 pipeline stage turns it on): context-driven, Director-preserving motion in the playbook solver */
    motionVariety?: boolean;
  };
};

export type ProductionKineticReport = {
  ok: boolean;
  /** why there is no spec when `ok` is false */
  failure?: string;
  planSource: 'director' | 'fallback';
  planReason?: string;
  planPartial: boolean;
  provenance: Record<string, EventProvenance>;
  rejected: RejectedEvent[];
  decisions: SolverDecision[];
  decisionSummary: DecisionSummary;
  coverage: Omit<CoverageReport, 'perWord'> & {missingWords: string[]};
  coverageFill: {added: number; droppedMatchCuts: CoverageFillResult['droppedMatchCuts']};
  guardrailViolations: Violation[];
  /** words crossing the face while entering / exiting: measured, not blocked (guardrails.ts) */
  faceTransit: number;
  speakerBox: {note: string; measured: boolean; zoomSamples: number; /** Phase 4.8: the declared (NOT measured) observation error budget in force */ observationBudget?: ObservationBudget | null};
  /** Phase 5: whether a person matte informed the solve (absent = none offered) */
  matte?: {used: boolean; note: string; alphaAreaFrac?: number; gridSamples?: number};
  threeD: {allowed: boolean; replaced: string[]};
  events: number;
  words: number;
  notes: string[];
  /** Phase 4 only */
  phase4?: {affordances: ShotAffordances; emphasis: EmphasisReport; repairs: {demoted: string[]; removed: string[]; passes: number}};
};

const MAX_REPAIR_PASSES = 8;
const MAX_REPAIR_PASSES_P4 = 4;

export type ProductionKineticResult = {
  spec: RenderSpec | null;
  report: ProductionKineticReport;
  /** what the solver was given (for scoring and debugging; never serialised into the blueprint) */
  debug?: {plan: KineticPlan; scene: ShotScene; words: KineticWord[]};
};

const emptySummary = (): DecisionSummary => summarizeDecisions([]);

/** 3D extruded presets are replaced by flat type when not allowed; every replacement is a decision. */
export function gateThreeD(plan: KineticPlan, allow: boolean): {plan: KineticPlan; replaced: string[]; decisions: SolverDecision[]} {
  if (allow) return {plan, replaced: [], decisions: []};
  const replaced: string[] = [];
  const decisions: SolverDecision[] = [];
  const events = plan.events.map(e => {
    if (!e.preset.startsWith('hero.extruded')) return e;
    replaced.push(e.id);
    decisions.push({eventId: e.id, stage: 'accept', kind: 'replaced', field: 'preset', requested: e.preset, produced: 'type.words', code: 'replaced.three_d_gated', reason: '3D extruded type is not enabled for production renders (not verified on the render farm)', constraint: 'hard'});
    return {...e, preset: 'type.words' as const, regionHint: e.regionHint === 'behindSignature' || e.regionHint === 'stackOverCutout' ? e.regionHint : 'auto' as const};
  });
  return {plan: replaced.length ? {...plan, events} : plan, replaced, decisions};
}

export async function buildProductionKinetic(input: ProductionKineticInput): Promise<ProductionKineticResult> {
  const notes: string[] = [];
  const fps = input.fps;
  const base = (over: Partial<ProductionKineticReport>): ProductionKineticReport => ({
    ok: false, planSource: 'fallback', planPartial: false, provenance: {}, rejected: [], decisions: [], decisionSummary: emptySummary(),
    coverage: {words: 0, lockup: 0, gapCaption: 0, missing: 0, coveredFraction: 1, byWhy: {}, missingWords: []}, coverageFill: {added: 0, droppedMatchCuts: []},
    guardrailViolations: [], faceTransit: 0, speakerBox: {note: 'none', measured: false, zoomSamples: 0}, threeD: {allowed: Boolean(input.policy?.allowThreeD), replaced: []}, events: 0, words: 0, notes, ...over,
  });
  if (!(fps > 0) || !(input.width > 0) || !(input.height > 0) || !(input.durationSec > 0)) return {spec: null, report: base({failure: 'invalid_geometry_or_duration'})};

  const words: KineticWord[] = toKineticWords(input.captionWords.map(w => ({text: w.text, start: w.start, end: w.end})), fps);
  if (words.length === 0) return {spec: null, report: base({failure: 'no_words'})};
  const durationFrames = Math.max(Math.ceil(input.durationSec * fps), words[words.length - 1]!.endFrame + 1);
  const shot: KineticShot = {id: 'shot-0', startFrame: 0, endFrame: durationFrames};
  const shots = [shot];

  // speaker: source fractions -> composition fractions (cover crop), then the punch-in zoom frame by frame
  let measuredBox: Box | null = null;
  let speakerNote = 'no_speaker_box';
  let track: Array<{frame: number; box: Box}> = [];
  let crownSoft = 0;
  const budget = input.policy?.observationBudget === undefined ? DEFAULT_OBSERVATION_BUDGET : input.policy.observationBudget;
  if (input.speaker) {
    // Phase 4.4: one shared, renderer-aligned geometry (speakerGeometry.ts): crop with the vertical extent unclipped, then the renderer's zoom for EVERY frame
    const g = resolveSpeakerGeometry({box: input.speaker.box, source: input.speaker.source, srcW: input.speaker.srcW, srcH: input.speaker.srcH, width: input.width, height: input.height, ...(input.speaker.objectPosition ? {objectPosition: input.speaker.objectPosition} : {}), zoomTriggers: input.zoomTriggers ?? [], zoomEnabled: input.zoomEnabled !== false, fps, durationFrames, observationBudget: budget, ...(input.speaker.motion ? {motion: input.speaker.motion} : {})});
    measuredBox = g.box;
    speakerNote = g.note;
    track = g.track;
    crownSoft = g.crownSoft;
  }
  // Phase 5: a matte is used only with a measured box (the box and face keep-out stay the measured ones; the matte adds occlusion + area). Without one, the no-matte scene exactly as before.
  const useMatte = Boolean(input.matte && measuredBox && input.matte.grid.samples.length > 0 && Number.isFinite(input.matte.alphaAreaFrac));
  const scene: ShotScene = useMatte
    ? buildScene({
      shotId: shot.id, subjectBox: measuredBox, noMatte: false, grid: input.matte!.grid, alphaAreaFrac: input.matte!.alphaAreaFrac, ...(track.length ? {boxTrack: track} : {}), ...(crownSoft ? {crownSoft} : {}),
      luminance: input.plate?.luminance, ...(input.plate?.color ? {plateColor: input.plate.color} : {}), width: input.width, height: input.height,
    })
    : buildScene({
      shotId: shot.id, noMatte: true, ...(measuredBox ? {speakerBox: measuredBox} : {}), ...(track.length ? {boxTrack: track} : {}), ...(crownSoft ? {crownSoft} : {}),
      luminance: input.plate?.luminance, ...(input.plate?.color ? {plateColor: input.plate.color} : {}), width: input.width, height: input.height,
    });
  const matteReport: ProductionKineticReport['matte'] = input.matte
    ? useMatte
      ? {used: true, note: 'rvm_matte', alphaAreaFrac: Math.round(input.matte.alphaAreaFrac * 1000) / 1000, gridSamples: input.matte.grid.samples.length}
      : {used: false, note: measuredBox ? 'matte_empty' : 'matte_ignored_no_measured_box'}
    : undefined;
  const scenes = {[shot.id]: scene};
  const speakerReport = {note: speakerNote, measured: Boolean(measuredBox), zoomSamples: track.length, observationBudget: budget};

  const brand = input.brand ?? (input.identity ? identityToBrand(input.identity) : brandConfigSchema.parse({}));
  const allowThreeD = Boolean(input.policy?.allowThreeD);
  try {
    const phase4 = input.policy?.directorSolver === 'phase4';
    const affordances = phase4 ? shotAffordances({scene, width: input.width, height: input.height, fps, zooms: input.zoomEnabled === false ? [] : (input.zoomTriggers ?? [])}) : null;
    const resolved = await runKineticDirector({words, shots, scenes, brand, call: input.director, fps, allowThreeD, ...(input.richDirectorInput ? {richInput: true} : {}), ...(affordances ? {spatial: {[shot.id]: affordanceBlock(affordances, sceneBehindEligibility(scene), scene.alphaAreaFrac)}, nearestRange: true} : {})});
    const gated = gateThreeD(resolved.plan, allowThreeD);
    let plan = gated.plan;
    const emphasis = phase4 ? validateEmphasis(plan, words, fps) : null;
    if (emphasis) plan = emphasis.plan;
    const split = phase4 ? splitOversizedEvents(plan, words, MAX_BLOCK_WORDS) : null;
    if (split) plan = split.plan;
    const provenance: Record<string, EventProvenance> = {...(resolved.provenance ?? {})};
    let fill: CoverageFillResult | null = null;
    if (input.policy?.coverAllWords !== false) {
      fill = withCoverageFill(plan, words, shots, fps, {...(input.policy?.keepSwallowingMatchCuts ? {keepSwallowingMatchCuts: true} : {})});
      plan = fill.plan;
      Object.assign(provenance, fill.provenance);
      for (const d of fill.droppedMatchCuts) delete provenance[d.eventId];
    }
    const cameras = {[shot.id]: new StaticCamera().track(shot)};
    const depth = new SubjectBandDepth();
    // Solve, verify, and repair: an event the verifier objects to (e.g. two heroes active together: density is enforced by the solver per event but windows can still collide once holds and trims
    // are applied) is removed and its words fall to the coverage fill; at most MAX_REPAIR_PASSES passes, one event per pass. Anything left standing is reported and fails the stage (the template path runs).
    const repairDecisions: SolverDecision[] = [];
    const solveOnce = () => solveLayout({plan, words, shots, scenes, cameras, depth, brand, ...(input.identity ? {identity: input.identity} : {}), width: input.width, height: input.height, fps, seed: input.seed ?? 1, planSource: resolved.source, ...(input.policy?.coverAllWords !== false ? {captionShortWords: true} : {}), ...(phase4 ? {adapt: true} : {}), faceFrames: faceFramesOn, ...(input.policy?.fitHeroFace !== false ? {fitHeroFace: true} : {}), ...(input.policy?.relocateBeforeFloor !== false ? {relocateBeforeFloor: true} : {}), ...(floorOn ? {readableLegacy: true} : {}), ...(input.policy?.motionVariety ? {motionVariety: true} : {})});
    // Phase 4.2.1: the per-frame face behaviour of the solver (`faceFrames`) is OFF for the first solve of every job, so a composition the verifier already accepts is byte-identical to before. It is switched on
    // (and stays on) only when a solve produces a face-keepout violation, and the plan is solved again. Deterministic; at most one extra solve per switch.
    let faceFramesOn = false;
    const floorOn = input.policy?.readabilityFloor !== false;
    const floorViolations = (sp: RenderSpec): Violation[] => (floorOn ? subFloorEvents(sp).map(eventId => ({eventId, rule: 'readability-floor', detail: 'a line rests below 0.96 x its readability floor'} as Violation)) : []);
    // Final freeze: payoff words of events handed to the running line keep their accent there (runningAccent.ts); applied BEFORE verification, so the verifier checks the final colours.
    const carriedAccents = new Map<number, string>();
    let carry: {applied: CarriedAccent[]; keptWhite: CarriedAccent[]} = {applied: [], keptWhite: []};
    const withCarry = (s: ReturnType<typeof solveOnce>): ReturnType<typeof solveOnce> => {
      if (carriedAccents.size === 0) return s;
      const r = carryPayoffAccents(s.spec, carriedAccents, words, scenes);
      carry = {applied: r.applied, keptWhite: r.keptWhite};
      return r.spec === s.spec ? s : {...s, spec: r.spec};
    };
    const solveVerified = () => {
      let s = withCarry(solveOnce());
      let v = verifyRenderSpec(s.spec, {scenes, depth, shots, cameras, words, plan});
      if (!faceFramesOn && v.some(x => x.rule === 'face-keepout')) { faceFramesOn = true; s = withCarry(solveOnce()); v = verifyRenderSpec(s.spec, {scenes, depth, shots, cameras, words, plan}); }
      return {solved: s, violations: [...v, ...floorViolations(s.spec)]};
    };
    let {solved, violations} = solveVerified();
    const repairs = {demoted: [] as string[], removed: [] as string[], passes: 0};
    // Phase 4.2 ladder for a coverage-fill line that cannot be placed clear of the face: removing it is no repair (the fill recreates the same line from the same uncovered words), so (1) it is BISECTED
    // (a shorter window and a smaller block clear the keep-out where the long run cannot; halves first because one-word runs at speech pace fall under the solver's 8-frame density rule), recorded as
    // `adjusted.fill_split`; (2) a one-word run that still hits the face is unresolvable: it stays reported as a violation, the stage fails explicitly and the production fallback (template path, which
    // keeps every word) runs; (3) if after the ladder any spoken word is undrawn, the stage fails the same way. A word is never drawn over the face and never silently dropped. Bounded: each pass adds cuts.
    const splitAfter = new Set<number>();
    let ladderUsed = false;
    const faceFill = (v: Violation) => (v.rule === 'face-keepout' || v.rule === 'readability-floor') && /^cov-\d+-\d+(\.[ab])?$/.test(v.eventId);
    for (let pass = 0; pass < (phase4 ? MAX_REPAIR_PASSES_P4 : MAX_REPAIR_PASSES) && violations.length > 0; pass += 1) {
      const splitIds = [...new Set(violations.filter(faceFill).map(v => v.eventId.replace(/\.[ab]$/, '')))].filter(id => { const e = plan.events.find(x => x.id === id); return Boolean(e) && e!.wordRange[1] > e!.wordRange[0]; });
      if (splitIds.length > 0 && input.policy?.coverAllWords !== false) {
        for (const id of splitIds) {
          const e = plan.events.find(x => x.id === id)!;
          const mid = Math.floor((e.wordRange[0] + e.wordRange[1]) / 2);
          splitAfter.add(mid);
          delete provenance[id];
          repairDecisions.push({eventId: id, stage: 'accept', kind: 'adjusted', field: 'event', requested: `fill run of words ${e.wordRange[0]}-${e.wordRange[1]}`, produced: `two fill runs, cut after word ${mid}`, code: 'adjusted.fill_split', reason: 'the fill run cannot be placed clear of the face keep-out for its whole window: bisected (shorter window, smaller block) so no word is drawn over the face and none is dropped', constraint: 'hard'});
        }
        ladderUsed = true;
        plan = {...plan, events: plan.events.filter(e => !splitIds.includes(e.id))};
        const refill = withCoverageFill(plan, words, shots, fps, {splitAfterIdx: splitAfter, ...(input.policy?.keepSwallowingMatchCuts ? {keepSwallowingMatchCuts: true} : {})});
        plan = refill.plan;
        Object.assign(provenance, refill.provenance);
        if (fill) fill = {...fill, added: [...fill.added.filter(a => plan.events.some(e => e.id === a.id)), ...refill.added.filter(a => !fill!.added.some(b => b.id === a.id))]};
        repairs.passes += 1;
        ({solved, violations} = solveVerified());
        continue;
      }
      // a one-word fill run on the face is unresolvable here (removing it only recreates it): leave it reported, and repair the remaining objections only
      const actionable = violations.filter(v => !faceFill(v));
      if (actionable.length === 0) break;
      // Phase 4.9: a Director / legacy-preset event that cannot hold its readability floor is handed to the READABLE running line (the coverage fill redraws its words): step 4 of the fallback hierarchy
      const floorIds = [...new Set(actionable.filter(v => v.rule === 'readability-floor').map(v => v.eventId.replace(/\.[a-z]$/, '')))].filter(id => plan.events.some(e => e.id === id));
      if (floorIds.length > 0) {
        for (const id of floorIds) {
          // the payoff word(s) this event drew in its accent (read from the solve that failed the floor), carried onto the running line
          const payoff = new Map<number, string>();
          for (const e of solved.spec.events) if (e.id === id || e.id.startsWith(`${id}.`)) for (const [i, c] of payoffAccents(e, words)) payoff.set(i, c);
          for (const [i, c] of payoff) carriedAccents.set(i, c);
          const keep = [...payoff.keys()].map(i => words[i]?.text).filter(Boolean).join(' ');
          repairDecisions.push({eventId: id, stage: 'accept', kind: 'replaced', field: 'event', requested: 'event as planned', produced: keep ? `the readable running line (every word kept; payoff "${keep}" keeps its accent only if the line has an outline / glow, else white)` : 'the readable running line (every word kept)', code: 'replaced.below_floor_to_running_line', reason: 'no font, composition or placement holds this event at its readability floor', constraint: 'hard'}); delete provenance[id]; }
        plan = {...plan, events: plan.events.filter(e => !floorIds.includes(e.id))};
        if (input.policy?.coverAllWords !== false) { const refill = withCoverageFill(plan, words, shots, fps, {splitAfterIdx: splitAfter, ...(input.policy?.keepSwallowingMatchCuts ? {keepSwallowingMatchCuts: true} : {})}); plan = refill.plan; Object.assign(provenance, refill.provenance); if (fill) fill = {...fill, added: [...fill.added.filter(a => plan.events.some(e => e.id === a.id)), ...refill.added.filter(a => !fill!.added.some(b => b.id === a.id))]}; }
        repairs.passes += 1;
        ({solved, violations} = solveVerified());
        continue;
      }
      if (phase4) {
        const r = repairViolations(plan, actionable, words);
        if (r.demoted.length + r.removed.length === 0) break;
        plan = r.plan; repairDecisions.push(...r.decisions); repairs.demoted.push(...r.demoted); repairs.removed.push(...r.removed); repairs.passes += 1;
        for (const id of r.removed) delete provenance[id];
      } else {
      const bad = new Set(actionable.map(v => v.eventId.replace(/\.[ab]$/, '')));
      const planIds = new Set(plan.events.map(e => e.id));
      // one event per pass: a collision chain (A over B over C) is usually fixed by removing one link, and removing every reported event would discard valid Director events
      const removable = [...bad].filter(id => planIds.has(id)).slice(0, 1);
      if (removable.length === 0) break;
      for (const id of removable) {
        const why = violations.filter(v => v.eventId.replace(/\.[ab]$/, '') === id).map(v => v.rule).join(',');
        repairDecisions.push({eventId: id, stage: 'accept', kind: 'dropped', field: 'event', requested: 'event as planned', produced: 'removed (its words fall to the quiet running line)', code: 'dropped.guardrail_violation', reason: `the verifier rejected the solved event (${why})`, constraint: 'hard'});
        delete provenance[id];
      }
      plan = {...plan, events: plan.events.filter(e => !removable.includes(e.id))};
      }
      if (input.policy?.coverAllWords !== false) {
        const refill = withCoverageFill(plan, words, shots, fps, {splitAfterIdx: splitAfter, ...(input.policy?.keepSwallowingMatchCuts ? {keepSwallowingMatchCuts: true} : {})});
        plan = refill.plan;
        Object.assign(provenance, refill.provenance);
        if (fill) fill = {...fill, added: [...fill.added.filter(a => plan.events.some(e => e.id === a.id)), ...refill.added.filter(a => !fill!.added.some(b => b.id === a.id))]};
      }
      ({solved, violations} = solveVerified());
    }
    const {spec: raw, report: solve} = solved;
    const spec = renderSpecSchema.parse(raw);
    if (input.policy?.refuseBelowFloor !== false) {
      const sub = subFloorEvents(spec);
      if (sub.length > 0) return {spec: null, report: base({failure: `below_readability_floor: ${sub.slice(0, 4).join(',')}`, speakerBox: speakerReport, ...(matteReport ? {matte: matteReport} : {})})};
    }
    if (ladderUsed && input.policy?.coverAllWords !== false) {
      const left = wordCoverage(spec, words).perWord.filter(w => w.kind === 'missing');
      if (left.length > 0) violations = [...violations, {eventId: 'coverage', rule: 'transcript-fidelity', detail: `${left.length} spoken word(s) undrawn after the face-safe fill repair (${left.slice(0, 4).map(w => w.text).join(' ')}): the production fallback keeps every word`}];
    }
    const decisions: SolverDecision[] = [
      ...(resolved.decisions ?? []), ...gated.decisions, ...(emphasis?.decisions ?? []), ...(split?.decisions ?? []), ...repairDecisions,
      // final freeze: the carried payoff accents, logged with the number that proves the rule (one coloured word per payoff, only with an existing outline / glow)
      ...carry.applied.map(a => ({eventId: a.eventId, stage: 'accept' as const, kind: 'adjusted' as const, field: 'color', requested: 'running line (white)', produced: `payoff "${a.text}" in its accent ${a.color}`, code: 'adjusted.running_line_payoff_accent', reason: 'the event this word came from was handed to the running line; its payoff keeps the Director\'s accent', constraint: 'discretionary' as const})),
      ...carry.keptWhite.map(a => ({eventId: a.eventId, stage: 'accept' as const, kind: 'refused' as const, field: 'color', requested: `payoff "${a.text}" in its accent ${a.color}`, produced: 'payoff in white', code: 'refused.running_line_accent_no_separation', reason: 'this running line has no outline or glow (only the soft drop shadow): an accent fill is not legible enough on a light background, white is kept', constraint: 'hard' as const})),
      ...(fill?.droppedMatchCuts ?? []).map(d => ({eventId: d.eventId, stage: 'accept' as const, kind: 'dropped' as const, field: 'event', requested: `match cut over words ${d.wordRange[0]}-${d.wordRange[1]}`, produced: 'removed', code: 'dropped.match_cut_swallows_words', reason: `the full-frame card draws ${d.drawn} of the ${d.owned} words it owns, and nothing else can be drawn during a card`, constraint: 'hard' as const})),
      ...(solve.decisions ?? []),
    ];
    const cov = wordCoverage(spec, words);
    const {perWord, ...covRest} = cov;
    const missingWords = perWord.filter(p => p.kind === 'missing').map(p => p.text);
    const transit = faceTransitWords(spec, scenes).length;
    if (resolved.source === 'fallback') notes.push(`director_fallback:${resolved.reason ?? 'unknown'}`);
    return {
      spec,
      debug: {plan, scene, words},
      report: base({
        ok: true, planSource: resolved.source, ...(resolved.reason ? {planReason: resolved.reason} : {}), planPartial: Boolean(resolved.partial),
        provenance, rejected: resolved.rejected ?? [], decisions, decisionSummary: summarizeDecisions(decisions),
        coverage: {...covRest, missingWords}, coverageFill: {added: fill?.added.length ?? 0, droppedMatchCuts: fill?.droppedMatchCuts ?? []},
        guardrailViolations: violations, faceTransit: transit, speakerBox: speakerReport, ...(matteReport ? {matte: matteReport} : {}), threeD: {allowed: allowThreeD, replaced: gated.replaced}, events: spec.events.length, words: words.length,
        ...(phase4 && affordances && emphasis ? {phase4: {affordances, emphasis: emphasis.report, repairs}} : {}),
      }),
    };
  } catch (err) {
    return {spec: null, report: base({failure: `stage_error: ${err instanceof Error ? err.message : String(err)}`, speakerBox: speakerReport, ...(matteReport ? {matte: matteReport} : {})})};
  }
}

/** exported events (solver and legacy presets) with a line resting below 0.96 x its readability floor */
function subFloorEvents(spec: RenderSpec): string[] {
  const out: string[] = [];
  // every exported event, legacy block presets (zone null) included
  // a match cut is a full-frame paper card with its own typography (verifyRenderSpec already treats it as full-frame by design): its placeholder line metadata is not a line placed over the plate, so the floor does not apply to it
  for (const e of spec.events) { if (e.presetResolved === 'type.matchCut') continue; for (const l of e.lines) { const [f] = restingRange(e, l); const px = l.fontPx * interpolateKeyframes(e.keyframes, f).scale; const floor = (l.role === 'hero' || l.role === 'punch' ? HERO_FLOOR_FRAC : SUPPORT_FLOOR_FRAC) * spec.height; if (px < 0.96 * floor - 0.5) { out.push(e.id); break; } } }
  return out;
}

/** Source-fraction box -> composition fraction box (exported for the pipeline hook's report and the tests). */
export {sourceBoxToComposition};
