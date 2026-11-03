import {describe, expect, it} from 'vitest';

import type {WordToken} from '../../types/blueprint.ts';
import {
  buildCaptionWords,
  detectSparseZoomTriggers,
  detectZoomTriggers,
  emphasisScore,
  isSentenceEnd,
  normalizeZoomFocus,
  normalizeZoomScale,
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
  it('keeps director zooms even when they overlap another plate', () => {
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
    expect(triggers).toHaveLength(2);
    expect(triggers[0]?.start).toBeCloseTo(5.2, 5);
  });
});

describe('zoom scale contract', () => {
  const words: WordToken[] = [
    {text: 'Hello.', start: 0, end: 1},
    {text: 'This', start: 5, end: 5.4},
    {text: 'matters.', start: 5.4, end: 6},
  ];
  const run = (directed: Array<{timestamp: number; durationSec: number; scale?: number}>, extra: Record<string, unknown> = {}) => {
    const kept: string[] = [];
    const dropped: string[] = [];
    const triggers = resolveDirectedZooms({
      directed,
      words,
      timeline: identityTimeline(30),
      scale: 1.25,
      maxDurationSec: 2,
      trace: {keep: (_zoom, _trigger, note) => kept.push(note ?? 'default'), drop: (_zoom, reason) => dropped.push(reason)},
      ...extra,
    });
    return {triggers, kept, dropped};
  };

  it('uses an explicit supported scale', () => {
    expect(run([{timestamp: 5.2, durationSec: 1.5, scale: 1.4}]).triggers[0]!.scale).toBe(1.4);
  });

  it('keeps the configured default for plans without a scale (legacy)', () => {
    const {triggers, kept} = run([{timestamp: 5.2, durationSec: 1.5}]);
    expect(triggers[0]!.scale).toBe(1.25);
    expect(kept).toEqual(['default']);
  });

  it.each([0.5, 1, 1.7, 3, Number.NaN, -1])('ignores an unsupported scale %s and says so', value => {
    const {triggers, kept} = run([{timestamp: 5.2, durationSec: 1.5, scale: value}]);
    expect(triggers[0]!.scale).toBe(1.25);
    expect(kept[0]).toMatch(/^zoom_scale_.*_unsupported_default_1\.25_used$/);
  });

  it('normalizes only finite in-bounds numbers', () => {
    expect(normalizeZoomScale(1.05)).toBe(1.05);
    expect(normalizeZoomScale(1.6)).toBe(1.6);
    expect(normalizeZoomScale(undefined)).toBeUndefined();
    expect(normalizeZoomScale('')).toBeUndefined();
    expect(normalizeZoomScale(1.61)).toBeUndefined();
  });

  it('serialises the scale into the blueprint trigger', async () => {
    const {zoomTriggerSchema} = await import('../../../../remotion/src/blueprintSchema.ts');
    const {triggers} = run([{timestamp: 5.2, durationSec: 1.5, scale: 1.4}]);
    expect(zoomTriggerSchema.parse(JSON.parse(JSON.stringify(triggers[0])))).toMatchObject({scale: 1.4});
  });

  it('treats Director v2 times as output time instead of mapping them a second time', () => {
    const trimmed = buildTimeline([{sourceStart: 10, sourceEnd: 30, outputStart: 0}] as never);
    const asSource = resolveDirectedZooms({directed: [{timestamp: 12, durationSec: 1.5}], words, timeline: trimmed, scale: 1.25, maxDurationSec: 2});
    const asOutput = resolveDirectedZooms({directed: [{timestamp: 12, durationSec: 1.5}], words, timeline: trimmed, scale: 1.25, maxDurationSec: 2, alreadyOutput: true});
    expect(asSource[0]!.start).toBeCloseTo(2, 5);
    expect(asOutput[0]!.start).toBeCloseTo(12, 5);
  });

  it('drops a zoom with no duration left and reports the real reason (not a blocked-range claim)', () => {
    const {triggers, dropped} = run([{timestamp: 29.99, durationSec: 1.5}]);
    expect(triggers).toEqual([]);
    expect(dropped).toEqual(['zoom_has_no_duration_after_timeline_mapping']);
  });
});

