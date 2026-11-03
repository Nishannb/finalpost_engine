import {describe, expect, it} from 'vitest';

import {occupiedByExistingEdits} from './buildGeneratedGraphics.ts';
import {assembleDirectedGraphics, buildMotionDirectorPrompt, defaultMaxGraphics, type TimedWord} from './motionDirector.ts';

/** Evenly timed words: word i spans [i*0.5, i*0.5+0.45]. */
const timed = (text: string): TimedWord[] =>
  text.split(/\s+/).map((word, index) => ({text: word, start: index * 0.5, end: index * 0.5 + 0.45}));

const englishWords = timed(
  'Never do these three things if you want to go viral one control emotions two use nine hashtags in three sections three nice transitions and our revenue went from two million to ten million follow me',
);
const nepaliWords = timed('हाम्रो बिक्री ८५ प्रतिशतले बढ्यो र ग्राहक संख्या १०,००० पुग्यो पहिलो चरण दोस्रो चरण तेस्रो चरण धन्यवाद');
const japaneseWords = timed('売上 は 二百 万円 から 一千 万円 に 増え ました 手順 は 三つ です 撮影 編集 投稿 です ありがとう');

const base = {outputDurationSec: 22, occupied: [], maxGraphics: 4};

const graphic = (overrides: Record<string, unknown>) => ({
  id: 'g',
  anchorWordIndex: 0,
  durationSeconds: 3,
  reason: 'r',
  goal: 'goal',
  visualDescription: 'visual',
  placement: 'full_screen',
  contentJson: '{"title":"x"}',
  ...overrides,
});

