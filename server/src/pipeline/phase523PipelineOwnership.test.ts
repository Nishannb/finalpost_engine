/**
 * Phase 5.23: two independent editing pipelines (Kinetic V2, Subject Stage), one owner per job; Subject Stage text ownership; Subject Stage compositing ownership.
 * Always run: no model, no network, no render. The analyze-level tests drive the SAME functions analyzeVideo calls, in the same order (pinned by the source checks at the end);
 * the full real-analyzeVideo run is eval/pipelineOwnership.e2e.test.ts (KINETIC_E2E=1).
 */
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

import {timelineBlueprintSchema} from '../../../remotion/src/blueprintSchema.ts';
import {captionsMutedAt} from '../../../remotion/src/lib/captionSplit.ts';
import {EditingPipelineError, editingPipelineWarning, pipelineFlagOverrides, pipelineOwns, resolveEditingPipeline, type EditingPipelineSelection} from '../lib/editingPipeline.ts';
import {EDIT_STYLE_IDS, buildEditStyleCatalog, resolveRequestedStyle, type EditStyleId} from '../lib/editStyles.ts';
import {effectiveFlagsFromEnv, type EffectiveFlags, type EffectiveFlagsEnv} from '../lib/effectiveFlags.ts';
import {resolveStyleRun, styleOutcome} from '../lib/styleRun.ts';
import * as M from '../stages/subjectStage/stageMotion.ts';
import {decideSubjectStageGate, subjectStageTextOwnership} from './subjectStageStage.ts';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');

/** Every risky flag ON server-wide: both pipelines' flags, motion templates, a GPU RVM. */
const ENV_ALL_ON = {
  ...effectiveFlagsEnvDefaults(),
  POLISH_KINETIC_ENGINE: true, POLISH_KINETIC_LED: true, POLISH_SUBJECT_STAGE: true, POLISH_MOTION_TEMPLATES: true, MOTION_GRAPHICS_ENABLED: true,
} as unknown as EffectiveFlagsEnv;
function effectiveFlagsEnvDefaults(): Record<string, unknown> {
  // effectiveFlagsFromEnv only reads the keys it knows; an empty object resolves every flag to its "off" reading
  return {};
}
const CONFIG = {enabled: true, availableOverride: '', orderOverride: '', engineFlags: true};

/**
 * The analyze-side ownership, exactly as analyzeVideo runs it: resolve once -> force the other pipeline's flags off -> the Kinetic V2 engine block condition -> the Subject Stage gate.
 * `motionPresent` = the motion stage produced a result (only reachable when motion graphics are on).
 */
function analyzeOwnership(input: {selected?: EditingPipelineSelection | string; flags: EffectiveFlags; polish?: boolean; durationSec?: number}) {
  const flags = {...input.flags};
  const polishPath = input.polish ?? flags.profile === 'polish';
  const pipeline = resolveEditingPipeline({selected: input.selected, polishPath, flags});
  Object.assign(flags, pipelineFlagOverrides(pipeline, flags));
  // the engine block's own (unchanged) condition: ownership arrives through the forced flags
  const kineticRuns = polishPath && flags.kineticEngine && flags.kineticLed;
  const gate = decideSubjectStageGate({
    flag: flags.subjectStage, polishPath, owned: pipelineOwns(pipeline, 'subject_stage'), selected: pipeline.source === 'selected' && pipelineOwns(pipeline, 'subject_stage'),
    motionTemplates: flags.motionTemplates, motionPresent: flags.motionGraphics, skillFlags: {faceless: flags.facelessDoc, explainer: flags.explainerSkill, newsroom: flags.newsroomMg},
    durationSec: input.durationSec ?? 20, rvmConfigured: true, rvmDevice: 'mps', keyable: false, providedCutout: false,
  });
  return {pipeline, flags, kineticRuns, subjectStageCandidate: gate.state === 'candidate', gate, warning: editingPipelineWarning(pipeline)};
}
const styled = (style: EditStyleId, env: EffectiveFlagsEnv = ENV_ALL_ON) => resolveStyleRun({style, engineFlags: true, envProfile: 'polish', env, envGeminiMaxRequests: 0});

