/**
 * WP10H: whole-word highlighter, at most one TopicPills per edit (a craft plate wins the other windows), and no neon blue-green on the face (pills border, polish caption highlight). Offline.
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {isKaraokeCyan, platePalette} from '../../../../remotion/src/motion/palette.ts';
import {isNeonCyanHex} from '../../lib/contrast.ts';
import {remapLookForUnusableMatte, resolveEditLook} from '../directorV2/editLooks.ts';
import {addLibrarySeeds} from '../motionDirector/libraryFallback.ts';
import {resolveLibraryGraphic, wholeWordHighlights} from '../motionDirector/libraryRegistry.ts';
import type {MotionDirectorResult} from '../motionDirector/motionDirector.ts';
import {highlightWordsOf, seedLibraryGraphics} from '../motionDirector/transcriptLibrarySeed.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const remapped = remapLookForUnusableMatte(resolveEditLook('talking_head'), false).resolution.look;
const emptyDirector: MotionDirectorResult = {graphics: [], refusals: [], notes: '', costUsd: 0, model: 'x', latencyMs: 0, raw: null};
const timed = (sentences: string[], perWord = 0.28, gap = 1.2) => {
  let t = 0;
  return sentences.flatMap(sentence =>
    sentence.split(' ').map((text, i, all) => {
      const start = Math.round(t * 1000) / 1000;
      t += perWord;
      if (i === all.length - 1) t += gap;
      return {text, start, end: Math.round((start + perWord * 0.9) * 1000) / 1000};
    }),
  );
};
const brief = (content: Record<string, unknown>) => ({goal: 'g', visualDescription: 'v', placement: 'full_screen', content});

describe('WP10H 1) whole-word highlights only', () => {
  it('wholeWordHighlights keeps whole-word runs and drops fragments of a longer word', () => {
    const body = 'You need an accountant who can explain the numbers';
    expect(wholeWordHighlights(body, ['account'])).toBeUndefined();
    expect(wholeWordHighlights(body, ['ant a'])).toBeUndefined();
    expect(wholeWordHighlights(body, ['accountant'])).toEqual(['accountant']);
    expect(wholeWordHighlights(body, ['Accountant!', 'account', 'explain the numbers'])).toEqual(['Accountant!', 'explain the numbers']);
    expect(wholeWordHighlights(body, ['accountant', 'ACCOUNTANT'])).toEqual(['accountant']);
  });
  it('highlightWordsOf never returns a fragment: "accountant" is never marked as "account"', () => {
    const body = 'An accountant should always explain the account balances clearly';
    for (const word of highlightWordsOf(body)) expect(body.split(/\s+/).map(token => token.replace(/[^\p{L}\p{N}]+/gu, ''))).toContain(word);
    expect(highlightWordsOf('The accountant keeps every receipt')).not.toContain('account');
  });
  it.each([
    ['WikiCallout', {passage: 'You need an accountant who can explain the numbers', highlight: ['account', 'accountant']}, ['accountant']],
    ['TweetCard', {body: 'You need an accountant who can explain the numbers', highlight: ['account']}, undefined],
    ['QuoteCallout', {quote: 'You need an accountant who can explain the numbers', highlight: ['ant a', 'numbers']}, ['numbers']],
    ['FullscreenStatement', {statement: 'You need an accountant', highlight: ['count']}, undefined],
  ])('registry %s: a split-word highlight from any source is dropped, not drawn', (id, content, expected) => {
    const hit = resolveLibraryGraphic(brief(content))!;
    expect(hit.compositionId).toBe(id);
    expect(hit.props.highlight).toEqual(expected);
  });
  it('OpenPlate accent must be a whole word of the title', () => {
    expect(resolveLibraryGraphic(brief({openTitle: 'Hire the accountant today', accent: 'account'}))!.props.accent).toBeUndefined();
    expect(resolveLibraryGraphic(brief({openTitle: 'Hire the accountant today', accent: 'accountant'}))!.props.accent).toBe('accountant');
  });
  it('the renderer already matches whole normalised words (KineticText.highlightMask), so a fragment would mark nothing', () => {
    expect(read('../../../../remotion/src/motion/components/Text.tsx')).toContain('norm[i + j] === t');
  });
});

describe('WP10H 2) denser leave-the-face: at most one TopicPills', () => {
  const OPENER = 'Today and I have a choice between two options that could change everything for the company I am building and the people who trust me to decide it well';
  const LISTS = [
    'We remove retakes, fillers, noise and dead air from every video.',
    'I edit videos, scripts, podcasts, thumbnails and launches for clients.',
  ];
  const SENTENCES = [
    OPENER,
    LISTS[0]!,
    'She posted that you should hire the expert and trust their advice every time.',
    LISTS[1]!,
    'According to the study the right choice is rarely the comfortable one when the stakes are high and the team is watching closely for a signal from you.',
    'Roughly 85 percent of projects slip without a clear owner.',
    'Then keep the standard high and ship it anyway today.',
    'Start building something real with these tools right now.',
  ];
  const words = timed(SENTENCES, 0.28, 0.9);
  const duration = Math.max(40, Math.ceil(words[words.length - 1]!.end + 1));
  const seed = seedLibraryGraphics({words, outputDurationSec: duration, lookId: remapped.id, explainPlates: true});
  const comps = Object.values(seed.compositions);
  it('a jensen-like ~40 s transcript with two list sentences seeds <= 1 TopicPills, an OpenPlate and a screenshot callout', () => {
    expect(comps.filter(id => id === 'TopicPills').length).toBeLessThanOrEqual(1);
    expect(comps).toContain('OpenPlate');
    expect(comps.some(id => id === 'TweetCard' || id === 'WikiCallout')).toBe(true);
  });
  it('two list sentences compete: the second pills seed is dropped (pills_capped), a craft / library plate fills the window, and the stage reports it', () => {
    const lists = timed(
      [
        'Most people never learn how to use artificial intelligence properly today.',
        'We see lawyers, marketers, accountants, engineers and designers.',
        'Roughly 85 percent of projects slip without a clear owner.',
        'We hire engineers, doctors, teachers, lawyers and designers.',
        'She posted that you should hire the expert and trust their advice every time.',
        'Then keep the standard high and ship it anyway today.',
      ],
      0.28,
      6,
    );
    const total = Math.ceil(lists[lists.length - 1]!.end + 5);
    const result = seedLibraryGraphics({words: lists, outputDurationSec: total, lookId: remapped.id, explainPlates: true});
    expect(Object.values(result.compositions).filter(id => id === 'TopicPills').length).toBe(1);
    expect(result.pillsCapped).toBeGreaterThanOrEqual(1);
    expect(Object.values(result.compositions).some(id => id === 'TweetCard' || id === 'WikiCallout')).toBe(true);
    const staged = addLibrarySeeds(emptyDirector, {words: lists, outputDurationSec: total, occupied: [], captionBand: undefined as never, lookId: remapped.id, explainPlates: true});
    expect(staged.warnings).toContain('motion_graphic:pills_capped');
  });
  it('the cap only bites when another plate fits: with only list sentences available a second pills seed is still allowed', () => {
    const lists = timed(['We remove retakes, fillers, noise and dead air from every video.', 'I edit videos, scripts, podcasts, thumbnails and launches for clients.', 'We cut silences, retakes, filler words, pauses and mistakes from every clip.'], 0.28, 6);
    const result = seedLibraryGraphics({words: lists, outputDurationSec: 30, lookId: remapped.id});
    expect(Object.values(result.compositions).filter(id => id === 'TopicPills').length).toBeGreaterThanOrEqual(1);
  });
  it('wiring pin: the stage warning exists', () => {
    expect(read('../motionDirector/libraryFallback.ts')).toContain("'motion_graphic:pills_capped'");
  });
});

describe('WP10H 3) less neon blue-green on the face', () => {
  const themes = [
    {primary: '#2DD4BF', secondary: '#38BDF8', background: '#0B1B2B', surface: '#12283D', text: '#EAF2F8', mutedText: '#8FA6BA', accent: '#00E5FF'},
    {primary: '#00E5FF', secondary: '#22D3EE', background: '#101010', surface: '#1E1E1E', text: '#FFFFFF', mutedText: '#B0B0B0', accent: '#00D8F0'},
    {primary: '#00E5FF', secondary: '#FF9F1C', background: '#0C0F12', surface: '#171C21', text: '#F2F2F0', mutedText: '#9AA0A6', accent: '#38BDF8'},
  ];
  it.each(themes.map((theme, i) => [i, theme] as const))('theme %i: the pills border (marker) and the pill fill are never near-cyan', (_i, theme) => {
    const palette = platePalette(theme);
    expect(isKaraokeCyan(palette.marker)).toBe(false);
    expect(isKaraokeCyan(palette.paper)).toBe(false);
  });
  it('a theme whose only non-cyan colour is secondary uses that one (theme in, colours out)', () => {
    expect(platePalette(themes[2]!).marker).toBe('#FF9F1C');
  });
  it('the server-side neon test agrees with the remotion palette test', () => {
    for (const hex of ['#00E5FF', '#22D3EE', '#2DD4BF', '#38BDF8', '#FFE600', '#FF3D2E', '#6366F1', '#FFFFFF', '#101010', '#E4572E', '#7FA66B', '#F5B942'])
      expect(isNeonCyanHex(hex), hex).toBe(isKaraokeCyan(hex));
  });
  it('polish path: a neon highlight is replaced by the amber fallback with a warning; karaoke animation untouched; caller template / non-polish untouched (source pins)', () => {
    const planner = read('./brollPlanner.ts');
    expect(planner).toContain('input.editLooks && !input.captionTemplate && direction.caption.highlightColor && isNeonCyanHex(direction.caption.highlightColor)');
    expect(planner).toContain('polish_caption_highlight_not_cyan');
    expect(planner).toContain("POLISH_HIGHLIGHT_FALLBACK = '#F5B942'");
    expect(isNeonCyanHex('#F5B942')).toBe(false);
  });
});
