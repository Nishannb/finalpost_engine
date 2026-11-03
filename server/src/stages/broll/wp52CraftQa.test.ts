/**
 * WP52: offline pins for the test2-polish-live FAIL themes (Klipy default, bubble ban, callout discipline, double-stat, sticky ends, overlap, name homonyms, list triggers).
 */
import {describe, expect, it} from 'vitest';
import {env} from '../../config/env.ts';
import {POLISH_LEAN_EDITS} from '../../lib/editToolkits.ts';
import {plateShapeAt, seedLibraryGraphics} from '../motionDirector/transcriptLibrarySeed.ts';
import {addLibrarySeeds} from '../motionDirector/libraryFallback.ts';
import {
  capRepeatedPlateStyle,
  clampStickyEnds,
  dedupeStatKinetic,
  dropBubbleOverlays,
  dropDoubleStatEmphasis,
  paletteRepeats,
  refuseOverlappingImages,
} from './craftMutualExclusion.ts';
import {isListLikeText, planMotionTemplateBeats} from './motionTemplateCatalog.ts';
import {isBarePersonNameQuery, isTimepieceCandidate} from './nounLock.ts';

function wordsOf(text: string, start = 1) {
  return text.split(/\s+/).map((word, index) => ({text: word, start: start + index * 0.3, end: start + index * 0.3 + 0.25}));
}
const shapeOf = (sentence: string) => plateShapeAt(wordsOf(sentence), 1.2)?.composition ?? null;
const CALLOUTS = ['TweetCard', 'WikiCallout', 'NewspaperCallout'];

describe('WP52 A: Klipy default off', () => {
  it('KLIPY_OVERLAYS_ENABLED defaults to false', () => {
    expect(env.KLIPY_OVERLAYS_ENABLED).toBe(false);
  });
});

describe('WP52 B: bubble ban', () => {
  it('polish lean edits do not include bubble', () => {
    expect(POLISH_LEAN_EDITS).not.toContain('bubble');
  });
  it('drops bubble overlays and counts them', () => {
    const result = dropBubbleOverlays([{layout: 'bubble'}, {layout: 'card'}, {layout: 'bubble'}]);
    expect(result.dropped).toBe(2);
    expect(result.kept).toEqual([{layout: 'card'}]);
  });
});

describe('WP52 C: callout discipline', () => {
  it('an advice maxim is not a TweetCard', () => {
    for (const line of ['You should never hire an expert before you know the problem', 'Always choose the better option instead of the cheaper one']) {
      expect(CALLOUTS).not.toContain(shapeOf(line));
    }
  });
  it('ordinary stats / brand lines are never Tweet / Wiki / Newspaper', () => {
    for (const line of ['It reached 200 people in the first week alone', 'We make 10,000 a month from this one offer', 'Base 44 is the AI tool that hosts the program', 'The company raised $1.5 billion to build this product']) {
      expect(CALLOUTS).not.toContain(shapeOf(line));
    }
  });
  it('a quotable claim without a news cue is not a NewspaperCallout', () => {
    expect(shapeOf('Nobody ever builds a great company without first finding a real problem worth solving')).not.toBe('NewspaperCallout');
  });
  it('explicit cues still seed their callout', () => {
    expect(shapeOf('According to the study, remote teams ship faster than office teams do')).toBe('WikiCallout');
    expect(shapeOf('Breaking news the founders just shut down the whole company today')).toBe('NewspaperCallout');
    expect(shapeOf('She tweeted that nobody reads the docs anymore and that is fine')).toBe('TweetCard');
  });
  it('seedLibraryGraphics never upgrades a list to a wiki', () => {
    const words = wordsOf('We cover Python, Excel, SQL, Tableau and Docker in the program every single week', 2);
    const seed = seedLibraryGraphics({words, outputDurationSec: 30, lookId: 'explainer_cutaway', explainPlates: true});
    expect(seed.listUpgraded ?? []).toEqual([]);
    expect(Object.values(seed.compositions)).not.toContain('WikiCallout');
  });
  it('libraryFallback emits no list_upgraded warning', () => {
    const words = wordsOf('We cover Python, Excel, SQL, Tableau and Docker in the program every single week', 2);
    const result = addLibrarySeeds({graphics: [], refusals: [], notes: ''} as never, {words, outputDurationSec: 30, occupied: [], captionBand: undefined, contentProfile: undefined, explainPlates: true});
    expect(result.warnings.some(warning => warning.includes('list_upgraded'))).toBe(false);
  });
});

