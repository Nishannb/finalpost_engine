import {describe, expect, it} from 'vitest';

import type {MotionGraphic} from '../../types/blueprint.ts';
import type {PerceptionPack, StoryAnalysis} from '../directorV2/types.ts';
import {occupancyFromSpeaker} from '../layout/occupancy.ts';
import {buildNorthStarDesign, promoteMotionDesign} from './designSystem.ts';
import {tokensFromThesis} from './thesisTokens.ts';

function pack(): PerceptionPack {
  return {
    words: [
      {id: 'w0', text: 'Build', start: 1, end: 1.4, sentenceId: 's0'},
      {id: 'w1', text: 'freedom', start: 1.4, end: 2.1, sentenceId: 's0'},
    ],
    sentences: [],
    storyboard: [],
    occupancySlices: [
      {
        atSec: 1,
        occupancy: occupancyFromSpeaker({x: 0.2, y: 0.2, w: 0.5, h: 0.5}, 'fallback'),
      },
    ],
    audio: {pauses: [], emphasisWordIds: [], energyPeaks: []},
    transcript: 'Build freedom',
    outputDurationSec: 28,
    language: 'en',
    creatorProfile: '',
    speakerCutoutAvailable: false,
    speakerCutoutNote: 'no mask',
    userAssets: [],
  };
}

function story(): StoryAnalysis {
  return {
    contentType: 'educational_tips',
    audience: 'creators',
    promise: 'freedom',
    tone: 'punchy',
    emotionalArc: [],
    hook: {
      startWordId: 'w0',
      endWordId: 'w1',
      stoppingPower: 4,
      weakness: '',
      coldOpen: {recommended: false, startWordId: 'w0', endWordId: 'w1', reason: ''},
    },
    coreMessage: 'freedom',
    beats: [
      {
        id: 'b1',
        startWordId: 'w0',
        endWordId: 'w1',
        role: 'claim',
        importance: 5,
        energy: 4,
        whatIsOnScreen: 'talking head',
        viewerNeed: 'claim',
        speakerPresence: 'required',
        visualPotential: 'strong',
        visualNow: 'face',
        speakerOnScreen: true,
      },
    ],
    existingCta: {
      present: false,
      startWordId: 'w0',
      endWordId: 'w1',
      action: 'follow',
      keyword: '',
      suggested: false,
      suggestedBeatId: '',
      suggestedSpokenLine: '',
    },
    pacing: [],
    risks: [],
    estimatedCostUsd: 0,
    promptVersion: 'test',
    inputHash: 'test',
    raw: {},
  };
}

describe('promoteMotionDesign', () => {
  it('does not inject motion graphics after Validate; suggestions only', () => {
    const existing: MotionGraphic[] = [];
    const design = buildNorthStarDesign({
      story: story(),
      tokens: tokensFromThesis('emerald'),
    });
    const out = promoteMotionDesign({
      pack: pack(),
      story: story(),
      design,
      existing,
      emphasis: [],
    });
    expect(out.motionGraphics).toEqual([]);
    expect(out.suggestions.length).toBeGreaterThan(0);
    expect(out.suggestions.some(item => item.includes('motion_graphic'))).toBe(true);
  });
});
