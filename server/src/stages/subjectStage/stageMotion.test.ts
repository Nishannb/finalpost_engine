/**
 * SUBJECT STAGE Phase 2: the pure motion + layout math (remotion/src/components/SubjectStage/stageMotion.ts, mirrored byte-for-byte in ./stageMotion.ts).
 * Pure: no render, no I/O beyond reading the two source files for the parity pin.
 */
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

import * as M from './stageMotion.ts';

const here = dirname(fileURLToPath(import.meta.url));

describe('parity with the remotion twin', () => {
  it('is byte-identical (the server build cannot import the remotion tree; the renderer must not drift from the planner)', () => {
    const remotion = readFileSync(join(here, '../../../../remotion/src/components/SubjectStage/stageMotion.ts'), 'utf8');
    expect(readFileSync(join(here, 'stageMotion.ts'), 'utf8')).toBe(remotion);
  });
  it('has no imports (pure, dependency-free)', () => {
    expect(readFileSync(join(here, 'stageMotion.ts'), 'utf8')).not.toMatch(/^import /m);
  });
});

describe('auto_scroll: linear, 15-20 % of the frame height per second', () => {
  const H = 1920;
  it('is linear in time at the default 18 %/s', () => {
    expect(M.autoScrollOffsetPx(0, {frameHeightPx: H})).toBe(0);
    expect(M.autoScrollOffsetPx(1, {frameHeightPx: H})).toBeCloseTo(0.18 * H, 2);
    expect(M.autoScrollOffsetPx(4, {frameHeightPx: H})).toBeCloseTo(4 * 0.18 * H, 2);
    const mid = M.autoScrollOffsetPx(2, {frameHeightPx: H});
    expect(mid).toBeCloseTo((M.autoScrollOffsetPx(1, {frameHeightPx: H}) + M.autoScrollOffsetPx(3, {frameHeightPx: H})) / 2, 2);
  });
  it('clamps the speed to the spec range (a planner typo cannot make it a blur)', () => {
    expect(M.autoScrollOffsetPx(1, {frameHeightPx: H, pctHPerSec: 90})).toBeCloseTo(0.2 * H, 2);
    expect(M.autoScrollOffsetPx(1, {frameHeightPx: H, pctHPerSec: 1})).toBeCloseTo(0.15 * H, 2);
  });
  it('stops at the end of the content and never goes negative', () => {
    expect(M.autoScrollOffsetPx(60, {frameHeightPx: H, contentHeightPx: 3000})).toBe(3000 - H);
    expect(M.autoScrollOffsetPx(60, {frameHeightPx: H, contentHeightPx: 1000})).toBe(0);
    expect(M.autoScrollOffsetPx(-3, {frameHeightPx: H})).toBe(0);
  });
});

describe('slow_push: +4-6 % over 3-6 s, ease-out', () => {
  it('starts at 1, ends at 1 + 5 % by default, monotonic, decelerating', () => {
    expect(M.slowPushScale(0, 5)).toBe(1);
    expect(M.slowPushScale(5, 5)).toBeCloseTo(1.05, 3);
    expect(M.slowPushScale(9, 5)).toBeCloseTo(1.05, 3);
    let prev = 1;
    let prevStep = Infinity;
    for (let i = 1; i <= 10; i += 1) {
      const v = M.slowPushScale(i * 0.5, 5);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v - prev).toBeLessThanOrEqual(prevStep + 1e-9);
      prevStep = v - prev;
      prev = v;
    }
  });
  it('clamps the gain to 4-6 % and the push length to 3-6 s', () => {
    expect(M.slowPushScale(10, 5, 40)).toBeCloseTo(1.06, 3);
    expect(M.slowPushScale(10, 5, 0)).toBeCloseTo(1.04, 3);
    expect(M.slowPushScale(3, 2)).toBeCloseTo(1 + 0.05 * M.easeOutCubic(1), 3); // a 2 s stage still uses the 3 s floor: not finished at 2 s
    expect(M.slowPushScale(2, 2)).toBeLessThan(M.slowPushScale(3, 2));
  });
});

