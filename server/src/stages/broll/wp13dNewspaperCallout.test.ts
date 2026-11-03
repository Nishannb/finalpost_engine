/**
 * WP13D: the newspaper clipping evidence plate. Offline: no render, no network.
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {NEWSPAPER_TWO_COLUMN_WORDS, newspaperColumns} from '../../../../remotion/src/motion/compositions/NewspaperCallout.tsx';
import {validateGraphicSource} from '../../motionWorker/worker.ts';
import {remapLookForUnusableMatte, resolveEditLook} from '../directorV2/editLooks.ts';
import {LIBRARY_COMPOSITIONS, libraryGraphicSource, resolveLibraryGraphic} from '../motionDirector/libraryRegistry.ts';
import {CRAFT_PLATES, plateShapeAt, seedLibraryGraphics} from '../motionDirector/transcriptLibrarySeed.ts';
import {LEAVE_THE_FACE_COMPOSITIONS} from './engagementCadence.ts';
import {isGroundedInTranscript} from './groundedText.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const comp = (name: string) => read(`../../../../remotion/src/motion/compositions/${name}.tsx`);
const remapped = remapLookForUnusableMatte(resolveEditLook('talking_head'), false).resolution.look;
const timed = (sentences: string[], perWord = 0.3, gap = 4.5) => {
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
const brief = (content: Record<string, unknown>, placement = 'full_screen') => ({goal: 'g', visualDescription: 'v', placement, content});
const OPENER = 'Today and I have a choice between two options that matter for the company I am building right now';
const NEWS = 'The headline reported that the startup raised a huge round and investors are piling in at a valuation nobody expected.';

describe('WP13D 1) registry and composition', () => {
  it('is the 15th composition, exported, in the compositions map, documented, leave-the-face and a craft plate', () => {
    expect(LIBRARY_COMPOSITIONS.length).toBe(65); // (WP50 +5, WP51 +5) WP18 added ImageRun, WP43 added TextualMgPlate, WP45 added the 4 motion-template comps, WP46 added 4 more (CLIP_05..08), WP47 added 4 more (CLIP_09..12), WP48 added 4 more (CLIP_13..16) (WP17 FlashCard, NewspaperCallout stay in)
    expect(LIBRARY_COMPOSITIONS.map(entry => entry.id)).toContain('NewspaperCallout');
    const index = read('../../../../remotion/src/motion/index.ts');
    expect(index).toMatch(/export \{NewspaperCallout\b/);
    expect(index).toMatch(/export const compositions = \{[^}]*\bNewspaperCallout\b/);
    expect(read('../../../../remotion/src/motion/README.md')).toContain('| `NewspaperCallout` |');
    expect(LEAVE_THE_FACE_COMPOSITIONS.has('NewspaperCallout')).toBe(true);
    expect(CRAFT_PLATES.has('NewspaperCallout')).toBe(true);
  });
  it('passage + newspaper:true -> NewspaperCallout (title, highlight, schedule kept when valid); plain passage is still a WikiCallout; opaque on a full screen, transparent on an overlay', () => {
    const hit = resolveLibraryGraphic(brief({passage: 'The startup raised a huge round and investors are piling in', newspaper: true, title: 'Startup raises', highlight: ['raised', 'investors'], highlightSchedule: [{word: 'raised', fromSec: 0.5, toSec: 1}, {word: 'investors', fromSec: 2, toSec: 2.5}]}))!;
    expect(hit.compositionId).toBe('NewspaperCallout');
    expect(hit.props).toMatchObject({passage: 'The startup raised a huge round and investors are piling in', title: 'Startup raises', highlight: ['raised', 'investors'], background: true});
    expect((hit.props.highlightSchedule as unknown[]).length).toBe(2);
    expect(resolveLibraryGraphic(brief({passage: 'The startup raised a huge round', newspaper: true}, 'overlay'))!.props.background).toBe(false);
    expect(resolveLibraryGraphic(brief({passage: 'The startup raised a huge round'}))!.compositionId).toBe('WikiCallout');
    expect(resolveLibraryGraphic(brief({passage: 'x y z w v', newspaper: true, highlight: ['a', 'b', 'c', 'd']}))).toBeNull(); // 4 highlights: invalid for the newspaper and for the article page, so a library miss
  });
  it('split-word highlights and schedule spans are dropped, as for the other article plates (whole words only)', () => {
    const hit = resolveLibraryGraphic(brief({passage: 'The accountant raised a billion dollars', newspaper: true, highlight: ['account', 'accountant'], highlightSchedule: [{word: 'account', fromSec: 0, toSec: 1}, {word: 'raised', fromSec: 1, toSec: 2}]}))!;
    expect(hit.props.highlight).toEqual(['accountant']);
    expect(hit.props.highlightSchedule).toBeUndefined(); // one valid span is not a walk
  });
  it('columns: short passages are one column; 14+ words are two balanced columns, verbatim and in order', () => {
    expect(newspaperColumns('only a few words here')).toEqual(['only a few words here']);
    const words = Array.from({length: NEWSPAPER_TWO_COLUMN_WORDS + 2}, (_, i) => `w${i}`);
    const [left, right] = newspaperColumns(words.join(' '));
    expect(`${left} ${right}`).toBe(words.join(' '));
    expect(Math.abs(left!.split(' ').length - right!.split(' ').length)).toBeLessThanOrEqual(1);
  });
  it.each([
    ['one column', {passage: 'The startup raised a huge round', newspaper: true, highlight: ['raised']}],
    ['two columns with a title and a schedule', {passage: 'The startup raised a huge round and investors are piling in at a valuation nobody expected last year', newspaper: true, title: 'Startup raises', highlight: ['valuation'], highlightSchedule: [{word: 'raised', fromSec: 0.4, toSec: 0.9}, {word: 'valuation', fromSec: 2, toSec: 2.5}]}],
  ])('%s: the generated module passes worker validation (contract, typecheck, compile)', async (_name, content) => {
    const hit = resolveLibraryGraphic(brief(content))!;
    expect(hit.compositionId).toBe('NewspaperCallout');
    const {report, compiled} = await validateGraphicSource(libraryGraphicSource(hit));
    expect(report).toEqual({safety: [], typecheck: [], compile: [], runtime: []});
    expect(compiled?.bytes).toBeGreaterThan(0);
  }, 60_000);
  it('visually distinct from WikiCallout and TweetCard (source pins), solid highlighter, look palette and faces, only spoken text, no invented masthead name', () => {
    const paper = comp('NewspaperCallout').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // code only: the doc comment names what this plate is NOT
    const wiki = comp('WikiCallout');
    const tweet = comp('TweetCard');
    // newspaper chrome
    for (const needle of ['mastTop', 'mastThin', 'newspaperColumns(passage)', 'gutter', 'thick', 'uppercase']) expect(paper.toLowerCase(), needle).toContain(needle.toLowerCase());
    // not the browser tabs / sidebar of the article page, not the social card
    expect(paper).not.toMatch(/tabs|sidebar|rotate\(|borderRadius|border:/);
    expect(wiki).toContain('tabs');
    expect(tweet).toContain('rotate(-1.2deg)');
    // highlighter + palette
    for (const needle of ['highlightStyle="marker"', 'highlightColor={palette.marker}', 'highlightInk={palette.markerInk}', 'highlightOpacity={1}', 'scheduleFrames(highlightSchedule, fps)', 'usePlatePalette']) expect(paper).toContain(needle);
    expect(paper).not.toMatch(/#[0-9a-fA-F]{6}\b|cyan|teal|contentType|niche/i);
    expect(paper).toMatch(/<KineticText[^>]*font="body"/);
    // the headline is the display face (font unset) and only a passed-in title is ever printed
    expect(paper.match(/<FitText text=\{title\}[^>]*/)![0]).not.toContain('font=');
    for (const word of ['fetch(', 'http://', 'https://', 'AssetImage', '<img', 'Math.random', 'Date.now']) expect(paper).not.toContain(word);
  });
});

