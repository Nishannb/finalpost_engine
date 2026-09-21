import {describe, expect, it} from 'vitest';

import {alignTimestampToSpeech, firstPhraseWindow, holdFromPhrase, needlesFrom, speechHoldWindow, speechPhraseWindow} from './speechAlign.ts';
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

  it('does not yank a mid-timeline cutaway onto an early hook word', () => {
    const words = [
      {text: '20s', start: 1.1, end: 1.4},
      {text: 'help', start: 8.0, end: 8.3},
      {text: 'women', start: 8.4, end: 8.8},
    ];
    expect(alignTimestampToSpeech(10.2, '20s', words)).toBeCloseTo(10.2, 5);
  });

  it('extracts swim stem from swimming query', () => {
    expect(needlesFrom('person swimming outdoor pool')).toContain('swim');
    expect(needlesFrom('person swimming outdoor pool')).toContain('swimming');
  });
});

describe('speechHoldWindow', () => {
  it('holds for the spoken burst, not a fixed clock', () => {
    const words = [
      {text: 'This', start: 4, end: 4.2},
      {text: 'hoodie', start: 4.3, end: 4.7},
      {text: 'sold', start: 4.8, end: 5.1},
      {text: 'out', start: 5.2, end: 5.4},
      {text: 'Yesterday', start: 8.2, end: 8.6},
    ];
    const hold = speechHoldWindow({
      words,
      atSec: 4.4,
      phrase: 'hoodie sold out',
    });
    expect(hold.start).toBeCloseTo(4, 1);
    expect(hold.end).toBeGreaterThan(5.4);
    expect(hold.end - hold.start).toBeLessThan(5);
  });

  it('sizes a phrase hold from word count when ASR is missing', () => {
    expect(holdFromPhrase('sold out', 2.2)).toBeLessThan(holdFromPhrase('this hoodie sold out yesterday', 2.2));
  });
});

describe('speechPhraseWindow', () => {
  it('holds only the spoken phrase near the director timestamp', () => {
    const words = [
      {text: 'Welcome', start: 0.2, end: 0.5},
      {text: 'back', start: 0.55, end: 0.8},
      {text: 'This', start: 4, end: 4.2},
      {text: 'hoodie', start: 4.3, end: 4.7},
      {text: 'sold', start: 4.8, end: 5.1},
      {text: 'out', start: 5.2, end: 5.4},
      {text: 'hoodie', start: 11, end: 11.4},
    ];
    const hold = speechPhraseWindow({
      words,
      atSec: 4.5,
      phrase: 'hoodie sold out',
      lingerSec: 0.4,
    });
    expect(hold.start).toBeCloseTo(4.3, 1);
    expect(hold.end).toBeGreaterThan(5.4);
    expect(hold.start).toBeGreaterThan(1);
    expect(hold.end).toBeLessThan(10);
  });
});

describe('firstPhraseWindow', () => {
  it('places intro copy on the first spoken match, not a later sentence', () => {
    const words = [
      {text: "I'm", start: 0.2, end: 0.4},
      {text: 'Gabby', start: 0.45, end: 0.8},
      {text: 'Beckford', start: 0.85, end: 1.3},
      {text: 'I', start: 4.0, end: 4.1},
      {text: 'have', start: 4.15, end: 4.35},
      {text: 'a', start: 4.4, end: 4.45},
      {text: 'community', start: 4.5, end: 4.9},
      {text: 'million', start: 5.4, end: 5.8},
    ];
    const window = firstPhraseWindow(words, "I'm Gabby Beckford", {
      start: 0,
      end: 3,
    });
    expect(window.start).toBeCloseTo(0.45, 2);
    expect(window.end).toBeLessThan(2.2);
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