describe('WP52 D: double stat', () => {
  const stat = {id: 'g1', start: 4, end: 7, compositionId: 'StatHighlight', text: '200 people'};
  it('drops a count emphasis restating the stat number on the same window', () => {
    const result = dropDoubleStatEmphasis([stat], [{start: 4.5, end: 6, text: '200', treatment: 'count'}, {start: 9, end: 10, text: '200', treatment: 'count'}]);
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0]!.start).toBe(9);
    expect(result.warnings).toEqual(['polish_craft:double_stat_dropped:200']);
  });
  it('normalizes 10,000 and keeps non-stat treatments', () => {
    const result = dropDoubleStatEmphasis([{...stat, text: '10000 a month'}], [{start: 4, end: 5, text: '10,000', treatment: 'pop'}, {start: 4, end: 5, text: '10,000', treatment: 'underline'}]);
    expect(result.kept.map(item => item.treatment)).toEqual(['underline']);
  });
  it('BigKineticHeadline never overlaps a StatHighlight for the same number', () => {
    const result = dedupeStatKinetic([stat, {id: 'g2', start: 5, end: 8, compositionId: 'BigKineticHeadline', text: '200'}]);
    expect(result.dropIds).toEqual(['g2']);
  });
});

describe('WP52 E: overlap + black card + palette repeat', () => {
  it('refuses a small image on a full-screen still and stacked stickers', () => {
    const result = refuseOverlappingImages(
      [
        {id: 'a', start: 5, end: 8, layout: 'sticker', mediaKind: 'image'},
        {id: 'b', start: 6, end: 9, layout: 'pip', mediaKind: 'image'},
        {id: 'c', start: 20, end: 22, layout: 'card', mediaKind: 'image'},
      ],
      [{start: 4.5, end: 7}],
    );
    expect(result.refusedIds.sort()).toEqual(['a', 'b']);
    expect(result.kept.map(item => item.id)).toEqual(['c']);
    expect(result.warnings[0]).toBe('polish_craft:overlap_refused');
  });
  it('caps repeated black-card plates inside 12 s', () => {
    const plates = [
      {id: '1', start: 0, end: 3, style: 'explainer_d'},
      {id: '2', start: 8, end: 10, style: 'explainer_d'},
      {id: '3', start: 20, end: 22, style: 'explainer_d'},
    ];
    expect(capRepeatedPlateStyle(plates)).toEqual(['2']);
  });
  it('reports an abutting identical palette', () => {
    expect(paletteRepeats([{id: 'a', start: 0, end: 3, style: 'X'}, {id: 'b', start: 3, end: 5, style: 'X'}])).toEqual(['polish_craft:palette_repeat:1']);
    expect(paletteRepeats([{id: 'a', start: 0, end: 3, style: 'X'}, {id: 'b', start: 3, end: 5, style: 'Y'}])).toEqual([]);
  });
});

describe('WP52 F: end clamp', () => {
  it('truncates a graphic that spans the next plate start', () => {
    const result = clampStickyEnds([{id: 'g1', start: 10, end: 16}], {boundaries: [13]});
    expect(result.items[0]!.end).toBeLessThan(13);
    expect(result.items[0]!.end).toBeGreaterThan(12.9);
    expect(result.warnings).toEqual(['polish_craft:end_clamped:g1']);
  });
  it('limits the hold after the spoken words to 0.35 s', () => {
    const result = clampStickyEnds([{id: 'g2', start: 10, end: 16}], {boundaries: [], spokenEndOf: () => 12});
    expect(result.items[0]!.end).toBeCloseTo(12.35, 3);
  });
  it('leaves a graphic alone when the clamp would be shorter than the minimum', () => {
    const result = clampStickyEnds([{id: 'g3', start: 10, end: 16}], {boundaries: [10.2]});
    expect(result.items[0]!.end).toBe(16);
  });
});

describe('WP52 G: person-name homonyms', () => {
  it('a bare first name is not a stock query; roles / context are', () => {
    expect(isBarePersonNameQuery('Adam')).toBe(true);
    expect(isBarePersonNameQuery('adam photo')).toBe(true);
    expect(isBarePersonNameQuery('adam smith economist portrait')).toBe(false);
    expect(isBarePersonNameQuery('server room')).toBe(false);
  });
  it('flags clock / watch class photos', () => {
    expect(isTimepieceCandidate({alt: 'antique wall clock on white', tags: ['clock', 'time']})).toBe(true);
    expect(isTimepieceCandidate({alt: 'man smiling at camera', tags: ['portrait']})).toBe(false);
  });
});

describe('WP52 H: list triggers', () => {
  it('detects enumerations', () => {
    expect(isListLikeText('first you learn python second you learn sql')).toBe(true);
    expect(isListLikeText('three things you need are speed, focus, and consistency')).toBe(true);
    expect(isListLikeText('python, excel, sql, tableau and docker')).toBe(true);
    expect(isListLikeText('this is a normal sentence about nothing')).toBe(false);
  });
  it('plans a template beat for a clear enumeration', () => {
    const words = wordsOf('so what do you actually get inside there are three things you need speed, focus, and consistency and then we move on to the next part', 3);
    const plan = planMotionTemplateBeats({skill: 'default', durationSec: 40, words});
    expect(plan.beats.length).toBeGreaterThan(0);
  });
});
