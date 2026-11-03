/**
 * WP8R: reference cutaway cadence — one library hit must not block all seeds; pills without a measured matte.
 */
import {describe, expect, it} from 'vitest';

import {assembleDirectedGraphics, type MotionDirectorResult} from './motionDirector.ts';
import {addLibrarySeeds} from './libraryFallback.ts';
import {DEFAULT_PILL_BOX, seedLibraryGraphics} from './transcriptLibrarySeed.ts';

const empty: MotionDirectorResult = {graphics: [], refusals: [], notes: '', costUsd: 0, model: 'x', latencyMs: 0, raw: null};

function timed(sentences: string[], secPer = 4) {
  const words: {text: string; start: number; end: number}[] = [];
  sentences.forEach((sentence, index) => {
    const tokens = sentence.split(/\s+/);
    const slot = (secPer - 0.4) / tokens.length;
    tokens.forEach((text, i) => {
      const start = index * secPer + i * slot;
      words.push({text, start, end: start + slot * 0.9});
    });
  });
  return {words, duration: sentences.length * secPer};
}

describe('WP8R library seed top-up', () => {
  it('one grounded library graphic still allows more seeds into empty gaps', () => {
    const clip = timed([
      'Today I have a choice between two candidates.',
      'I would hire accountants, marketers, and designers who use AI.',
      'Everybody should elevate themselves with these tools today.',
      'Curiosity is the only advantage that keeps compounding over time.',
    ]);
    const spoken = assembleDirectedGraphics(
      {
        graphics: [
          {
            id: 'spoken-head',
            anchorWordIndex: 2,
            durationSeconds: 3,
            reason: 'r',
            goal: 'g',
            visualDescription: 'big type',
            placement: 'full_screen',
            contentJson: JSON.stringify({statement: 'Today I have a choice between two candidates'}),
          },
        ],
      },
      {words: clip.words, outputDurationSec: clip.duration, occupied: [], maxGraphics: 4},
    ).graphics;
    expect(spoken).toHaveLength(1);
    const result = addLibrarySeeds(
      {...empty, graphics: spoken},
      {words: clip.words, outputDurationSec: clip.duration, occupied: [], lookId: 'explainer_cutaway'},
    );
    expect(result.director.graphics.length).toBeGreaterThan(1);
    expect(result.warnings.some(warning => warning.includes('library_seed'))).toBe(true);
  });
});

describe('WP8R TopicPills without measured speaker', () => {
  it('seeds TopicPills with DEFAULT_PILL_BOX when occupancy is unknown', () => {
    // Pad so the list sentence is not crowded out by opening/closing rules; list text matches the seed parser (short comma/and parts).
    const clip = timed([
      'Most people never learn how to use artificial intelligence properly today.',
      'We remove retakes, fillers, noise and dead air from every video.',
      'Curiosity is the only advantage that keeps compounding over time always.',
    ]);
    const seed = seedLibraryGraphics({words: clip.words, outputDurationSec: Math.max(clip.duration, 36), lookId: 'explainer_cutaway'});
    const pills = seed.raw.graphics.find(graphic => seed.compositions[graphic.id] === 'TopicPills');
    expect(pills).toBeDefined();
    expect(pills!.box).toEqual(DEFAULT_PILL_BOX);
  });
});

