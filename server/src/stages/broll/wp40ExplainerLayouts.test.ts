/**
 * WP40: Explainer Skill B (offline). Covers: the pure pacing planner (intervals, layout sequence, snapping, warnings), the layout model parity with the renderer lib, the skill switch (default off = no-op,
 * mutual exclusion with the faceless lane: faceless wins), source pins (flag default off, analyze wiring behind the flag, Skill A path untouched), the proof entry / script pins and the measured-MP4 evidence.
 * No render, no network.
 */
import {existsSync, readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {
  EXPLAINER_CAPTION_Y_PCT,
  EXPLAINER_GRID_BG,
  EXPLAINER_LAYOUT_IDS as RENDERER_LAYOUT_IDS,
  EXPLAINER_SPLIT_RATIO,
  explainerGridCss,
  explainerRegions,
} from '../../../../remotion/src/lib/explainerLayouts.ts';
import {env} from '../../config/env.ts';
import {
  EXPLAINER_BOUNDS,
  EXPLAINER_LAYOUT_IDS,
  LAYOUT_OF_ROLE,
  explainerBoundaries,
  planExplainerPacing,
  resolvePolishSkill,
  type ExplainerWord,
} from './explainerPacing.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const fixture = JSON.parse(read('./fixtures/wp40-vo-words.json')) as {durationSec: number; words: ExplainerWord[]};
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};
const lengths = (plan: ReturnType<typeof planExplainerPacing>) => plan.segments.map(segment => segment.end - segment.start);

describe('WP40 pacing planner', () => {
  const plan = planExplainerPacing({durationSec: fixture.durationSec, words: fixture.words});

  it('tiles [0, duration] with hard cuts only (no gap, no overlap)', () => {
    expect(plan.segments[0]!.start).toBe(0);
    expect(plan.segments.at(-1)!.end).toBeCloseTo(fixture.durationSec, 6);
    plan.segments.forEach((segment, index) => {
      if (index > 0) expect(segment.start).toBe(plan.segments[index - 1]!.end);
      expect(segment.end).toBeGreaterThan(segment.start);
    });
    expect(plan.cuts).toEqual(plan.segments.slice(1).map(segment => segment.start));
  });

  it('keeps every interval in the medium band (2-6 s here, TH <= 11 s, b-roll 2-4 s) with a ~3.5-4 s median', () => {
    for (const segment of plan.segments) {
      const length = segment.end - segment.start;
      const bounds = EXPLAINER_BOUNDS[segment.role];
      expect(length).toBeGreaterThanOrEqual(2);
      expect(length).toBeLessThanOrEqual(11);
      expect(length).toBeGreaterThanOrEqual(bounds.lo - 1e-6);
      expect(length).toBeLessThanOrEqual(bounds.hi + 1e-6);
      if (segment.layout === 'explainer_b' || segment.layout === 'explainer_c') expect(length).toBeLessThanOrEqual(4 + 1e-6);
    }
    expect(median(lengths(plan))).toBeGreaterThanOrEqual(3.4);
    expect(median(lengths(plan))).toBeLessThanOrEqual(4.2);
    expect(plan.stats.minSec).toBeGreaterThanOrEqual(2);
    // NOT the Metromedia hyper-cut (ASL 0.85 s)
    expect(plan.stats.meanSec).toBeGreaterThan(3);
  });

  it('follows the grammar: B hook -> A / C alternating -> late D -> A cta; all four layouts appear', () => {
    expect(plan.segments[0]!.layout).toBe('explainer_b');
    expect(plan.segments[0]!.role).toBe('hook');
    expect(plan.segments.at(-1)!.layout).toBe('explainer_a');
    expect(plan.segments.at(-1)!.role).toBe('cta');
    expect(new Set(plan.segments.map(segment => segment.layout))).toEqual(new Set(EXPLAINER_LAYOUT_IDS));
    expect(plan.segments.map(segment => segment.layout)).toEqual(['explainer_b', 'explainer_a', 'explainer_c', 'explainer_a', 'explainer_d', 'explainer_a']);
    const d = plan.segments.find(segment => segment.layout === 'explainer_d')!;
    expect(d.start).toBeGreaterThanOrEqual((fixture.durationSec * 2) / 3 - 1e-6); // cutaways only in the final third
    expect(d.end - d.start).toBeGreaterThanOrEqual(3);
    expect(d.end - d.start).toBeLessThanOrEqual(7);
    // role -> layout is one table
    for (const segment of plan.segments) expect(segment.layout).toBe(LAYOUT_OF_ROLE[segment.role]);
  });

  it('snaps cuts to sentence ends / pauses of the VO when it can (and reports the share)', () => {
    const boundaries = explainerBoundaries(fixture.words, fixture.durationSec);
    expect(boundaries.length).toBeGreaterThan(5);
    expect(plan.stats.snapped).toBeGreaterThan(0);
    const bare = planExplainerPacing({durationSec: fixture.durationSec});
    expect(bare.stats.snapped).toBe(0);
    expect(bare.segments.map(segment => segment.layout)).toEqual(plan.segments.map(segment => segment.layout)); // words move cuts, never the sequence
  });

  it('warns polish_pace:explainer_cuts:<n> (n = hard cuts)', () => {
    expect(plan.warnings).toContain(`polish_pace:explainer_cuts:${plan.cuts.length}`);
    expect(plan.stats.cutCount).toBe(plan.segments.length - 1);
  });

  it('scales: 30 s / 60 s / 117.8 s stay in band, alternate A / C, one D in the final third before the CTA', () => {
    for (const durationSec of [30, 60, 117.8]) {
      const long = planExplainerPacing({durationSec});
      const layouts = long.segments.map(segment => segment.layout);
      expect(layouts[0]).toBe('explainer_b');
      expect(layouts.filter(id => id === 'explainer_d')).toHaveLength(1);
      expect(layouts.at(-2)).toBe('explainer_d');
      expect(layouts.at(-1)).toBe('explainer_a');
      layouts.slice(1, -2).forEach((id, index) => expect(id).toBe(index % 2 === 0 ? 'explainer_a' : 'explainer_c'));
      for (const length of lengths(long)) {
        expect(length).toBeGreaterThanOrEqual(2);
        expect(length).toBeLessThanOrEqual(11);
      }
      expect(median(lengths(long))).toBeGreaterThanOrEqual(3.2);
      expect(median(lengths(long))).toBeLessThanOrEqual(4.2);
      expect(long.segments.find(segment => segment.layout === 'explainer_d')!.start).toBeGreaterThanOrEqual((durationSec * 2) / 3 - 1e-6);
    }
  });

  it('is deterministic and handles a short clip honestly (one talking head + a warning)', () => {
    expect(planExplainerPacing({durationSec: 40, words: fixture.words})).toEqual(planExplainerPacing({durationSec: 40, words: fixture.words}));
    const short = planExplainerPacing({durationSec: 9});
    expect(short.segments).toEqual([{start: 0, end: 9, layout: 'explainer_a', role: 'talking_head'}]);
    expect(short.warnings).toContain('polish_pace:explainer_short_clip:9');
    expect(planExplainerPacing({durationSec: 0}).segments).toEqual([]);
  });
});