describe('accent entrances / exits', () => {
  it('pop_in: hidden before start, 250-300 ms, scale 0.6 -> 1 with a small overshoot', () => {
    expect(M.popInState(-0.01).opacity).toBe(0);
    const s0 = M.popInState(0);
    expect(s0.opacity).toBe(0);
    expect(s0.scale).toBeCloseTo(0.6, 3);
    const done = M.popInState(0.3);
    expect(done).toMatchObject({opacity: 1, scale: 1});
    const peak = Math.max(...Array.from({length: 40}, (_, i) => M.popInState((i / 39) * 0.28).scale));
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(1.12);
    // the duration is clamped to the spec range
    expect(M.popInState(0.2, 5).scale).toBe(M.popInState(0.2, 0.3).scale); // 5 s is clamped to 0.3 s
  });
  it('drop_in_tilt: 300-500 ms, drops from above and settles to its rest tilt', () => {
    const s0 = M.dropInTiltState(0);
    expect(s0.translateYFrac).toBeLessThan(0);
    expect(s0.opacity).toBe(0);
    const end = M.dropInTiltState(0.5, {restTiltDeg: -3});
    expect(end).toMatchObject({opacity: 1, translateYFrac: 0, rotateDeg: -3});
    expect(M.dropInTiltState(0.2, {durSec: 0.1}).translateYFrac).toBe(M.dropInTiltState(0.2, {durSec: 0.3}).translateYFrac); // 0.1 s is clamped up to 0.3 s
    expect(M.dropInTiltState(0.2, {durSec: 9}).translateYFrac).toBe(M.dropInTiltState(0.2, {durSec: 0.5}).translateYFrac); // and 9 s down to 0.5 s
  });
  it('fall_tilt_out: ~700 ms, tips and falls, hidden after', () => {
    expect(M.FALL_TILT_OUT_SEC).toBeCloseTo(0.7, 6);
    expect(M.fallTiltOutState(0)).toMatchObject({opacity: 1, translateYFrac: 0});
    const mid = M.fallTiltOutState(0.35);
    expect(mid.translateYFrac).toBeGreaterThan(0);
    expect(mid.rotateDeg).toBeGreaterThan(0);
    expect(M.fallTiltOutState(0.7).opacity).toBe(0);
    expect(M.fallTiltOutState(2).opacity).toBe(0);
  });
  it('accentState: enter, hold, fall out over the last 700 ms, gone at the end', () => {
    expect(M.accentState('pop_in', 0.5, 2).opacity).toBe(1);
    expect(M.accentState('pop_in', 1.7, 2).opacity).toBeLessThan(1);
    expect(M.accentState('pop_in', 2, 2).opacity).toBe(0);
    expect(M.accentState('drop_in_tilt', 0.5, 2).rotateDeg).toBeCloseTo(-3, 2);
    expect(M.accentState('pop_in', 1.9, 2, false).opacity).toBe(1);
  });
});

describe('text_stack: lines append on the next keyword and never move once placed', () => {
  const starts = [0, 0.6, 1.2];
  it('a line is hidden until its keyword, then settles up and fades in over 250 ms', () => {
    expect(M.textStackLineState(0.5, starts, 1, 3).visible).toBe(false);
    const s = M.textStackLineState(0.6, starts, 1, 3);
    expect(s).toMatchObject({visible: true, opacity: 0});
    expect(s.translateYEm).toBeCloseTo(0.4, 3);
    const done = M.textStackLineState(0.6 + M.TEXT_STACK_LINE_SEC, starts, 1, 3);
    expect(done).toMatchObject({visible: true, opacity: 1, translateYEm: 0});
  });
  it('slot continuity: an earlier line is identical before and after the next one is appended', () => {
    expect(M.textStackLineState(0.9, starts, 0, 3)).toEqual(M.textStackLineState(1.3, starts, 0, 3));
  });
  it('text_exit_follow: every line fades together over the last 250 ms of the stack and is gone at the end', () => {
    const a = M.textStackLineState(3 - 0.125, starts, 0, 3);
    const b = M.textStackLineState(3 - 0.125, starts, 2, 3);
    expect(a.opacity).toBeCloseTo(b.opacity, 3);
    expect(a.opacity).toBeLessThan(1);
    expect(M.textStackLineState(3, starts, 0, 3).visible).toBe(false);
  });
  it('default append times: first at 0, the rest spread over the first 70 %', () => {
    expect(M.defaultLineStarts(3, 5)).toEqual([0, 1.75, 3.5]);
    expect(M.defaultLineStarts(1, 5)).toEqual([0]);
    expect(M.defaultLineStarts(0, 5)).toEqual([]);
  });
  it('accent slots are stable and sit in the top band above the head (head top ~28 %)', () => {
    for (const slot of [0, 1, 2, 3, 7, -1]) {
      const r = M.accentSlotRect(slot);
      expect(r.top).toBeGreaterThanOrEqual(0);
      expect(r.top + r.height).toBeLessThanOrEqual(0.28 + 1e-9);
      expect(r.left + r.width).toBeLessThanOrEqual(1);
    }
    expect(M.accentSlotRect(0)).toEqual(M.accentSlotRect(3));
  });
});

