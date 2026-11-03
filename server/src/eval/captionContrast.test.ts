/**
 * Phase 26: caption contrast, measured on the encoded Phase 24 fixture (before and after the fix), plus the checks that the fix changed nothing
 * else. Reads the audit artifacts under remotion/out/phase26-audit (written by phase26Render.test.ts and the python tools there). Skipped when
 * they are absent (clean checkout). Never renders, never calls the network.
 */
import {existsSync, readFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

const AUDIT = join(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'), 'remotion', 'out', 'phase26-audit');
const files = ['contrast_summary.json', 'bbox_summary.json', 'footage_unchanged_check.json', 'before/geometry.json', 'after/geometry.json', 'after/run-a/render-result.json', 'after/run-b/render-result.json', 'before/run-a/render-result.json', 'after/visual-change-gap.json'];
const ready = files.every(f => existsSync(join(AUDIT, f)));
const read = (f: string) => JSON.parse(readFileSync(join(AUDIT, f), 'utf8'));

describe.skipIf(!ready)('phase 26 caption contrast (stored measurements of the encoded fixture)', () => {
  it('before the fix the captions failed over bright footage: no outline was drawn and edge contrast fell to about 1:1', () => {
    const before = read('contrast_summary.json').before;
    expect(before['sunlight_b-roll (13.7-15.7 s)'].worst_edge_median).toBeLessThan(2);
    expect(before['notebook_b-roll (19.7-20.5 s)'].worst_edge_median).toBeLessThan(1.5);
    expect(before['sunlight_b-roll (13.7-15.7 s)']['share_edge_median_ge_4.5']).toBe(0);
  });

  it('after the fix every representative background keeps at least 4.5:1 at the glyph edge on every sampled frame (worst frame per window)', () => {
    const after = read('contrast_summary.json').after as Record<string, {frames: number; worst_edge_median: number; 'share_edge_median_ge_4.5': number}>;
    expect(Object.keys(after).length).toBe(7);
    for (const [name, window] of Object.entries(after)) {
      expect(window.frames, name).toBeGreaterThan(20);
      expect(window.worst_edge_median, name).toBeGreaterThanOrEqual(4.5);
      expect(window['share_edge_median_ge_4.5'], name).toBe(1);
    }
  });

  it('captions are drawn on exactly the same frames, with the same layout (box centre within a few px; growth is the outline)', () => {
    const drawn = (rows: Array<{drawn: boolean}>) => rows.map((row, i) => (row.drawn ? i : -1)).filter(i => i >= 0);
    expect(drawn(read('after/geometry.json'))).toEqual(drawn(read('before/geometry.json')));
    const bbox = read('bbox_summary.json');
    for (const window of Object.values(bbox) as Array<{centre_shift_median_x: number; centre_shift_p95_x: number; centre_shift_max_x: number; growth_width_median: number}>) {
      expect(window.centre_shift_median_x).toBeLessThanOrEqual(2);
      expect(window.centre_shift_p95_x).toBeLessThanOrEqual(4);
      expect(window.growth_width_median).toBeGreaterThan(4); // an outline was added
      expect(window.growth_width_median).toBeLessThan(12); // and nothing else grew
    }
  });

  it('the footage is not darkened and the edit is unchanged: outside the caption band the new render equals the previous phase', () => {
    for (const check of read('footage_unchanged_check.json') as Array<{tag: string; frames: [number, number]; psnr_outside_caption_band_min_db: number; frames_below_40db_outside_band: number; black_frames_second: number[]}>) {
      expect(check.frames[0], check.tag).toBe(check.frames[1]);
      expect(check.psnr_outside_caption_band_min_db, check.tag).toBeGreaterThan(40);
      expect(check.frames_below_40db_outside_band, check.tag).toBe(0);
      expect(check.black_frames_second, check.tag).toEqual([]); // the Phase 25 final-frame fix is intact
    }
    const gap = read('after/visual-change-gap.json');
    expect(gap.black_runs).toEqual([]);
  });

  it('repeat renders are byte-identical, defaults are untouched, and the baseline reproduced the Phase 25 video', () => {
    const a = read('after/run-a/render-result.json');
    expect(a.encodedSha256).toBe(read('after/run-b/render-result.json').encodedSha256);
    expect(a.renderError).toBeNull();
    expect(a.flags).toMatchObject({HOOK_TITLE_POLICY: 'placeholder', OCCUPANCY_CONTEXT_V2: false});
    const phase25 = join(AUDIT, '..', 'phase25-audit', 'after', 'run-a', 'render-result.json');
    if (existsSync(phase25)) expect(read('before/run-a/render-result.json').encodedSha256).toBe(JSON.parse(readFileSync(phase25, 'utf8')).encodedSha256);
  });
});
