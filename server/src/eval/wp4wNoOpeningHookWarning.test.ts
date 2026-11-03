/**
 * WP4W tests: the warning legibility:no_opening_hook names an mvp edit with no opening treatment and an empty hook title. stages/broll/legibility.ts is pure; analyzeVideo.ts (logger) is read as
 * text. No render, no Chromium, no network, no model call. The four unsafe suites are not run.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {absentOpeningHookWarning, applyLegibility, NO_OPENING_HOOK_WARNING} from '../stages/broll/legibility.ts';
import type {CaptionDirection} from '../types/blueprint.ts';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts: string[]) => readFileSync(resolve(SRC, ...parts), 'utf8');
const stripComments = (source: string) => source.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

describe('absentOpeningHookWarning', () => {
  it('no opening and an empty (or blank) hook title: the exact warning string', () => {
    for (const title of ['', ' ', '   ', '\n\t']) expect(absentOpeningHookWarning(false, title), JSON.stringify(title)).toBe('legibility:no_opening_hook');
    expect(NO_OPENING_HOOK_WARNING).toBe('legibility:no_opening_hook');
  });
  it('no opening but a hook title: null', () => {
    for (const title of ['Save time', 'x', ' Save time ']) expect(absentOpeningHookWarning(false, title)).toBeNull();
  });
  it('an opening present: null, whatever the title', () => {
    for (const title of ['', '   ', 'Save time']) expect(absentOpeningHookWarning(true, title)).toBeNull();
  });
  it('a missing title (undefined or null at runtime) counts as empty without throwing', () => {
    expect(absentOpeningHookWarning(false, undefined as never)).toBe('legibility:no_opening_hook');
    expect(absentOpeningHookWarning(false, null as never)).toBe('legibility:no_opening_hook');
    expect(absentOpeningHookWarning(true, undefined as never)).toBeNull();
  });
  it('is deterministic and returns only the string or null', () => {
    expect(absentOpeningHookWarning(false, '')).toBe(absentOpeningHookWarning(false, ''));
    for (const [open, title] of [[true, ''], [false, ''], [true, 'a'], [false, 'a']] as const) {
      const out = absentOpeningHookWarning(open, title);
      expect(out === null || out === 'legibility:no_opening_hook').toBe(true);
    }
  });
});

describe('with the hook writer (WP4R): the state it names', () => {
  const caption: CaptionDirection = {position: 'bottom', bottomFrac: 0.18, textColor: '#FFFFFF', highlightColor: '#FFD700', boxColor: null, template: 'classic'};
  const legible = (hookTitle: string) => applyLegibility({hookTitle, canvasWidth: 1080, canvasHeight: 1920, caption, motionGraphics: [], semanticEmphasis: [], transcript: 'Today I use Premiere Pro to cut my videos, it saves time.'});
  it('a placeholder hook cleared by applyLegibility, with the opening rejected, is exactly the named state', () => {
    const out = legible('WATCH THIS');
    expect(out.hookTitle).toBe('');
    expect(out.warnings).toContain('legibility:ungrounded_hook_cleared');
    expect(absentOpeningHookWarning(false, out.hookTitle)).toBe('legibility:no_opening_hook');
  });
  it('a spoken hook that survives is not the named state; applyLegibility itself never emits the new warning and invents no title', () => {
    const kept = legible('Premiere Pro saves time');
    expect(absentOpeningHookWarning(false, kept.hookTitle)).toBeNull();
    for (const out of [kept, legible('WATCH THIS'), legible('')]) expect(out.warnings).not.toContain('legibility:no_opening_hook');
    expect(legible('WATCH THIS').hookTitle).toBe('');
  });
  it('an opening that exists with the standard hook left empty is not flagged', () => {
    expect(absentOpeningHookWarning(true, legible('WATCH THIS').hookTitle)).toBeNull();
  });
});

describe('analyzeVideo (source text; it imports the logger)', () => {
  const analyze = stripComments(read('pipeline', 'analyzeVideo.ts'));
  it('imports the helper and calls it exactly once', () => {
    expect(analyze).toContain('absentOpeningHookWarning, applyLegibility,');
    expect(analyze.match(/absentOpeningHookWarning\(/g)).toHaveLength(1);
  });
  it('the call is on the mvp path, after the opening and legibility decisions (WP5C: and after finalizeEdits), with whether an opening survived and the hook title that will be written', () => {
    const mvp = analyze.indexOf("input.editProfile === 'mvp' && !captionsOnly");
    const call = analyze.indexOf('absentOpeningHookWarning(');
    expect(call).toBeGreaterThan(mvp);
    expect(call).toBeGreaterThan(analyze.indexOf('openingSpec = resolved.spec;'));
    expect(call).toBeGreaterThan(analyze.indexOf('const legible = applyLegibility({'));
    expect(call).toBeGreaterThan(analyze.indexOf('broll.hookTitle = legible.hookTitle;'));
    expect(call).toBeGreaterThan(analyze.indexOf('warnings.push(...legible.warnings);'));
    expect(call).toBeGreaterThan(analyze.indexOf('const finalized = finalizeEdits({')); // WP5C: moved after finalizeEdits
    expect(analyze).toContain('const noOpeningHook = absentOpeningHookWarning(openingIsPresent(openingSpec, survivedBehind), broll.hookTitle);'); // WP4X/WP5C: a behind-subject opening that survived counts as present
  });
  it('the warning is pushed only when non-null', () => {
    expect(analyze).toContain('if (noOpeningHook) warnings.push(noOpeningHook);');
  });
  it('nothing else about the hook changed: the opening rule, applyLegibility\'s clearing, the policy and the scorer', () => {
    expect(analyze).toContain('if (!openingSpec) {\n        broll.hookTitle = legible.hookTitle;');
    const legibility = stripComments(read('stages', 'broll', 'legibility.ts'));
    expect(legibility).toContain("warnings: ['legibility:ungrounded_hook_cleared']");
    expect(legibility).toContain('trimmedHook.toUpperCase() === PLACEHOLDER_TEXT || !isGroundedInTranscript(trimmedHook, input.transcript)');
    expect(read('config', 'env.ts')).toMatch(/HOOK_TITLE_POLICY:/);
    expect(stripComments(read('eval', 'rubricScorer.ts'))).not.toContain('no_opening_hook');
  });
  it('the legacy path never reaches the call (it is inside the mvp block) and the defaults are untouched', () => {
    // WP5C: the call sits in the `if (legibility)` block after finalizeEdits; `legibility` is set only inside the mvp block, so the legacy path never reaches it
    const block = analyze.slice(analyze.indexOf('const finalized = finalizeEdits({'));
    const legibilityBlock = block.slice(block.indexOf('if (legibility) {'));
    expect(legibilityBlock.indexOf('absentOpeningHookWarning(')).toBeGreaterThan(0);
    expect(analyze).toMatch(/let legibility: LegibilitySpec \| undefined;/);
    const env = stripComments(read('config', 'env.ts'));
    expect(env).toMatch(/PRODUCT_EDIT_PROFILE:[^\n]*cuts/);
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED:\s*bool\(false\)/);
  });
});
