/**
 * Phase 31: `designTokens` blueprint field (dual-read in the renderer, dual-write in the server).
 *
 * Contract under test:
 *  - a valid `designTokens` wins; otherwise a valid legacy `northStarDesign`; otherwise no design (a malformed object is never a design);
 *  - both valid but different: `designTokens` wins, NOTHING is merged, a `design_fields_conflict` diagnostic is emitted (production does not fail);
 *  - valid = schema AND the four colour fields are 6-digit hex; non-colour fields get no colour validation;
 *  - the server writes both keys from one object, and neither key when there is no design (blueprint JSON unchanged);
 *  - existing persisted legacy blueprints keep resolving to exactly their legacy design;
 *  - nothing here chooses or invents a design: no taxonomy, no default theme, no caption behaviour.
 * The renderer (remotion/src/lib/designTokens.ts) and the server (server/src/lib/designTokens.ts) are separate implementations pinned to agree.
 */
import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import {join, resolve} from 'node:path';

import {afterEach, describe, expect, it, vi} from 'vitest';

import {designTokensSchema, shortVideoPropsSchema, timelineBlueprintSchema} from '../../../remotion/src/blueprintSchema.ts';
import * as renderer from '../../../remotion/src/lib/designTokens.ts';
import * as server from '../lib/designTokens.ts';
import {designFromProfile} from '../stages/contentProfile/artDirection.ts';
import {parseContentProfile, type VisualMood} from '../stages/contentProfile/contentProfile.ts';
import {buildNorthStarDesign} from '../stages/northStar/designSystem.ts';
import {tokensFromThesis} from '../stages/northStar/thesisTokens.ts';
import type {DesignTokens} from '../types/blueprint.ts';
import {provenanceOf, stampProvenance} from '../lib/provenance.ts';
import {PROFILE_RESPONSE} from './phase28Scenarios.ts';

const D1: DesignTokens = {enabled: true, contentType: 'educational_tips', displayFont: 'bebas', primaryColor: '#E11D48', secondaryColor: '#0EA5E9', inkColor: '#FDF2F8', surfaceColor: '#111827', motionPreset: 'kinetic', cornerRadius: 14, density: 'balanced'};
const D2: DesignTokens = {...D1, contentType: 'story', displayFont: 'playfair', primaryColor: '#16A34A', secondaryColor: '#F59E0B', inkColor: '#F7FEE7', surfaceColor: '#052E16', motionPreset: 'editorial'};
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

type Case = {name: string; blueprint: Record<string, unknown>; source: 'designTokens' | 'northStarDesign' | 'none'; conflict: boolean; codes: string[]};
const CASES: Case[] = [
  {name: 'neither', blueprint: {}, source: 'none', conflict: false, codes: []},
  {name: 'legacy only', blueprint: {northStarDesign: D1}, source: 'northStarDesign', conflict: false, codes: []},
  {name: 'new only', blueprint: {designTokens: D1}, source: 'designTokens', conflict: false, codes: []},
  {name: 'both equal', blueprint: {designTokens: D1, northStarDesign: clone(D1)}, source: 'designTokens', conflict: false, codes: []},
  {name: 'both equal, different key order', blueprint: {designTokens: D1, northStarDesign: Object.fromEntries(Object.entries(D1).reverse())}, source: 'designTokens', conflict: false, codes: []},
  {name: 'both valid, different', blueprint: {designTokens: D1, northStarDesign: D2}, source: 'designTokens', conflict: true, codes: ['design_fields_conflict']},
  {name: 'new invalid (font), legacy valid', blueprint: {designTokens: {...D1, displayFont: 'comic_sans'}, northStarDesign: D2}, source: 'northStarDesign', conflict: false, codes: ['design_tokens_invalid_ignored']},
  {name: 'new invalid (colour), legacy valid', blueprint: {designTokens: {...D1, primaryColor: 'red'}, northStarDesign: D2}, source: 'northStarDesign', conflict: false, codes: ['design_tokens_invalid_ignored']},
  {name: 'new valid, legacy invalid', blueprint: {designTokens: D1, northStarDesign: {...D2, secondaryColor: '#12'}}, source: 'designTokens', conflict: false, codes: ['design_legacy_invalid_ignored']},
  {name: 'both invalid', blueprint: {designTokens: {...D1, enabled: false}, northStarDesign: {...D2, inkColor: 'white'}}, source: 'none', conflict: false, codes: ['design_tokens_invalid_ignored', 'design_legacy_invalid_ignored']},
  {name: 'new null (present but not a design), legacy valid', blueprint: {designTokens: null, northStarDesign: D1}, source: 'northStarDesign', conflict: false, codes: ['design_tokens_invalid_ignored']},
  {name: 'legacy only, invalid colour', blueprint: {northStarDesign: {...D1, surfaceColor: 'rgb(0,0,0)'}}, source: 'none', conflict: false, codes: ['design_legacy_invalid_ignored']},
  {name: 'new only, array instead of object', blueprint: {designTokens: [D1]}, source: 'none', conflict: false, codes: ['design_tokens_invalid_ignored']},
];

