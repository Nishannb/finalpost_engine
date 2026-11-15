/**
 * SUBJECT STAGE analyze stage (Phase 4): the gate, the whole-run person matte, the plan, and the exclusions that make the stage the only thing editing "behind" the presenter.
 *
 * analyzeVideo calls `runSubjectStage` once, right before the Phase C person-matte block, only inside the polish profile. Everything here is pure or takes its I/O as injected deps (the matte deps are the
 * SAME `PersonMatteDeps` the kinetic-era stage uses), so the flag matrix is testable with a mocked matte and no render.
 *
 *   gate     POLISH_SUBJECT_STAGE (default off) + polish profile + the motion-templates path (the kinetic-led outer gate) + a talking-head skill (faceless / explainer / newsroom disable it)
 *   matte    a provided cutout URL (full coverage) | a keyable backdrop (chroma, full length) | RVM over the WHOLE output run: mps / cuda always (<= 120 s), CPU only for <= 45 s. No usable matte = the style is
 *            OFF and the edit is exactly what it was (fail closed).
 *   plan     planSubjectStage over the real transcript sentences, accents timed from the caption words
 *   result   `payload` for `blueprint.subjectStage`; the caller then clears the elements that would fight the stage (`applySubjectStageExclusions`) and keeps kinetic-led off for the run.
 */
import {obtainPersonMatte, collectMatteNeeds, type PersonMatteDeps, type PersonMatteOutcome} from './personMatteStage.ts';
import type {KeepSegmentLike} from '../media/personMatte.ts';
import {sentencesOfWords} from '../stages/broll/visualBackend/planVisualBackendBeats.ts';
import {deriveKeywords} from '../stages/subjectStage/stageIntent.ts';
import {planSubjectStage, toSubjectStageBlueprint, type StageKeywordInput, type SubjectStageBlueprint, type SubjectStagePlan} from '../stages/subjectStage/planSubjectStage.ts';
import {SUBJECT_STAGE_DISABLED_UNDER, SUBJECT_STAGE_MATTE, SUBJECT_STAGE_PLANNER} from '../stages/subjectStage/subjectStageConfig.ts';
import {adoptCutaways, designSubjectStage, type CutawayCandidate, type EditorialHint, type EditorialText, type StageGeometry, type StagePlate} from '../stages/subjectStage/stageDesign.ts';
import {compileDirection, proposeDeterministicQuotes, validateSubjectStageDirection, type CatalogAsset} from '../stages/subjectStage/stageDirection.ts';
import {reliableIntervals} from '../stages/subjectStage/stageProtection.ts';
import {compositionMatte, type SourceAlphaFrames} from '../stages/kinetic/matteMap.ts';
import type {AlphaGrid} from '../stages/kinetic/scene.ts';
import type {ZoomTriggerLite} from '../stages/kinetic/zoomTrack.ts';
import {resolveMeasuredSpeakerBox, type SpeakerBoxSource} from '../stages/kinetic/speakerBox.ts';
import {faceKeepOutOf} from '../stages/kinetic/scene.ts';

export type SubjectStageSkipReason =
  | 'no_motion_templates'
  | 'no_motion'
  | 'skill_faceless'
  | 'skill_explainer'
  | 'skill_newsroom'
  | 'too_short'
  | 'no_matte_backend'
  | 'cpu_over_45s'
  | 'too_long'
  | 'matte_unavailable'
  | 'plan_empty'
  /** Phase 5.27C: the stage designed every span and placed nothing (every card restrained, no cutaway): it steps aside so the edit keeps its captions and frame insets */
  | 'nothing_placed';

export type SubjectStageGateInput = {
  /** EffectiveFlags.subjectStage (POLISH_SUBJECT_STAGE by default) */
  flag: boolean;
  /** PRODUCT_EDIT_PROFILE === 'polish' */
  polishPath: boolean;
  /** EffectiveFlags.motionTemplates (POLISH_MOTION_TEMPLATES by default; the kinetic-led outer gate) */
  motionTemplates: boolean;
  /** the motion stage produced a result (the kinetic-led gate needs it too) */
  motionPresent: boolean;
  /** the skill FLAGS (EffectiveFlags facelessDoc / explainerSkill / newsroomMg): any one disables the style, whether or not that lane then ran */
  skillFlags: {faceless: boolean; explainer: boolean; newsroom: boolean};
  durationSec: number;
  rvmConfigured: boolean;
  /** env.RVM_DEVICE as configured (auto | cuda | mps | cpu | unset) */
  rvmDevice: string | undefined;
  /** the backdrop is chroma-keyable (detectSpeakerCutout) */
  keyable: boolean;
  /** the client handed a transparent talking-head asset (`subjectCutoutUrl`) */
  providedCutout: boolean;
  /**
   * Phase 5.23 (lib/editingPipeline.ts): whether the Subject Stage pipeline owns this job. `false` = another pipeline (or none) owns it: the stage is OFF whatever the flag says.
   * Absent = the pre-5.23 behaviour (the flag decides).
   */
  owned?: boolean;
  /**
   * Phase 5.23: the job SELECTED the Subject Stage pipeline (style `subject_stage`). The selection replaces the kinetic-led outer gate (motion templates + a motion result), which
   * was only a proxy for "this polish job may restyle the speaker": a selected job has motion templates off on purpose. Every other precondition still applies.
   */
  selected?: boolean;
};

