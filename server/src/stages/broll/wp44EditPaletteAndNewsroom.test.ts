/**
 * WP44: content-aware edit palette + Skill D newsroom MG pacing (offline).
 */
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

import {EDIT_PALETTES, pickEditPalette} from './editPalette.ts';
import {EDIT_PALETTES as REMOTION_PALETTES, pickEditPalette as remotionPick} from '../../../../remotion/src/lib/editPalette.ts';
import {resolvePolishSkill} from './explainerPacing.ts';
import {NEWSROOM_LAYOUT_IDS, planNewsroomMgPacing} from './newsroomMgPacing.ts';
import {env} from '../../config/env.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

describe('WP44 edit palette', () => {
  it('WP56: Skill B / explainer preferred is editorial paper; finance/news can override to signal red; lime still forceable', () => {
    const preferred = pickEditPalette({skill: 'explainer', forcePreferred: true});
    expect(preferred.id).toBe('editorial_paper');
    expect(preferred.groundStyle).toBe('paper_dot');
    expect(preferred.ground.toLowerCase()).toMatch(/^#f/);

    // Lime remains in catalog for Skill B proofs / LimeHighlightWipe (not the live polish default).
    expect(EDIT_PALETTES.some(p => p.id === 'edu_lime_paper' && p.accent === '#BFFF00')).toBe(true);

    const news = pickEditPalette({
      skill: 'explainer',
      words: 'capital controls hit the yuan and dollar reserves at the bank'.split(' ').map(text => ({text})),
    });
    expect(news.id).toBe('newsroom_red_ink');
    expect(news.accent).toBe('#E00000');
  });

  it('Skill D preferred is newsroom red; SaaS-only copy can flip to lime', () => {
    const preferred = pickEditPalette({skill: 'newsroom_mg', forcePreferred: true});
    expect(preferred.id).toBe('newsroom_red_ink');
    const saas = pickEditPalette({
      skill: 'newsroom_mg',
      words: 'our saas api launch for developers'.split(' ').map(text => ({text})),
    });
    expect(saas.id).toBe('edu_lime_paper');
  });

  it('server and remotion catalogs stay in parity', () => {
    expect(EDIT_PALETTES.map(p => p.id)).toEqual(REMOTION_PALETTES.map(p => p.id));
    expect(pickEditPalette({skill: 'explainer', forcePreferred: true}).accent).toBe(
      remotionPick({skill: 'explainer', forcePreferred: true}).accent,
    );
  });

  it('never invents a hex outside the catalog', () => {
    for (const skill of ['explainer', 'newsroom_mg', 'faceless', 'textual_mg', 'default'] as const) {
      const p = pickEditPalette({skill, words: [{text: 'hello'}]});
      expect(EDIT_PALETTES.some(row => row.id === p.id)).toBe(true);
    }
  });
});

describe('WP44 Skill D newsroom pacing', () => {
  it('plans GFX-heavy timeline with sparse host and hard-cut tiling', () => {
    const plan = planNewsroomMgPacing({durationSec: 60});
    expect(plan.segments[0]!.layout).toBe('newsroom_gfx');
    expect(plan.segments[0]!.role).toBe('hook_chart');
    expect(plan.segments.at(-1)!.role).toBe('recap');
    for (let i = 1; i < plan.segments.length; i++) {
      expect(plan.segments[i]!.start).toBe(plan.segments[i - 1]!.end);
    }
    expect(plan.stats.hostShare).toBeGreaterThan(0.05);
    expect(plan.stats.hostShare).toBeLessThan(0.35);
    expect(plan.warnings.some(w => w.startsWith('polish_pace:newsroom_cuts:'))).toBe(true);
    for (const s of plan.segments) expect(NEWSROOM_LAYOUT_IDS).toContain(s.layout);
  });

  it('resolvePolishSkill priority: faceless > newsroom > explainer', () => {
    expect(resolvePolishSkill({faceless: true, explainer: true, newsroom: true}).skill).toBe('faceless');
    expect(resolvePolishSkill({faceless: false, explainer: true, newsroom: true}).skill).toBe('newsroom_mg');
    expect(resolvePolishSkill({faceless: false, explainer: true, newsroom: true}).warnings).toContain(
      'polish_pace:explainer_skipped:newsroom_wins',
    );
    expect(resolvePolishSkill({faceless: false, explainer: true, newsroom: false}).skill).toBe('explainer');
  });

  it('flag default off; grammar + editref name Skill D', () => {
    expect(env.POLISH_NEWSROOM_MG).toBe(false);
    const yaml = readFileSync(join(root, 'remotion/out/phase36-readiness/newsroom-mg-grammar.yaml'), 'utf8');
    expect(yaml).toMatch(/newsroom_mg_explainer/);
    expect(yaml).toMatch(/#E00000/);
    const editref = readFileSync(join(root, 'editref.md'), 'utf8');
    expect(editref).toMatch(/Skill D/);
    expect(editref).toMatch(/POLISH_NEWSROOM_MG/);
  });

  it('analyze wires palette + newsroom behind flags', () => {
    const analyze = readFileSync(join(root, 'server/src/pipeline/analyzeVideo.ts'), 'utf8');
    expect(analyze).toMatch(/directEditColors\(\{skill: 'explainer'/);
    expect(analyze).toMatch(/directEditColors\(\{skill: 'newsroom_mg'/);
    expect(analyze).toMatch(/planNewsroomMgPacing/);
    expect(analyze).toMatch(/POLISH_NEWSROOM_MG/);
    expect(analyze).toMatch(/editPalette:/);
  });

  it('ShortVideo / LimeHighlightWipe accept palette accent', () => {
    const short = readFileSync(join(root, 'remotion/src/ShortVideo.tsx'), 'utf8');
    expect(short).toMatch(/editPalette/);
    expect(short).toMatch(/accentColor=\{explainerAccent\}/);
    const wipe = readFileSync(join(root, 'remotion/src/components/LimeHighlightWipe.tsx'), 'utf8');
    expect(wipe).toMatch(/color\?:/);
  });
});