describe('WP40 layout model (renderer lib parity)', () => {
  it('has the same four stable ids as the planner', () => {
    expect([...RENDERER_LAYOUT_IDS]).toEqual([...EXPLAINER_LAYOUT_IDS]);
    expect([...EXPLAINER_LAYOUT_IDS]).toEqual(['explainer_a', 'explainer_b', 'explainer_c', 'explainer_d']);
  });

  it('B splits top b-roll / bottom speaker at 50 %; A, C, D are full frame', () => {
    expect(EXPLAINER_SPLIT_RATIO).toBe(0.5);
    expect(explainerRegions('explainer_b', 720, 1280)).toEqual({top: {x: 0, y: 0, w: 720, h: 640}, bottom: {x: 0, y: 640, w: 720, h: 640}, full: null});
    for (const id of ['explainer_a', 'explainer_c', 'explainer_d'] as const) expect(explainerRegions(id, 720, 1280).full).toEqual({x: 0, y: 0, w: 720, h: 1280});
  });

  it('C is a white ground with a light-gray dot lattice (grid css scales with the frame)', () => {
    expect(EXPLAINER_GRID_BG).toBe('#FFFFFF');
    const css = explainerGridCss(1080);
    expect(css.backgroundColor).toBe('#FFFFFF');
    expect(css.backgroundImage).toContain('radial-gradient');
    expect(css.backgroundImage).toContain('#AEB4BD');
    expect(css.backgroundSize).toBe('45.36px 45.36px');
    expect(Number.parseFloat(explainerGridCss(540).backgroundSize)).toBeCloseTo(Number.parseFloat(css.backgroundSize) / 2, 1);
  });

  it('pins the grammar caption y per layout (B on the seam) for WP41', () => {
    expect(EXPLAINER_CAPTION_Y_PCT).toEqual({explainer_a: 75, explainer_b: 50, explainer_c: 75, explainer_d: 75});
    const yaml = read('../../../../remotion/out/phase36-readiness/explainer-grammar.yaml');
    expect(yaml).toMatch(/y_pct: \{B: 50, A: 75, C: 75, D: 75\}/);
  });
});

