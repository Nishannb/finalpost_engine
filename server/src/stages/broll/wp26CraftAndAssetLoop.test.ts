/**
 * WP26: smash-zoom footage punch, tighter logo cloud, multi-quantity labeled-asset ask + editReadiness. Offline: no render, no network.
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {NO_PUNCH, SMASH_PUNCH_PEAK, smashPunchAt, smashPunchForClips} from '../../../../remotion/src/lib/smashPunch.ts';
import {applyLabeledAssetBindings, buildLabeledAssetBrief, computeEditReadiness, type LabeledAssetBrief} from './labeledAssetBrief.ts';
import {CLOUD_POP_SEC, planLabeledAssetPlacements, type ResolvedLabeledAsset} from './labeledAssetPlacement.ts';
import {planMetromediaOpenProof, type OpenProofFixture} from './metromediaOpenProof.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('WP26 A) smash zoom punches the footage', () => {
  it('frame math: 1 at both ends, peak ~1.16 mid-window (early), blur at the peak, monotone up then down', () => {
    const n = 14;
    const punches = Array.from({length: n}, (_, f) => smashPunchAt(f, n));
    expect(punches[0]!.scale).toBe(1);
    expect(punches[n - 1]!.scale).toBe(1);
    const peak = Math.max(...punches.map(p => p.scale));
    expect(peak).toBeCloseTo(SMASH_PUNCH_PEAK, 2);
    const at = punches.findIndex(p => p.scale === peak);
    expect(at).toBeGreaterThanOrEqual(3);
    expect(at).toBeLessThanOrEqual(7);
    expect(punches[at]!.blurPx).toBeGreaterThan(0);
    for (let i = 1; i <= at; i += 1) expect(punches[i]!.scale).toBeGreaterThanOrEqual(punches[i - 1]!.scale);
    for (let i = at + 1; i < n; i += 1) expect(punches[i]!.scale).toBeLessThanOrEqual(punches[i - 1]!.scale);
    expect(smashPunchAt(-1, n)).toEqual(NO_PUNCH);
  });
  it('only a smash-zoom transition punches, at its own window; whip / dip / hard cut do not', () => {
    const clip = (at: number, keyword: string) => ({at, duration: 0.5, keyword, assetUrl: '', renderGenerated: true});
    const clips = [clip(1, 'whip blur right'), clip(2, 'smash zoom'), clip(3, 'dip color'), clip(4, 'hard cut')];
    const fps = 30;
    expect(smashPunchForClips(clips, 30 + 7, fps, 300)).toEqual(NO_PUNCH);
    expect(smashPunchForClips(clips, 90 + 7, fps, 300)).toEqual(NO_PUNCH);
    const mid = smashPunchForClips(clips, 57 + 6, fps, 300); // window starts 0.175 s before `at` = frame 55
    expect(mid.scale).toBeGreaterThan(1.1);
    expect(smashPunchForClips(clips, 200, fps, 300)).toEqual(NO_PUNCH);
  });
  it('ShortVideo wraps the footage stack in SmashPunch, gated like TransitionTrack', () => {
    const sv = strip(read('../../../../remotion/src/ShortVideo.tsx'));
    expect(sv).toMatch(/<SmashPunch clips=\{blueprint\.transitions\} enabled=\{style\.brollEnabled\}>/);
    expect(sv.indexOf('<SmashPunch')).toBeLessThan(sv.indexOf('<ZoomFrame triggers'));
  });
});

describe('WP26 B) logo cloud pop', () => {
  it('~1.5 s in the planner and in the composition', () => {
    expect(CLOUD_POP_SEC).toBe(1.5);
    expect(strip(read('../../../../remotion/src/motion/compositions/ImageRun.tsx'))).toMatch(/IMAGE_RUN_CLOUD_POP_SEC = 1\.5/);
  });
});

const words = (text: string, start = 0) => text.split(' ').map((t, i) => ({text: t, start: start + i * 0.3, end: start + i * 0.3 + 0.27}));
const GOOGLE = [...words('Google launched a new search tool today and everyone noticed it right away.', 0), ...words('Then Google changed everything about how people find answers online.', 5)];

describe('WP26 C) multi-quantity ask', () => {
  const brief = buildLabeledAssetBrief({words: GOOGLE, outputDurationSec: 20});
  const logos = brief.slots.filter(slot => slot.kind === 'logo');
  it('a strong brand asks for a GROUP of 3 sibling logo slots with shared group metadata, required, logo_cloud intent', () => {
    expect(logos.length).toBeGreaterThanOrEqual(3);
    const group = logos.filter(slot => slot.groupId === 'logo_google');
    expect(group).toHaveLength(3);
    for (const slot of group) {
      expect(slot.quantity).toBe(3);
      expect(slot.required).toBe(true);
      expect(slot.motionIntent).toBe('logo_cloud');
      expect(slot.reason).toMatch(/3 logo variants/);
      expect(slot.status).toBe('needed');
    }
    expect(group.map(slot => slot.role)).toEqual(['hero', 'cloud', 'cloud']);
    expect(new Set(group.map(slot => slot.id)).size).toBe(3);
    expect(new Set(group.map(slot => slot.label)).size).toBe(3);
  });
  it('slot cap is 12; optional singles (weak brands, people, broll) are not required', () => {
    expect(buildLabeledAssetBrief({words: GOOGLE, outputDurationSec: 20}).slots.length).toBeLessThanOrEqual(12);
    const optional = brief.slots.filter(slot => slot.groupId === undefined);
    for (const slot of optional) expect(slot.required === true).toBe(false);
  });
  it('a one-off capitalised name that is not a known brand stays one optional logo slot', () => {
    const single = buildLabeledAssetBrief({words: words('We shipped Zorblat to customers last quarter and they loved it a lot.'), outputDurationSec: 20});
    const zorb = single.slots.filter(slot => /zorblat/i.test(slot.label) && slot.kind === 'logo');
    expect(zorb).toHaveLength(1);
    expect(zorb[0]!.groupId).toBeUndefined();
    expect(zorb[0]!.required).toBe(false);
  });
  it('pronouns like They are never required logo groups (WP28 false-positive fix)', () => {
    const brief = buildLabeledAssetBrief({
      words: [
        ...words('They launched TikTok today and everyone noticed it right away.', 0),
        ...words('Then They changed everything about how people find answers online.', 5),
      ],
      outputDurationSec: 20,
    });
    expect(brief.slots.filter(slot => /\bthey\b/i.test(slot.label))).toHaveLength(0);
    expect(brief.slots.some(slot => slot.groupId === 'logo_tiktok' && slot.required)).toBe(true);
  });
});

describe('WP26 C) editReadiness', () => {
  const brief = buildLabeledAssetBrief({words: GOOGLE, outputDurationSec: 20});
  const group = brief.slots.filter(slot => slot.groupId === 'logo_google');
  it('awaiting_assets while required slots are needed; lists them for the checklist', () => {
    const ready = computeEditReadiness(brief);
    expect(ready.status).toBe('awaiting_assets');
    expect(ready.requiredRemaining.map(item => item.id)).toEqual(group.map(slot => slot.id));
    expect(ready.requiredRemaining[0]!.quantity).toBe(3);
    expect(ready.neededCount).toBe(brief.slots.length);
  });
  it('per-slot bindings of all three, then ready', () => {
    const bound = applyLabeledAssetBindings(brief, group.map((slot, i) => ({slotId: slot.id, status: 'uploaded' as const, userAssetId: `ub_${i + 1}`})));
    const readiness = computeEditReadiness(bound);
    expect(readiness.status).toBe('ready');
    expect(readiness.uploadedCount).toBe(3);
    expect(readiness.requiredRemaining).toEqual([]);
  });
  it('one group binding with three URLs fills the siblings in order; one group skip answers the ask', () => {
    const urls = ['https://cdn.example.com/g1.png', 'https://cdn.example.com/g2.png', 'https://cdn.example.com/g3.png'];
    const idByUrl = new Map(urls.map((url, i) => [url, `ub_${i + 1}`]));
    const bound = applyLabeledAssetBindings(brief, [{slotId: 'logo_google', groupId: 'logo_google', status: 'uploaded', assetUrls: urls}], idByUrl);
    expect(bound.slots.filter(slot => slot.groupId === 'logo_google').map(slot => slot.userAssetId)).toEqual(['ub_1', 'ub_2', 'ub_3']);
    expect(computeEditReadiness(bound).status).toBe('ready');
    const skipped = applyLabeledAssetBindings(brief, [{slotId: 'logo_google', groupId: 'logo_google', status: 'skipped'}]);
    expect(computeEditReadiness(skipped).status).toBe('ready');
    expect(computeEditReadiness(skipped).skippedCount).toBe(3);
  });
  it('a partial upload stays awaiting; optional slots never block; no brief is ready', () => {
    const partial = applyLabeledAssetBindings(brief, [{slotId: group[0]!.id, status: 'uploaded', userAssetId: 'ub_1'}]);
    expect(computeEditReadiness(partial).status).toBe('awaiting_assets');
    expect(computeEditReadiness(partial).requiredRemaining).toHaveLength(2);
    expect(computeEditReadiness(undefined).status).toBe('ready');
    expect(computeEditReadiness({version: 1, outputDurationSec: 10, slots: []}).status).toBe('ready');
  });
  it('the analyze blueprint and the bind route carry editReadiness; the bind route and applyLabeledAssetBindings stay', () => {
    expect(strip(read('../../pipeline/analyzeVideo.ts'))).toMatch(/editReadiness: computeEditReadiness\(assetBrief\)/);
    const route = strip(read('../../http/routes/analyzeRoutes.ts'));
    expect(route).toMatch(/editReadiness: computeEditReadiness\(assetBrief\)/);
    expect(route).toMatch(/labeled-assets/);
    expect(strip(read('../../http/schemas.ts'))).toMatch(/groupId: z\.string\(\)/);
  });
});

describe('WP26 D) placement uses the group', () => {
  const brief = buildLabeledAssetBrief({words: GOOGLE, outputDurationSec: 20});
  const group = brief.slots.filter(slot => slot.groupId === 'logo_google');
  const assets = new Map<string, ResolvedLabeledAsset>([1, 2, 3].map(i => [`ub_${i}`, {url: `https://cdn.example.com/g${i}.png`, mediaKind: 'image' as const}]));
  const bound: LabeledAssetBrief = applyLabeledAssetBindings(brief, group.map((slot, i) => ({slotId: slot.id, status: 'uploaded' as const, userAssetId: `ub_${i + 1}`})));
  it('three uploaded siblings become ONE logo_cloud run with 3 items, hero first, one slideshow stand-in', () => {
    const out = planLabeledAssetPlacements({brief: bound, assets, outputDurationSec: 20});
    expect(out.runs).toHaveLength(1);
    expect(out.runs[0]!.mode).toBe('logo_cloud');
    expect(out.runs[0]!.items.map(item => item.src)).toEqual(['https://cdn.example.com/g1.png', 'https://cdn.example.com/g2.png', 'https://cdn.example.com/g3.png']);
    expect(out.runs[0]!.items[0]!.recipeId).toBe('logo_slam');
    expect(out.runs[0]!.items[1]!.recipeId).toBeUndefined();
    expect(out.overlays.filter(o => o.slides && o.slides.length === 3)).toHaveLength(1);
    expect(out.placed).toBe(3);
  });
  it('two of three uploaded still make a cloud; one alone is a single logo pip', () => {
    const two = {...bound, slots: bound.slots.map(slot => (slot.id === group[2]!.id ? {...slot, status: 'skipped' as const, userAssetId: undefined} : slot))};
    expect(planLabeledAssetPlacements({brief: two, assets, outputDurationSec: 20}).runs[0]!.items).toHaveLength(2);
    const one = {...bound, slots: bound.slots.map(slot => (slot.id === group[0]!.id ? slot : {...slot, status: 'skipped' as const, userAssetId: undefined}))};
    const alone = planLabeledAssetPlacements({brief: one, assets, outputDurationSec: 20});
    expect(alone.runs).toHaveLength(0);
    expect(alone.overlays).toHaveLength(1);
  });
  it('the WP21 proof bar still holds on its fixture (flash, cloud, tilt card, transitions, filler, max gap)', () => {
    const fixture = JSON.parse(read('./fixtures/wp21-metromedia-open.json')) as OpenProofFixture;
    const proof = planMetromediaOpenProof(fixture);
    expect(proof.runs[0]!.mode).toBe('logo_cloud');
    expect(proof.maxGapSec).toBeLessThanOrEqual(2.5);
  });
});
