/**
 * WP7C tests: cuts is the shipping default. Pure tests of the normalizer and its warning helper, plus source-text tests of the env default, the example files, the callers' warning and the
 * unchanged opt-outs. No FFmpeg, no network, no model call.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {analyzeOverridesFor, normalizeEditProfile, profileFingerprintKey, unrecognizedEditProfile} from '../lib/productEditProfile.ts';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (...parts: string[]) => readFileSync(resolve(REPO, ...parts), 'utf8');

describe('the normalizer: one honest rule', () => {
  it('the three exact strings select themselves', () => {
    expect(normalizeEditProfile('cuts')).toBe('cuts');
    expect(normalizeEditProfile('mvp')).toBe('mvp');
    expect(normalizeEditProfile('legacy')).toBe('legacy');
  });
  it('unset, empty and null resolve to cuts', () => {
    for (const raw of [undefined, null, '']) expect(normalizeEditProfile(raw)).toBe('cuts');
  });
  it('a typo or a wrong-case opt-out resolves to cuts (fail-safe to the product path), never silently to legacy or mvp', () => {
    for (const raw of ['legcy', 'MVP', 'Legacy', ' mvp', 'mvp ', 'cut', 'true', '1', 'mvp2', 42, {}]) expect(normalizeEditProfile(raw), String(raw)).toBe('cuts');
  });
  it('...and that typo is reported so the caller can warn; valid, unset and empty values are not', () => {
    expect(unrecognizedEditProfile('legcy')).toBe('legcy');
    expect(unrecognizedEditProfile('MVP')).toBe('MVP');
    expect(unrecognizedEditProfile(42)).toBe('42');
    for (const raw of [undefined, null, '', 'legacy', 'mvp', 'cuts']) expect(unrecognizedEditProfile(raw), String(raw)).toBeNull();
  });
});

describe('what each profile adds', () => {
  it('fingerprints: cuts has its key, mvp unchanged, an explicit legacy keeps the empty (pre-WP1) key', () => {
    expect(profileFingerprintKey('cuts')).toBe('edit-profile:cuts-v1');
    expect(profileFingerprintKey('mvp')).toBe('edit-profile:mvp-v1');
    expect(profileFingerprintKey('legacy')).toBe('');
    expect(profileFingerprintKey(normalizeEditProfile(undefined))).toBe('edit-profile:cuts-v1');
  });
  it('the default profile turns on no mvp behaviour: no overrides, so no Director video, opening direction or user-B-roll-only', () => {
    expect(analyzeOverridesFor(normalizeEditProfile(undefined))).toEqual({});
    expect(analyzeOverridesFor('mvp')).toEqual({directorVideoInput: true, openingDirection: true, userBrollOnly: true});
  });
});

describe('env default and documentation (source text)', () => {
  it('env.ts defaults the profile to cuts, keeps graphics off, and says why', () => {
    const env = read('server/src/config/env.ts');
    expect(env).toContain("PRODUCT_EDIT_PROFILE: str('cuts'),");
    expect(env).toContain('MOTION_GRAPHICS_ENABLED: bool(false),');
    expect(env).toContain('The default is `cuts`');
  });
  it('the profile module header states the new default and the typo rule', () => {
    const header = read('server/src/lib/productEditProfile.ts');
    for (const part of ['WP7C: the SHIPPING DEFAULT is `cuts`', 'unrecognizedEditProfile', "return raw === 'legacy' || raw === 'mvp' || raw === 'polish' ? raw : 'cuts';"]) expect(header).toContain(part);
  });
  it.each(['.env.example', '.env.production.example'])('%s says cuts is the default and legacy / mvp are the opt-outs, all commented', file => {
    const text = read(file);
    const line = (prefix: string) => text.split('\n').find(l => l.startsWith(prefix)) ?? '';
    expect(line('# PRODUCT_EDIT_PROFILE=cuts ')).toMatch(/THE DEFAULT \(since WP7C\)/);
    expect(line('# PRODUCT_EDIT_PROFILE=cuts ')).toMatch(/Set PRODUCT_EDIT_PROFILE=legacy or mvp only to opt out/);
    expect(line('# PRODUCT_EDIT_PROFILE=cuts ')).toMatch(/unrecognized value \(a typo\) resolves to cuts and logs a warning/);
    expect(line('# PRODUCT_EDIT_PROFILE=mvp ')).toMatch(/Not the default/);
    expect(line('# PRODUCT_EDIT_PROFILE=legacy ')).toMatch(/Not the default/);
    expect(text).not.toMatch(/^PRODUCT_EDIT_PROFILE=/m);
  });
});

describe('the callers (source text)', () => {
  it('the HTTP analyze path and the CLI both read the shared normalizer and warn on an unrecognized value', () => {
    const runner = read('server/src/pipeline/analysisRunner.ts');
    const first = read('server/src/scripts/firstVideo.ts');
    for (const text of [runner, first]) {
      expect(text).toContain('normalizeEditProfile(env.PRODUCT_EDIT_PROFILE)');
      expect(text).toContain('unrecognizedEditProfile(env.PRODUCT_EDIT_PROFILE)');
      expect(text).toContain('PRODUCT_EDIT_PROFILE is not legacy, mvp, cuts or polish; using the default (cuts)');
    }
  });
  it('the CLI usage string reflects the new default', () => {
    const first = read('server/src/scripts/firstVideo.ts');
    expect(first).toContain('PRODUCT_EDIT_PROFILE (env): DEFAULT is cuts');
    expect(first).toContain('set PRODUCT_EDIT_PROFILE=legacy or mvp only to opt out');
    expect(first).not.toContain('unset stays legacy');
  });
  it('analyzeVideo itself is unchanged for a caller that passes no profile (programmatic and experiment callers keep legacy); only the resolved server value is cuts', () => {
    const analyze = read('server/src/pipeline/analyzeVideo.ts');
    expect(analyze).toContain("profile: input.editProfile ?? 'legacy',");
    expect(analyze).toContain("const cutsOnlyVisualsOff = input.editProfile === 'cuts';");
  });
  it('the profile is still server configuration, never an API field', () => {
    const schemas = read('server/src/http/schemas.ts');
    expect(schemas).not.toMatch(/editProfile|PRODUCT_EDIT_PROFILE/);
  });
});
