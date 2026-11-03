/**
 * WP7F goldens: the user's remaining QA failure modes (mash of "revolutionized" + "redefined", coach + creator double, yeah spam, repeated full sentences) as synthetic word timelines.
 * The stack is the cuts-path Stage B of `analyzeVideo` (autoTrimSilence + nonSpeechExclusions + transcriptRetakeExclusions) followed by the caption projection
 * (`buildCaptionWords` with the cut ranges, the same midpoint rule). Assertions are on the explicit KEPT caption text. Pure: no audio, no video, no model.
 */
import {describe, expect, it} from 'vitest';

import type {WordToken} from '../../types/blueprint.ts';
import {autoTrimSilence} from './autoTrim.ts';
import {buildCaptionWords} from './autoZoom.ts';
import {buildTimeline as buildSpeech} from './messyOneTake.fixtures.ts';
import {mergeTimeRanges, nonSpeechExclusions, normalizeToken} from './scriptRetakeTrim.ts';
import {buildTimeline} from './timeline.ts';
import {transcriptRetakeExclusions, wordsOutsideRanges} from './transcriptRetakeTrim.ts';

const THRESHOLD = 0.4;
const PADDING = 0.08;

function cutsStack(built: {words: WordToken[]; durationSec: number}) {
  const silence = autoTrimSilence(built.words, {thresholdSec: THRESHOLD, paddingSec: PADDING, sourceDurationSec: built.durationSec, removeFillers: true});
  const cough = nonSpeechExclusions(built.words, {paddingSec: PADDING});
  const retakes = transcriptRetakeExclusions(wordsOutsideRanges(built.words, []), {sourceDurationSec: built.durationSec, paddingSec: PADDING});
  const exclusions = mergeTimeRanges([...silence.trimExclusions, ...cough, ...retakes.trimExclusions]);
  const sorted = [...exclusions].sort((a, b) => a.start - b.start);
  const keep: Array<{sourceStart: number; sourceEnd: number; outputStart: number}> = [];
  let cursor = 0;
  let out = 0;
  for (const range of [...sorted, {start: built.durationSec, end: built.durationSec}]) {
    if (range.start - cursor > 0.001) {
      keep.push({sourceStart: cursor, sourceEnd: range.start, outputStart: out});
      out += range.start - cursor;
    }
    cursor = Math.max(cursor, range.end);
  }
  const captions = buildCaptionWords(built.words, buildTimeline(keep), exclusions).map(word => normalizeToken(word.text)).filter(Boolean).join(' ');
  return {retakes, exclusions, captions};
}

const count = (text: string, phrase: string) => text.split(phrase).length - 1;

const MAP = 'first we map the user journey on one simple page';
const CUT = 'then we cut every step that does not help the first win';
const TEST = 'after that we test it with five real customers this week';
const SHIP = 'finally we ship the smallest version and measure what changed';
const OPENING = 'this is exactly how figma';

describe('golden 1: revolutionized / redefined mash', () => {
  it('in-place swap in one breath keeps only "redefined" and one opening', () => {
    const {captions} = cutsStack(buildSpeech([
      {say: `${OPENING} revolutionized redefined collaboration in design for design`}, {gap: 0.7}, {say: MAP}, {gap: 0.7}, {say: CUT}, {gap: 0.7}, {say: TEST},
    ]));
    expect(captions).not.toContain('revolutionized');
    expect(captions).toContain(`${OPENING} redefined collaboration in design for design`);
    expect(count(captions, OPENING)).toBe(1);
  });
  it('restart in the same breath keeps the restatement only', () => {
    const {captions} = cutsStack(buildSpeech([
      {say: `${OPENING} revolutionized ${OPENING} redefined collaboration in design for design`}, {gap: 0.7}, {say: MAP}, {gap: 0.7}, {say: CUT}, {gap: 0.7}, {say: TEST},
    ]));
    expect(captions).not.toContain('revolutionized');
    expect(captions).toContain('redefined collaboration in design for design');
    expect(count(captions, OPENING)).toBe(1);
  });
  it('two separate takes (revolutionized, then redefined) keep one coherent take', () => {
    const {captions} = cutsStack(buildSpeech([
      {say: `${OPENING} revolutionized collaboration in design for design`}, {gap: 1.0},
      {say: `${OPENING} redefined collaboration in design for design teams`}, {gap: 0.8},
      {say: MAP}, {gap: 0.8}, {say: CUT}, {gap: 0.8}, {say: TEST}, {gap: 0.8}, {say: SHIP},
    ]));
    expect(captions).not.toContain('revolutionized');
    expect(captions).toContain('redefined collaboration in design for design teams');
    expect(count(captions, OPENING)).toBe(1);
  });
});

describe('golden 2: coach echo', () => {
  const tail = [{gap: 0.9}, {say: MAP}, {gap: 0.8}, {say: CUT}, {gap: 0.8}, {say: TEST}] as const;
  it.each([
    ['say', 'say figma redefined collaboration'],
    ['ok say', 'ok say figma redefined collaboration'],
    ['bare short prompt', 'figma redefined collaboration'],
  ])('%s: only the creator line is kept', (_name, prompt) => {
    const {captions} = cutsStack(buildSpeech([{say: prompt}, {gap: 1.5}, {say: 'figma redefined collaboration in design'}, ...tail]));
    expect(count(captions, 'figma redefined collaboration')).toBe(1);
    expect(captions).toContain('figma redefined collaboration in design');
    expect(captions).not.toMatch(/\bsay\b/);
    expect(captions).not.toMatch(/\bok\b/);
    for (const beat of [MAP, CUT, TEST]) expect(captions).toContain(beat);
  });
});

describe('golden 3: yeahs between real sentences', () => {
  it('stacked and pause-bounded yeahs are gone, each sentence stays once', () => {
    const {captions} = cutsStack(buildSpeech([
      {say: MAP}, {gap: 0.3}, {say: 'yeah'}, {gap: 0.3}, {say: 'yeah yeah'}, {gap: 0.3},
      {say: CUT}, {gap: 0.25}, {say: 'yep'}, {gap: 0.3}, {say: TEST}, {gap: 0.3}, {say: 'yeah.'}, {gap: 0.3}, {say: SHIP},
    ]));
    expect(captions).not.toMatch(/\b(yeah|yep|yup)\b/);
    for (const sentence of [MAP, CUT, TEST, SHIP]) expect(count(captions, sentence), sentence).toBe(1);
    expect(captions).toBe([MAP, CUT, TEST, SHIP].join(' '));
  });
});

describe('golden 4: three near-duplicate full sentences', () => {
  it('exactly one is kept, the fullest last one', () => {
    const {captions} = cutsStack(buildSpeech([
      {say: 'the best onboarding tip is to show one clear win in the first minute'}, {gap: 1.0},
      {say: 'the best onboarding tip is to show one clear win in the very first minute'}, {gap: 1.0},
      {say: 'the best onboarding tip is to show one clear win in the very first minute of the app'}, {gap: 0.8},
      {say: MAP}, {gap: 0.8}, {say: CUT}, {gap: 0.8}, {say: TEST}, {gap: 0.8}, {say: SHIP},
    ]));
    expect(count(captions, 'the best onboarding tip')).toBe(1);
    expect(captions).toContain('the best onboarding tip is to show one clear win in the very first minute of the app');
    expect(captions).toBe(`the best onboarding tip is to show one clear win in the very first minute of the app ${[MAP, CUT, TEST, SHIP].join(' ')}`);
  });
});
