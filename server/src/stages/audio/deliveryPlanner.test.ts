import {describe, expect, it} from 'vitest';

import {planDeliveryShaping} from './deliveryPlanner.ts';

describe('delivery planner', () => {
  it('uses rules and acoustic monotony to shape a key statistic', async () => {
    const words = [
      {text: 'First,', start: 0, end: 0.3},
      {text: 'revenue', start: 0.4, end: 0.8},
      {text: 'grew', start: 0.9, end: 1.2},
      {text: '40%.', start: 1.3, end: 1.7},
      {text: 'That', start: 1.8, end: 2.1},
      {text: 'changes', start: 2.2, end: 2.6},
      {text: 'everything.', start: 2.7, end: 3.2},
    ];
    const result = await planDeliveryShaping({
      words,
      sentences: [
        {start: 0, end: 1.7},
        {start: 1.8, end: 3.2},
      ],
      acoustic: [
        {
          sentenceIndex: 0,
          start: 0,
          end: 1.7,
          pitchMeanHz: 130,
          pitchVariance: 20,
          energyMeanDb: -24,
          energyVariance: 0.5,
          wordsPerSec: 2.35,
          monotonyScore: 0.91,
          naturalPauseAfterMs: 100,
        },
        {
          sentenceIndex: 1,
          start: 1.8,
          end: 3.2,
          pitchMeanHz: 132,
          pitchVariance: 25,
          energyMeanDb: -24,
          energyVariance: 0.8,
          wordsPerSec: 2.1,
          monotonyScore: 0.88,
          naturalPauseAfterMs: 0,
        },
      ],
      sourceDurationSec: 3.2,
      useLlmEmphasis: false,
    });
    expect(result.intensity).toBe('energetic');
    expect(result.ops.some(op => op.op === 'speed_ramp')).toBe(true);
    expect(result.ops.some(op => op.op === 'gain_automation')).toBe(true);
    expect(result.ops.some(op => op.op === 'dynamics_chain')).toBe(true);
    expect(result.ops.every(op => op.reason.length > 0)).toBe(true);
  });
});
