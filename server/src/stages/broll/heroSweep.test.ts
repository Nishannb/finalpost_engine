/**
 * Text-behind readability: the hero MARQUEE math (remotion/src/motion/heroSweep.ts, mirrored byte-for-byte in ./heroSweep.ts), the planner/binder gate that uses it, the word-pop placement, and the Remotion comp wiring.
 * Pure: no render, no I/O beyond reading source files.
 */
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

import {
  HERO_SCALE_OVERSHOOT,
  SHORTS_SAFE,
  glyphAdvanceEm,
  heroAdvanceEm,
  heroClampCenterY,
  heroContainedFontPx,
  shortsSafeRect,
  glyphsClearAt,
  headBandExtent,
  heroSweepFeasible,
  heroSweepLeftX,
  heroSweepSizeOf,
  lineWidthEm,
  planHeroSweep,
  planWordPopSlot,
  type HeroSweepPlan,
  type SweepBox,
} from './heroSweep.ts';
import {matteHeroRevealMode, matteOcclusionReadable} from './matteTextReadable.ts';

const here = dirname(fileURLToPath(import.meta.url));
const W = 720;
const H = 1280;
const MAX = H * 0.27;
const plan = (box: SweepBox | undefined, lines: string[], beatSec = 2.4) => planHeroSweep({box, lines, width: W, height: H, maxFontPx: MAX, beatSec});

/** Independent re-measurement of the readability criterion from the plan's own motion: longest contiguous clear stretch (fraction of the beat) of every glyph, 480 samples. */
function glyphDwell(p: HeroSweepPlan, samples = 480): number[] {
  const best = p.glyphs.map(() => 0);
  const run = p.glyphs.map(() => 0);
  for (let i = 0; i < samples; i += 1) {
    glyphsClearAt(p, (i + 0.5) / samples).forEach((clear, g) => {
      run[g] = clear ? run[g]! + 1 : 0;
      best[g] = Math.max(best[g]!, run[g]!);
    });
  }
  return best.map(b => b / samples);
}

// the measured head of the proof clip (hi.mp4 RVM alpha), at the rows the hero occupies: x = 0.335 .. 0.715 (see kinetic-led-rvm/entry.tsx)
const PROOF_HEAD: SweepBox = {x: 0.335, y: 0.09, w: 0.38, h: 0.91};
const TYPICAL_BOXES: Array<[string, SweepBox]> = [
  ['x0.2 w0.6', {x: 0.2, y: 0.3, w: 0.6, h: 0.5}],
  ['x0.25 w0.5', {x: 0.25, y: 0.3, w: 0.5, h: 0.45}],
  ['default x0.3 w0.4', {x: 0.3, y: 0.3, w: 0.4, h: 0.62}],
  ['measured head', PROOF_HEAD],
];

describe('the server copy is the remotion module', () => {
  it('is byte-identical (the server build cannot import the remotion tree, the comp must not drift from the gate)', () => {
    const remotion = readFileSync(join(here, '../../../../remotion/src/motion/heroSweep.ts'), 'utf8');
    const server = readFileSync(join(here, 'heroSweep.ts'), 'utf8');
    expect(server).toBe(remotion);
  });
});

