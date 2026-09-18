import {describe, expect, it} from 'vitest';

import type {WordToken} from '../../types/blueprint.ts';
import {
  buildCaptionWords,
  detectSparseZoomTriggers,
  detectZoomTriggers,
  emphasisScore,
  isSentenceEnd,
  resolveDirectedZooms,
  splitSentences,
} from './autoZoom.ts';
import {buildTimeline, identityTimeline} from './timeline.ts';

/** Three one-second sentences of two words each, back to back. */
function threeSentences(): WordToken[] {
  const words: WordToken[] = [];
  const tokens = [
    'One',
    'first.',
    'Two',
    'second.',
    'Three',
    'third.',
    'Four',
    'fourth.',
  ];
  tokens.forEach((text, index) => {
    words.push({text, start: index, end: index + 0.9});
  });
  return words;
}

describe('isSentenceEnd', () => {
  it('accepts terminators with trailing quotes or brackets', () => {
    expect(isSentenceEnd('done.')).toBe(true);
    expect(isSentenceEnd('really?"')).toBe(true);
    expect(isSentenceEnd('wow!)')).toBe(true);
  });

  it('rejects mid-sentence tokens', () => {
    expect(isSentenceEnd('and')).toBe(false);
    expect(isSentenceEnd('half,')).toBe(false);
  });

  it('rejects abbreviations so they do not fake a sentence break', () => {
    expect(isSentenceEnd('Mr.')).toBe(false);
    expect(isSentenceEnd('U.')).toBe(false);
    expect(isSentenceEnd('2.')).toBe(false);
  });

  it('still treats short real words as sentence ends', () => {
    expect(isSentenceEnd('Done.')).toBe(true);
    expect(isSentenceEnd('Yes.')).toBe(true);
    expect(isSentenceEnd('Go.')).toBe(true);
  });
});

describe('splitSentences', () => {
  it('groups words between terminators', () => {
    const sentences = splitSentences(threeSentences());
    expect(sentences).toHaveLength(4);
    expect(sentences[0]?.text).toBe('One first.');
    expect(sentences[1]?.firstWordIndex).toBe(2);
    expect(sentences[3]?.lastWordIndex).toBe(7);
  });

  it('treats trailing words with no terminator as a final sentence', () => {
    const sentences = splitSentences([
      {text: 'Done.', start: 0, end: 1},
      {text: 'unfinished', start: 1, end: 2},
    ]);
    expect(sentences).toHaveLength(2);
    expect(sentences[1]?.text).toBe('unfinished');
  });
});

describe('detectZoomTriggers', () => {
  const timeline = identityTimeline(8);

  it('never zooms the opening sentence', () => {
    const triggers = detectZoomTriggers(threeSentences(), {
      scale: 1.25,
      maxDurationSec: 6,
      timeline,
    });
    expect(triggers.every(trigger => trigger.sentenceIndex > 0)).toBe(true);
  });

  it('alternates punch-ins so the camera returns to neutral', () => {
    const triggers = detectZoomTriggers(threeSentences(), {
      scale: 1.25,
      maxDurationSec: 6,
      timeline,
    });
    expect(triggers.map(trigger => trigger.sentenceIndex)).toEqual([1, 3]);
    expect(triggers[0]).toMatchObject({start: 2, end: 3.9, scale: 1.25});
  });

  it('zooms every following sentence when alternation is off', () => {
    const triggers = detectZoomTriggers(threeSentences(), {
      scale: 1.25,
      maxDurationSec: 6,
      timeline,
      alternate: false,
    });
    expect(triggers.map(trigger => trigger.sentenceIndex)).toEqual([1, 2, 3]);
  });

  it('caps a long sentence at the maximum punch-in duration', () => {
    const words: WordToken[] = [
      {text: 'Start.', start: 0, end: 1},
      {text: 'A', start: 1, end: 2},
      {text: 'very', start: 2, end: 10},
      {text: 'long.', start: 10, end: 20},
    ];
    const triggers = detectZoomTriggers(words, {
      scale: 1.25,
      maxDurationSec: 6,
      timeline: identityTimeline(20),
    });
    expect(triggers[0]?.end).toBe(7);
  });
});

