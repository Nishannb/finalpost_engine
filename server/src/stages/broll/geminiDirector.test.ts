import {describe, expect, it} from 'vitest';

import {captionsOnlyVisualPlan} from './brollPlanner.ts';
import {
  defaultCaptionDirection,
  extractJson,
  fallbackVisualDirection,
  oneLineHook,
  overlayTextIsFactual,
  parseVisualDirectorJson,
  shineCaptionDirection,
} from './geminiDirector.ts';
import {keywordFallbacks} from './pexelsClient.ts';

describe('extractJson', () => {
  it('parses fenced JSON objects', () => {
    const parsed = extractJson('```json\n{"hook_title":"WAIT","moments":[]}\n```');
    expect(parsed).toEqual({hook_title: 'WAIT', moments: []});
  });

  it('tolerates trailing commas', () => {
    const parsed = extractJson('{"hook_title":"WAIT","moments":[],}');
    expect(parsed).toEqual({hook_title: 'WAIT', moments: []});
  });
});

describe('parseVisualDirectorJson', () => {
  it('reads an object brief with mixed layouts', () => {
    const parsed = parseVisualDirectorJson(
      JSON.stringify({
        hook_title: 'Turn dreams into reality',
        hook_subtitle: 'stop waiting for permission to live big',
        moments: [
          {
            timestamp: 8,
            search_keyword: 'coffee pour',
            media: 'video',
            layout: 'cutaway',
            overlay_text: '',
          },
          {
            timestamp: 16,
            search_keyword: 'skincare bottle',
            media: 'image',
            layout: 'composite',
            overlay_text: 'Glow kit',
          },
        ],
      }),
      40,
      'Turn dreams into reality. This glow kit changed everything.',
    );
    expect(parsed.hookTitle).toBe('Turn dreams into reality');
    expect(parsed.hookSubtitle).toBe('');
    expect(parsed.moments.some(moment => moment.layout === 'cutaway')).toBe(true);
    expect(parsed.moments.some(moment => moment.layout === 'composite' || moment.layout === 'card')).toBe(true);
    expect(parsed.hookStyle).toBeTruthy();
  });

  it('reads depth_overlays without turning them into B-roll moments', () => {
    const parsed = parseVisualDirectorJson(
      JSON.stringify({
        hook_title: 'This bottle',
        moments: [
          {
            timestamp: 8,
            search_keyword: 'coffee pour',
            media: 'video',
            layout: 'cutaway',
          },
        ],
        depth_overlays: [
          {
            asset_id: 'ub_1',
            start: 12,
            end: 15,
            direction: 'up',
            reason: 'show the product while she names it',
          },
        ],
      }),
      40,
      'This bottle changed my mornings.',
    );
    expect(parsed.moments.some(moment => moment.layout === 'cutaway')).toBe(true);
    expect(parsed.depthOverlays).toHaveLength(1);
    expect(parsed.depthOverlays[0]?.assetId).toBe('ub_1');
    expect(parsed.depthOverlays[0]?.direction).toBe('up');
    expect(parsed.depthOverlays[0]?.reason).toMatch(/product/);
  });

  it('parses inset_reveal decisions separately from B-roll', () => {
    const parsed = parseVisualDirectorJson(
      JSON.stringify({
        hook_title: 'The number that matters',
        moments: [
          {
            timestamp: 6,
            search_keyword: 'busy city street',
            media: 'video',
            layout: 'cutaway',
          },
        ],
        inset_reveals: [
          {
            start: 12,
            end: 16,
            variant: 'motion_graphic',
            background: {type: 'solid', value: '#111827'},
            graphic: {template_id: 'stat_callout', text: '50 billion'},
            captions: true,
            reason: 'the spoken stat is the focus',
          },
        ],
      }),
      40,
      'We hit 50 billion views this year.',
    );
    expect(parsed.moments.some(moment => moment.layout === 'cutaway')).toBe(true);
    expect(parsed.insetReveals).toHaveLength(1);
    expect(parsed.insetReveals[0]?.variant).toBe('motion_graphic');
    expect(parsed.insetReveals[0]?.graphic?.templateId).toBe('stat_callout');
    expect(parsed.insetReveals[0]?.reason).toMatch(/stat/);
  });

  it('keeps a document still as a designed card with focus region', () => {
    const parsed = parseVisualDirectorJson(
      JSON.stringify({
        hook_title: 'Read the sentence',
        moments: [
          {
            timestamp: 8,
            search_keyword: 'medical article screenshot',
            media: 'image',
            layout: 'card',
            treatment: 'focus',
            user_broll_id: 'ub_1',
            focus_region: {x: 0.1, y: 0.3, w: 0.8, h: 0.12, label: 'rapid dissolution'},
          },
        ],
      }),
      30,
      'Rhabdomyolysis is the rapid dissolution of damaged skeletal muscle.',
    );
    expect(parsed.moments.some(moment => moment.layout === 'card')).toBe(true);
    const card = parsed.moments.find(moment => moment.layout === 'card');
    expect(card?.treatment).toBe('focus');
    expect(card?.focusRegion?.label).toMatch(/dissolution/);
  });

  it('drops a single generic noun search such as app', () => {
    const parsed = parseVisualDirectorJson(
      JSON.stringify({
        hook_title: 'See the world',
        topic: 'ambitious women traveling with a passport',
        moments: [
          {
            timestamp: 8,
            search_keyword: 'app',
            media: 'image',
            layout: 'pip',
          },
          {
            timestamp: 16,
            search_keyword: 'airplane window clouds',
            media: 'video',
            layout: 'cutaway',
          },
        ],
      }),
      40,
      'I want ambitious women to see the world with a passport in hand.',
    );
    expect(parsed.moments.map(moment => moment.searchKeyword)).toContain(
      'airplane window clouds',
    );
    expect(parsed.caption.template).toBeTruthy();
    expect(parsed.caption.animation).not.toBe('highlight');
  });

  it('defaults captions to the lower third with a spoken-word highlight', () => {
    const caption = defaultCaptionDirection('Buy now and shop the glow kit');
    expect(caption.position).toBe('bottom');
    expect(caption.bottomFrac).toBe(0.16);
    expect(caption.highlightColor).toBeTruthy();
  });

  it('uses a karaoke shine box for the captions-only pipeline', () => {
    const caption = shineCaptionDirection();
    expect(caption.template).toBe('karaoke');
    expect(caption.animation).toBe('highlight');
    expect(caption.highlightColor).toBe('#F5B942');
    expect(caption.boxColor).toBeNull();
    expect(caption.uppercase).toBe(false);
    const plan = captionsOnlyVisualPlan(caption);
    expect(plan.clips).toEqual([]);
    expect(plan.overlays).toEqual([]);
    expect(plan.zooms).toEqual([]);
    expect(plan.hookTitle).toBe('');
    expect(plan.warnings).toContain('pipeline:captions_only');
  });

  it('maps person_cutout and chat aliases and strips shiny spoken-word boxes', () => {
    const parsed = parseVisualDirectorJson(
      JSON.stringify({
        hook_title: 'Order confirmed',
        caption: {
          template: 'clean',
          animation: 'highlight',
          box: true,
          box_color: '#111111',
        },
        moments: [
          {
            timestamp: 6,
            search_keyword: 'order confirmation chat',
            media: 'text',
            layout: 'chat',
            overlay_text: 'Order confirmed | Qty 3',
          },
          {
            timestamp: 12,
            search_keyword: 'product hoodie rack',
            media: 'video',
            layout: 'person_cutout',
          },
        ],
      }),
      28,
      'The order confirmed and the hoodie rack sold out.',
    );
    expect(parsed.moments.some(moment => moment.layout === 'bubble')).toBe(true);
    expect(parsed.moments.some(moment => moment.layout === 'cutout')).toBe(true);
    expect(parsed.caption.template).toBe('clean');
    expect(parsed.caption.animation).toBe('scale');
    expect(parsed.caption.boxColor).toBeNull();
  });

  it('honors caption template, position, and box=false from the director', () => {
    const parsed = parseVisualDirectorJson(
      JSON.stringify({
        hook_title: 'Three quiet truths',
        topic: 'soft story about starting over',
        caption: {
          template: 'minimal',
          position: 'top',
          box: false,
          text_color: '#FFFFFF',
          highlight_color: '#F5F5F5',
          box_color: '',
          animation: 'scale',
        },
        moments: [
          {
            timestamp: 8,
            search_keyword: 'morning coffee steam',
            media: 'video',
            layout: 'cutaway',
          },
        ],
      }),
      30,
      'I remember the quiet morning I started over.',
    );
    expect(parsed.caption.template).toBe('minimal');
    expect(parsed.caption.position).toBe('top');
    expect(parsed.caption.boxColor).toBeNull();
    expect(parsed.caption.animation).toBe('scale');
  });
});