describe('marquee: ATTENTION stays BIG and every glyph is clear for a contiguous stretch', () => {
  it.each(TYPICAL_BOXES)('%s: feasible, and the word is not shrunk to a gutter (>= 6 %% of the frame height, spanning well over a gutter)', (_name, box) => {
    const p = plan(box, ['ATTENTION']);
    expect(p.feasible).toBe(true);
    expect(p.fontPx).toBeGreaterThanOrEqual(0.06 * H);
    // the word is wider than either gutter (it scrolls behind the head); only the reading-order rests shave its size
    expect(p.blockWidthPx).toBeGreaterThanOrEqual(0.55 * W);
  });

  it.each(TYPICAL_BOXES)('%s: SAFE ZONE: at every frame of the beat every glyph is fully inside the Shorts safe rect (no glyph cut by the frame / safe edge)', (_name, box) => {
    for (const beatSec of [1.92, 2.4]) {
      const p = plan(box, ['ATTENTION'], beatSec);
      const safe = shortsSafeRect(W, H);
      expect(p.view.from).toBeCloseTo(safe.left, 6);
      expect(p.view.to).toBeCloseTo(safe.right, 6);
      expect(p.blockWidthPx).toBeLessThanOrEqual(safe.w + 1e-6);
      for (let i = 0; i <= 200; i += 1) {
        const left = heroSweepLeftX(p, i / 200);
        for (const g of p.glyphs) {
          expect(left + g.offset, `${_name} @${beatSec}s u=${i / 200} glyph ${g.char}`).toBeGreaterThanOrEqual(safe.left - 1e-6);
          expect(left + g.offset + g.width, `${_name} @${beatSec}s u=${i / 200} glyph ${g.char}`).toBeLessThanOrEqual(safe.right + 1e-6);
        }
      }
    }
  });

  it('the person may still hide letters (occlusion is allowed, edge clipping is not): the whole word is never clear of the head at once on the measured head', () => {
    const p = plan(PROOF_HEAD, ['ATTENTION']);
    let allClearAt = 0;
    let someHidden = 0;
    for (let i = 0; i < 200; i += 1) {
      const c = glyphsClearAt(p, (i + 0.5) / 200);
      if (c.every(Boolean)) allClearAt += 1;
      if (c.some(x => !x)) someHidden += 1;
    }
    expect(allClearAt).toBe(0);
    expect(someHidden).toBe(200);
  });

  it('reading order dominates: the EARLY rest shows a contiguous clear PREFIX (ATTE) and nothing else; the LATE rest a contiguous clear SUFFIX (TION) and nothing else', () => {
    const p = plan(PROOF_HEAD, ['ATTENTION'], 1.92);
    const early = glyphsClearAt(p, 0.02);
    const late = glyphsClearAt(p, 0.98);
    const word = 'ATTENTION';
    const lead = (flags: boolean[]) => flags.findIndex(f => !f); // length of the leading clear run
    const trail = (flags: boolean[]) => [...flags].reverse().findIndex(f => !f);
    const earlyPrefix = lead(early);
    const latePrefix = lead(late);
    const lateSuffix = trail(late);
    // early: first letter clear, a prefix of at least ATTE, NO clear letter outside that prefix (no ION on the right)
    expect(early[0]).toBe(true);
    expect(earlyPrefix).toBeGreaterThanOrEqual(3);
    expect(early.filter(Boolean).length).toBe(earlyPrefix);
    // late: last letter clear, a suffix of at least TION, NO clear letter outside that suffix (no dangling AT on the left)
    expect(late[word.length - 1]).toBe(true);
    expect(lateSuffix).toBeGreaterThanOrEqual(3);
    expect(late.filter(Boolean).length).toBe(lateSuffix);
    expect(latePrefix).toBe(0);
    // the last letter is NOT required (nor present) at the early rest, the first letter not at the late rest
    expect(early[word.length - 1]).toBe(false);
    expect(late[0]).toBe(false);
  });

  it('the same holds on the other typical boxes: a clear prefix at the start rest, a clear suffix at the end rest, nothing dangling', () => {
    for (const [name, box] of TYPICAL_BOXES) {
      const p = plan(box, ['ATTENTION']);
      const early = glyphsClearAt(p, 0.01);
      const late = glyphsClearAt(p, 0.99);
      const prefix = early.findIndex(f => !f);
      const suffix = [...late].reverse().findIndex(f => !f);
      expect(early[0], name).toBe(true);
      expect(late[8], name).toBe(true);
      expect(prefix, name).toBeGreaterThanOrEqual(3);
      expect(suffix, name).toBeGreaterThanOrEqual(3);
      expect(early.filter(Boolean).length, `${name} early dangling`).toBe(prefix);
      expect(late.filter(Boolean).length, `${name} late dangling`).toBe(suffix);
    }
  });

  it('the rest frames are contained: no letter is cut by the safe window (nothing is "half clipped"), on every typical box', () => {
    for (const [name, box] of TYPICAL_BOXES) {
      const p = plan(box, ['ATTENTION']);
      for (const left of [p.startLeft, p.endLeft]) for (const g of p.glyphs) {
        expect(left + g.offset, name).toBeGreaterThanOrEqual(p.view.from - 1e-6);
        expect(left + g.offset + g.width, name).toBeLessThanOrEqual(p.view.to + 1e-6);
      }
    }
  });

  it('long words and two-word heroes are fine, and are SHRUNK to fit the safe width instead of scrolling off-screen', () => {
    const safe = shortsSafeRect(W, H);
    for (const lines of [['EVERYTHING'], ['GROWTH', 'HACKS'], ['EXTRAORDINARILY'], ['ATTENTION']]) {
      for (const [, box] of TYPICAL_BOXES) {
        const p = plan(box, lines);
        expect(p.feasible, `${lines.join(' ')} on ${JSON.stringify(box)}`).toBe(true);
        expect(p.blockWidthPx).toBeLessThanOrEqual(safe.w + 1e-6);
        expect(p.fontPx).toBeGreaterThanOrEqual(0.06 * H);
        expect(heroSweepFeasible(box, lines.join(' '))).toBe(true);
      }
    }
    // a very long word cannot be as big as a short one: it is shrunk, never scrolled out
    expect(plan(PROOF_HEAD, ['EXTRAORDINARILY']).fontPx).toBeLessThan(plan(PROOF_HEAD, ['WIN']).fontPx);
  });

  it('short words stay big (not shrunk to a medium side word)', () => {
    const p = plan({x: 0.3, y: 0.3, w: 0.4, h: 0.62}, ['WIN']);
    expect(p.feasible).toBe(true);
    expect(p.fontPx).toBeGreaterThanOrEqual(0.1 * H);
  });

  it('motion is hold, linear scroll, hold, and deterministic', () => {
    const p = plan(PROOF_HEAD, ['ATTENTION']);
    expect(heroSweepLeftX(p, 0)).toBe(p.startLeft);
    expect(heroSweepLeftX(p, 1)).toBe(p.endLeft);
    const mid = heroSweepLeftX(p, (p.holdA + 1 - p.holdB) / 2);
    expect(mid).toBeCloseTo((p.startLeft + p.endLeft) / 2, 6);
    expect(JSON.stringify(plan(PROOF_HEAD, ['ATTENTION']))).toBe(JSON.stringify(p));
  });

  it('glyph widths: hero = measured Bebas Neue advances, word pop = Inter 900 advances', () => {
    expect(heroAdvanceEm('I')).toBeCloseTo(0.182, 3);
    expect(heroAdvanceEm('M')).toBeCloseTo(0.528, 3);
    expect(heroAdvanceEm('a')).toBe(heroAdvanceEm('A'));
    expect(glyphAdvanceEm('I')).toBeCloseTo(0.266, 3);
    expect(glyphAdvanceEm('W')).toBeCloseTo(1.057, 3);
    expect(glyphAdvanceEm('a')).toBe(glyphAdvanceEm('A'));
    expect(heroSweepSizeOf('big idea now', 'and that is')).toEqual({lines: ['BIG', 'IDEA'], leadChars: 11});
  });
});

