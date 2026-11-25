import {describe, expect, it} from 'vitest';

import {
  brollOpportunitiesToSlots,
  buildBrollOpportunityPrompt,
  detectBrollOpportunities,
  selectBrollOpportunities,
  slotKindFor,
  type BrollWord,
} from './brollOpportunities.ts';
import {buildLabeledAssetBrief} from './labeledAssetBrief.ts';

/** words at 0.4 s spacing, uneven on purpose after index 20 (timestamps must come from the words, never a uniform guess) */
const text = 'This person gave us a completely different way to think. Steve Jobs introduced the first iPhone in 2007 on stage. Amazon started as an online bookstore but today it runs the biggest cloud. I honestly cried when I saw it. Follow for more.';
const words: BrollWord[] = text.split(' ').map((t, i) => {
  const start = i < 20 ? i * 0.4 : 8 + (i - 20) * 0.55;
  return {text: t, start: Math.round(start * 100) / 100, end: Math.round((start + 0.35) * 100) / 100};
});
const idx = (w: string, from = 0) => words.findIndex((x, i) => i >= from && x.text.replace(/[^\w]/g, '') === w);
const DURATION = words[words.length - 1]!.end + 0.5;

const opp = (over: Record<string, unknown>) => ({
  start_word: idx('Steve'),
  end_word: idx('iPhone'),
  category: 'people',
  detected_entity: 'Steve Jobs',
  visual_type: 'ENTITY_IMAGE',
  visual_description: 'Steve Jobs on stage at the 2007 iPhone launch',
  upload_label: 'Steve Jobs at 2007 iPhone launch',
  priority: 'high',
  visual_confidence: 0.9,
  reason_for_insertion: 'Recognisable person introduced',
  recommended_duration: 2,
  screen_occupancy: 'full',
  speaker_visibility: 'hidden',
  continuity_group: null,
  talking_head_moment: false,
  ...over,
});

describe('B-roll opportunities: selection', () => {
  it('takes timestamps from the real words and clamps duration to the treatment range', () => {
    const {kept} = selectBrollOpportunities({opportunities: [opp({recommended_duration: 9})]}, words, DURATION);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.timestamp_start).toBe(words[idx('Steve')]!.start);
    expect(kept[0]!.timestamp_end - kept[0]!.timestamp_start).toBeCloseTo(2.5, 2); // people: 1-2.5 s
    expect(kept[0]!.spoken).toMatch(/^Steve Jobs introduced the first iPhone/);
  });

  it('an empty answer is a confident "no B-roll"', () => {
    expect(selectBrollOpportunities({opportunities: []}, words, DURATION).kept).toEqual([]);
  });

  it('drops talking-head moments, low confidence, bad ranges, the opening face and unknown treatments', () => {
    const {kept, dropped} = selectBrollOpportunities({
      opportunities: [
        opp({start_word: idx('cried'), end_word: idx('it', idx('cried')), detected_entity: 'tears', talking_head_moment: true}),
        opp({detected_entity: 'weak', visual_confidence: 0.3}),
        opp({start_word: 999, end_word: 1000, detected_entity: 'oob'}),
        opp({start_word: 0, end_word: 2, detected_entity: 'opening'}),
        opp({detected_entity: 'odd', visual_type: 'HOLOGRAM'}),
      ],
    }, words, DURATION);
    expect(kept).toEqual([]);
    expect(dropped.join(' ')).toMatch(/talking_head_moment/);
    expect(dropped.join(' ')).toMatch(/confidence/);
    expect(dropped.join(' ')).toMatch(/word_range/);
    expect(dropped.join(' ')).toMatch(/opening_face/);
    expect(dropped.join(' ')).toMatch(/visual_type/);
  });

  it('never repeats an entity, keeps moments apart, and keeps the stronger one', () => {
    const {kept, dropped} = selectBrollOpportunities({
      opportunities: [
        opp({priority: 'medium', visual_confidence: 0.7}),
        opp({start_word: idx('iPhone'), end_word: idx('stage.'), detected_entity: 'Steve Jobs', priority: 'low'}), // repeat
        opp({start_word: idx('first'), end_word: idx('2007'), category: 'product_object', detected_entity: 'original iPhone', visual_type: 'PRODUCT_VISUAL', priority: 'high'}), // overlaps the first
        opp({start_word: idx('today'), end_word: idx('today') + 4, category: 'organization', detected_entity: 'Amazon', visual_type: 'SCREEN_VISUAL', continuity_group: 'amazon-story'}),
      ],
    }, words, DURATION);
    expect(kept.map(k => k.detected_entity)).toEqual(['original iPhone', 'Amazon']);
    expect(dropped.join(' ')).toMatch(/repeat_entity|overlap|too_close/);
  });

  it('shots of one continuity group may sit back to back (a transformation sequence)', () => {
    const a = idx('Amazon');
    const b = idx('today');
    const {kept} = selectBrollOpportunities({
      opportunities: [
        opp({start_word: a, end_word: a + 4, category: 'time_transformation', detected_entity: 'early Amazon website', visual_type: 'SCREEN_VISUAL', continuity_group: 'amazon', recommended_duration: 2}),
        opp({start_word: b, end_word: b + 5, category: 'time_transformation', detected_entity: 'cloud data centre', visual_type: 'CONTEXTUAL_FOOTAGE', continuity_group: 'amazon', recommended_duration: 2}),
      ],
    }, words, DURATION, {minGapSec: 10});
    expect(kept.map(k => k.detected_entity)).toEqual(['early Amazon website', 'cloud data centre']);
  });

  it('caps count and total screen time', () => {
    const many = Array.from({length: 8}, (_, k) => opp({start_word: 4 + k * 4, end_word: 5 + k * 4, detected_entity: `thing ${k}`, category: 'process_action', visual_type: 'CONTEXTUAL_FOOTAGE', recommended_duration: 3}));
    const {kept} = selectBrollOpportunities({opportunities: many}, words, DURATION, {minGapSec: 0});
    expect(kept.length).toBeLessThanOrEqual(Math.min(6, Math.round(DURATION / 7)));
    expect(kept.reduce((s, k) => s + k.timestamp_end - k.timestamp_start, 0)).toBeLessThanOrEqual(0.35 * DURATION + 1e-9);
  });
});