export type SubjectStageGate =
  | {state: 'not_applicable'; warning: null}
  | {state: 'off'; warning: 'polish_subject_stage:off'}
  | {state: 'skipped'; reason: SubjectStageSkipReason; warning: string}
  | {state: 'candidate'; /** whether an RVM whole-run extraction is allowed (configured + device / duration rule) */ rvmAllowed: boolean; route: 'provided' | 'chroma' | 'rvm'; warning: null};

/** An explicit GPU device (mps / cuda) earns the whole-run RVM; auto / cpu / unknown is treated as CPU (the same conservative reading as the kinetic matte budget). */
export const isFullRvmDevice = (device: string | undefined): boolean => (SUBJECT_STAGE_MATTE.fullDeviceValues as readonly string[]).includes((device ?? '').trim().toLowerCase());

const skip = (reason: SubjectStageSkipReason): SubjectStageGate => ({state: 'skipped', reason, warning: `polish_subject_stage:skipped:${reason}`});

/** Pure gate. `candidate` = every precondition holds and a matte route exists; the real answer still depends on the matte actually being produced. */
/**
 * Phase 5.29C: ask the Director for the Subject Stage field only when the Subject Stage can own the run (the same polish / flag / ownership conditions decideSubjectStageGate checks
 * first). Otherwise the Director request stays byte-for-byte unchanged.
 */
export function subjectStageDirectorRequested(input: {polishPath: boolean; flag: boolean; owned: boolean}): boolean {
  return input.polishPath && input.flag && input.owned;
}

export function decideSubjectStageGate(input: SubjectStageGateInput): SubjectStageGate {
  if (!input.polishPath) return {state: 'not_applicable', warning: null};
  if (input.owned === false || !input.flag) return {state: 'off', warning: 'polish_subject_stage:off'};
  if (!input.selected) {
    if (!input.motionTemplates) return skip('no_motion_templates');
    if (!input.motionPresent) return skip('no_motion');
  }
  for (const lane of SUBJECT_STAGE_DISABLED_UNDER) if (input.skillFlags[lane]) return skip(`skill_${lane}` as SubjectStageSkipReason);
  if (!(input.durationSec >= SUBJECT_STAGE_PLANNER.minVideoSec)) return skip('too_short');
  const rvmAllowed = input.rvmConfigured && input.durationSec <= SUBJECT_STAGE_MATTE.maxVideoSec && (isFullRvmDevice(input.rvmDevice) || input.durationSec <= SUBJECT_STAGE_MATTE.cpuMaxVideoSec);
  if (input.providedCutout) return {state: 'candidate', rvmAllowed: false, route: 'provided', warning: null};
  if (input.keyable) return {state: 'candidate', rvmAllowed, route: 'chroma', warning: null};
  if (!input.rvmConfigured) return skip('no_matte_backend');
  if (input.durationSec > SUBJECT_STAGE_MATTE.maxVideoSec) return skip('too_long');
  if (!rvmAllowed) return skip('cpu_over_45s');
  return {state: 'candidate', rvmAllowed: true, route: 'rvm', warning: null};
}

// ------------------------------------------------------------------------------------------------ plan from the real transcript
type CaptionWordLike = {text: string; start: number; end: number};
const norm = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * The plan over the real sentences (`sentencesOfWords`: sentence ends + >0.9 s pauses). Accent keywords are the planner's own spoken keywords, RE-TIMED to the matching caption word's real start when that
 * word is found in the sentence (an exact word match), so accents land on the spoken word, not on a character-position estimate.
 */
export function planFromCaptionWords(input: {captionWords: readonly CaptionWordLike[]; durationSec: number; topicBreaks?: readonly number[]}): {plan: SubjectStagePlan; retimed: number} {
  const sentences = sentencesOfWords(input.captionWords);
  const keywords: StageKeywordInput[] = [];
  let retimed = 0;
  for (const sentence of sentences) {
    for (const hit of deriveKeywords(sentence)) {
      const first = norm(hit.text.split(/\s+/)[0] ?? '');
      const word = first ? sentence.words.find(w => norm(w.text) === first) : undefined;
      if (word) retimed += 1;
      keywords.push({at: word ? word.start : hit.at, text: hit.text});
    }
  }
  const plan = planSubjectStage({
    sentences: sentences.map(s => ({start: s.start, end: s.end, text: s.text})),
    keywords,
    durationSec: input.durationSec,
    ...(input.topicBreaks ? {topicBreaks: input.topicBreaks} : {}),
  });
  return {plan, retimed};
}

