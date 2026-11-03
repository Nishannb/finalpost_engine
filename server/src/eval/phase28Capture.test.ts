/**
 * Phase 28 (opt-in: PHASE28_OUT=<dir>): writes the serialised output of every stage the provenance work touches, for a before/after
 * comparison. The scenarios import nothing about provenance, so this file runs unchanged on the pre-change code and on the post-change code;
 * the two output directories must be byte-identical. Offline: stock search and the Director are stubbed, no network.
 */
import {createHash} from 'node:crypto';
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

import {describe, expect, it, vi} from 'vitest';

import type {VisualDirection} from '../stages/broll/geminiDirector.ts';
import {fallbackDirection, parsedFixtureDirections, PROFILE_RESPONSE, PROFILE_RESPONSE_BAD_MOOD, runV1, runV2, V2_CASES, type Deps} from './phase28Scenarios.ts';
import {parseContentProfile} from '../stages/contentProfile/contentProfile.ts';
import {designFromProfile} from '../stages/contentProfile/artDirection.ts';

const hoisted = vi.hoisted(() => ({direction: null as unknown}));
vi.mock('../stages/broll/geminiDirector.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../stages/broll/geminiDirector.ts')>();
  return {...actual, directorConfigured: () => true, planVisualDirection: async () => hoisted.direction as VisualDirection};
});
let nextId = 1;
vi.mock('../stages/broll/stockSearch.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../stages/broll/stockSearch.ts')>();
  const asset = () => ({assetUrl: `https://stock.invalid/${nextId}.mp4`, provider: 'pexels' as const, providerId: nextId++, width: 1080, height: 1920, durationSec: 12, credit: 'x', creditUrl: ''});
  return {...actual, stockConfigured: () => true, findBRollAsset: async () => asset(), findPhotoAsset: async () => asset(), listBRollAssets: async () => [asset(), asset(), asset()]};
});
const {planBRoll} = await import('../stages/broll/brollPlanner.ts');

const OUT = process.env.PHASE28_OUT;
const deps: Deps = {planBRoll: planBRoll as never, setDirection: direction => { hoisted.direction = direction; }};

const finalView = (f: {design: unknown; caption: unknown; motionGraphics: unknown; semanticEmphasis: unknown; frameInsets: unknown; mediaContainers: unknown; decisions: unknown}) => ({design: f.design, caption: f.caption, motionGraphics: f.motionGraphics, semanticEmphasis: f.semanticEmphasis, frameInsets: f.frameInsets, mediaContainers: f.mediaContainers, decisions: f.decisions});

describe.skipIf(!OUT)('phase 28 capture (opt-in)', () => {
  it('writes the stage outputs', async () => {
    const files: Record<string, unknown> = {};
    files['v1-fixture-directions'] = parsedFixtureDirections().map(({id, direction}) => ({id, direction}));
    files['v1-fallback-direction'] = fallbackDirection();
    const v1 = await runV1(deps, PROFILE_RESPONSE);
    files['v1-direction'] = v1.direction;
    files['v1-planned'] = v1.planned;
    files['v1-laid-out'] = v1.laidOut;
    files['v1-finalized-no-profile'] = finalView(v1.finalizedNoProfile);
    files['v1-finalized-profile'] = finalView(v1.finalizedProfile!);
    files['profile-gemini'] = {profile: parseContentProfile(PROFILE_RESPONSE), design: designFromProfile(parseContentProfile(PROFILE_RESPONSE))};
    files['profile-bad-mood'] = {profile: parseContentProfile(PROFILE_RESPONSE_BAD_MOOD), design: designFromProfile(parseContentProfile(PROFILE_RESPONSE_BAD_MOOD))};
    for (const testCase of V2_CASES) {
      const v2 = await runV2(deps, testCase);
      files[`v2-${testCase.label.replace(/\s+/g, '-')}`] = {direction: v2.direction, planned: {motionGraphics: v2.planned.motionGraphics, mediaContainers: v2.planned.mediaContainers, frameInsets: v2.planned.frameInsets, semanticEmphasis: v2.planned.semanticEmphasis}, finalizedNoProfile: finalView(v2.finalizedNoProfile), finalizedProfile: finalView(v2.finalizedProfile)};
    }
    mkdirSync(OUT!, {recursive: true});
    const index: Record<string, string> = {};
    for (const [name, value] of Object.entries(files)) {
      const text = JSON.stringify(value, null, 1);
      writeFileSync(join(OUT!, `${name}.json`), text);
      index[name] = createHash('sha256').update(text).digest('hex');
    }
    writeFileSync(join(OUT!, 'INDEX.json'), JSON.stringify(index, null, 1));
    expect(Object.keys(index).length).toBeGreaterThan(15);
  }, 120_000);
});