describe('WP13D 2) seeding', () => {
  it('a news / headline cue seeds a NewspaperCallout with a verbatim passage and whole-word highlights (plateShapeAt and the seed agree)', () => {
    const shape = plateShapeAt(timed([NEWS], 0.3, 0), 0.1)!;
    expect(shape.composition).toBe('NewspaperCallout');
    expect(shape.content.newspaper).toBe(true);
    expect(NEWS.toLowerCase()).toContain((shape.content.passage as string).toLowerCase());
    expect((shape.content.highlight as string[]).length).toBeGreaterThanOrEqual(1);
    const words = timed([OPENER, NEWS, 'Then keep the standard high and ship it anyway today.']);
    const seed = seedLibraryGraphics({words, outputDurationSec: 48, lookId: remapped.id, explainPlates: true});
    expect(Object.values(seed.compositions)).toContain('OpenPlate');
    expect(Object.values(seed.compositions)).toContain('NewspaperCallout');
    const paper = seed.raw.graphics.find(graphic => seed.compositions[graphic.id] === 'NewspaperCallout')!;
    const content = JSON.parse(paper.contentJson) as {passage: string; highlight: string[]; highlightSchedule?: Array<{word: string}>};
    const transcript = words.map(word => word.text).join(' ');
    expect(isGroundedInTranscript(content.passage, transcript)).toBe(true);
    for (const word of content.highlight) expect(content.passage).toContain(word);
    for (const span of content.highlightSchedule ?? []) expect(isGroundedInTranscript(span.word, transcript)).toBe(true);
    expect(resolveLibraryGraphic({goal: paper.goal, visualDescription: paper.visualDescription, placement: paper.placement, content})!.compositionId).toBe('NewspaperCallout');
  });
  it('competes with Wiki / Tweet but still beats a QuoteCallout for the evidence slot; on the standard path it never seeds', () => {
    const words = timed([OPENER, 'Curiosity is the only advantage that keeps compounding over time always.', NEWS, 'Practice builds confidence slowly through repeated attempts and honest feedback.', 'Then keep the standard high and ship it anyway today.'], 0.3, 4.5);
    const seed = seedLibraryGraphics({words, outputDurationSec: 60, lookId: remapped.id, explainPlates: true});
    const comps = Object.values(seed.compositions);
    expect(comps.some(id => id === 'NewspaperCallout' || id === 'WikiCallout' || id === 'TweetCard')).toBe(true);
    expect(comps).toContain('NewspaperCallout');
    expect(Object.values(seedLibraryGraphics({words, outputDurationSec: 60, lookId: remapped.id}).compositions)).not.toContain('NewspaperCallout');
  });
  it('WP52: no variety route: an uncued quotable claim never becomes a newspaper clipping or a second article page; only the news / article cues do', () => {
    const words = timed(
      [
        OPENER,
        'You should always hire the expert and trust their advice when the stakes are high and the team is watching closely for a signal.',
        'Practice builds confidence slowly through repeated attempts and honest feedback over many months.',
        'The right choice is rarely the comfortable one when the stakes are high and the team is watching closely for a signal from you.',
        'Then keep the standard high and ship it anyway today.',
      ],
      0.3,
      4.5,
    );
    const seed = seedLibraryGraphics({words, outputDurationSec: 70, lookId: remapped.id, explainPlates: true});
    const comps = Object.values(seed.compositions);
    expect(comps).not.toContain('NewspaperCallout');
    expect(comps).not.toContain('WikiCallout');
    expect(comps).not.toContain('TweetCard');
  });
  it('wiring pins: the schedule is emitted for the newspaper, the callout set and the split list include it, the gap brief says what it is', () => {
    const source = read('../motionDirector/transcriptLibrarySeed.ts');
    expect(source).toContain("candidate.composition !== 'NewspaperCallout'");
    expect(source).toContain("new Set(['TweetCard', 'WikiCallout', 'NewspaperCallout'])");
    expect(source).toContain('duplicatesCallout');
    expect(read('./explainPlateGaps.ts')).toContain("NewspaperCallout: 'a newspaper clipping callout'");
  });
});
