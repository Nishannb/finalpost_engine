import {readFileSync} from 'node:fs';
import path from 'node:path';
import {describe, expect, it, vi} from 'vitest';

import {timelineBlueprintSchema} from '../../../../remotion/src/blueprintSchema.ts';
import {musicBedVolumeAt} from '../../../../remotion/src/components/MusicBedTrack.tsx';
import {duckDbAt as remotionDuckDbAt} from '../../../../remotion/src/audio/duckEnvelope.ts';
import {buildDuckEnvelope, duckDbAt, duckLinearGainAt} from './duckEnvelope.ts';
import {mixCheckFor} from './mixCheck.ts';
import {redactSecrets, resolveDuckPreset, resolveMusicMode, resolvePython} from './flags.ts';
import {resolveMusicBed} from './resolveMusicBed.ts';
import {musicResultSchema} from './schema.ts';
import {toAudioDesign} from './toAudioDesign.ts';

describe('music mode flags', () => {
  it('maps off, dry, live, and the legacy 1 switch', () => {
    expect(resolveMusicMode({}).mode).toBe('off');
    expect(resolveMusicMode({MUSIC_SPECIALIST: 'off'}).mode).toBe('off');
    expect(resolveMusicMode({MUSIC_SPECIALIST: 'dry'}).mode).toBe('dry');
    expect(resolveMusicMode({MUSIC_SPECIALIST: '1'}).mode).toBe('dry');
    expect(resolveMusicMode({MUSIC_SPECIALIST: '1', MUSIC_SPECIALIST_LIVE: '1', RUNWARE_API_KEY: 'secret-key'}).mode).toBe('live');
    const downgraded = resolveMusicMode({MUSIC_SPECIALIST: 'live'});
    expect(downgraded.mode).toBe('dry');
    expect(downgraded.downgraded).toBe(true);
  });

  it('redacts the key and bearer tokens', () => {
    const secret = 'super-secret-runware-key';
    const raw = `failed Authorization: Bearer ${secret} token ${secret}`;
    const cleaned = redactSecrets(raw, secret);
    expect(cleaned).not.toContain(secret);
    expect(cleaned).toContain('[redacted]');
  });

  it('prefers an explicit interpreter, then the venv, then python3', () => {
    expect(resolvePython('/nope', {MUSIC_SPECIALIST_PYTHON: '/bin/custom'}).via).toBe('MUSIC_SPECIALIST_PYTHON');
    expect(resolvePython(path.resolve(__dirname, '../../../../agents')).via).toMatch(/agents\/.venv|python3/);
  });
});

describe('resolveMusicBed', () => {
  const licensed = {url: 'https://licensed.example/bed.mp3'};
  const generated = {url: 'https://cdn.example/bed.wav', bpm: 128};

  const cases: Array<['auto' | 'licensed' | 'generated' | 'off', boolean, boolean, string | null]> = [
    ['auto', true, true, 'licensed'],
    ['auto', true, false, 'licensed'],
    ['auto', false, true, 'generated'],
    ['auto', false, false, null],
    ['licensed', true, true, 'licensed'],
    ['licensed', false, true, null],
    ['generated', true, true, 'generated'],
    ['generated', true, false, null],
    ['off', true, true, null],
  ];

  it.each(cases)('%s licensed=%s generated=%s → %s', (source, hasLicensed, hasGenerated, expected) => {
    const resolved = resolveMusicBed({
      licensed: hasLicensed ? licensed : null,
      generated: hasGenerated ? generated : null,
      source,
    });
    expect(resolved?.source ?? null).toBe(expected);
    if (resolved) expect(resolved.url.includes(' ')).toBe(false);
  });
});

