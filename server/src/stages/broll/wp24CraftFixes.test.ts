/**
 * WP24: craft fixes from the WP23 still review (logo cloud legibility, smash zoom, dip color). Offline: no render, no network.
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {proceduralLayer} from '../../../../remotion/src/lib/proceduralTransition.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const FRAMES = 15;
const layers = (style: Parameters<typeof proceduralLayer>[0]) => Array.from({length: FRAMES}, (_, frame) => proceduralLayer(style, frame, FRAMES));

describe('WP24 1) logo cloud', () => {
  const comp = strip(read('../../../../remotion/src/motion/compositions/ImageRun.tsx'));
  const num = (name: string) => Number(new RegExp(`${name} = ([0-9.]+)`).exec(comp)![1]);
  it('background logos are bigger, more opaque and less blurred; the hero is smaller; the dim veil is light', () => {
    expect(num('IMAGE_RUN_CLOUD_ITEM_OPACITY')).toBeGreaterThanOrEqual(0.55);
    expect(num('IMAGE_RUN_CLOUD_ITEM_OPACITY')).toBeLessThanOrEqual(0.75);
    expect(num('IMAGE_RUN_CLOUD_BLUR_PX')).toBeGreaterThanOrEqual(4);
    expect(num('IMAGE_RUN_CLOUD_BLUR_PX')).toBeLessThanOrEqual(6);
    expect(num('IMAGE_RUN_CLOUD_HERO_WIDTH')).toBeGreaterThanOrEqual(0.7);
    expect(num('IMAGE_RUN_CLOUD_HERO_WIDTH')).toBeLessThanOrEqual(0.78);
    expect(num('IMAGE_RUN_DIM_VEIL')).toBeGreaterThanOrEqual(0.45);
    expect(num('IMAGE_RUN_DIM_VEIL')).toBeLessThanOrEqual(0.55);
    const sizes = [...comp.matchAll(/s: ([0-9.]+)\}/g)].map(match => Number(match[1]));
    expect(sizes.length).toBe(5);
    expect(Math.min(...sizes.slice(0, 4))).toBeGreaterThanOrEqual(0.42);
  });
  it('the solid ground stays opaque and the hero shrink is cloud-only', () => {
    expect(comp).toMatch(/ground === 'solid' \? '#0B0B0B'/);
    expect(comp).toMatch(/mode === 'logo_cloud' \? IMAGE_RUN_CLOUD_HERO_WIDTH : 0\.86/);
  });
});

describe('WP24 2) smash zoom', () => {
  it('clear at both ends; the blowout reaches full strength mid-window and closes in toward the centre', () => {
    const smash = layers('smash_zoom') as Array<{kind: 'smash'; blurPx: number; ringScale: number; edgeOpacity: number}>;
    expect(smash[0]!.edgeOpacity).toBe(0);
    expect(smash[FRAMES - 1]!.edgeOpacity).toBe(0);
    const peak = Math.max(...smash.map(layer => layer.edgeOpacity));
    expect(peak).toBeGreaterThanOrEqual(0.95);
    const peakIndex = smash.findIndex(layer => layer.edgeOpacity === peak);
    expect(peakIndex).toBeGreaterThanOrEqual(5);
    expect(peakIndex).toBeLessThanOrEqual(9);
    expect(smash[peakIndex]!.ringScale).toBeGreaterThan(1.4);
    expect(smash[peakIndex]!.ringScale).toBeGreaterThan(smash[2]!.ringScale);
  });
  it('blur is mild (no ghosting) and the painted layer has no scale transform and a clear centre', () => {
    const smash = layers('smash_zoom') as Array<{blurPx: number}>;
    expect(Math.max(...smash.map(layer => layer.blurPx))).toBeLessThanOrEqual(10);
    const track = strip(read('../../../../remotion/src/components/TransitionTrack.tsx'));
    const branch = track.slice(track.indexOf("layer.kind === 'smash'"), track.indexOf("layer.kind === 'dissolve'"));
    expect(branch).not.toMatch(/transform/);
    expect(branch).toMatch(/radial-gradient\(ellipse 75% 62% at 50% 50%, rgba\(255,255,255,0\) \$\{clearStop\}%/);
  });
});

describe('WP24 3) dip color', () => {
  it('peaks at 0.95, reaches it early and holds a plateau (at least a third of the window above 0.9), clear at both ends', () => {
    const dip = layers('dip_color') as Array<{kind: 'flash'; opacity: number}>;
    expect(dip[0]!.opacity).toBe(0);
    expect(dip[FRAMES - 1]!.opacity).toBe(0);
    expect(Math.max(...dip.map(layer => layer.opacity))).toBeCloseTo(0.95, 5);
    expect(dip.filter(layer => layer.opacity >= 0.9).length).toBeGreaterThanOrEqual(5);
    expect(dip[7]!.opacity).toBeGreaterThanOrEqual(0.9);
  });
  it('flash white / black are unchanged (a 0.95 tent: sharp peak, no plateau)', () => {
    const white = layers('flash_white') as Array<{opacity: number}>;
    expect(Math.max(...white.map(layer => layer.opacity))).toBeGreaterThan(0.85);
    expect(white.filter(layer => layer.opacity >= 0.9).length).toBeLessThan(5);
  });
});