describe.each([['renderer', renderer], ['server', server]] as const)('%s resolver', (_name, impl) => {
  it.each(CASES)('$name', ({blueprint, source, conflict, codes}) => {
    const result = impl.resolveDesignTokens(blueprint);
    expect(result.source).toBe(source);
    expect(result.conflict).toBe(conflict);
    expect(result.diagnostics.map(item => item.code).sort()).toEqual([...codes].sort());
    if (source === 'none') {
      expect(result.tokens).toBeUndefined(); // never an invented or half-valid design
    }
  });

  it('a valid legacy-only design resolves to the legacy object itself (same reference): rendering is exactly what it always was', () => {
    const legacy = clone(D1);
    expect(impl.resolveDesignTokens({northStarDesign: legacy}).tokens).toBe(legacy);
  });

  it('D3: when both are valid and differ, designTokens wins, nothing is merged, and the diagnostic names the differing fields', () => {
    const preferred = clone(D1);
    const legacy = clone(D2);
    const result = impl.resolveDesignTokens({designTokens: preferred, northStarDesign: legacy});
    expect(result.tokens).toBe(preferred);
    expect(result.tokens).toEqual(D1); // not one field from the legacy object
    const message = result.diagnostics.find(item => item.code === 'design_fields_conflict')!.message;
    for (const field of ['contentType', 'displayFont', 'primaryColor', 'secondaryColor', 'inkColor', 'surfaceColor', 'motionPreset']) {
      expect(message, field).toContain(field);
    }
    expect(message).not.toMatch(/cornerRadius|density|enabled/); // those are equal, so they are not reported
    expect(message).toContain('nothing is merged');
    expect(preferred).toEqual(D1);
    expect(legacy).toEqual(D2); // inputs untouched
  });
});