// ------------------------------------------------------------------------------------------------ the stage
export type RunSubjectStageInput = SubjectStageGateInput & {
  captionWords: readonly CaptionWordLike[];
  keepSegments: readonly KeepSegmentLike[];
  activeSourcePath: string;
  /** the client's transparent asset URL, when provided */
  providedCutoutUrl?: string;
  chromaPath: string;
  rvmPath: string;
  /** the SAME deps the kinetic-era person matte stage uses (RVM runs through the shared cache + the shared RVM slot) */
  deps: PersonMatteDeps;
  /**
   * Phase 5.24: what the editorial design needs (absent = no design: the Phase 3 placeholder payload, exactly as before). The speaker box is the measured occupancy box in SOURCE fractions,
   * mapped into the composition exactly like the Kinetic V2 scene (cover crop + object position); the plate is the footage's measured colour / brightness.
   */
  design?: {
    /** the occupancy speaker box (SOURCE fractions) and where it came from: a `fallback` box is a default, never treated as measured */
    speaker: {box: unknown; source: SpeakerBoxSource};
    srcW: number;
    srcH: number;
    outW: number;
    outH: number;
    objectPosition: {x: number; y: number};
    plate: StagePlate | null;
    /** explicit editorial decisions (a hand-authored CONTROLLED test plan today; none in production) */
    editorial?: readonly EditorialHint[];
    /**
     * Phase 5.25: the editorial decision contract (stageDirection.ts). A direction (a Director answer one day; a labelled CONTRACT FIXTURE in tests) replaces the lexical planner's spans with
     * spans compiled from its VALIDATED chapters / quotes / cutaways. Absent = the planner's spans + the deterministic QUOTE proposer (validated the same way; never titles or cutaways).
     */
    direction?: unknown;
    /** assets a direction may request as cutaways (id, url, tags); relevance is checked against the tags */
    assets?: readonly CatalogAsset[];
    /** Phase 5.25: decode the stage's own cutout into source alpha frames (media/alphaGrid.ts); absent / null = box-based protection */
    decodeAlpha?: (path: string, srcW: number, srcH: number) => Promise<SourceAlphaFrames | null>;
    /** the speaker's zooms (the foreground punches in with her; the matte grid follows them) */
    zoomTriggers?: readonly ZoomTriggerLite[];
    fps?: number;
  };
};

/**
 * Phase 5.24: the subject geometry in COMPOSITION fractions (the Kinetic V2 coordinate system). The box is the measured speaker box through the cover crop (`resolveMeasuredSpeakerBox`); the
 * face keep-out is its top 42 % (`faceKeepOutOf`, as the Kinetic scene); the alpha area is the matte's mean alpha (source frame) rescaled to the visible crop, capped at 1 (a crop can only make
 * the person a LARGER share of the frame, so this errs toward refusing behind placement). Unmeasured inputs stay null: no subject-aware placement, never a guess.
 */
export function subjectGeometry(input: {speakerBox: unknown; speakerSource: SpeakerBoxSource; srcW: number; srcH: number; outW: number; outH: number; objectPosition: {x: number; y: number}; meanAlpha: number | null}): StageGeometry & {note: string} {
  const measured = resolveMeasuredSpeakerBox({box: input.speakerBox, source: input.speakerSource, geometry: {srcW: input.srcW, srcH: input.srcH, outW: input.outW, outH: input.outH, objectPosition: input.objectPosition}});
  const s = Math.max(input.outW / input.srcW, input.outH / input.srcH);
  const visibleSrcFrac = Math.min(1, input.outW / (input.srcW * s)) * Math.min(1, input.outH / (input.srcH * s));
  const alpha = input.meanAlpha === null || !Number.isFinite(input.meanAlpha) ? null : Math.min(1, input.meanAlpha / Math.max(1e-6, visibleSrcFrac));
  return {
    width: input.outW, height: input.outH,
    subjectBox: measured.box, faceKeepOut: measured.box ? faceKeepOutOf(measured.box) : null,
    alphaAreaFrac: alpha === null ? null : Math.round(alpha * 10000) / 10000,
    note: measured.note,
  };
}

export type SubjectStageResult = {
  /** true = `payload` is set and the caller must apply the exclusions */
  active: boolean;
  payload?: SubjectStageBlueprint;
  plan?: SubjectStagePlan;
  matteUrl?: string;
  source?: 'provided' | PersonMatteOutcome['source'];
  /** matted seconds RVM was asked for (the kinetic budget is not used by the stage) */
  matteSec: number;
  skipReason?: SubjectStageSkipReason;
  warnings: string[];
  /** Phase 5.25: cutaways the editorial contract requested and validated (the picture ownership adopts them first) */
  requestedCutaways?: CutawayCandidate[];
  /** Phase 5.27C: the final status of every PROPOSED editorial item (direction runs only) */
  editorialStatus?: EditorialItemStatus[];
};

/**
 * Phase 5.27C: one proposed editorial item and what finally happened to it. `placed` = compiled and designed (drawn); rendering itself is verified outside the pipeline (the render probe).
 */
export type EditorialItemStatus = {
  kind: 'title' | 'quote' | 'cutaway' | 'omission' | 'direction';
  id: string;
  state: 'omitted' | 'rejected_by_validator' | 'suppressed_by_compiler' | 'restrained_by_design' | 'placed' | 'requested';
  reason?: string;
  start?: number;
  end?: number;
  /** Phase 5.29D-PRE: set on a quote that came from the built-in (deterministic) proposer because the direction had no usable quote */
  origin?: 'builtin';
};

