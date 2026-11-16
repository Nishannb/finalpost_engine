import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

import {buildDuckEnvelope} from '../stages/music/duckEnvelope.ts';
import {applyBedAttestation, applyCarvedOverride, applyDuckOverrides, applyRenderEnv, parseCliArgs, resolveBlueprintPath, resolveVideoUrl, storedBedLoudnessIssue} from './renderBlueprint.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('render-blueprint never reaches a paid path', () => {
  const source = readFileSync(path.join(here, 'renderBlueprint.ts'), 'utf8').toLowerCase();
  it.each(['analyzevideo', 'runwaretransport', '@anthropic-ai', 'groq', 'google.generative', '@google/generative-ai', 'rendermediaonlambda'])(
    'source does not mention %s',
    banned => {
      expect(source.includes(banned)).toBe(false);
    },
  );

  it('resolves a relative blueprint path under the repo root, keeps absolute paths', () => {
    expect(resolveBlueprintPath('out/fixtures/proof/blueprint.json')).toBe(path.resolve(here, '../../..', 'out/fixtures/proof/blueprint.json'));
    expect(resolveBlueprintPath('/abs/b.json')).toBe('/abs/b.json');
  });

  it('static imports are only the duck helper, the pure SFX-3E fail-safe classifiers, types and node builtins', () => {
    const imports = [...source.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)].map(m => m[1]);
    expect(imports.filter(spec => spec!.startsWith('.'))).toEqual(['../stages/music/bgmfailsafe.ts', '../stages/render/rendersafety.ts', '../stages/music/duckenvelope.ts', '../types/blueprint.ts']);
    // SFX-3H: renderSafety.ts is the shared production rule; its imports are the error type (-> billingGuard -> node:async_hooks), types and the pure classifier.
    const safety = readFileSync(new URL('../stages/render/renderSafety.ts', import.meta.url), 'utf8');
    expect([...safety.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)].map(m => m[1])).toEqual(['../../lib/errors.ts', '../../types/blueprint.ts', '../music/bgmFailSafe.ts']);
    // bgmFailSafe.ts stays pure: its only import is the duck helper (no I/O, no network, no paid path).
    const failSafe = readFileSync(new URL('../stages/music/bgmFailSafe.ts', import.meta.url), 'utf8');
    expect([...failSafe.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)].map(m => m[1])).toEqual(['./duckEnvelope.ts']);
  });
});

describe('talking offset overrides', () => {
  const base = {words: [{start: 0, end: 1}], durationSec: 5, preset: 'talking' as const, voLufs: -20, bedLufs: -16};
  it('speechOffsetLu replaces the speech offset only', () => {
    const duck = buildDuckEnvelope({...base, speechOffsetLu: -16});
    expect(duck.speechDb).toBe(-20); // clamp((-20) + (-16) - (-16))
    expect(duck.pauseDb).toBe(-13); // default -9
    expect(duck.openDb).toBe(-8); // default -4
  });
  it('absolute presets ignore the offsets', () => {
    const duck = buildDuckEnvelope({...base, preset: 'default', speechOffsetLu: -30});
    expect(duck.speechDb).toBe(-13);
  });
  it('no offsets leaves talking unchanged', () => {
    expect(buildDuckEnvelope(base).speechDb).toBe(-22);
  });
});

describe('applyDuckOverrides', () => {
  const bp = {
    outputDurationSec: 5,
    captionWords: [{text: 'a', start: 0, end: 1, sentenceIndex: 0}],
    audioDesign: {musicSource: 'generated', musicFullUrl: 'https://x/bed.wav', voLufs: -20, sfx: []},
  } as never;
  it('rebuilds a missing duck and honours the offset', () => {
    const out = applyDuckOverrides(bp, {speechOffset: -16, bedLufs: -16});
    expect(out.rebuilt).toBe(true);
    expect(out.audioDesign?.duck?.speechDb).toBe(-20);
  });
  it('leaves the blueprint alone with no flags and an existing duck', () => {
    const withDuck = {...(bp as object), audioDesign: {...(bp as {audioDesign: object}).audioDesign, duck: {preset: 'talking'}}} as never;
    expect(applyDuckOverrides(withDuck, {}).rebuilt).toBe(false);
  });
});