describe('selection contract: the existing `style` field selects the pipeline (no second selector)', () => {
  it('`kinetic_v2` is an alias of the kinetic_typography style; `subject_stage` is an engine-only style, unavailable by default', () => {
    expect(resolveRequestedStyle('kinetic_v2', CONFIG)).toMatchObject({style: 'kinetic_typography', mode: 'full_edit', tier: 'pro'});
    expect(resolveRequestedStyle('kinetic_typography', CONFIG)).toMatchObject({style: 'kinetic_typography'});
    expect(resolveRequestedStyle('subject_stage', CONFIG)).toEqual({error: 'style_unavailable', style: 'subject_stage'});
    expect(resolveRequestedStyle('subject_stage', {...CONFIG, availableOverride: 'kinetic_typography,subject_stage'})).toMatchObject({style: 'subject_stage', mode: 'full_edit', tier: 'pro', degraded: false});
  });
  it('invalid selections fail clearly: unknown style ids are rejected at the request; an unknown pipeline value fails analyze before any stage', () => {
    expect(resolveRequestedStyle('subject-stage', CONFIG)).toEqual({error: 'unknown_style', style: 'subject-stage'});
    expect(resolveRequestedStyle('kinetic_v3', CONFIG)).toEqual({error: 'unknown_style', style: 'kinetic_v3'});
    expect(() => resolveEditingPipeline({selected: 'kinetic', polishPath: true, flags: effectiveFlagsFromEnv(ENV_ALL_ON, 'polish')})).toThrow(EditingPipelineError);
    expect(() => resolveEditingPipeline({selected: 'kinetic', polishPath: true, flags: effectiveFlagsFromEnv(ENV_ALL_ON, 'polish')})).toThrow(/Unknown editing pipeline "kinetic"/);
    expect(() => analyzeOwnership({selected: '', flags: effectiveFlagsFromEnv(ENV_ALL_ON, 'polish')})).toThrow(EditingPipelineError);
  });
  it('the app picker catalog is unchanged (Subject Stage is not listed)', () => {
    expect([...EDIT_STYLE_IDS]).toEqual(['basic_captions', 'ai_clean_cut', 'kinetic_typography', 'explainer']);
    expect(buildEditStyleCatalog({config: CONFIG, hasPro: true}).map(s => s.id)).toEqual(['basic_captions', 'ai_clean_cut', 'kinetic_typography', 'explainer']);
  });
  it('each style run names its pipeline; a degraded style (engine flags off) has none', () => {
    expect(styled('kinetic_typography').pipeline).toBe('kinetic_v2');
    expect(styled('subject_stage').pipeline).toBe('subject_stage');
    for (const style of ['basic_captions', 'ai_clean_cut', 'explainer'] as const) expect(styled(style).pipeline).toBe('none');
    const off = resolveStyleRun({style: 'subject_stage', engineFlags: false, envProfile: 'polish', env: ENV_ALL_ON, envGeminiMaxRequests: 0});
    expect(off).toMatchObject({styleApplied: 'ai_clean_cut', profile: 'cuts', pipeline: 'none', plannedReasons: ['engine_flags_off']});
    expect(styled('subject_stage').styleKey).toBe('style:subject_stage:v3');
  });
});

