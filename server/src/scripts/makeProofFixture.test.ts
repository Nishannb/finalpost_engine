import {describe, expect, it} from 'vitest';

import {assertWriteFlag, buildBursts, buildProofBlueprint, PROOF_BED_BASE} from './makeProofFixture.ts';

describe('makeProofFixture', () => {
  it('refuses without --write', () => {
    expect(() => assertWriteFlag([])).toThrow(/--write/);
    expect(() => assertWriteFlag(['--write'])).not.toThrow();
  });

  it('bursts are 0.8–1.4 s on with 0.6–1.0 s gaps', () => {
    const bursts = buildBursts();
    expect(bursts.length).toBeGreaterThanOrEqual(5);
    bursts.forEach((b, i) => {
      expect(b.end - b.start).toBeGreaterThanOrEqual(0.8 - 1e-6);
      expect(b.end - b.start).toBeLessThanOrEqual(1.4 + 1e-6);
      if (i > 0) expect(b.start - bursts[i - 1]!.end).toBeGreaterThanOrEqual(0.6 - 1e-6);
    });
  });

  it('builds an envelope with the salvaged bed URLs and a duck with phrases', () => {
    const env = buildProofBlueprint({sourcePath: '/tmp/source.mp4', voLufs: -20.1, savedAt: '2026-01-01T00:00:00.000Z'});
    const bp = env.blueprint;
    expect(env.videoId).toBe('proof-synth-0001');
    expect(env.sourceVideoPath).toBe('/tmp/source.mp4');
    expect(bp.videoUrl).toBe('/tmp/source.mp4');
    expect(bp.keepSegments).toHaveLength(1);
    const audio = bp.audioDesign!;
    expect(audio.musicSource).toBe('generated');
    expect(audio.musicFullUrl).toBe(`${PROOF_BED_BASE}/bed_full.wav`);
    expect(audio.musicLoopUrl).toBe(`${PROOF_BED_BASE}/bed_loop.wav`);
    expect(audio.musicCarvedUrl).toBe(`${PROOF_BED_BASE}/bed_carved.wav`);
    expect(audio.musicFullDurationSec).toBe(56.68);
    expect(audio.duck?.preset).toBe('talking');
    expect(audio.duck?.voLufs).toBe(-20.1);
    expect(audio.duck!.phrases.length).toBeGreaterThan(3);
    expect(audio.duck!.durationSec).toBe(bp.outputDurationSec);
  });
});
