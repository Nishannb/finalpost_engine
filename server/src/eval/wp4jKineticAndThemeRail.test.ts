/**
 * WP4J pure tests: kinetic-template captions (centered on captionCenterXFrac) and the package-theme wrapper end at or before the platform button rail when the rail flag is on.
 * remotion/src/lib/captionRail.ts is pure (no import); KineticCaptions.tsx and DynamicCaptionRenderer.tsx (Remotion) are read as text. No render, no Chromium.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {CAPTION_RAIL_MAX_WIDTH_FRAC, CAPTION_RAIL_X, captionMaxWidthPercent, captionRailWidthFrac} from '../../../remotion/src/lib/captionRail.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (...parts: string[]) => readFileSync(resolve(ROOT, ...parts), 'utf8');
const stripComments = (source: string) => source.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

describe('captionRailWidthFrac (center-aware)', () => {
  it('at center 0.5 it is the existing cap', () => {
    expect(captionRailWidthFrac(0.9, 0.5, true)).toBe(CAPTION_RAIL_MAX_WIDTH_FRAC);
    expect(captionRailWidthFrac(0.86, 0.5, true)).toBe(0.72);
  });
  it('a center left of 0.5 widens the allowance; the right edge ends at the rail', () => {
    const width = captionRailWidthFrac(0.9, 0.45, true);
    expect(width).toBeCloseTo(2 * (CAPTION_RAIL_X - 0.45), 6);
    expect(0.45 + width / 2).toBeLessThanOrEqual(CAPTION_RAIL_X + 1e-9);
  });
  it('a center right of 0.5 narrows it', () => {
    const width = captionRailWidthFrac(0.9, 0.55, true);
    expect(width).toBeCloseTo(0.62, 6);
    expect(0.55 + width / 2).toBeLessThanOrEqual(CAPTION_RAIL_X + 1e-9);
  });
  it('never exceeds the template\'s own fraction', () => {
    expect(captionRailWidthFrac(0.5, 0.5, true)).toBe(0.5);
    expect(captionRailWidthFrac(0.6, 0.4, true)).toBe(0.6); // allowance 0.92 > 0.6
    expect(captionRailWidthFrac(0.72, 0.5, true)).toBe(0.72);
  });
  it('a non-positive allowance keeps the template fraction (no zero-width line)', () => {
    for (const center of [0.86, 0.9, 1, 1.5]) expect(captionRailWidthFrac(0.8, center, true), String(center)).toBe(0.8);
  });
  it('a non-finite center keeps the template fraction', () => {
    for (const center of [NaN, Infinity, -Infinity]) expect(captionRailWidthFrac(0.8, center, true)).toBe(0.8);
  });
  it('flag off returns the template fraction for every center', () => {
    for (const center of [0.3, 0.5, 0.55, 0.9]) expect(captionRailWidthFrac(0.88, center, false)).toBe(0.88);
  });
  it('whenever it narrows, the block ends at or before the rail', () => {
    for (let center = 0.3; center < 0.86; center += 0.01) {
      const width = captionRailWidthFrac(0.95, center, true);
      expect(center + width / 2).toBeLessThanOrEqual(CAPTION_RAIL_X + 1e-6);
      expect(width).toBeGreaterThan(0);
    }
  });
});

describe('the package-theme wrapper width', () => {
  it('is 100% with the flag off and the existing cap with it on', () => {
    expect(captionMaxWidthPercent(1, false)).toBe('100%');
    expect(captionMaxWidthPercent(1, true)).toBe('72%');
  });
});

describe('wiring (source text)', () => {
  const kinetic = stripComments(read('remotion/src/components/KineticCaptions.tsx'));
  const renderer = stripComments(read('remotion/src/captions/DynamicCaptionRenderer.tsx'));
  const video = stripComments(read('remotion/src/ShortVideo.tsx'));
  it('KineticCaptions computes one rail-aware width from the template fraction and captionCenterXFrac, and uses it in both width places', () => {
    expect(kinetic).toContain('const railWidthFrac = captionRailWidthFrac(template.maxWidthFrac, style.captionCenterXFrac, Boolean(railClear));');
    expect(kinetic).toContain('width: width * railWidthFrac,');
    expect(kinetic).toContain('maxWidth: width * railWidthFrac,');
    expect(kinetic).not.toContain('width * template.maxWidthFrac');
    expect(kinetic).toContain("left: `${style.captionCenterXFrac * 100}%`,");
    expect(kinetic).toContain("transform: 'translateX(-50%)'");
    expect(kinetic).toContain('railClear?: boolean;');
  });
  it('captions are not moved vertically in KineticCaptions: the bottom / top / center placement lines are as before', () => {
    expect(kinetic).toContain('bottom: height * bottomFrac,');
    expect(kinetic).toContain("? {top: '50%', transform: 'translate(-50%, -50%)'}");
    expect(kinetic).toContain('top: height * Math.min(0.22, direction?.bottomFrac ?? 0.12),');
  });
  it('the package-theme wrapper uses the helper for its width and keeps its position and transform', () => {
    expect(renderer).toContain('width: captionMaxWidthPercent(1, railClear),');
    expect(renderer).not.toContain("width: '100%',");
    expect(renderer).toContain("left: '50%',");
    expect(renderer).toContain("bottom: `${Math.round(bottomFrac * 100)}%`,");
    expect(renderer).toContain("? {top: '50%', transform: 'translate(-50%, -50%)'}");
  });
  it('the flag reaches both: the body takes railClear (default false) and passes it to KineticCaptions; ShortVideo sets it only from legibility.captions', () => {
    expect(renderer).toContain('railClear = false,\n}) => {');
    expect(renderer).toContain('<KineticCaptions\n      railClear={railClear}');
    expect(video).toContain('railClear={Boolean(legibleCaptions)}');
  });
  it('the utility-template widths from WP4I are not redone', () => {
    expect([...renderer.matchAll(/captionMaxWidthFrac\(0\.86, railClear\)/g)]).toHaveLength(4);
    expect([...renderer.matchAll(/captionMaxWidthFrac\(0\.88, railClear\)/g)]).toHaveLength(1);
    expect([...renderer.matchAll(/captionMaxWidthPercent\(0\.88, railClear\)/g)]).toHaveLength(2);
  });
  it('the backing plate and the theme library are untouched', () => {
    expect(video).toContain('(splitCaptions?.plate ?? backingPlate)');
    expect(video).toContain('left: 0,\n            right: 0,');
    expect(renderer).toContain("import {CaptionTheme} from 'remotion-captions-themes';");
  });
  it('the defaults are untouched', () => {
    const env = stripComments(read('server/src/config/env.ts'));
    expect(env).toMatch(/PRODUCT_EDIT_PROFILE:[^\n]*cuts/);
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED:\s*bool\(false\)/);
  });
});
