import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, describe, expect, it, vi} from 'vitest';

import type {AudioDesign} from '../../types/blueprint.ts';
import {applyDuckOverrides} from '../../scripts/renderBlueprint.ts';
import {SFX_WORD_MASK_SEC, schedulePolishSfxHits} from '../../lib/polishSfx.ts';
import {nonPublicBedUrls} from './bedUrls.ts';
import {resolveDuckReleaseSec, resolvePoolSize} from './flags.ts';
import {masteredKeyFor, masterLambdaOutput, type LambdaMasterDeps} from './lambdaMaster.ts';
import {buildMusicSummary} from './musicSummary.ts';
import {poolPlan} from './musicSpecialist.ts';
import {playbackFromPlan, toAudioDesign} from './toAudioDesign.ts';
import {mergePoolEntry, type PoolBed} from './uploadBed.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const BED = (name: string): PoolBed => ({cache_key: name.repeat(64).slice(0, 64), url: `https://media.kinmel.shop/music/beds/${name}/bed.wav`});

describe('production defaults', () => {
  it('pool size 3, release 300 ms, each with an env override', () => {
    expect(resolvePoolSize({})).toBe(3);
    expect(resolvePoolSize({MUSIC_BED_POOL_SIZE: '5'})).toBe(5);
    expect(resolvePoolSize({MUSIC_BED_POOL_SIZE: 'x'})).toBe(3);
    expect(resolveDuckReleaseSec({})).toBe(0.3);
    expect(resolveDuckReleaseSec({MUSIC_DUCK_RELEASE_MS: '450'})).toBe(0.45);
    expect(resolveDuckReleaseSec({MUSIC_DUCK_RELEASE_MS: '0'})).toBe(0.3);
  });
});

describe('pool growth', () => {
  const salvaged = BED('a');
  it('appends a new bed that passed QC while the pool is under its size and keeps the salvaged bed first', () => {
    const out = mergePoolEntry([salvaged], BED('b'), {}, {maxSize: 3, allowAppend: true});
    expect(out).toMatchObject({changed: true, appended: true});
    expect(out.beds.map(bed => bed.cache_key[0])).toEqual(['a', 'b']);
    expect(out.beds[0]).toEqual(salvaged);
  });
  it('does not append at the size cap, or when QC failed', () => {
    const full = [BED('a'), BED('b'), BED('c')];
    expect(mergePoolEntry(full, BED('d'), {}, {maxSize: 3})).toMatchObject({changed: false, appended: false, skipped: 'pool_full'});
    expect(mergePoolEntry([salvaged], BED('b'), {}, {maxSize: 3, allowAppend: false})).toMatchObject({changed: false, skipped: 'qc_failed'});
  });
  it('still patches an existing entry when the pool is full', () => {
    const full = [BED('a'), BED('b'), BED('c')];
    const out = mergePoolEntry(full, full[0]!, {carved_url: 'https://media.kinmel.shop/x/bed_carved.wav'}, {maxSize: 3});
    expect(out).toMatchObject({changed: true, appended: false});
    expect(out.beds).toHaveLength(3);
  });
});

describe('pool growth through uploadBedDetailed (fake R2, never the real pool)', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.doUnmock('../../storage/r2.ts');
  });

  async function run(existingPool: PoolBed[], qcPassed: boolean | undefined) {
    vi.resetModules();
    const uploads: Array<{key: string; body: string}> = [];
    vi.doMock('../../storage/r2.ts', () => ({
      r2Configured: () => true,
      sourceObjectExists: async () => false,
      uploadPublicFile: async (filePath: string, key: string) => {
        uploads.push({key, body: key.endsWith('.json') ? readFileSync(filePath, 'utf8') : ''});
        return {publicUrl: `https://fake-r2.test/${key}`, key};
      },
    }));
    vi.stubGlobal('fetch', async (url: string) => {
      if (String(url).includes('music/beds/pool/')) return {ok: true, json: async () => ({beds: existingPool})};
      return {ok: false, json: async () => ({})};
    });
    const {uploadBedDetailed} = await import('./uploadBed.ts');
    await uploadBedDetailed({filePath: '/nonexistent/bed.wav', cacheKey: 'n'.repeat(64), mood: 'calm', dry: false, meta: {bpm: 64, qc_passed: qcPassed, duration_sec: 50}});
    return uploads;
  }

  it('writes the pool JSON with the new bed appended after the existing one', async () => {
    const uploads = await run([BED('a')], true);
    const pool = uploads.find(item => item.key === 'music/beds/pool/calm.json');
    expect(pool).toBeDefined();
    expect(JSON.parse(pool!.body).beds.map((bed: PoolBed) => bed.cache_key[0])).toEqual(['a', 'n']);
    expect(uploads.every(item => item.key.startsWith('music/beds/'))).toBe(true);
  });
  it('does not touch the pool when QC failed, but still stores the bed', async () => {
    const uploads = await run([BED('a')], false);
    expect(uploads.some(item => item.key.includes('pool/'))).toBe(false);
    expect(uploads.some(item => item.key.endsWith('/bed.wav'))).toBe(true);
  });
  it('does not touch the pool when it is already full', async () => {
    const uploads = await run([BED('a'), BED('b'), BED('c')], true);
    expect(uploads.some(item => item.key.includes('pool/'))).toBe(false);
  });
});