describe('D2: schema plus field-specific colour validation', () => {
  const ok = (value: unknown) => server.designTokenProblems(value).length === 0;
  it.each([
    ['uppercase 6-digit hex', {primaryColor: '#ABCDEF'}, true],
    ['lowercase 6-digit hex', {primaryColor: '#abcdef'}, true],
    ['3-digit hex', {primaryColor: '#abc'}, false],
    ['8-digit hex (alpha)', {primaryColor: '#aabbccdd'}, false],
    ['no leading #', {primaryColor: 'aabbcc'}, false],
    ['colour name', {inkColor: 'white'}, false],
    ['rgb()', {surfaceColor: 'rgb(1,2,3)'}, false],
    ['empty string', {secondaryColor: ''}, false],
    ['number instead of string', {secondaryColor: 123}, false],
  ])('colour field: %s', (_label, patch, expected) => {
    expect(ok({...D1, ...patch})).toBe(expected);
    expect(renderer.validateDesignTokens({...D1, ...patch}).ok).toBe(expected);
  });

  it('non-colour fields get NO colour validation (only their own schema): cornerRadius 0, a large radius, every font/preset/density value', () => {
    for (const patch of [{cornerRadius: 0}, {cornerRadius: 999}, {cornerRadius: 22.5}, {displayFont: 'oswald'}, {displayFont: 'space_grotesk'}, {motionPreset: 'modular'}, {motionPreset: 'documentary'}, {density: 'restrained'}, {density: 'expressive'}, {contentType: 'other'}]) {
      expect(ok({...D1, ...patch}), JSON.stringify(patch)).toBe(true);
      expect(renderer.validateDesignTokens({...D1, ...patch}).ok, JSON.stringify(patch)).toBe(true);
    }
    for (const patch of [{cornerRadius: '14'}, {cornerRadius: Number.NaN}, {displayFont: 'comic_sans'}, {motionPreset: 'x'}, {density: 'x'}, {contentType: 'x'}, {enabled: false}, {enabled: undefined}]) {
      expect(ok({...D1, ...patch}), JSON.stringify(patch)).toBe(false);
      expect(renderer.validateDesignTokens({...D1, ...patch}).ok, JSON.stringify(patch)).toBe(false);
    }
  });

  it('a missing field, a non-object, and unknown extra fields', () => {
    const {primaryColor: _removed, ...missing} = D1;
    expect(ok(missing)).toBe(false);
    for (const value of [null, undefined, 'x', 3, [], true]) {
      expect(ok(value)).toBe(false);
      expect(renderer.validateDesignTokens(value).ok).toBe(false);
    }
    expect(ok({...D1, extraField: 1})).toBe(true); // unknown extra fields are tolerated, as the schema always did
    expect(renderer.validateDesignTokens({...D1, extraField: 1}).ok).toBe(true);
  });

  it('the renderer and the server agree, and share the same enumerations', () => {
    const shape = designTokensSchema.shape;
    expect([...shape.contentType.options].sort()).toEqual([...server.DESIGN_CONTENT_TYPES].sort());
    expect([...shape.displayFont.options].sort()).toEqual([...(['bebas', 'oswald', 'playfair', 'space_grotesk'])].sort());
    expect([...shape.density.options].sort()).toEqual([...server.DESIGN_DENSITIES].sort());
    expect([...renderer.DESIGN_COLOUR_FIELDS]).toEqual([...server.DESIGN_COLOUR_FIELDS]);
    for (const {blueprint} of CASES) {
      expect(renderer.resolveDesignTokens(blueprint).source).toBe(server.resolveDesignTokens(blueprint).source);
    }
  });

  it('never invents or defaults anything: no design in, no design out', () => {
    for (const blueprint of [{}, {designTokens: undefined}, {designTokens: {}}, {northStarDesign: {}}, {designTokens: {...D1, primaryColor: ''}}]) {
      expect(renderer.resolveDesignTokens(blueprint).tokens).toBeUndefined();
      expect(server.resolveDesignTokens(blueprint).tokens).toBeUndefined();
    }
  });
});

describe('diagnostics (production logging; no render failure)', () => {
  afterEach(() => {
    renderer.resetReportedDesignDiagnosticsForTest();
    vi.restoreAllMocks();
  });

  it('the conflict diagnostic is emitted once per distinct message, through console.warn by default', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const {diagnostics} = renderer.resolveDesignTokens({designTokens: D1, northStarDesign: D2});
    renderer.reportDesignDiagnostics(diagnostics);
    renderer.reportDesignDiagnostics(diagnostics); // a render evaluates the blueprint every frame
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toMatch(/^\[design-tokens\] design_fields_conflict: /);
  });

  it('an injected sink receives each diagnostic; nothing throws for any case', () => {
    const lines: string[] = [];
    for (const {blueprint} of CASES) {
      expect(() => renderer.reportDesignDiagnostics(renderer.resolveDesignTokens(blueprint).diagnostics, line => lines.push(line))).not.toThrow();
    }
    expect(lines.some(line => line.includes('design_tokens_invalid_ignored'))).toBe(true);
    expect(lines.some(line => line.includes('design_legacy_invalid_ignored'))).toBe(true);
    expect(lines.some(line => line.includes('design_fields_conflict'))).toBe(true);
  });

  it('server-side designDiagnosticsFor never throws, including for garbage', () => {
    for (const blueprint of [{}, {designTokens: null}, {designTokens: 5, northStarDesign: 'x'}, {designTokens: D1, northStarDesign: D2}]) {
      expect(() => server.designDiagnosticsFor(blueprint as never)).not.toThrow();
    }
    expect(server.designDiagnosticsFor({designTokens: D1, northStarDesign: D2} as never).map(item => item.code)).toEqual(['design_fields_conflict']);
  });
});

