import {describe, expect, it} from 'vitest';
import {brollCoverageWindows, kineticCaptionMuteRanges, splitKineticSpecForBroll} from './brollCaptionSplit.ts';
import {buildLabeledAssetBrief, kineticBrollSlots} from '../broll/labeledAssetBrief.ts';
import {planLabeledAssetPlacements} from '../broll/labeledAssetPlacement.ts';
import type {RenderSpec} from './schema.ts';

const fps = 30;
const ev = (id: string, a: number, b: number) => ({id, inFrame: a * fps, outFrame: b * fps, fps}) as never;
const cap = (i: number, a: number, b: number) => ({wordIdx: i, text: 'w', inFrame: a * fps, outFrame: b * fps}) as never;
const spec = {fps, events: [ev('talk1', 0, 4), ev('overlap', 8, 12), ev('talk2', 14, 18)], captions: [cap(1, 5, 5.5), cap(2, 9, 9.5)]} as unknown as RenderSpec;
const overlays = [{start: 9, end: 12.5, layout: 'cutaway'}, {start: 2, end: 3, layout: 'pip'}];

describe('Kinetic vs B-roll caption ownership', () => {
  it('only full-frame layouts count as B-roll coverage', () => {
    expect(brollCoverageWindows(overlays)).toEqual([{start: 9, end: 12.5}]);
  });
  it('B-roll wins: a kinetic beat overlapping a B-roll window is dropped, talking-head beats stay', () => {
    const r = splitKineticSpecForBroll(spec, brollCoverageWindows(overlays));
    expect(r.spec.events.map(e => e.id)).toEqual(['talk1', 'talk2']);
    expect(r.spec.captions).toHaveLength(1);
    expect(r.droppedEvents).toBe(1);
    expect(r.droppedCaptions).toBe(1);
  });
  it('no windows leaves the spec untouched', () => {
    expect(splitKineticSpecForBroll(spec, []).spec).toBe(spec);
  });
  it('simple captions show ONLY inside B-roll windows (mute is the complement)', () => {
    expect(kineticCaptionMuteRanges([{start: 9, end: 12.5}], 20)).toEqual([{startSec: 0, endSec: 9}, {startSec: 12.5, endSec: 20}]);
    expect(kineticCaptionMuteRanges([], 20)).toEqual([{startSec: 0, endSec: 20}]);
  });
});

describe('Kinetic asset brief + placement', () => {
  const words = 'so we walked into the office and saw the whole team working on the new product launch after that the customers loved it and every store reported record results this quarter'
    .split(' ').map((text, i) => ({text, start: 2 + i * 0.7, end: 2.6 + i * 0.7}));
  it('asks for concrete, grounded, capped, spaced B-roll slots and no generic filler', () => {
    const brief = buildLabeledAssetBrief({words, outputDurationSec: 30, kinetic: true});
    const broll = brief.slots.filter(s => s.kind === 'broll_clip');
    expect(broll.length).toBeGreaterThan(0);
    expect(broll.length).toBeLessThanOrEqual(5);
    expect(brief.slots.some(s => s.id === 'asset_broll_1' && s.label === 'Optional B-roll clip')).toBe(false);
    for (const s of broll) {
      expect(s.accept).toEqual(['video', 'image']);
      expect(s.reason).toContain('You say');
    }
    const starts = kineticBrollSlots(words, 30).map(s => s.startSec);
    starts.slice(1).forEach((t, i) => expect(t - starts[i]!).toBeGreaterThanOrEqual(8));
  });
  it('a creator still for a broll slot is a full-frame cutaway (so its window is B-roll), a video too', () => {
    const brief = buildLabeledAssetBrief({words, outputDurationSec: 30, kinetic: true});
    const [a] = brief.slots.filter(s => s.kind === 'broll_clip');
    const bound = {...brief, slots: [{...a!, status: 'uploaded' as const, userAssetId: 'ub_1'}]};
    const place = (mediaKind: 'image' | 'video', fullFrameBrollStills?: boolean) =>
      planLabeledAssetPlacements({brief: bound, assets: new Map([['ub_1', {url: 'https://cdn/x', mediaKind}]]), outputDurationSec: 30, ...(fullFrameBrollStills ? {fullFrameBrollStills} : {})});
    expect(place('image', true).overlays[0]!.layout).toBe('cutaway');
    expect(place('video', true).overlays[0]!.layout).toBe('cutaway');
    expect(place('image').overlays[0]!.layout).toBe('pip'); // non-Kinetic behaviour unchanged
    expect(brollCoverageWindows(place('image', true).overlays)).toHaveLength(1);
  });
});