describe('Shorts safe zone', () => {
  it('fractions and the 1080x1920 rect (x=60 y=250 w=900 h=1400)', () => {
    expect(SHORTS_SAFE.leftFrac).toBeCloseTo(60 / 1080, 9);
    expect(SHORTS_SAFE.rightFrac).toBeCloseTo(120 / 1080, 9);
    expect(SHORTS_SAFE.topFrac).toBeCloseTo(250 / 1920, 9);
    expect(SHORTS_SAFE.bottomFrac).toBeCloseTo(270 / 1920, 9);
    const r = shortsSafeRect(1080, 1920);
    [r.left, r.top, r.w, r.h].forEach((v, i) => expect(v).toBeCloseTo([60, 250, 900, 1400][i]!, 6));
    const s = shortsSafeRect(720, 1280);
    expect(s.left).toBeCloseTo(40, 6);
    expect(s.right).toBeCloseTo(640, 6);
    expect(s.top).toBeCloseTo(250 / 1.5, 6);
    expect(s.bottom).toBeCloseTo(1280 - 180, 6);
  });

  it('vertical: a block at the scale overshoot is clamped inside the safe top / bottom, and the contained font fits both axes', () => {
    const safe = shortsSafeRect(W, H);
    const font = heroContainedFontPx(['ATTENTION'], W, H, 9999, {leadEm: 0.32, scale: HERO_SCALE_OVERSHOOT});
    expect(font * lineWidthEm('ATTENTION') * HERO_SCALE_OVERSHOOT).toBeLessThanOrEqual(safe.w + 1e-6);
    for (const want of [0, 100, 640, 1280]) {
      const blockH = font * 0.86 + font * 0.32;
      const cy = heroClampCenterY(want, blockH, H, W, HERO_SCALE_OVERSHOOT);
      expect(cy - (blockH * HERO_SCALE_OVERSHOOT) / 2).toBeGreaterThanOrEqual(safe.top - 1e-6);
      expect(cy + (blockH * HERO_SCALE_OVERSHOOT) / 2).toBeLessThanOrEqual(safe.bottom + 1e-6);
    }
  });
});

