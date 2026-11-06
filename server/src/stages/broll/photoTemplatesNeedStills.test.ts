import {describe, expect, it} from 'vitest';
import {bindMotionTemplateContent} from './motionTemplateBind.js';

// Real renders showed photo templates drawn with empty placeholder art when no stills were available (an empty slat carousel, grey stacked cards).
const words = 'silence is the sanctuary where our hearts finally settle and real connection begins'.split(' ').map((text, i) => ({text, start: i * 0.4, end: i * 0.4 + 0.35}));
const base = {words, beatStart: 0, beatEnd: 6, accent: '#3D4A5C'};

describe('photo templates need real stills', () => {
  it('stacked cards: skipped with fewer than two stills, never a card without a photo', () => {
    expect(bindMotionTemplateContent({...base, templateId: 'clip_04_stacked_cards'})).toBeNull();
    expect(bindMotionTemplateContent({...base, templateId: 'clip_04_stacked_cards', imageUrls: ['https://x.invalid/a.jpg']})).toBeNull();
    const bound = bindMotionTemplateContent({...base, templateId: 'clip_04_stacked_cards', imageUrls: ['https://x.invalid/a.jpg', 'https://x.invalid/b.jpg', 'https://x.invalid/c.jpg']}) as {cards: {label: string; src?: string}[]};
    expect(bound.cards.length).toBe(3);
    expect(bound.cards.every(card => card.src?.startsWith('https://'))).toBe(true);
  });

  it('slit carousel: skipped with fewer than two stills', () => {
    expect(bindMotionTemplateContent({...base, templateId: 'clip_02_slit_carousel', imageUrls: ['https://x.invalid/a.jpg']})).toBeNull();
    expect(bindMotionTemplateContent({...base, templateId: 'clip_02_slit_carousel', imageUrls: ['https://x.invalid/a.jpg', 'https://x.invalid/b.jpg']})).not.toBeNull();
  });
});
