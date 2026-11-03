/**
 * Phase 36I: strict-mode provenance. Imports ONLY the pure provenance module, `strictOutcome.ts` (errors + the provenance module) and node built-ins: no logger, no `.env`, no
 * provider SDK, no FFmpeg, no network. Source-text checks read repository files; nothing is spawned.
 */
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {assertStrictProvenance} from '../pipeline/strictOutcome.ts';
import {buildProvenance, classifyField, judgeProvenance, PROVENANCE_FIELDS, type DirectorProvenance} from '../stages/broll/directorProvenance.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(path.resolve(here, '../..', relative), 'utf8');

/** A Director answer where everything is supplied and survives parsing. */
const full = () =>
  buildProvenance({
    raw: {opening_plan: {hook_wording: 'x'}, zooms: [{}], moments: [{}], motion_graphics: [{}], semantic_emphasis: [{}], media_containers: [], frame_insets: []},
    directorCounts: {zooms: 1, moments: 1, motionGraphics: 1, semanticEmphasis: 1},
    completedCounts: {zooms: 1, moments: 1, motionGraphics: 1, semanticEmphasis: 1},
  });
const originOf = (p: DirectorProvenance, field: (typeof PROVENANCE_FIELDS)[number]) => p.fields[field].origin;

describe('buildProvenance: who supplied each field (captured before any fallback)', () => {
  it('explicit: items the Director supplied and the parser kept are origin "director"', () => {
    const p = full();
    for (const field of ['openingPlan', 'zooms', 'moments', 'motionGraphics', 'semanticEmphasis'] as const) expect(originOf(p, field), field).toBe('director');
    expect(p.fields.zooms).toMatchObject({keyPresent: true, rawCount: 1, directorCount: 1, completedCount: 1});
  });
  it('missing: no key at all is "absent" with keyPresent false (not a Director choice)', () => {
    const p = buildProvenance({raw: {}, directorCounts: {}, completedCounts: {}});
    for (const field of PROVENANCE_FIELDS) expect(p.fields[field], field).toMatchObject({origin: 'absent', keyPresent: false, rawCount: 0});
  });
  it('an explicit empty list or null is "absent" but keyPresent is true (a choice, distinguishable from an omission)', () => {
    const p = buildProvenance({raw: {zooms: [], moments: null, opening_plan: null}, directorCounts: {}, completedCounts: {}});
    expect(p.fields.zooms).toMatchObject({origin: 'absent', keyPresent: true, rawCount: 0});
    expect(p.fields.moments).toMatchObject({origin: 'absent', keyPresent: true});
    expect(p.fields.openingPlan).toMatchObject({origin: 'absent', keyPresent: true, rawCount: 0});
  });
  it('malformed: items supplied but ALL discarded by the parser are "rejected"', () => {
    const p = buildProvenance({raw: {moments: [1, 'x', null], zooms: [{timestamp: 'nope'}]}, directorCounts: {moments: 0, zooms: 0}, completedCounts: {moments: 0, zooms: 0}});
    expect(originOf(p, 'moments')).toBe('rejected');
    expect(p.fields.moments.rawCount).toBe(3);
    expect(originOf(p, 'zooms')).toBe('rejected');
  });
  it('fallback-generated: the Director gave nothing usable but the parser\'s completed result is non-empty -> "fallback", even for an explicit empty list', () => {
    const omitted = buildProvenance({raw: {}, directorCounts: {motionGraphics: 0}, completedCounts: {motionGraphics: 2}});
    expect(originOf(omitted, 'motionGraphics')).toBe('fallback');
    const explicitEmpty = buildProvenance({raw: {motion_graphics: []}, directorCounts: {motionGraphics: 0}, completedCounts: {motionGraphics: 2}});
    expect(explicitEmpty.fields.motionGraphics).toMatchObject({origin: 'fallback', keyPresent: true, directorCount: 0, completedCount: 2});
  });
  it('a Director item is never reclassified as fallback just because the completed list is larger, and the opening plan is never "completed"', () => {
    const p = buildProvenance({raw: {motion_graphics: [{}], opening_plan: {a: 1}}, directorCounts: {motionGraphics: 1}, completedCounts: {motionGraphics: 4, openingPlan: 9}});
    expect(originOf(p, 'motionGraphics')).toBe('director');
    expect(p.fields.openingPlan).toMatchObject({origin: 'director', directorCount: 1, completedCount: 1});
  });
  it('spellings the parsers accept (camelCase) are recognised, and a non-object raw record yields "absent" everywhere', () => {
    expect(buildProvenance({raw: {motionGraphics: [{}]}, directorCounts: {motionGraphics: 1}, completedCounts: {}}).fields.motionGraphics.keyPresent).toBe(true);
    for (const raw of [null, undefined, 'text', 42, [1, 2]]) {
      const p = buildProvenance({raw, directorCounts: {}, completedCounts: {}});
      for (const field of PROVENANCE_FIELDS) expect(originOf(p, field)).toBe('absent');
    }
  });
  it('classifyField is a pure precedence: director > fallback > rejected > absent', () => {
    expect(classifyField({keyPresent: true, rawCount: 2, directorCount: 1, completedCount: 5})).toBe('director');
    expect(classifyField({keyPresent: true, rawCount: 2, directorCount: 0, completedCount: 5})).toBe('fallback');
    expect(classifyField({keyPresent: true, rawCount: 2, directorCount: 0, completedCount: 0})).toBe('rejected');
    expect(classifyField({keyPresent: false, rawCount: 0, directorCount: 0, completedCount: 0})).toBe('absent');
  });
});