/** Gate -> plan -> whole-run matte -> payload. Never throws; every failure is a warning and `active: false` (the edit then proceeds exactly as it would without the style). */
export async function runSubjectStage(input: RunSubjectStageInput): Promise<SubjectStageResult> {
  const gate = decideSubjectStageGate(input);
  if (gate.state === 'not_applicable') return {active: false, matteSec: 0, warnings: []};
  if (gate.state === 'off') return {active: false, matteSec: 0, warnings: [gate.warning]};
  if (gate.state === 'skipped') return {active: false, matteSec: 0, skipReason: gate.reason, warnings: [gate.warning]};
  const warnings: string[] = [];
  const skipped = (reason: SubjectStageSkipReason, extra: string[] = []): SubjectStageResult => ({active: false, matteSec: 0, skipReason: reason, warnings: [...extra, `polish_subject_stage:skipped:${reason}`]});

  // plan first: it is free, and an empty plan must not cost a whole-run matte
  const {plan, retimed} = planFromCaptionWords({captionWords: input.captionWords, durationSec: input.durationSec});
  if (plan.spans.length === 0) return skipped('plan_empty', plan.warnings);

  // matte: provided asset | chroma (full length) | RVM over the whole output run (only where the device / duration rule allows it)
  let matteUrl: string | undefined;
  let source: SubjectStageResult['source'];
  let matteSec = 0;
  const matteWarnings: string[] = [];
  if (gate.route === 'provided') {
    matteUrl = input.providedCutoutUrl;
    source = 'provided';
    matteWarnings.push('subject_stage:matte:provided');
  } else {
    const outcome = await obtainPersonMatte({
      needs: collectMatteNeeds({stageRun: {start: 0, end: input.durationSec}}),
      keyable: input.keyable,
      force: false,
      keepSegments: input.keepSegments,
      activeSourcePath: input.activeSourcePath,
      chromaPath: input.chromaPath,
      rvmPath: input.rvmPath,
      budgetSec: input.durationSec + 1, // the whole padded run: never trimmed
      deps: {...input.deps, rvmConfigured: input.deps.rvmConfigured && gate.rvmAllowed},
    });
    matteWarnings.push(...outcome.warnings, `subject_stage:matte:${outcome.source}`);
    if (outcome.videoUrl) {
      matteUrl = outcome.videoUrl;
      source = outcome.source;
      matteSec = outcome.source === 'rvm' ? outcome.matteSec : 0;
    }
  }
  if (!matteUrl) return skipped('matte_unavailable', [...plan.warnings, ...matteWarnings]);

  let payload = toSubjectStageBlueprint(plan, matteUrl);
  const designWarnings: string[] = [];
  let requestedCutaways: CutawayCandidate[] = [];
  let editorialStatus: EditorialItemStatus[] | undefined;
  if (input.design) {
    const fps = input.design.fps ?? 30;
    // the matte's own coverage: the local whole-run file the route produced (a provided cutout has no local file: unmeasured, never behind)
    const localMatte = source === 'rvm' ? input.rvmPath : source === 'chroma' ? input.chromaPath : null;
    const meanAlpha = localMatte ? await input.deps.probeAlpha(localMatte).catch(() => null) : null;
    const {speaker, ...frame} = input.design;
    // Phase 5.25: the person matte in COMPOSITION space (the Kinetic V2 grid), for the speaker protection, the measured area and the reliable intervals
    let grid: AlphaGrid | null = null;
    let gridArea: number | null = null;
    if (localMatte && input.design.decodeAlpha) {
      const alpha = await input.design.decodeAlpha(localMatte, frame.srcW, frame.srcH).catch(() => null);
      if (alpha) {
        const comp = compositionMatte(alpha, {
          srcW: frame.srcW, srcH: frame.srcH, outW: frame.outW, outH: frame.outH, objectPosition: frame.objectPosition,
          zoomTriggers: input.design.zoomTriggers ?? [], zoomEnabled: true, keepSegments: input.keepSegments, fps, durationFrames: Math.ceil(input.durationSec * fps),
        });
        if (comp.samples > 0) { grid = comp.grid; gridArea = comp.alphaAreaFrac; }
        designWarnings.push(`subject_stage:design:matte_grid:samples=${comp.samples}:missing=${comp.missing}:empty=${comp.empty}`);
      } else designWarnings.push('subject_stage:design:matte_grid:undecodable');
    }
    const geo0 = subjectGeometry({...frame, speakerBox: speaker.box, speakerSource: speaker.source, meanAlpha});
    // the composition-space area is the better measurement when it exists (same quantity the Kinetic V2 0.55 rule reads)
    const geo = gridArea !== null ? {...geo0, alphaAreaFrac: Math.round(gridArea * 10000) / 10000} : geo0;
    const sentences = sentencesOfWords(input.captionWords).map(s => ({start: s.start, end: s.end, text: s.text}));
    // Phase 5.25: editorial meaning comes from the decision contract, never from the design step
    const words = input.captionWords.map(w => ({text: w.text, start: w.start, end: w.end}));
    const validateOpts = {assets: input.design.assets ?? [], durationSec: input.durationSec};
    let directionGiven = input.design.direction !== undefined;
    // the fallback is for DIRECTOR answers (source "director", set by the analyzeVideo adapter); hand-authored contract fixtures keep their exact decisions
    const fromDirector = (input.design.direction as {source?: unknown} | undefined)?.source === 'director';
    let validated = validateSubjectStageDirection(input.design.direction ?? proposeDeterministicQuotes(words), words, validateOpts);
    for (const r of validated.rejected) designWarnings.push(`subject_stage:direction:rejected:${r.kind}:${r.id}:${r.code}`);
    // Phase 5.29D-PRE: the built-in (deterministic) quotes are the fallback whenever a direction yields no usable quote. Never mixed: Director quotes OR built-in quotes.
    //   malformed direction (whole envelope rejected): nothing of it is accepted -> exactly the no-direction path (built-in quotes, no titles)
    //   valid direction, zero accepted quotes (none given / all rejected): its validated chapters stay; the quote set is the built-in one, each marked `origin: 'builtin'`
    if (fromDirector && validated.rejected.some(r => r.kind === 'direction')) {
      designWarnings.push('subject_stage:quotes:builtin_fallback:malformed_direction');
      directionGiven = false;
      validated = validateSubjectStageDirection(proposeDeterministicQuotes(words), words, validateOpts);
      for (const r of validated.rejected) designWarnings.push(`subject_stage:direction:rejected:${r.kind}:${r.id}:${r.code}`); // as the no-direction path reports them
    } else if (fromDirector && validated.quotes.length === 0) {
      const builtIn = validateSubjectStageDirection(proposeDeterministicQuotes(words), words, validateOpts);
      const why = validated.rejected.some(r => r.kind === 'quote') ? 'director_quotes_rejected' : 'director_quotes_empty';
      designWarnings.push(`subject_stage:quotes:builtin_fallback:${why}:builtin=${builtIn.quotes.length}`);
      for (const r of builtIn.rejected) designWarnings.push(`subject_stage:quotes:builtin:rejected:${r.kind}:${r.id}:${r.code}`);
      validated = {...validated, quotes: builtIn.quotes.map(q => ({...q, origin: 'builtin' as const}))};
    }
    designWarnings.push(`subject_stage:direction:${validated.source}:chapters=${validated.chapters.filter(c => c.title).length}:quotes=${validated.quotes.length}:cutaways=${validated.cutaways.length}`);
    let compiledOutcomes: ReturnType<typeof compileDirection>['outcomes'] | null = null;
    // Phase 5.27D.1: which accepted item each compiled span shows (design-only; the blueprint payload spans are unchanged)
    let spanRefs: ReadonlyArray<ReturnType<typeof compileDirection>['spans'][number]['ref']> | null = null;
    if (directionGiven && validated.source !== 'deterministic') {
      const compiled = compileDirection(validated, input.durationSec);
      compiledOutcomes = compiled.outcomes;
      spanRefs = compiled.spans.map(sp => sp.ref);
      for (const o of compiled.outcomes) if (o.state === 'suppressed') designWarnings.push(`subject_stage:direction:suppressed:${o.kind}:${o.id}:${o.reason}:${o.start}-${o.end}`);
      payload = {...payload, spans: compiled.spans.map(sp => ({start: sp.start, end: sp.end, stage: sp.stage, enter: 'hard_cut' as const, motion: {kind: 'none' as const}})), accents: []};
      requestedCutaways = compiled.cutaways.map(c => ({start: c.start, end: c.end, assetUrl: c.asset.url, mediaKind: c.asset.mediaKind, keyword: c.asset.tags, validated: true}));
    }
    const text: EditorialText = {titles: validated.chapters.flatMap((c, index) => (c.title ? [{start: c.start, end: c.end, text: c.title.text, ref: {id: c.id, index}}] : [])), quotes: validated.quotes.map((q, index) => ({start: q.start, end: q.end, text: q.text, ...(q.attribution ? {attribution: q.attribution} : {}), ref: {id: q.id, index}, ...(q.origin === 'builtin' ? {source: 'deterministic' as const} : {})})), source: validated.source};
    const designSpans = spanRefs ? payload.spans.map((sp, i) => (spanRefs![i] ? {...sp, ref: spanRefs![i]!} : sp)) : payload.spans;
    const d = designSubjectStage({spans: designSpans, sentences, words: input.captionWords, geo, plate: input.design.plate, text, grid, fps, ...(input.design.editorial ? {editorial: input.design.editorial} : {})});
    const intervals = reliableIntervals(grid, fps);
    // a neutral span compiled from a direction is deliberate restraint: it draws nothing (no legacy S4 room dim without an editorial reason); planner spans keep their Phase 3 rendering
    const compiledNeutral = input.design.direction !== undefined && validated.source !== 'deterministic';
    payload = {
      ...payload,
      spans: payload.spans.map((span, i) => (d.designs[i] ? {...span, design: d.designs[i]!} : compiledNeutral && span.stage === 'S4' ? {...span, design: {kind: 'restrained' as const, reason: 'neutral_span'}} : span)),
      look: d.look,
      ...(geo.subjectBox && geo.faceKeepOut ? {subject: {box: geo.subjectBox, faceKeepOut: geo.faceKeepOut, alphaAreaFrac: geo.alphaAreaFrac}} : {}),
      ...(grid ? {matteIntervals: intervals} : {}),
    };
    designWarnings.push(`subject_stage:design:geometry:${geo.subjectBox ? 'measured' : 'none'}:alpha=${geo.alphaAreaFrac ?? 'unmeasured'}:${geo.note}`, ...d.warnings);
    if (compiledOutcomes) {
      editorialStatus = editorialStatusOf({validated, outcomes: compiledOutcomes, spans: payload.spans, requested: requestedCutaways});
      for (const st of editorialStatus) if (st.state === 'restrained_by_design') designWarnings.push(`subject_stage:direction:restrained:${st.kind}:${st.id}:${st.reason}`);
    }
    // Phase 5.27C: a designed stage that places nothing steps aside (the edit keeps its ordinary captions, frame insets and other lanes); the person protection is unchanged
    if (subjectStageDrawnWindows(payload) !== null && subjectStageDrawnWindows(payload)!.length === 0 && requestedCutaways.length === 0) {
      return {active: false, matteSec, skipReason: 'nothing_placed', ...(editorialStatus ? {editorialStatus} : {}), warnings: [...matteWarnings, ...plan.warnings, ...designWarnings, 'polish_subject_stage:skipped:nothing_placed']};
    }
  }
  return {
    active: true,
    payload,
    plan,
    matteUrl,
    requestedCutaways,
    ...(editorialStatus ? {editorialStatus} : {}),
    source,
    matteSec,
    warnings: ['polish_subject_stage:on', ...matteWarnings, `subject_stage:plan:${plan.spans.length}_spans:${plan.accents.length}_accents:${retimed}_retimed`, ...plan.warnings, ...designWarnings],
  };
}