describe('pipeline routing (analyze-side ownership, every risky env flag ON)', () => {
  it('explicit Kinetic V2: the engine runs; Subject Stage is OFF although POLISH_SUBJECT_STAGE is on', () => {
    const run = styled('kinetic_typography');
    const r = analyzeOwnership({selected: run.pipeline, flags: run.flags});
    expect(r.pipeline).toEqual({id: 'kinetic_v2', source: 'selected'});
    expect(r.kineticRuns).toBe(true);
    expect(r.flags.subjectStage).toBe(false);
    expect(r.gate).toEqual({state: 'off', warning: 'polish_subject_stage:off'});
    expect(r.warning).toBe('editing_pipeline:kinetic_v2:selected');
  });
  it('explicit Subject Stage: the stage is a candidate; the Kinetic V2 engine AND the template Kinetic-Led path are off although their env flags are on', () => {
    const run = styled('subject_stage');
    expect(run.flags).toMatchObject({subjectStage: true, kineticEngine: false, kineticLed: false, motionTemplates: false, motionGraphics: false, explainerSkill: false, textualMg: false, facelessDoc: false, newsroomMg: false});
    const r = analyzeOwnership({selected: run.pipeline, flags: run.flags});
    expect(r.pipeline).toEqual({id: 'subject_stage', source: 'selected'});
    expect(r.kineticRuns).toBe(false);
    expect(r.subjectStageCandidate).toBe(true); // the selection replaces the kinetic-led outer gate (motion templates are off on purpose)
    expect(r.warning).toBe('editing_pipeline:subject_stage:selected');
    // even a hand-built flag set with the engine on cannot start Kinetic V2 under a Subject Stage selection
    const forced = analyzeOwnership({selected: 'subject_stage', flags: {...run.flags, kineticEngine: true, kineticLed: true}});
    expect(forced.kineticRuns).toBe(false);
    expect(forced.flags).toMatchObject({kineticEngine: false, kineticLed: false});
  });
  it('a Kinetic V2 selection cannot run Subject Stage even with the stage flag forced on', () => {
    const run = styled('kinetic_typography');
    const r = analyzeOwnership({selected: 'kinetic_v2', flags: {...run.flags, subjectStage: true}});
    expect(r.subjectStageCandidate).toBe(false);
    expect(r.flags.subjectStage).toBe(false);
  });
  it('the other styles (no pipeline) run neither, whatever the env says', () => {
    for (const style of ['ai_clean_cut', 'explainer', 'basic_captions'] as const) {
      const run = styled(style);
      const r = analyzeOwnership({selected: run.pipeline, flags: run.flags});
      expect(r.kineticRuns, style).toBe(false);
      expect(r.subjectStageCandidate, style).toBe(false);
      expect(r.warning, style).toBe('editing_pipeline:none:selected');
    }
  });
  it('missing selection keeps the env behaviour: nothing on = no pipeline and NO new warning; the stage alone keeps its old outer gate', () => {
    const none = analyzeOwnership({flags: effectiveFlagsFromEnv({} as EffectiveFlagsEnv, 'polish')});
    expect(none).toMatchObject({pipeline: {id: null, source: 'env'}, kineticRuns: false, subjectStageCandidate: false, warning: null});
    const stageOnly = effectiveFlagsFromEnv({POLISH_SUBJECT_STAGE: true, POLISH_MOTION_TEMPLATES: true, MOTION_GRAPHICS_ENABLED: true} as unknown as EffectiveFlagsEnv, 'polish');
    expect(analyzeOwnership({flags: stageOnly})).toMatchObject({pipeline: {id: 'subject_stage', source: 'env'}, subjectStageCandidate: true});
    // the pre-5.23 outer gate still applies on the env path (no selection): without motion templates the stage is skipped exactly as before
    expect(analyzeOwnership({flags: {...stageOnly, motionTemplates: false}}).gate).toEqual({state: 'skipped', reason: 'no_motion_templates', warning: 'polish_subject_stage:skipped:no_motion_templates'});
    // env Subject Stage keeps the template Kinetic-Led flag as it was (it yields to an ACTIVE stage through kineticInputsUnderStage, unchanged)
    expect(analyzeOwnership({flags: {...stageOnly, kineticLed: true}}).flags.kineticLed).toBe(true);
  });
  it('both pipeline flags on with no selection: exactly ONE pipeline (Kinetic V2) owns the job; Subject Stage is off for the whole run', () => {
    const r = analyzeOwnership({flags: effectiveFlagsFromEnv(ENV_ALL_ON, 'polish')});
    expect(r.pipeline).toEqual({id: 'kinetic_v2', source: 'env'});
    expect(r.kineticRuns).toBe(true);
    expect(r.subjectStageCandidate).toBe(false);
    expect(r.warning).toBe('editing_pipeline:kinetic_v2:env');
  });
  it('a selected Subject Stage that cannot get a matte is reported as degraded (never silently a different pipeline)', () => {
    const run = styled('subject_stage');
    expect(styleOutcome({run, warnings: ['polish_subject_stage:skipped:no_matte_backend'], matteConfigured: false})).toEqual({degraded: true, degradedReasons: ['subject_stage_skipped:no_matte_backend'], styleNotes: []});
    expect(styleOutcome({run, warnings: ['polish_subject_stage:on'], matteConfigured: true})).toEqual({degraded: false, degradedReasons: [], styleNotes: []});
  });
});

