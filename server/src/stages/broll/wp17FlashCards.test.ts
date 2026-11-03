/**
 * WP17: flash / pivot cards: a solid-ground full-frame interrupt of 1-4 words on connective beats. Offline: no render, no network.
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {captionMuteRanges} from '../../lib/captionMute.ts';
import {recipeForComposition} from '../../lib/motionRecipes.ts';
import {validateGraphicSource} from '../../motionWorker/worker.ts';
import {remapLookForUnusableMatte, resolveEditLook} from '../directorV2/editLooks.ts';
import {addLibrarySeeds} from '../motionDirector/libraryFallback.ts';
import {libraryGraphicSource, resolveLibraryGraphic} from '../motionDirector/libraryRegistry.ts';
import type {MotionDirectorResult} from '../motionDirector/motionDirector.ts';
import {seedLibraryGraphics} from '../motionDirector/transcriptLibrarySeed.ts';
import {LEAVE_THE_FACE_COMPOSITIONS} from './engagementCadence.ts';
import {FLASH_CARD_MAX_SEC, FLASH_CARD_MIN_SEC, findFlashCardCandidates, flashCardCap, flashCardDuration} from './flashCardSeed.ts';
import {isGroundedInTranscript} from './groundedText.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const comp = read('../../../../remotion/src/motion/compositions/FlashCard.tsx');
const remapped = remapLookForUnusableMatte(resolveEditLook('talking_head'), false).resolution.look;
const emptyDirector: MotionDirectorResult = {graphics: [], refusals: [], notes: '', costUsd: 0, model: 'x', latencyMs: 0, raw: null};
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
const SENTENCES = [
  OPENER,
  'We grew every single month for three years and nothing seemed able to stop us at all.',
  'Then everything broke.',
  'We rebuilt the whole product from the first line of code over the next six months of hard work.',
  'Roughly 85 percent of projects slip without a clear owner.',
  'Then keep the standard high and ship it anyway today.',
];
const WORDS = timed(SENTENCES);
const DURATION = Math.ceil(WORDS[WORDS.length - 1]!.end + 3);
const seed = (over: Record<string, unknown> = {}) => seedLibraryGraphics({words: WORDS, outputDurationSec: Math.max(60, DURATION), lookId: remapped.id, explainPlates: true, ...over});
const flashOf = (result: ReturnType<typeof seed>) => result.raw.graphics.filter(graphic => result.compositions[graphic.id] === 'FlashCard');

describe('WP17 1) the composition', () => {
  it('is a solid black / white full-bleed ground: no PlateGround, no gradient, no card or paper chrome; heavy display type in a motion recipe', () => {
    const code = comp.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).toContain("{black: {fill: '#000000', ink: '#FFFFFF'}, white: {fill: '#FFFFFF', ink: '#000000'}}");
    expect(code).toContain('<AbsoluteFill style={{backgroundColor: colors.fill}} />');
    expect(code).not.toMatch(/\bPlateGround\b|\bBackground\b|gradient|boxShadow|borderRadius|border:|\bCard\b|paper|\btabs?\b|browser|notification|sidebar/i);
    expect(code).toContain('<MotionRecipe recipeId={recipeId}>');
    expect(code).toContain("recipeId = 'stretch_squash_pop'");
    expect(code).toMatch(/<FitText[^>]*weight=\{900\}[^>]*uppercase|<FitText[^>]*uppercase[^>]*weight=\{900\}/);
    expect(code).not.toMatch(/font="body"/); // the display face
    expect(code).toContain('.slice(0, FLASH_CARD_MAX_WORDS)');
    for (const word of ['fetch(', 'http://', 'https://', 'useState', 'useEffect', 'Math.random', 'Date.now']) expect(code).not.toContain(word);
  });
  it('is exported, in the compositions map, documented, a leave-the-face plate, and its recipe follows the punchline intent', () => {
    const index = read('../../../../remotion/src/motion/index.ts');
    expect(index).toMatch(/export \{FlashCard\b/);
    expect(index).toMatch(/export const compositions = \{[^}]*\bFlashCard\b/);
    expect(read('../../../../remotion/src/motion/README.md')).toContain('| `FlashCard` |');
    expect(LEAVE_THE_FACE_COMPOSITIONS.has('FlashCard')).toBe(true);
    expect(recipeForComposition('FlashCard')).toBe('stretch_squash_pop');
  });
  it('registry: flash (1-4 words) -> FlashCard on a full or split screen only, black by default, white on request, recipeId forwarded; too long, empty or overlay is a miss', () => {
    const hit = resolveLibraryGraphic(brief({flash: 'Then everything broke', recipeId: 'glitch_text_reveal'}))!;
    expect(hit.compositionId).toBe('FlashCard');
    expect(hit.props).toEqual({phrase: 'Then everything broke', ground: 'black', recipeId: 'glitch_text_reveal'});
    expect(resolveLibraryGraphic(brief({flash: 'But then', ground: 'white'}))!.props.ground).toBe('white');
    expect(resolveLibraryGraphic(brief({flash: 'But then', ground: 'neon'}))!.props.ground).toBe('black');
    expect(resolveLibraryGraphic(brief({flash: 'one two three four five'}))).toBeNull();
    expect(resolveLibraryGraphic(brief({flash: ''}))).toBeNull();
    expect(resolveLibraryGraphic(brief({flash: 'Then everything broke'}, 'overlay'))).toBeNull();
    expect(resolveLibraryGraphic(brief({flash: 'Then everything broke'}, 'split_screen'))!.compositionId).toBe('FlashCard');
  });
  it.each([['black'], ['white']] as const)('the %s card passes worker validation as a library module', async ground => {
    const hit = resolveLibraryGraphic(brief({flash: 'Then everything broke', ground}))!;
    const {report, compiled} = await validateGraphicSource(libraryGraphicSource(hit));
    expect(report).toEqual({safety: [], typecheck: [], compile: [], runtime: []});
    expect(compiled?.bytes).toBeGreaterThan(0);
  }, 60_000);
});

describe('WP17 2) pivot detection (pure)', () => {
  it('"Then everything broke." is a pivot: a verbatim contiguous phrase of at most 4 words, with its own timing', () => {
    const found = findFlashCardCandidates(WORDS);
    const hit = found.find(item => /everything broke/i.test(item.phrase))!;
    expect(hit).toBeDefined();
    expect(hit.phrase).toBe('Then everything broke');
    expect(hit.phrase.split(/\s+/).length).toBeLessThanOrEqual(4);
    expect(hit.endSec).toBeGreaterThan(hit.startSec);
    expect(WORDS[hit.firstWord]!.start).toBe(hit.startSec);
    expect(isGroundedInTranscript(hit.phrase, WORDS.map(word => word.text).join(' '))).toBe(true);
  });
  it('idioms mid-sentence, "but then", "suddenly", "until one day" and short pivot clauses are found; ordinary sentences that merely start with "Then" are not', () => {
    const phrases = (sentences: string[]) => findFlashCardCandidates(timed(sentences, 0.3, 1)).map(item => item.phrase);
    expect(phrases(['We were growing fast and then everything broke down completely.'])[0]).toBe('then everything broke down');
    expect(phrases(['We shipped it, but then nobody used it for months.'])).toContain('but then nobody used');
    expect(phrases(['It worked for years. Suddenly the market changed overnight.'])[0]).toBe('Suddenly the market changed');
    expect(phrases(['Everything was fine until one day the servers stopped answering.'])[0]).toBe('until one day'); // the trailing article is trimmed
    expect(phrases(['But then.'])).toEqual(['But then']);
    expect(phrases(['However.'])).toEqual(['However']);
    expect(phrases(['Then keep the standard high and ship it anyway today.'])).toEqual([]);
    expect(phrases(['Then we hired a lawyer and a marketing person for the company.'])).toEqual([]);
    expect(phrases(['Pick one metric and protect it from everything else around you.'])).toEqual([]);
  });
  it('duration is 0.5-1.2 s (never under 0.35), about 0.5-0.8 s for a normal phrase; the cap is about one per 13 s, none under 10 s', () => {
    expect(FLASH_CARD_MIN_SEC).toBe(0.35);
    expect(FLASH_CARD_MAX_SEC).toBe(1.2);
    for (const spoken of [0.1, 0.5, 0.65, 0.8, 1.5, 4]) {
      const duration = flashCardDuration(spoken);
      expect(duration).toBeGreaterThanOrEqual(0.5);
      expect(duration).toBeLessThanOrEqual(1.2);
    }
    expect(flashCardDuration(0.5)).toBeLessThanOrEqual(0.8);
    expect(flashCardCap(9)).toBe(0);
    expect(flashCardCap(12)).toBe(1);
    expect(flashCardCap(30)).toBe(2);
    expect(flashCardCap(60)).toBe(4);
    expect(flashCardCap(300)).toBe(4);
  });
});

describe('WP17 3) seeding', () => {
  it('the fixture with "Then everything broke" seeds a FlashCard: <= 4 words, full screen, short, black, verbatim, starting at the pivot', () => {
    const result = seed();
    const cards = flashOf(result);
    expect(cards.length).toBeGreaterThanOrEqual(1);
    const card = cards[0]!;
    const content = JSON.parse(card.contentJson) as {flash: string; ground?: string; recipeId?: string};
    expect(content.flash).toBe('Then everything broke');
    expect(content.flash.split(/\s+/).length).toBeLessThanOrEqual(4);
    expect(card.placement).toBe('full_screen');
    expect(card.durationSeconds).toBeGreaterThanOrEqual(0.35);
    expect(card.durationSeconds).toBeLessThanOrEqual(1.2);
    expect(content.ground ?? 'black').toBe('black');
    expect(content.recipeId).toBe('stretch_squash_pop');
    expect(WORDS[card.anchorWordIndex]!.text.toLowerCase()).toBe('then');
    expect(resolveLibraryGraphic({goal: card.goal, visualDescription: card.visualDescription, placement: card.placement, content})!.compositionId).toBe('FlashCard');
  });
  it('flash cards count inside the plate limit and never overlap another plate; the OpenPlate stays', () => {
    const result = seed();
    expect(result.raw.graphics.length).toBeLessThanOrEqual(result.limit);
    expect(Object.values(result.compositions)).toContain('OpenPlate');
    const windows = result.raw.graphics.map(graphic => ({start: WORDS[graphic.anchorWordIndex]!.start, end: WORDS[graphic.anchorWordIndex]!.start + graphic.durationSeconds}));
    for (let i = 0; i < windows.length; i += 1) for (let j = i + 1; j < windows.length; j += 1) expect(windows[i]!.start < windows[j]!.end && windows[i]!.end > windows[j]!.start, `${i} ${j}`).toBe(false);
  });
  it('the cap is respected however many pivots there are', () => {
    const pivots = Array.from({length: 12}, (_, index) => `Chapter ${index} was calm. Then everything broke.`);
    const words = timed(pivots, 0.3, 3);
    const result = seedLibraryGraphics({words, outputDurationSec: 70, lookId: remapped.id, explainPlates: true});
    const cards = flashOf(result);
    expect(cards.length).toBeLessThanOrEqual(flashCardCap(70));
    expect(cards.length).toBeGreaterThanOrEqual(1);
    expect(result.raw.graphics.length).toBeLessThanOrEqual(result.limit);
  });
  it('explain path only; none when there is no pivot', () => {
    expect(Object.values(seedLibraryGraphics({words: WORDS, outputDurationSec: 60, lookId: remapped.id}).compositions)).not.toContain('FlashCard');
    const plain = timed([OPENER, 'Roughly 85 percent of projects slip without a clear owner.', 'Then keep the standard high and ship it anyway today.']);
    expect(flashOf(seedLibraryGraphics({words: plain, outputDurationSec: 60, lookId: remapped.id, explainPlates: true}))).toEqual([]);
  });
  it('the stage warns polish_pace:flash_cards:<n>', () => {
    const result = addLibrarySeeds(emptyDirector, {words: WORDS, outputDurationSec: Math.max(60, DURATION), occupied: [], captionBand: undefined as never, lookId: remapped.id, explainPlates: true});
    const warning = result.warnings.find(item => item.startsWith('polish_pace:flash_cards:'));
    expect(warning).toBeDefined();
    expect(Number(warning!.split(':')[2])).toBe(result.director.graphics.filter(graphic => 'flash' in (graphic.brief.content as object)).length);
  });
});

describe('WP17 4) caption exclusivity', () => {
  it('a flash card is full screen, so the captions are muted for exactly its window; words outside it stay on', () => {
    const result = seed();
    const card = flashOf(result)[0]!;
    const start = WORDS[card.anchorWordIndex]!.start;
    const graphics = [{id: card.id, start, end: start + card.durationSeconds, placement: {mode: 'full_screen'}}];
    const ranges = captionMuteRanges({graphics, contentById: new Map(), captionWords: WORDS});
    expect(ranges).toEqual([{startSec: Math.round(start * 1000) / 1000, endSec: Math.round((start + card.durationSeconds) * 1000) / 1000}]);
    const outside = WORDS.filter(word => word.end <= start || word.start >= start + card.durationSeconds);
    expect(outside.length).toBeGreaterThan(WORDS.length / 2);
    expect(read('../../lib/polishSfx.ts')).toContain("mode === 'full_screen' ? 'hit' : 'pop'"); // a full-screen card also lands with a hit
  });
});

describe('WP17 5) labeled-asset slots', () => {
  // two pivots inside a 25 s clip (cap = 1 card), so which one is picked is decided by the slot rules
  const small = timed(['We grew every month for years.', 'Then everything broke.', 'We rebuilt it all slowly.', 'Suddenly the market changed overnight.', 'We kept going anyway today.'], 0.3, 2);
  const candidates = findFlashCardCandidates(small);
  const run = (slots: Array<{start: number; end: number}>) => seedLibraryGraphics({words: small, outputDurationSec: 25, lookId: remapped.id, explainPlates: true, assetSlotWindows: slots});
  const startsOf = (result: ReturnType<typeof run>) => flashOf(result).map(card => small[card.anchorWordIndex]!.start);
  it('the fixture has two pivots and the cap is one card', () => {
    expect(candidates.map(item => item.phrase)).toEqual(['Then everything broke', 'Suddenly the market changed']);
    expect(flashCardCap(25)).toBe(1);
    expect(startsOf(run([]))).toEqual([candidates[0]!.startSec]); // no slots: the first pivot in time
  });
  it('a pivot strictly inside a slot window is skipped when another pivot exists outside every slot', () => {
    const first = candidates[0]!;
    const starts = startsOf(run([{start: first.startSec - 1, end: first.endSec + 1}]));
    expect(starts).toEqual([candidates[1]!.startSec]);
  });
  it('with every pivot inside a slot, the in-slot pivot is still used (documented demotion, not a loss)', () => {
    const slots = candidates.map(item => ({start: item.startSec - 1, end: item.endSec + 1}));
    expect(startsOf(run(slots)).length).toBe(1);
  });
  it('a pivot just before a slot start is preferred over an earlier one (under the cap)', () => {
    const later = candidates[1]!;
    expect(startsOf(run([{start: later.startSec + 0.6, end: later.startSec + 6}]))).toEqual([later.startSec]);
  });
  it('wiring pins: the stage computes the slot windows from the same pure labeled-asset brief and the asset brief module is untouched', () => {
    expect(read('../motionDirector/index.ts')).toContain('buildLabeledAssetBrief({words: input.words, outputDurationSec: input.outputDurationSec}).slots.map(slot => ({start: slot.startSec, end: slot.endSec}))');
    expect(read('./labeledAssetBrief.ts')).not.toMatch(/flash/i);
  });
});

describe('WP17 6) pairing with the transition density', () => {
  it('the END of a flash card is a preferred cut anchor for the density floor (no new transition kinds)', () => {
    const analyze = read('../../pipeline/analyzeVideo.ts');
    expect(analyze).toContain("item.compositionId === 'FlashCard'");
    expect(analyze).toContain('graphic.end');
    expect(read('./transitionDensity.ts')).not.toContain('FlashCard');
  });
});