// ------------------------------------------------------------------------------------------------ Phase 5.27C: what the stage actually draws, and the status of every proposed item
/**
 * The windows in which the stage DRAWS something: spans whose design is not `restrained`. Null = the legacy planner path (a span without a design, or keyword accents, renders as in Phase 3),
 * where the old whole-run ownership applies unchanged.
 */
export function subjectStageDrawnWindows(payload: {spans: ReadonlyArray<{start: number; end: number; design?: {kind: string} | null}>; accents?: readonly unknown[] | null}): Window[] | null {
  if ((payload.accents?.length ?? 0) > 0 || payload.spans.some(sp => !sp.design)) return null;
  return payload.spans.filter(sp => sp.design!.kind !== 'restrained').map(sp => ({start: sp.start, end: sp.end}));
}
const overlapsAny = (w: Window, windows: readonly Window[]) => windows.some(o => w.start < o.end && o.start < w.end);
function mergeWindows(windows: readonly Window[]): Window[] {
  const out: Window[] = [];
  for (const w of [...windows].sort((a, b) => a.start - b.start)) { const last = out[out.length - 1]; if (last && w.start <= last.end + 1e-6) last.end = Math.max(last.end, w.end); else out.push({start: w.start, end: w.end}); }
  return out;
}

/** the final status of every PROPOSED item: validator -> compiler -> design (a direction run) */
export function editorialStatusOf(input: {
  validated: ReturnType<typeof validateSubjectStageDirection>;
  outcomes: ReturnType<typeof compileDirection>['outcomes'];
  spans: ReadonlyArray<{start: number; end: number; stage: string; design?: {kind: string; reason?: string} | null}>;
  requested: readonly CutawayCandidate[];
}): EditorialItemStatus[] {
  const out: EditorialItemStatus[] = [];
  for (const o of input.validated.omissions) out.push({kind: 'omission', id: `${o.kind}:${o.id}`, state: 'omitted', reason: o.reason});
  // Phase 5.27D: a whole-envelope rejection is reported as `direction` (it was mislabelled `cutaway`)
  for (const r of input.validated.rejected) out.push({kind: r.kind === 'chapter' || r.kind === 'title' ? 'title' : r.kind === 'quote' ? 'quote' : r.kind === 'direction' ? 'direction' : 'cutaway', id: r.id, state: 'rejected_by_validator', reason: r.code});
  for (const o of input.outcomes) {
    if (o.state === 'suppressed') { out.push({kind: o.kind, id: o.id, state: 'suppressed_by_compiler', reason: `${o.reason}: ${o.detail}`, start: o.start, end: o.end}); continue; }
    const span = input.spans.find(sp => Math.abs(sp.start - o.start) < 2e-3 && sp.stage === (o.kind === 'title' ? 'S1' : 'S2'));
    const design = span?.design;
    const builtin = o.kind === 'quote' && input.validated.quotes.some(q => q.id === o.id && q.origin === 'builtin') ? {origin: 'builtin' as const} : {};
    if (!design || design.kind === 'restrained') out.push({kind: o.kind, id: o.id, state: 'restrained_by_design', reason: design?.reason ?? 'no_design', start: o.start, end: o.end, ...builtin});
    else out.push({kind: o.kind, id: o.id, state: 'placed', reason: design.kind, start: o.start, end: o.end, ...builtin});
  }
  for (const c of input.validated.cutaways) out.push({kind: 'cutaway', id: c.id, state: 'requested', reason: 'adoption decided by the picture ownership (neutral span rules)', start: c.start, end: c.end});
  void input.requested;
  return out;
}

