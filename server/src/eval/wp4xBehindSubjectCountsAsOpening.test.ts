/**
 * WP4X tests: an opening delivered as behind-subject text (resolveOpening returns `behindSubject` and `spec: null`) counts as an opening for the legibility:no_opening_hook warning.
 * stages/broll/legibility.ts is pure; resolveOpening's imports are logger-free (zod, the text-treatment schema, colour helpers), so it is called directly with an injected `measure`;
 * analyzeVideo.ts (logger) is read as text. No render, no Chromium, no network, no model call. The four unsafe suites are not run.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {absentOpeningHookWarning, openingIsPresent} from '../stages/broll/legibility.ts';
import {resolveOpening, type ResolveInput} from '../stages/openingPlan/openingPlan.ts';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts: string[]) => readFileSync(resolve(SRC, ...parts), 'utf8');
const stripComments = (source: string) => source.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

/** What the call site computes: the warning for the opening pieces resolveOpening returned and the hook title that will be written. */
const warningFor = (openingSpec: unknown, openingBehindSubject: unknown, hookTitle: string) => absentOpeningHookWarning(openingIsPresent(openingSpec, openingBehindSubject), hookTitle);
const SPEC = {text: 'Stay calm', kind: 'plain'};
const BEHIND = {text: 'Stay calm', centerY: 0.3, start: 0, end: 3};

describe('the helper is unchanged for boolean inputs', () => {
  it('the same string and the same truth table as WP4W', () => {
    expect(absentOpeningHookWarning(false, '')).toBe('legibility:no_opening_hook');
    expect(absentOpeningHookWarning(false, '   ')).toBe('legibility:no_opening_hook');
    expect(absentOpeningHookWarning(false, 'Save time')).toBeNull();
    expect(absentOpeningHookWarning(true, '')).toBeNull();
    expect(absentOpeningHookWarning(true, 'Save time')).toBeNull();
  });
});

describe('openingIsPresent', () => {
  it('is true for a spec, for a behind-subject entry, or both', () => {
    expect(openingIsPresent(SPEC, null)).toBe(true);
    expect(openingIsPresent(null, BEHIND)).toBe(true);
    expect(openingIsPresent(SPEC, BEHIND)).toBe(true);
    expect(openingIsPresent(SPEC, undefined)).toBe(true);
    expect(openingIsPresent(undefined, BEHIND)).toBe(true);
  });
  it('is false for neither (null, undefined)', () => {
    expect(openingIsPresent(null, null)).toBe(false);
    expect(openingIsPresent(undefined, undefined)).toBe(false);
    expect(openingIsPresent(null, undefined)).toBe(false);
  });
});

describe('the warning at the call site', () => {
  it('openingSpec alone with an empty hook: no warning', () => {
    expect(warningFor(SPEC, undefined, '')).toBeNull();
  });
  it('a behind-subject opening alone with an empty hook: no warning', () => {
    expect(warningFor(null, BEHIND, '')).toBeNull();
    expect(warningFor(null, BEHIND, '   ')).toBeNull();
  });
  it('both absent with an empty hook: the warning', () => {
    expect(warningFor(null, undefined, '')).toBe('legibility:no_opening_hook');
    expect(warningFor(null, null, '   ')).toBe('legibility:no_opening_hook');
  });
  it('both absent with a hook title: no warning', () => {
    expect(warningFor(null, undefined, 'Save time')).toBeNull();
  });
});

