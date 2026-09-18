import {describe, expect, it} from 'vitest';

import {ensureEnglishSearchQuery, hasNonLatinScript} from './englishSearch.ts';
import {listBeatsFromTranscript} from './listBeats.ts';
import {needsRomanization} from './romanizeCaptions.ts';

describe('ensureEnglishSearchQuery', () => {
  it('strips non-latin tokens so Pexels gets English scenes', () => {
    expect(ensureEnglishSearchQuery('महिला walking airport terminal')).toBe(
      'walking airport terminal',
    );
    expect(hasNonLatinScript('नमस्ते साथीहरु')).toBe(true);
  });
});

describe('listBeatsFromTranscript', () => {
  it('extracts ordinal list items for per-item B-roll', () => {
    const beats = listBeatsFromTranscript(
      'First, pack your passport. Second, book the flight. Third, tell your friends.',
    );
    expect(beats.length).toBeGreaterThanOrEqual(3);
    expect(beats[0]?.order).toBe(1);
    expect(beats.map(beat => beat.searchKeyword).join(' ')).toMatch(/passport|flight|friends/i);
  });
});

describe('needsRomanization', () => {
  it('flags Devanagari and Hindi/Nepali detections', () => {
    expect(needsRomanization('नमस्ते', 'ne')).toBe(true);
    expect(needsRomanization('Hello friends', 'en')).toBe(false);
  });
});