describe('render runner logs the diagnostic before rendering and never blocks the render', () => {
  it('a stored blueprint with conflicting designs: a warning is logged, the render still starts', async () => {
    vi.resetModules();
    const warn = vi.fn();
    const renderLocally = vi.fn(async () => ({outputUrl: 'file://x'}));
    vi.doMock('../lib/logger.ts', () => ({stageLogger: () => ({warn, info: vi.fn(), error: vi.fn(), debug: vi.fn()}), logger: {}}));
    vi.doMock('../store/engineStore.ts', () => ({
      loadBlueprint: async () => ({blueprintId: 'bp_x', outputDurationSec: 5, sourceDurationSec: 5, designTokens: D1, northStarDesign: D2}),
      loadRenderJob: async () => null,
      saveRenderJob: async () => undefined,
    }));
    vi.doMock('../stages/render/localRender.ts', () => ({localRenderAvailable: () => true, renderLocally}));
    vi.doMock('../stages/render/remotionLambda.ts', () => ({pollLambdaRender: vi.fn(), renderConfigured: () => false, startLambdaRender: vi.fn()}));
    vi.doMock('../stages/render/renderBudget.ts', () => ({assertRenderAllowed: async () => undefined, estimateRenderCostUsd: () => 0, recordRender: async () => undefined}));
    const {startRender} = await import('../pipeline/renderRunner.ts');
    await startRender({userId: 'u', blueprintId: 'bp_x', style: {captionTemplate: 'clean', layoutStyle: 'fullscreen', captionBottomFrac: 0.2, captionCenterXFrac: 0.5, brollEnabled: true, zoomEnabled: true, trimEnabled: true, colorGradeLut: ''} as never});
    await vi.waitFor(() => expect(renderLocally).toHaveBeenCalled());
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({code: 'design_fields_conflict', blueprintId: 'bp_x'}), expect.stringContaining('both valid but differ'));
    vi.doUnmock('../lib/logger.ts');
    vi.doUnmock('../store/engineStore.ts');
    vi.doUnmock('../stages/render/localRender.ts');
    vi.doUnmock('../stages/render/remotionLambda.ts');
    vi.doUnmock('../stages/render/renderBudget.ts');
    vi.resetModules();
  });
});

describe('dual-write (server)', () => {
  it('a valid design is written under both keys from the same object', () => {
    const {fields, warning} = server.designFieldsForBlueprint(D1);
    expect(warning).toBeUndefined();
    expect(fields.designTokens).toBe(D1);
    expect(fields.northStarDesign).toBe(D1);
    expect(JSON.parse(JSON.stringify(fields)).designTokens).toEqual(JSON.parse(JSON.stringify(fields)).northStarDesign);
  });

  it('no design: neither key is written, so the blueprint is byte-identical to before', () => {
    const {fields, warning} = server.designFieldsForBlueprint(undefined);
    expect(fields).toEqual({});
    expect(Object.keys(fields)).toEqual([]);
    expect(warning).toBeUndefined();
    const base = {blueprintId: 'bp', words: []};
    expect(JSON.stringify({...base, ...fields})).toBe(JSON.stringify(base));
  });

  it('an invalid design is NOT copied into the new key; the legacy key keeps the previous behaviour; a warning is returned', () => {
    const bad = {...D1, primaryColor: 'red'};
    const {fields, warning} = server.designFieldsForBlueprint(bad);
    expect(fields.designTokens).toBeUndefined();
    expect(fields.northStarDesign).toBe(bad);
    expect(warning).toMatch(/^design_tokens_not_written:primaryColor/);
  });

  it('the dual-written pair always resolves, in both implementations, to the written design with no diagnostic', () => {
    const blueprint = JSON.parse(JSON.stringify(server.designFieldsForBlueprint(D2).fields));
    for (const impl of [renderer, server]) {
      const result = impl.resolveDesignTokens(blueprint);
      expect(result.source).toBe('designTokens');
      expect(result.tokens).toEqual(D2);
      expect(result.conflict).toBe(false);
      expect(result.diagnostics).toEqual([]);
    }
  });

  it('every design the engine itself can build is valid (so the writer never skips a real design): all eight profile moods and the North Star builder', () => {
    const moods: VisualMood[] = ['warm_intimate', 'calm_cool', 'bold_energetic', 'clean_light', 'dark_cinematic', 'earthy_natural', 'soft_pastel', 'tech_sharp'];
    for (const mood of moods) {
      for (const accent of [undefined, '#112233', 'not-a-colour']) {
        const design = designFromProfile(parseContentProfile({...PROFILE_RESPONSE, visual_mood: mood, accent_hex: accent}));
        expect(server.designTokenProblems(design), `${mood}/${accent}`).toEqual([]);
        expect(renderer.validateDesignTokens(design).ok, `${mood}/${accent}`).toBe(true);
      }
    }
    for (const blob of ['', 'teal ocean calm', 'warm gold sun', 'bold red urgent', 'trust blue clean', 'green dark noir']) {
      const design = buildNorthStarDesign({tokens: tokensFromThesis(blob, undefined)});
      expect(server.designTokenProblems(design), blob).toEqual([]);
    }
  });

  it('provenance stays in-process: dual-writing does not serialise it', () => {
    const stamped = stampProvenance({...D1}, {primaryColor: 'profile'});
    const json = JSON.stringify(server.designFieldsForBlueprint(stamped).fields);
    expect(json).not.toMatch(/provenance|profile/);
    expect(provenanceOf(stamped, 'primaryColor')).toBe('profile');
  });
});

