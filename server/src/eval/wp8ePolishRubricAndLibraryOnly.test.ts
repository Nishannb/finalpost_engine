/**
 * WP8E tests: (1) the library-only graphics path of the polish profile (pure helpers, the builder with a generator that fails the test if called, source pins), and (2) the offline polish rubric
 * with its fixtures. No network, no model call, no FFmpeg, no Chromium.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {
  decideClaudeBound,
  graphicsFingerprintKey,
  jobGraphicsStatus,
  libraryOnlyGraphics,
  parseStoredGraphicsStatus,
  requestGraphicsStatus,
  type ClaudeBoundDecision,
} from '../lib/productEditProfile.ts';
import {buildGeneratedGraphics, classifyWorkerFailure, LibraryMissError} from '../stages/motionDirector/buildGeneratedGraphics.ts';
import {evaluatePolishRubric, polishRubricInputFromRun, POLISH_FINGERPRINT_KEY, type PolishRubricInput} from './polishRubric.ts';

const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...parts: string[]) => readFileSync(resolve(SERVER, ...parts), 'utf8');
const fixture = (name: string) => JSON.parse(read('src', 'eval', 'fixtures', 'polish-rubric', name)) as PolishRubricInput;

const disabled: ClaudeBoundDecision = {action: 'disabled', reason: 'claude_budget_unconfigured'};
const bounded: ClaudeBoundDecision = {action: 'bounded', capUsd: 0.5, maxRequests: 3, maxTokensPerCall: 12_000, minTokensPerCall: 4_000};
const unbounded: ClaudeBoundDecision = {action: 'unbounded', why: 'legacy_unconfigured'};
const base = {graphicsOn: true, callerSuppliedGenerator: false, capUsd: 0, maxRequests: 0, maxTokensPerCall: 0, defaultMaxRequests: 6};

describe('library-only graphics: the pure helpers', () => {
  it('polish + graphics requested + Claude bound disabled -> library only', () => {
    expect(decideClaudeBound({...base, profile: 'polish'})).toEqual(disabled); // the bound itself is unchanged: still disabled
    expect(libraryOnlyGraphics('polish', true, disabled)).toBe(true);
    expect(jobGraphicsStatus({requested: true, bound: disabled, libraryOnly: true})).toBe('library_only');
  });
  it('any other case is unchanged: mvp, legacy and cuts stay fail-closed / as before', () => {
    for (const profile of ['mvp', 'legacy', 'cuts'] as const) {
      expect(libraryOnlyGraphics(profile, true, disabled), profile).toBe(false);
      expect(jobGraphicsStatus({requested: true, bound: disabled, libraryOnly: libraryOnlyGraphics(profile, true, disabled)}), profile).toBe('skipped_budget');
    }
    expect(libraryOnlyGraphics(undefined, true, disabled)).toBe(false);
    expect(jobGraphicsStatus({requested: true, bound: disabled})).toBe('skipped_budget'); // no libraryOnly given: exactly as before
  });
  it('polish with a usable bound keeps WP8D behaviour (library first, Claude fallback): status on, not library_only', () => {
    for (const bound of [bounded, unbounded]) {
      expect(libraryOnlyGraphics('polish', true, bound)).toBe(false);
      expect(jobGraphicsStatus({requested: true, bound, libraryOnly: libraryOnlyGraphics('polish', true, bound)})).toBe('on');
    }
  });
  it('graphics not requested (the default) is off everywhere, and polish with no flag is not library-only', () => {
    expect(libraryOnlyGraphics('polish', false, disabled)).toBe(false);
    expect(jobGraphicsStatus({requested: false, bound: disabled, libraryOnly: false})).toBe('off');
    expect(requestGraphicsStatus({profile: 'polish', graphicsFlag: false, capUsd: 0, maxRequests: 0, maxTokensPerCall: 0})).toBe('off');
  });
  it('the request-time status (the cache key input) matches: polish with the flag and no cap is library_only, mvp is skipped_budget, a polish cap makes it on', () => {
    const input = {graphicsFlag: true, capUsd: 0, maxRequests: 0, maxTokensPerCall: 0};
    expect(requestGraphicsStatus({...input, profile: 'polish'})).toBe('library_only');
    expect(requestGraphicsStatus({...input, profile: 'mvp'})).toBe('skipped_budget');
    expect(requestGraphicsStatus({...input, profile: 'polish', capUsd: 0.5})).toBe('on');
    expect(requestGraphicsStatus({...input, profile: 'polish', capUsd: -1})).toBe('library_only'); // an invalid bound is a disabled bound: Claude is not used either way
    expect(requestGraphicsStatus({...input, profile: 'mvp', capUsd: -1})).toBe('skipped_budget');
  });
  it('the stored status and the cache key know the new value; the old values are untouched', () => {
    expect(parseStoredGraphicsStatus('library_only')).toBe('library_only');
    for (const old of ['off', 'on', 'skipped_budget']) expect(parseStoredGraphicsStatus(old)).toBe(old);
    expect(parseStoredGraphicsStatus('claude_allowed')).toBeUndefined();
    expect(graphicsFingerprintKey('library_only')).toBe('graphics:library_only');
    expect(graphicsFingerprintKey('on')).toBe('graphics:on');
    expect(graphicsFingerprintKey('off')).toBe('');
    expect(new Set(['on', 'skipped_budget', 'library_only'].map(status => graphicsFingerprintKey(status as 'on'))).size).toBe(3);
  });
});

const motionBrief = (id: string, content: Record<string, unknown>) => ({id, goal: 'g', visualDescription: 'v', placement: 'full_screen', durationSeconds: 3, content});
const directed = (brief: ReturnType<typeof motionBrief>, start: number) => ({brief: brief as never, start, end: start + 3, reason: 'r'});
const upload = async (_code: string, sha: string) => `https://cdn.example/${sha}.js`;

describe('library-only graphics: the builder', () => {
  it('claudeAllowed false: library hits are delivered, misses are dropped as library_miss, and the generator is never called', async () => {
    const calls: unknown[] = [];
    const generator = async () => {
      calls.push(1);
      throw new Error('the generator must not be called in library-only mode');
    };
    const outcome = await buildGeneratedGraphics(
      [directed(motionBrief('quote_1', {quote: 'Ship small', author: 'Ada'}), 1), directed(motionBrief('odd_1', {mood: 'calm'}), 5), directed(motionBrief('vs_1', {left: 'NO CLUE', right: 'EXPERT'}), 9)],
      {generator, upload, runtimeCheck: false, preferLibrary: true, claudeAllowed: false},
    );
    expect(calls).toEqual([]);
    expect(outcome.generatedGraphics.map(graphic => graphic.id)).toEqual(['quote_1', 'vs_1']);
    expect(outcome.failures).toEqual([{id: 'odd_1', reason: 'library_miss_no_claude', kind: 'library_miss', provider: 'unknown'}]);
    expect(outcome.provenance.map(item => item.source)).toEqual(['library', 'library']);
    expect(outcome.claudeCostUsd).toBe(0);
    expect(outcome.ledger).toEqual([]);
  }, 90_000);
  it('claudeAllowed true or omitted: a miss still reaches the generator (WP8D behaviour)', async () => {
    const calls: unknown[] = [];
    const generator = async () => {
      calls.push(1);
      return {text: 'no code', stopReason: 'end_turn', model: 'claude-sonnet-5-5', usage: {inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0}};
    };
    for (const claudeAllowed of [true, undefined]) {
      calls.length = 0;
      await buildGeneratedGraphics([directed(motionBrief('odd_2', {mood: 'calm'}), 1)], {generator, upload, runtimeCheck: false, preferLibrary: true, claudeAllowed, maxRepairAttempts: 0});
      expect(calls, String(claudeAllowed)).toHaveLength(1);
    }
  }, 60_000);
  it('a library miss is classified as its own failure kind, not a provider error', () => {
    expect(classifyWorkerFailure(new LibraryMissError('x'))).toEqual({kind: 'library_miss', provider: 'unknown'});
  });
});

describe('library-only graphics: the wiring (source text)', () => {
  const analyze = read('src', 'pipeline', 'analyzeVideo.ts');
  const stage = read('src', 'stages', 'motionDirector', 'index.ts');
  const builder = read('src', 'stages', 'motionDirector', 'buildGeneratedGraphics.ts');
  it('analyzeVideo derives libraryOnly from the profile helper, runs the stage when Claude is allowed OR library-only, reports the status, and warns', () => {
    expect(analyze).toContain('const libraryOnly = libraryOnlyGraphics(input.editProfile, motionGraphicsRequested, claudeBound);');
    expect(analyze).toContain("const claudeAllowed = claudeBound.action !== 'disabled';");
    expect(analyze).toContain('const motionGraphicsOn = motionGraphicsRequested && (claudeAllowed || libraryOnly);');
    expect(analyze).toContain('hooks.onGraphicsDecision?.(jobGraphicsStatus({requested: motionGraphicsRequested, bound: claudeBound, libraryOnly}));');
    expect(analyze).toContain("warnings.push('motion_graphics:library_only');");
    expect(analyze).toContain('warnings.push(`claude_graphics_disabled:${claudeBound.reason}`);'); // the disabled Claude bound is still reported
    expect(analyze).toContain('claudeAllowed, // WP8E: false = library hits only; the generator is never called');
  });
  it('the profile helper scopes it to polish alone', () => {
    const profile = read('src', 'lib', 'productEditProfile.ts');
    expect(profile).toContain("return profile === 'polish' && requested && bound.action === 'disabled';");
    expect(profile).toContain('libraryOnly: libraryOnlyGraphics(input.profile, input.graphicsFlag, bound)');
  });
  it('the stage passes claudeAllowed through and warns once per library miss; the builder returns before the generator', () => {
    expect(stage).toContain('claudeAllowed?: boolean;');
    expect(stage).toContain('claudeAllowed: input.claudeAllowed, ');
    expect(stage).toContain("failure.kind === 'library_miss').map(failure => `motion_graphic:library_miss_no_claude:${failure.id}`)");
    const gate = builder.indexOf('if (options.claudeAllowed === false) {');
    expect(gate).toBeGreaterThan(builder.indexOf('if (options.preferLibrary) {'));
    expect(gate).toBeLessThan(builder.indexOf('outcome.result = await generateMotionGraphic('));
    expect(builder).toContain('outcome.error = new LibraryMissError(outcome.item.brief.id);');
  });
  it('the economy defaults are unchanged: graphics off by default, the profile default is cuts, mvp still needs the Claude bound', () => {
    const env = read('src', 'config', 'env.ts');
    expect(env).toContain('MOTION_GRAPHICS_ENABLED: bool(false),');
    expect(env).toContain("PRODUCT_EDIT_PROFILE: str('cuts'),");
    expect(read('src', 'lib', 'productEditProfile.ts')).toContain("if (input.capUsd === 0) return isMvpLikeProfile(input.profile) ? {action: 'disabled', reason: 'claude_budget_unconfigured'}");
  });
  it('a strict run treats a library miss as a failure that is never excusable', () => {
    const strict = read('src', 'pipeline', 'strictOutcome.ts');
    expect(strict).toContain("| 'library_miss'");
    expect(strict).toContain("new Set(['refused', 'conflict_dropped'])");
  });
});

describe('the polish rubric', () => {
  const ids = (result: ReturnType<typeof evaluatePolishRubric>) => result.checks.map(item => item.id);
  it('runs the seven checks in a fixed order', () => {
    expect(ids(evaluatePolishRubric(fixture('good-talking-head-library-only.json')))).toEqual([
      'edit_look_present', 'no_matte_kinds_unusable', 'graphics_provenance', 'look_allowlist', 'captions_present', 'library_only_honest', 'profile_markers',
    ]);
  });
  it('fixture: a good talking_head, library-only run passes every check', () => {
    const result = evaluatePolishRubric(fixture('good-talking-head-library-only.json'));
    expect(result.checks.filter(item => !item.ok)).toEqual([]);
    expect(result.pass).toBe(true);
  });
  it('fixture: depth / cutout under an unusable matte, an illegal kind, missing provenance and a dishonest library_only all fail', () => {
    const result = evaluatePolishRubric(fixture('bad-depth-unusable-matte.json'));
    expect(result.pass).toBe(false);
    const failed = Object.fromEntries(result.checks.filter(item => !item.ok).map(item => [item.id, item.detail]));
    expect(Object.keys(failed).sort()).toEqual(['graphics_provenance', 'library_only_honest', 'look_allowlist', 'no_matte_kinds_unusable', 'profile_markers']);
    expect(failed.no_matte_kinds_unusable).toContain('depth_overlay');
    expect(failed.no_matte_kinds_unusable).toContain('cutout');
    expect(failed.look_allowlist).toContain('lockup'); // explainer_cutaway does not allow lockup
    expect(failed.profile_markers).toContain('edit-profile:cuts-v1');
  });
  it('fixture: a minimal_captions fallback that was warned passes', () => {
    const result = evaluatePolishRubric(fixture('minimal-captions-fallback.json'));
    expect(result.checks.filter(item => !item.ok)).toEqual([]);
    expect(result.checks.find(item => item.id === 'edit_look_present')!.detail).toContain('fallback');
  });
  it('edit_look_present: an unwarned fallback, an unknown look and no look fail', () => {
    const good = fixture('minimal-captions-fallback.json');
    expect(evaluatePolishRubric({...good, warnings: good.warnings.filter(w => !w.startsWith('edit_look_fallback'))}).checks[0]).toMatchObject({id: 'edit_look_present', ok: false});
    expect(evaluatePolishRubric({...good, editLook: {id: 'bonomi_deluxe'}}).checks[0]!.ok).toBe(false);
    expect(evaluatePolishRubric({...good, editLook: null}).checks[0]!.detail).toContain('no edit look');
  });
  it('no_matte_kinds_unusable: kept cutout is fine when the matte was usable or never reported unusable', () => {
    const good = fixture('good-talking-head-library-only.json');
    expect(good.elementKinds).toContain('cutout');
    expect(evaluatePolishRubric(good).checks[1]!.ok).toBe(true);
    expect(evaluatePolishRubric({...good, warnings: [...good.warnings, 'matte_gate:unusable:extract_failed']}).checks[1]).toMatchObject({ok: false});
  });
  it('graphics_provenance: per-graphic field or matching warning counts; neither fails; no graphics passes', () => {
    const good = fixture('good-talking-head-library-only.json');
    expect(evaluatePolishRubric({...good, generatedGraphics: [{id: 'a'}], warnings: ['motion_graphic:library:VsClaim']}).checks[2]!.ok).toBe(true);
    expect(evaluatePolishRubric({...good, generatedGraphics: [{id: 'a'}, {id: 'b'}], warnings: ['motion_graphic:library:VsClaim']}).checks[2]!.ok).toBe(false);
    expect(evaluatePolishRubric({...good, generatedGraphics: [{id: 'a'}], warnings: ['motion_graphic:library_miss_no_claude:x']}).checks[2]!.ok).toBe(false);
    expect(evaluatePolishRubric({...good, generatedGraphics: []}).checks[2]!.ok).toBe(true);
  });
  it('look_allowlist: a graphic count over the look cap fails', () => {
    const good = fixture('good-talking-head-library-only.json');
    expect(evaluatePolishRubric({...good, elementKinds: ['zoom', 'kinetic_text', 'lockup', 'depth_overlay', 'kinetic_text', 'lockup', 'kinetic_text']}).checks[3]!.detail).toContain('exceed');
  });
  it('captions_present: no caption plan fails unless the look is the explicit minimal one', () => {
    const good = fixture('good-talking-head-library-only.json');
    expect(evaluatePolishRubric({...good, captionPresent: false}).checks[4]!.ok).toBe(false);
    expect(evaluatePolishRubric({...fixture('minimal-captions-fallback.json'), captionPresent: false}).checks[4]!.ok).toBe(true);
  });
  it('profile_markers: only provided markers are judged', () => {
    const good = fixture('good-talking-head-library-only.json');
    const bare = {...good, profile: undefined, fingerprintKey: undefined, speechCutsApplied: undefined};
    expect(evaluatePolishRubric(bare).checks[6]!.ok).toBe(true);
    expect(evaluatePolishRubric({...bare, speechCutsApplied: false}).checks[6]!.ok).toBe(false);
    expect(evaluatePolishRubric({...bare, profile: 'mvp'}).checks[6]!.ok).toBe(false);
    expect(evaluatePolishRubric({...bare, fingerprintKey: POLISH_FINGERPRINT_KEY}).checks[6]!.ok).toBe(true);
  });
  it('the run adapter builds the input from a plan, graphics, provenance and caption count (nothing guessed)', () => {
    const input = polishRubricInputFromRun({
      profile: 'polish',
      warnings: ['edit_look:talking_head', 'motion_graphic:library:VsClaim'],
      plan: {editLook: {id: 'talking_head'}, elements: [{kind: 'zoom'}, {kind: 'kinetic_text'}]},
      generatedGraphics: [{id: 'vs_1'}],
      provenance: [{id: 'vs_1', source: 'library', compositionId: 'VsClaim'}],
      captionWordCount: 120,
      graphicsStatus: 'library_only',
    });
    expect(input).toMatchObject({elementKinds: ['zoom', 'kinetic_text'], generatedGraphics: [{id: 'vs_1', provenance: 'library', compositionId: 'VsClaim'}], captionPresent: true});
    expect(evaluatePolishRubric(input).pass).toBe(true);
    const empty = polishRubricInputFromRun({});
    expect(empty).toMatchObject({elementKinds: [], captionPresent: false, editLook: null});
    expect(evaluatePolishRubric(empty).pass).toBe(false);
  });
  it('is deterministic and pure: no imports beyond the look table, no env, logger, network or file access', () => {
    const input = fixture('bad-depth-unusable-matte.json');
    const before = JSON.stringify(input);
    expect(evaluatePolishRubric(input)).toEqual(evaluatePolishRubric(input));
    expect(JSON.stringify(input)).toBe(before);
    const module_ = read('src', 'eval', 'polishRubric.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect([...module_.matchAll(/^import .* from '([^']+)'/gm)].map(match => match[1])).toEqual(['../stages/directorV2/editLooks.ts']);
    for (const word of ['process.env', 'fetch(', 'logger', 'readFile', 'spawn']) expect(module_).not.toContain(word);
  });
  it('the three fixtures exist, are valid JSON, and say they are synthetic', () => {
    for (const name of ['good-talking-head-library-only.json', 'bad-depth-unusable-matte.json', 'minimal-captions-fallback.json']) {
      expect(read('src', 'eval', 'fixtures', 'polish-rubric', name)).toContain('Synthetic fixture (not a real run)');
    }
  });
});
