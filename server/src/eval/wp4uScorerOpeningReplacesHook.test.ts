/**
 * WP4U pure tests: row 1 of the offline scorer accepts an empty hook title when an art-directed opening treatment is present (it replaces the standard hook). rubricScorer.ts imports
 * renderIntegrity (-> errors -> billingGuard) and groundedText; no logger, SDK, FFmpeg, Chromium, network or model call. The four unsafe suites are not run.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {scoreRubric} from './rubricScorer.ts';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts: string[]) => readFileSync(resolve(SRC, ...parts), 'utf8');
const CLEARED = 'legibility:ungrounded_hook_cleared';

type Json = Record<string, unknown>;
const bp = (over: Json = {}): Json => ({width: 1080, height: 1920, outputDurationSec: 30, hookTitle: 'Save time', motionGraphics: [], semanticEmphasis: [], generatedGraphics: [], visualOverlays: [], behindSubjectTexts: [], brollClips: [], ...over});
const row1 = (blueprint: Json) => scoreRubric({blueprint}).rows.find(item => item.row === 1)!;
const check = (r: ReturnType<typeof row1>, id: string) => r.checks.find(item => item.id === id)!;
const opening = (text: unknown = 'Stay calm') => ({text, kind: 'plain', centerY: 0.3, widthFrac: 0.6, heightFrac: 0.18, align: 'center', startSec: 0, durationSec: 3});
const stats = (warnings: unknown) => ({stats: {warnings}});
const detail = (c: ReturnType<typeof check>) => JSON.stringify(c);

describe('an empty title with an opening treatment', () => {
  it('passes hook_title_present and cites openingTreatment.text', () => {
    for (const title of ['', '   ', undefined]) {
      const c = check(row1(bp({hookTitle: title, openingTreatment: opening('Stay calm')})), 'hook_title_present');
      expect(c.status, String(title)).toBe('pass');
      expect(c.evidence).toEqual(expect.arrayContaining([{path: 'openingTreatment.text', value: 'Stay calm'}]));
      expect(detail(c)).toMatch(/art-directed opening/);
    }
  });
  it('a text of any length counts, including an empty string left by later grounding', () => {
    for (const text of ['', ' ', 'x', 'a much longer opening wording that spans several words in the frame']) {
      expect(check(row1(bp({hookTitle: '', openingTreatment: opening(text)})), 'hook_title_present').status, JSON.stringify(text)).toBe('pass');
    }
  });
  it('no fit is invented: without legibility.hook the box and band checks stay not_checked, and the row does not fail', () => {
    const r = row1(bp({hookTitle: '', openingTreatment: opening()}));
    expect(check(r, 'hook_box_in_frame').status).toBe('not_checked');
    expect(check(r, 'hook_clear_band').status).toBe('not_checked');
    expect(r.status).not.toBe('fail');
  });
});

describe('an empty title with nothing to explain it still fails', () => {
  it('no opening, no cleared warning, no optional policy', () => {
    for (const blueprint of [bp({hookTitle: ''}), bp({hookTitle: undefined}), bp({hookTitle: '', ...stats(['occupancy_vision'])})]) {
      const r = row1(blueprint);
      expect(check(r, 'hook_title_present').status).toBe('fail');
      expect(r.status).toBe('fail');
    }
  });
  it('an openingTreatment that is not an object with a string text does not count', () => {
    for (const value of [null, undefined, 'Stay calm', 42, true, [], [opening()], {}, {text: 7}, {text: null}, {kind: 'plain'}]) {
      expect(check(row1(bp({hookTitle: '', openingTreatment: value})), 'hook_title_present').status, JSON.stringify(value)).toBe('fail');
    }
  });
});

describe('check order: non-empty title, optional policy, cleared warning, opening present, fail', () => {
  it('a non-empty title passes as before, with or without an opening (and its evidence is the title\'s)', () => {
    const plain = check(row1(bp()), 'hook_title_present');
    const withOpening = check(row1(bp({openingTreatment: opening()})), 'hook_title_present');
    expect(plain.status).toBe('pass');
    expect(withOpening.status).toBe('pass');
    expect(withOpening.evidence).toEqual(expect.arrayContaining([{path: 'hookTitle', value: 'Save time'}]));
    expect(detail(withOpening)).not.toContain('openingTreatment');
    expect(detail(withOpening)).toBe(detail(plain));
  });
  it('the optional policy still wins over an opening, with its own evidence', () => {
    const c = check(row1(bp({hookTitle: '', openingTreatment: opening(), ...stats(['hook_title_policy:optional'])})), 'hook_title_present');
    expect(c.status).toBe('pass');
    expect(detail(c)).toContain('hook_title_policy:optional');
    expect(detail(c)).not.toContain('openingTreatment');
  });
  it('the cleared-hook warning wins over an opening (the WP4T path is reported; either way it passes)', () => {
    const c = check(row1(bp({hookTitle: '', openingTreatment: opening(), ...stats([CLEARED])})), 'hook_title_present');
    expect(c.status).toBe('pass');
    expect(detail(c)).toContain(CLEARED);
    expect(detail(c)).not.toContain('openingTreatment.text');
  });
  it('the cleared-hook warning alone (no opening) still passes, as in WP4T', () => {
    expect(check(row1(bp({hookTitle: '', ...stats([CLEARED])})), 'hook_title_present').status).toBe('pass');
  });
});

describe('the rest is unchanged', () => {
  it('a recorded hook fit is still judged: box and band checks pass or fail as before', () => {
    const fit = {sizeFrac: 0.06, widthFrac: 0.88, topFrac: 0.06, heightFrac: 0.12, lines: 2, inkColor: '#fff', accentColor: '#f00', plateColor: '#000', clearBand: true, shortened: false};
    const r = row1(bp({hookTitle: '', openingTreatment: opening(), legibility: {version: 1, hook: fit, captions: {avoidSplitFace: true}}}));
    expect(check(r, 'hook_box_in_frame').status).toBe('pass');
    expect(check(r, 'hook_clear_band').status).toBe('pass');
  });
  it('row 6 still does not read the opening\'s wording: an unspoken opening text does not fail it', () => {
    const report = scoreRubric({blueprint: bp({hookTitle: '', openingTreatment: opening('Totally invented words')}), transcript: 'Today I use Premiere Pro to cut my videos.'});
    const six = report.rows.find(item => item.row === 6)!;
    expect(six.status).toBe('pass');
    expect(six.checks.map(item => item.id)).not.toContain('opening_text_in_transcript');
  });
  it('the other rows and notScored are as they were', () => {
    const report = scoreRubric({blueprint: bp()});
    expect(report.rows.map(item => item.row)).toEqual([1, 2, 3, 4, 5, 6, 9]);
    expect(report.notScored).toEqual([7, 8, 10]);
  });
});

describe('source text', () => {
  const scorer = read('eval', 'rubricScorer.ts');
  it('the new branch sits after the cleared-hook branch and before the failure', () => {
    const policy = scorer.indexOf("else if (policy) checks.push(check('hook_title_present', 'pass'");
    const cleared = scorer.indexOf('else if (Array.isArray(warnings) && warnings.includes(CLEARED_HOOK_WARNING))');
    const opening = scorer.indexOf("else if (isObject(get(bp, 'openingTreatment')) && typeof get(bp, 'openingTreatment.text') === 'string')");
    const failure = scorer.indexOf("else checks.push(check('hook_title_present', 'fail'");
    expect(policy).toBeGreaterThan(0);
    expect(cleared).toBeGreaterThan(policy);
    expect(opening).toBeGreaterThan(cleared);
    expect(failure).toBeGreaterThan(opening);
  });
  it('the writer, the caller and the scorer\'s imports are untouched', () => {
    expect(read('pipeline', 'analyzeVideo.ts')).toContain('if (!openingSpec) {\n        broll.hookTitle = legible.hookTitle;');
    expect(read('stages', 'broll', 'legibility.ts')).toContain("warnings: ['legibility:ungrounded_hook_cleared']");
    const imports = [...scorer.matchAll(/^import .* from '([^']+)'/gm)].map(match => match[1] as string);
    expect(imports.some(item => /legibility|logger|analyzeVideo/.test(item))).toBe(false);
  });
  it('the defaults are untouched', () => {
    const env = read('config', 'env.ts');
    expect(env).toMatch(/PRODUCT_EDIT_PROFILE:[^\n]*cuts/);
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED:\s*bool\(false\)/);
  });
});