describe('WP40 skill switch (default off, mutual exclusion)', () => {
  it('both off -> default (the existing polish, no warning)', () => {
    expect(resolvePolishSkill({faceless: false, explainer: false})).toEqual({skill: 'default', warnings: []});
  });

  it('explainer only -> explainer; faceless only -> faceless', () => {
    expect(resolvePolishSkill({faceless: false, explainer: true})).toEqual({skill: 'explainer', warnings: []});
    expect(resolvePolishSkill({faceless: true, explainer: false})).toEqual({skill: 'faceless', warnings: []});
  });

  it('both on -> FACELESS WINS and the explainer is skipped with a warning', () => {
    expect(resolvePolishSkill({faceless: true, explainer: true})).toEqual({skill: 'faceless', warnings: ['polish_pace:explainer_skipped:faceless_wins']});
  });

  it('POLISH_EXPLAINER_SKILL defaults OFF (and so does the faceless lane)', () => {
    expect(env.POLISH_EXPLAINER_SKILL).toBe(false);
    expect(env.POLISH_FACELESS_DOC).toBe(false);
    expect(read('../../config/env.ts')).toMatch(/POLISH_EXPLAINER_SKILL: bool\(false\)/);
    expect(read('../../../../.env.example')).toMatch(/# POLISH_EXPLAINER_SKILL=0/);
  });

  it('analyze: the explainer block is behind the flag and the Skill A path is unchanged', () => {
    const code = stripComments(read('../../pipeline/analyzeVideo.ts'));
    expect(code).toContain('resolvePolishSkill({');
    expect(code).toContain('flags.explainerSkill');
    expect(code).toContain('flags.newsroomMg');
    expect(code).toMatch(/if \(polishSkill\.skill === 'explainer'\) \{\s*const pacing = planExplainerPacing\(/);
    // Skill A: the exact WP36 gate + the single lane call are still there; the explainer never feeds them
    expect(code).toContain('const facelessDoc = Boolean(polishPath && flags.facelessDoc && voGrammar && motion && stockConfigured());');
    expect(code.match(/planFacelessDocLane\(/g)).toHaveLength(1);
    expect(code).toContain('!facelessDoc && flags.editorialStills');
  });

  it('the pacing module is pure (no env, no I/O, no model)', () => {
    const code = stripComments(read('./explainerPacing.ts'));
    expect(code).not.toMatch(/from 'node:|process\.env|fetch\(|Math\.random|Date\.now|import .*config\/env/);
  });
});

describe('WP40 offline proof', () => {
  const root = '../../../../remotion/';
  it('has the entry, the script and the npm script', () => {
    const entry = read(`${root}scripts/wp40/entry.tsx`);
    expect(entry).toContain('ExplainerLayoutFrame');
    expect(entry).toContain('EXPLAINER_CAPTION_Y_PCT');
    expect(entry).toContain('EXPLAINER_CHIP_STAGGER_SEC');
    const script = read(`${root}scripts/wp40-preview.mjs`);
    expect(script).toContain('planExplainerPacing');
    expect(script).toContain('wp40-explainer-layouts.mp4');
    expect(script).not.toMatch(/wp36-faceless-doc\.mp4|wp36-plan\.json/); // Skill A proof is never rewritten
    expect(JSON.parse(read(`${root}package.json`)).scripts['preview:wp40']).toBe('node scripts/wp40-preview.mjs');
    const frames = read(`${root}src/components/ExplainerLayouts.tsx`);
    for (const name of ['ExplainerLayoutA', 'ExplainerLayoutB', 'ExplainerLayoutC', 'ExplainerLayoutD', 'DotGridGround']) expect(frames).toContain(`export const ${name}`);
  });

  const measuredPath = new URL(`${root}out/phase36-readiness/wp40-measured.json`, import.meta.url);
  it.skipIf(!existsSync(measuredPath))('the measured MP4 shows all four layouts, a white dotted C, a dark D, a split B and every cut', () => {
    const measured = JSON.parse(readFileSync(measuredPath, 'utf8'));
    expect(measured.video.durationSec).toBeGreaterThanOrEqual(15);
    expect(measured.video.durationSec).toBeLessThanOrEqual(25);
    expect(measured.checks).toEqual({allFourLayouts: true, cWhiteGround: true, cDotsVisible: true, dDarkerThanA: true, bTopBottomDiffer: true});
    expect(measured.cutsVerifiedOnFile).toBe(measured.cutsPlanned);
    const c = measured.segments.find((row: {layout: string}) => row.layout === 'explainer_c');
    expect(c.gridMargin.yAvg).toBeGreaterThanOrEqual(235);
    expect(c.gridMargin.yMin).toBeLessThanOrEqual(225);
  });
});