describe('applyCarvedOverride', () => {
  const ad = {musicSource: 'generated', musicFullUrl: 'https://x/bed.wav', musicCarvedUrl: 'https://x/carved.wav', sfx: []} as never;
  it('--carved 0 omits musicCarvedUrl; 1 and omitted keep it', () => {
    expect('musicCarvedUrl' in (applyCarvedOverride(ad, '0').audioDesign as object)).toBe(false);
    expect(applyCarvedOverride(ad, '1').audioDesign).toBe(ad);
    expect(applyCarvedOverride(ad, undefined).audioDesign).toBe(ad);
  });
});

describe('cli helpers', () => {
  it('parses flags', () => {
    const o = parseCliArgs(['f.json', '--duck-preset', 'default', '--speech-offset=-16', '--carved', '0', '--master', '1']);
    expect(o).toMatchObject({file: 'f.json', duckPreset: 'default', speechOffset: -16, carved: '0', master: '1', measure: '0'});
  });
  it('parses hold and release in ms, defaults master on, and rejects out-of-range values', () => {
    expect(parseCliArgs(['f.json'])).toMatchObject({master: '1', measure: '0'});
    expect(parseCliArgs(['f.json', '--release-ms', '300', '--hold-ms=100'])).toMatchObject({releaseMs: 300, holdMs: 100});
    expect(parseCliArgs(['f.json', '--lead-ms', '33.3']).leadMs).toBe(33.3);
    expect(() => parseCliArgs(['f.json', '--lead-ms', '500'])).toThrow(/lead-ms/);
    expect(() => parseCliArgs(['f.json', '--release-ms', '0'])).toThrow(/release-ms/);
    expect(() => parseCliArgs(['f.json', '--hold-ms', 'x'])).toThrow(/number/);
  });
  it('hold and release rebuild the duck without touching the defaults', () => {
    const bp = {audioDesign: {musicSource: 'generated', musicUrl: 'u', duck: buildDuckEnvelope({words: [{start: 1, end: 2}], durationSec: 6})}, captionWords: [{text: 'a', start: 1, end: 2}], outputDurationSec: 6} as never;
    const out = applyDuckOverrides(bp, {releaseMs: 300, holdMs: 100, bedLufs: -16});
    expect(out.rebuilt).toBe(true);
    expect(out.audioDesign?.duck).toMatchObject({releaseSec: 0.3, holdSec: 0.1});
    expect(buildDuckEnvelope({words: [], durationSec: 1})).toMatchObject({releaseSec: 0.3, holdSec: 0.15, leadSec: 0.0333});
  });
  it('a rebuild keeps the timing the blueprint was saved with (an older blueprint keeps 450 ms and no look-ahead)', () => {
    const old = buildDuckEnvelope({words: [{start: 1, end: 2}], durationSec: 6, releaseSec: 0.45, leadSec: 0});
    const bp = {audioDesign: {musicSource: 'generated', musicUrl: 'u', duck: old}, captionWords: [{text: 'a', start: 1, end: 2}], outputDurationSec: 6} as never;
    expect(applyDuckOverrides(bp, {speechOffset: -16, bedLufs: -16}).audioDesign?.duck).toMatchObject({releaseSec: 0.45, leadSec: 0, holdSec: 0.15});
    expect(applyDuckOverrides(bp, {speechOffset: -16, releaseMs: 300, bedLufs: -16}).audioDesign?.duck).toMatchObject({releaseSec: 0.3, leadSec: 0});
    const withLead = applyDuckOverrides(bp, {leadMs: 33.3, bedLufs: -16}).audioDesign?.duck;
    expect(withLead?.releaseSec).toBe(0.45);
    expect(withLead?.leadSec).toBeCloseTo(0.0333, 6);
  });
  it('fails clearly on a missing prefetch path with no source', () => {
    expect(() => resolveVideoUrl('/prefetch/job/source.mp4', null, () => false)).toThrow(/sourceVideoPath/);
    expect(resolveVideoUrl('/prefetch/job/source.mp4', '/a/b.mp4', p => p === '/a/b.mp4')).toBe('/a/b.mp4');
    expect(resolveVideoUrl('https://x/y.mp4', null, () => false)).toBe('https://x/y.mp4');
  });
});

