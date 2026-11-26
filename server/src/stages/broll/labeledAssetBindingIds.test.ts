/**
 * 2026-11-26 production bug: the app binds uploads with its own ids (`ub_slot_<slotId>`) plus the URL; the engine numbers the described uploads
 * ub_1, ub_2, ... and placement looks assets up by those. The client id used to win, so every bound upload was placed nowhere (`asset_brief:bound:2`,
 * render `overlays:0`). The engine's URL -> id map must win.
 */
import {describe, expect, it} from 'vitest';

import {applyLabeledAssetBindings, type LabeledAssetBrief} from './labeledAssetBrief.ts';
import {planLabeledAssetPlacements} from './labeledAssetPlacement.ts';

const brief: LabeledAssetBrief = {
  version: 1,
  outputDurationSec: 28,
  slots: [
    {id: 'asset_ai_1', label: 'MrBeast portrait or channel profile', kind: 'person', reason: 'r', startSec: 6.48, endSec: 8.68, accept: ['image'], spokenHint: 'MrBeast', status: 'needed', required: false, opportunityId: 'opp_1'},
    {id: 'asset_ai_2', label: 'YouTube analytics retention graph dashboard', kind: 'screenshot', reason: 'r', startSec: 16.7, endSec: 20.2, accept: ['image', 'video'], spokenHint: 'retention', status: 'needed', required: false, opportunityId: 'opp_2'},
  ],
};
const URL_A = 'https://media.example/ai-video/source/2026-11-25/a.jpg';
const URL_B = 'https://media.example/ai-video/source/2026-11-25/b.png';
// exactly what the app sends (src/lib/labeledAssetGate.ts buildGateResult)
const bindings = [
  {slotId: 'asset_ai_1', status: 'uploaded' as const, userAssetId: 'ub_slot_asset_ai_1', assetUrl: URL_A, kind: 'person' as const, label: brief.slots[0]!.label},
  {slotId: 'asset_ai_2', status: 'uploaded' as const, userAssetId: 'ub_slot_asset_ai_2', assetUrl: URL_B, kind: 'screenshot' as const, label: brief.slots[1]!.label},
];
const idByUrl = new Map([[URL_A, 'ub_1'], [URL_B, 'ub_2']]);

describe('labeled asset bindings use the engine asset ids', () => {
  it('a bound upload takes the id the engine gave its URL, so placement resolves it', () => {
    const bound = applyLabeledAssetBindings(brief, bindings, idByUrl);
    expect(bound.slots.map(s => [s.status, s.userAssetId])).toEqual([['uploaded', 'ub_1'], ['uploaded', 'ub_2']]);
    const assets = new Map([['ub_1', {url: URL_A, mediaKind: 'image' as const}], ['ub_2', {url: URL_B, mediaKind: 'image' as const}]]);
    const placement = planLabeledAssetPlacements({brief: bound, assets, outputDurationSec: 28, fullFrameBrollStills: true});
    expect(placement.unresolved).toBe(0);
    expect(placement.placed).toBe(2);
    expect(placement.overlays.length + placement.runs.length).toBeGreaterThan(0);
  });

  it('an upload the engine could not read keeps the client id and is reported unresolved (never silently "placed")', () => {
    const bound = applyLabeledAssetBindings(brief, bindings, new Map([[URL_B, 'ub_2']]));
    expect(bound.slots[0]!.userAssetId).toBe('ub_slot_asset_ai_1');
    const placement = planLabeledAssetPlacements({brief: bound, assets: new Map([['ub_2', {url: URL_B, mediaKind: 'image' as const}]]), outputDurationSec: 28, fullFrameBrollStills: true});
    expect(placement.unresolved).toBe(1);
    expect(placement.placed).toBe(1);
  });
});

import {mergeSpans, useEachUserAssetOnce} from './userAssetOnce.ts';

describe('Kinetic creator photos and asset reuse (2026-11-26)', () => {
  const bound = applyLabeledAssetBindings(brief, bindings, idByUrl);
  const assets = new Map([['ub_1', {url: URL_A, mediaKind: 'image' as const}], ['ub_2', {url: URL_B, mediaKind: 'image' as const}]]);

  it('in Kinetic every photo is a whole (uncropped) full-frame backdrop, never a square card over the face', () => {
    const placement = planLabeledAssetPlacements({brief: bound, assets, outputDurationSec: 28, fullFrameBrollStills: true});
    expect(placement.runs).toHaveLength(0); // no slideshow / image run that would crop it into a card
    expect(placement.overlays.map(o => [o.layout, o.backdrop])).toEqual([['cutaway', true], ['cutaway', true]]);
  });

  it('outside Kinetic the old card placement is unchanged', () => {
    const placement = planLabeledAssetPlacements({brief: bound, assets, outputDurationSec: 28});
    expect(placement.overlays.every(o => !o.backdrop && o.layout !== 'cutaway')).toBe(true);
  });

  it('an upload placed twice keeps only its first placement; slideshow slides count', () => {
    const clip = (start: number, url: string, provider = 'user') => ({start, provider, assetUrl: url});
    const out = useEachUserAssetOnce([clip(10, URL_A)], [clip(2, URL_A), clip(5, URL_B), {...clip(12, 'https://x/c.jpg'), slides: [{assetUrl: URL_B}]}, clip(14, URL_A, 'pexels')]);
    expect(out.removed).toBe(2);
    expect(out.overlays.map(o => o.start)).toEqual([2, 5, 14]);
    expect(out.clips).toHaveLength(0);
  });

  it('matte spans merge', () => {
    expect(mergeSpans([{start: 4, end: 6}, {start: 1, end: 2}, {start: 5.5, end: 8}])).toEqual([{start: 1, end: 2}, {start: 4, end: 8}]);
  });
});
