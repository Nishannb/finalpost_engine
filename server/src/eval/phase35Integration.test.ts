/**
 * Phase 35 correction: the real request/response contracts between Gemini, the validators, the renderer schema and the Claude worker agree.
 * Offline: the Gemini HTTP layer is mocked and records the request bodies. No model call is made. Proves what the Director is ASKED and what it can
 * RETURN; it does not (and cannot) prove how the live model behaves: that needs the paid run.
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const hoisted = vi.hoisted(() => ({bodies: [] as any[], geminiJson: {} as unknown}));
vi.mock('../lib/http.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/http.ts')>();
  return {
    ...actual,
    requestJson: async (_url: string, options: {body?: string; timeoutMs?: number; label?: string}) => {
      hoisted.bodies.push({label: options.label, timeoutMs: options.timeoutMs, body: JSON.parse(options.body ?? '{}')});
      return {candidates: [{content: {parts: [{text: JSON.stringify(hoisted.geminiJson)}]}}], usageMetadata: {promptTokenCount: 10, candidatesTokenCount: 5}};
    },
  };
});

const {env} = await import('../config/env.ts');
const {planVisualDirection} = await import('../stages/broll/geminiDirector.ts');
const {directMotionGraphics, assembleDirectedGraphics} = await import('../stages/motionDirector/motionDirector.ts');
const {OPENING_TREATMENTS, openingPlanSchema, resolveOpening} = await import('../stages/openingPlan/openingPlan.ts');
const {MASK_REVEAL_KINDS, TEXT_TREATMENT_KINDS, treatmentInstruction, textTreatmentSchema} = await import('../stages/textTreatment/textTreatment.ts');
const {buildGenerationPrompt} = await import('../motionWorker/prompt.ts');
const {DEFAULT_CANVAS, parseBrief} = await import('../motionWorker/brief.ts');
const {openingTreatmentSchema, behindSubjectTextSchema, timelineBlueprintSchema} = await import('../../../remotion/src/blueprintSchema');
const Motion = await import('../../../remotion/src/motion');
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const PART = {mimeType: 'video/mp4', data: 'QUJD', bytes: 3};
const directorInput = {transcript: 'Never ever do these three things. Hook is key. You need a performance bonus.', sourceDurationSec: 40, momentCount: 3};
const roles = {primary_text: '#FFFFFF', secondary_text: '#CFE8F3', accent: '#FACC15', graphic_background: '#0B1B2B', panel: '#12283D', highlight: '#FACC15', data: '#38BDF8'};
const planBase = {
  central_promise: 'Avoid three editing mistakes', audience: 'new editors', angle: 'a warning',
  evidence: [{time_sec: 1, what: 'warns'}, {time_sec: 20, what: 'lists'}, {time_sec: 38, what: 'closes'}],
  concept: 'warning headline', hook_wording: 'NEVER DO THESE THREE THINGS', wording_source: 'spoken', source_frame_time_sec: 0.5, treatment: 'plain',
  text_masking_reason: '', placement: {center_y: 0.1, width_frac: 0.88, align: 'center'}, contrast_treatment: 'none', frame0: 'title visible', animation: 'bar sweeps', why_this_design: 'matches tone',
};
const calm = (lum: number) => ({p10: lum, p50: lum, p90: lum, meanRgb: {r: 80, g: 80, b: 80}, spread: 0.03});
const resolveBase = {colorDirection: {identity: 'cool studio', footage_notes: 'blue wall', roles}, transcript: directorInput.transcript, durationSec: 40, hookDurationSec: 3, speakerBox: {x: 0.18, y: 0.35, w: 0.64, h: 0.6}, matteUsable: false, measure: async () => calm(0.1)};

beforeEach(() => {
  hoisted.bodies.length = 0;
  hoisted.geminiJson = {hook_title: 'HELLO', moments: [{timestamp: 5, search_keyword: 'x y', layout: 'cutaway'}], zooms: [], caption: {template: 'clean', position: 'bottom', box: false}};
  (env as Record<string, unknown>).GEMINI_API_KEY = 'test-key';
});
afterEach(() => {
  hoisted.bodies.length = 0;
});
const directorCall = () => hoisted.bodies.find(item => item.label === 'Gemini visual director')!;

describe('v1 Director request: opening plan and colour direction', () => {
  it('with the whole video AND the opt-in: video first, directive in the prompt, opening_plan + color_direction in the schema, observations kept', async () => {
    await planVisualDirection({...directorInput, videoPart: PART, openingDirection: true});
    const call = directorCall();
    const parts = call.body.contents[0].parts;
    expect(parts[0]).toEqual({inlineData: {mimeType: 'video/mp4', data: 'QUJD'}});
    expect(parts[1].text).toContain('OPENING AND COLOR DIRECTION');
    expect(parts[1].text).toContain('BEFORE choosing any other edit');
    const props = call.body.generationConfig.responseSchema.properties;
    expect(props.video_observations.type).toBe('ARRAY');
    expect(props.opening_plan.properties.treatment.enum).toEqual([...OPENING_TREATMENTS]);
    expect(props.opening_plan.properties.reveal.enum).toEqual([...MASK_REVEAL_KINDS]);
    expect(props.opening_plan.required).toEqual(expect.arrayContaining(['evidence', 'hook_wording', 'wording_source', 'treatment', 'placement', 'why_this_design']));
    expect(Object.keys(props.color_direction.properties.roles.properties).sort()).toEqual(['accent', 'data', 'graphic_background', 'highlight', 'panel', 'primary_text', 'secondary_text']);
    // Key order is the generation order: the opening plan comes before every edit decision.
    const keys = Object.keys(props);
    expect(keys.indexOf('opening_plan')).toBeLessThan(keys.indexOf('hook_title'));
    expect(keys.indexOf('color_direction')).toBeLessThan(keys.indexOf('moments'));
  });

  it('the opening directive is NEVER sent without the whole video: the opt-in alone (frame-only / no video) leaves the request in its old shape', async () => {
    await planVisualDirection({...directorInput, openingDirection: true});
    const call = directorCall();
    expect(JSON.stringify(call.body)).not.toMatch(/OPENING AND COLOR DIRECTION|opening_plan|color_direction|inlineData/);
  });

  it('the video alone (Phase 34 shape) does not ask for the opening plan either', async () => {
    await planVisualDirection({...directorInput, videoPart: PART});
    expect(JSON.stringify(directorCall().body)).not.toMatch(/opening_plan|color_direction/);
  });

  it('the plan and colours the model returns come back raw for validation (and as nothing when it returns none)', async () => {
    hoisted.geminiJson = {...(hoisted.geminiJson as object), video_observations: [{time_sec: 2, observation: 'x'}], opening_plan: planBase, color_direction: {identity: 'i', roles}};
    const withPlan = await planVisualDirection({...directorInput, videoPart: PART, openingDirection: true});
    expect(withPlan.openingRaw).toMatchObject({openingPlan: {hook_wording: 'NEVER DO THESE THREE THINGS'}, colorDirection: {roles}});
    hoisted.geminiJson = {hook_title: 'HELLO', moments: [{timestamp: 5, search_keyword: 'x y', layout: 'cutaway'}], zooms: [], caption: {}};
    const without = await planVisualDirection({...directorInput, videoPart: PART, openingDirection: true});
    expect(without.openingRaw).toMatchObject({openingPlan: null, colorDirection: null});
  });
});

describe('every treatment the Director may ask for is understood by the validator, the renderer schema and the Claude worker', () => {
  const treatments = [
    ['plain', {}],
    ['curved', {curve: {shape: 'arc', curvature: 0.3, direction: 'clockwise', rotationDeg: 0}}],
    ['mask_reveal', {reveal: 'iris'}],
    ['layered', {}],
    ['behind_subject', {}],
  ] as const;

  it('the plan schema accepts exactly the treatments the response schema offers', () => {
    expect([...openingPlanSchema.shape.treatment.options]).toEqual([...OPENING_TREATMENTS]);
  });

  for (const [treatment, extra] of treatments) {
    it(`${treatment}: resolves, is delivered as reported, and the result parses in the renderer schema`, async () => {
      const result = await resolveOpening({...resolveBase, plan: {...planBase, treatment, ...extra}});
      expect(result.report.accepted).toBe(true);
      expect(result.report.requested).toBe(treatment);
      if (treatment === 'behind_subject') {
        // No matte in this scenario: the report must NOT say behind_subject.
        expect(result.report.delivered).toBe('layered');
        expect(result.report.fallbacks.join(' ')).toContain('not depth-aware');
        expect(result.behindSubject).toBeUndefined();
      } else {
        expect(result.report.delivered).toBe(treatment);
      }
      const spec = result.spec!;
      expect(openingTreatmentSchema.safeParse(spec).success).toBe(true);
      expect(timelineBlueprintSchema.shape.openingTreatment.safeParse(spec).success).toBe(true);
      if (treatment === 'mask_reveal') {
        expect(spec).toMatchObject({kind: 'mask_reveal', lines: ['NEVER DO THESE', 'THREE THINGS'], textReveal: 'iris'});
      } else {
        expect(spec.lines).toBeUndefined();
      }
    });
  }

  it('a one-word mask_reveal is not reported as one: nothing was masked', async () => {
    const result = await resolveOpening({...resolveBase, plan: {...planBase, hook_wording: 'NEVER', treatment: 'mask_reveal', reveal: 'iris'}});
    expect(result.report.delivered).toBe('plain');
    expect(result.report.fallbacks.join(' ')).toContain('no text was masked');
    expect(result.spec!.kind).toBe('plain');
    expect(result.spec!.lines).toBeUndefined();
  });

  it('a plain request is not turned into a layered panel', async () => {
    const result = await resolveOpening({...resolveBase, plan: planBase});
    expect(result.spec!.kind).toBe('plain');
  });

  it('behind_subject with a real matte and calm footage: the entry carries proven colours and parses in the renderer schema', async () => {
    const result = await resolveOpening({...resolveBase, matteUsable: true, speakerBox: {x: 0.3, y: 0.5, w: 0.4, h: 0.5}, plan: {...planBase, treatment: 'behind_subject', placement: {center_y: 0.25, width_frac: 0.9, align: 'center'}}});
    expect(result.report.delivered).toBe('behind_subject');
    expect(result.behindSubject).toMatchObject({color: expect.stringMatching(/^#[0-9A-F]{6}$/i)});
    expect(behindSubjectTextSchema.safeParse(result.behindSubject).success).toBe(true);
  });

  it('behind_subject with a matte but footage too bright or busy for unpanelled text is downgraded, not drawn in a guessed colour', async () => {
    for (const measure of [async () => calm(0.92), async () => ({p10: 0.02, p50: 0.3, p90: 0.5, meanRgb: {r: 1, g: 1, b: 1}, spread: 0.3})]) {
      const result = await resolveOpening({...resolveBase, measure, matteUsable: true, speakerBox: {x: 0.3, y: 0.5, w: 0.4, h: 0.5}, plan: {...planBase, treatment: 'behind_subject', placement: {center_y: 0.25, width_frac: 0.9, align: 'center'}}});
      expect(result.report.delivered).toBe('layered');
      expect(result.report.fallbacks.join(' ')).toContain('no_safe_text_colour');
      expect(result.behindSubject).toBeUndefined();
    }
  });
});

describe('motion Director: the structured text-treatment request', () => {
  const words = Array.from({length: 40}, (_, i) => ({text: `w${i}`, start: i * 0.5, end: i * 0.5 + 0.4}));

  it('the request schema offers exactly the kinds and reveal kinds the validator and the toolkit know', async () => {
    hoisted.geminiJson = {graphics: []};
    await directMotionGraphics({transcript: 't', words, outputDurationSec: 20, languageCode: 'en', occupied: [], maxGraphics: 2});
    const schema = hoisted.bodies.at(-1).body.generationConfig.responseSchema.properties.graphics.items.properties.textTreatment;
    expect(schema.properties.kind.enum).toEqual([...TEXT_TREATMENT_KINDS]);
    expect(schema.properties.reveal.enum).toEqual([...MASK_REVEAL_KINDS]);
    expect([...MASK_REVEAL_KINDS]).toEqual([...Motion.MASK_REVEAL_KINDS]);
    expect(hoisted.bodies.at(-1).body.systemInstruction.parts[0].text).toContain('TEXT TREATMENT');
  });

  const requests: Array<[string, Record<string, unknown>, string[]]> = [
    ['curved', {kind: 'curved', text: 'BONUS', curve: {shape: 'arc', curvature: 0.5, direction: 'clockwise', align: 'center', rotationDeg: 0}}, ['CurvedText']],
    ['clip_window', {kind: 'clip_window', text: 'LIST'}, ['ClipWindow']],
    ['mask_reveal', {kind: 'mask_reveal', text: 'REVEAL', reveal: 'slit'}, ['MaskReveal']],
    ['layered', {kind: 'layered', text: 'LAYER'}, ['LayeredText']],
  ];
  for (const [kind, treatment, components] of requests) {
    it(`${kind}: survives assembly, reaches Claude as a required instruction naming toolkit components that exist and are documented`, () => {
      const raw = {graphics: [{id: 'g', anchorWordIndex: 4, durationSeconds: 3, reason: 'r', goal: 'g', visualDescription: 'v', placement: 'full_screen', contentJson: '{"title":"X"}', textTreatment: treatment}]};
      const result = assembleDirectedGraphics(raw, {words, outputDurationSec: 20, occupied: [], maxGraphics: 3});
      expect(result.refusals).toEqual([]);
      const brief = parseBrief(result.graphics[0]!.brief);
      expect(textTreatmentSchema.safeParse(brief.textTreatment).success).toBe(true);
      const prompt = buildGenerationPrompt(brief, DEFAULT_CANVAS);
      expect(prompt).toContain('TEXT TREATMENT (required)');
      const readme = readFileSync(resolve(import.meta.dirname, '../../../remotion/src/motion/README.md'), 'utf8');
      for (const name of components) {
        expect(treatmentInstruction(brief.textTreatment!)).toContain(name);
        expect(typeof (Motion as Record<string, unknown>)[name]).toBe('function');
        expect(readme).toContain(`**\`${name}\`**`);
      }
    });
  }
});
