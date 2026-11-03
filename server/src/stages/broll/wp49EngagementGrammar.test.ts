/**
 * WP49: polish engagement grammar — VO↔graphic sync lead, edit-palette discipline, stillness frame_insets, split expand math.
 * Offline: no network, no Chromium.
 */
import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import {CLAIM_BEAT_LEAD_SEC} from './explainerClaims.ts';
import {
  MOTION_TEMPLATE_SYNC_LEAD_SEC,
  planMotionTemplateBeats,
} from './motionTemplateCatalog.ts';
import {bindMotionTemplateContent} from './motionTemplateBind.ts';
import {
  STILLNESS_INSET_HOLD_SEC,
  STILLNESS_TRIGGER_SEC,
  openSpans,
  planStillnessFrameInsets,
} from './stillnessFrameInsets.ts';
import {
  EXPLAINER_SPLIT_EXPAND_SEC,
  EXPLAINER_SPLIT_RATIO,
  explainerSplitExpandAt,
} from '../../../../remotion/src/lib/explainerLayouts.ts';

const repo = join(import.meta.dirname, '../../../..');
const words = (cueAt: number) =>
  [
    {text: 'heritage', start: cueAt, end: cueAt + 0.3},
    {text: 'and', start: cueAt + 0.35, end: cueAt + 0.5},
    {text: 'devotion', start: cueAt + 0.55, end: cueAt + 0.85},
    {text: 'meets', start: cueAt + 0.9, end: cueAt + 1.1},
    {text: 'elegance', start: cueAt + 1.15, end: cueAt + 1.5},
    {text: 'from', start: cueAt + 1.55, end: cueAt + 1.7},
    {text: 'Lumen', start: cueAt + 1.75, end: cueAt + 2.05},
    {text: 'studio', start: cueAt + 2.1, end: cueAt + 2.4},
  ];

describe('WP49 sync lead', () => {
  it('motion-template beats open MOTION_TEMPLATE_SYNC_LEAD_SEC before the triggering word', () => {
    expect(MOTION_TEMPLATE_SYNC_LEAD_SEC).toBe(0.35);
    expect(CLAIM_BEAT_LEAD_SEC).toBe(0.35);
    const cueAt = 12;
    const plan = planMotionTemplateBeats({skill: 'explainer', durationSec: 40, words: words(cueAt)});
    expect(plan.beats.length).toBeGreaterThan(0);
    const heritage = plan.beats.find(b => b.templateId === 'clip_13_heritage_poster' || b.intent === 'heritage_poster');
    const first = heritage ?? plan.beats[0]!;
    // graphic must start before the cue word (lead), never after it
    expect(first.start).toBeLessThanOrEqual(cueAt + 1e-6);
    expect(first.start).toBeGreaterThanOrEqual(cueAt - MOTION_TEMPLATE_SYNC_LEAD_SEC - 1e-6);
  });
});

describe('WP49 edit-palette discipline', () => {
  it('bound content carries accent / ground / ink from the edit palette (never ACME shell hex alone)', () => {
    const bound = bindMotionTemplateContent({
      templateId: 'clip_13_heritage_poster',
      words: words(1),
      beatStart: 0.5,
      beatEnd: 6,
      accent: '#BFFF00',
      ground: '#0A0A0A',
      ink: '#FFFFFF',
    });
    expect(bound).not.toBeNull();
    expect(bound!.accent).toBe('#BFFF00');
    expect(bound!.ground).toBe('#0A0A0A');
    expect(bound!.ink).toBe('#FFFFFF');
    expect(bound!.hideMicro).toBe(true);
    expect(JSON.stringify(bound)).not.toMatch(/acme|paris|mango/i);
  });
});

