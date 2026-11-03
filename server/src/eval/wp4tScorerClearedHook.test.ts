/**
 * WP4T pure tests: row 1 of the offline scorer treats an empty hook title as intentional when the writer recorded legibility:ungrounded_hook_cleared. rubricScorer.ts imports renderIntegrity
 * (-> errors -> billingGuard) and groundedText; no logger, SDK, FFmpeg, Chromium, network or model call. The four unsafe suites are not run.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {scoreRubric} from './rubricScorer.ts';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts: string[]) => readFileSync(resolve(SRC, ...parts), 'utf8');
const WARNING = 'legibility:ungrounded_hook_cleared';

type Json = Record<string, unknown>;
const bp = (over: Json = {}): Json => ({width: 1080, height: 1920, outputDurationSec: 30, hookTitle: 'Save time', motionGraphics: [], semanticEmphasis: [], generatedGraphics: [], visualOverlays: [], behindSubjectTexts: [], brollClips: [], ...over});
const row1 = (blueprint: Json) => scoreRubric({blueprint}).rows.find(item => item.row === 1)!;
const check = (r: ReturnType<typeof row1>, id: string) => r.checks.find(item => item.id === id)!;
const stats = (warnings: unknown) => ({stats: {warnings}});
const fit = {sizeFrac: 0.06, widthFrac: 0.88, topFrac: 0.06, heightFrac: 0.12, lines: 2, inkColor: '#fff', accentColor: '#f00', plateColor: '#000', clearBand: true, shortened: false};

describe('an empty title with the cleared-hook warning', () => {
  it('passes hook_title_present and cites the warning', () => {
    for (const title of ['', '   ', undefined]) {
      const c = check(row1(bp({hookTitle: title, ...stats([WARNING])})), 'hook_title_present');
      expect(c.status, String(title)).toBe('pass');
      expect(c.evidence).toEqual(expect.arrayContaining([{path: 'stats.warnings', value: WARNING}]));
      expect(c.detail ?? c.message ?? JSON.stringify(c)).toMatch(/cleared an ungrounded hook/);
    }
  });
  it('also when the warning sits among other warnings', () => {
    expect(check(row1(bp({hookTitle: '', ...stats(['occupancy_vision', WARNING, 'x'])})), 'hook_title_present').status).toBe('pass');
  });
  it('the box and band checks stay not_checked when the blueprint has no legibility.hook (no fit is invented)', () => {
    const r = row1(bp({hookTitle: '', ...stats([WARNING]), legibility: {version: 1, captions: {avoidSplitFace: true}}}));
    expect(check(r, 'hook_box_in_frame').status).toBe('not_checked');
    expect(check(r, 'hook_clear_band').status).toBe('not_checked');
    expect(r.status).not.toBe('fail');
  });
});

describe('what still fails or passes as before', () => {
  it('an empty title with neither signal fails', () => {
    for (const blueprint of [bp({hookTitle: ''}), bp({hookTitle: '', ...stats([])}), bp({hookTitle: '', ...stats(['occupancy_vision'])}), bp({hookTitle: undefined})]) {
      const r = row1(blueprint);
      expect(check(r, 'hook_title_present').status).toBe('fail');
      expect(r.status).toBe('fail');
    }
  });
  it('the exact string is required: near misses do not count', () => {
    for (const warning of ['legibility:ungrounded_hook_cleared:1', 'ungrounded_hook_cleared', 'LEGIBILITY:UNGROUNDED_HOOK_CLEARED', 'legibility:ungrounded_text_dropped:1']) {
      expect(check(row1(bp({hookTitle: '', ...stats([warning])})), 'hook_title_present').status, warning).toBe('fail');
    }
    expect(check(row1(bp({hookTitle: '', ...stats(WARNING)})), 'hook_title_present').status).toBe('fail'); // a string, not a list
  });
  it('the optional policy still passes an empty title, with its own evidence', () => {
    const c = check(row1(bp({hookTitle: '', ...stats(['hook_title_policy:optional'])})), 'hook_title_present');
    expect(c.status).toBe('pass');
    expect(c.evidence).toEqual(expect.arrayContaining([{path: 'stats.warnings', value: 'hook_title_policy:optional'}]));
    expect(JSON.stringify(c)).not.toContain(WARNING);
  });
  it('the optional policy wins when both signals are present (the existing path is first)', () => {
    const c = check(row1(bp({hookTitle: '', ...stats(['hook_title_policy:optional', WARNING])})), 'hook_title_present');
    expect(c.status).toBe('pass');
    expect(JSON.stringify(c.evidence)).toContain('hook_title_policy:optional');
  });
  it('a non-empty title passes, with or without the warning, and the evidence is unchanged by the warning', () => {
    const plain = check(row1(bp()), 'hook_title_present');
    const withWarning = check(row1(bp({...stats([WARNING])})), 'hook_title_present');
    expect(plain.status).toBe('pass');
    expect(withWarning.status).toBe('pass');
    expect(withWarning.evidence).toEqual(expect.arrayContaining([{path: 'hookTitle', value: 'Save time'}]));
    expect(JSON.stringify(withWarning.evidence)).not.toContain(WARNING);
    expect(withWarning.detail ?? withWarning.message).toBe(plain.detail ?? plain.message);
  });
});

describe('the rest of row 1 is unchanged', () => {
  it('with a fit recorded, the box and band checks run as before', () => {
    const r = row1(bp({hookTitle: 'Save time', legibility: {version: 1, hook: fit, captions: {avoidSplitFace: true}}}));
    expect(check(r, 'hook_box_in_frame').status).toBe('pass');
    expect(check(r, 'hook_clear_band').status).toBe('pass');
    expect(check(row1(bp({legibility: {version: 1, hook: {...fit, clearBand: false}, captions: {avoidSplitFace: true}}})), 'hook_clear_band').status).toBe('fail');
  });
  it('the ledger check is unchanged', () => {
    expect(check(row1(bp()), 'ledger_hook_title_survived').status).toBe('not_checked');
    const r = scoreRubric({blueprint: bp({hookTitle: '', ...stats([WARNING])}), ledger: {edits: [{type: 'hook_title', final: null}]}}).rows.find(item => item.row === 1)!;
    expect(check(r, 'ledger_hook_title_survived').status).toBe('fail');
  });
  it('the other rows and notScored are as they were', () => {
    const report = scoreRubric({blueprint: bp()});
    expect(report.rows.map(item => item.row)).toEqual([1, 2, 3, 4, 5, 6, 9]);
    expect(report.notScored).toEqual([7, 8, 10]);
  });
});

describe('source text', () => {
  const scorer = read('eval', 'rubricScorer.ts');
  it('the new branch comes after the optional-policy branch and before the failure, and uses the exact string', () => {
    expect(scorer).toContain("const CLEARED_HOOK_WARNING = 'legibility:ungrounded_hook_cleared';");
    const policy = scorer.indexOf("else if (policy) checks.push(check('hook_title_present', 'pass'");
    const cleared = scorer.indexOf('else if (Array.isArray(warnings) && warnings.includes(CLEARED_HOOK_WARNING))');
    const failure = scorer.indexOf("else checks.push(check('hook_title_present', 'fail'");
    expect(policy).toBeGreaterThan(0);
    expect(cleared).toBeGreaterThan(policy);
    expect(failure).toBeGreaterThan(cleared);
  });
  it('the writer, the caller and the policy are not touched by this package', () => {
    const writer = read('stages', 'broll', 'legibility.ts');
    expect(writer).toContain("warnings: ['legibility:ungrounded_hook_cleared']");
    expect(read('pipeline', 'analyzeVideo.ts')).toContain('if (!openingSpec) {\n        broll.hookTitle = legible.hookTitle;');
    expect(read('config', 'env.ts')).toMatch(/HOOK_TITLE_POLICY:/);
  });
  it('the scorer imports are unchanged (no writer, no logger)', () => {
    const imports = [...scorer.matchAll(/^import .* from '([^']+)'/gm)].map(match => match[1]);
    expect(imports.some(item => /legibility|logger/.test(item as string))).toBe(false);
  });
  it('the defaults are untouched', () => {
    const env = read('config', 'env.ts');
    expect(env).toMatch(/PRODUCT_EDIT_PROFILE:[^\n]*cuts/);
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED:\s*bool\(false\)/);
  });
});
