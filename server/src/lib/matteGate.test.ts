import {describe, expect, it} from 'vitest';

import {decideMatteGate, matteConfidence, MIN_MATTE_CONFIDENCE} from './matteGate.ts';

describe('matteConfidence', () => {
  it('is the detection ratio inside the plausible area range', () => {
    expect(matteConfidence({detected_ratio: 0.95, mean_area: 0.3})).toBe(0.95);
    expect(matteConfidence({detected_ratio: 1, mean_area: 0.03})).toBe(1);
    expect(matteConfidence({detected_ratio: 1, mean_area: 0.6})).toBe(1);
  });
  it('falls toward 0 as the area nears the quality-gate limits', () => {
    expect(matteConfidence({detected_ratio: 1, mean_area: 0.015})).toBe(0);
    expect(matteConfidence({detected_ratio: 1, mean_area: 0.8})).toBe(0);
    expect(matteConfidence({detected_ratio: 1, mean_area: 0.7})).toBe(0.5);
  });
  it('clamps and feeds the gate: low confidence is refused, absent confidence is not judged', () => {
    const base = {occupancy: {source: 'vision' as const}, cutout: {available: true}};
    expect(matteConfidence({detected_ratio: 3, mean_area: 0.3})).toBe(1);
    expect(decideMatteGate({...base, confidence: MIN_MATTE_CONFIDENCE - 0.01})).toEqual({usable: false, reason: 'low_confidence'});
    expect(decideMatteGate({...base, confidence: matteConfidence({detected_ratio: 0.9, mean_area: 0.2})})).toEqual({usable: true, reason: 'ok'});
    expect(decideMatteGate(base)).toEqual({usable: true, reason: 'ok'});
  });
});
