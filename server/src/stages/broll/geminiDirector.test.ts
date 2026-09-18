import {describe, expect, it} from 'vitest';

import {
  extractJson,
  fallbackVisualDirection,
  oneLineHook,
  overlayTextIsFactual,
  parseVisualDirectorJson,
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
    expect(parsed.moments.some(moment => moment.layout === 'split')).toBe(true);
    expect(parsed.moments.every(moment => moment.layout !== 'composite')).toBe(true);
    expect(parsed.hookStyle).toBeTruthy();
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
    expect(parsed.moments.some(moment => moment.layout === 'split')).toBe(true);
    expect(parsed.caption.template).toBeTruthy();
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
    expect(directed.moments.map(moment => moment.layout)).toEqual(
      expect.arrayContaining(['cutaway', 'split', 'lockup']),
    );
    expect(directed.moments.filter(moment => moment.layout === 'cutaway').length).toBeGreaterThanOrEqual(2);
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
    ]);
  });
});