describe('zoom scale reaches the renderer', () => {
  it('ZoomFrame\'s envelope peaks at each trigger\'s own scale (not a fixed one)', async () => {
    const {zoomScaleAt} = await import('../../../../remotion/src/lib/timeline.ts');
    const trigger = (scale: number) => [{start: 10, end: 14, scale, sentenceIndex: 0}];
    expect(zoomScaleAt(trigger(1.4), 11.5)).toBeCloseTo(1.4, 5);
    expect(zoomScaleAt(trigger(1.25), 11.5)).toBeCloseTo(1.25, 5);
    expect(zoomScaleAt(trigger(1.4), 9)).toBe(1);
  });

  it('rejects an out-of-range scale at the blueprint boundary', async () => {
    const {zoomTriggerSchema} = await import('../../../../remotion/src/blueprintSchema.ts');
    expect(zoomTriggerSchema.safeParse({start: 1, end: 2, scale: 1.25, sentenceIndex: 0}).success).toBe(true);
    expect(zoomTriggerSchema.safeParse({start: 1, end: 2, scale: 5, sentenceIndex: 0}).success).toBe(false);
    expect(zoomTriggerSchema.safeParse({start: 1, end: 2, scale: 0.5, sentenceIndex: 0}).success).toBe(false);
  });
});

describe('region-aware zoom (focus)', () => {
  const words: WordToken[] = [{text: 'Hello.', start: 0, end: 1}, {text: 'This', start: 5, end: 5.4}, {text: 'matters.', start: 5.4, end: 6}];
  const resolve = (focus: unknown) => {
    const notes: string[] = [];
    const triggers = resolveDirectedZooms({
      directed: [{timestamp: 5.2, durationSec: 1.5, focus: focus as never}],
      words,
      timeline: identityTimeline(30),
      scale: 1.25,
      maxDurationSec: 2,
      trace: {keep: (_z, _t, note) => notes.push(note ?? ''), drop: () => undefined},
    });
    return {trigger: triggers[0]!, notes};
  };

  it('keeps a valid focus on the trigger', () => {
    expect(resolve({x: 0.8, y: 0.3}).trigger.focus).toEqual({x: 0.8, y: 0.3});
    expect(resolve({x: 0, y: 1}).trigger.focus).toEqual({x: 0, y: 1});
  });

  it.each([{x: 1.2, y: 0.5}, {x: -0.1, y: 0.5}, {x: Number.NaN, y: 0.5}, {x: 0.5}, {x: '0.5', y: '0.5'}, null, 'center'])('ignores invalid focus %j and says so', focus => {
    const {trigger, notes} = resolve(focus);
    expect(trigger.focus).toBeUndefined();
    expect(trigger.scale).toBe(1.25);
    if (focus !== null) {
      expect(notes[0]).toContain('zoom_focus_out_of_range_ignored_default_origin_used');
    }
  });

  it('normalizes only finite in-range pairs', () => {
    expect(normalizeZoomFocus({x: 0.25, y: 0.75})).toEqual({x: 0.25, y: 0.75});
    expect(normalizeZoomFocus({x: Infinity, y: 0})).toBeUndefined();
    expect(normalizeZoomFocus(undefined)).toBeUndefined();
  });

  it('parses focus from the v1 Director response (focus_x/focus_y, or nested focus)', async () => {
    const {parseVisualDirectorJson} = await import('../broll/geminiDirector.ts');
    const parsed = parseVisualDirectorJson(JSON.stringify({topic: 't', hook_title: 'Hook words here', zooms: [{timestamp: 10, duration: 1.6, focus_x: 0.7, focus_y: 0.4}, {timestamp: 20, duration: 1.6, focus: {x: 0.2, y: 0.9}}, {timestamp: 30, duration: 1.6}]}), 60, 'x');
    expect(parsed.zooms.map(zoom => zoom.focus)).toEqual([{x: 0.7, y: 0.4}, {x: 0.2, y: 0.9}, undefined]);
  });

  it('serialises the focus into the blueprint and still accepts legacy triggers without one', async () => {
    const {zoomTriggerSchema} = await import('../../../../remotion/src/blueprintSchema.ts');
    expect(zoomTriggerSchema.parse(JSON.parse(JSON.stringify(resolve({x: 0.8, y: 0.3}).trigger))).focus).toEqual({x: 0.8, y: 0.3});
    expect(zoomTriggerSchema.parse({start: 1, end: 2, scale: 1.25, sentenceIndex: 0}).focus).toBeUndefined();
    expect(zoomTriggerSchema.safeParse({start: 1, end: 2, scale: 1.25, focus: {x: 2, y: 0}, sentenceIndex: 0}).success).toBe(false);
  });
});

