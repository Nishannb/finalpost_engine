/**
 * WP56 — Color Director + kinetic fallback + stillness pacing + caption ownership + copy window + seam pin.
 */
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

import {captionMuteRanges, contentWordsOf} from '../../lib/captionMute.ts';
import {directEditColors, EDITORIAL_PAPER, isFlashyVideoColor} from './colorDirector.ts';
import {phraseRelevantToWindow} from './groundedText.ts';
import {groundOverlayText} from './legibility.ts';
import {KINETIC_STORY_IDS, planCraftTemplateBeats} from './planCraftTemplateBeats.ts';
import {
  planStillnessFrameInsets,
  STILLNESS_INSET_HOLD_SEC,
  STILLNESS_MAX_PER_60S,
  STILLNESS_MIN_GAP_SEC,
  STILLNESS_TRIGGER_SEC,
} from './stillnessFrameInsets.ts';

const talk = [
  {text: 'Welcome', start: 2, end: 2.4},
  {text: 'to', start: 2.4, end: 2.55},
  {text: 'the', start: 2.55, end: 2.7},
  {text: 'channel.', start: 2.7, end: 3.2},
  {text: 'Most', start: 12, end: 12.3},
  {text: 'importantly', start: 12.3, end: 13.0},
  {text: 'pay', start: 13.1, end: 13.3},
  {text: 'attention.', start: 13.3, end: 13.9},
  {text: 'Good', start: 20, end: 20.3},
  {text: 'editing', start: 20.3, end: 20.7},
  {text: 'feels', start: 20.7, end: 21.0},
  {text: 'invisible.', start: 21.0, end: 21.6},
  {text: 'Two', start: 28, end: 28.2},
  {text: 'hundred', start: 28.2, end: 28.5},
  {text: 'people', start: 28.5, end: 28.9},
  {text: 'joined.', start: 28.9, end: 29.3},
  {text: 'Just', start: 34, end: 34.2},
  {text: 'DM', start: 34.2, end: 34.4},
  {text: 'me', start: 34.4, end: 34.55},
  {text: 'for', start: 34.55, end: 34.7},
  {text: 'a', start: 34.7, end: 34.8},
  {text: 'free', start: 34.8, end: 35.1},
  {text: 'video.', start: 35.1, end: 35.5},
];

describe('WP56 stillness inset pacing', () => {
  it('holds ~5.5s, max one per open span, never 4 starts inside 8s', () => {
    expect(STILLNESS_INSET_HOLD_SEC).toBe(5.5);
    expect(STILLNESS_MIN_GAP_SEC).toBe(12);
    expect(STILLNESS_MAX_PER_60S).toBe(2);
    const {insets} = planStillnessFrameInsets({durationSec: 20, marginColor: '#FAFAF7'});
    expect(insets).toHaveLength(1);
    expect(insets[0]!.start).toBeGreaterThanOrEqual(STILLNESS_TRIGGER_SEC - 1e-6);
    expect(insets[0]!.end - insets[0]!.start).toBeGreaterThanOrEqual(5.5 * 0.85);
    expect(insets[0]!.marginColor).toBe('#FAFAF7');
    // spam window: a long open span must still place only one inset
    const spam = planStillnessFrameInsets({durationSec: 40, maxInsets: 10});
    expect(spam.insets.length).toBeLessThanOrEqual(2);
    const startsIn8 = spam.insets.filter(i => i.start >= 3 && i.start < 11);
    expect(startsIn8.length).toBeLessThanOrEqual(1);
  });
});

describe('WP56 kinetic owned-empty fallback', () => {
  it('owned empty falls back to deterministic; owned with a valid pick keeps only that pick', () => {
    const plan = (directed?: {candidates: any[]; owned: boolean}) =>
      planCraftTemplateBeats({
        skill: 'explainer',
        durationSec: 40,
        words: talk,
        subjectBox: {x: 0.2, y: 0.35, w: 0.6, h: 0.55},
        directed,
      });
    const story = (p: ReturnType<typeof plan>) => p.beats.filter(b => (KINETIC_STORY_IDS as readonly string[]).includes(b.templateId));

    const emptyOwned = plan({candidates: [], owned: true});
    expect(emptyOwned.warnings).toContain('kinetic_type:director_empty_fallback');
    expect(story(emptyOwned).length).toBeGreaterThan(0);

    const one = plan({candidates: [{template: 'type_staggered_phrase', text: 'Good editing feels invisible.', start: 20, end: 22}], owned: true});
    expect(story(one).map(b => b.templateId)).toEqual(['clip_47_type_staggered_phrase']);
    expect(one.warnings).toContain('kinetic_type:director:1_of_1:owned');
  });
});