// ------------------------------------------------------------------------------------------------ exclusions
type Window = {start: number; end: number};
export type SubjectStageExclusionsInput<B extends Window, D extends Window, I extends Window, O extends {layout: string}> = {
  behind: readonly B[];
  opening: Window | null | undefined;
  depth: readonly D[];
  insetReveals: readonly I[];
  overlays: readonly O[];
};
export type SubjectStageExclusions<B extends Window, D extends Window, I extends Window, O extends {layout: string}> = {
  behind: B[];
  openingDropped: boolean;
  depth: D[];
  insetReveals: I[];
  overlays: O[];
  dropped: {behind: B[]; depth: D[]; insetReveals: I[]; cutouts: O[]};
};

/**
 * What the stage takes over: text BEHIND the speaker (incl. the opening's), depth overlays, inset reveals and the cutout layout all draw "behind her" or reshape the frame and would fight the stage.
 * Everything else (captions, hook, zoom, other overlays) is untouched. Pure; only call it when the stage is ACTIVE (a skipped / off stage must leave every list as it was).
 */
export function applySubjectStageExclusions<B extends Window, D extends Window, I extends Window, O extends {layout: string}>(input: SubjectStageExclusionsInput<B, D, I, O>): SubjectStageExclusions<B, D, I, O> {
  const cutouts = input.overlays.filter(overlay => overlay.layout === 'cutout');
  return {
    behind: [],
    openingDropped: Boolean(input.opening),
    depth: [],
    insetReveals: [],
    overlays: input.overlays.filter(overlay => overlay.layout !== 'cutout'),
    dropped: {behind: [...input.behind], depth: [...input.depth], insetReveals: [...input.insetReveals], cutouts},
  };
}