describe('text ownership', () => {
  const pictures = [{layout: 'cutaway', mediaKind: 'video', id: 'p'}, {layout: 'fullscreen', mediaKind: 'image', id: 'q'}];
  const texts = [{layout: 'lockup', mediaKind: 'text', id: 't1'}, {layout: 'stat', mediaKind: 'image', id: 't2'}, {layout: 'chip', mediaKind: 'image', id: 't3'}];
  it('Subject Stage: ordinary captions muted for the whole run, every other text lane cleared, pictures kept', () => {
    const owned = subjectStageTextOwnership({durationSec: 12.5, hookTitle: 'Hook', openingTreatment: {kind: 'x'}, motionGraphics: [1, 2], semanticEmphasis: [1], behindSubjectTexts: [1], overlays: [...pictures, ...texts]});
    expect(owned.captionMuteRanges).toEqual([{startSec: 0, endSec: 12.5}]);
    expect(owned).toMatchObject({hookTitle: '', openingTreatment: null, motionGraphics: [], semanticEmphasis: [], behindSubjectTexts: []});
    expect(owned.overlays.map(o => o.id)).toEqual(['p', 'q']);
    expect(owned.warnings).toEqual(['subject_stage:captions_owned', 'subject_stage:text_removed:hook_title=1', 'subject_stage:text_removed:opening_treatment=1', 'subject_stage:text_removed:motion_graphics=2', 'subject_stage:text_removed:semantic_emphasis=1', 'subject_stage:text_removed:behind_subject_texts=1', 'subject_stage:text_removed:text_overlays=3']);
  });
  it('the muted range hides the ordinary caption renderer on every frame (the renderer test the caption layer uses); no duplicate sentence captions under a stage', () => {
    const {captionMuteRanges} = subjectStageTextOwnership({durationSec: 6, hookTitle: '', openingTreatment: null, motionGraphics: [], semanticEmphasis: [], behindSubjectTexts: [], overlays: []});
    for (let f = 0; f < 6 * 30; f += 1) expect(captionsMutedAt(captionMuteRanges, f / 30), `frame ${f}`).toBe(true);
    const sv = read('../../../remotion/src/ShortVideo.tsx');
    expect(sv).toContain('captionsMutedAt(blueprint.captionMuteRanges, timeSec)');
    expect(sv).toContain('{!openingShowing ? (\n      <AbsoluteFill');
  });
  it('Subject Stage editorial text stays: the ownership never touches the stage payload, and an active stage renders its spans / accents', () => {
    const src = read('./analyzeVideo.ts');
    const branch = src.slice(src.indexOf('} else if (subjectStagePayload) {'), src.indexOf('const blueprint: TimelineBlueprint = {'));
    expect(branch).toContain('subjectStageTextOwnership(');
    expect(branch).not.toMatch(/subjectStagePayload\s*=/);
    expect(M.stageCompositing({matteUrl: 'https://cdn.test/m.webm', spans: [{start: 0, end: 4, stage: 'S1'}]}).active).toBe(true);
  });
  it('analyze wiring: captions muted for Kinetic V2 OR an active stage; the Kinetic V2 final text guard is unchanged and runs first; the stage guard only when no kinetic spec exists', () => {
    const src = read('./analyzeVideo.ts');
    expect(src).toContain('const muteRanges: MuteRange[] = subjectStagePayload ? (stageDrawn ? mergeMuteRanges(stageDrawn.map(w => ({startSec: w.start, endSec: w.end}))) : [{startSec: 0, endSec: timeline.outputDurationSec}]) : kineticEngineSpec ? [{startSec: 0, endSec: timeline.outputDurationSec}] :'); // Phase 5.27C: the stage mutes only where it draws; the Kinetic V2 branch is unchanged
    const kineticGuard = src.indexOf('const guard = kineticFinalTextGuard({hookTitle: broll.hookTitle, openingTreatment: openingSpec');
    const stageGuard = src.indexOf('} else if (subjectStagePayload) {');
    expect(kineticGuard).toBeGreaterThan(-1);
    expect(stageGuard).toBeGreaterThan(kineticGuard);
  });
});

