import {describe, expect, it} from 'vitest';

import {
  isValidRomanization,
  needsHinglishRecovery,
  needsRomanization,
} from './romanizeCaptions.ts';

describe('romanizeCaptions', () => {
  it('flags Devanagari and Indic language codes for romanization', () => {
    expect(needsRomanization('नमस्ते दोस्तों', 'en', 'en')).toBe(true);
    expect(needsRomanization('hello friends', 'hindi', 'auto')).toBe(true);
    expect(needsRomanization('hello friends', 'en', 'hi')).toBe(true);
    expect(needsRomanization('hello friends', 'en', 'en')).toBe(false);
  });

  it('recovers Hinglish when Indic speech was ASR-translated to English', () => {
    expect(
      needsHinglishRecovery({
        transcript: 'Hello friends today we will talk',
        detectedLanguage: 'hi',
        languageCode: 'auto',
      }),
    ).toBe(true);
    expect(
      needsHinglishRecovery({
        transcript: 'Hello friends',
        detectedLanguage: 'en',
        languageCode: 'en',
      }),
    ).toBe(false);
  });

  it('rejects English glosses for native-script tokens', () => {
    expect(isValidRomanization('नमस्ते', 'namaste')).toBe(true);
    expect(isValidRomanization('नमस्ते', 'hello')).toBe(false);
    expect(isValidRomanization('दोस्तों', 'friends')).toBe(false);
    expect(isValidRomanization('दोस्तों', 'doston')).toBe(true);
  });
});
