/**
 * WP5C tests: legibility:no_opening_hook is decided after finalizeEdits, from the hook title that is written and from whether the opening's behind-subject entry SURVIVED the shared validator.
 * stages/broll/legibility.ts is pure; analyzeVideo.ts (logger) is read as text. No render, no Chromium, no network, no model call. The four unsafe suites are not run.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {absentOpeningHookWarning, openingIsPresent, survivingOpeningBehindSubject} from '../stages/broll/legibility.ts';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts: string[]) => readFileSync(resolve(SRC, ...parts), 'utf8');
const stripComments = (source: string) => source.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

const entry = (over: Partial<{start: number; end: number; text: string}> = {}) => ({start: 0, end: 3, text: 'Stay calm', centerY: 0.3, ...over});
/** What the call site computes. */
const warningFor = (openingSpec: unknown, behind: ReturnType<typeof entry> | undefined, finalTexts: Array<ReturnType<typeof entry>>, hookTitle: string) =>
  absentOpeningHookWarning(openingIsPresent(openingSpec, survivingOpeningBehindSubject(behind, finalTexts)), hookTitle);

describe('survivingOpeningBehindSubject', () => {
  it('the same object in the final list survives', () => {
    const e = entry();
    expect(survivingOpeningBehindSubject(e, [entry({start: 9, text: 'other'}), e])).toBe(e);
  });
  it('a rebuilt entry with the same start and text survives', () => {
    const e = entry();
    expect(survivingOpeningBehindSubject(e, [{...e}])).toBe(e);
  });
  it('a shortened entry (same start, non-empty text that is part of the original) survives', () => {
    const e = entry({text: 'Stay calm under pressure'});
    expect(survivingOpeningBehindSubject(e, [{...e, text: 'Stay calm'}])).toBe(e);
  });
  it('removed: an empty list, a different start, an unrelated text, or an empty text does not survive', () => {
    const e = entry();
    expect(survivingOpeningBehindSubject(e, [])).toBeUndefined();
    expect(survivingOpeningBehindSubject(e, [entry({start: 2})])).toBeUndefined();
    expect(survivingOpeningBehindSubject(e, [entry({text: 'Something else'})])).toBeUndefined();
    expect(survivingOpeningBehindSubject(e, [entry({text: '   '})])).toBeUndefined();
  });
  it('no entry gives undefined, and the input list is not modified', () => {
    expect(survivingOpeningBehindSubject(undefined, [entry()])).toBeUndefined();
    expect(survivingOpeningBehindSubject(null, [entry()])).toBeUndefined();
    const list = Object.freeze([Object.freeze(entry())]);
    expect(() => survivingOpeningBehindSubject(entry(), list)).not.toThrow();
  });
  it('a different entry at the same start with a different text (a graphic\'s behind-subject text) does not count as the opening\'s', () => {
    expect(survivingOpeningBehindSubject(entry({text: 'Stay calm'}), [entry({text: 'Premiere Pro'})])).toBeUndefined();
  });
});

describe('the warning after finalizeEdits', () => {
  it('a behind-subject opening removed by the validator, no spec, empty hook: the warning', () => {
    expect(warningFor(null, entry(), [], '')).toBe('legibility:no_opening_hook');
  });
  it('a behind-subject opening that survived, empty hook: no warning', () => {
    const e = entry();
    expect(warningFor(null, e, [e], '')).toBeNull();
  });
  it('a shortened survivor counts as present', () => {
    const e = entry({text: 'Stay calm under pressure'});
    expect(warningFor(null, e, [{...e, text: 'Stay calm'}], '')).toBeNull();
  });
  it('a spec alone is present whether or not any behind-subject entry survives', () => {
    expect(warningFor({text: 'Stay calm'}, undefined, [], '')).toBeNull();
    expect(warningFor({text: 'Stay calm'}, entry(), [], '')).toBeNull();
  });
  it('no opening of either kind with an empty hook: the warning; with a hook title: none', () => {
    expect(warningFor(null, undefined, [], '')).toBe('legibility:no_opening_hook');
    expect(warningFor(null, undefined, [], '   ')).toBe('legibility:no_opening_hook');
    expect(warningFor(null, undefined, [], 'Save time')).toBeNull();
    expect(warningFor(null, entry(), [], 'Save time')).toBeNull();
  });
});