describe('buildCaptionWords', () => {
  it('shifts words onto the trimmed output timeline', () => {
    const timeline = buildTimeline([
      {sourceStart: 0, sourceEnd: 2, outputStart: 0},
      {sourceStart: 5, sourceEnd: 8, outputStart: 2},
    ]);
    const captions = buildCaptionWords(
      [
        {text: 'kept', start: 0.5, end: 1.2},
        {text: 'gone', start: 3, end: 3.5},
        {text: 'shifted', start: 5.5, end: 6},
      ],
      timeline,
    );
    expect(captions.map(caption => caption.text)).toEqual(['kept', 'shifted']);
    expect(captions[1]).toMatchObject({start: 2.5, end: 3});
  });

  it('keeps caption timings monotonic across a seam', () => {
    const timeline = buildTimeline([
      {sourceStart: 0, sourceEnd: 1, outputStart: 0},
      {sourceStart: 3, sourceEnd: 5, outputStart: 1},
    ]);
    const captions = buildCaptionWords(
      [
        {text: 'before', start: 0.5, end: 2.5},
        {text: 'after', start: 3.05, end: 3.5},
      ],
      timeline,
    );
    expect(captions[0]!.end).toBeLessThanOrEqual(captions[1]!.start);
  });
});

describe('detectSparseZoomTriggers', () => {
  it('keeps a handful of punch-ins instead of every other sentence', () => {
    const words: WordToken[] = [];
    for (let i = 0; i < 12; i += 1) {
      words.push(
        {text: 'This', start: i * 4, end: i * 4 + 0.4},
        {text: 'whole', start: i * 4 + 0.4, end: i * 4 + 0.9},
        {text: 'sentence', start: i * 4 + 0.9, end: i * 4 + 1.5},
        {text: 'lands.', start: i * 4 + 1.5, end: i * 4 + 2.2},
      );
    }
    const triggers = detectSparseZoomTriggers(words, {
      scale: 1.22,
      maxDurationSec: 2,
      timeline: identityTimeline(50),
    });
    expect(triggers.length).toBeGreaterThan(0);
    expect(triggers.length).toBeLessThanOrEqual(3);
  });
});

describe('emphasisScore', () => {
  it('scores punched statements higher than flat filler lines', () => {
    const words: WordToken[] = [
      {text: 'This', start: 0, end: 0.2},
      {text: 'is', start: 0.2, end: 0.35},
      {text: 'um', start: 0.4, end: 0.55},
      {text: 'okay.', start: 0.6, end: 0.9},
      {text: 'You', start: 2, end: 2.2},
      {text: 'must', start: 2.2, end: 2.55},
      {text: 'remember', start: 2.55, end: 3.1},
      {text: 'this!', start: 3.1, end: 3.6},
    ];
    const sentences = splitSentences(words);
    expect(emphasisScore(sentences[1]!, words)).toBeGreaterThan(
      emphasisScore(sentences[0]!, words),
    );
  });
});

describe('resolveDirectedZooms', () => {
  it('prefers the director timestamps and skips B-roll windows', () => {
    const words: WordToken[] = [
      {text: 'Hello.', start: 0, end: 1},
      {text: 'This', start: 5, end: 5.4},
      {text: 'matters.', start: 5.4, end: 6},
      {text: 'Later', start: 20, end: 20.5},
      {text: 'now.', start: 20.5, end: 21},
    ];
    const triggers = resolveDirectedZooms({
      directed: [
        {timestamp: 5.2, durationSec: 1.5},
        {timestamp: 6, durationSec: 1.5},
      ],
      words,
      timeline: identityTimeline(30),
      scale: 1.22,
      maxDurationSec: 2,
      blockedRanges: [{start: 4.8, end: 7.5}],
    });
    expect(triggers).toEqual([]);
  });
});
