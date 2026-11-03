/**
 * WP6F text tests: the re-validation checklist exists and names the signals; it is not a second authorization. The file is only read.
 */
import {existsSync, readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FILE = resolve(REPO, 'remotion/out/phase36-readiness/WP6F_REVALIDATION_CHECKLIST.md');

describe('WP6F re-validation checklist', () => {
  it('exists and names the key signals', () => {
    expect(existsSync(FILE)).toBe(true);
    const text = readFileSync(FILE, 'utf8');
    for (const part of ['transcript_retakes_dropped', 'captionSample', 'transcript_retakes_skipped', 'silence_trim_skipped', 'gemini_budget', 'delivery_shaping_skipped', '74.5', 'revolutionized', 'Whisper']) expect(text).toContain(part);
  });
  it('states it is not a second authorization and needs fresh explicit authorization', () => {
    const text = readFileSync(FILE, 'utf8');
    expect(text).toContain('not a second authorization');
    expect(text.toLowerCase()).toContain('fresh explicit');
  });
  it('carries the exact gate string, and the warnings it names exist in the source', () => {
    const text = readFileSync(FILE, 'utf8');
    const analyze = readFileSync(resolve(REPO, 'server/src/pipeline/analyzeVideo.ts'), 'utf8');
    expect(text).toContain("(input.editProfile === 'mvp' && !captionsOnly) || teleprompterClean");
    for (const warning of ['transcript_retakes_dropped:', 'transcript_retakes_skipped:', 'silence_trim_skipped:', 'gemini_budget:', 'delivery_shaping_skipped:expressive:']) expect(analyze).toContain(warning);
  });
});