describe('S5 slide_up_front + flash_cut', () => {
  it('slides up over ~300 ms, holds, hard-capped at 3 s, then gone (a hard cut out)', () => {
    expect(M.slideUpFrontState(0, 3)).toEqual({offsetFrac: 1, visible: true});
    expect(M.slideUpFrontState(0.3, 3)).toEqual({offsetFrac: 0, visible: true});
    expect(M.slideUpFrontState(1.5, 3).offsetFrac).toBe(0);
    expect(M.slideUpFrontState(2.99, 3).visible).toBe(true);
    expect(M.slideUpFrontState(3, 3).visible).toBe(false);
    expect(M.slideUpFrontState(-0.1, 3).visible).toBe(false);
    // a 10 s stage is still cut at the cap
    expect(M.slideUpFrontState(M.S5_MAX_DURATION_SEC, 10).visible).toBe(false);
    expect(M.slideUpFrontState(M.S5_MAX_DURATION_SEC - 0.05, 10).visible).toBe(true);
  });
  it('the hold frame is full-bleed: once slid in the offset is 0 (the layer sits on the whole frame) until the cut; it starts fully below the frame', () => {
    expect(M.slideUpFrontState(0, 3).offsetFrac).toBe(1);
    for (const t of [0.3, 0.5, 1, 1.5, 2, 2.9]) expect(M.slideUpFrontState(t, 3)).toEqual({offsetFrac: 0, visible: true});
  });
  it('slide-in is monotonic', () => {
    let prev = 1;
    for (let i = 0; i <= 10; i += 1) {
      const v = M.slideUpFrontState((i / 10) * 0.3, 3).offsetFrac;
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      prev = v;
    }
  });
  it('a front stage must be able to slide in AND hold >= 1.5 s', () => {
    expect(M.s5LengthOk(1.7)).toBe(false);
    expect(M.s5LengthOk(1.8)).toBe(true);
    // user rule (overrides the old 85 % grammar): the takeover covers the WHOLE frame, edge to edge
    expect(M.S5_COVERAGE_PCT).toBe(100);
  });
  it('flash_cut: 70-100 ms white pulse, zero outside', () => {
    expect(M.flashCutOpacity(-0.01)).toBe(0);
    expect(M.flashCutOpacity(0)).toBe(0);
    const peak = Math.max(...Array.from({length: 50}, (_, i) => M.flashCutOpacity((i / 49) * 0.085)));
    expect(peak).toBeGreaterThan(0.8);
    expect(peak).toBeLessThanOrEqual(M.FLASH_CUT_PEAK);
    expect(M.flashCutOpacity(0.1)).toBe(0);
    expect(M.flashCutOpacity(0.5)).toBe(0);
    // durations are clamped into 70-100 ms
    expect(M.flashCutOpacity(0.09, 0.01)).toBe(0);
    expect(M.flashCutOpacity(0.05, 5)).toBeGreaterThan(0);
    expect(M.flashCutOpacity(0.099, 5)).toBeGreaterThanOrEqual(0);
    expect(M.flashCutOpacity(0.11, 5)).toBe(0);
  });
});