describe('zoom renderer transform', () => {
  const trigger = (extra: Record<string, unknown> = {}) => [{start: 10, end: 14, scale: 1.4, sentenceIndex: 0, ...extra}];

  it('is exactly the legacy transform when no focus is given (and for legacy blueprints)', async () => {
    const {activeZoomAt, zoomStyleFor} = await import('../../../../remotion/src/lib/timeline.ts');
    const style = zoomStyleFor(activeZoomAt(trigger() as never, 11.5), 1080, 1920);
    expect(style).toEqual({transform: 'scale(1.4)', transformOrigin: '50% 32%'});
    expect(zoomStyleFor({scale: 1}, 1080, 1920)).toEqual({transform: 'scale(1)', transformOrigin: '50% 32%'});
  });

  const sizes = [[1080, 1920], [1920, 1080], [1000, 1000]] as const;
  const points = [0, 0.05, 0.25, 0.5, 0.75, 0.95, 1];

  it.each(sizes)('covers the whole frame and keeps the focus on screen for every focus and scale (%ix%i)', async (width, height) => {
    const {zoomStyleFor} = await import('../../../../remotion/src/lib/timeline.ts');
    for (const fx of points) {
      for (const fy of points) {
        for (const scale of [1.05, 1.25, 1.6]) {
          const {transform} = zoomStyleFor({scale, focus: {x: fx, y: fy}}, width, height);
          const m = /translate\((-?[\d.e-]+)px, (-?[\d.e-]+)px\) scale\(([\d.]+)\)/.exec(transform)!;
          const [tx, ty, s] = [Number(m[1]), Number(m[2]), Number(m[3])];
          // transform-origin is 0 0, so a point p lands at t + s·p. The picture must still cover [0, W] x [0, H].
          expect(tx).toBeLessThanOrEqual(1e-6);
          expect(tx + s * width).toBeGreaterThanOrEqual(width - 1e-6);
          expect(ty).toBeLessThanOrEqual(1e-6);
          expect(ty + s * height).toBeGreaterThanOrEqual(height - 1e-6);
          // The focus stays inside the frame and is never farther from the centre than it started.
          const sx = tx + s * fx * width;
          const sy = ty + s * fy * height;
          expect(sx).toBeGreaterThanOrEqual(-1e-6);
          expect(sx).toBeLessThanOrEqual(width + 1e-6);
          expect(sy).toBeGreaterThanOrEqual(-1e-6);
          expect(sy).toBeLessThanOrEqual(height + 1e-6);
          expect(Math.abs(sx - width / 2)).toBeLessThanOrEqual(Math.abs(fx * width - width / 2) + 1e-6);
          expect(Math.abs(sy - height / 2)).toBeLessThanOrEqual(Math.abs(fy * height - height / 2) + 1e-6);
        }
      }
    }
  });

  it('centres a mid-frame focus exactly and clamps an edge focus at the frame edge', async () => {
    const {zoomStyleFor} = await import('../../../../remotion/src/lib/timeline.ts');
    const pos = (fx: number, fy: number, w: number, h: number) => {
      const m = /translate\((-?[\d.e-]+)px, (-?[\d.e-]+)px\) scale\(([\d.]+)\)/.exec(zoomStyleFor({scale: 1.4, focus: {x: fx, y: fy}}, w, h).transform)!;
      return [Number(m[1]) + 1.4 * fx * w, Number(m[2]) + 1.4 * fy * h];
    };
    expect(pos(0.6, 0.6, 1080, 1920)).toEqual([540, 960].map(v => expect.closeTo(v, 5)));
    // Focus in the top-left corner cannot be centred without exposing empty canvas, so it sits at the corner.
    expect(pos(0, 0, 1080, 1920)).toEqual([expect.closeTo(0, 5), expect.closeTo(0, 5)]);
  });

  it('eases in from no movement: at scale just above 1 the translation is near zero', async () => {
    const {zoomStyleFor} = await import('../../../../remotion/src/lib/timeline.ts');
    const m = /translate\((-?[\d.e-]+)px, (-?[\d.e-]+)px\)/.exec(zoomStyleFor({scale: 1.001, focus: {x: 0.9, y: 0.1}}, 1080, 1920).transform)!;
    expect(Math.abs(Number(m[1]))).toBeLessThan(2);
    expect(Math.abs(Number(m[2]))).toBeLessThan(2);
  });
});