describe('bed URLs Lambda can fetch', () => {
  const good = {
    musicUrl: 'https://media.kinmel.shop/music/beds/k/bed.wav',
    musicFullUrl: 'https://media.kinmel.shop/music/beds/k/bed_full.wav',
    musicLoopUrl: 'https://media.kinmel.shop/music/beds/k/bed_loop.wav',
    musicCarvedUrl: 'https://media.kinmel.shop/music/beds/k/bed_carved.wav',
  };
  it('accepts public https URLs', () => {
    expect(nonPublicBedUrls(good)).toEqual([]);
    expect(nonPublicBedUrls(undefined)).toEqual([]);
  });
  it.each([
    ['/Users/me/bed_full.wav'],
    ['./out/music-loop/bed_loop.wav'],
    ['file:///tmp/bed.wav'],
    ['dry-run://sfx/sfx0'],
    ['http://media.kinmel.shop/bed.wav'],
    ['https://localhost/bed.wav'],
    ['https://192.168.1.4/bed.wav'],
    ['staticFile:music-smoke-bed.wav'],
  ])('flags %s', value => {
    expect(nonPublicBedUrls({...good, musicLoopUrl: value})).toEqual([{field: 'musicLoopUrl', value}]);
  });
  it('a pool plan built from public URLs produces a design with no local path in any bed field', () => {
    const plan = poolPlan({...BED('a'), full_url: good.musicFullUrl, loop_url: good.musicLoopUrl, carved_url: good.musicCarvedUrl, duration_sec: 56.68}, 'high-energy');
    const design = toAudioDesign({resolved: {url: plan.url as string, source: 'generated'}, mood: 'high-energy', ...playbackFromPlan(plan, {})});
    expect(design.musicCarvedUrl).toBe(good.musicCarvedUrl);
    expect(nonPublicBedUrls(design)).toEqual([]);
  });
  it('a plan with a local file path is caught', () => {
    const design = toAudioDesign({resolved: {url: 'https://media.kinmel.shop/bed.wav', source: 'generated'}, loop: {fullUrl: '/tmp/bed_full.wav', loopUrl: '/tmp/bed_loop.wav', fullDurationSec: 50}});
    expect(nonPublicBedUrls(design).map(item => item.field).sort()).toEqual(['musicFullUrl', 'musicLoopUrl']);
  });
  it('the saved proof blueprint (when present) uses public https URLs only', () => {
    const file = path.resolve(here, '../../../../out/fixtures/proof/blueprint.json');
    if (!existsSync(file)) return;
    const audio = (JSON.parse(readFileSync(file, 'utf8')) as {blueprint: {audioDesign: AudioDesign}}).blueprint.audioDesign;
    expect(nonPublicBedUrls(audio)).toEqual([]);
  });
});