describe('schema (Studio / typing)', () => {
  const props = (blueprint: Record<string, unknown>) => ({blueprint: {blueprintId: 'b', videoUrl: 'x', languageCode: 'en', fps: 30, width: 270, height: 480, sourceDurationSec: 3, outputDurationSec: 3, captionWords: [], keepSegments: [{sourceStart: 0, sourceEnd: 3, outputStart: 0}], zoomTriggers: [], brollClips: [], ...blueprint}, style: {captionTemplate: 'clean', layoutStyle: 'fullscreen', captionBottomFrac: 0.2, captionCenterXFrac: 0.5, brollEnabled: true, zoomEnabled: true, trimEnabled: true, colorGradeLut: ''}});
  it('designTokens is lenient: an unusable value reads as absent and does not fail the parse', () => {
    const bad = shortVideoPropsSchema.safeParse(props({designTokens: {...D1, displayFont: 'comic_sans'}}));
    expect(bad.success).toBe(true);
    expect(bad.success && bad.data.blueprint.designTokens).toBeUndefined();
    const good = shortVideoPropsSchema.safeParse(props({designTokens: D1}));
    expect(good.success && good.data.blueprint.designTokens).toEqual(D1);
  });
  it('the legacy key is exactly as strict as before: an invalid legacy design still fails the parse', () => {
    expect(shortVideoPropsSchema.safeParse(props({northStarDesign: {...D1, displayFont: 'comic_sans'}})).success).toBe(false);
    expect(shortVideoPropsSchema.safeParse(props({northStarDesign: D1})).success).toBe(true);
    expect(timelineBlueprintSchema.shape.northStarDesign.parse(D1)).toEqual(D1);
  });
});

describe('compatibility with persisted legacy blueprints (read-only historical artifacts)', () => {
  const root = resolve(import.meta.dirname, '../../../remotion/out');
  const dirs = ['phase9-validation', 'phase10b-validation', 'phase11-validation', 'phase18-audit'].map(name => join(root, name)).filter(existsSync);
  const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : name.endsWith('.json') ? [path] : [];
  });
  const found: Array<{file: string; blueprint: Record<string, unknown>}> = [];
  for (const dir of dirs) {
    for (const file of walk(dir)) {
      try {
        const json = JSON.parse(readFileSync(file, 'utf8')) as Record<string, any>;
        const blueprint = json.blueprint?.keepSegments ? json.blueprint : json.keepSegments && json.blueprintId ? json : null;
        if (blueprint && blueprint.northStarDesign !== undefined) found.push({file, blueprint});
      } catch {
        /* not JSON we care about */
      }
    }
  }
  it('finds the persisted blueprints that carry a legacy design', () => {
    expect(found.length).toBeGreaterThanOrEqual(30);
  });
  it('every one resolves to exactly its legacy design, with no diagnostic, in both implementations', () => {
    for (const {file, blueprint} of found) {
      for (const impl of [renderer, server]) {
        const result = impl.resolveDesignTokens(blueprint);
        expect(result.source, file).toBe('northStarDesign');
        expect(result.tokens, file).toBe(blueprint.northStarDesign);
        expect(result.diagnostics, file).toEqual([]);
      }
    }
  });
  it('adding the new key to each (dual-write) changes nothing about which design is used', () => {
    for (const {blueprint} of found) {
      const dual = {...blueprint, ...server.designFieldsForBlueprint(blueprint.northStarDesign as DesignTokens).fields};
      expect(renderer.resolveDesignTokens(dual).tokens).toEqual(blueprint.northStarDesign);
    }
  });
});
