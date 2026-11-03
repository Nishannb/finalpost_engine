/**
 * Phase 25: frame placement of kept segments (remotion/src/lib/timeline.ts: segmentFrames, compositionFrames).
 * Pure arithmetic; no render. `legacy` below is a verbatim copy of what VideoTrack/ShortVideo computed before the fix, kept here so the
 * defect stays reproducible. The same cases are rendered and decoded frame by frame in finalFrameRender.test.ts (RENDER_TESTS=1).
 */
import {describe, expect, it} from 'vitest';

import {compositionFrames, framesBetween, secToFrame, segmentFrames} from '../../../remotion/src/lib/timeline.ts';

type Seg = {sourceStart: number; sourceEnd: number; outputStart: number};
const seg = (sourceStart: number, sourceEnd: number, outputStart: number): Seg => ({sourceStart, sourceEnd, outputStart});
const FPS = 30;

/** The pre-fix computation: independent rounding of start, length and trim range; composition = ceil(seconds * fps). */
const legacy = (segments: Seg[], seconds: number) => ({
  placed: segments.map(s => ({from: secToFrame(s.outputStart, FPS), durationInFrames: framesBetween(s.sourceStart, s.sourceEnd, FPS), trimBefore: secToFrame(s.sourceStart, FPS), trimAfter: secToFrame(s.sourceEnd, FPS)})),
  total: Math.max(1, Math.ceil(seconds * FPS)),
});
const sumLen = (segments: Seg[]) => Math.round(segments.reduce((total, s) => total + (s.sourceEnd - s.sourceStart), 0) * 1000) / 1000;

/** The four defects, as the Phase 25 repro renders them. */
const C1 = [seg(0.4, 1.9, 0), seg(2.5167, 3.4133, 1.5)];
const C2 = [seg(0, 4.008, 0)];
const C4a = [seg(0, 0.3467, 0), seg(1.0, 1.1833, 0.3467), seg(2.0, 2.9, 0.53)];
const C4b = [seg(0, 0.35, 0), seg(1.0, 1.1834, 0.35), seg(2.0, 2.9, 0.5334)];

describe('the reproduced failures (legacy arithmetic)', () => {
  it('C1: the last Sequence is one frame longer than its trim range, so its last frame lies past trimAfter (black)', () => {
    const {placed, total} = legacy(C1, 2.397);
    const last = placed.at(-1)!;
    expect(last.durationInFrames).toBe(27);
    expect(last.trimAfter - last.trimBefore).toBe(26);
    expect(total).toBe(last.from + last.durationInFrames); // composition does include that frame
  });
  it('C2: the composition has a frame that no Sequence covers (ceil rounds up past the last Sequence)', () => {
    const {placed, total} = legacy(C2, 4.008);
    expect(placed[0]!.durationInFrames).toBe(120);
    expect(total).toBe(121);
  });
  it('C4a / C4b: independent rounding leaves a one-frame gap or a one-frame overlap at a seam', () => {
    const a = legacy(C4a, 1.43).placed;
    expect(a[1]!.from - (a[0]!.from + a[0]!.durationInFrames)).toBe(0);
    expect(a[2]!.from - (a[1]!.from + a[1]!.durationInFrames)).toBe(1); // gap: frame 15 is covered by nothing
    const b = legacy(C4b, 1.433).placed;
    expect(b[2]!.from - (b[1]!.from + b[1]!.durationInFrames)).toBe(-1); // overlap: the later Sequence hides this one's last frame
  });
});