/** The kinetic-led inputs the stage forces: no kinetic-led style, no segmentation, no existing cutout to reuse (so no hero is drawn behind her and no `subjectForeground` competes with the stage's). */
export function kineticInputsUnderStage<C>(stageActive: boolean, current: {kineticLed: boolean; segmentationConfigured: boolean; cutout: C}): {kineticLed: boolean; segmentationConfigured: boolean; cutout: C | Record<string, never>} {
  if (!stageActive) return current;
  return {kineticLed: false, segmentationConfigured: false, cutout: {}};
}

// ------------------------------------------------------------------------------------------------ text ownership (Phase 5.23)
type OwnedOverlayLike = {layout: string; mediaKind: string; intent?: string | undefined};
/** Overlays that carry words (text plates, lockups, stats, banners, chips, bubbles). The same test as the Kinetic V2 ownership guard (kineticEngineStage.ts isTextOverlay), a low-level helper. */
const isWordOverlay = (o: OwnedOverlayLike): boolean => o.mediaKind === 'text' || ['lockup', 'stat', 'banner', 'chip', 'bubble'].includes(o.layout);

/**
 * Phase 5.23: while the Subject Stage is ACTIVE it owns every word on screen. Its own text (S1 plate headlines, S2 / S5 quote cards, S3 result rows, S4 keyword accents) is in
 * `blueprint.subjectStage` and untouched. Everything else that prints words goes:
 *   - ordinary running captions: muted for the whole run (`captionMuteRanges`), so no sentence caption is drawn beneath a stage treatment;
 *   - the hook title and the art-directed opening (the first stage is the opening), motion graphics (incl. filler-word clips' centred words), semantic emphasis,
 *     behind-subject text and text overlays.
 * Pictures (B-roll, stills) are kept. Pure; call ONLY when the stage is active (a skipped stage keeps the ordinary captions: the job is then a plain polish edit, reported as degraded).
 */
export function subjectStageTextOwnership<O extends OwnedOverlayLike, M, S, B, P>(parts: {
  durationSec: number;
  hookTitle: string;
  openingTreatment: P | null | undefined;
  motionGraphics: readonly M[] | null | undefined;
  semanticEmphasis: readonly S[] | null | undefined;
  behindSubjectTexts: readonly B[] | null | undefined;
  overlays: readonly O[] | null | undefined;
  /** Phase 5.27C: where the stage draws (`subjectStageDrawnWindows`). Given = ordinary captions are muted ONLY inside these windows and run normally elsewhere; absent / null = the whole run (as before). */
  drawnWindows?: readonly Window[] | null;
}): {captionMuteRanges: Array<{startSec: number; endSec: number}>; hookTitle: string; openingTreatment: null; motionGraphics: M[]; semanticEmphasis: S[]; behindSubjectTexts: B[]; overlays: O[]; warnings: string[]} {
  const overlays = parts.overlays ?? [];
  const textOverlays = overlays.filter(isWordOverlay);
  const counts: Array<[string, number]> = [
    ['hook_title', parts.hookTitle ? 1 : 0],
    ['opening_treatment', parts.openingTreatment ? 1 : 0],
    ['motion_graphics', parts.motionGraphics?.length ?? 0],
    ['semantic_emphasis', parts.semanticEmphasis?.length ?? 0],
    ['behind_subject_texts', parts.behindSubjectTexts?.length ?? 0],
    ['text_overlays', textOverlays.length],
  ];
  return {
    captionMuteRanges: parts.drawnWindows ? mergeWindows(parts.drawnWindows).map(w => ({startSec: w.start, endSec: w.end})) : [{startSec: 0, endSec: Math.max(0, parts.durationSec)}],
    hookTitle: '',
    openingTreatment: null,
    motionGraphics: [],
    semanticEmphasis: [],
    behindSubjectTexts: [],
    overlays: overlays.filter(o => !isWordOverlay(o)),
    warnings: [parts.drawnWindows ? `subject_stage:captions_owned:windows=${mergeWindows(parts.drawnWindows).length}` : 'subject_stage:captions_owned', ...counts.filter(([, n]) => n > 0).map(([k, n]) => `subject_stage:text_removed:${k}=${n}`)],
  };
}

