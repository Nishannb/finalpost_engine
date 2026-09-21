import {describe, expect, it} from 'vitest';

import {occupancyFromSpeaker} from '../layout/occupancy.ts';
import {audioFacts, resolveWordRange} from './perception.ts';
import {compileWordRanges, dropUnfactual, validateCompiled} from './validator.ts';
import type {PerceptionPack, WordRef} from './types.ts';

function pack(words: WordRef[], transcript: string): PerceptionPack {
  return {
    words,
    sentences: [],
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

describe('director v2 compiler/validator', () => {
  it('resolves word ranges to speech time', () => {
    const range = resolveWordRange(words, 'w1', 'w3', 0, 200);
    expect(range?.start).toBeCloseTo(1.3, 5);
    expect(range?.end).toBeCloseTo(2.7, 5);
  });

  it('drops unknown word ids', () => {
    const result = compileWordRanges(pack(words, 'This hoodie sold out'), [
      {
        id: 'e1',
        kind: 'lockup',
        wordRange: {startWordId: 'w9', endWordId: 'w10'},
        overlayText: 'hoodie',
      },
    ]);
    expect(result.elements).toEqual([]);
    expect(result.violations[0]?.code).toBe('bad_word_range');
  });

  it('flags unfactual overlay numbers and drops them', () => {
    const perception = pack(words, 'This hoodie sold out');
    const compiled = compileWordRanges(perception, [
      {
        id: 'e2',
        kind: 'lockup',
        wordRange: {startWordId: 'w0', endWordId: 'w3'},
        overlayText: '1M+ COMMUNITY',
      },
    ]);
    const factual = dropUnfactual(perception, compiled.elements);
    expect(factual.elements).toEqual([]);
    expect(factual.drops[0]).toMatch(/unfactual/);
  });

  it('flags a graphic parked on the speaker', () => {
    const perception = pack(words, 'This hoodie sold out yesterday');
    perception.occupancySlices[0] = {
      atSec: 2,
      occupancy: occupancyFromSpeaker({x: 0.62, y: 0.04, w: 0.36, h: 0.32}, 'vision'),
    };
    const compiled = compileWordRanges(perception, [
      {
        id: 'e3',
        kind: 'lockup',
        wordRange: {startWordId: 'w0', endWordId: 'w3'},
        overlayText: 'hoodie sold',
        anchor: 'top_right',
      },
    ]);
    const violations = validateCompiled(perception, compiled.elements);
    expect(violations.some(item => item.code === 'occludes_speaker')).toBe(true);
  });

  it('allows cutout over the speaker box', () => {
    const perception = pack(words, 'This hoodie sold out');
    const compiled = compileWordRanges(perception, [
      {
        id: 'e4',
        kind: 'cutout',
        wordRange: {startWordId: 'w0', endWordId: 'w3'},
        layout: 'cutout',
        overlayText: '',
      },
    ]);
    const violations = validateCompiled(perception, compiled.elements);
    expect(violations.some(item => item.code === 'occludes_speaker')).toBe(false);
  });

  it('allows inset_reveal over the speaker box', () => {
    const perception = pack(words, 'This hoodie sold out');
    const compiled = compileWordRanges(perception, [
      {
        id: 'e4c',
        kind: 'inset_reveal',
        wordRange: {startWordId: 'w0', endWordId: 'w3'},
        overlayText: '',
      },
    ]);
    const insetViolations = validateCompiled(perception, compiled.elements);
    expect(insetViolations.some(item => item.code === 'occludes_speaker')).toBe(false);
  });

  it('allows depth_overlay over the speaker box', () => {
    const perception = pack(words, 'This hoodie sold out');
    const compiled = compileWordRanges(perception, [
      {
        id: 'e4b',
        kind: 'depth_overlay',
        wordRange: {startWordId: 'w0', endWordId: 'w3'},
        overlayText: '',
      },
    ]);
    const violations = validateCompiled(perception, compiled.elements);
    expect(violations.some(item => item.code === 'occludes_speaker')).toBe(false);
  });

  it('allows graphics when occupancy is only a guessed fallback box', () => {
    const perception = pack(words, 'This hoodie sold out yesterday');
    perception.occupancySlices[0] = {
      atSec: 2,
      occupancy: occupancyFromSpeaker({x: 0.18, y: 0.16, w: 0.64, h: 0.62}, 'fallback'),
    };
    const compiled = compileWordRanges(perception, [
      {
        id: 'e5',
        kind: 'kinetic_text',
        wordRange: {startWordId: 'w0', endWordId: 'w3'},
        overlayText: 'hoodie sold',
        anchor: 'top_left',
      },
    ]);
    const violations = validateCompiled(perception, compiled.elements);
    expect(violations.some(item => item.code === 'occludes_speaker')).toBe(false);
  });
});
