import {describe, expect, it} from 'vitest';

import {
  validateDeliveryOperations,
  type DeliveryOperation,
} from './deliveryShaping.ts';

const words = Array.from({length: 40}, (_, index) => ({
  text: `w${index}`,
  start: index * 0.5,
  end: index * 0.5 + 0.3,
}));

function op(
  id: string,
  name: DeliveryOperation['op'],
  start: number,
  end: number,
  params: Record<string, unknown>,
): DeliveryOperation {
  return {id, op: name, start, end, params, reason: 'test'};
}

describe('delivery operation guardrails', () => {
  it('clamps speed, gain, pause and loudness limits', () => {
    const result = validateDeliveryOperations({
      sourceDurationSec: 20,
      words,
      ops: [
        op('speed', 'speed_ramp', 1, 3, {rate: 2, rampInMs: 2, rampOutMs: 900}),
        op('gain', 'gain_automation', 4, 5, {gainDb: 12}),
        op('pause', 'insert_pause', 6.3, 6.3, {
          position: 'after_word',
          durationMs: 900,
        }),
        op('dynamics', 'dynamics_chain', 0, 20, {
          targetLufs: -5,
          limiterDbtp: 0,
        }),
      ],
    });
    expect(result.ops.find(item => item.id === 'speed')?.params.rate).toBe(1.12);
    expect(result.ops.find(item => item.id === 'gain')?.params.gainDb).toBe(4);
    expect(result.ops.find(item => item.id === 'pause')?.params.durationMs).toBe(
      500,
    );
    const dynamics = result.ops.find(item => item.id === 'dynamics')!;
    expect(dynamics.params.targetLufs).toBe(-12);
    expect(dynamics.params.limiterDbtp).toBe(-1.2);
  });

  it('enforces pause spacing and speed share', () => {
    const result = validateDeliveryOperations({
      sourceDurationSec: 20,
      words,
      ops: [
        op('p1', 'insert_pause', 2.3, 2.3, {
          position: 'after_word',
          durationMs: 300,
        }),
        op('p2', 'insert_pause', 4.3, 4.3, {
          position: 'after_word',
          durationMs: 300,
        }),
        op('s1', 'speed_ramp', 5, 10, {rate: 1.06}),
        op('s2', 'speed_ramp', 11, 15, {rate: 1.06}),
      ],
    });
    expect(result.ops.some(item => item.id === 'p1')).toBe(true);
    expect(result.ops.some(item => item.id === 'p2')).toBe(false);
    expect(result.drops).toContain('drop:p2:delivery_pause_spacing');
    expect(result.ops.some(item => item.id === 's1')).toBe(true);
    expect(result.ops.some(item => item.id === 's2')).toBe(false);
  });

  it('rejects mid-word trims and speaker-crossing ranges', () => {
    const result = validateDeliveryOperations({
      sourceDurationSec: 20,
      words,
      speakerChanges: [8],
      ops: [
        op('trim', 'trim_silence', 1.1, 1.8, {keepMs: 150}),
        op('speed', 'speed_ramp', 7, 9, {rate: 1.06}),
      ],
    });
    expect(result.ops).toHaveLength(0);
    expect(result.drops).toContain('drop:trim:delivery_mid_word');
    expect(result.drops).toContain('drop:speed:delivery_speaker_change');
  });

  it('drops ducking when no music track exists', () => {
    const result = validateDeliveryOperations({
      sourceDurationSec: 20,
      words,
      musicPresent: false,
      ops: [op('duck', 'music_ducking', 0, 20, {duckDb: -12})],
    });
    expect(result.ops).toHaveLength(0);
    expect(result.drops).toContain('drop:duck:no_music');
  });

  it('does not stack a pause on the same instant as a speed ramp', () => {
    const result = validateDeliveryOperations({
      sourceDurationSec: 20,
      words,
      ops: [
        op('speed', 'speed_ramp', 5, 8, {rate: 0.92}),
        op('pause', 'insert_pause', 6.3, 6.3, {
          position: 'after_word',
          durationMs: 300,
        }),
      ],
    });
    expect(result.ops.some(item => item.id === 'speed')).toBe(true);
    expect(result.ops.some(item => item.id === 'pause')).toBe(false);
    expect(result.drops).toContain('drop:pause:delivery_incompatible_stack');
  });
});