describe('Subject Stage compositing ownership (the renderer contract, stageMotion twin)', () => {
  const S = (spans: M.InterruptionLike[], matteUrl = 'https://cdn.test/matte.webm') => ({matteUrl, spans});
  const valid = S([
    {start: 0, end: 1.4, stage: 'S1', enter: 'hard_cut', motion: {kind: 'none'}, asset: {text: 'Headline'}},
    {start: 1.4, end: 2.8, stage: 'S2', enter: 'hard_cut', motion: {kind: 'slow_push'}, asset: {text: 'Quote'}},
    {start: 2.8, end: 4.2, stage: 'S4', enter: 'hard_cut', motion: {kind: 'none'}},
    {start: 4.2, end: 6.0, stage: 'S5', enter: 'slide_up_front', motion: {kind: 'slide_up_front'}, asset: {text: 'Takeover'}},
  ]);
  const frames = (fn: (t: number) => void) => { for (let f = 0; f < 6 * 30; f += 1) fn(f / 30); };
  /** the visibility invariant: the person is on screen unless an authorised interruption covers the frame */
  const personVisible = (s: M.StageFrameState) => s.personForeground || !s.behindLayer;

  it('usable matte = an alpha container (.webm / .mov) by URL or bundled file; everything else is not a foreground', () => {
    for (const ok of ['https://cdn.test/a/matte.webm', 'https://cdn.test/m.mov?sig=1', 'staticFile:fg-base.webm', 'fg.webm', '/prefetch/x/fg.webm']) expect(M.usableMatteUrl(ok), ok).toBe(true);
    for (const bad of ['', '   ', 'https://cdn.test/matte.mp4', 'staticFile:source.mp4', 'not a url.webm', '//cdn/m.webm', 'https://', undefined, null, 42]) expect(M.usableMatteUrl(bad), String(bad)).toBe(false);
  });
  it('original footage, no matte: the stage is inactive; the footage is drawn on every frame and nothing of the stage is', () => {
    for (const stage of [undefined, S(valid.spans, ''), S(valid.spans, '  ')]) {
      expect(M.stageCompositing(stage).active).toBe(false);
      frames(t => expect(M.stageFrameState(stage, t)).toEqual({baseFootage: true, behindLayer: false, personForeground: false, roomDim: false, interruption: false}));
    }
    expect(M.stageCompositing(S(valid.spans, '')).reason).toBe('no_matte');
  });
  it('valid matte + foreground: active; the behind layer only ever draws with the person over it; the room dims under her in S2 / S4; the base footage is never hidden', () => {
    const c = M.stageCompositing(valid);
    expect(c).toEqual({active: true, foreground: {videoUrl: 'https://cdn.test/matte.webm', spans: [{start: 0, end: 6}]}});
    frames(t => {
      const s = M.stageFrameState(valid, t);
      expect(s.baseFootage).toBe(true);
      expect(s.behindLayer).toBe(s.personForeground);
      expect(personVisible(s) || s.interruption).toBe(true);
    });
    expect(M.stageFrameState(valid, 0.5).roomDim).toBe(false); // S1 replaces the room
    expect(M.stageFrameState(valid, 2.0).roomDim).toBe(true); // S2 behind-head card: valid behind-subject graphic, the person drawn over it
    expect(M.stageFrameState(valid, 2.0)).toMatchObject({behindLayer: true, personForeground: true, interruption: false});
  });
  it('invalid matte (no alpha container / malformed): inactive, the original footage alone', () => {
    for (const url of ['https://cdn.test/matte.mp4', 'staticFile:source.mp4', 'matte webm']) {
      expect(M.stageCompositing(S(valid.spans, url))).toEqual({active: false, reason: 'invalid_matte'});
      frames(t => expect(M.stageFrameState(S(valid.spans, url), t)).toMatchObject({behindLayer: false, personForeground: false, interruption: false}));
    }
  });
  it('missing / invalid foreground spans: inactive (no plate can draw without the person over it)', () => {
    expect(M.stageCompositing(S([]))).toEqual({active: false, reason: 'no_spans'});
    expect(M.stageCompositing(S([{start: 3, end: 1, stage: 'S1'}, {start: Number.NaN, end: 2, stage: 'S2'}]))).toEqual({active: false, reason: 'no_spans'});
    // a partial span set: outside the covered spans nothing of the stage draws, the footage shows the person
    const partial = S([{start: 1, end: 3, stage: 'S2', enter: 'hard_cut', motion: {kind: 'slow_push'}, asset: {text: 'q'}}]);
    expect(M.stageFrameState(partial, 0.5)).toMatchObject({behindLayer: false, personForeground: false});
    expect(M.stageFrameState(partial, 2)).toMatchObject({behindLayer: true, personForeground: true});
    expect(M.stageFrameState(partial, 4)).toMatchObject({behindLayer: false, personForeground: false});
  });
  it('an explicit valid S5 interruption is the only state that covers the person', () => {
    expect(M.validInterruption(valid.spans[3])).toBe(true);
    frames(t => expect(M.stageFrameState(valid, t).interruption).toBe(t >= 4.2 - 1e-9));
  });
  it('missing / invalid interruption data is not drawn: wrong enter, wrong motion, too short, over the cap, no content, not S5', () => {
    const base5 = valid.spans[3]!;
    const bad: M.InterruptionLike[] = [
      {...base5, enter: 'hard_cut'},
      {...base5, motion: {kind: 'none'}},
      {...base5, motion: undefined},
      {...base5, start: 4.2, end: 5.5}, // 1.3 s < slide + min hold (1.8 s)
      {...base5, start: 2, end: 6}, // 4 s > the 3 s cap
      {...base5, asset: undefined},
      {...base5, asset: {text: '   ', lines: [' ']}},
      {...base5, stage: 'S4'},
      {...base5, end: Number.NaN},
    ];
    for (const span of bad) {
      expect(M.validInterruption(span), JSON.stringify(span)).toBe(false);
      const stage = S([...valid.spans.slice(0, 3), span].filter(s => Number.isFinite(s.end)));
      frames(t => {
        const s = M.stageFrameState(stage, t);
        expect(s.interruption).toBe(false);
        expect(personVisible(s)).toBe(true); // the subject remains visible whenever no valid interruption is active
      });
    }
  });
  it('the renderer uses exactly these primitives: never hides the base footage, mounts the stage only when active, gates the behind layer per frame and the takeover on validInterruption', () => {
    const sv = read('../../../remotion/src/ShortVideo.tsx');
    expect(sv).not.toContain('hideBaseUnderMatte');
    expect(sv).toContain('const stageComp = stageCompositing(subjectStage);');
    expect(sv).toContain('const stageOnNow = stageForegroundAt(stageComp, timeSec);');
    expect(sv).toContain('<SubjectStageTrack stage={activeStage} foregroundOn={stageOnNow}');
    expect(sv).toContain('<SubjectStageFront stage={activeStage} />');
    const track = read('../../../remotion/src/components/SubjectStage/SubjectStageTrack.tsx');
    expect(track).toContain('if (!stage || !foregroundOn) return null;');
    const front = read('../../../remotion/src/components/SubjectStage/SubjectStageFront.tsx');
    expect(front).toContain("span.stage === 'S5' && validInterruption(span) ? slideUpFrontState(");
  });
  it('one owner of the person layer: a Subject Stage payload next to a Kinetic blueprint is ignored (Kinetic V2 compositing unchanged)', () => {
    const sv = read('../../../remotion/src/ShortVideo.tsx');
    expect(sv).toContain('const subjectStage = blueprint.kinetic || blueprint.subjectForeground ? undefined : blueprint.subjectStage;');
    // Kinetic's own mounts are byte-identical to before 5.23
    expect(sv).toContain('<KineticTrack spec={blueprint.kinetic} layer="behind" foreground={Boolean(blueprint.subjectForeground || subjectStageForeground)} />');
    expect(sv).toContain('<KineticTrack spec={blueprint.kinetic} layer="front" foreground={Boolean(blueprint.subjectForeground || subjectStageForeground)} />');
    expect(sv).toContain('foreground={blueprint.subjectForeground}');
  });
  it('the stage payload still parses with the blueprint schema (contract unchanged)', () => {
    const sample = JSON.parse(read('../../../remotion/props/sample.json')) as {blueprint: Record<string, unknown>};
    const parsed = timelineBlueprintSchema.parse({...sample.blueprint, subjectStage: {version: 1, styleId: 'subject_stage', matteUrl: 'https://cdn.test/m.webm', bg: {blurPx: 0, dimPct: 18}, spans: [{start: 0, end: 4, stage: 'S1', motion: {kind: 'none'}, enter: 'hard_cut'}], accents: []}});
    expect(parsed.subjectStage?.spans).toHaveLength(1);
  });
});

