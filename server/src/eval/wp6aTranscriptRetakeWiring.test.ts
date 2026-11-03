/**
 * WP6A source-text tests: the transcript retake trim is wired into analyzeVideo's trim stage behind the mvp / teleprompter gate. analyzeVideo imports the logger, so it is read as text.
 * No render, no network, no model call. The four unsafe suites are not run.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts: string[]) => readFileSync(resolve(SRC, ...parts), 'utf8');
const stripComments = (source: string) => source.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
const analyze = stripComments(read('pipeline', 'analyzeVideo.ts'));
const module = stripComments(read('stages', 'filters', 'transcriptRetakeTrim.ts'));

describe('analyzeVideo trim stage', () => {
  it('runs the transcript retake trim after the silence / filler trim and the script retakes, inside the branch that already trims (never captions-only without a teleprompter)', () => {
    const silence = analyze.indexOf('const silence = autoTrimSilence(');
    const script = analyze.indexOf('const retakes = scriptRetakeExclusions(');
    const call = analyze.indexOf('transcriptRetakeExclusions(wordsOutsideRanges(activeWords, scriptCuts)');
    expect(analyze.match(/transcriptRetakeExclusions\(/g)).toHaveLength(1);
    expect(call).toBeGreaterThan(script);
    expect(call).toBeGreaterThan(silence);
    expect(call).toBeLessThan(analyze.indexOf('const merged = mergeTimeRanges(exclusions);'));
    expect(analyze.indexOf('if (skipSilenceTrim) {')).toBeLessThan(analyze.indexOf('} else {\n      const silence = autoTrimSilence('));
  });
  it('the gate is the mvp profile on a full-edits run, or an explicit teleprompter-clean request; no script text is required', () => {
    expect(analyze).toContain("if ((input.editProfile === 'mvp' && !captionsOnly) || teleprompterClean || speechCutsOn) {");
    const block = analyze.slice(analyze.indexOf("if ((input.editProfile === 'mvp' && !captionsOnly) || teleprompterClean || speechCutsOn) {"), analyze.indexOf('if (silence.skipped && retakeDropped < 1'));
    expect(block).not.toContain('scriptText');
  });
  it('the exclusions are merged into the existing list, the warning names the count, and a trim that found only retakes is not discarded as "silence skipped"', () => {
    expect(analyze).toContain('exclusions.push(...transcriptRetakes.trimExclusions);');
    expect(analyze).toContain('warnings.push(`transcript_retakes_dropped:${transcriptRetakes.droppedTakes}`);');
    expect(analyze).toContain('warnings.push(`transcript_retakes_skipped:${transcriptRetakes.skipped}`);');
    expect(analyze).toContain('if (silence.skipped && retakeDropped < 1 && transcriptRetakeDropped < 1 && coughCuts.length < 1) {');
  });
  it('the combined-removal guard, the script path and the expressive delivery-shaping gate are untouched', () => {
    expect(analyze).toContain('const maxRemoval = 0.55;');
    expect(analyze).toContain("if (teleprompterClean && (input.scriptText || '').trim()) {");
    expect(analyze).toContain('delivery_shaping_skipped');
  });
  it('the defaults are unchanged', () => {
    const env = stripComments(read('config', 'env.ts'));
    expect(env).toMatch(/PRODUCT_EDIT_PROFILE:[^\n]*cuts/);
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED:\s*bool\(false\)/);
  });
});

describe('the module', () => {
  it('is pure: only types and the filter helpers are imported (no logger, no model, no network, no fs)', () => {
    expect([...module.matchAll(/^import .* from '([^']+)'/gm)].map(match => match[1]).sort()).toEqual(['../../types/blueprint.ts', './autoTrim.ts', './scriptRetakeTrim.ts', './timeline.ts']);
    expect(module).not.toMatch(/fetch\(|logger|process\.env|node:fs/);
  });
  it('takes no script text', () => {
    expect(module).not.toMatch(/scriptText/);
  });
});
