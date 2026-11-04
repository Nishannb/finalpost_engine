import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

import {buildDuckEnvelope} from '../stages/music/duckEnvelope.ts';
import {applyCarvedOverride, applyDuckOverrides,parseCliArgs, resolveBlueprintPath, resolveVideoUrl} from './renderBlueprint.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('render-blueprint never reaches a paid path', () => {
  const source = readFileSync(path.join(here, 'renderBlueprint.ts'), 'utf8').toLowerCase();
  it.each(['analyzevideo', 'runwaretransport', '@anthropic-ai', 'groq', 'google.generative', '@google/generative-ai', 'rendermediaonlambda'])(
    'source does not mention %s',
    banned => {
      expect(source.includes(banned)).toBe(false);
    },
  );

  it('resolves a relative blueprint path under the repo root, keeps absolute paths', () => {
    expect(resolveBlueprintPath('out/fixtures/proof/blueprint.json')).toBe(path.resolve(here, '../../..', 'out/fixtures/proof/blueprint.json'));
    expect(resolveBlueprintPath('/abs/b.json')).toBe('/abs/b.json');
  });

  it('static imports are only the duck helper, types and node builtins', () => {
    const imports = [...source.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)].map(m => m[1]);
    expect(imports.filter(spec => spec!.startsWith('.'))).toEqual(['../stages/music/duckenvelope.ts', '../types/blueprint.ts']);
  });
});

describe('talking offset overrides', () => {
  const base = {words: [{start: 0, end: 1}], durationSec: 5, preset: 'talking' as const, voLufs: -20, bedLufs: -16};
  it('speechOffsetLu replaces the speech offset only', () => {
    const duck = buildDuckEnvelope({...base, speechOffsetLu: -16});
    expect(duck.speechDb).toBe(-20); // clamp((-20) + (-16) - (-16))
    expect(duck.pauseDb).toBe(-13); // default -9
    expect(duck.openDb).toBe(-8); // default -4
  });
  it('absolute presets ignore the offsets', () => {
    const duck = buildDuckEnvelope({...base, preset: 'default', speechOffsetLu: -30});
    expect(duck.speechDb).toBe(-13);
  });
  it('no offsets leaves talking unchanged', () => {
    expect(buildDuckEnvelope(base).speechDb).toBe(-22);
  });
});

describe('applyDuckOverrides', () => {
  const bp = {
    outputDurationSec: 5,
    captionWords: [{text: 'a', start: 0, end: 1, sentenceIndex: 0}],
    audioDesign: {musicSource: 'generated', musicFullUrl: 'https://x/bed.wav', voLufs: -20, sfx: []},
  } as never;
  it('rebuilds a missing duck and honours the offset', () => {
    const out = applyDuckOverrides(bp, {speechOffset: -16});
    expect(out.rebuilt).toBe(true);
    expect(out.audioDesign?.duck?.speechDb).toBe(-20);
  });
  it('leaves the blueprint alone with no flags and an existing duck', () => {
    const withDuck = {...(bp as object), audioDesign: {...(bp as {audioDesign: object}).audioDesign, duck: {preset: 'talking'}}} as never;
    expect(applyDuckOverrides(withDuck, {}).rebuilt).toBe(false);
  });
});

describe('applyCarvedOverride', () => {
  const ad = {musicSource: 'generated', musicFullUrl: 'https://x/bed.wav', musicCarvedUrl: 'https://x/carved.wav', sfx: []} as never;
  it('--carved 0 omits musicCarvedUrl; 1 and omitted keep it', () => {
    expect('musicCarvedUrl' in (applyCarvedOverride(ad, '0').audioDesign as object)).toBe(false);
    expect(applyCarvedOverride(ad, '1').audioDesign).toBe(ad);
    expect(applyCarvedOverride(ad, undefined).audioDesign).toBe(ad);
  });
});

describe('cli helpers', () => {
  it('parses flags', () => {
    const o = parseCliArgs(['f.json', '--duck-preset', 'default', '--speech-offset=-16', '--carved', '0', '--master', '1']);
    expect(o).toMatchObject({file: 'f.json', duckPreset: 'default', speechOffset: -16, carved: '0', master: '1', measure: '0'});
  });
  it('parses hold and release in ms, defaults master on, and rejects out-of-range values', () => {
    expect(parseCliArgs(['f.json'])).toMatchObject({master: '1', measure: '0'});
    expect(parseCliArgs(['f.json', '--release-ms', '300', '--hold-ms=100'])).toMatchObject({releaseMs: 300, holdMs: 100});
    expect(parseCliArgs(['f.json', '--lead-ms', '33.3']).leadMs).toBe(33.3);
    expect(() => parseCliArgs(['f.json', '--lead-ms', '500'])).toThrow(/lead-ms/);
    expect(() => parseCliArgs(['f.json', '--release-ms', '0'])).toThrow(/release-ms/);
    expect(() => parseCliArgs(['f.json', '--hold-ms', 'x'])).toThrow(/number/);
  });
  it('hold and release rebuild the duck without touching the defaults', () => {
    const bp = {audioDesign: {musicSource: 'generated', musicUrl: 'u', duck: buildDuckEnvelope({words: [{start: 1, end: 2}], durationSec: 6})}, captionWords: [{text: 'a', start: 1, end: 2}], outputDurationSec: 6} as never;
    const out = applyDuckOverrides(bp, {releaseMs: 300, holdMs: 100});
    expect(out.rebuilt).toBe(true);
    expect(out.audioDesign?.duck).toMatchObject({releaseSec: 0.3, holdSec: 0.1});
    expect(buildDuckEnvelope({words: [], durationSec: 1})).toMatchObject({releaseSec: 0.3, holdSec: 0.15, leadSec: 0.0333});
  });
  it('a rebuild keeps the timing the blueprint was saved with (an older blueprint keeps 450 ms and no look-ahead)', () => {
    const old = buildDuckEnvelope({words: [{start: 1, end: 2}], durationSec: 6, releaseSec: 0.45, leadSec: 0});
    const bp = {audioDesign: {musicSource: 'generated', musicUrl: 'u', duck: old}, captionWords: [{text: 'a', start: 1, end: 2}], outputDurationSec: 6} as never;
    expect(applyDuckOverrides(bp, {speechOffset: -16}).audioDesign?.duck).toMatchObject({releaseSec: 0.45, leadSec: 0, holdSec: 0.15});
    expect(applyDuckOverrides(bp, {speechOffset: -16, releaseMs: 300}).audioDesign?.duck).toMatchObject({releaseSec: 0.3, leadSec: 0});
    const withLead = applyDuckOverrides(bp, {leadMs: 33.3}).audioDesign?.duck;
    expect(withLead?.releaseSec).toBe(0.45);
    expect(withLead?.leadSec).toBeCloseTo(0.0333, 6);
  });
  it('fails clearly on a missing prefetch path with no source', () => {
    expect(() => resolveVideoUrl('/prefetch/job/source.mp4', null, () => false)).toThrow(/sourceVideoPath/);
    expect(resolveVideoUrl('/prefetch/job/source.mp4', '/a/b.mp4', p => p === '/a/b.mp4')).toBe('/a/b.mp4');
    expect(resolveVideoUrl('https://x/y.mp4', null, () => false)).toBe('https://x/y.mp4');
  });
});