describe('after the fix', () => {
  it('C1: the last Sequence is read for exactly the frames it shows, and the final intended frame (source index 102) is drawn', () => {
    const placed = segmentFrames(C1, FPS);
    const last = placed.at(-1)!;
    expect(last).toEqual({from: 45, durationInFrames: 27, trimBefore: 76, trimAfter: 103});
    expect(last.trimAfter - 1).toBe(102);
    expect(compositionFrames(C1, 2.397, FPS)).toBe(72);
    expect(last.from + last.durationInFrames).toBe(72); // every composition frame is covered
  });

  it('C2: the composition is as long as its content: 120 frames, not 121 (no frame is invented)', () => {
    expect(compositionFrames(C2, 4.008, FPS)).toBe(120);
    expect(segmentFrames(C2, FPS)[0]).toEqual({from: 0, durationInFrames: 120, trimBefore: 0, trimAfter: 120});
  });

  it('C4a / C4b: seams tile exactly: no gap and no overlap', () => {
    for (const [segments, seconds] of [[C4a, 1.43], [C4b, 1.433]] as const) {
      const placed = segmentFrames(segments, FPS);
      for (let i = 1; i < placed.length; i += 1) {
        expect(placed[i]!.from).toBe(placed[i - 1]!.from + placed[i - 1]!.durationInFrames);
      }
      const end = placed.at(-1)!;
      expect(compositionFrames(segments, seconds, FPS)).toBe(end.from + end.durationInFrames);
    }
    // the gap frame now shows the segment's own next source frame (index 35 is inside its [1.0 s, 1.1833 s] interval)
    expect(segmentFrames(C4a, FPS)[1]).toMatchObject({from: 10, durationInFrames: 6, trimBefore: 30, trimAfter: 36});
  });

  it('a normal final segment with sufficient source frames is unchanged', () => {
    const segments = [seg(0, 2, 0), seg(2.5, 3.5, 2)];
    expect(segmentFrames(segments, FPS)).toEqual(legacy(segments, 3).placed.map(p => ({from: p.from, durationInFrames: p.durationInFrames, trimBefore: p.trimBefore, trimAfter: p.trimBefore + p.durationInFrames})));
    expect(compositionFrames(segments, 3, FPS)).toBe(90);
  });

  it('a final segment tight against its sourceEnd never reads a frame that starts at or after it', () => {
    // exact binary example at 2 fps: sourceStart 0.75 s = frame 1.5 -> 2 (up), length 1.25 s = 2.5 frames -> 3 (up), so the unclamped range ends at
    // frame 5; frame 4 starts exactly at sourceEnd (2.0 s) and frame 4 is therefore not part of the segment
    const segments = [seg(0.75, 2.0, 0)];
    expect(framesBetween(0.75, 2.0, 2)).toBe(3);
    expect(secToFrame(0.75, 2)).toBe(2);
    const placed = segmentFrames(segments, 2)[0]!;
    expect(placed.durationInFrames).toBe(2);
    expect(placed.trimAfter - 1).toBe(3);
    expect(compositionFrames(segments, 1.25, 2)).toBe(2);
    // and a float that is a hair above an integer (3.4 * 30 = 102.00000000000001) does not count an extra frame
    expect(segmentFrames([seg(2.4, 3.4, 0)], FPS)[0]!.durationInFrames).toBe(30);
  });

  it('a short composition (5 frames) has 5 frames, and a 1-frame segment survives', () => {
    expect(compositionFrames([seg(0.2, 0.3733, 0)], 0.173, FPS)).toBe(5);
    expect(segmentFrames([seg(0.2, 0.2166, 0)], FPS)[0]!.durationInFrames).toBe(1);
    expect(compositionFrames([seg(0.2, 0.2166, 0)], 0.0166, FPS)).toBe(1);
  });

  it('a real gap or overlap in the blueprint (more than one frame) is left alone', () => {
    const gapped = [seg(0, 1, 0), seg(2, 3, 1.5)]; // output gap of 0.5 s between them: not a rounding disagreement
    expect(segmentFrames(gapped, FPS)[0]!.durationInFrames).toBe(30);
    const overlapped = [seg(0, 1, 0), seg(2, 3, 0.5)];
    expect(segmentFrames(overlapped, FPS)[0]!.durationInFrames).toBe(30);
  });

  it('never makes the composition longer than the legacy length', () => {
    const segments = [seg(0, 1.7, 0), seg(2.2, 3.9, 1.7)];
    expect(compositionFrames(segments, 3.4, FPS)).toBeLessThanOrEqual(legacy(segments, 3.4).total);
    expect(compositionFrames([], 1.5, FPS)).toBe(45);
  });
});

describe('invariants over many generated segment sets (deterministic)', () => {
  let state = 12345;
  const rand = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  const sets: Array<{segments: Seg[]; seconds: number}> = [];
  for (let n = 0; n < 4000; n += 1) {
    const count = 1 + Math.floor(rand() * 6);
    let source = 0;
    let output = 0;
    const segments: Seg[] = [];
    for (let i = 0; i < count; i += 1) {
      const start = Math.round((source + 0.05 + rand() * 1.5) * 1000) / 1000;
      const length = Math.round((0.1 + rand() * 3) * 1000) / 1000;
      segments.push(seg(start, Math.round((start + length) * 1000) / 1000, Math.round(output * 1000) / 1000));
      source = start + length;
      output += length;
    }
    sets.push({segments, seconds: sumLen(segments)});
  }

  it('every Sequence is read for exactly the frames it shows, and starts/trim starts are the legacy values', () => {
    for (const {segments} of sets) {
      const placed = segmentFrames(segments, FPS);
      const old = legacy(segments, 0).placed;
      placed.forEach((item, i) => {
        expect(item.trimAfter - item.trimBefore).toBe(item.durationInFrames);
        expect(item.from).toBe(old[i]!.from);
        expect(item.trimBefore).toBe(old[i]!.trimBefore);
        expect(item.durationInFrames).toBeGreaterThanOrEqual(1);
      });
    }
  });

  it('seams that differ only by rounding tile exactly; the legacy had gaps and overlaps in the same sets', () => {
    let legacyBad = 0;
    for (const {segments} of sets) {
      const placed = segmentFrames(segments, FPS);
      const old = legacy(segments, 0).placed;
      for (let i = 1; i < placed.length; i += 1) {
        expect(placed[i]!.from - (placed[i - 1]!.from + placed[i - 1]!.durationInFrames)).toBe(0);
        legacyBad += old[i]!.from !== old[i - 1]!.from + old[i - 1]!.durationInFrames ? 1 : 0;
      }
    }
    expect(legacyBad).toBeGreaterThan(500); // the defect is common, not an edge case
  });

  it('every composition frame is covered, the length never exceeds the legacy ceil, and equals it whenever it was already covered', () => {
    let legacyUncovered = 0;
    for (const {segments, seconds} of sets) {
      const placed = segmentFrames(segments, FPS);
      const covered = Math.max(...placed.map(item => item.from + item.durationInFrames));
      const total = compositionFrames(segments, seconds, FPS);
      const old = legacy(segments, seconds);
      expect(total).toBeLessThanOrEqual(covered);
      expect(total).toBeLessThanOrEqual(old.total);
      if (covered >= old.total) expect(total).toBe(old.total);
      legacyUncovered += old.total > Math.max(...old.placed.map(item => item.from + item.durationInFrames)) ? 1 : 0;
    }
    expect(legacyUncovered).toBeGreaterThan(500);
  });

  it('the last segment never reads a frame that starts at or after its sourceEnd', () => {
    for (const {segments} of sets) {
      const last = segments.at(-1)!;
      const placed = segmentFrames(segments, FPS).at(-1)!;
      expect((placed.trimAfter - 1) / FPS).toBeLessThan(last.sourceEnd + 1e-6);
    }
  });
});