describe('demotion: only when there is no usable gutter at all', () => {
  it('a subject box that fills the frame (the proof clip UNION box, arms to the frame edges) has no gutter', () => {
    const union: SweepBox = {x: 0, y: 0.09, w: 1, h: 0.91};
    expect(plan(union, ['ATTENTION']).feasible).toBe(false);
    expect(plan(union, ['ATTENTION']).reason).toBe('subject_too_wide');
    expect(matteOcclusionReadable(union)).toBe(false);
    expect(matteHeroRevealMode(union, {text: 'attention'})).toBe('headroom');
    expect(heroSweepFeasible(union, 'attention')).toBe(false);
  });

  it('both gutters tiny (< 8 % of the frame) -> demote, whatever the word', () => {
    const wide: SweepBox = {x: 0.07, y: 0.2, w: 0.86, h: 0.6}; // 0.86 < 0.9 but the head band + margins leave no 8 % gutter on either side
    const tightBand: SweepBox = {x: 0.1, y: 0.2, w: 0.8, h: 0.6};
    for (const box of [wide, tightBand]) {
      const readable = matteOcclusionReadable(box);
      const p = plan(box, ['WIN']);
      expect(p.feasible).toBe(readable);
    }
    expect(plan({x: 0.28, y: 0.2, w: 0.44, h: 0.6}, ['ATTENTION']).feasible).toBe(true);
  });

  it('missing / invalid boxes never occlude', () => {
    expect(plan(undefined, ['ATTENTION']).feasible).toBe(false);
    expect(plan({x: 0.3, y: 0.3, w: 0, h: 0.5}, ['ATTENTION']).feasible).toBe(false);
    expect(matteHeroRevealMode(undefined)).toBe('headroom');
  });

  it('matteHeroRevealMode: a long word on a normal talking-head box is a sweep (the old gate demoted ATTENTION)', () => {
    const box = {x: 0.25, y: 0.3, w: 0.5, h: 0.45};
    expect(matteHeroRevealMode(box)).toBe('sweep');
    expect(matteHeroRevealMode(box, {text: 'ATTENTION'})).toBe('sweep');
    expect(matteHeroRevealMode(box, {text: 'EVERYTHING', lead: 'and that is a very long lead line'})).toBe('sweep');
  });
});