describe('Lambda master pass', () => {
  const master = {beforeLufs: -22, beforeTruePeak: -11, afterLufs: -14, afterTruePeak: -2.7};
  function deps(overrides: Partial<LambdaMasterDeps> = {}) {
    const calls: string[] = [];
    const base: LambdaMasterDeps = {
      download: async (url, dest) => void calls.push(`download ${url} ${dest}`),
      master: async file => (calls.push(`master ${file}`), master),
      verify: async file => void calls.push(`verify ${file}`),
      upload: async (file, key) => (calls.push(`upload ${key}`), {publicUrl: `https://media.kinmel.shop/${key}`}),
      workspace: {file: name => `/ws/${name}`, cleanup: async () => void calls.push('cleanup')},
      env: {},
      ...overrides,
    };
    return {base, calls};
  }
  const input = {outputUrl: 'https://s3.lambda.test/renders/rn_1.mp4', renderJobId: 'rn_1'};

  it('downloads, masters, verifies, uploads under its own key and returns that URL', async () => {
    const {base, calls} = deps();
    const result = await masterLambdaOutput(input, base);
    expect(result).toMatchObject({mastered: true, master});
    expect(result.url).toContain('rn_1-mastered.mp4');
    expect(result.url).not.toBe(input.outputUrl);
    expect(calls.map(call => call.split(' ')[0])).toEqual(['download', 'master', 'verify', 'upload', 'cleanup']);
    expect(masteredKeyFor('rn_1', new Date('2026-11-04T00:00:00Z'))).toBe('ai-video/render/2026-11-04/rn_1-mastered.mp4');
  });
  it.each(['download', 'master', 'verify', 'upload'] as const)('keeps the unmastered URL when %s fails', async step => {
    const boom = async () => {
      throw new Error(`${step} boom`);
    };
    const {base, calls} = deps({[step]: boom} as Partial<LambdaMasterDeps>);
    const result = await masterLambdaOutput(input, base);
    expect(result).toMatchObject({url: input.outputUrl, mastered: false});
    expect(result.reason).toContain('boom');
    expect(calls).toContain('cleanup');
    if (step !== 'upload') expect(calls.some(call => call.startsWith('upload'))).toBe(false);
  });
  it('MUSIC_MASTER_PASS=0 does nothing: no download, original URL', async () => {
    const {base, calls} = deps({env: {MUSIC_MASTER_PASS: '0'}});
    expect(await masterLambdaOutput(input, base)).toEqual({url: input.outputUrl, mastered: false, reason: 'off'});
    expect(calls).toEqual([]);
  });
});

describe('music.summary', () => {
  const audio: AudioDesign = {
    musicMood: 'high-energy',
    musicUrl: 'https://media.kinmel.shop/b/bed.wav',
    musicCarvedUrl: 'https://media.kinmel.shop/b/bed_carved.wav',
    musicSource: 'generated',
    voLufs: -20,
    sfx: [],
    hits: [
      {at: 1, kind: 'hit'},
      {at: 3, kind: 'pop', src: 'staticFile:sfx-library/a.wav', durationSec: 0.3},
    ],
    musicProvenance: {source: 'pool', mood: 'high-energy', costUsd: 0, cacheKey: 'k'},
    duck: {preset: 'talking', speechDb: -22, pauseDb: -13, openDb: -8, voLufs: -20, bedLufs: -16, attackSec: 0.08, holdSec: 0.15, releaseSec: 0.3, leadSec: 0.0333, phrases: [], durationSec: 10},
  };
  it('reports source, cost, voice, intended gaps, carved, master, final loudness and SFX by source', () => {
    const summary = buildMusicSummary({audioDesign: audio, master: {beforeLufs: -22, beforeTruePeak: -11, afterLufs: -14, afterTruePeak: -2.7}, env: {}});
    expect(summary).toEqual({
      source: 'pool', mood: 'high-energy', costUsd: 0, voLufs: -20, intendedSpeechGapLu: 18, intendedPauseGapLu: 9,
      carvedApplied: true, masterApplied: true, finalLufs: -14, finalTruePeak: -2.7, sfxHits: {catalog: 1, builtIn: 1}, fallbackReason: null,
      // Phase 3 fields are null for a blueprint with no brief or placement
      style: null, bedStyle: null, family: null, bpm: null, key: null, speechWpm: null, arc: null, measuredLiftSec: null, liftAtVideoSec: null, hookAtSec: null,
      startOffsetSec: null, startsOnDownbeat: null, placementScore: null, endType: null, fallbackTier: null, sfxSnapped: null, sfxDropped: null,
      loudnessAware: false, loudnessCorrectionDb: null,
    });
  });
  it('shows a generation cost, a fallback reason, carved off and no master', () => {
    const summary = buildMusicSummary({
      audioDesign: {...audio, musicProvenance: {source: 'generated', costUsd: 0.0075, fallbackReason: 'timeout'}},
      master: null,
      masterRequested: true,
      env: {MUSIC_CARVED_TWIN: '0'},
    });
    expect(summary).toMatchObject({source: 'generated', costUsd: 0.0075, carvedApplied: false, masterApplied: false, finalLufs: null, fallbackReason: 'timeout'});
  });
  it('reports the brief, the measured lift, the offset, the score, the ending and the SFX snap counts for a personalised edit', () => {
    const personalised: AudioDesign = {
      ...audio,
      musicStartOffsetSec: 14.5,
      musicEndSec: 18.12,
      musicEndFadeSec: 0.12,
      musicEndType: 'button',
      musicPlacementScore: 0.83,
      musicProvenance: {
        source: 'generated', mood: 'driving-electronic', costUsd: 0.0075, fallbackTier: 'style',
        brief: {style: 'driving-electronic', family: 'high-energy', bpm: 128, key: 'A minor', speechWpm: 184, arc: 'hook-then-steady', energy: 'high', hookAtSec: 2.5},
        bedStyle: 'upbeat-pop', bedMeasuredLiftSec: 16.5, liftAtVideoSec: 2, startsOnDownbeat: true, sfxSnapped: 3, sfxDropped: 1, loudnessDuck: {minDb: -2.5, maxDb: 3.5},
      },
      duck: {...audio.duck!, bedLoudness: {stepSec: 0.1, lufs: [-16, -17]}},
    };
    expect(buildMusicSummary({audioDesign: personalised, env: {}})).toMatchObject({
      source: 'generated', costUsd: 0.0075, style: 'driving-electronic', bedStyle: 'upbeat-pop', family: 'high-energy', bpm: 128, key: 'A minor', speechWpm: 184, arc: 'hook-then-steady',
      measuredLiftSec: 16.5, liftAtVideoSec: 2, hookAtSec: 2.5, startOffsetSec: 14.5, startsOnDownbeat: true, placementScore: 0.83, endType: 'button', fallbackTier: 'style', sfxSnapped: 3, sfxDropped: 1,
      loudnessAware: true, loudnessCorrectionDb: {minDb: -2.5, maxDb: 3.5},
    });
  });
  it('no bed means source none with a reason; an old blueprint without provenance still summarizes', () => {
    expect(buildMusicSummary({audioDesign: {sfx: []}})).toMatchObject({source: 'none', fallbackReason: 'no_bed', costUsd: 0});
    expect(buildMusicSummary({audioDesign: undefined})).toMatchObject({source: 'none', sfxHits: {catalog: 0, builtIn: 0}});
    const { musicProvenance: _p, ...old } = audio;
    expect(buildMusicSummary({audioDesign: old}).source).toBe('generated');
  });
});

