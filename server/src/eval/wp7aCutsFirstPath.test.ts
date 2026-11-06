/**
 * WP7A tests: the cuts-first profile. Pure tests of the profile helpers and the noise filter builder, plus source-text tests of the wiring (analyzeVideo imports the logger, so it is read, not
 * imported). No FFmpeg, no network, no model call.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {analyzeOverridesFor, normalizeEditProfile, profileFingerprintKey} from '../lib/productEditProfile.ts';
import {
  buildDenoiseFilter,
  DENOISE_APPLIED_WARNING,
  DENOISE_FAILED_WARNING,
  denoiseWasApplied,
  MAX_HIGHPASS_HZ,
  MAX_REDUCTION_DB,
  MIN_HIGHPASS_HZ,
  MIN_REDUCTION_DB,
} from '../stages/audio/noiseFilter.ts';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts: string[]) => readFileSync(resolve(SRC, ...parts), 'utf8');
const analyze = read('pipeline', 'analyzeVideo.ts');

describe('the cuts profile name and its defaults', () => {
  it('WP7C: the exact strings legacy / mvp / cuts select themselves; unset, empty and anything else resolve to the default, cuts', () => {
    expect(normalizeEditProfile('cuts')).toBe('cuts');
    expect(normalizeEditProfile('mvp')).toBe('mvp');
    expect(normalizeEditProfile('legacy')).toBe('legacy');
    for (const raw of [undefined, '', 'Cuts', 'CUTS', ' cuts', 'cut', 'mvp ', 0, null]) expect(normalizeEditProfile(raw)).toBe('cuts');
  });
  it('the env default is cuts (WP7C), and graphics stay off by default', () => {
    const env = read('config', 'env.ts');
    expect(env).toContain("PRODUCT_EDIT_PROFILE: str('cuts'),");
    expect(env).toContain('MOTION_GRAPHICS_ENABLED: bool(false),');
  });
  it('the fingerprint keys: legacy empty, mvp unchanged, cuts its own', () => {
    expect(profileFingerprintKey('legacy')).toBe('');
    expect(profileFingerprintKey('mvp')).toBe('edit-profile:mvp-v1');
    expect(profileFingerprintKey('cuts')).toBe('edit-profile:cuts-v1');
  });
  it('the cuts profile adds no analyze overrides (no Director video, opening art direction or user-B-roll planning)', () => {
    expect(analyzeOverridesFor('cuts')).toEqual({});
    expect(analyzeOverridesFor('legacy')).toEqual({});
    expect(analyzeOverridesFor('mvp')).toEqual({directorVideoInput: true, openingDirection: true, userBrollOnly: true});
  });
  it('the profile header documents what runs and what is skipped', () => {
    const header = read('lib', 'productEditProfile.ts');
    for (const part of ['cuts              WP7A', 'RUNS', 'SKIPPED', 'noise', 'forced off']) expect(header).toContain(part);
  });
});

describe('the noise filter builder', () => {
  it('builds the documented chain with the gentle defaults', () => {
    expect(buildDenoiseFilter()).toBe('highpass=f=80,afftdn=nr=12:nf=-35:tn=1');
  });
  it('is deterministic and uses the given values', () => {
    expect(buildDenoiseFilter({reductionDb: 18, highPassHz: 100})).toBe('highpass=f=100,afftdn=nr=18:nf=-35:tn=1');
    expect(buildDenoiseFilter({reductionDb: 18, highPassHz: 100})).toBe(buildDenoiseFilter({reductionDb: 18, highPassHz: 100}));
  });
  it('clamps absurd values and ignores non-finite ones', () => {
    expect(buildDenoiseFilter({reductionDb: 999, highPassHz: 9999})).toBe(`highpass=f=${MAX_HIGHPASS_HZ},afftdn=nr=${MAX_REDUCTION_DB}:nf=-35:tn=1`);
    expect(buildDenoiseFilter({reductionDb: -5, highPassHz: 0})).toBe(`highpass=f=${MIN_HIGHPASS_HZ},afftdn=nr=${MIN_REDUCTION_DB}:nf=-35:tn=1`);
    expect(buildDenoiseFilter({reductionDb: Number.NaN, highPassHz: Number.POSITIVE_INFINITY})).toBe('highpass=f=80,afftdn=nr=12:nf=-35:tn=1');
  });
  it('never contains characters that could break out of the filtergraph', () => {
    expect(buildDenoiseFilter({reductionDb: 7.123456, highPassHz: 61.5})).toMatch(/^[a-z0-9=.,:\-]+$/);
  });
  it('the applied-warning helper reads only the exact warning', () => {
    expect(denoiseWasApplied([DENOISE_APPLIED_WARNING])).toBe(true);
    expect(denoiseWasApplied([DENOISE_FAILED_WARNING, 'transcript_retakes_dropped:2'])).toBe(false);
    expect(denoiseWasApplied([])).toBe(false);
  });
  it('the module is pure: no env, logger, network, child process or file access', () => {
    const module_ = read('stages', 'audio', 'noiseFilter.ts');
    expect(module_).not.toMatch(/^import /m);
    for (const word of ['process.env', 'spawn', 'fetch(', 'readFile', 'writeFile']) expect(module_).not.toContain(word);
  });
});

describe('analyzeVideo wiring (source text)', () => {
  it('WP8A: the profile switches are the exact profile strings and are computed once from the input', () => {
    expect(analyze).toContain("const cutsOnlyVisualsOff = input.editProfile === 'cuts';");
    expect(analyze).toContain("const speechCutsOn = input.editProfile === 'cuts' || input.editProfile === 'polish';");
    expect(analyze.match(/const cutsOnlyVisualsOff =/g)).toHaveLength(1);
    expect(analyze.match(/const speechCutsOn =/g)).toHaveLength(1);
  });
  it('visual edits, motion graphics and delivery shaping are switched off on the cuts path', () => {
    expect(analyze).toContain('const visualEditsOn = !cutsOnlyVisualsOff && visualToolkitsRequested(requestedEdits);');
    expect(analyze).toContain('const motionGraphicsRequested = !cutsOnlyVisualsOff && (input.generatedGraphicsEnabled ?? flags.motionGraphics);');
    expect(analyze).toContain('const deliveryDenied = input.forceDeliveryShaping === false || cutsOnlyVisualsOff;');
    expect(analyze).toContain("warnings.push('delivery_shaping_skipped:cuts_profile');");
  });
  it('the trim is forced on for cuts: neither the captions-only nor the template switch skips it, and no script is needed', () => {
    expect(analyze).toContain('(captionsOnly && !teleprompterClean && !speechCutsOn) ||');
    expect(analyze).toContain('(Boolean(recipe && recipe.trimSilence === false) && !teleprompterClean && !speechCutsOn);');
    expect(analyze).toContain("if ((input.editProfile === 'mvp' && !captionsOnly) || teleprompterClean || speechCutsOn) {");
    expect(analyze).toContain('removeFillers: true,');
  });
  it('the denoise runs only on the cuts path with its switch on, before the trim, on the active talking-head', () => {
    const start = analyze.indexOf('if (speechCutsOn && env.CUTS_DENOISE_ENABLED) {');
    expect(start).toBeGreaterThan(0);
    const block = analyze.slice(start, analyze.indexOf('const captionsOnly = !visualEditsOn;'));
    expect(block).toContain('inputPath: activeSourcePath,');
    expect(block).toContain('buildDenoiseFilter({reductionDb: env.CUTS_DENOISE_NR_DB, highPassHz: env.CUTS_DENOISE_HIGHPASS_HZ})');
    expect(start).toBeLessThan(analyze.indexOf('const skipSilenceTrim ='));
    expect(analyze.match(/denoiseTalkingHeadAudio\(/g)).toHaveLength(1);
  });
  it('a denoise failure warns and keeps the original audio: the active source is only swapped after both the filter and the upload succeed', () => {
    const start = analyze.indexOf('if (speechCutsOn && env.CUTS_DENOISE_ENABLED) {');
    const block = analyze.slice(start, analyze.indexOf('const captionsOnly = !visualEditsOn;'));
    expect(block).toContain('} catch (error) {');
    expect(block).toContain('warnings.push(DENOISE_FAILED_WARNING);');
    expect(block).not.toContain('throw');
    expect(block.indexOf('await uploadSourceVideo(denoisedPath')).toBeLessThan(block.indexOf('activeSourcePath = denoisedPath;'));
    expect(block.indexOf('await denoiseTalkingHeadAudio(')).toBeLessThan(block.indexOf('activeSourcePath = denoisedPath;'));
    expect(block.indexOf('activePublicVideoUrl = uploaded.publicUrl;')).toBeLessThan(block.indexOf('warnings.push(DENOISE_APPLIED_WARNING);'));
  });
  it('the other profiles are not given a cuts-only behaviour: every cuts switch is guarded by speechCutsOn or cutsOnlyVisualsOff', () => {
    expect(analyze.match(/\bspeechCutsOn\b/g)!.length + analyze.match(/\bcutsOnlyVisualsOff\b/g)!.length).toBeGreaterThanOrEqual(12);
    expect(analyze).not.toMatch(/\bcutsPath\b/);
    expect(analyze).not.toMatch(/editProfile === 'cuts'.*mvp/);
  });
});

describe('ffmpeg runner and local render (source text)', () => {
  it('the denoise copies the video stream, filters the audio, and throws on an empty output', () => {
    const ffmpeg = read('media', 'ffmpeg.ts');
    const start = ffmpeg.indexOf('export async function denoiseTalkingHeadAudio');
    const block = ffmpeg.slice(start, ffmpeg.indexOf('Cap a clip at the Remotion canvas'));
    for (const part of ["'-c:v', 'copy'", "'-af', input.filter", "'-c:a', 'aac'", "'-map', '0:v:0', '-map', '0:a:0'", 'Audio denoise produced an empty file']) expect(block).toContain(part);
  });
  it('the CLI does not swap the original local file back in when the denoised audio is the edit audio', () => {
    const first = read('scripts', 'firstVideo.ts');
    expect(first).toContain('isLocalMediaPath(videoUrl) && !blueprint.deliveryShaping');
    expect(first).toContain('denoiseWasApplied(blueprint.stats.warnings)');
    expect(first).toContain('local CLI re-denoised talking-head for Remotion prefetch');
  });
  it('the denoise settings are env-configurable, with the switch on and gentle defaults', () => {
    const env = read('config', 'env.ts');
    for (const line of ['CUTS_DENOISE_ENABLED: bool(true),', 'CUTS_DENOISE_NR_DB: num(12),', 'CUTS_DENOISE_HIGHPASS_HZ: num(80),']) expect(env).toContain(line);
  });
});