describe('the CLI flags win over .env', () => {
  it('applyRenderEnv sets the flags and the R2 skip, and leaves carved alone when it was not asked for', () => {
    const env: NodeJS.ProcessEnv = {MUSIC_MIX_MEASURE: '0', MUSIC_MASTER_PASS: '0', MUSIC_CARVED_TWIN: '0', LOCAL_RENDER_SKIP_R2: '0'};
    applyRenderEnv({carved: undefined, master: '1', measure: '1'}, env);
    expect(env).toMatchObject({MUSIC_MIX_MEASURE: '1', MUSIC_MASTER_PASS: '1', MUSIC_CARVED_TWIN: '0', LOCAL_RENDER_SKIP_R2: '1'});
    applyRenderEnv({carved: '1', master: '0', measure: '0'}, env);
    expect(env).toMatchObject({MUSIC_CARVED_TWIN: '1', MUSIC_MASTER_PASS: '0', MUSIC_MIX_MEASURE: '0'});
  });
  it('applies the env only AFTER the modules that load .env with override are imported (a regression: --measure was silently ignored)', () => {
    const source = readFileSync(path.join(here, 'renderBlueprint.ts'), 'utf8');
    const imports = source.indexOf("import('../stages/render/localRender.ts')");
    const apply = source.indexOf('applyRenderEnv(opts, process.env);');
    expect(imports).toBeGreaterThan(0);
    expect(apply).toBeGreaterThan(imports);
    expect(source.slice(0, imports)).not.toMatch(/process\.env\.[A-Z_]+ =/);
  });
});

