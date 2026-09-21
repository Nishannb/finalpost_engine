import {describe, expect, it} from 'vitest';

import {applyThesisTokens, isDefaultAccent, tokensFromThesis} from './thesisTokens.ts';
import type {CaptionDirection, MotionGraphic} from '../../types/blueprint.ts';

describe('thesisTokens', () => {
  it('treats house cyan as a default accent', () => {
    expect(isDefaultAccent('#22D3EE')).toBe(true);
    expect(isDefaultAccent('#9A3412')).toBe(false);
  });

  it('repaints default motion graphics from the thesis', () => {
    const tokens = tokensFromThesis('warm gold type on cream paper', {
      look: 'warm editorial',
      rhythm: 'slow',
      motionLanguage: 'glide',
      colorStory: 'amber on cream',
      why: 'travel story',
    });
    const graphic: MotionGraphic = {
      start: 2,
      end: 5,
      text: 'inspiration and action',
      role: 'primary',
      shape: 'none',
      accentColor: '#22D3EE',
      textColor: '#FFFFFF',
      anchor: 'center',
      entrance: 'spring_up',
      exit: 'fade',
      fontScale: 1,
    };
    const caption: CaptionDirection = {
      position: 'bottom',
      bottomFrac: 0.2,
      textColor: '#FFFFFF',
      highlightColor: '#22D3EE',
      boxColor: null,
      template: 'clean',
    };
    const out = applyThesisTokens({
      tokens,
      caption,
      overlays: [],
      motionGraphics: [graphic],
      semanticEmphasis: [],
    });
    expect(out.motionGraphics[0]?.accentColor).not.toBe('#22D3EE');
    expect(out.caption.highlightColor).not.toBe('#22D3EE');
  });
});