describe('word mask on built-in hits (scheduling time only)', () => {
  const graphics = [{start: 5.05, end: 7, placementMode: 'full_screen'}, {start: 9, end: 11, placementMode: 'split_screen'}];
  const common = {graphics, transitions: [{at: 5.0, keyword: 'whip pan'}]};

  it('a new edit drops a built-in hit within 120 ms after a word onset', () => {
    // the onset is at 5.0 s, so the 5.05 s plate hit would cover the word; the 9.0 s one is clear
    const masked = schedulePolishSfxHits({...common, wordOnsetsSec: [5.0, 8.0]});
    expect(masked.hits.map(hit => hit.at)).toEqual([5.0, 9]);
    expect(masked.maskedByWord).toBe(1);
    expect(SFX_WORD_MASK_SEC).toBe(0.12);
    const edge = schedulePolishSfxHits({graphics: [{start: 5.12, end: 7, placementMode: 'full_screen'}, {start: 5.121, end: 7, placementMode: 'split_screen'}], wordOnsetsSec: [5.0]});
    expect(edge.hits.map(hit => hit.at)).toEqual([5.121]);
  });
  it('without onsets (an older code path) nothing is masked and the output is exactly as before', () => {
    const unmasked = schedulePolishSfxHits(common);
    expect(unmasked.hits.map(hit => hit.at)).toEqual([5, 9]); // 5.05 is within the 0.8 s spacing of 5.0, so spacing removed it, not the mask
    expect(unmasked.maskedByWord).toBe(0);
    const withEmpty = schedulePolishSfxHits({...common, wordOnsetsSec: []});
    expect(withEmpty.hits).toEqual(unmasked.hits);
  });
  it('a saved blueprint keeps its stored hits: the render path never reschedules', () => {
    const saved: AudioDesign = {sfx: [], hits: [{at: 5.05, kind: 'hit', volume: 0.14, reason: 'graphic_full_screen'}]};
    const bp = {audioDesign: saved, captionWords: [{text: 'a', start: 5, end: 5.4}], outputDurationSec: 10} as never;
    expect(applyDuckOverrides(bp, {}).audioDesign).toBe(saved);
    expect(applyDuckOverrides(bp, {}).audioDesign?.hits).toEqual([{at: 5.05, kind: 'hit', volume: 0.14, reason: 'graphic_full_screen'}]);
    const source = readFileSync(path.resolve(here, '../../scripts/renderBlueprint.ts'), 'utf8');
    expect(source).not.toMatch(/polishSfx|schedulePolishSfxHits/);
  });
});