describe('Phase SFX-3E: a duck rebuild never assumes the voice level', () => {
  const words = [{text: 'a', start: 0.5, end: 1.2}, {text: 'b', start: 3, end: 4}];
  const blueprint = (audio: Record<string, unknown>, captionWords: unknown = words) => ({outputDurationSec: 6, captionWords, audioDesign: {musicSource: 'generated', musicFullUrl: 'https://x/bed.wav', sfx: [], ...audio}}) as never;

  it('the source no longer contains the -20 LUFS fallback', () => {
    const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'renderBlueprint.ts'), 'utf8');
    expect(source).not.toMatch(/VO_LUFS_ASSUMED/);
  });

  it('no recorded voice level: a voice-relative rebuild is refused with a diagnostic (requested or automatic)', () => {
    expect(() => applyDuckOverrides(blueprint({}), {speechOffset: -16})).toThrow(/records no valid voice loudness \(measurement_failed\)/);
    expect(() => applyDuckOverrides(blueprint({}), {})).toThrow(/never assumed/); // missing duck + words + generated bed = automatic rebuild
    expect(() => applyDuckOverrides(blueprint({voLufs: Number.NaN}), {speechOffset: -16})).toThrow(/invalid/);
  });

  it('the level the blueprint recorded (audioDesign, envelope or stored duck) keeps historical renders compatible', () => {
    const fromAudio = applyDuckOverrides(blueprint({voLufs: -24.7}), {speechOffset: -16, bedLufs: -16});
    expect(fromAudio.audioDesign?.duck?.voLufs).toBe(-24.7);
    expect(applyDuckOverrides(blueprint({}), {speechOffset: -16, bedLufs: -16}, -26).audioDesign?.duck?.voLufs).toBe(-26);
    const storedDuck = buildDuckEnvelope({words, durationSec: 6, preset: 'talking', voLufs: -22, bedLufs: -16});
    expect(applyDuckOverrides(blueprint({duck: storedDuck}), {speechOffset: -16}).audioDesign?.duck?.voLufs).toBe(-22);
  });

  it('an explicit --vo-lufs is used; an absolute preset needs no voice', () => {
    expect(parseCliArgs(['bp.json', '--vo-lufs', '-28.9']).voLufs).toBe(-28.9);
    expect(() => parseCliArgs(['bp.json', '--vo-lufs', '-90'])).toThrow(/-70\.\.0/);
    expect(applyDuckOverrides(blueprint({}), {speechOffset: -16, voLufs: -28.9, bedLufs: -16}).audioDesign?.duck?.voLufs).toBe(-28.9);
    const absolute = applyDuckOverrides(blueprint({}), {duckPreset: 'default'});
    expect(absolute.rebuilt).toBe(true);
    expect(absolute.audioDesign?.duck?.preset).toBe('default');
    expect(absolute.audioDesign && 'voLufs' in absolute.audioDesign).toBe(false);
  });

  it('empty or untrusted stored caption words hold the bed at the speech level (never open)', () => {
    const out = applyDuckOverrides(blueprint({voLufs: -24}, []), {speechOffset: -18, bedLufs: -16});
    expect(out.warnings[0]).toMatch(/caption words unavailable/);
    expect(out.audioDesign?.duck?.phrases).toEqual([{start: 0, end: 6}]);
    const valid = applyDuckOverrides(blueprint({voLufs: -24}), {speechOffset: -18, bedLufs: -16});
    expect(valid.warnings).toEqual([]);
    expect(valid.audioDesign?.duck).toEqual(buildDuckEnvelope({words, durationSec: 6, preset: 'talking', voLufs: -24, bedLufs: -16, speechOffsetLu: -18}));
  });
});