describe('with the real resolver', () => {
  const TRANSCRIPT = 'Stay calm under pressure. Most managers panic when a deadline moves. Here is how to keep your head and decide fast.';
  const colors = {identity: 'calm blue', footage_notes: '', roles: {primary_text: '#FFFFFF', secondary_text: '#CBD5E1', accent: '#38BDF8', graphic_background: '#0B1220', panel: '#0B1220', highlight: '#FACC15', data: '#38BDF8'}};
  const calm = async () => ({p10: 0.02, p50: 0.04, p90: 0.07, meanRgb: {r: 15, g: 15, b: 20}, spread: 0.01});
  const plan = (treatment: string) => ({
    central_promise: 'Stay calm under pressure', audience: 'managers', angle: 'calm beats panic',
    evidence: [{time_sec: 1, what: 'the opening line'}, {time_sec: 30, what: 'the closing advice'}],
    concept: 'calm focus', hook_wording: 'Stay calm', wording_source: 'spoken', source_frame_time_sec: 1, treatment,
    placement: {center_y: 0.3, width_frac: 0.6, align: 'center'}, frame0: 'a calm title', animation: 'a settle', why_this_design: 'it matches the tone',
  });
  const resolve_ = (treatment: string, extra: Partial<ResolveInput> = {}) =>
    resolveOpening({plan: plan(treatment), colorDirection: colors, transcript: TRANSCRIPT, durationSec: 40, hookDurationSec: 3, matteUsable: true, measure: calm, ...extra} as ResolveInput);

  it('a behind-subject opening on a measured speaker returns a behindSubject entry and no spec, and is NOT flagged with an empty hook', async () => {
    const r = await resolve_('behind_subject', {speakerBox: {x: 0.3, y: 0.55, w: 0.4, h: 0.4}});
    expect(r.spec).toBeNull();
    expect(r.behindSubject).toBeDefined();
    expect(warningFor(r.spec, r.behindSubject, '')).toBeNull();
  });
  it('a plain opening returns a spec and is not flagged', async () => {
    const r = await resolve_('plain', {speakerUnknown: true});
    expect(r.spec).not.toBeNull();
    expect(warningFor(r.spec, r.behindSubject, '')).toBeNull();
  });
  it('a rejected opening returns neither, and an empty hook IS flagged', async () => {
    const r = await resolve_('plain', {speakerBox: {x: 0.2, y: 0.08, w: 0.6, h: 0.8}});
    expect(r.report.accepted).toBe(false);
    expect(r.spec).toBeNull();
    expect(r.behindSubject).toBeUndefined();
    expect(warningFor(r.spec, r.behindSubject, '')).toBe('legibility:no_opening_hook');
  });
});

describe('analyzeVideo (source text; it imports the logger)', () => {
  const analyze = stripComments(read('pipeline', 'analyzeVideo.ts'));
  it('the call treats behind-subject as present, with the same hook title as WP4W, still once and in the mvp block', () => {
    expect(analyze.match(/absentOpeningHookWarning\(/g)).toHaveLength(1);
    expect(analyze).toContain('const noOpeningHook = absentOpeningHookWarning(openingIsPresent(openingSpec, survivedBehind), broll.hookTitle);'); // WP5C: survivedBehind is the opening's entry only if it survived finalizeEdits
    expect(analyze).toContain('if (noOpeningHook) warnings.push(noOpeningHook);');
    expect(analyze.indexOf('absentOpeningHookWarning(')).toBeGreaterThan(analyze.indexOf("input.editProfile === 'mvp' && !captionsOnly"));
    expect(analyze.indexOf('absentOpeningHookWarning(')).toBeGreaterThan(analyze.indexOf('const finalized = finalizeEdits({')); // WP5C
    expect(analyze).toContain('openingIsPresent, survivingOpeningBehindSubject, type LegibilitySpec');
  });
  it('openingBehindSubject is the variable assigned from resolveOpening\'s behindSubject', () => {
    expect(analyze).toContain('openingBehindSubject = resolved.behindSubject;');
    expect(analyze).toContain('let openingBehindSubject: Awaited<ReturnType<typeof resolveOpening>>[\'behindSubject\'];');
  });
  it('resolveOpening, applyLegibility, the scorer and the helper\'s string are unchanged', () => {
    const legibility = stripComments(read('stages', 'broll', 'legibility.ts'));
    expect(legibility).toContain("export const NO_OPENING_HOOK_WARNING = 'legibility:no_opening_hook';");
    expect(legibility).toContain("return !openingPresent && (typeof hookTitle !== 'string' || hookTitle.trim() === '') ? NO_OPENING_HOOK_WARNING : null;");
    expect(legibility).toContain("warnings: ['legibility:ungrounded_hook_cleared']");
    expect(stripComments(read('eval', 'rubricScorer.ts'))).not.toContain('no_opening_hook');
    const plan = stripComments(read('stages', 'openingPlan', 'openingPlan.ts'));
    expect(plan).toContain("return reject('no_clear_band_above_the_face', plan.treatment, roles);");
  });
  it('the defaults are untouched', () => {
    const env = stripComments(read('config', 'env.ts'));
    expect(env).toMatch(/PRODUCT_EDIT_PROFILE:[^\n]*cuts/);
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED:\s*bool\(false\)/);
  });
});