describe('source wiring (analyzeVideo + runner)', () => {
  const src = read('./analyzeVideo.ts');
  const at = (needle: string) => {
    const i = src.indexOf(needle);
    expect(i, needle).toBeGreaterThan(-1);
    return i;
  };
  it('the owner is resolved once, before both pipeline blocks; the forced flags gate the (unchanged) engine block; the stage gate also asks the owner', () => {
    const resolve = at('const editingPipeline = resolveEditingPipeline({selected: input.editingPipeline, polishPath, flags});');
    const force = at('Object.assign(flags, pipelineFlagOverrides(editingPipeline, flags));');
    const kinetic = at('if (polishPath && flags.kineticEngine && flags.kineticLed && captionWords.length > 0 && kineticFootageOk) {');
    const stage = at("owned: pipelineOwns(editingPipeline, 'subject_stage'),");
    expect(resolve).toBeLessThan(force);
    expect(force).toBeLessThan(kinetic);
    expect(kinetic).toBeLessThan(stage);
    expect(src.match(/resolveEditingPipeline\(/g)).toHaveLength(1);
  });
  it('the runner passes the style run pipeline (styled jobs only)', () => {
    expect(read('./analysisRunner.ts')).toContain('...(extras.styleRun ? {editingPipeline: extras.styleRun.pipeline} : {}),');
  });
});