describe('judgeProvenance and assertStrictProvenance: strict mode checks provenance, not whether a field is populated', () => {
  const fallbackMotion = () => buildProvenance({raw: {zooms: [{}], moments: [{}], opening_plan: {a: 1}}, directorCounts: {zooms: 1, moments: 1}, completedCounts: {zooms: 1, moments: 1, motionGraphics: 2, semanticEmphasis: 1}});

  it('a clean Director answer has no violations (absent optional lists are fine)', () => {
    expect(judgeProvenance(full())).toEqual([]);
  });
  it('fallback-made motion graphics / semantic emphasis are violations although the lists are populated (the Phase 36H blind spot)', () => {
    const violations = judgeProvenance(fallbackMotion());
    expect(violations.map(item => item.field).sort()).toEqual(['motionGraphics', 'semanticEmphasis']);
    expect(violations.every(item => item.origin === 'fallback')).toBe(true);
  });
  it('a field whose every Director item was rejected is a violation', () => {
    const p = buildProvenance({raw: {zooms: ['bad']}, directorCounts: {zooms: 0}, completedCounts: {zooms: 0}});
    expect(judgeProvenance(p).map(item => `${item.field}:${item.origin}`)).toEqual(['zooms:rejected']);
  });
  it('FALLBACK CANNOT MAKE A MISSING REQUIRED FIELD PASS: a missing opening plan violates when required, whatever else the parser completed', () => {
    const p = buildProvenance({raw: {zooms: [{}]}, directorCounts: {zooms: 1}, completedCounts: {zooms: 1, moments: 3, motionGraphics: 2, openingPlan: 1}});
    expect(originOf(p, 'openingPlan')).toBe('absent'); // a completed count for the opening plan is ignored: the parser never creates one
    expect(judgeProvenance(p, {requiredFromDirector: ['openingPlan']}).map(item => item.field)).toContain('openingPlan');
    expect(judgeProvenance(p).map(item => item.field)).not.toContain('openingPlan'); // not required: no violation of its own
  });
  it('malformed or missing provenance fails closed for every field', () => {
    for (const bad of [undefined, null, 'x', 7, {}, {version: 2, fields: {}}, {version: 1}, {version: 1, fields: {}}, {version: 1, fields: {zooms: {origin: 'maybe'}}}]) {
      expect(judgeProvenance(bad).length, JSON.stringify(bad)).toBe(PROVENANCE_FIELDS.length);
    }
    const broken = full();
    (broken.fields as Record<string, unknown>).zooms = undefined;
    expect(judgeProvenance(broken).map(item => item.field)).toEqual(['zooms']);
  });
  it('assertStrictProvenance is a strict no-op when not enabled, even for fallback or missing provenance (legacy behaviour unchanged)', () => {
    expect(() => assertStrictProvenance(false, fallbackMotion(), {openingRequested: true})).not.toThrow();
    expect(() => assertStrictProvenance(false, undefined, {openingRequested: true})).not.toThrow();
  });
  it('enabled: fallback provenance throws ai_direction_failed naming the stage, reason and fields; missing provenance throws too', () => {
    let caught: unknown;
    try {
      assertStrictProvenance(true, fallbackMotion(), {openingRequested: false});
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({code: 'ai_direction_failed', details: {stage: 'director_provenance', reason: 'fallback_provenance'}});
    expect(JSON.stringify((caught as {details: unknown}).details)).toMatch(/motionGraphics/);
    expect(() => assertStrictProvenance(true, undefined, {openingRequested: false})).toThrow(/fallback_provenance/);
  });
  it('enabled: a clean answer passes; a requested opening that the Director omitted fails even when everything else is Director-made', () => {
    expect(() => assertStrictProvenance(true, full(), {openingRequested: true})).not.toThrow();
    const noOpening = buildProvenance({raw: {zooms: [{}], moments: [{}], motion_graphics: [{}], semantic_emphasis: [{}]}, directorCounts: {zooms: 1, moments: 1, motionGraphics: 1, semanticEmphasis: 1}, completedCounts: {zooms: 1, moments: 1, motionGraphics: 1, semanticEmphasis: 1}});
    expect(() => assertStrictProvenance(true, noOpening, {openingRequested: true})).toThrow(/openingPlan: required from the Director/);
    expect(() => assertStrictProvenance(true, noOpening, {openingRequested: false})).not.toThrow();
  });
});

describe('wiring and activation boundary (source text, not behaviour)', () => {
  it('the provenance module is pure: it has no import statements', () => {
    expect(read('src/stages/broll/directorProvenance.ts')).not.toMatch(/^\s*import\s/m);
  });
  it('capture happens from the raw answer and the Director-only counts, before the planner merges the fallback, and only when asked', () => {
    const director = read('src/stages/broll/geminiDirector.ts');
    expect(director).toContain('if (input.captureProvenance) {');
    expect(director).toContain('rawRecord = extractJson(text)');
    expect(director).toContain('directorMotionCounts(');
    const captureAt = director.indexOf('if (input.captureProvenance) {');
    expect(captureAt).toBeGreaterThan(director.indexOf('const parsed = parseVisualDirectorJson('));
    expect(captureAt).toBeLessThan(director.indexOf('...(directorProvenance ? {directorProvenance} : {})'));
    // the merge with the fallback happens later, in planVisualDirection, and does not read or write provenance
    expect(director.indexOf('...fallbackSubstitutionsOf(directed, fallback)')).toBeGreaterThan(0);
    const plan = read('src/stages/broll/motionGraphicsPlan.ts');
    const counts = plan.slice(plan.indexOf('export function directorMotionCounts'), plan.indexOf('export function parseMotionPlanFromDirector'));
    expect(counts).not.toMatch(/ensureMotionCoverage|fallbackMotionPlan/);
    expect(plan).toContain('return ensureMotionCoverage({'); // the existing function is unchanged
  });
  it('the option defaults off: it needs strictAiDirection AND strictProvenance, is not in the HTTP schema, and nothing in the runner sets it yet', () => {
    const analyze = read('src/pipeline/analyzeVideo.ts');
    expect(analyze).toContain('captureProvenance: Boolean(input.strictAiDirection && input.strictProvenance)');
    expect(analyze).toContain('assertStrictProvenance(Boolean(input.strictAiDirection && input.strictProvenance), broll.directorProvenance');
    expect(analyze.indexOf('assertStrictDirectorDeliverables(input.strictAiDirection')).toBeLessThan(analyze.indexOf('assertStrictProvenance(Boolean('));
    expect(read('src/http/schemas.ts')).not.toContain('strictProvenance');
    expect(readFileSync(path.resolve(here, '../../../remotion/out/phase36-readiness/run_experiment.ts'), 'utf8')).not.toContain('strictProvenance');
  });
});