describe('WP49 stillness frame_insets', () => {
  it('plans insets after STILLNESS_TRIGGER_SEC of open picture and never overlaps blocked spans', () => {
    expect(STILLNESS_TRIGGER_SEC).toBe(3.2);
    expect(STILLNESS_INSET_HOLD_SEC).toBe(5.5);
    const blocked = [{start: 10, end: 16}];
    expect(openSpans(30, blocked)).toEqual([
      {start: 0, end: 10},
      {start: 16, end: 30},
    ]);
    // span 0–10 fits trigger+hold once; second span may be skipped by minGap — never overlaps blocked
    const {insets, warnings} = planStillnessFrameInsets({
      durationSec: 30,
      blockedRanges: blocked,
      marginColor: '#0A0A0A',
    });
    expect(warnings.some(w => w.startsWith('polish_stillness_insets:planned:'))).toBe(true);
    expect(insets.length).toBeGreaterThan(0);
    expect(insets.length).toBeLessThanOrEqual(2);
    for (const inset of insets) {
      expect(inset.end - inset.start).toBeGreaterThanOrEqual(STILLNESS_INSET_HOLD_SEC * 0.85);
      expect(inset.scale).toBe(0.86);
      expect(inset.marginColor).toBe('#0A0A0A');
      expect(blocked.some(b => b.start < inset.end && b.end > inset.start)).toBe(false);
    }
    expect(insets[0]!.start).toBeGreaterThanOrEqual(STILLNESS_TRIGGER_SEC - 1e-6);
  });

  it('short clips and fully blocked timelines place nothing', () => {
    expect(planStillnessFrameInsets({durationSec: 2}).insets).toEqual([]);
    expect(planStillnessFrameInsets({durationSec: 40, blockedRanges: [{start: 0, end: 40}]}).insets).toEqual([]);
  });
});

describe('WP49 split → full expand', () => {
  it('B→A expands the speaker up (seam 0.5→0); A→B collapses from full speaker into the split', () => {
    expect(EXPLAINER_SPLIT_EXPAND_SEC).toBe(0.4);
    const track = [
      {start: 0, end: 4, layout: 'explainer_b' as const},
      {start: 4, end: 10, layout: 'explainer_a' as const},
    ];
    const fps = 30;
    const atB = explainerSplitExpandAt(track, Math.round(2 * fps), fps)!;
    expect(atB.drawSplit).toBe(true);
    expect(atB.seam).toBeCloseTo(EXPLAINER_SPLIT_RATIO, 5);

    const midExpand = explainerSplitExpandAt(track, Math.round(4.2 * fps), fps)!;
    expect(midExpand.drawSplit).toBe(true);
    expect(midExpand.expand).toBe('up');
    expect(midExpand.seam).toBeLessThan(EXPLAINER_SPLIT_RATIO);
    expect(midExpand.seam).toBeGreaterThan(0);

    const after = explainerSplitExpandAt(track, Math.round(5 * fps), fps)!;
    expect(after.drawSplit).toBe(false);
    expect(after.targetLayout).toBe('explainer_a');

    const enterB = [
      {start: 0, end: 3, layout: 'explainer_a' as const},
      {start: 3, end: 8, layout: 'explainer_b' as const},
    ];
    const midEnter = explainerSplitExpandAt(enterB, Math.round(3.15 * fps), fps)!;
    expect(midEnter.drawSplit).toBe(true);
    expect(midEnter.seam).toBeGreaterThan(0);
    expect(midEnter.seam).toBeLessThan(EXPLAINER_SPLIT_RATIO);
  });

  it('B→C expands the top pane down', () => {
    const track = [
      {start: 0, end: 3, layout: 'explainer_b' as const},
      {start: 3, end: 7, layout: 'explainer_c' as const},
    ];
    const mid = explainerSplitExpandAt(track, Math.round(3.15 * 30), 30)!;
    expect(mid.expand).toBe('down');
    expect(mid.seam).toBeGreaterThan(EXPLAINER_SPLIT_RATIO);
  });
});

describe('WP49 analyze wiring pins', () => {
  it('analyzeVideo passes palette ground/ink into motion templates and plans stillness insets on polish', () => {
    const analyze = readFileSync(join(repo, 'server/src/pipeline/analyzeVideo.ts'), 'utf8');
    expect(analyze).toMatch(/ground: editPalette\?\.ground/);
    expect(analyze).toMatch(/ink: paletteInk/);
    expect(analyze).toMatch(/planStillnessFrameInsets/);
    expect(analyze).toMatch(/stillness\.warnings/);
  });
});
