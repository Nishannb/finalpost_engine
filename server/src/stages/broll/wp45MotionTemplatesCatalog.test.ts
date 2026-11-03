/**
 * WP45–51 catalog pins: Layer-2 motion-template catalog + skill allowlists + sparse planner.
 * Comps/library/timelines for CLIP_22–26 = Claude WP51 implementation.
 */
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

import {
  MOTION_TEMPLATE_CATALOG as ALL_MOTION_TEMPLATE_CATALOG,
  MOTION_TEMPLATE_IDS as ALL_MOTION_TEMPLATE_IDS,
  MOTION_TEMPLATE_PRIMITIVES,
  SKILL_MOTION_TEMPLATE_ALLOWLIST as ALL_SKILL_MOTION_TEMPLATE_ALLOWLIST,
  planMotionTemplateBeats,
  templateForIntent,
  templatesAllowedFor,
} from './motionTemplateCatalog.ts';

// WP53: clip_27..34 are VISUAL-BACKEND rows (riso / collage / anidoodle), pinned in wp53VisualBackends.test.ts. These WP45–51 pins cover the 26 native Remotion templates only.
const isNative = (id: string) => !/^clip_(2[7-9]|3\d|4\d|5\d)_/.test(id); // WP54: clip_35..44 are pinned in wp54CraftAndTemplates.test.ts
const MOTION_TEMPLATE_CATALOG = ALL_MOTION_TEMPLATE_CATALOG.filter(row => !row.backend && !row.lane);
const MOTION_TEMPLATE_IDS = ALL_MOTION_TEMPLATE_IDS.filter(isNative);
const SKILL_MOTION_TEMPLATE_ALLOWLIST = Object.fromEntries(Object.entries(ALL_SKILL_MOTION_TEMPLATE_ALLOWLIST).map(([skill, ids]) => [skill, ids.filter(isNative)])) as typeof ALL_SKILL_MOTION_TEMPLATE_ALLOWLIST;

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

describe('WP45–51 motion-template catalog', () => {
  it('lists 70 primitives (48 + 11 WP54 + 10 WP55 + 1 text match cut) and 26 templates with Remotion composition ids', () => {
    expect(MOTION_TEMPLATE_PRIMITIVES).toHaveLength(70);
    expect(MOTION_TEMPLATE_IDS).toHaveLength(26);
    expect(MOTION_TEMPLATE_IDS.slice(21)).toEqual([
      'clip_22_chat_conversation',
      'clip_23_sale_promo',
      'clip_24_color_word_wheel',
      'clip_25_tracking_collapse',
      'clip_26_spatial_blur_tilt',
    ]);
    expect(MOTION_TEMPLATE_CATALOG.map(t => t.compositionId).slice(21)).toEqual([
      'ChatConversationBubbles',
      'SalePromoCountdown',
      'ColorWordWheel',
      'TrackingCollapseHeadline',
      'SpatialBlurTiltReveal',
    ]);
  });

  it('clip_07 is the only overlay; WP51 Batch B templates own the frame', () => {
    const notify = MOTION_TEMPLATE_CATALOG.find(t => t.id === 'clip_07_ios_notification')!;
    expect(notify.ownsFrame).toBe(false);
    expect(notify.placement).toBe('overlay');
    for (const id of [
      'clip_22_chat_conversation',
      'clip_23_sale_promo',
      'clip_24_color_word_wheel',
      'clip_25_tracking_collapse',
      'clip_26_spatial_blur_tilt',
    ] as const) {
      const row = MOTION_TEMPLATE_CATALOG.find(t => t.id === id)!;
      expect(row.ownsFrame, id).toBe(true);
    }
  });

  it('skill allowlists gate templates (explainer never gets stacked cards; WP51 Batch B lands on the right skills)', () => {
    expect(SKILL_MOTION_TEMPLATE_ALLOWLIST.explainer).not.toContain('clip_04_stacked_cards');
    expect(SKILL_MOTION_TEMPLATE_ALLOWLIST.explainer).toEqual(
      expect.arrayContaining(['clip_22_chat_conversation', 'clip_24_color_word_wheel', 'clip_26_spatial_blur_tilt']),
    );
    expect(SKILL_MOTION_TEMPLATE_ALLOWLIST.textual_mg).toEqual(
      expect.arrayContaining(['clip_22_chat_conversation', 'clip_25_tracking_collapse']),
    );
    expect(SKILL_MOTION_TEMPLATE_ALLOWLIST.faceless).toEqual(expect.arrayContaining(['clip_23_sale_promo']));
    expect(SKILL_MOTION_TEMPLATE_ALLOWLIST.newsroom_mg).toEqual(expect.arrayContaining(['clip_23_sale_promo', 'clip_25_tracking_collapse']));
    expect(templatesAllowedFor('explainer').every(t => t.id !== 'clip_04_stacked_cards')).toBe(true);
    expect(templateForIntent('newsroom_mg', 'document_wall')?.id).toBe('clip_03_bento_camera');
  });

  it('planner is sparse, mute-aware, and skill-gated', () => {
    const words = [
      {text: 'Here', start: 0.2, end: 0.4},
      {text: 'is', start: 0.4, end: 0.5},
      {text: 'the', start: 0.5, end: 0.6},
      {text: 'product', start: 0.6, end: 0.9},
      {text: 'launch', start: 0.9, end: 1.2},
    ];
    const plan = planMotionTemplateBeats({skill: 'explainer', durationSec: 40, words});
    expect(plan.beats.length).toBeGreaterThanOrEqual(0);
    expect(plan.beats.length).toBeLessThanOrEqual(3);
    for (const beat of plan.beats) {
      expect(SKILL_MOTION_TEMPLATE_ALLOWLIST.explainer).toContain(beat.templateId);
      if (beat.muteCaptions) {
        expect(plan.captionMuteRanges.some(r => r.start === beat.start && r.end === beat.end)).toBe(true);
      }
    }
  });

  it('grammar yaml exists and mentions Batch B / WP51 clip ids', () => {
    const yaml = readFileSync(join(root, 'remotion/out/phase36-readiness/motion-template-primitives.yaml'), 'utf8');
    expect(yaml).toMatch(/clip_22_chat_conversation/);
    expect(yaml).toMatch(/clip_26_spatial_blur_tilt/);
    expect(yaml).toMatch(/blur_rotate_in/);
    expect(yaml).toMatch(/typing_indicator/);
  });
});
