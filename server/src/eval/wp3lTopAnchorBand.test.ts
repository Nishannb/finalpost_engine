/**
 * WP3L pure tests: for an unmeasured face (mvp) the anchor `top` is given one meaning (the top safe band, no side) and converted to a top corner, chosen without the default box, before
 * the validator and the renderer see it. Import graph: stages/layout/unmeasuredSlots.ts (-> lib/provenance.ts -> types/blueprint.ts constants; a type-only import of occupancy.ts) and,
 * for a parity check, stages/broll/legibility.ts. The renderer files, occupancy.ts, slotCompositor.ts, editConflicts.ts and analyzeVideo.ts import React/Remotion or the logger and are
 * read as text. No logger, `.env`, SDK, FFmpeg, Chromium or network; no Gemini call.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {PROVENANCE} from '../types/blueprint.ts';
import {provenanceOf, stampProvenance} from '../lib/provenance.ts';
import {HOOK} from '../stages/broll/legibility.ts';
import {resolveTopAnchors, topBandSides, UNMEASURED_TOP_BAND, UNMEASURED_TOP_INSET} from '../stages/layout/unmeasuredSlots.ts';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REMOTION = resolve(SRC, '..', '..', 'remotion', 'src');
const read = (...parts: string[]) => readFileSync(resolve(SRC, ...parts), 'utf8');
const readRemotion = (...parts: string[]) => readFileSync(resolve(REMOTION, ...parts), 'utf8');
const LEDGER = Symbol.for('ledgerId-like'); // an own enumerable symbol key, like the planner's LEDGER_ID

describe('why `top` needs one meaning (the components disagree; source text)', () => {
  it('graphics draw it left, emphasis right, stack/bubble overlays left; the validator rects say left (graphics, slot rect) and right (emphasis)', () => {
    expect(readRemotion('components', 'MotionGraphicTrack.tsx')).toContain("case 'top':\n      return {...base, top: height * 0.08, left: pad, maxWidth: width * 0.42, alignItems: 'flex-start'};");
    expect(readRemotion('components', 'SemanticEmphasisTrack.tsx')).toContain("if (anchor === 'top_right' || anchor === 'top') {");
    expect(readRemotion('components', 'VisualOverlayTrack.tsx')).toContain("const leftSide = overlay.anchor.includes('left') || overlay.anchor === 'top';");
    const conflicts = read('lib', 'editConflicts.ts');
    expect(conflicts).toContain('const x = anchor.endsWith(\'right\') ? 1 - pad - w : pad;'); // kinetic text: `top` is left
    expect(conflicts).toContain('const x = anchor.endsWith(\'left\') ? pad : 1 - pad - w;'); // emphasis: `top` is right
  });
  it('no component draws a centred top placement, so the conversion goes to a corner every component already draws', () => {
    expect(readRemotion('components', 'MotionGraphicTrack.tsx')).toContain("case 'top_left':");
    expect(readRemotion('components', 'MotionGraphicTrack.tsx')).toContain("case 'top_right':");
  });
});

describe('the meaning of `top`: the top safe band, full width, no side', () => {
  it('it starts at the 0.06 inset the mvp hook uses, spans the safe frame, and ends where the hook band ends', () => {
    expect(UNMEASURED_TOP_BAND.y).toBe(UNMEASURED_TOP_INSET);
    expect(UNMEASURED_TOP_INSET).toBe(HOOK.topFrac);
    expect(UNMEASURED_TOP_BAND.x).toBe(0.03);
    expect(UNMEASURED_TOP_BAND.w).toBe(0.94);
    expect(UNMEASURED_TOP_BAND.y + UNMEASURED_TOP_BAND.h).toBeCloseTo(HOOK.defaultClearBottomFrac, 12);
  });
  it('both corners it is converted to start inside that band (rects read from slotRectForAnchor in occupancy.ts)', () => {
    const occupancy = read('stages', 'layout', 'occupancy.ts');
    const body = occupancy.slice(occupancy.indexOf('export function slotRectForAnchor'));
    const left = /top_left' \|\| anchor === 'top'\) \{\s*return \{x: ([\d.]+), y: ([\d.]+), w: ([\d.]+), h: ([\d.]+)\}/.exec(body)!;
    const right = /anchor === 'top_right'\) \{\s*return \{x: ([\d.]+), y: ([\d.]+), w: ([\d.]+), h: ([\d.]+)\}/.exec(body)!;
    for (const m of [left, right]) {
      const [x, y, w] = [Number(m[1]), Number(m[2]), Number(m[3])];
      expect(x).toBeGreaterThanOrEqual(UNMEASURED_TOP_BAND.x);
      expect(x + w).toBeLessThanOrEqual(UNMEASURED_TOP_BAND.x + UNMEASURED_TOP_BAND.w + 1e-9);
      expect(y).toBeGreaterThanOrEqual(UNMEASURED_TOP_INSET);
    }
    expect(Number(left[1]) + Number(left[3])).toBeLessThanOrEqual(0.4); // left column
    expect(Number(right[1])).toBeGreaterThan(0.5); // right column
  });
});

describe('topBandSides', () => {
  const at = (start: number, end: number, anchor?: string) => ({start, end, anchor});
  it('is null for anything that is not `top`, and empty for nothing', () => {
    expect(topBandSides([])).toEqual([]);
    expect(topBandSides([at(0, 1, 'top_left'), at(0, 1, 'center'), at(0, 1, 'bottom'), at(0, 1, undefined), at(0, 1, 'top_right')])).toEqual([null, null, null, null, null]);
  });
  it('takes no speaker box: its only input is the timed elements', () => {
    expect(topBandSides.length).toBe(1);
  });
  it('two `top` elements at the same time get different sides; neither side is favoured over a run', () => {
    expect(topBandSides([at(1, 3, 'top'), at(1, 3, 'top')])).toEqual(['top_left', 'top_right']);
    const run = topBandSides([at(0, 1, 'top'), at(2, 3, 'top'), at(4, 5, 'top'), at(6, 7, 'top')]);
    expect(run).toEqual(['top_left', 'top_right', 'top_left', 'top_right']);
  });
  it('a `top` element goes to the side no other top-corner element occupies at that time', () => {
    expect(topBandSides([at(0, 5, 'top_left'), at(1, 2, 'top')])).toEqual([null, 'top_right']);
    expect(topBandSides([at(0, 5, 'top_right'), at(1, 2, 'top')])).toEqual([null, 'top_left']);
    expect(topBandSides([at(0, 5, 'top_left'), at(8, 9, 'top')])[1]).toBe('top_left'); // not at the same time: free
  });
  it('is processed in time order, whatever the array order, and is deterministic', () => {
    const items = [at(5, 6, 'top'), at(1, 2, 'top'), at(3, 4, 'top')];
    expect(topBandSides(items)).toEqual(topBandSides(items));
    // time order is 1-2 (index 1), 3-4 (index 2), 5-6 (index 0): left, right, left, reported by array index
    expect(topBandSides(items)).toEqual(['top_left', 'top_left', 'top_right']);
  });
  it('when both sides are busy it still returns a side (never undefined)', () => {
    const sides = topBandSides([at(0, 9, 'top_left'), at(0, 9, 'top_right'), at(1, 2, 'top')]);
    expect(['top_left', 'top_right']).toContain(sides[2]);
  });
});

describe('resolveTopAnchors', () => {
  const graphic = (start: number, anchor: string) => stampProvenance({start, end: start + 2, text: 'T', anchor, role: 'primary', [LEDGER]: `g${start}`} as never, {anchor: 'director'});
  const emphasis = (start: number, anchor?: string) => ({start, end: start + 2, text: 'E', ...(anchor ? {anchor} : {})});
  const overlay = (start: number, layout: string, anchor: string) => ({start, end: start + 2, layout, anchor, assetUrl: ''});

  it('converts top graphics, emphasis and anchored overlays to corners, never leaving `top`', () => {
    const r = resolveTopAnchors({motionGraphics: [graphic(0, 'top')], semanticEmphasis: [emphasis(0, 'top')], overlays: [overlay(0, 'lockup', 'top'), overlay(10, 'card', 'top'), overlay(20, 'bubble', 'top'), overlay(30, 'chip', 'top')]});
    expect(r.converted).toBe(6);
    for (const item of [...r.motionGraphics, ...r.semanticEmphasis, ...r.overlays]) expect(['top_left', 'top_right']).toContain(item.anchor);
    expect(r.motionGraphics[0]!.anchor).toBe('top_left');
    expect(r.semanticEmphasis[0]!.anchor).toBe('top_right'); // same time as the graphic: the other side
  });
  it('leaves everything else as the same objects: other anchors, full-frame overlay layouts, and elements with no anchor', () => {
    const g = graphic(0, 'center');
    const e = emphasis(0);
    const cut = overlay(0, 'cutaway', 'top');
    const split = overlay(0, 'split', 'top');
    const corner = overlay(0, 'card', 'top_right');
    const r = resolveTopAnchors({motionGraphics: [g], semanticEmphasis: [e], overlays: [cut, split, corner]});
    expect(r.converted).toBe(0);
    expect(r.motionGraphics[0]).toBe(g);
    expect(r.semanticEmphasis[0]).toBe(e);
    expect(r.overlays).toEqual([cut, split, corner]);
    r.overlays.forEach((item, i) => expect(item).toBe([cut, split, corner][i]));
  });
  it('a rebuilt element differs only in its anchor, and keeps its provenance and its ledger identity', () => {
    const g = graphic(1, 'top');
    const r = resolveTopAnchors({motionGraphics: [g], semanticEmphasis: [], overlays: []});
    const out = r.motionGraphics[0] as unknown as Record<string | symbol, unknown>;
    expect(out).not.toBe(g);
    expect(out.anchor).toBe('top_left');
    expect(out[LEDGER]).toBe('g1');
    expect(provenanceOf(out as object, 'anchor')).toBe('director');
    const strip = (v: object) => ({...v, anchor: undefined});
    expect(strip(out as object)).toEqual(strip(g as object));
    expect(Object.getOwnPropertySymbols(out)).toContain(PROVENANCE);
  });
  it('is idempotent', () => {
    const first = resolveTopAnchors({motionGraphics: [graphic(0, 'top'), graphic(1, 'top')], semanticEmphasis: [emphasis(0, 'top')], overlays: []});
    const second = resolveTopAnchors(first);
    expect(second.converted).toBe(0);
  });
  it('graphics, emphasis and overlays share the two sides: three `top` elements at once never put all on one side', () => {
    const r = resolveTopAnchors({motionGraphics: [graphic(0, 'top')], semanticEmphasis: [emphasis(0, 'top')], overlays: [overlay(0, 'lockup', 'top')]});
    const sides = [r.motionGraphics[0]!.anchor, r.semanticEmphasis[0]!.anchor, r.overlays[0]!.anchor];
    expect(new Set(sides).size).toBe(2);
  });
});

describe('scope: unmeasured only; measured and legacy untouched; shared helpers unchanged (source text)', () => {
  it('analyzeVideo calls it only for a marked occupancy, after the critique and before the ledger notes the anchors and before the validator', () => {
    const av = read('pipeline', 'analyzeVideo.ts');
    const call = av.indexOf('const topBand = resolveTopAnchors({');
    expect(call).toBeGreaterThan(av.indexOf('broll.semanticEmphasis = patched.plan.semanticEmphasis;'));
    expect(call).toBeLessThan(av.indexOf("recordAnchorChanges(ledger, 'kinetic_text'"));
    expect(call).toBeLessThan(av.indexOf('const finalized = finalizeEdits({'));
    expect(av.slice(av.lastIndexOf('if (occupancy.unmeasuredSlots) {', call), call)).not.toContain('}\n      }\n      if');
    expect(av.match(/resolveTopAnchors\(/g)).toHaveLength(2); // WP3M added the second call, after the motion stage (see wp3mTopAnchorAfterMotion.test.ts)
    expect(av).toContain('warnings.push(`top_anchor_converted:${topBand.converted}`);');
  });
  it('slotRectForAnchor, oppositeVisual, the renderer and the validator are unchanged and do not know the conversion', () => {
    expect(read('stages', 'layout', 'occupancy.ts')).toContain("if (anchor === 'top_left' || anchor === 'top') {\n    return {x: 0.03, y: 0.07, w: 0.3, h: 0.18};");
    expect(read('stages', 'layout', 'slotCompositor.ts')).toContain("return anchor === 'top' ? 'top_right' : 'bottom_right';");
    for (const file of ['MotionGraphicTrack.tsx', 'SemanticEmphasisTrack.tsx', 'VisualOverlayTrack.tsx']) expect(readRemotion('components', file), file).not.toMatch(/resolveTopAnchors|unmeasured|topBand/i);
    expect(read('lib', 'editConflicts.ts')).not.toMatch(/resolveTopAnchors|unmeasuredSlots|topBandSides/);
  });
  it('the defaults are unchanged', () => {
    const env = read('config', 'env.ts');
    expect(env).toContain("PRODUCT_EDIT_PROFILE: str('cuts')");
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED: bool\(false\)/);
  });
});