describe('Phase SFX-3G: a generated bed of unknown loudness is never rebuilt or rendered against the assumed -16 LUFS', () => {
  const words = [{text: 'a', start: 0.5, end: 1.2}, {text: 'b', start: 3, end: 4}];
  const blueprint = (audio: Record<string, unknown>) => ({outputDurationSec: 6, captionWords: words, audioDesign: {musicSource: 'generated', musicFullUrl: 'https://x/bed.wav', sfx: [], voLufs: -24, ...audio}}) as never;
  const talkingDuck = (bedLufs: unknown) => ({...buildDuckEnvelope({words, durationSec: 6, preset: 'talking', voLufs: -24, bedLufs: -23}), bedLufs});

  it('the source no longer falls back to -16 for the bed', () => {
    const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'renderBlueprint.ts'), 'utf8');
    expect(source).not.toMatch(/bedLufs \?\? -16/);
  });

  it('a rebuild without a recorded bed loudness is refused; --bed-lufs or the stored duck value is used; an absolute preset needs none', () => {
    expect(() => applyDuckOverrides(blueprint({}), {speechOffset: -16})).toThrow(/records no valid bed loudness \(missing\)/);
    expect(() => applyDuckOverrides(blueprint({}), {})).toThrow(/bed loudness is never assumed/); // automatic rebuild of a missing duck
    expect(applyDuckOverrides(blueprint({}), {speechOffset: -16, bedLufs: -23}).audioDesign?.duck?.bedLufs).toBe(-23);
    expect(applyDuckOverrides(blueprint({duck: talkingDuck(-23)}), {speechOffset: -16}).audioDesign?.duck?.bedLufs).toBe(-23);
    expect(() => applyDuckOverrides(blueprint({duck: talkingDuck(Number.NaN)}), {speechOffset: -16})).toThrow(/invalid/);
    expect(applyDuckOverrides(blueprint({}), {duckPreset: 'default'}).rebuilt).toBe(true);
    expect(parseCliArgs(['bp.json', '--bed-lufs', '-23']).bedLufs).toBe(-23);
    expect(() => parseCliArgs(['bp.json', '--bed-lufs', '4'])).toThrow(/-70\.\.0/);
  });

  it('a stored generated-bed blueprint whose talking duck has no valid bed loudness is refused for rendering; valid, licensed and duck-less beds are not', () => {
    for (const bad of [undefined, null, Number.NaN, Number.POSITIVE_INFINITY, '-23', 5, -95]) {
      expect(storedBedLoudnessIssue(blueprint({duck: talkingDuck(bad)}).audioDesign)).toMatch(/never rendered against the assumed -16 LUFS/);
    }
    // SFX-3H: a valid value needs provenance; without it the blueprint is unverified
    expect(storedBedLoudnessIssue((blueprint({duck: talkingDuck(-23)}) as {audioDesign: never}).audioDesign)).toMatch(/^bed_loudness_unverified/);
    expect(storedBedLoudnessIssue((blueprint({duck: talkingDuck(-23), musicProvenance: {source: 'generated', bedLoudness: {status: 'measured', lufs: -23}}}) as {audioDesign: never}).audioDesign)).toBeNull();
    expect(storedBedLoudnessIssue({...(blueprint({duck: talkingDuck(undefined)}) as {audioDesign: Record<string, unknown>}).audioDesign, musicSource: 'licensed'} as never)).toBeNull();
    expect(storedBedLoudnessIssue((blueprint({}) as {audioDesign: never}).audioDesign)).toBeNull();
    expect(storedBedLoudnessIssue({...(blueprint({duck: {...talkingDuck(undefined), preset: 'default'}}) as {audioDesign: Record<string, unknown>}).audioDesign} as never)).toBeNull();
  });

  // The assertions below are the original SFX-3H ones, unchanged. They used to read a gitignored local proof artifact (out/blueprints/), so they failed on any
  // clean checkout. They now run on an inline fixture of the same shape (a generated bed, a talking duck with a valid bed loudness, NO provenance record) in
  // every environment, and additionally on the real stored blueprint whenever that local artifact exists.
  const assertStoredPhase16Blueprint = (stored: {blueprint: {audioDesign: Record<string, unknown>}}) => {
    const audio = stored.blueprint.audioDesign as never;
    expect(storedBedLoudnessIssue(audio)).toMatch(/^bed_loudness_unverified: bed loudness -23 LUFS has no measurement provenance/);
    expect(applyDuckOverrides(stored.blueprint as never, {}).rebuilt).toBe(false);
    const {audioDesign: attested, attested: ok} = applyBedAttestation(audio, -23);
    expect(ok).toBe(true);
    expect(storedBedLoudnessIssue(attested)).toBeNull();
    // only the provenance differs: the duck, the bed, the hits and every level are byte-identical
    const {musicProvenance, ...rest} = attested as Record<string, unknown>;
    expect(JSON.stringify(rest)).toBe(JSON.stringify(audio));
    expect(musicProvenance).toEqual({source: 'generated', bedLoudness: {status: 'operator_attested', lufs: -23}});
    // attesting a DIFFERENT value does not attest (the caller rebuilds instead)
    expect(applyBedAttestation(audio, -16).attested).toBe(false);
  };

  it('SFX-3H: a stored Phase 1.6 generated-bed blueprint (no provenance; inline fixture) is refused until attested; attesting its own value changes nothing else', () => {
    assertStoredPhase16Blueprint({blueprint: blueprint({duck: talkingDuck(-23)}) as never});
  });

  const storedArtifact = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../out/blueprints/adir_first_bgm_hi.json');
  it.skipIf(!existsSync(storedArtifact))('SFX-3H: the real stored Phase 1.6 generated-bed blueprint (local proof artifact; runs only where out/blueprints/ exists)', () => {
    assertStoredPhase16Blueprint(JSON.parse(readFileSync(storedArtifact, 'utf8')));
  });
});