describe('WP56 Color Director', () => {
  it('sales / explainer → paper editorial, not neon lime or navy web blue', () => {
    const sales = directEditColors({
      skill: 'default',
      words: talk.map(w => w.text),
      videoEdit: true,
      forcePreferred: true,
    });
    expect(sales.palette.id).toBe('editorial_paper');
    expect(sales.palette.ground.toLowerCase()).toMatch(/^#f/);
    expect(isFlashyVideoColor(sales.palette.accent)).toBe(false);
    expect(isFlashyVideoColor(sales.themeOverride.background)).toBe(false);
    expect(sales.warning).toMatch(/^polish_color_director:editorial_paper:/);

    const news = directEditColors({skill: 'newsroom_mg', words: ['bank', 'policy', 'yuan', 'reserve']});
    expect(news.palette.id).toBe('newsroom_red_ink');
    expect(EDITORIAL_PAPER.ground).toBe('#FAFAF7');
  });
});

describe('WP56 caption mute — textless full_screen keeps captions', () => {
  it('mutes StatHighlight text plates; leaves ImageRun-style empty content unmuted', () => {
    const words = talk.map(w => ({text: w.text, start: w.start, end: w.end}));
    const contentById = new Map<string, unknown>([
      ['stat', {value: {to: 200}, label: 'people'}],
      ['photos', {imageRun: [{src: 'https://example.com/a.jpg'}, {src: 'https://example.com/b.jpg'}]}],
    ]);
    const ranges = captionMuteRanges({
      graphics: [
        {id: 'stat', start: 28, end: 32, placement: {mode: 'full_screen'}},
        {id: 'photos', start: 10, end: 16, placement: {mode: 'full_screen'}},
      ],
      contentById,
      captionWords: words,
    });
    expect(contentWordsOf({imageRun: [{src: 'https://x'}]})).toEqual(new Set());
    expect(ranges.some(r => r.startSec === 28)).toBe(true);
    expect(ranges.some(r => r.startSec === 10)).toBe(false);
  });
});

describe('WP56 overlay copy must match section window', () => {
  it('phraseRelevantToWindow refuses off-section slogans; groundOverlayText drops them', () => {
    expect(phraseRelevantToWindow('beginners want first sale', 'two hundred people joined')).toBe(false);
    expect(phraseRelevantToWindow('two hundred people', 'two hundred people joined')).toBe(true);

    const result = groundOverlayText(
      [
        {layout: 'chip', overlayText: 'attention', start: 40, end: 44, keyword: 'attention'},
        {layout: 'chip', overlayText: 'attention', start: 12.5, end: 14, keyword: 'attention'},
      ],
      talk.map(w => w.text).join(' '),
      talk,
    );
    // "attention" only spoken ~13.3–13.9 — plate at 40s is a context mismatch (dropped); in-window kept
    expect(result.dropped.some(o => o.start === 40)).toBe(true);
    expect(result.contextMismatched?.some(o => o.start === 40)).toBe(true);
    expect(result.overlays.some(o => o.start === 12.5 && o.overlayText === 'attention')).toBe(true);
  });
});

describe('WP56 Explainer B seam blur', () => {
  it('ExplainerLayoutB paints a feathered / blurred seam band', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '../../../../remotion/src/components/ExplainerLayouts.tsx');
    const src = readFileSync(root, 'utf8');
    expect(src).toMatch(/data-explainer-seam-blur/);
    expect(src).toMatch(/maskImage/);
    expect(src).toMatch(/blur\(10px\)/);
  });
});

describe('WP56 analyze pins', () => {
  it('analyzeVideo wires Color Director, kinetic owned-empty, paper stillness margin, window grounding', () => {
    const analyze = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../pipeline/analyzeVideo.ts'), 'utf8');
    expect(analyze).toMatch(/directEditColors/);
    expect(analyze).toMatch(/kineticTypeDirected\.length > 0/);
    expect(analyze).toMatch(/#FAFAF7/);
    expect(analyze).toMatch(/groundOverlayText\(broll\.overlays, transcription\.transcript, captionWords\)/);
    expect(analyze).toMatch(/legibility:context_mismatch_dropped/);
  });
});
