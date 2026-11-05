/**
 * WP8I tests: the HTTP product analyze path runs the same polish stack as first-video. (A) the polish default edits and the shared profile helpers, (B) docs, (C) the URL guard for ingest (pure,
 * injected resolver, no network) and the HTTP schema's refusal of local paths, (D) the post-render integrity decision with mocked facts. Source pins read analysisRunner / analyzeVideo /
 * firstVideo (they import the logger). No render, no network, no model call.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {assertPublicHttpUrl, BlockedUrlError} from '../lib/addressGuard.ts';
import {defaultRequestedEdits, EDIT_TOOLKITS, LEAN_DEFAULT_EDITS, POLISH_LEAN_EDITS, polishRequestedEdits, visualToolkitsRequested} from '../lib/editToolkits.ts';
import {EngineError} from '../lib/errors.ts';
import {analyzeOverridesFor} from '../lib/productEditProfile.ts';
import {assertRenderOutputValid, judgeRenderOutput, RENDER_MIN_BYTES} from '../lib/renderIntegrity.ts';
import {isLocalMediaPath} from '../lib/tempFiles.ts';
import type {OutputFacts} from '../pipeline/experimentVerdict.ts';

const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT = resolve(SERVER, '..');
const read = (...parts: string[]) => readFileSync(resolve(ROOT, ...parts), 'utf8');

describe('A: the polish default edits', () => {
  it('an omitted edit list means the polish default, not captions only; "lean" is the default mode', () => {
    for (const omitted of [undefined, [], [''], [' ', ''], ['  ']]) expect(polishRequestedEdits(omitted as never), JSON.stringify(omitted)).toEqual([...POLISH_LEAN_EDITS]);
    expect(polishRequestedEdits(undefined, 'lean')).toEqual([...POLISH_LEAN_EDITS]);
    expect(polishRequestedEdits(undefined, 'all')).toBeNull();
    expect(polishRequestedEdits([], 'all')).toBeNull();
  });
  it('explicit edits are untouched, exactly as defaultRequestedEdits reads them (null and "all" mean every toolkit)', () => {
    expect(polishRequestedEdits(null)).toBeNull();
    expect(polishRequestedEdits(['all'])).toBeNull();
    expect(polishRequestedEdits(['ALL'], 'lean')).toBeNull();
    expect(polishRequestedEdits(['cutaway'])).toEqual(['cutaway']);
    expect(polishRequestedEdits(['hook_title,card'])).toEqual(['hook_title', 'card']);
    for (const explicit of [['cutaway'], ['zoom', 'card'], ['hook_title,card']]) expect(polishRequestedEdits(explicit, 'all')).toEqual(defaultRequestedEdits(explicit, 'full'));
  });
  it('the lean polish list turns the visual Director on, names only real toolkits, and asks for no stock search, B-roll, matte, inset or delivery work', () => {
    expect(visualToolkitsRequested([...POLISH_LEAN_EDITS])).toBe(true);
    const ids = new Set(EDIT_TOOLKITS.map(toolkit => toolkit.id));
    for (const id of POLISH_LEAN_EDITS) expect(ids.has(id), id).toBe(true);
    // WP8X: cutaway joined the lean list (cadence cover); the rest still need a matte or more assets.
    for (const forbidden of ['split', 'cutout', 'depth_overlay', 'inset_reveal', 'frame_inset', 'media_container', 'delivery_shaping', 'transition', 'lut', 'sound', 'cta']) {
      expect([...POLISH_LEAN_EDITS], forbidden).not.toContain(forbidden);
    }
    expect([...POLISH_LEAN_EDITS]).toEqual(expect.arrayContaining(['captions', 'zoom', 'hook_title', 'kinetic_text', 'lockup', 'card', 'cutaway']));
  });
  it('every other profile keeps the generic lean default (captions only: no visual Director) - nothing changed for cuts, mvp or legacy', () => {
    expect(defaultRequestedEdits(undefined, 'lean')).toEqual([...LEAN_DEFAULT_EDITS]);
    expect(visualToolkitsRequested(defaultRequestedEdits(undefined, 'lean'))).toBe(false);
  });
  it('analyzeVideo uses it only on polish; the HTTP runner uses the same function for its cache key, with "all" as its own key', () => {
    const analyze = read('server/src/pipeline/analyzeVideo.ts');
    expect(analyze).toContain("const requestedEdits = input.editProfile === 'polish' ? polishRequestedEdits(input.requestedEdits, flags.polishDefaultEdits) : defaultRequestedEdits(input.requestedEdits, env.PIPELINE_MODE);");
    const runner = read('server/src/pipeline/analysisRunner.ts');
    expect(runner).toContain("const polishEdits = editProfile === 'polish' ? polishRequestedEdits(input.requestedEdits, effectiveFlags.polishDefaultEdits) : undefined;");
    expect(runner).toContain("requestedEdits: editProfile === 'polish' ? (polishEdits === null ? 'all' : (polishEdits ?? []).slice().sort().join(',')) : (input.requestedEdits ?? []).slice().sort().join(','),");
    expect(read('server/src/config/env.ts')).toContain("POLISH_DEFAULT_EDITS: str('lean').transform(raw => (raw.trim().toLowerCase() === 'all' ? 'all' : 'lean')),");
  });
});

describe('A: the HTTP path and first-video share the profile stack (source text)', () => {
  const runner = read('server/src/pipeline/analysisRunner.ts');
  const first = read('server/src/scripts/firstVideo.ts');
  it('both resolve the profile, the warning, the overrides and the Gemini budget plan with the same helpers', () => {
    for (const text of [runner, first]) {
      expect(text).toContain('normalizeEditProfile(env.PRODUCT_EDIT_PROFILE)');
      expect(text).toContain('unrecognizedEditProfile(env.PRODUCT_EDIT_PROFILE)');
      expect(text).toMatch(/analyzeOverridesFor\((extras\.editProfile \?\? 'legacy'|editProfile)\)/);
      expect(text).toContain('geminiBudgetFromLimit(env.GEMINI_EDIT_MAX_REQUESTS, geminiBudgetPlanFor(');
      expect(text).toContain('withGeminiBudget(');
    }
  });
  it('polish gets the mvp overrides (whole-video Director input, opening direction, creator-B-roll-only) on the HTTP path too', () => {
    expect(analyzeOverridesFor('polish')).toEqual({directorVideoInput: true, openingDirection: true, userBrollOnly: true});
    expect(runner).toContain('...analyzeOverridesFor(extras.editProfile ?? \'legacy\'),\n        editProfile: extras.editProfile ?? \'legacy\',');
    expect(runner).toContain('editProfile, // WP3X: from server configuration, never from the request');
  });
  it('the HTTP runner has no graphics logic of its own: graphics come from the same analyzeVideo branch (library-only included), reported through the same hook', () => {
    expect(runner.match(/analyzeVideo\(/g)).toHaveLength(1);
    expect(runner).toContain('onGraphicsDecision: graphics => {');
    expect(runner).toContain('requestGraphicsStatus({');
    expect(runner).not.toMatch(/runMotionGraphicsStage|decideClaudeBound|libraryOnlyGraphics/);
    const analyze = read('server/src/pipeline/analyzeVideo.ts');
    expect(analyze).toContain('const motionGraphicsOn = motionGraphicsRequested && (claudeAllowed || libraryOnly);');
    expect(analyze).toContain('const motionGraphicsRequested = !cutsOnlyVisualsOff && (input.generatedGraphicsEnabled ?? flags.motionGraphics);'); // the flag, default false
    expect(read('server/src/config/env.ts')).toContain('MOTION_GRAPHICS_ENABLED: bool(false),');
  });
  it('the profile and the graphics decision come from server configuration only: no request field names them', () => {
    const schemas = read('server/src/http/schemas.ts');
    // the analyze request schema (the render style schema has its own optional `generatedGraphicsEnabled`, which the analyze runner never reads)
    const analyzeSchema = schemas.slice(schemas.indexOf('export const analyzeRequestSchema'), schemas.indexOf('export const', schemas.indexOf('export const analyzeRequestSchema') + 10));
    expect(analyzeSchema.length).toBeGreaterThan(100);
    expect(analyzeSchema).not.toMatch(/editProfile|graphics|POLISH_DEFAULT_EDITS|PRODUCT_EDIT_PROFILE/i);
    expect(schemas).not.toMatch(/editProfile|POLISH_DEFAULT_EDITS|PRODUCT_EDIT_PROFILE/i);
    expect(read('server/src/pipeline/analysisRunner.ts')).not.toContain('generatedGraphicsEnabled');
    expect(read('server/src/config/env.ts')).toContain("PRODUCT_EDIT_PROFILE: str('cuts'),"); // the default is still cuts
  });
  it('the job type and the stored status know polish and library_only', () => {
    const types = read('server/src/types/blueprint.ts');
    expect(types).toContain("editProfile?: 'legacy' | 'mvp' | 'cuts' | 'polish';");
    expect(types).toContain("graphics?: 'off' | 'on' | 'skipped_budget' | 'library_only';");
  });
});

describe('B: the polish production trial block in both example files (commented)', () => {
  it.each(['.env.example', '.env.production.example'])('%s documents the trial and sets nothing live', file => {
    const text = read(file);
    for (const line of ['# PRODUCT_EDIT_PROFILE=polish', '# POLISH_DEFAULT_EDITS=lean', '# MOTION_GRAPHICS_ENABLED=1', '# GEMINI_EDIT_MAX_REQUESTS=8', '# CLAUDE_EDIT_BUDGET_USD=']) {
      expect(text.split('\n').some(entry => entry.startsWith(line)), `${file}: ${line}`).toBe(true);
    }
    expect(text).toContain('library_only');
    expect(text).toContain('SAME variables');
    for (const name of ['PRODUCT_EDIT_PROFILE', 'POLISH_DEFAULT_EDITS', 'MOTION_GRAPHICS_ENABLED', 'GEMINI_EDIT_MAX_REQUESTS']) expect(text, `${file}: ${name}`).not.toMatch(new RegExp(`^${name}=[^\\s#]`, 'm'));
  });
  it('the first-video help says the HTTP analyze path reads the same profile', () => {
    expect(read('server/src/scripts/firstVideo.ts')).toContain('the HTTP analyze path reads the same PRODUCT_EDIT_PROFILE and runs the same stack');
  });
});

describe('C: ingest URL guard (no network: an injected resolver)', () => {
  const publicResolver = async () => ['93.184.216.34'];
  const refused = async (url: string) => assertPublicHttpUrl(url, {resolve: publicResolver}).then(() => 'allowed', error => (error instanceof BlockedUrlError ? 'blocked' : `other:${String(error)}`));
  it.each([
    'http://localhost/video.mp4', 'http://LOCALHOST:8080/x', 'http://foo.localhost/x', 'http://127.0.0.1/x', 'http://127.1.2.3:9000/x', 'http://2130706433/x', 'http://0x7f000001/x', 'http://0.0.0.0/x',
    'http://10.0.0.5/x', 'http://172.16.0.1/x', 'http://172.31.255.255/x', 'http://192.168.1.1/x', 'http://169.254.169.254/latest/meta-data/', 'http://169.254.170.2/x', 'http://100.64.0.1/x',
    'http://[::1]/x', 'http://[::ffff:127.0.0.1]/x', 'http://[::ffff:10.0.0.1]/x', 'http://[fd00:ec2::254]/x', 'http://[fe80::1]/x',
    'http://metadata.google.internal/computeMetadata/v1/', 'http://metadata/x', 'http://service.internal/x', 'http://printer.local/x', 'http://user:pass@example.com/x', 'ftp://example.com/x', 'file:///etc/passwd', 'not a url',
  ])('blocks %s', async url => {
    expect(await refused(url)).toBe('blocked');
  });
  it.each(['https://example.com/video.mp4', 'http://93.184.216.34/video.mp4', 'https://cdn.example.org:8443/a/b.mp4?x=1'])('allows the public URL %s', async url => {
    expect(await refused(url)).toBe('allowed');
  });
  it('a public name that resolves to a private address is blocked (rebinding by DNS), and an unresolvable name fails closed', async () => {
    expect(await assertPublicHttpUrl('https://sneaky.example.com/x', {resolve: async () => ['10.0.0.9']}).then(() => 'allowed', () => 'blocked')).toBe('blocked');
    expect(await assertPublicHttpUrl('https://mixed.example.com/x', {resolve: async () => ['93.184.216.34', '169.254.169.254']}).then(() => 'allowed', () => 'blocked')).toBe('blocked');
    expect(await assertPublicHttpUrl('https://nowhere.example.com/x', {resolve: async () => []}).then(() => 'allowed', () => 'blocked')).toBe('blocked');
    expect(await assertPublicHttpUrl('https://boom.example.com/x', {resolve: async () => { throw new Error('dns'); }}).then(() => 'allowed', () => 'blocked')).toBe('blocked');
  });
  it('the HTTP request schema takes http(s) URLs only: a local path or file URL cannot reach the local-copy branch', () => {
    const schemas = read('server/src/http/schemas.ts');
    expect(schemas).toContain('videoUrl must be an http(s) URL');
    for (const raw of ['/etc/passwd', 'file:///etc/passwd', 'C:\\Windows\\win.ini']) expect(isLocalMediaPath(raw), raw).toBe(true); // these are what the CLI may pass...
    expect(schemas).toContain("return url.protocol === 'https:' || url.protocol === 'http:';"); // ...and the HTTP schema accepts only these two schemes
  });
  it('local laptop paths still take the local copy (first-video), and every network fetch of a media URL goes through the pinned downloadToFile', () => {
    expect(isLocalMediaPath('/Users/me/clip.mp4')).toBe(true);
    expect(isLocalMediaPath('https://example.com/clip.mp4')).toBe(false);
    const analyze = read('server/src/pipeline/analyzeVideo.ts');
    expect(analyze).toContain('? await copyLocalFile(input.videoUrl, sourcePath, {maxBytes: MAX_SOURCE_BYTES})\n      : await downloadToFile(input.videoUrl, sourcePath, {maxBytes: MAX_SOURCE_BYTES});');
    const temp = read('server/src/lib/tempFiles.ts');
    expect(temp).toContain('pinPublicHttpUrl');
    expect(temp).toContain('redirectTarget');
    for (const file of ['server/src/stages/broll/userBrollDescribe.ts', 'server/src/stages/render/prefetchAssets.ts', 'server/src/pipeline/captionKitBurn.ts']) {
      expect(read(file), file).toMatch(/downloadToFile/);
      expect(read(file), file).not.toMatch(/\bfetch\(/);
    }
  });
});

describe('D: post-render integrity (pure, mocked facts)', () => {
  const good: OutputFacts = {path: 'x.mp4', exists: true, bytes: 2_000_000, probe: {width: 1080, height: 1920, durationSec: 35.7, fps: 30, hasAudio: true}, decode: {ok: true, errors: [], decodedFrames: 1071, expectedFrames: 1071}} as never;
  const expected = {width: 1080, height: 1920, durationSec: 35.7, expectAudio: true};
  it('a good render passes', () => {
    expect(judgeRenderOutput(good, expected)).toEqual([]);
    expect(() => assertRenderOutputValid(good, expected)).not.toThrow();
  });
  it.each([
    ['output_missing', {...good, exists: false}],
    ['output_empty', {...good, bytes: RENDER_MIN_BYTES - 1}],
    ['output_unreadable', {...good, probe: undefined, probeError: 'bad moov'}],
    ['dimensions_mismatch', {...good, probe: {...good.probe!, width: 720}}],
    ['duration_mismatch', {...good, probe: {...good.probe!, durationSec: 0}}],
    ['duration_mismatch', {...good, probe: {...good.probe!, durationSec: 12}}],
    ['audio_missing', {...good, probe: {...good.probe!, hasAudio: false}}],
    ['output_not_decoded', {...good, decode: undefined}],
    ['output_corrupt', {...good, decode: {ok: false, errors: ['invalid data'], decodedFrames: 10, expectedFrames: 1071}}],
  ])('fails %s', (check, facts) => {
    expect(judgeRenderOutput(facts as never, expected).map(failure => failure.check)).toContain(check);
    expect(() => assertRenderOutputValid(facts as never, expected)).toThrow(EngineError);
  });
  it('the typed error is render_failed and names every failed check; the audio check applies only when audio is expected', () => {
    try {
      assertRenderOutputValid({...good, probe: {...good.probe!, width: 720, hasAudio: false}} as never, expected);
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as EngineError).code).toBe('render_failed');
      expect((error as EngineError).message).toContain('dimensions_mismatch, audio_missing');
    }
    expect(judgeRenderOutput({...good, probe: {...good.probe!, hasAudio: false}} as never, {...expected, expectAudio: undefined})).toEqual([]);
  });
  it('the local render runs the check after the real probe and decode, before the upload; the Lambda path has its own check', () => {
    const local = read('server/src/stages/render/localRender.ts');
    expect(local.indexOf('assertRenderOutputValid(await inspectOutput(uploadPath)')).toBeGreaterThan(0);
    expect(local.indexOf('assertRenderOutputValid(await inspectOutput(uploadPath)')).toBeLessThan(local.indexOf('uploadRenderedVideo(uploadPath'));
    expect(read('server/src/pipeline/renderRunner.ts')).toContain('download: (url, destination) => downloadToFile(url, destination');
    expect(read('server/src/lib/lambdaOutputCheck.ts')).toContain('assertRenderOutputValid');
  });
  it('WP8I: the blueprint of the shipping profiles (cuts, polish) carries sourceHasAudio, so the Lambda output check has an audio expectation', () => {
    expect(read('server/src/pipeline/analyzeVideo.ts')).toContain('...(mvpLike || speechCutsOn ? {sourceHasAudio: originalProbe.hasAudio} : {}),');
  });
});