describe('analyzeVideo (source text; it imports the logger)', () => {
  const analyze = stripComments(read('pipeline', 'analyzeVideo.ts'));
  const finalizeAt = analyze.indexOf('const finalized = finalizeEdits({');
  it('the warning is computed once, after finalizeEdits, with the survivor and the written hook title, and pushed only when non-null', () => {
    expect(analyze.match(/absentOpeningHookWarning\(/g)).toHaveLength(1);
    expect(analyze.match(/survivingOpeningBehindSubject\(/g)).toHaveLength(1);
    const call = analyze.indexOf('absentOpeningHookWarning(');
    expect(call).toBeGreaterThan(finalizeAt);
    expect(analyze).toContain('const survivedBehind = survivingOpeningBehindSubject(openingBehindSubject, finalized.behindSubjectTexts);');
    expect(analyze).toContain('const noOpeningHook = absentOpeningHookWarning(openingIsPresent(openingSpec, survivedBehind), broll.hookTitle);');
    expect(analyze).toContain('if (noOpeningHook) warnings.push(noOpeningHook);');
  });
  it('the push is no longer before finalizeEdits, and it still follows the opening, legibility and hook-writing decisions', () => {
    const before = analyze.slice(0, finalizeAt);
    expect(before).not.toContain('warnings.push(noOpeningHook)');
    expect(before).not.toContain('absentOpeningHookWarning(');
    expect(analyze.indexOf('absentOpeningHookWarning(')).toBeGreaterThan(analyze.indexOf('openingSpec = resolved.spec;'));
    expect(analyze.indexOf('absentOpeningHookWarning(')).toBeGreaterThan(analyze.indexOf('broll.hookTitle = legible.hookTitle;'));
  });
  it('it stays on the mvp path: inside the `if (legibility)` block that only the mvp branch can enter', () => {
    const after = analyze.slice(finalizeAt);
    const block = after.slice(after.indexOf('if (legibility) {'));
    expect(block.indexOf('absentOpeningHookWarning(')).toBeGreaterThan(0);
    expect(block.indexOf('absentOpeningHookWarning(')).toBeLessThan(block.indexOf('broll.frameInsets = finalized.frameInsets;'));
    expect(analyze).toMatch(/let legibility: LegibilitySpec \| undefined;/);
    expect(analyze).toContain("if (mvpLike && !captionsOnly) {");
  });
  it('the hook title read is the one written to the blueprint (finalizeEdits does not rewrite it)', () => {
    expect(analyze).toContain('hookTitle: broll.hookTitle,');
    expect(stripComments(read('pipeline', 'finalizeEdits.ts'))).not.toMatch(/hookTitle/);
  });
  it('the shared validator, the scorer, the writer\'s clearing and the helpers\' strings are unchanged', () => {
    const legibility = stripComments(read('stages', 'broll', 'legibility.ts'));
    expect(legibility).toContain("export const NO_OPENING_HOOK_WARNING = 'legibility:no_opening_hook';");
    expect(legibility).toContain("return !openingPresent && (typeof hookTitle !== 'string' || hookTitle.trim() === '') ? NO_OPENING_HOOK_WARNING : null;");
    expect(legibility).toContain('return Boolean(openingSpec) || Boolean(openingBehindSubject);');
    expect(legibility).toContain("warnings: ['legibility:ungrounded_hook_cleared']");
    expect(stripComments(read('eval', 'rubricScorer.ts'))).not.toContain('no_opening_hook');
  });
  it('the defaults are untouched', () => {
    const env = stripComments(read('config', 'env.ts'));
    expect(env).toMatch(/PRODUCT_EDIT_PROFILE:[^\n]*cuts/);
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED:\s*bool\(false\)/);
  });
});
