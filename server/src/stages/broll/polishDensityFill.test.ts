/**
 * WP8P: polish density fill — Gate-4-thin Director plans get grounded beats without inventing words.
 */
import {describe, expect, it} from 'vitest';

import {EDIT_LOOKS} from '../directorV2/editLooks.ts';
import {fallbackVisualDirection} from './geminiDirector.ts';
import {
  applyPolishDensityFill,
  beatTarget,
  designedBeatCount,
  zoomFloor,
} from './polishDensityFill.ts';
import type {WordToken} from '../../types/blueprint.ts';

/** Spread sentences evenly across `spanSec` so zoom-floor slots have sentence starts to land on. */
function wordsFromSentences(sentences: string[], spanSec = 36): WordToken[] {
  const out: WordToken[] = [];
  const slot = spanSec / Math.max(1, sentences.length);
  for (let s = 0; s < sentences.length; s += 1) {
    let t = 1.2 + s * slot;
    for (const text of sentences[s]!.split(/\s+/).filter(Boolean)) {
      out.push({text, start: t, end: t + 0.28});
      t += 0.32;
    }
  }
  return out;
}

const LOOK_EXPLAINER = EDIT_LOOKS.find(look => look.id === 'explainer_cutaway')!;
const LOOK_TALKING = EDIT_LOOKS.find(look => look.id === 'talking_head')!;
const LOOK_MINIMAL = EDIT_LOOKS.find(look => look.id === 'minimal_captions')!;

const GATE4_SHAPE = wordsFromSentences([
  'Today I have a choice between two people.',
  'I would hire the one who is an expert in using AI.',
  'Every profession will transform with AI tools.',
  'You should elevate yourself and become that expert.',
  'That is the advice for every college student.',
]);

describe('beat / zoom floors', () => {
  it('targets ~one designed beat per 9s and a zoom floor of ceil(duration/10)', () => {
    expect(beatTarget(36)).toBe(4);
    expect(beatTarget(10)).toBe(0);
    expect(zoomFloor(36)).toBe(4);
    expect(zoomFloor(20)).toBe(2);
    expect(zoomFloor(7)).toBe(0);
  });
});

describe('applyPolishDensityFill', () => {
  it('fills a Gate-4-thin plan: few zooms, no overlays → grounded kinetic/card/emphasis + zoom floor', () => {
    const empty = fallbackVisualDirection({
      transcript: GATE4_SHAPE.map(word => word.text).join(' '),
      sourceDurationSec: 36,
      momentCount: 1,
    });
    empty.moments = [];
    empty.motionGraphics = [];
    empty.semanticEmphasis = [];
    empty.zooms = [{timestamp: 7.1, durationSec: 2.4}];
    empty.hookTitle = 'choice between two';

    const result = applyPolishDensityFill({
      direction: empty,
      look: LOOK_EXPLAINER,
      words: GATE4_SHAPE,
      outputDurationSec: 36,
      requested: new Set(['captions', 'zoom', 'hook_title', 'kinetic_text', 'lockup', 'card', 'bubble', 'emphasis', 'counter']),
    });

    expect(result.direction.zooms.length).toBeGreaterThanOrEqual(3);
    expect(designedBeatCount(result.direction)).toBeGreaterThanOrEqual(2);
    expect(result.warnings.some(warning => warning.startsWith('polish_density_fill:'))).toBe(true);
    expect(result.direction.zooms.length).toBeGreaterThan(1); // denser than Gate 4's lone zoom before fill
    // Every filled kinetic/emphasis/card text is a spoken substring (case-insensitive token check).
    const transcript = GATE4_SHAPE.map(word => word.text.toLowerCase()).join(' ');
    for (const graphic of result.direction.motionGraphics) {
      for (const token of graphic.text.toLowerCase().split(/\s+/)) {
        expect(transcript.includes(token), graphic.text).toBe(true);
      }
    }
  });

  it('does not fill on minimal_captions', () => {
    const empty = fallbackVisualDirection({transcript: 'Hello world today.', sourceDurationSec: 36, momentCount: 1});
    empty.moments = [];
    empty.motionGraphics = [];
    empty.zooms = [];
    const result = applyPolishDensityFill({
      direction: empty,
      look: LOOK_MINIMAL,
      words: GATE4_SHAPE,
      outputDurationSec: 36,
      requested: null,
    });
    expect(result.added).toEqual({});
    expect(result.warnings).toEqual([]);
  });

  it('never invents unspoken copy', () => {
    const empty = fallbackVisualDirection({transcript: 'hire the expert', sourceDurationSec: 36, momentCount: 1});
    empty.moments = [];
    empty.motionGraphics = [];
    empty.zooms = [];
    empty.semanticEmphasis = [];
    const result = applyPolishDensityFill({
      direction: empty,
      look: LOOK_TALKING,
      words: GATE4_SHAPE,
      outputDurationSec: 36,
      requested: new Set(['kinetic_text', 'emphasis', 'zoom']),
    });
    const spoken = new Set(GATE4_SHAPE.map(word => word.text.toLowerCase().replace(/[^a-z0-9']/g, '')));
    for (const graphic of result.direction.motionGraphics) {
      for (const token of graphic.text.split(/\s+/)) {
        const key = token.toLowerCase().replace(/[^a-z0-9']/g, '');
        if (key) expect(spoken.has(key), token).toBe(true);
      }
    }
  });
});
