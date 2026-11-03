/**
 * WP4I pure tests: on blueprints with legibility.captions a centered utility-template caption is capped so its line ends at or before the platform button rail. remotion/src/lib/captionRail.ts
 * is pure (no import). DynamicCaptionRenderer.tsx and ShortVideo.tsx (Remotion) and server/src/lib/editConflicts.ts (rail constant) are read as text. No render, no Chromium.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {CAPTION_RAIL_MAX_WIDTH_FRAC, CAPTION_RAIL_X, captionMaxWidthFrac, captionMaxWidthPercent} from '../../../remotion/src/lib/captionRail.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (...parts: string[]) => readFileSync(resolve(ROOT, ...parts), 'utf8');
const stripComments = (source: string) => source.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

describe('the rail', () => {
  it('is the conflict validator\'s PLATFORM_RAIL.x (no second rail)', () => {
    const match = read('server/src/lib/editConflicts.ts').match(/const PLATFORM_RAIL: NormRect = \{x: ([0-9.]+),/);
    expect(match).not.toBeNull();
    expect(CAPTION_RAIL_X).toBe(Number(match![1]));
  });
  it('the cap is 2 * (railX - 0.5), so a centered line ends at the rail', () => {
    expect(CAPTION_RAIL_MAX_WIDTH_FRAC).toBeCloseTo(2 * (CAPTION_RAIL_X - 0.5), 10);
    expect(CAPTION_RAIL_MAX_WIDTH_FRAC).toBe(0.72);
    expect(0.5 + CAPTION_RAIL_MAX_WIDTH_FRAC / 2).toBeLessThanOrEqual(CAPTION_RAIL_X + 1e-9);
  });
});

describe('captionMaxWidthFrac', () => {
  it('0.88 and 0.86 become the cap when legibility is on', () => {
    expect(captionMaxWidthFrac(0.88, true)).toBe(0.72);
    expect(captionMaxWidthFrac(0.86, true)).toBe(0.72);
  });
  it('0.48 stays 0.48 (at or under the cap stays as it is, including exactly the cap)', () => {
    expect(captionMaxWidthFrac(0.48, true)).toBe(0.48);
    expect(captionMaxWidthFrac(0.72, true)).toBe(0.72);
    expect(captionMaxWidthFrac(0.1, true)).toBe(0.1);
  });
  it('with legibility off the original comes back for every value', () => {
    for (const frac of [0.88, 0.86, 0.72, 0.48, 1]) expect(captionMaxWidthFrac(frac, false)).toBe(frac);
  });
  it('a centered line at the capped width ends at or before the rail; an uncapped 0.88 would not', () => {
    for (const frac of [0.86, 0.88, 1]) expect(0.5 + captionMaxWidthFrac(frac, true) / 2).toBeLessThanOrEqual(CAPTION_RAIL_X + 1e-9);
    expect(0.5 + 0.88 / 2).toBeGreaterThan(CAPTION_RAIL_X);
  });
});

describe('captionMaxWidthPercent', () => {
  it('keeps today\'s strings when off, and is capped when on', () => {
    expect(captionMaxWidthPercent(0.88, false)).toBe('88%');
    expect(captionMaxWidthPercent(0.88, true)).toBe('72%');
    expect(captionMaxWidthPercent(0.48, true)).toBe('48%');
  });
});

describe('every changed width in DynamicCaptionRenderer (source text)', () => {
  const renderer = stripComments(read('remotion/src/captions/DynamicCaptionRenderer.tsx'));
  const video = stripComments(read('remotion/src/ShortVideo.tsx'));
  const body = (name: string, next: string) => renderer.slice(renderer.indexOf(`function ${name}(`), renderer.indexOf(`function ${next}(`));
  it('seven widths go through the helpers, each in its own template, with the context flag read in that component', () => {
    const cases: Array<[string, string, string]> = [
      ['SlamWord', 'MovingPillCaptions', 'maxWidth: captionMaxWidthPercent(0.88, railClear),'],
      ['MovingPillCaptions', 'SimpleOneWordCaptions', 'maxWidth: width * captionMaxWidthFrac(0.86, railClear),'],
      ['CenteredWord', 'Kinetic01Captions', 'maxWidth: captionMaxWidthPercent(0.88, railClear),'],
      ['Kinetic01Captions', 'AaritCaptions', 'width: width * captionMaxWidthFrac(0.86, railClear),'],
      ['SoftAiCaptions', 'WeightShiftCaptions', 'maxWidth: width * captionMaxWidthFrac(0.86, railClear),'],
      ['WeightShiftCaptions', 'EditorialEmphasisCaptions', 'maxWidth: width * captionMaxWidthFrac(0.88, railClear),'],
    ];
    for (const [name, next, line] of cases) {
      const text = body(name, next);
      expect(text, name).toContain(line);
      expect(text, name).toContain('const railClear = useContext(CaptionRailClearContext);');
    }
    const editorial = renderer.slice(renderer.indexOf('function EditorialEmphasisCaptions('));
    expect(editorial).toContain('maxWidth: width * captionMaxWidthFrac(0.86, railClear),');
    expect(editorial).toContain('const railClear = useContext(CaptionRailClearContext);');
  });
  it('no unconditional centered width is left: every 0.86 / 0.88 width is behind the helper (the only other 0.86 is a scale)', () => {
    const bare = renderer.match(/width \* 0\.8[68]|'88%'/g) ?? [];
    expect(bare).toEqual([]);
    expect([...renderer.matchAll(/captionMaxWidthFrac\(0\.86, railClear\)/g)]).toHaveLength(4);
    expect([...renderer.matchAll(/captionMaxWidthFrac\(0\.88, railClear\)/g)]).toHaveLength(1);
    expect([...renderer.matchAll(/captionMaxWidthPercent\(0\.88, railClear\)/g)]).toHaveLength(2);
    expect(renderer).toContain('transform: `scale(${0.86 + 0.14 * enter})`');
  });
  it('the flag comes from a context provided by the exported renderer from its railClear prop, default false', () => {
    expect(renderer).toContain('const CaptionRailClearContext = createContext(false);');
    expect(renderer).toContain('<CaptionRailClearContext.Provider value={props.railClear ?? false}>');
    expect(renderer).toContain('railClear?: boolean;');
  });
  it('ShortVideo passes it only from legibility.captions', () => {
    expect(video).toContain('railClear={Boolean(legibleCaptions)}');
    expect(video).toContain('const legibleCaptions = blueprint.legibility?.captions;');
    expect(video.match(/railClear=/g)).toHaveLength(1);
  });
  it('captions are not moved vertically, the plate width and the hook size are untouched', () => {
    expect(renderer).toContain('...dockStyle(position, height, 0.16),');
    expect(renderer).toContain('...dockStyle(position, height, 0.18),');
    expect(video).toContain('left: 0,\n            right: 0,\n            top: (splitCaptions?.plate ?? backingPlate)!.top,');
    expect(video).toContain('fit={blueprint.legibility?.hook}');
  });
  it('the defaults are untouched', () => {
    const env = stripComments(read('server/src/config/env.ts'));
    expect(env).toMatch(/PRODUCT_EDIT_PROFILE:[^\n]*cuts/);
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED:\s*bool\(false\)/);
  });
});
