/** 2026-11-27: a dark accent over a dark jacket under a bright wall was unreadable; the frame MEAN said "light plate". Colours must read on the plate's dark areas. */
import {describe, expect, it} from 'vitest';

import {contrastRatio} from '../../../lib/contrast.ts';
import {DEFAULT_VOICE, accentOffPlateHue, plateDarkLuminance, readableVoice} from './voice.ts';

/** 16x16 grid: top 60% a bright warm wall, bottom 40% a near-black jacket */
function wallAndJacket(): Uint8Array {
  const g = new Uint8Array(768);
  for (let i = 0; i < 256; i += 1) {
    const jacket = i >= 16 * 10;
    g.set(jacket ? [22, 22, 26] : [235, 215, 150], i * 3);
  }
  return g;
}

describe('readable Kinetic colours', () => {
  it('the dark luminance sees the jacket even though the mean is bright', () => {
    const dark = plateDarkLuminance(wallAndJacket())!;
    expect(dark).toBeLessThan(0.02);
    expect(plateDarkLuminance(undefined)).toBeUndefined();
  });

  it('a dark-text preset and a dark-red second accent are lifted until they read on the jacket (hue kept)', () => {
    const dark = plateDarkLuminance(wallAndJacket())!;
    const notes: string[] = [];
    const v = readableVoice({...DEFAULT_VOICE, text: '#111111', accent: '#FFD400', accent2: '#D62828'}, dark, notes);
    const bg = '#161616';
    expect(contrastRatio(v.text, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(v.accent2, bg)).toBeGreaterThanOrEqual(3);
    expect(v.accent).toBe('#FFD400'); // already readable: untouched
    expect(notes.some(n => n.startsWith('colour:text:'))).toBe(true);
  });

  it('a bright plate everywhere leaves a dark-text preset alone; no grid = unchanged', () => {
    const bright = new Uint8Array(768).fill(240);
    const v0 = {...DEFAULT_VOICE, text: '#111111'};
    expect(readableVoice(v0, plateDarkLuminance(bright))).toEqual(v0);
    expect(readableVoice(v0, undefined)).toEqual(v0);
  });

  it('a yellow accent on a warm yellow wall swaps with a second accent that stands out', () => {
    const v = accentOffPlateHue({...DEFAULT_VOICE, accent: '#FFD400', accent2: '#3DE8FF'}, '#D8B860');
    expect(v.accent).toBe('#3DE8FF');
    // a grey plate has no hue: unchanged
    expect(accentOffPlateHue({...DEFAULT_VOICE, accent: '#FFD400', accent2: '#3DE8FF'}, '#808080').accent).toBe('#FFD400');
  });
});
