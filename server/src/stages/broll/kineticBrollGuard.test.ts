import {describe, expect, it} from 'vitest';

import {CAPTION_NO_BOX, KINETIC_SPLIT_FRAMED_CAPTION_BAND, kineticSplitCaptionLayout} from '../../../../remotion/src/lib/captionSplit.ts';
import {KINETIC_SPLIT_HEAD_TARGET_FRAC, isKineticSplitOverlay, kineticSplitSpeakerPosition} from '../../../../remotion/src/lib/splitMotion.ts';
import type {VisualOverlay} from '../../types/blueprint.ts';
import {assetOrientation, guardKineticBroll, headTopForWindow, sampleHeadTop} from './kineticBrollGuard.ts';

const overlay = (o: Partial<VisualOverlay>): VisualOverlay =>
  ({start: 2, end: 5, layout: 'split', mediaKind: 'image', anchor: 'top', keyword: 'x', overlayText: '', assetUrl: 'https://cdn/x.png', provider: 'user', providerId: 0, width: 1600, height: 900, credit: '', creditUrl: '', accentColor: '#FFF', textStyle: 'chip', treatment: 'float', ...o}) as VisualOverlay;

/** a 4 x 8 grid whose person starts at row `top` */
const grid = (top: number) => {
  const bits = new Uint8Array(4 * 8);
  for (let r = top; r < 8; r += 1) for (let c = 1; c < 3; c += 1) bits[r * 4 + c] = 255;
  return Buffer.from(bits).toString('base64');
};

describe('2026-11-28 Kinetic B-roll guard (owner: landscape = split, portrait = full frame, never blurred, head framed)', () => {
  it('reads orientation', () => {
    expect(assetOrientation(1600, 900)).toBe('landscape');
    expect(assetOrientation(3024, 4032)).toBe('portrait'); // an iPhone 3:4 photo: was split before (threshold 1.6)
    expect(assetOrientation(1080, 1350)).toBe('portrait'); // 4:5
    expect(assetOrientation(1080, 1080)).toBe('square');
    expect(assetOrientation(undefined, 900)).toBe('unknown');
  });

  it('a portrait asset placed as a split becomes a full-frame cutaway', () => {
    const {overlays, warnings} = guardKineticBroll([overlay({width: 1170, height: 1560, fitWidth: true, speakerSide: 'bottom'})], {kind: 'none'});
    expect(overlays[0]).toMatchObject({layout: 'cutaway', kineticMotion: true});
    expect(overlays[0]!.fitWidth).toBeUndefined();
    expect(overlays[0]!.speakerSide).toBeUndefined();
    expect(warnings).toContain('kinetic_broll:portrait_full_frame:1');
  });

  it('a landscape asset is a split, drawn once (kineticMotion), no blurred backdrop', () => {
    const {overlays} = guardKineticBroll([overlay({layout: 'cutaway', backdrop: true})], {kind: 'none'});
    expect(overlays[0]).toMatchObject({layout: 'split', speakerSide: 'bottom', fitWidth: true, kineticMotion: true});
    expect(overlays[0]!.backdrop).toBeUndefined();
    expect(isKineticSplitOverlay(overlays[0]!)).toBe(true);
  });

  it('frames the split by the measured speaker box', () => {
    const {overlays, warnings} = guardKineticBroll([overlay({})], {kind: 'box', headTopFrac: 0.33});
    expect(overlays[0]!.speakerHeadTopFrac).toBe(0.33);
    expect(warnings).toContain('kinetic_broll:split_head_framed:1:box');
  });

  it('frames the split by the RVM matte inside the window (the highest head position)', () => {
    const g = {cols: 4, rows: 8, samples: [{frame: 30, bits: grid(4)}, {frame: 90, bits: grid(3)}, {frame: 300, bits: grid(1)}]};
    expect(sampleHeadTop(Buffer.from(grid(3), 'base64'), 4, 8)).toBe(3 / 8);
    // window 0.5-3.5 s at 30 fps: frames 30 and 90 -> rows 4 and 3 -> 3/8; frame 300 (10 s) is outside
    expect(headTopForWindow({kind: 'matte', grid: g, fps: 30}, 0.5, 3.5)).toBe(0.375);
  });

  it('leaves pips / cards alone and an unknown head unframed', () => {
    const pip = overlay({layout: 'pip'});
    const {overlays, warnings} = guardKineticBroll([pip, overlay({})], {kind: 'none'});
    expect(overlays[0]).toBe(pip);
    expect(overlays[1]!.speakerHeadTopFrac).toBeUndefined();
    expect(warnings).toContain('kinetic_broll:split_head_unknown:1');
  });
});

describe('2026-11-28 renderer: head-framed split', () => {
  const H = 1920;
  const placeHead = (head: number) => {
    const p = Number(kineticSplitSpeakerPosition(head, H).split(' ')[1]!.replace('%', '')) / 100;
    const feather = Math.max(40, H * 0.075);
    const bottomTop = H * 0.5 - feather * 0.55;
    const offset = p * (H - (H - bottomTop));
    return (bottomTop - offset + head * H) / H; // where the head top lands in the frame
  };

  it('puts the head top just under the caption band (the chin is no longer cut)', () => {
    expect(placeHead(0.33)).toBeCloseTo(KINETIC_SPLIT_HEAD_TARGET_FRAC, 3);
    expect(placeHead(0.4)).toBeCloseTo(KINETIC_SPLIT_HEAD_TARGET_FRAC, 3);
    // the old fixed 18% put a head at 0.33 at ~0.70 of the frame: the chin fell off the bottom
    expect(KINETIC_SPLIT_HEAD_TARGET_FRAC).toBeLessThan(0.66);
  });

  it('clamps to the footage', () => {
    expect(kineticSplitSpeakerPosition(0, H)).toBe('50% 0%');
    expect(kineticSplitSpeakerPosition(0.9, H)).toBe('50% 100%');
  });

  it('the caption band sits between the seam and the framed head', () => {
    const l = kineticSplitCaptionLayout({position: 'bottom' as const, bottomFrac: 0.18, frameTopFrac: 0, frameHeightFrac: 1}, 'bottom', true);
    expect(l.frameTopFrac).toBe(KINETIC_SPLIT_FRAMED_CAPTION_BAND.top);
    expect(l.frameTopFrac + l.frameHeightFrac).toBeLessThanOrEqual(KINETIC_SPLIT_HEAD_TARGET_FRAC);
    expect(CAPTION_NO_BOX).toBe('none');
  });

  it('an 11-26 fitWidth split counts as Kinetic (no blur, no plate)', () => {
    expect(isKineticSplitOverlay({fitWidth: true})).toBe(true);
    expect(isKineticSplitOverlay({})).toBe(false);
  });
});