describe('assembleDirectedGraphics', () => {
  it('times English briefs from their anchor word and keeps the brief schema', () => {
    const raw = {
      graphics: [
        graphic({id: 'three-rules', anchorWordIndex: 10, durationSeconds: 4, placement: 'split_screen', graphicSide: 'bottom',
          contentJson: '{"title":"3 rules","steps":["Control emotions","9 hashtags, 3 sections","Nice transitions"]}'}),
        graphic({id: 'revenue', anchorWordIndex: 29, durationSeconds: 3.5, contentJson: '{"from":"$2M","to":"$10M"}',
          designIntent: {emphasis: ['$10M'], tone: 'confident'}}),
      ],
      notes: 'two moments',
    };
    const {graphics, refusals} = assembleDirectedGraphics(raw, {...base, words: englishWords});
    expect(refusals).toEqual([]);
    expect(graphics.map(item => [item.brief.id, item.start, item.end, item.brief.placement])).toEqual([
      ['three-rules', 5, 9, 'split_screen'],
      ['revenue', 14.5, 18, 'full_screen'],
    ]);
    expect(graphics[0]!.brief.graphicSide).toBe('bottom');
    expect(graphics[1]!.brief.durationSeconds).toBe(3.5);
    expect(graphics[1]!.brief.content).toEqual({from: '$2M', to: '$10M'});
  });

  it('keeps Nepali and Japanese copy byte-for-byte (numbers, currency, percentages, mixed scripts)', () => {
    const ne = assembleDirectedGraphics(
      {graphics: [graphic({id: 'sales', anchorWordIndex: 1, placement: 'pip', box: {x: 0.55, y: 0.08, w: 0.4, h: 0.2},
        contentJson: '{"value":"८५%","label":"बिक्री वृद्धि","note":"Customers: १०,०००"}'})]},
      {...base, words: nepaliWords},
    );
    expect(ne.refusals).toEqual([]);
    expect(ne.graphics[0]!.brief.content).toEqual({value: '८५%', label: 'बिक्री वृद्धि', note: 'Customers: १०,०००'});

    const ja = assembleDirectedGraphics(
      {graphics: [graphic({id: 'growth', anchorWordIndex: 0, contentJson: '{"from":"¥200万","to":"¥1,000万","label":"売上が5倍に増えました"}'})]},
      {...base, words: japaneseWords},
    );
    expect(ja.graphics[0]!.brief.content).toEqual({from: '¥200万', to: '¥1,000万', label: '売上が5倍に増えました'});
  });

  it('treats emphasis text and frame insets as occupied, so no graphic is generated over them', () => {
    const occupied = occupiedByExistingEdits({
      brollClips: [],
      visualOverlays: [],
      motionGraphics: [{start: 13.4, end: 16.48}] as never,
      semanticEmphasis: [{start: 13.4, end: 15.8}] as never,
      frameInsets: [{start: 20, end: 24}] as never,
      mediaContainers: [],
      hookTitle: '',
    });
    expect(occupied.map(item => [item.what, item.start, item.end])).toEqual([
      ['kinetic text graphic', 13.4, 16.48],
      ['emphasis text', 13.4, 15.8],
      ['frame inset', 20, 24],
    ]);
    const {graphics, refusals} = assembleDirectedGraphics(
      {graphics: [graphic({id: 'on-emphasis', anchorWordIndex: 28})]},
      {...base, outputDurationSec: 40, occupied, words: Array.from({length: 40}, (_, index) => ({text: `w${index}`, start: index * 0.5, end: index * 0.5 + 0.45}))},
    );
    expect(graphics).toHaveLength(0);
    expect(refusals[0]!.reason).toContain('overlaps existing edit');
  });

  it('drops (never moves) graphics that collide with existing edits or each other', () => {
    const occupied = occupiedByExistingEdits({
      brollClips: [{start: 2, end: 4.5}] as never,
      visualOverlays: [{start: 12, end: 14, layout: 'split'}] as never,
      motionGraphics: [],
      mediaContainers: [],
      hookTitle: 'Never do these',
      hookStartSec: 0,
      hookDurationSec: 1.5,
    });
    expect(occupied.map(item => item.what)).toEqual(['hook title', 'B-roll cutaway', 'B-roll/overlay (split)']);
    const raw = {
      graphics: [
        graphic({id: 'over-hook', anchorWordIndex: 1}),
        graphic({id: 'over-broll', anchorWordIndex: 6}),
        graphic({id: 'ok', anchorWordIndex: 10}),
        graphic({id: 'clashes-ok', anchorWordIndex: 12}),
        graphic({id: 'over-split', anchorWordIndex: 23}),
      ],
    };
    const {graphics, refusals} = assembleDirectedGraphics(raw, {...base, occupied, words: englishWords});
    expect(graphics.map(item => item.brief.id)).toEqual(['ok']);
    expect(refusals.map(item => [item.id, item.reason.split(' (')[0]])).toEqual([
      ['over-hook', 'overlaps existing edit'],
      ['over-broll', 'overlaps existing edit'],
      ['over-split', 'overlaps existing edit'],
      ['clashes-ok', 'overlaps graphic ok'],
    ]);
  });

  it('drops PiP/overlay boxes that would sit on the captions', () => {
    const captionBand = {top: 0.67, bottom: 0.8};
    const raw = {
      graphics: [
        graphic({id: 'pip-on-captions', anchorWordIndex: 6, placement: 'pip', box: {x: 0.1, y: 0.76, w: 0.8, h: 0.18}}),
        graphic({id: 'pip-top', anchorWordIndex: 14, placement: 'pip', box: {x: 0.5, y: 0.08, w: 0.42, h: 0.2}}),
        graphic({id: 'overlay-full', anchorWordIndex: 22, placement: 'overlay'}),
      ],
    };
    const {graphics, refusals} = assembleDirectedGraphics(raw, {...base, words: englishWords, captionBand});
    expect(graphics.map(item => item.brief.id)).toEqual(['pip-top', 'overlay-full']);
    expect(refusals).toEqual([{id: 'pip-on-captions', reason: 'pip box overlaps the caption band (y 0.67-0.80)', start: 3, end: 6}]);
  });

  it('refuses malformed model output with a reason', () => {
    const raw = {
      graphics: [
        graphic({id: 'bad-json', contentJson: '{title: nope}'}),
        graphic({id: 'array', contentJson: '["a"]'}),
        graphic({id: 'empty', contentJson: '{}'}),
        graphic({id: 'no-word', anchorWordIndex: 999}),
        graphic({id: 'left-right', placement: 'split_left'}),
        graphic({id: 'no-side', anchorWordIndex: 20, placement: 'split_screen'}),
        graphic({id: 'tiny-pip', anchorWordIndex: 26, placement: 'pip', box: {x: 0.5, y: 0.1, w: 0.05, h: 0.05}}),
        graphic({id: 'too-short', anchorWordIndex: englishWords.length - 1, durationSeconds: 5}),
      ],
    };
    const {graphics, refusals} = assembleDirectedGraphics(raw, {...base, words: englishWords, outputDurationSec: 18.2});
    expect(graphics).toEqual([]);
    expect(Object.fromEntries(refusals.map(item => [item.id, item.reason]))).toMatchObject({
      'bad-json': 'contentJson is not valid JSON',
      array: 'contentJson must be a JSON object',
      empty: expect.stringMatching(/content is empty/),
      'no-word': 'anchorWordIndex 999 is not a word',
      'left-right': expect.stringMatching(/invalid brief: placement/),
      'no-side': expect.stringMatching(/graphicSide/),
      'tiny-pip': expect.stringMatching(/at least 0.12/),
      'too-short': expect.stringMatching(/too short/),
    });
  });

  it('accepts no graphics and enforces the maximum', () => {
    expect(assembleDirectedGraphics({graphics: []}, {...base, words: englishWords}).graphics).toEqual([]);
    expect(assembleDirectedGraphics(null, {...base, words: englishWords}).graphics).toEqual([]);
    const many = {graphics: [0, 8, 16, 24, 32].map(i => graphic({id: `g${i}`, anchorWordIndex: i, durationSeconds: 2}))};
    const {graphics, refusals} = assembleDirectedGraphics(many, {...base, words: englishWords, maxGraphics: 2});
    expect(graphics).toHaveLength(2);
    expect(refusals.filter(item => /maximum/.test(item.reason))).toHaveLength(3);
    expect(defaultMaxGraphics(41.7)).toBe(5);
    expect(defaultMaxGraphics(6)).toBe(1);
  });
});

describe('buildMotionDirectorPrompt', () => {
  it('lists occupied intervals and indexed, timed words in any script', () => {
    const prompt = buildMotionDirectorPrompt({
      transcript: 'हाम्रो बिक्री ८५ प्रतिशतले बढ्यो',
      words: nepaliWords.slice(0, 4),
      outputDurationSec: 10,
      languageCode: 'ne',
      occupied: [{start: 1, end: 2.5, what: 'B-roll cutaway'}],
    });
    expect(prompt).toContain('- 1.00-2.50 s: B-roll cutaway');
    expect(prompt).toContain('[2] 1.00-1.45 ८५');
    expect(prompt).toContain('Maximum graphics: 1');
  });
});
