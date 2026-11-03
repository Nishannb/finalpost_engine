/**
 * WP10F: screenshot callouts (TweetCard / WikiCallout) must win on the explain path, TopicPills take the plate palette, and the open slice never ends on a dangling connector. Offline.
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {platePalette} from '../../../../remotion/src/motion/palette.ts';
import {remapLookForUnusableMatte, resolveEditLook} from '../directorV2/editLooks.ts';
import {libraryGraphicSource, resolveLibraryGraphic} from '../motionDirector/libraryRegistry.ts';
import {validateGraphicSource} from '../../motionWorker/worker.ts';
import {seedLibraryGraphics} from '../motionDirector/transcriptLibrarySeed.ts';
import {isGroundedInTranscript} from './groundedText.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const remapped = remapLookForUnusableMatte(resolveEditLook('talking_head'), false).resolution.look;
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
const seedOf = (words: ReturnType<typeof timed>) => seedLibraryGraphics({words, outputDurationSec: Math.ceil(words[words.length - 1]!.end + 1), lookId: remapped.id, explainPlates: true});
const comps = (seed: ReturnType<typeof seedOf>) => Object.values(seed.compositions);
const isCallout = (id: string) => id === 'TweetCard' || id === 'WikiCallout';

// jensen-like: 28+ word opener, then advice / hire / choice speech and a few plain key lines that would become QuoteCallouts.
const OPENER = 'Today and I have a choice between two one that could change everything for the company I am building and the people who trust me to decide it well and quickly';
const BODY = [
  'She posted that you should hire the expert and trust their advice every time.',
  'Curiosity is the only advantage that keeps compounding over time always.',
  'Practice builds confidence slowly through repeated attempts and honest feedback.',
  'According to the study the right choice is rarely the comfortable one when the stakes are high and the team is watching closely for a signal from you.',
  'Then keep the standard high and ship it anyway today.',
];

describe('WP10F 1) screenshot callouts win on the explain path', () => {
  const words = timed([OPENER, ...BODY]);
  const seed = seedOf(words);
  it('the jensen-like transcript seeds an OpenPlate AND a TweetCard or WikiCallout', () => {
    expect(comps(seed)).toContain('OpenPlate');
    expect(comps(seed).some(isCallout)).toBe(true);
    expect(seed.raw.graphics.length).toBeLessThanOrEqual(seed.limit);
  });
  it('a QuoteCallout alone does not satisfy the guarantee: where only quote cards compete, a callout still replaces one of them', () => {
    const result = seedOf(words);
    const quotes = comps(result).filter(id => id === 'QuoteCallout').length;
    expect(comps(result).filter(isCallout).length).toBeGreaterThanOrEqual(1);
    // the same seeds without any claim cue have quote cards and no callout, so the callout above is what the rule added
    const noCue = seedOf(timed(['Pick one metric and protect it from everything else around you now', 'Curiosity keeps compounding over long periods of quiet time', 'Practice builds confidence slowly through repeated attempts and honest feedback', 'Small habits compound into something very large over time and effort']));
    expect(comps(noCue).some(isCallout)).toBe(false);
    expect(quotes).toBeLessThanOrEqual(seed.limit);
  });
  it('with the cap full of quote / headline plates, a callout replaces the lowest-ranked non-open plate (QuoteCallout included)', () => {
    const crowded = timed(
      [
        OPENER,
        'Curiosity is the only advantage that keeps compounding over time always.',
        'Practice builds confidence slowly through repeated attempts and honest feedback.',
        'Most teams choose between speed and quality every single week.',
        'Roughly 85 percent of projects slip without a clear owner.',
        'She posted that you should hire the expert and trust their advice every time.',
      ],
      0.28,
      4.5,
    );
    const result = seedOf(crowded);
    expect(comps(result)).toContain('OpenPlate');
    expect(comps(result).some(isCallout)).toBe(true);
    expect(result.raw.graphics.length).toBeLessThanOrEqual(result.limit);
  });
  it('short advice lines (5-12 words) -> TweetCard, 13+ word claims -> WikiCallout, both verbatim with highlight words from the passage; a >24 word claim is sliced to a contiguous run', () => {
    const transcript = words.map(word => word.text).join(' ');
    for (const graphic of seed.raw.graphics) {
      const composition = seed.compositions[graphic.id];
      if (!composition || !isCallout(composition)) continue;
      const content = JSON.parse(graphic.contentJson) as {body?: string; passage?: string; highlight: string[]};
      const text = content.body ?? content.passage!;
      expect(isGroundedInTranscript(text, transcript)).toBe(true);
      expect(transcript.toLowerCase()).toContain(text.toLowerCase());
      expect(content.highlight.length).toBeGreaterThanOrEqual(1);
      for (const word of content.highlight) expect(text).toContain(word);
      const count = text.split(/\s+/).length;
      expect(composition).toBe(count >= 13 ? 'WikiCallout' : 'TweetCard');
      expect(count).toBeLessThanOrEqual(28); // WP52: cued wiki passages (after the article cue) may run to 28 words
      expect(resolveLibraryGraphic({goal: graphic.goal, visualDescription: graphic.visualDescription, placement: graphic.placement, content})?.compositionId).toBe(composition);
    }
    const longClaim = timed(['You should never hire anyone who cannot explain the hardest decision they made and what they would change about it if they were to face the same situation again tomorrow morning at work', ...BODY.slice(1)]);
    const sliced = seedOf(longClaim).raw.graphics.map(graphic => JSON.parse(graphic.contentJson) as {passage?: string}).find(content => content.passage);
    if (sliced) expect(sliced.passage!.split(/\s+/).length).toBeLessThanOrEqual(28); // WP52
  });
  it('source pin: the guarantee names TweetCard / WikiCallout only', () => {
    const source = read('../motionDirector/transcriptLibrarySeed.ts');
    expect(source).toContain("new Set(['TweetCard', 'WikiCallout', 'NewspaperCallout'])"); // WP13D: the newspaper clipping is a screenshot callout too
    expect(source).toContain('a quote card is NOT a screenshot callout');
  });
});

describe('WP10F 2) TopicPills use the plate palette', () => {
  it('colours come from usePlatePalette (paper fill, ink text, marker border); no cyan or hex literal', () => {
    const source = read('../../../../remotion/src/motion/compositions/TopicPills.tsx');
    expect(source).toContain('usePlatePalette');
    for (const needle of ['color={palette.paper}', 'textColor={palette.paperInk}', 'borderColor={palette.marker}']) expect(source).toContain(needle);
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,6}\b|cyan|teal|theme\.accent/i);
    expect(read('../../../../remotion/src/motion/components/Indicators.tsx')).toContain('borderColor ?? theme.accent');
  });
  it('a cyan theme accent never becomes the pill border (marker skips karaoke cyan)', () => {
    const palette = platePalette({primary: '#2DD4BF', secondary: '#38BDF8', background: '#0B1B2B', surface: '#12283D', text: '#EAF2F8', mutedText: '#8FA6BA', accent: '#00E5FF'});
    expect(palette.marker).not.toBe('#00E5FF');
    expect(palette.marker).toBe(palette.ink);
  });
  it('the generated TopicPills module passes worker validation', async () => {
    const hit = resolveLibraryGraphic({goal: 'g', visualDescription: 'floating pills', placement: 'overlay', content: {items: ['retakes', 'fillers', 'noise']}})!;
    expect(hit.compositionId).toBe('TopicPills');
    const {report} = await validateGraphicSource(libraryGraphicSource(hit));
    expect(report).toEqual({safety: [], typecheck: [], compile: [], runtime: []});
  }, 60_000);
});

describe('WP10F 3) cleaner open slice', () => {
  const open = (sentence: string) => JSON.parse(seedOf(timed([sentence, ...BODY])).raw.graphics[0]!.contentJson) as {openTitle: string; kicker?: string; accent?: string};
  it('does not end on "two one" or any dangling connector; the run stays verbatim and contiguous', () => {
    const content = open(OPENER);
    const last = content.openTitle.split(/\s+/).pop()!.toLowerCase();
    expect(['one', 'that', 'and', 'to', 'of', 'a', 'the', 'or']).not.toContain(last);
    expect(content.openTitle.toLowerCase()).not.toMatch(/two one\b/);
    expect(OPENER.toLowerCase()).toContain(`${content.kicker ?? ''} ${content.openTitle}`.trim().toLowerCase());
  });
  it.each([
    'If you are building a company the biggest decision is between two one that matters more than anything people always say about work',
    'We have to decide between speed and quality and the other one that people always say about work every day of their life',
  ])('weak tail words are dropped: "%s"', sentence => {
    const last = open(sentence).openTitle.toLowerCase().split(/\s+/).pop()!;
    expect(['one', 'that', 'and', 'to', 'of', 'a']).not.toContain(last);
  });
  it('the arc kicker does not end on a connector when a 3-word kicker fits', () => {
    const content = open('Today and I have a choice between two options that could change everything for everyone here');
    expect(content.kicker!.split(/\s+/).pop()!.toLowerCase()).not.toBe('and');
  });
});
