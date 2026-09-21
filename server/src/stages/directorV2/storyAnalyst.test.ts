import {describe, expect, it} from 'vitest';

import {occupancyFromSpeaker} from '../layout/occupancy.ts';
import {fillTemplate} from './promptLoader.ts';
import {audioFacts} from './perception.ts';
import {beatCoverageErrors, parseStory, sentenceBeats} from './storyAnalyst.ts';
import {parseCreativePlan} from './creativeDirector.ts';
import type {PerceptionPack, WordRef} from './types.ts';

function pack(words: WordRef[], transcript: string): PerceptionPack {
  return {
    words,
    sentences: [
      {
        id: 's0',
        wordIds: words.map(word => word.id),
        start: words[0]!.start,
        end: words.at(-1)!.end,
        text: transcript,
      },
    ],
    storyboard: [],
    occupancySlices: [
      {
        atSec: 2,
        occupancy: occupancyFromSpeaker({x: 0.2, y: 0.18, w: 0.55, h: 0.64}, 'vision'),
      },
    ],
    audio: audioFacts(words),
    transcript,
    outputDurationSec: 12,
    language: 'en',
    creatorProfile: '',
    speakerCutoutAvailable: false,
    speakerCutoutNote: '',
    userAssets: [],
  };
}

const words: WordRef[] = [
  {id: 'w0', text: 'This', start: 1, end: 1.2, sentenceId: 's0'},
  {id: 'w1', text: 'hoodie', start: 1.3, end: 1.7, sentenceId: 's0'},
  {id: 'w2', text: 'sold', start: 1.8, end: 2.1, sentenceId: 's0'},
  {id: 'w3', text: 'out', start: 2.2, end: 2.5, sentenceId: 's0'},
];

describe('stage 1 beat coverage', () => {
  it('accepts contiguous beats over the whole transcript', () => {
    const perception = pack(words, 'This hoodie sold out');
    const story = parseStory(
      {
        content_type: 'sales_pitch',
        audience: 'shoppers',
        promise: 'The hoodie sold out',
        tone: 'urgent',
        emotional_arc: [{phase: 'payoff', start_word_id: 'w0', end_word_id: 'w3', feeling: 'proof'}],
        hook: {
          start_word_id: 'w0',
          end_word_id: 'w1',
          stopping_power: 3,
          weakness: 'slow start',
          cold_open: {recommended: false, start_word_id: 'w0', end_word_id: 'w1', reason: ''},
        },
        core_message: 'It sold out',
        beats: [
          {
            id: 'b1',
            start_word_id: 'w0',
            end_word_id: 'w1',
            role: 'hook',
            importance: 5,
            energy: 3,
            what_is_on_screen: 'talking',
            viewer_need: 'hook',
            speaker_presence: 'required',
            visual_potential: 'light',
          },
          {
            id: 'b2',
            start_word_id: 'w2',
            end_word_id: 'w3',
            role: 'claim',
            importance: 4,
            energy: 4,
            what_is_on_screen: 'talking',
            viewer_need: 'see sold out',
            speaker_presence: 'preferred',
            visual_potential: 'strong',
          },
        ],
        existing_cta: {present: false, suggested: true, suggested_beat_id: 'b2', suggested_spoken_line: 'Comment SOLD'},
        pacing: [{beat_ids: ['b1', 'b2'], target: 'medium', why: 'steady'}],
        risks: [],
      },
      0,
      perception,
    );
    expect(beatCoverageErrors(story.beats, perception)).toEqual([]);
  });

  it('falls back to sentence beats when coverage has a gap', () => {
    const perception = pack(words, 'This hoodie sold out');
    const broken = parseStory(
      {
        beats: [
          {
            id: 'b1',
            start_word_id: 'w0',
            end_word_id: 'w0',
            role: 'hook',
            importance: 5,
            energy: 3,
            what_is_on_screen: 'talking',
            viewer_need: 'hook',
            speaker_presence: 'required',
            visual_potential: 'none',
          },
        ],
      },
      0,
      perception,
    );
    expect(beatCoverageErrors(broken.beats, perception).length).toBeGreaterThan(0);
    const fallback = sentenceBeats(perception);
    expect(beatCoverageErrors(fallback, perception)).toEqual([]);
    expect(fallback[0]?.startWordId).toBe('w0');
    expect(fallback.at(-1)?.endWordId).toBe('w3');
  });
});

describe('stage 2 parse + hook', () => {
  it('does not inject a hook_title when the model omits one', () => {
    const perception = pack(words, 'This hoodie sold out');
    const plan = parseCreativePlan(
      {
        edit_thesis: {
          look: 'cream type',
          rhythm: 'quiet then punch',
          motion_language: 'slow springs',
          color_story: 'warm',
          why: 'matches the drop',
        },
        cold_open: {use: false},
        caption_style: {template: 'clean', position: 'bottom'},
        elements: [
          {
            id: 'e1',
            beat_id: 'b2',
            intent: 'Show the sellout',
            kind: 'lockup',
            start_word_id: 'w2',
            end_word_id: 'w3',
            text: 'sold out',
          },
        ],
        cta: {start_word_id: 'w3', end_word_id: 'w3', keyword: 'sold', suggested: true},
      },
      0,
      perception,
    );
    expect(plan.elements.some(element => element.kind === 'hook_title')).toBe(false);
    expect(plan.hookTitle.length).toBe(0);
    expect(plan.hookStyle).not.toBe('impact');
  });
});

describe('prompt placeholders', () => {
  it('fills runtime tokens without rewriting the prompt prose', () => {
    const filled = fillTemplate(
      'Video duration (output timeline): {{OUTPUT_DURATION_SEC}} seconds\nLanguage: {{LANGUAGE}}',
      {OUTPUT_DURATION_SEC: '12.0', LANGUAGE: 'en'},
    );
    expect(filled).toContain('12.0');
    expect(filled).toContain('Language: en');
  });
});
