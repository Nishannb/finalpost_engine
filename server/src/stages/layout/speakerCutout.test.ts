import {describe, expect, it} from 'vitest';

import {cutoutFromSamples, describeCutoutForDirector} from './speakerCutout.ts';

describe('speakerCutout', () => {
  it('marks a plain backdrop as keyable', () => {
    const wall = {r: 0.91, g: 0.9, b: 0.88};
    const detected = cutoutFromSamples({
      corners: [wall, wall, {...wall, r: 0.89}, wall, wall],
      center: {r: 0.42, g: 0.28, b: 0.22},
    });
    expect(detected.available).toBe(true);
    expect(detected.keyColor).toMatch(/^#/);
    expect(describeCutoutForDirector(detected)).toMatch(/layout=cutout/);
  });

  it('rejects a busy patterned backdrop', () => {
    const detected = cutoutFromSamples({
      corners: [
        {r: 0.2, g: 0.8, b: 0.1},
        {r: 0.9, g: 0.2, b: 0.2},
        {r: 0.1, g: 0.1, b: 0.9},
        {r: 0.8, g: 0.8, b: 0.1},
        {r: 0.4, g: 0.1, b: 0.6},
      ],
      center: {r: 0.45, g: 0.3, b: 0.25},
    });
    expect(detected.available).toBe(false);
    expect(describeCutoutForDirector(detected)).toMatch(/not available/);
  });
});
