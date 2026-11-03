/**
 * WP4S pure tests: the opening box that is face-checked and measured is the box the renderer draws, kept inside x 0.06..0.86 and below the top 6% band. stages/openingPlan/openingBoxFit.ts has no
 * imports; resolveOpening's import graph is zod, the text-treatment schema and the contrast helpers (no logger), so it is called directly with an injected `measure`. The renderer's openingBox
 * (remotion/src/lib/openingGeometry.ts, pure) is imported for parity; OpeningTreatment and the editConflicts rail are read as text. No render, no Chromium, no network, no model call.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {openingBox} from '../../../remotion/src/lib/openingGeometry.ts';
import {drawnOpeningBox, fitOpeningBox, OPENING_RAIL_X, OPENING_SIDE_PAD, OPENING_TOP_UI, type OpeningAlign} from '../stages/openingPlan/openingBoxFit.ts';
import {resolveOpening, openingRect, type ResolveInput} from '../stages/openingPlan/openingPlan.ts';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(SRC, '..', '..');
const read = (...parts: string[]) => readFileSync(resolve(ROOT, ...parts), 'utf8');
const stripComments = (source: string) => source.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

const ALIGNS: OpeningAlign[] = ['left', 'center', 'right'];

describe('parity: the helper\'s pre-clamp box is the box openingBox draws', () => {
  it('for left, center and right at several widths, heights and centers', () => {
    for (const align of ALIGNS) {
      for (const widthFrac of [0.4, 0.55, 0.72, 0.8, 0.9, 0.96]) {
        for (const [centerY, heightFrac] of [[0.1, 0.3], [0.3, 0.18], [0.6, 0.12]] as const) {
          expect(drawnOpeningBox({centerY, widthFrac, heightFrac, align})).toEqual(openingBox({centerY, widthFrac, heightFrac, align}));
        }
      }
    }
  });
  it('and equals the server\'s own openingRect (the validator\'s box)', () => {
    for (const align of ALIGNS) expect(drawnOpeningBox({centerY: 0.3, widthFrac: 0.6, heightFrac: 0.18, align})).toEqual(openingRect({centerY: 0.3, widthFrac: 0.6, heightFrac: 0.18, align}));
  });
  it('the constants are the renderer\'s side padding and the validator\'s rail', () => {
    expect(OPENING_SIDE_PAD).toBe(0.06);
    expect(OPENING_RAIL_X).toBe(Number(read('server/src/lib/editConflicts.ts').match(/const PLATFORM_RAIL: NormRect = \{x: ([0-9.]+),/)![1]));
    expect(OPENING_TOP_UI).toBe(0.06);
  });
});

describe('fitOpeningBox', () => {
  it('a box that already fits is returned unchanged, with no correction', () => {
    for (const input of [{centerY: 0.3, widthFrac: 0.6, heightFrac: 0.18, align: 'center' as const}, {centerY: 0.3, widthFrac: 0.6, heightFrac: 0.18, align: 'left' as const}, {centerY: 0.2, widthFrac: 0.8, heightFrac: 0.2, align: 'left' as const}]) {
      const out = fitOpeningBox(input);
      expect(out).toMatchObject({...input});
      expect(out.corrections).toEqual([]);
      expect(out.box).toEqual(drawnOpeningBox(input));
    }
  });
  it('a right-aligned opening (it always ends at 0.94) keeps its width and moves to the nearest drawable position that fits', () => {
    const narrow = fitOpeningBox({centerY: 0.3, widthFrac: 0.6, heightFrac: 0.18, align: 'right'});
    expect(narrow).toMatchObject({align: 'center', widthFrac: 0.6});
    expect(narrow.box.x + narrow.box.w).toBeLessThanOrEqual(OPENING_RAIL_X + 1e-9);
    expect(narrow.corrections).toHaveLength(1);
    expect(narrow.corrections[0]).toMatch(/align right -> center/);
    const wide = fitOpeningBox({centerY: 0.3, widthFrac: 0.76, heightFrac: 0.18, align: 'right'});
    expect(wide).toMatchObject({align: 'left', widthFrac: 0.76}); // too wide to center (0.5 + 0.38 > 0.86), fits left
    expect(wide.box.x).toBe(0.06);
  });
  it('a centered opening wider than 0.72 slides left, keeping its width', () => {
    const out = fitOpeningBox({centerY: 0.3, widthFrac: 0.8, heightFrac: 0.18, align: 'center'});
    expect(out).toMatchObject({align: 'left', widthFrac: 0.8});
    expect(out.box.x + out.box.w).toBeCloseTo(OPENING_RAIL_X, 9);
  });
  it('the width is shrunk only when it cannot fit even left-aligned (> 0.80), to the widest that fits', () => {
    for (const align of ALIGNS) {
      const out = fitOpeningBox({centerY: 0.3, widthFrac: 0.96, heightFrac: 0.18, align});
      expect(out).toMatchObject({align: 'left', widthFrac: 0.8});
      expect(out.box.x).toBeGreaterThanOrEqual(0.06 - 1e-9);
      expect(out.box.x + out.box.w).toBeLessThanOrEqual(OPENING_RAIL_X + 1e-9);
      expect(out.corrections[0]).toMatch(/width 0\.96 -> 0\.80/);
    }
    expect(fitOpeningBox({centerY: 0.3, widthFrac: 0.8, heightFrac: 0.18, align: 'left'}).corrections).toEqual([]); // exactly the widest: no shrink
  });
  it('the top of a tall opening slides down to the 6% band; the height and width are kept', () => {
    const out = fitOpeningBox({centerY: 0.1, widthFrac: 0.6, heightFrac: 0.3, align: 'center'});
    expect(out.box.y).toBeCloseTo(0.06, 9);
    expect(out.centerY).toBeCloseTo(0.21, 9);
    expect(out).toMatchObject({widthFrac: 0.6, heightFrac: 0.3});
    expect(out.corrections).toHaveLength(1);
    expect(out.corrections[0]).toMatch(/center_y 0\.10 -> 0\.21/);
  });
  it('both fixes at once give two corrections and a box inside the span', () => {
    const out = fitOpeningBox({centerY: 0.08, widthFrac: 0.9, heightFrac: 0.2, align: 'right'});
    expect(out.corrections).toHaveLength(2);
    expect(out.box.x).toBeGreaterThanOrEqual(0.06 - 1e-9);
    expect(out.box.x + out.box.w).toBeLessThanOrEqual(0.86 + 1e-9);
    expect(out.box.y).toBeGreaterThanOrEqual(0.06 - 1e-9);
  });
  it('whatever the input inside the schema\'s ranges, the returned box is inside x 0.06..0.86, y >= 0.06, and equals what the renderer draws for the returned fields', () => {
    for (const align of ALIGNS) {
      for (let widthFrac = 0.4; widthFrac <= 0.96; widthFrac += 0.04) {
        for (let centerY = 0.06; centerY <= 0.7; centerY += 0.08) {
          for (const heightFrac of [0.06, 0.18, 0.4]) {
            const out = fitOpeningBox({centerY, widthFrac, heightFrac, align});
            expect(out.box.x).toBeGreaterThanOrEqual(0.06 - 1e-9);
            expect(out.box.x + out.box.w).toBeLessThanOrEqual(0.86 + 1e-9);
            expect(out.box.y).toBeGreaterThanOrEqual(0.06 - 1e-9);
            expect(openingBox({centerY: out.centerY, widthFrac: out.widthFrac, heightFrac: out.heightFrac, align: out.align})).toEqual(out.box);
            expect(out.widthFrac).toBeLessThanOrEqual(widthFrac + 1e-9);
          }
        }
      }
    }
  });
  it('a width is never shrunk when it fits somewhere', () => {
    for (const align of ALIGNS) for (const widthFrac of [0.4, 0.6, 0.72, 0.78, 0.8]) expect(fitOpeningBox({centerY: 0.3, widthFrac, heightFrac: 0.18, align}).widthFrac).toBe(widthFrac);
  });
});

// ---- resolveOpening --------------------------------------------------------------------------------------------------------------------------------------------
const TRANSCRIPT = 'Stay calm under pressure. Most managers panic when a deadline moves. Here is how to keep your head and decide fast.';
const plan = (placement: Record<string, unknown>) => ({
  central_promise: 'Stay calm under pressure', audience: 'managers', angle: 'calm beats panic',
  evidence: [{time_sec: 1, what: 'the opening line'}, {time_sec: 30, what: 'the closing advice'}],
  concept: 'calm focus', hook_wording: 'Stay calm', wording_source: 'spoken', source_frame_time_sec: 1, treatment: 'plain',
  placement, frame0: 'a calm title', animation: 'a settle', why_this_design: 'it matches the tone',
});
const colors = {identity: 'calm blue', footage_notes: '', roles: {primary_text: '#FFFFFF', secondary_text: '#CBD5E1', accent: '#38BDF8', graphic_background: '#0B1220', panel: '#0B1220', highlight: '#FACC15', data: '#38BDF8'}};
const calm = {p10: 0.02, p50: 0.04, p90: 0.07, meanRgb: {r: 15, g: 15, b: 20}, spread: 0.01};
const run = (placement: Record<string, unknown>, extra: Partial<ResolveInput> = {}) => {
  const measured: Array<{x: number; y: number; w: number; h: number}> = [];
  const promise = resolveOpening({plan: plan(placement), colorDirection: colors, transcript: TRANSCRIPT, durationSec: 40, hookDurationSec: 3, matteUsable: true, measure: async box => { measured.push(box); return calm; }, ...extra} as ResolveInput);
  return promise.then(result => ({result, measured}));
};

describe('resolveOpening uses the drawn box', () => {
  it('the footage is measured at the box the renderer draws, not a centered one', async () => {
    const {result, measured} = await run({center_y: 0.3, width_frac: 0.5, height_frac: 0.18, align: 'left'}, {speakerUnknown: true});
    expect(result.report.accepted).toBe(true);
    expect(measured.at(-1)).toEqual(openingBox({centerY: 0.3, widthFrac: 0.5, heightFrac: 0.18, align: 'left'}));
    expect(measured.at(-1)!.x).toBe(0.06); // a centered box would start at 0.25
  });
  it('a right-aligned opening is measured where it is finally drawn (moved off the rail), and the spec says so', async () => {
    const {result, measured} = await run({center_y: 0.3, width_frac: 0.5, height_frac: 0.18, align: 'right'}, {speakerUnknown: true});
    expect(result.spec).toMatchObject({align: 'center', widthFrac: 0.5, centerY: 0.3});
    expect(measured.at(-1)).toEqual(openingBox(result.spec!));
    expect(openingRect(result.spec!)).toEqual(openingBox(result.spec!));
    expect(result.report.corrections.join(' ')).toMatch(/align right -> center/);
  });
  it('the spec always draws a box inside x 0.06..0.86 and y >= 0.06', async () => {
    for (const align of ALIGNS) {
      const {result} = await run({center_y: 0.1, width_frac: 0.96, height_frac: 0.3, align}, {speakerUnknown: true});
      const box = openingBox(result.spec!);
      expect(box.x).toBeGreaterThanOrEqual(0.06 - 1e-9);
      expect(box.x + box.w).toBeLessThanOrEqual(0.86 + 1e-9);
      expect(box.y).toBeGreaterThanOrEqual(0.06 - 1e-9);
      expect(result.report.placement).toMatchObject({widthFrac: result.spec!.widthFrac, centerY: result.spec!.centerY});
    }
  });
  it('a left-aligned opening over the face is caught by the drawn box (the centered check passed it)', async () => {
    const speakerBox = {x: 0.04, y: 0.25, w: 0.3, h: 0.5}; // face x 0.10..0.28, y 0.25..0.355
    const placement = {center_y: 0.3, width_frac: 0.4, height_frac: 0.18, align: 'left'};
    // the old centered box (x 0.30..0.70) does not touch the face columns
    expect(0.3).toBeGreaterThan(0.04 + 0.3 * 0.8);
    const {result, measured} = await run(placement, {speakerBox});
    expect(result.report.accepted).toBe(true);
    expect(result.report.corrections.join(' ')).toMatch(/kept off the face|the band above the face/);
    const box = openingBox(result.spec!);
    expect(box.y + box.h).toBeLessThanOrEqual(0.25 - 0.02 + 1e-9); // above the face with the gap
    expect(box.y).toBeGreaterThanOrEqual(0.06 - 1e-9);
    expect(measured.at(-1)).toEqual(box);
  });
  it('a right-aligned opening that the rail fit moves off the face needs no face move', async () => {
    const speakerBox = {x: 0.7, y: 0.25, w: 0.28, h: 0.5}; // face x 0.756..0.924: under the right-aligned box (0.54..0.94)
    const {result} = await run({center_y: 0.3, width_frac: 0.4, height_frac: 0.18, align: 'right'}, {speakerBox});
    expect(result.report.accepted).toBe(true);
    expect(result.spec).toMatchObject({align: 'center', centerY: 0.3});
    expect(result.report.corrections.join(' ')).not.toMatch(/kept off the face/);
  });
  it('if there is no clear band above the face, the existing rejection stays: the face is never covered to satisfy the rail', async () => {
    const speakerBox = {x: 0.2, y: 0.08, w: 0.6, h: 0.8};
    const {result} = await run({center_y: 0.2, width_frac: 0.8, height_frac: 0.18, align: 'center'}, {speakerBox});
    expect(result.report.accepted).toBe(false);
    expect(result.report.rejection).toBe('no_clear_band_above_the_face');
    expect(result.spec).toBeNull();
  });
  it('the band above a face now starts at the 6% UI line (a face whose top leaves less than the minimum height above 0.08 is refused)', async () => {
    const {result} = await run({center_y: 0.3, width_frac: 0.6, height_frac: 0.18, align: 'center'}, {speakerBox: {x: 0.18, y: 0.16, w: 0.64, h: 0.62}});
    expect(result.report.accepted).toBe(false);
    expect(result.report.rejection).toBe('no_clear_band_above_the_face');
  });
  it('a face high enough leaves room: the block shrinks to fit between 0.06 and the face, and the box starts at 0.06', async () => {
    const {result} = await run({center_y: 0.3, width_frac: 0.6, height_frac: 0.3, align: 'center'}, {speakerBox: {x: 0.2, y: 0.25, w: 0.6, h: 0.6}});
    expect(result.report.accepted).toBe(true);
    const box = openingBox(result.spec!);
    expect(box.y).toBeGreaterThanOrEqual(0.06 - 1e-9);
    expect(box.y + box.h).toBeLessThanOrEqual(0.25 - 0.02 + 1e-9);
  });
  it('with no speaker box and an unknown speaker the opening is placed where the plan asked, apart from the rail / UI-band fit', async () => {
    const {result} = await run({center_y: 0.3, width_frac: 0.6, height_frac: 0.18, align: 'center'}, {speakerUnknown: true});
    expect(result.report.placement).toEqual({centerY: 0.3, widthFrac: 0.6, heightFrac: 0.18});
    expect(result.report.corrections).toEqual([]);
  });
});

describe('what is not changed (source text)', () => {
  it('OpeningTreatment, openingBox\'s formula and the shared validator\'s relocation test are untouched', () => {
    const geometry = stripComments(read('remotion/src/lib/openingGeometry.ts'));
    expect(geometry).toContain("const x = spec.align === 'left' ? SIDE_PAD : spec.align === 'right' ? 1 - SIDE_PAD - spec.widthFrac : (1 - spec.widthFrac) / 2;");
    expect(geometry).toContain('const SIDE_PAD = 0.06;');
    expect(stripComments(read('remotion/src/components/OpeningTreatment.tsx'))).toContain('openingBox');
    const plan = stripComments(read('server/src/stages/openingPlan/openingPlan.ts'));
    expect(plan).toContain("const x = spec.align === 'left' ? 0.06 : spec.align === 'right' ? 1 - 0.06 - spec.widthFrac : (1 - spec.widthFrac) / 2;");
    const conflicts = stripComments(read('server/src/lib/editConflicts.ts'));
    expect(conflicts).toContain('const PLATFORM_RAIL: NormRect = {x: 0.86, y: 0.4, w: 0.14, h: 0.42};');
  });
  it('the helper has no imports at all, and resolveOpening\'s imports are still logger-free', () => {
    expect([...stripComments(read('server/src/stages/openingPlan/openingBoxFit.ts')).matchAll(/^import .*$/gm)]).toEqual([]);
    const imports = [...stripComments(read('server/src/stages/openingPlan/openingPlan.ts')).matchAll(/^import .* from '([^']+)'/gm)].map(match => match[1]).sort();
    expect(imports).toEqual(['../textTreatment/textTreatment.ts', './colorRoles.ts', './openingBoxFit.ts', 'zod']);
  });
  it('the rejection reason is the existing one, and the face test reads the drawn box', () => {
    const plan = stripComments(read('server/src/stages/openingPlan/openingPlan.ts'));
    expect(plan).toContain("return reject('no_clear_band_above_the_face', plan.treatment, roles);");
    expect(plan).toContain('rangesOverlap(drawn.y, drawn.y + drawn.h, speaker.y, faceBottom) && rangesOverlap(drawn.x, drawn.x + drawn.w, faceLeft, faceRight)');
    expect(plan).not.toContain('const textLeft');
    expect(plan).toContain('const box = place();');
    expect(plan).not.toContain('const box = {x: (1 - widthFrac) / 2');
  });
  it('the defaults are untouched', () => {
    const env = stripComments(read('server/src/config/env.ts'));
    expect(env).toMatch(/PRODUCT_EDIT_PROFILE:[^\n]*cuts/);
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED:\s*bool\(false\)/);
  });
});
