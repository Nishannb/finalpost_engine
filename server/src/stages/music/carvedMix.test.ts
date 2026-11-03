import {describe, expect, it} from 'vitest';
import {carvedGains, carvedMix} from './carvedMix.ts';

describe('carvedMix', () => {
  it('is 1 under speech and 0 in the open', () => {
    expect(carvedMix(-13, -13, -4)).toBeCloseTo(1, 5);
    expect(carvedMix(-4, -13, -4)).toBeCloseTo(0, 5);
  });
  it('is 0 at the pause level when a pause level is given', () => {
    expect(carvedMix(-7, -13, -4, -7)).toBeCloseTo(0, 5);
    expect(carvedMix(-4, -13, -4, -7)).toBe(0);
  });
  it('ramps monotonically through attack and release', () => {
    const mid = carvedMix(-10, -13, -4);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(carvedMix(-11, -13, -4)).toBeGreaterThan(mid);
  });
  it('clamps and survives a degenerate envelope', () => {
    expect(carvedMix(-30, -13, -4)).toBe(1);
    expect(carvedMix(0, -13, -4)).toBe(0);
    expect(carvedMix(-12, -12, -12)).toBe(1);
  });
  it('equal-power gains', () => {
    const g = carvedGains(0.5);
    expect(g.full ** 2 + g.carved ** 2).toBeCloseTo(1, 5);
    expect(carvedGains(0)).toEqual({full: 1, carved: 0});
  });
});
