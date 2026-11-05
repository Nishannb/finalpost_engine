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
  | 'plan_empty';

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
export function decideSubjectStageGate(input: SubjectStageGateInput): SubjectStageGate {
  if (!input.polishPath) return {state: 'not_applicable', warning: null};
  if (!input.flag) return {state: 'off', warning: 'polish_subject_stage:off'};
  if (!input.motionTemplates) return skip('no_motion_templates');
  if (!input.motionPresent) return skip('no_motion');
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
};

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

  const payload = toSubjectStageBlueprint(plan, matteUrl);
  return {
    active: true,
    payload,
    plan,
    matteUrl,
    source,
    matteSec,
    warnings: ['polish_subject_stage:on', ...matteWarnings, `subject_stage:plan:${plan.spans.length}_spans:${plan.accents.length}_accents:${retimed}_retimed`, ...plan.warnings],
  };
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
