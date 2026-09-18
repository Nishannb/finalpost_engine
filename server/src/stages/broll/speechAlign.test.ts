import {describe, expect, it} from 'vitest';

import {alignTimestampToSpeech, needlesFrom} from './speechAlign.ts';
import {isValidRomanization} from './romanizeCaptions.ts';

describe('alignTimestampToSpeech', () => {
  it('snaps swimming B-roll to the spoken swimming word', () => {
    const words = [
      {text: 'Try', start: 8, end: 8.2},
      {text: 'gentle', start: 8.3, end: 8.7},
      {text: 'swimming', start: 12.4, end: 12.9},
      {text: 'every', start: 13, end: 13.3},
      {text: 'day', start: 13.4, end: 13.7},
    ];
    expect(
      alignTimestampToSpeech(18, 'person swimming outdoor pool', words),
    ).toBeCloseTo(12.4, 5);
  });

  it('extracts swim stem from swimming query', () => {
    expect(needlesFrom('person swimming outdoor pool')).toContain('swim');
    expect(needlesFrom('person swimming outdoor pool')).toContain('swimming');
  });
});

describe('isValidRomanization', () => {
  it('accepts transliteration and rejects English translation', () => {
    expect(isValidRomanization('नमस्ते', 'namaste')).toBe(true);
    expect(isValidRomanization('नमस्ते', 'hello')).toBe(false);
    expect(isValidRomanization('पानी', 'paani')).toBe(true);
    expect(isValidRomanization('पानी', 'water')).toBe(false);
  });
});
