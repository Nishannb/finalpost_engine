/**
 * The provided-cutout decision (subjectCutoutUrl): pure helpers, the request schema, and the cache-key guarantees.
 * No analyze run, no network, no model.
 */
import {describe, expect, it} from 'vitest';

import {analyzeRequestSchema} from '../http/schemas.ts';
import {fingerprintSource} from '../store/engineStore.ts';
import {applyProvidedCutout, normalizeProvidedCutoutUrl, providedForeground} from './providedCutout.ts';

const URL_OK = 'https://cdn.example/ai-video/matte/2026-10-31/mt_abc.webm';

describe('normalizeProvidedCutoutUrl', () => {
  it('accepts only a non-empty http(s) URL (trimmed)', () => {
    expect(normalizeProvidedCutoutUrl(URL_OK)).toBe(URL_OK);
    expect(normalizeProvidedCutoutUrl(`  ${URL_OK}  `)).toBe(URL_OK);
    expect(normalizeProvidedCutoutUrl('http://cdn.example/a.webm')).toBe('http://cdn.example/a.webm');
  });
  it('treats everything else as "not provided"', () => {
    for (const bad of [undefined, null, '', '   ', 42, {}, 'file:///etc/passwd', 'ftp://x/y.webm', 'data:video/webm;base64,AAAA', '/relative/path.webm', 'javascript:alert(1)', 'not a url', `https://x/${'a'.repeat(3000)}`]) {
      expect(normalizeProvidedCutoutUrl(bad), String(bad).slice(0, 40)).toBe('');
    }
  });
});

describe('applyProvidedCutout', () => {
  const detected = {available: false, keyColor: '#2FBF71', similarity: 0.16, blend: 0.06, speaker: {x: 0.2, y: 0.1, w: 0.6, h: 0.8}};
  it('sets available:true and the URL, keeps every other field, and does not mutate the input', () => {
    const next = applyProvidedCutout(detected, URL_OK);
    expect(next).toEqual({...detected, available: true, videoUrl: URL_OK});
    expect(detected.available).toBe(false);
    expect('videoUrl' in detected).toBe(false);
  });
  it('replaces an existing videoUrl (the provided asset wins over a keyed extract)', () => {
    expect(applyProvidedCutout({...detected, available: true, videoUrl: 'https://old/keyed.webm'}, URL_OK).videoUrl).toBe(URL_OK);
  });
});

describe('providedForeground', () => {
  it('is one span over the whole output when no foreground exists yet', () => {
    expect(providedForeground(undefined, URL_OK, 12.5)).toEqual({videoUrl: URL_OK, spans: [{start: 0, end: 12.5}]});
  });
  it('leaves an already-set foreground untouched (same object)', () => {
    const existing = {videoUrl: 'https://cdn.example/host.webm', spans: [{start: 3, end: 5}]};
    expect(providedForeground(existing, URL_OK, 12.5)).toBe(existing);
  });
  it('is undefined with no URL / no duration and nothing existing', () => {
    expect(providedForeground(undefined, '', 12.5)).toBeUndefined();
    expect(providedForeground(undefined, URL_OK, 0)).toBeUndefined();
    expect(providedForeground(undefined, URL_OK, Number.NaN)).toBeUndefined();
  });
});

describe('analyze request schema', () => {
  const base = {videoUrl: 'https://cdn.example/source.mp4', languageCode: 'en'};
  it('subjectCutoutUrl is optional: absent stays absent (today\'s behavior)', () => {
    const parsed = analyzeRequestSchema.parse(base);
    expect(parsed.subjectCutoutUrl).toBeUndefined();
  });
  it('accepts an http(s) URL and rejects file:, other schemes and junk', () => {
    expect(analyzeRequestSchema.parse({...base, subjectCutoutUrl: URL_OK}).subjectCutoutUrl).toBe(URL_OK);
    for (const bad of ['file:///tmp/a.webm', 'ftp://x/a.webm', 'nonsense', '']) {
      expect(analyzeRequestSchema.safeParse({...base, subjectCutoutUrl: bad}).success, bad).toBe(false);
    }
  });
});

describe('analyze cache key', () => {
  const key = {videoUrl: 'https://cdn.example/source.mp4', languageCode: 'en'};
  it('is UNCHANGED when no cutout is provided (existing cached blueprints stay valid)', () => {
    expect(fingerprintSource({...key, subjectCutoutKey: ''})).toBe(fingerprintSource(key));
    expect(fingerprintSource({...key, subjectCutoutKey: undefined})).toBe(fingerprintSource(key));
  });
  it('differs per provided cutout, so a blueprint built around one is never served to a request without it', () => {
    const plain = fingerprintSource(key);
    const withA = fingerprintSource({...key, subjectCutoutKey: URL_OK});
    const withB = fingerprintSource({...key, subjectCutoutKey: `${URL_OK}?v=2`});
    expect(new Set([plain, withA, withB]).size).toBe(3);
  });
});