describe('duck envelope', () => {
  it('merges sub-350ms gaps and dips before the first word', () => {
    const envelope = buildDuckEnvelope({
      words: [{start: 1, end: 1.2}, {start: 1.4, end: 1.6}, {start: 3, end: 3.4}],
      durationSec: 6,
      preset: 'default',
    });
    expect(envelope.phrases).toEqual([{start: 1, end: 1.6}, {start: 3, end: 3.4}]);
    expect(duckDbAt(envelope, 0.2)).toBe(-4);
    expect(duckDbAt(envelope, 1)).toBe(-13);
    const midAttack = duckDbAt(envelope, 1 - 0.04);
    expect(midAttack).toBeGreaterThan(-13);
    expect(midAttack).toBeLessThan(-4);
  });

  it('holds speech, then releases, and uses the legacy preset', () => {
    const envelope = buildDuckEnvelope({words: [{start: 1, end: 2}], durationSec: 8, preset: 'legacy_brief'});
    expect(duckDbAt(envelope, 2.1)).toBe(-22);
    expect(duckDbAt(envelope, 7)).toBe(-12);
    expect(duckLinearGainAt(envelope, 1)).toBeCloseTo(10 ** (-22 / 20), 6);
  });

  it('matches the Remotion curve', () => {
    for (const preset of ['talking', 'default', 'legacy_brief'] as const) {
      const envelope = buildDuckEnvelope({words: [{start: 0.4, end: 1.1}, {start: 2, end: 2.2}], durationSec: 4, preset, voLufs: -20});
      for (let frame = 0; frame < 4 * 30; frame += 1) {
        expect(duckDbAt(envelope, frame / 30)).toBeCloseTo(remotionDuckDbAt(envelope, frame / 30), 6);
      }
    }
    const envelope = buildDuckEnvelope({words: [{start: 0.4, end: 1.1}, {start: 2, end: 2.2}], durationSec: 4, preset: 'default'});
    for (let frame = 0; frame < 4 * 30; frame += 1) {
      expect(duckDbAt(envelope, frame / 30)).toBeCloseTo(remotionDuckDbAt(envelope, frame / 30), 6);
    }
  });

  it('default preset does not jump more than 1 dB per frame at 120 fps (9 dB over 80 ms)', () => {
    const envelope = buildDuckEnvelope({
      words: [{start: 0.5, end: 1.2}, {start: 2.4, end: 3}],
      durationSec: 5,
      preset: 'default',
    });
    let previous = duckDbAt(envelope, 0);
    for (let frame = 1; frame < 5 * 120; frame += 1) {
      const next = duckDbAt(envelope, frame / 120);
      expect(Math.abs(next - previous)).toBeLessThanOrEqual(1);
      previous = next;
    }
  });
});

describe('talking preset', () => {
  const words = [{start: 0.5, end: 1.2}, {start: 2.4, end: 3}, {start: 3.45, end: 3.7}, {start: 6, end: 6.4}];

  it.each([-16, -20, -24])('voice %s LUFS over a −16 LUFS bed → gains are 18 / 9 / 4 LU under the voice', vo => {
    const envelope = buildDuckEnvelope({words, durationSec: 8, preset: 'talking', voLufs: vo, bedLufs: -16});
    expect(envelope.speechDb).toBe(Math.min(0, vo - 18 + 16));
    expect(envelope.pauseDb).toBe(Math.min(0, vo - 9 + 16));
    expect(envelope.openDb).toBe(Math.min(0, vo - 4 + 16));
    expect(vo - (-16 + envelope.speechDb)).toBe(18);
    expect(vo - (-16 + envelope.pauseDb)).toBe(9);
  });

  it('clamps to [−40, 0] and follows the bed loudness', () => {
    const loud = buildDuckEnvelope({words, durationSec: 8, preset: 'talking', voLufs: -10, bedLufs: -16});
    expect(loud.openDb).toBe(0);
    const quietVoice = buildDuckEnvelope({words, durationSec: 8, preset: 'talking', voLufs: -50, bedLufs: -16});
    expect(quietVoice.speechDb).toBe(-40);
    const hotBed = buildDuckEnvelope({words, durationSec: 8, preset: 'talking', voLufs: -20, bedLufs: -12});
    expect(hotBed.speechDb).toBe(-26);
  });

  it('assumes −20 LUFS for the voice when unmeasured', () => {
    const envelope = buildDuckEnvelope({words, durationSec: 8, preset: 'talking'});
    expect(envelope.voLufs).toBe(-20);
    expect(envelope.speechDb).toBe(-22);
  });

  it('is continuous and bounded by the linear attack slope at 120 fps', () => {
    const envelope = buildDuckEnvelope({words, durationSec: 8, preset: 'talking', voLufs: -20, bedLufs: -16});
    const span = Math.abs(envelope.openDb - envelope.speechDb);
    const maxStep = (span * (1 / 120)) / envelope.attackSec + 0.05;
    let previous = duckDbAt(envelope, 0);
    for (let frame = 1; frame < 8 * 120; frame += 1) {
      const next = duckDbAt(envelope, frame / 120);
      expect(Math.abs(next - previous)).toBeLessThanOrEqual(maxStep);
      previous = next;
    }
  });

  it('keeps a gap under 600 ms at speech level and a longer pause at the pause level', () => {
    const envelope = buildDuckEnvelope({words, durationSec: 8, preset: 'talking', voLufs: -20, bedLufs: -16});
    // 0.45 s between 3.0 and 3.45 (above the 350 ms merge, below 600 ms): still under speech.
    expect(duckDbAt(envelope, 3.3)).toBe(envelope.speechDb);
    expect(duckDbAt(envelope, 5)).toBe(envelope.pauseDb);
    expect(duckDbAt(envelope, 0.1)).toBe(envelope.openDb);
  });

  it('defaults to talking, and honours default and legacy_brief', () => {
    expect(resolveDuckPreset({})).toBe('talking');
    expect(resolveDuckPreset({MUSIC_DUCK_PRESET: 'default'})).toBe('default');
    expect(resolveDuckPreset({MUSIC_DUCK_PRESET: 'legacy_brief'})).toBe('legacy_brief');
    expect(resolveDuckPreset({MUSIC_DUCK_PRESET: 'nope'})).toBe('talking');
  });

  it('reports the voice-to-bed gap from measured and applied numbers', () => {
    const duck = buildDuckEnvelope({words, durationSec: 8, preset: 'talking', voLufs: -22, bedLufs: -16});
    const audio = {sfx: [], musicSource: 'generated' as const, voLufs: -22, duck};
    expect(mixCheckFor(audio)).toMatchObject({speechGapLu: 18, pauseGapLu: 9});
    expect(mixCheckFor({sfx: [], musicSource: 'licensed'})).toBeNull();
  });
});

