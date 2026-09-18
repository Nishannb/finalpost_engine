import {describe, expect, it} from 'vitest';

import {contrastCaptionWithFootage} from './captionContrast.ts';
import type {CaptionDirection} from '../../types/blueprint.ts';

function caption(partial: Partial<CaptionDirection> = {}): CaptionDirection {
  return {
    position: 'bottom',
    bottomFrac: 0.2,
    textColor: '#FFFFFF',
    highlightColor: '#00E5FF',
    boxColor: null,
    template: 'hormozi',
    ...partial,
  };
}

describe('contrastCaptionWithFootage', () => {
  it('does not force a dark box on mid-luminance footage', () => {
    const out = contrastCaptionWithFootage(
      caption({template: 'karaoke', boxColor: null}),
      {r: 0.45, g: 0.4, b: 0.35, luminance: 0.42},
    );
    expect(out.boxColor).toBeNull();
    expect(out.template).toBe('karaoke');
  });

  it('keeps the director template on bright walls without forcing box template', () => {
    const out = contrastCaptionWithFootage(
      caption({template: 'mrbeast', boxColor: null, textColor: '#FFFF00'}),
      {r: 0.9, g: 0.9, b: 0.88, luminance: 0.9},
    );
    expect(out.template).toBe('mrbeast');
    expect(out.boxColor).toBeNull();
    expect(out.textColor).not.toBe('#FFFF00');
  });

  it('preserves an explicit director box', () => {
    const out = contrastCaptionWithFootage(
      caption({template: 'box', boxColor: '#111111'}),
      {r: 0.5, g: 0.5, b: 0.5, luminance: 0.5},
    );
    expect(out.boxColor).toBe('#111111');
    expect(out.template).toBe('box');
  });
});
