/**
 * Phase 27: caption line selection (remotion/src/lib/timeline.ts: activeLineAt). Pure; no render.
 * `legacy` is a verbatim copy of the pre-fix function, kept so the defect stays reproducible: it returned the FIRST line whose
 * [start, end + hold] window contained the time, so the previous word stayed up through its hold while the next word had already started.
 */
import {describe, expect, it} from 'vitest';

import {activeLineAt, groupCaptionLines} from '../../../remotion/src/lib/timeline.ts';

type Line = {words: Array<{text: string; start: number; end: number; sentenceIndex: number}>; start: number; end: number};
const legacy = (lines: Line[], timeSec: number, holdSec = 0.12): Line | null => {
  for (const line of lines) {
    if (timeSec >= line.start && timeSec <= line.end + holdSec) return line;
  }
  return null;
};
const oneWordLines = (spec: Array<[string, number, number]>): Line[] =>
  spec.map(([text, start, end], index) => ({words: [{text, start, end, sentenceIndex: index}], start, end}));
// the shape the Phase 27 edit had: one word per line, no gap between consecutive words
const LINES = oneWordLines([['small', 7.28, 7.6], ['talk', 7.6, 8.06], ['can', 8.06, 8.38], ['deepen', 8.38, 8.72], ['emotional', 8.72, 9.38]]);

describe('the reproduced defect (legacy selection)', () => {
  it('shows the previous word for the whole hold after the next word has started', () => {
    expect(legacy(LINES, 8.07)!.words[0]!.text).toBe('talk'); // "can" started at 8.06
    expect(legacy(LINES, 8.17)!.words[0]!.text).toBe('talk');
    expect(legacy(LINES, 8.19)!.words[0]!.text).toBe('can'); // only once the 0.12 s hold ends
  });
});

describe('after the fix', () => {
  it('shows each word from its own start frame', () => {
    expect(activeLineAt(LINES, 8.06)!.words[0]!.text).toBe('can');
    expect(activeLineAt(LINES, 8.07)!.words[0]!.text).toBe('can');
    expect(activeLineAt(LINES, 8.37)!.words[0]!.text).toBe('can');
    expect(activeLineAt(LINES, 8.38)!.words[0]!.text).toBe('deepen');
    expect(activeLineAt(LINES, 7.6)!.words[0]!.text).toBe('talk');
    expect(activeLineAt(LINES, 7.5999)!.words[0]!.text).toBe('small');
  });

  it('still holds the last word after it ends when no word follows closely (the hold exists for the end of a line)', () => {
    const spaced = oneWordLines([['hello', 1, 1.4], ['world', 2, 2.4]]);
    expect(activeLineAt(spaced, 1.5)!.words[0]!.text).toBe('hello'); // 0.1 s after the end: held
    expect(activeLineAt(spaced, 1.53)).toBeNull(); // hold (0.12 s) over, next word not started: nothing
    expect(activeLineAt(spaced, 2.0)!.words[0]!.text).toBe('world');
    expect(activeLineAt(spaced, 2.52)!.words[0]!.text).toBe('world');
    expect(activeLineAt(spaced, 2.53)).toBeNull();
    expect(activeLineAt(spaced, 0.5)).toBeNull();
  });

  it('keeps the hold configurable and returns null for no lines', () => {
    expect(activeLineAt([], 1)).toBeNull();
    const spaced = oneWordLines([['a', 1, 1.2]]);
    expect(activeLineAt(spaced, 1.5, 0.4)!.words[0]!.text).toBe('a');
    expect(activeLineAt(spaced, 1.5, 0.1)).toBeNull();
  });

  it('multi-word lines: the next line replaces the previous one at its first word, not after the hold', () => {
    const words = ['Have', 'you', 'ever', 'noticed', 'how', 'the'].map((text, i) => ({text, start: i * 0.3, end: (i + 1) * 0.3, sentenceIndex: 0}));
    const lines = groupCaptionLines(words, {maxWords: 3});
    expect(lines).toHaveLength(2);
    expect(activeLineAt(lines, 0.89)!.words[0]!.text).toBe('Have');
    expect(activeLineAt(lines, 0.9)!.words[0]!.text).toBe('noticed');
    expect(legacy(lines as Line[], 0.95)!.words[0]!.text).toBe('Have'); // legacy: still the old line
  });

  it('differs from the legacy only where two lines qualify, and then picks the later-starting one (deterministic sets)', () => {
    let state = 7;
    const rand = () => {
      state = (state * 1664525 + 1013904223) % 4294967296;
      return state / 4294967296;
    };
    let differing = 0;
    for (let n = 0; n < 120; n += 1) {
      let t = 0;
      const spec: Array<[string, number, number]> = [];
      for (let i = 0; i < 12; i += 1) {
        const start = t + (rand() < 0.2 ? rand() * 0.5 : 0);
        const end = start + 0.1 + rand() * 0.5;
        spec.push([`w${i}`, start, end]);
        t = end - (rand() < 0.1 ? 0.05 : 0);
      }
      const lines = oneWordLines(spec);
      for (let time = 0; time < t + 0.3; time += 0.011) {
        const before = legacy(lines, time);
        const after = activeLineAt(lines, time);
        const qualifying = lines.filter(line => time >= line.start && time <= line.end + 0.12);
        expect(after).toBe(qualifying.at(-1) ?? null);
        if (before !== after) {
          differing += 1;
          expect(qualifying.length).toBeGreaterThan(1);
          expect(after!.start).toBeGreaterThanOrEqual(before!.start);
        }
      }
    }
    expect(differing).toBeGreaterThan(400); // the legacy lag was common, not an edge case
  }, 60_000);
});