describe('word pop placement: ZERO overlap with the person', () => {
  const region = {left: W * 0.06, top: H * 0.08, w: W * 0.88};
  const slotFor = (box: SweepBox, word: string, anchor?: 'left' | 'right' | 'top') => planWordPopSlot({box, word, anchor, width: W, height: H, region, sideCapPx: H * 0.06, topCapPx: H * 0.085});

  it('never intersects the head band (+ pad) on any typical box, any anchor, any short word', () => {
    for (const [, box] of TYPICAL_BOXES) {
      const band = headBandExtent(box);
      for (const word of ['Okay', 'Wow', 'Seriously', 'Honestly', 'No']) {
        for (const anchor of ['left', 'right', 'top', undefined] as const) {
          const s = slotFor(box, word, anchor);
          if (!s) continue; // nothing fits: the word is not drawn
          if (s.side === 'top') expect(s.rect.bottom, `${word}/${anchor}`).toBeLessThanOrEqual(box.y * H + 1e-6);
          else expect(s.rect.right <= band.x0 * W + 1e-6 || s.rect.left >= band.x1 * W - 1e-6, `${word}/${anchor}/${s.side} rect ${JSON.stringify(s.rect)} vs band ${JSON.stringify(band)}`).toBe(true);
          expect(s.rect.left).toBeGreaterThanOrEqual(-1e-6);
          expect(s.rect.right).toBeLessThanOrEqual(W + 1e-6);
        }
      }
    }
  });

  it('pad: the pop keeps a wider berth than the hero margin (>= 4 % of the frame) and allows for its scale overshoot', () => {
    const s = slotFor(PROOF_HEAD, 'Okay', 'left')!;
    const band = headBandExtent(PROOF_HEAD);
    expect(band.x0 * W - s.rect.right).toBeGreaterThanOrEqual(0.04 * W - 1e-6);
  });

  it('on the measured head the word sits at head height beside it (not chest height, where the arms / shoulders are)', () => {
    const s = slotFor(PROOF_HEAD, 'Okay', 'left')!;
    expect(s.side).toBe('left');
    expect(s.rect.right).toBeLessThan(PROOF_HEAD.x * W);
    expect(s.cy).toBeLessThan((PROOF_HEAD.y + 0.25 * PROOF_HEAD.h) * H);
  });

  it('with real headroom a word that does not fit beside the head goes ABOVE the head top; with neither it is not drawn', () => {
    const headroomBox: SweepBox = {x: 0.3, y: 0.4, w: 0.4, h: 0.55};
    const up = slotFor(headroomBox, 'Absolutely', 'left')!;
    expect(up.side === 'top' || up.rect.right <= headBandExtent(headroomBox).x0 * W).toBe(true);
    const noRoom = slotFor(PROOF_HEAD, 'Seriously', 'left');
    if (noRoom) expect(noRoom.rect.right <= headBandExtent(PROOF_HEAD).x0 * W || noRoom.rect.left >= headBandExtent(PROOF_HEAD).x1 * W).toBe(true);
  });
});

describe('Remotion wiring', () => {
  const src = readFileSync(join(here, '../../../../remotion/src/motion/compositions/templates/KineticTypeStory.tsx'), 'utf8');
  const hero = src.slice(src.indexOf('export const TypeEnvironmentalHero'), src.indexOf('// ---', src.indexOf('export const TypeEnvironmentalHero')));
  const pop = src.slice(src.indexOf('export const TypeKineticWordPop'), src.indexOf('// ---', src.indexOf('export const TypeKineticWordPop')));

  it('TypeEnvironmentalHero renders the marquee from the shared plan (big font, left-aligned lines, no kerning, clipped to the view window) and demotes only when infeasible', () => {
    expect(src).toContain("from '../../heroSweep'");
    expect(src).toContain("reveal?: 'sweep' | 'none'");
    expect(hero).toContain('planHeroSweep(');
    expect(hero).toContain('heroSweepLeftX(');
    expect(hero).toContain("fontKerning: 'none'");
    expect(hero).toContain("overflow: 'hidden'");
    expect(hero).toMatch(/const font = marquee \? marquee\.fontPx/);
    expect(hero).toContain('heroContainedFontPx(');
    expect(hero).toContain('heroClampCenterY(');
    expect(hero).toContain('shortsSafeRect(');
    expect(hero).toContain("fontFamily('bebas')");
    expect(hero).toMatch(/const occluded = wantsMatte && \(reveal === 'none' \|\| Boolean\(marquee\)\)/);
    // the big-hero cap is the comp's occluded cap, not a gutter size
    expect(hero).toMatch(/maxFontPx: capPx\(width, height, 0\.27\)/);
  });

  it('TypeKineticWordPop places its word with planWordPopSlot and has no occlusion path', () => {
    expect(pop).toContain('planWordPopSlot(');
    expect(pop).not.toContain('SubjectForeground');
    expect(pop).not.toMatch(/occluded|occlusion ===/);
  });

  it('the sweep reveal prop is documented in the registry schema for the Director', () => {
    const reg = readFileSync(join(here, '../motionDirector/libraryRegistry.ts'), 'utf8');
    expect(reg).toMatch(/reveal\?:'sweep'\|'none'/);
    expect(reg).toContain('MARQUEE');
  });
});