describe('B-roll opportunities: asks', () => {
  it('maps treatments to upload kinds; diagrams / metaphors / kinetic type are engine-owned (no ask)', () => {
    expect(slotKindFor({visual_type: 'ENTITY_IMAGE', category: 'people'})?.kind).toBe('person');
    expect(slotKindFor({visual_type: 'ENTITY_IMAGE', category: 'organization'})?.kind).toBe('logo');
    expect(slotKindFor({visual_type: 'SCREEN_VISUAL', category: 'screen_document'})?.kind).toBe('screenshot');
    expect(slotKindFor({visual_type: 'PRODUCT_VISUAL', category: 'product_object'})?.kind).toBe('product');
    expect(slotKindFor({visual_type: 'CONTEXTUAL_FOOTAGE', category: 'process_action'})?.kind).toBe('broll_clip');
    for (const v of ['INFOGRAPHIC', 'KINETIC_TYPOGRAPHY', 'CONCEPTUAL_VISUAL'] as const) expect(slotKindFor({visual_type: v, category: 'abstract_concept'})).toBeNull();
  });

  it('slots carry the upload label, the real window and the opportunity id, and replace the keyword asks', () => {
    const {kept} = selectBrollOpportunities({opportunities: [opp({}), opp({start_word: idx('Amazon'), end_word: idx('Amazon') + 3, detected_entity: 'supply vs demand', category: 'abstract_concept', visual_type: 'INFOGRAPHIC'})]}, words, DURATION);
    const slots = brollOpportunitiesToSlots(kept);
    expect(slots).toHaveLength(1);
    expect(slots[0]).toEqual(expect.objectContaining({kind: 'person', label: 'Steve Jobs at 2007 iPhone launch', startSec: kept[0]!.timestamp_start, endSec: kept[0]!.timestamp_end, opportunityId: kept[0]!.id, required: false}));
    const brief = buildLabeledAssetBrief({words, outputDurationSec: DURATION, kinetic: true, aiSlots: slots});
    expect(brief.slots.map(s => s.id)).toEqual(['asset_ai_1']);
    expect(brief.slots[0]!.status).toBe('needed');
    // "no strong moment": an empty AI answer means no asks at all, not the keyword fallback
    expect(buildLabeledAssetBrief({words, outputDurationSec: DURATION, kinetic: true, aiSlots: []}).slots).toEqual([]);
  });
});

describe('B-roll opportunities: detection', () => {
  it('the prompt indexes every word with sentence start times', () => {
    const p = buildBrollOpportunityPrompt(words, DURATION);
    expect(p).toContain(`${idx('Steve')}:Steve`);
    expect(p).toMatch(/\[\d+\.\ds\] /);
  });

  it('a configured call returns kept moments, asks and diagnostics', async () => {
    const call = async () => '```json\n' + JSON.stringify({opportunities: [opp({})]}) + '\n```';
    const r = await detectBrollOpportunities({words, durationSec: DURATION, call});
    expect(r.source).toBe('ai');
    if (r.source !== 'ai') return;
    expect(r.slots).toHaveLength(1);
    expect(r.warnings[0]).toBe('broll_opportunities:ai:kept=1,asked=1,dropped=0');
  });

  it('no call, a throwing call or bad JSON is "unavailable" (the caller keeps the keyword asks)', async () => {
    expect((await detectBrollOpportunities({words, durationSec: DURATION, call: null})).source).toBe('unavailable');
    expect((await detectBrollOpportunities({words, durationSec: DURATION, call: async () => { throw new Error('gemini_budget'); }})).source).toBe('unavailable');
    expect((await detectBrollOpportunities({words, durationSec: DURATION, call: async () => 'not json'})).source).toBe('unavailable');
  });
});
