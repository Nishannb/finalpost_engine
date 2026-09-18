import {describe, expect, it} from 'vitest';

import {buildSeedancePrompt} from './seedanceEdit.ts';
import {defaultVideoTemplateRecipe} from '../../types/templateRecipe.ts';

describe('buildSeedancePrompt', () => {
  it('includes watermark ban and recipe summary', () => {
    const prompt = buildSeedancePrompt(
      defaultVideoTemplateRecipe({
        summary: 'Punchy product pitch',
        energy: 'hype',
        seedancePrompt: '',
      }),
    );
    expect(prompt).toContain('Punchy product pitch');
    expect(prompt.toLowerCase()).toContain('watermark');
    expect(prompt).toContain('9:16');
  });

  it('prefers an explicit seedancePrompt', () => {
    const prompt = buildSeedancePrompt(
      defaultVideoTemplateRecipe({
        seedancePrompt:
          'Vertical kinetic captions with whip pans and warm grade. No platform watermarks.',
      }),
    );
    expect(prompt).toContain('whip pans');
    expect(prompt.toLowerCase()).toContain('watermark');
  });
});
