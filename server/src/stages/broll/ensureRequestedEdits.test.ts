import {describe, expect, it} from 'vitest';

import {ensureRequestedEditStyles} from './ensureRequestedEdits.ts';
import {fallbackVisualDirection} from './geminiDirector.ts';

describe('ensureRequestedEditStyles', () => {
  it('logs requested_not_placed and does not fill missing toolkits', () => {
    const empty = fallbackVisualDirection({
      transcript: 'I have a community of about a million plus online.',
      sourceDurationSec: 24,
      momentCount: 1,
    });
    empty.moments = [];
    empty.insetReveals = [];
    empty.depthOverlays = [];
    empty.zooms = [];
    empty.semanticEmphasis = [];
    const words = [
      {text: 'I', start: 4.0, end: 4.1},
      {text: 'million', start: 5.55, end: 5.95},
    ];
    const filled = ensureRequestedEditStyles({
      direction: empty,
      allowed: new Set(['inset_reveal', 'depth_overlay', 'cutaway']),
      words,
      durationSec: 24,
      userBrollId: 'ub_1',
    });
    expect(filled.direction.moments).toEqual([]);
    expect(filled.direction.insetReveals).toEqual([]);
    expect(filled.direction.depthOverlays).toEqual([]);
    expect(filled.direction.zooms).toEqual([]);
    expect(filled.warnings.sort()).toEqual([
      'requested_not_placed:cutaway',
      'requested_not_placed:depth_overlay',
      'requested_not_placed:inset_reveal',
    ]);
  });

  it('does not fill zoom on the lean captions allowlist', () => {
    const empty = fallbackVisualDirection({
      transcript: 'I have a community of about a million plus online.',
      sourceDurationSec: 24,
      momentCount: 1,
    });
    empty.moments = [];
    empty.insetReveals = [];
    empty.depthOverlays = [];
    empty.zooms = [];
    empty.semanticEmphasis = [];
    const filled = ensureRequestedEditStyles({
      direction: empty,
      allowed: new Set(['captions']),
      words: [
        {text: 'community', start: 4.5, end: 4.9},
        {text: 'million', start: 5.55, end: 5.95},
      ],
      durationSec: 24,
    });
    expect(filled.direction.zooms).toEqual([]);
    expect(filled.direction.moments).toEqual([]);
    expect(filled.warnings).toEqual([]);
  });
});