describe('toAudioDesign', () => {
  const duck = buildDuckEnvelope({words: [{start: 0, end: 1}], durationSec: 4, preset: 'default'});

  it('keeps the legacy gains for a licensed bed and the envelope for a generated one', () => {
    const licensed = toAudioDesign({
      existing: {sfx: [], hits: [{at: 1, kind: 'pop'}]},
      resolved: {url: 'https://licensed.example/a.mp3', source: 'licensed'},
      duck,
    });
    expect(licensed.musicGain).toBe(0.18);
    expect(licensed.duckedGain).toBe(0.04);
    expect(licensed.duck).toBeUndefined();
    expect(licensed.hits).toEqual([{at: 1, kind: 'pop'}]);

    const generated = toAudioDesign({
      existing: {sfx: []},
      resolved: {url: 'https://cdn.example/bed.wav', source: 'generated', bpm: 96},
      duck,
    });
    expect(generated.musicSource).toBe('generated');
    expect(generated.musicBpm).toBe(96);
    expect(generated.duck?.speechDb).toBe(-13);
    expect(generated.musicGain).toBeUndefined();
  });
});

describe('music schema contract', () => {
  it('parses the Python plan fixture', () => {
    const file = path.resolve(__dirname, '../../../../agents/music_specialist/tests/fixtures/music_schema.json');
    const parsed = musicResultSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    expect(parsed.cache_key.length).toBeGreaterThan(16);
    expect(parsed.seed).toBe(1);
  });
});

describe('old blueprint audio', () => {
  it('still ducks with the legacy square gate', () => {
    const old = {
      musicUrl: 'https://example.com/bed.mp3',
      musicGain: 0.18,
      duckedGain: 0.04,
      ducking: true,
      sfx: [],
    };
    const parsed = timelineBlueprintSchema.shape.audioDesign.unwrap().parse(old);
    expect(parsed.musicGain).toBe(0.18);
    expect(parsed.duck).toBeUndefined();
    const speech = [{start: 1, end: 2}];
    expect(musicBedVolumeAt({frame: 45, fps: 30, speechWindows: speech, ducking: true, musicGain: 0.18, duckedGain: 0.04})).toBe(0.04);
    expect(JSON.stringify(parsed)).toBe(JSON.stringify({...old, hits: []}));
  });
});

describe('logMixCheck', () => {
  it('logs music.mix_check once and never throws', async () => {
    const {logMixCheck} = await import('./mixCheck.ts');
    const info = vi.fn();
    logMixCheck({info}, {blueprintId: 'bp', audioDesign: undefined});
    expect(info).not.toHaveBeenCalled();
    expect(() => logMixCheck({info: () => { throw new Error('x'); }}, {audioDesign: {sfx: [], musicSource: 'licensed'}})).not.toThrow();
  });
});
