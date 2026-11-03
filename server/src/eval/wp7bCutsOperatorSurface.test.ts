/**
 * WP7B source-text tests: the example env files document the cuts profile as commented lines matching env.ts, and the CLI honors the profile through the shared normalizer. Files are only read.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {normalizeEditProfile} from '../lib/productEditProfile.ts';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (...parts: string[]) => readFileSync(resolve(REPO, ...parts), 'utf8');
const env = read('server/src/config/env.ts');
const first = read('server/src/scripts/firstVideo.ts');
const FILES = ['.env.example', '.env.production.example'];
const LINES = ['# PRODUCT_EDIT_PROFILE=cuts ', '# CUTS_DENOISE_ENABLED=true ', '# CUTS_DENOISE_NR_DB=12 ', '# CUTS_DENOISE_HIGHPASS_HZ=80 '];

describe.each(FILES)('%s documents the cuts profile', file => {
  const text = read(file);
  it.each(LINES)('has the commented line %s', line => {
    expect(text.split('\n').some(l => l.startsWith(line))).toBe(true);
  });
  it('has no live assignment for any cuts variable or the profile', () => {
    for (const name of ['PRODUCT_EDIT_PROFILE', 'CUTS_DENOISE_ENABLED', 'CUTS_DENOISE_NR_DB', 'CUTS_DENOISE_HIGHPASS_HZ']) expect(text).not.toMatch(new RegExp(`^${name}=`, 'm'));
  });
  it('says what cuts runs and skips, and that it is the default', () => {
    const line = text.split('\n').find(l => l.startsWith('# PRODUCT_EDIT_PROFILE=cuts '))!;
    for (const part of ['Silence', 'filler', 'retake', 'noise', 'skips the visual Director', 'B-roll', 'graphics', 'THE DEFAULT']) expect(line).toContain(part);
  });
  it('the documented defaults and names match env.ts', () => {
    expect(env).toContain('CUTS_DENOISE_ENABLED: bool(true),');
    expect(env).toContain('CUTS_DENOISE_NR_DB: num(12),');
    expect(env).toContain('CUTS_DENOISE_HIGHPASS_HZ: num(80),');
    expect(env).toContain("PRODUCT_EDIT_PROFILE: str('cuts'),");
  });
});

describe('the CLI honors the profile like mvp', () => {
  it('normalizeEditProfile selects cuts only for the exact string', () => {
    expect(normalizeEditProfile('cuts')).toBe('cuts');
    expect(normalizeEditProfile('mvp')).toBe('mvp');
    expect(normalizeEditProfile('legacy')).toBe('legacy');
    expect(normalizeEditProfile('Cuts')).toBe('cuts'); // WP7C: an unrecognized value resolves to the default (and is warned about)
    expect(normalizeEditProfile(undefined)).toBe('cuts');
  });
  it('firstVideo reads the profile through the shared normalizer and passes it to analyzeVideo', () => {
    expect(first).toContain('const editProfile = normalizeEditProfile(env.PRODUCT_EDIT_PROFILE);');
    expect(first).toMatch(/\.\.\.analyzeOverridesFor\(editProfile\),\s*editProfile,/);
  });
  it('the usage text has one hint naming cuts, mvp and legacy', () => {
    expect(first.match(/PRODUCT_EDIT_PROFILE \(env\): DEFAULT is cuts/g)).toHaveLength(1);
    expect(first).toContain('DEFAULT is cuts');
  });
  it('the defaults are untouched: legacy profile, graphics off', () => {
    expect(env).toContain('MOTION_GRAPHICS_ENABLED: bool(false),');
  });
});