// ------------------------------------------------------------------------------------------------ picture ownership (Phase 5.24)
type PictureClip = {start: number; end: number; assetUrl: string; credit?: string; keyword?: string};
type PictureOverlay = {start: number; end: number; layout: string; mediaKind: string; assetUrl?: string; intent?: string | undefined};
/** Overlay layouts that take over the picture (full frame / a split / a composite / a cutout plate). */
export const COVERING_OVERLAY_LAYOUTS: ReadonlySet<string> = new Set(['cutaway', 'fullscreen', 'full_screen', 'split', 'composite', 'cutout']);

/**
 * Phase 5.24: while the Subject Stage is ACTIVE it owns every picture that could cover the person. Free B-roll clips and picture overlays become CANDIDATES; only those the stage adopts
 * into its own plan (`adoptCutaways`: inside a neutral span, 1-3.5 s, spaced) are drawn, as the stage's explicit `cutaways`. Everything else is dropped, and so are the layers that reshape the
 * speaker (media containers, frame insets: the matte would no longer register with her). Pure; text overlays are already gone (subjectStageTextOwnership).
 */
export function subjectStagePictureOwnership<C extends PictureClip, O extends PictureOverlay, M, F>(input: {
  spans: Parameters<typeof adoptCutaways>[0];
  clips: readonly C[];
  overlays: readonly O[];
  mediaContainers?: readonly M[] | null;
  frameInsets?: readonly F[] | null;
  /** Phase 5.25: the caption words (relevance: a clip's keyword must be spoken around it) */
  words?: ReadonlyArray<{text: string; start: number; end: number}>;
  /** Phase 5.25: explicit cutaways the editorial contract already validated (adopted first, subject to the neutral-span rules) */
  requested?: readonly CutawayCandidate[];
  /** Phase 5.27C: where the stage draws. Given = a frame inset that does not overlap any drawn window (nor an adopted cutaway) is KEPT; absent / null = every inset is removed (as before). */
  drawnWindows?: readonly Window[] | null;
}): {cutaways: ReturnType<typeof adoptCutaways>['cutaways']; clips: C[]; overlays: O[]; mediaContainers: M[]; frameInsets: F[]; warnings: string[]} {
  const kindOf = (url: string): 'video' | 'image' => (/\.(jpe?g|png|webp|gif)(\?|#|$)/i.test(url) ? 'image' : 'video');
  const candidates: CutawayCandidate[] = [
    ...(input.requested ?? []).map(c => ({...c, validated: true})),
    ...input.clips.filter(c => c.assetUrl).map(c => ({start: c.start, end: c.end, assetUrl: c.assetUrl, mediaKind: kindOf(c.assetUrl), ...(c.credit ? {credit: c.credit} : {}), ...(c.keyword ? {keyword: c.keyword} : {})})),
    ...input.overlays.filter(o => o.assetUrl && COVERING_OVERLAY_LAYOUTS.has(o.layout)).map(o => ({start: o.start, end: o.end, assetUrl: o.assetUrl!, mediaKind: o.mediaKind === 'image' ? ('image' as const) : kindOf(o.assetUrl!)})),
  ];
  const {cutaways, rejected} = adoptCutaways(input.spans, candidates, input.words ?? []);
  const pictures = input.overlays.filter(o => Boolean(o.assetUrl));
  const warnings = [`subject_stage:pictures:adopted=${cutaways.length},dropped=${candidates.length - cutaways.length + (pictures.length - input.overlays.filter(o => o.assetUrl && COVERING_OVERLAY_LAYOUTS.has(o.layout)).length)}`];
  for (const r of rejected) warnings.push(`subject_stage:cutaway_rejected:${r.start.toFixed(2)}:${r.reason}`);
  if ((input.mediaContainers?.length ?? 0) > 0) warnings.push(`subject_stage:media_containers_removed:${input.mediaContainers!.length}`);
  const busy = input.drawnWindows ? [...input.drawnWindows, ...cutaways.map(c => ({start: c.start, end: c.end}))] : null;
  const keptInsets = busy ? (input.frameInsets ?? []).filter(f => !overlapsAny(f as unknown as Window, busy)) : [];
  const removedInsets = (input.frameInsets?.length ?? 0) - keptInsets.length;
  if (removedInsets > 0) warnings.push(`subject_stage:frame_insets_removed:${removedInsets}`);
  if (keptInsets.length > 0) warnings.push(`subject_stage:frame_insets_kept:${keptInsets.length}`);
  return {cutaways, clips: [], overlays: input.overlays.filter(o => !o.assetUrl), mediaContainers: [], frameInsets: keptInsets, warnings};
}