describe('fallbackVisualDirection', () => {
  it('always returns a hook title and mixed layouts', () => {
    const directed = fallbackVisualDirection({
      transcript: 'This moisturizer doubled my sales in 30 days. Customers keep asking for the glow kit.',
      sourceDurationSec: 40,
      momentCount: 4,
    });
    expect(directed.hookTitle.length).toBeGreaterThan(3);
    expect(directed.moments.length).toBe(4);
    expect(directed.moments.length).toBeGreaterThan(1);
    expect(new Set(directed.moments.map(moment => moment.layout)).size).toBeGreaterThan(1);
    expect(directed.zooms.length).toBeGreaterThan(0);
    expect(directed.caption.template).toBeTruthy();
    expect(directed.motionGraphics.length).toBeGreaterThan(0);
  });
});

describe('factual overlay copy', () => {
  it('rejects invented follower stats', () => {
    expect(
      overlayTextIsFactual(
        '1M+ COMMUNITY',
        'I have a community of about a million plus online',
      ),
    ).toBe(false);
  });

  it('keeps a short hook to one line', () => {
    expect(
      oneLineHook('Turn dreams into reality stop waiting for permission'),
    ).toBe('Turn dreams into reality stop waiting');
  });
});

describe('keywordFallbacks', () => {
  it('keeps a scene query and does not fall back to a leftover noun', () => {
    expect(keywordFallbacks('skincare bottle')).toEqual(['skincare bottle']);
    expect(keywordFallbacks('mobile app')).toEqual([]);
    expect(keywordFallbacks('airplane window clouds')).toEqual([
      'airplane window clouds',
      'airplane window',
    ]);
  });
});