describe('room treatment (dim only under the cutout — no spatial blur)', () => {
  it('never emits CSS blur (blur-under-cutout creates the blur-mirror ghost)', () => {
    expect(M.BG_BLUR_PX_RANGE).toEqual([0, 0]);
    expect(M.backdropFilterCss()).toBe('brightness(0.82)');
    expect(M.backdropFilterCss({blurPx: 50, dimPct: 18})).toBe('brightness(0.82)');
    expect(M.backdropFilterCss({blurPx: 0, dimPct: 15})).toBe('brightness(0.85)');
    expect(M.backdropFilterCss({dimPct: 90})).toBe('brightness(0.8)');
    expect(M.backdropFilterCss()).not.toMatch(/blur\(/);
  });
  it('only S2-S5 spans dim the room (S1 replaces it); no span / no stage = no filter', () => {
    const stage = {matteUrl: 'https://x/m.webm', spans: [{start: 0, end: 4, stage: 'S1' as const}, {start: 4, end: 8, stage: 'S2' as const}, {start: 8, end: 10, stage: 'S4' as const}]};
    expect(M.stageBackdropFilterAt(stage, 2)).toBeUndefined();
    expect(M.stageBackdropFilterAt(stage, 4)).toBe('brightness(0.82)');
    expect(M.stageBackdropFilterAt(stage, 9.9)).toBeDefined();
    expect(M.stageBackdropFilterAt(stage, 10)).toBeUndefined();
    expect(M.stageBackdropFilterAt(undefined, 5)).toBeUndefined();
  });
  it('combineFilters leaves the existing grade UNCHANGED when there is nothing to add (the no-op guarantee)', () => {
    expect(M.combineFilters(undefined, undefined)).toBeUndefined();
    expect(M.combineFilters('grayscale(1) contrast(1.18)', undefined)).toBe('grayscale(1) contrast(1.18)');
    expect(M.combineFilters(undefined, 'brightness(0.82)')).toBe('brightness(0.82)');
    expect(M.combineFilters('grayscale(1)', 'brightness(0.82)')).toBe('grayscale(1) brightness(0.82)');
  });
  it('the ghost feather mask fades toward the subject and the wash is a soft warm gradient', () => {
    const mask = M.ghostFeatherMask(0.5, 0.22);
    expect(mask).toContain('linear-gradient(to right');
    expect(mask).toContain('rgba(0,0,0,0.25)');
    expect(M.warmWashGradient()).toContain(M.STAGE_TOKENS.warmWash);
  });
});

describe('stage opacities + span helpers', () => {
  it('behind opacities per stage: S1 1, S2 1, S3 0.5, S4 0', () => {
    expect(M.STAGE_BEHIND_OPACITY).toMatchObject({S1: 1, S2: 1, S3: 0.5, S4: 0});
  });
  it('stageSpanAt is half-open', () => {
    const spans = [{start: 1, end: 3, stage: 'S2' as const}, {start: 3, end: 5, stage: 'S3' as const}];
    expect(M.stageSpanAt(spans, 0.9)).toBeUndefined();
    expect(M.stageSpanAt(spans, 1)?.stage).toBe('S2');
    expect(M.stageSpanAt(spans, 3)?.stage).toBe('S3');
    expect(M.stageSpanAt(spans, 5)).toBeUndefined();
    expect(M.stageSpanAt(undefined, 1)).toBeUndefined();
  });
  it('foregroundFromStage: the matte over the merged union of the spans; undefined without a stage / matte / spans', () => {
    const spans = [{start: 0, end: 3, stage: 'S1' as const}, {start: 3, end: 5, stage: 'S2' as const}, {start: 7, end: 9, stage: 'S4' as const}];
    expect(M.foregroundFromStage({matteUrl: ' https://x/m.webm ', spans})).toEqual({videoUrl: 'https://x/m.webm', spans: [{start: 0, end: 5}, {start: 7, end: 9}]});
    expect(M.foregroundFromStage(undefined)).toBeUndefined();
    expect(M.foregroundFromStage({matteUrl: '  ', spans})).toBeUndefined();
    expect(M.foregroundFromStage({matteUrl: 'https://x/m.webm', spans: []})).toBeUndefined();
  });
});
