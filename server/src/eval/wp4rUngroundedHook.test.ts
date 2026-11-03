/**
 * WP4R pure tests: applyLegibility grounds the hook title before fitting it. stages/broll/legibility.ts is pure (types, contrast, provenance, colour helpers and the shared matcher only);
 * analyzeVideo.ts (logger) is read as text. No render, no Chromium, no network, no model call.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import type {CaptionDirection} from '../types/blueprint.ts';
import {applyLegibility, PLACEHOLDER_TEXT} from '../stages/broll/legibility.ts';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts: string[]) => readFileSync(resolve(SRC, ...parts), 'utf8');
const stripComments = (source: string) => source.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

const TRANSCRIPT = 'Today I use Premiere Pro and After Effects to cut my videos, it saves time.';
const caption: CaptionDirection = {position: 'bottom', bottomFrac: 0.18, textColor: '#FFFFFF', highlightColor: '#FFD700', boxColor: null, template: 'classic'};
const run = (hookTitle: string, transcript = TRANSCRIPT) =>
  applyLegibility({hookTitle, canvasWidth: 1080, canvasHeight: 1920, caption, motionGraphics: [], semanticEmphasis: [], transcript});

describe('the placeholder', () => {
  it('"WATCH THIS" clears, with the warning once and no hook fit', () => {
    const out = run('WATCH THIS');
    expect(out.hookTitle).toBe('');
    expect(out.warnings.filter(item => item === 'legibility:ungrounded_hook_cleared')).toHaveLength(1);
    expect(out.legibility.hook).toBeUndefined();
    expect('hook' in out.legibility).toBe(false);
  });
  it('is case-insensitive and ignores surrounding space', () => {
    for (const title of ['watch this', 'Watch This', '  WATCH THIS  ']) {
      const out = run(title);
      expect(out.hookTitle, title).toBe('');
      expect(out.legibility.hook, title).toBeUndefined();
      expect(out.warnings, title).toContain('legibility:ungrounded_hook_cleared');
    }
    expect(PLACEHOLDER_TEXT).toBe('WATCH THIS');
  });
  it('clears even when the speaker really said "watch this"', () => {
    const out = run('WATCH THIS', 'okay watch this because it matters');
    expect(out.hookTitle).toBe('');
    expect(out.warnings).toContain('legibility:ungrounded_hook_cleared');
  });
});

describe('an unspoken phrase', () => {
  it('clears, with no fit and the warning', () => {
    const out = run('Recommended Software');
    expect(out.hookTitle).toBe('');
    expect(out.legibility.hook).toBeUndefined();
    expect(out.warnings).toContain('legibility:ungrounded_hook_cleared');
  });
  it('one unspoken word among spoken ones clears the whole title (nothing is invented or taken from the transcript)', () => {
    const out = run('Premiere Wizardry');
    expect(out.hookTitle).toBe('');
    expect(out.hookTitle).not.toMatch(/premiere/i);
  });
  it('a title when there is no transcript at all clears (nothing is grounded)', () => {
    expect(run('Premiere Pro', '').hookTitle).toBe('');
  });
});

describe('a spoken title', () => {
  it('is unchanged and still gets a fit, with no warning', () => {
    const out = run('Premiere Pro saves time');
    expect(out.hookTitle).toBe('Premiere Pro saves time');
    expect(out.legibility.hook).toBeDefined();
    expect(out.legibility.hook).toMatchObject({lines: expect.any(Number), sizeFrac: expect.any(Number), clearBand: expect.any(Boolean)});
    expect(out.warnings).not.toContain('legibility:ungrounded_hook_cleared');
  });
  it('is fitted exactly as before: the same output as fitHookTitle would give', async () => {
    const { fitHookTitle } = await import('../stages/broll/legibility.ts');
    const direct = fitHookTitle({title: 'Premiere Pro saves time', canvasWidth: 1080, canvasHeight: 1920});
    const out = run('Premiere Pro saves time');
    expect(out.hookTitle).toBe(direct.title);
    expect(out.legibility.hook).toEqual(direct.fit);
    for (const warning of direct.warnings) expect(out.warnings).toContain(warning);
  });
  it('case, punctuation and plurals are matched the shared way', () => {
    expect(run('PREMIERE PRO!').hookTitle).toBe('PREMIERE PRO!');
    expect(run('videos').hookTitle).toBe('videos');
  });
  it('a long spoken title is still shortened from the end (shortening keeps it spoken) without the cleared warning', () => {
    const long = 'Today I use Premiere Pro and After Effects to cut my videos, it saves time. Today I use Premiere Pro and After Effects';
    const out = run(long, long);
    expect(out.warnings).not.toContain('legibility:ungrounded_hook_cleared');
    expect(out.hookTitle.length).toBeGreaterThan(0);
  });
});

describe('an empty title', () => {
  it('stays empty with no fit and no warning', () => {
    for (const title of ['', '   ', '\n']) {
      const out = run(title);
      expect(out.hookTitle, JSON.stringify(title)).toBe('');
      expect(out.legibility.hook).toBeUndefined();
      expect(out.warnings).not.toContain('legibility:ungrounded_hook_cleared');
    }
  });
});

describe('what else applyLegibility returns', () => {
  it('captions, graphics, emphasis and the caption spec are produced as before when the hook is cleared', () => {
    const out = run('WATCH THIS');
    expect(out.caption).toBeDefined();
    expect(out.legibility.captions).toMatchObject({avoidSplitFace: true});
    expect(out.legibility.version).toBe(1);
    expect(out.motionGraphics).toEqual([]);
    expect(out.droppedText).toEqual([]);
  });
});

describe('wiring (source text)', () => {
  const analyze = stripComments(read('pipeline', 'analyzeVideo.ts'));
  const legibility = stripComments(read('stages', 'broll', 'legibility.ts'));
  it('applyLegibility is still called only from analyzeVideo, once, inside the mvp non-caption-only block', () => {
    expect(analyze.match(/applyLegibility\(/g)).toHaveLength(1);
    expect(analyze.indexOf('applyLegibility(')).toBeGreaterThan(analyze.indexOf("input.editProfile === 'mvp' && !captionsOnly"));
    const importers = ['pipeline/analyzeVideo.ts', 'pipeline/analysisRunner.ts', 'pipeline/renderRunner.ts', 'pipeline/finalizeEdits.ts', 'stages/broll/brollPlanner.ts'];
    for (const file of importers.filter(name => name !== 'pipeline/analyzeVideo.ts')) expect(stripComments(read(file)), file).not.toContain('applyLegibility');
  });
  it('the caller rule that skips writing the hook back when an opening exists is unchanged', () => {
    expect(analyze).toContain('if (!openingSpec) {\n        broll.hookTitle = legible.hookTitle;');
    expect(analyze).toContain('legibility = openingSpec ? {...legible.legibility, hook: undefined} : legible.legibility;');
  });
  it('the grounding sits before fitHookTitle in applyLegibility, using PLACEHOLDER_TEXT and the shared matcher', () => {
    const body = legibility.slice(legibility.indexOf('export function applyLegibility('));
    expect(body.indexOf('const hookCleared')).toBeLessThan(body.indexOf('fitHookTitle({'));
    expect(body).toContain('trimmedHook.toUpperCase() === PLACEHOLDER_TEXT || !isGroundedInTranscript(trimmedHook, input.transcript)');
    expect(body).toContain("warnings: ['legibility:ungrounded_hook_cleared']");
    expect(body.match(/legibility:ungrounded_hook_cleared/g)).toHaveLength(1);
  });
  it('the module comment no longer says the hook title is untouched', () => {
    const raw = read('stages', 'broll', 'legibility.ts');
    expect(raw).not.toContain('The hook title is not touched;');
    expect(raw).toContain('The hook title (WP4R) is grounded the same way before it is fitted');
  });
  it('the hook policy default, oneLineHook and the scorer are untouched', () => {
    const env = stripComments(read('config', 'env.ts'));
    expect(env).toMatch(/HOOK_TITLE_POLICY:/);
    expect(env).toMatch(/PRODUCT_EDIT_PROFILE:[^\n]*cuts/);
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED:\s*bool\(false\)/);
    expect(stripComments(read('eval', 'rubricScorer.ts'))).not.toMatch(/applyLegibility|legibility\.ts/); // WP4T: the scorer now reads the warning (row 1), but never calls the writer
  });
});
