/** Final freeze: the app-supplied footage kind (lib/footageKind.ts). Only explicit 'camera' footage may enter Kinetic V2; nothing is inferred. */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {analyzeRequestSchema} from '../http/schemas.ts';
import {fingerprintSource} from '../store/engineStore.ts';
import {FOOTAGE_KINDS, footageFingerprintKey, footageKindSchema, kineticEngineAllowedFor, resolveFootageKind} from './footageKind.ts';

describe('footage kind contract', () => {
  it('accepted values are exactly camera / screen_recording / unknown', () => {
    expect([...FOOTAGE_KINDS]).toEqual(['camera', 'screen_recording', 'unknown']);
    for (const k of FOOTAGE_KINDS) expect(footageKindSchema.parse(k)).toBe(k);
    for (const bad of ['Camera', 'screen', 'replaykit', '', 'selfie']) expect(footageKindSchema.safeParse(bad).success).toBe(false);
  });
  it('absent / null resolve to unknown; nothing is ever inferred as camera', () => {
    expect(resolveFootageKind(undefined)).toBe('unknown');
    expect(resolveFootageKind(null)).toBe('unknown');
    expect(resolveFootageKind('screen_recording')).toBe('screen_recording');
  });
  it('only explicit camera footage may enter Kinetic V2', () => {
    expect(kineticEngineAllowedFor('camera')).toBe(true);
    expect(kineticEngineAllowedFor('screen_recording')).toBe(false);
    expect(kineticEngineAllowedFor('unknown')).toBe(false);
    expect(kineticEngineAllowedFor(undefined)).toBe(false);
  });
  it('the analyze request accepts the field, rejects other values, and leaves it absent when not sent', () => {
    const base = {videoUrl: 'https://example.com/v.mp4', languageCode: 'en'};
    expect(analyzeRequestSchema.parse(base).footageKind).toBeUndefined();
    expect(analyzeRequestSchema.parse({...base, footageKind: 'screen_recording'}).footageKind).toBe('screen_recording');
    expect(analyzeRequestSchema.safeParse({...base, footageKind: 'screen'}).success).toBe(false);
  });
  it('the edits request (POST /v1/edits) carries the same field', () => {
    const src = readFileSync(new URL('../http/routes/editRoutes.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/footageKind: footageKindSchema\.optional\(\)/);
    expect(src).toMatch(/footageKind: parsed\.data\.footageKind/);
  });
});

describe('cache key: unchanged unless the kinetic engine flag is on', () => {
  const base = {videoUrl: 'https://example.com/v.mp4', languageCode: 'en'};
  it('engine flag off: no fragment for any kind (every existing key is unchanged)', () => {
    for (const k of [undefined, ...FOOTAGE_KINDS]) expect(footageFingerprintKey({kineticEngine: false, footageKind: k})).toBeUndefined();
    expect(fingerprintSource({...base, footageKey: undefined})).toBe(fingerprintSource(base));
  });
  it('engine flag on: camera and non-camera never share a cached blueprint; absent = unknown', () => {
    const cam = fingerprintSource({...base, footageKey: footageFingerprintKey({kineticEngine: true, footageKind: 'camera'})});
    const scr = fingerprintSource({...base, footageKey: footageFingerprintKey({kineticEngine: true, footageKind: 'screen_recording'})});
    const unk = fingerprintSource({...base, footageKey: footageFingerprintKey({kineticEngine: true})});
    expect(new Set([cam, scr, unk, fingerprintSource(base)]).size).toBe(4);
    expect(footageFingerprintKey({kineticEngine: true})).toBe('footage:unknown');
  });
});
