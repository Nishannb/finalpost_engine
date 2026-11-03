/**
 * WP6D text tests: the status addendum and the uncut re-validation authorization request exist and carry the gate, the warning name and the "not authorization" wording. Files are only read.
 */
import {existsSync, readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DIR = resolve(REPO, 'remotion/out/phase36-readiness');
const GATE = "(input.editProfile === 'mvp' && !captionsOnly) || teleprompterClean";
const read = (name: string) => readFileSync(resolve(DIR, name), 'utf8');
const files = ['WP6D_MESSY_RAW_CLEANUP_STATUS.md', 'WP6D_UNCUT_REVALIDATION_AUTHORIZATION_REQUEST.md'];

describe('WP6D documents', () => {
  it.each(files)('%s exists and carries the gate and the warning name', name => {
    expect(existsSync(resolve(DIR, name))).toBe(true);
    const text = read(name);
    expect(text).toContain(GATE);
    expect(text).toContain('transcript_retakes_dropped');
  });
  it.each(files)('%s says it is not authorization and requires fresh explicit authorization', name => {
    const text = read(name).toLowerCase();
    expect(text).toContain('not authorization');
    expect(text).toContain('fresh explicit');
  });
  it('the gate string is the one in analyzeVideo', () => {
    expect(readFileSync(resolve(REPO, 'server/src/pipeline/analyzeVideo.ts'), 'utf8')).toContain(GATE);
  });
  it('the request lists the blanks, flags, cap, stop conditions and success signals', () => {
    const text = read(files[1]!);
    for (const part of ['/Users/nishanbaral/Downloads/uncut.mp4', 'PRODUCT_EDIT_PROFILE=mvp', 'GEMINI_EDIT_MAX_REQUESTS=10', '--full-edits --no-motion-graphics', '402', 'No second run', 'captionSample', '74.5']) expect(text).toContain(part);
  });
  it('the status states the verdict and the uncovered cases', () => {
    const text = read(files[0]!);
    for (const part of ['NOT ready to claim the edit is decent', 'Whisper', 'delivery-shaping', 'Irregular', 'Deliberate repeats'.toLowerCase().replace('d', 'D') ]) expect(text.toLowerCase()).toContain(part.toLowerCase());
  });
});
