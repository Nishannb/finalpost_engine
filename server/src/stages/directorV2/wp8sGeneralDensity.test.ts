/**
 * WP8S: polish density comes from generic signals (content profile + transcript shape), never from a clip or a content-type allowlist. Pure: no model, no render, no network.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {addLibrarySeeds} from '../motionDirector/libraryFallback.ts';
import {type MotionDirectorResult} from '../motionDirector/motionDirector.ts';
import {DEFAULT_PILL_BOX, seedLibraryGraphics} from '../motionDirector/transcriptLibrarySeed.ts';
import {PROFILE_CONTENT_TYPES} from '../contentProfile/contentProfile.ts';
import {biasEditLook, EDIT_LOOKS, profileCarriesDesignedGraphics, resolveEditLook} from './editLooks.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const read = (...parts: string[]) => readFileSync(resolve(ROOT, ...parts), 'utf8');

const empty: MotionDirectorResult = {graphics: [], refusals: [], notes: '', costUsd: 0, model: 'x', latencyMs: 0, raw: null};

function timed(sentences: string[], secPer = 5) {
  const words: {text: string; start: number; end: number}[] = [];
  sentences.forEach((sentence, index) => {
    const tokens = sentence.split(/\s+/);
    const slot = (secPer - 0.6) / tokens.length;
    tokens.forEach((text, i) => {
      const start = 0.4 + index * secPer + i * slot;
      words.push({text, start, end: start + slot * 0.9});
    });
  });
  return {words, duration: sentences.length * secPer + 1};
}

/** Cooking, fitness and SaaS shaped profiles: the same fields, the same rule. */
const NICHES = [
  {niche: 'cooking', profile: {contentType: 'tutorial', structure: 'enumerated', density: 'moderate', mood: 'earthy_natural'}},
  {niche: 'fitness', profile: {contentType: 'educational_tips', structure: 'enumerated', density: 'sparse', mood: 'bold_energetic'}},
  {niche: 'saas', profile: {contentType: 'sales_pitch', structure: 'argument', density: 'rich', mood: 'tech_sharp'}},
];

describe('WP8S generic look policy', () => {
  it('a sparse pick is densified by profile fields alone, identically for every niche', () => {
    for (const {profile} of NICHES) {
      const biased = biasEditLook(resolveEditLook('minimal_captions'), profile);
      expect(biased.resolution.look.id).toBe('explainer_cutaway');
      expect(biased.biasedFrom).toBe('minimal_captions');
    }
  });
  it('the answer does not depend on content type or mood: every type gives the same result for the same density and structure', () => {
    for (const density of ['none', 'sparse', 'moderate', 'rich']) {
      for (const structure of ['enumerated', 'narrative', 'argument', 'conversational']) {
        const answers = new Set(PROFILE_CONTENT_TYPES.map(contentType => profileCarriesDesignedGraphics({contentType, density, structure, mood: 'tech_sharp'})));
        expect(answers.size).toBe(1);
        expect(profileCarriesDesignedGraphics({density, structure, mood: 'calm_cool'})).toBe([...answers][0]);
      }
    }
  });
  it('an explicit dense pick is never rewritten, for any look and profile', () => {
    for (const look of EDIT_LOOKS.filter(entry => entry.id !== 'minimal_captions')) {
      for (const {profile} of NICHES) {
        const biased = biasEditLook(resolveEditLook(look.id), profile);
        expect(biased.resolution.look.id).toBe(look.id);
        expect(biased.biasedFrom).toBeUndefined();
      }
    }
  });
  it('talking_head stays talking_head even on motivational / opinion content (no clip bias)', () => {
    for (const contentType of ['motivational', 'opinion']) expect(biasEditLook(resolveEditLook('talking_head'), {contentType, density: 'sparse', structure: 'argument'}).resolution.look.id).toBe('talking_head');
  });
  it('density none or plain chat keeps the sparse look', () => {
    expect(biasEditLook(resolveEditLook('minimal_captions'), {density: 'none', structure: 'enumerated'}).biasedFrom).toBeUndefined();
    expect(biasEditLook(resolveEditLook('minimal_captions'), {density: 'sparse', structure: 'conversational'}).biasedFrom).toBeUndefined();
  });
  it('every look carries a caption bias, so captions follow the look and not a fixed template', () => {
    for (const look of EDIT_LOOKS) expect(['kinetic_big', 'kinetic_pills', 'kinetic_split', 'clean']).toContain(look.captionBias);
    expect(new Set(EDIT_LOOKS.map(look => look.captionBias)).size).toBe(EDIT_LOOKS.length);
  });
});

describe('WP8S generic transcript seeds', () => {
  const COOKING = timed([
    'Welcome back to the kitchen everybody today.',
    'For this sauce you need garlic, butter, lemon and parsley.',
    'Keep the heat low so nothing burns while you stir.',
    'Season it slowly and taste it again before serving.',
    'That is the secret to a sauce that never splits.',
    'Now plate it up and enjoy every single bite.',
  ]);
  it('pills seed with the default box when the speaker is unmeasured (cooking list)', () => {
    const seed = seedLibraryGraphics({words: COOKING.words, outputDurationSec: COOKING.duration, lookId: 'explainer_cutaway'});
    const pills = seed.raw.graphics.find(graphic => seed.compositions[graphic.id] === 'TopicPills');
    expect(pills).toBeDefined();
    expect(pills!.box).toEqual(DEFAULT_PILL_BOX);
  });
  it('a keyword stack comes from an arbitrary transcript: spoken lead-in + last content word', () => {
    const clip = timed(['Pick one goal and chase consistency.', 'Training a heavy deadlift builds raw strength.']);
    const seed = seedLibraryGraphics({words: clip.words, outputDurationSec: 24, lookId: 'explainer_cutaway'});
    const spoken = clip.words.map(word => word.text.replace(/[^A-Za-z]/g, '').toLowerCase());
    const stacks = seed.raw.graphics.filter(graphic => seed.compositions[graphic.id] === 'BigKineticHeadline').map(graphic => JSON.parse(graphic.contentJson) as {lines?: string[]}).filter(content => content.lines?.length === 2);
    expect(stacks.length).toBeGreaterThan(0);
    for (const {lines} of stacks) for (const line of lines!) for (const token of line.split(/\s+/)) expect(spoken).toContain(token.replace(/[^A-Za-z]/g, '').toLowerCase());
  });
  it('one existing library graphic still leaves room for more seeds (top-up), warning library_seed_topup', () => {
    const first = seedLibraryGraphics({words: COOKING.words, outputDurationSec: COOKING.duration, lookId: 'explainer_cutaway'});
    expect(first.limit).toBeGreaterThan(1);
    const result = addLibrarySeeds(empty, {words: COOKING.words, outputDurationSec: COOKING.duration, occupied: [], lookId: 'explainer_cutaway'});
    expect(result.director.graphics.length).toBeGreaterThan(1);
    const again = addLibrarySeeds({...empty, graphics: result.director.graphics.slice(0, 1)}, {words: COOKING.words, outputDurationSec: COOKING.duration, occupied: [], lookId: 'explainer_cutaway'});
    expect(again.director.graphics.length).toBeGreaterThan(1);
    expect(again.warnings.some(warning => warning.startsWith('motion_graphic:library_seed_topup:'))).toBe(true);
  });
});

describe('WP8S source pins: no clip-specific product logic', () => {
  it('no Jensen identifier or content-type allowlist remains in product code', () => {
    const files = [
      'server/src/stages/directorV2/editLooks.ts',
      'server/src/stages/directorV2/creativeDirector.ts',
      'server/src/stages/motionDirector/transcriptLibrarySeed.ts',
      'server/src/stages/motionDirector/libraryFallback.ts',
      'server/src/pipeline/analyzeVideo.ts',
    ];
    for (const file of files) expect(read(file), file).not.toMatch(/jensen/i);
    const looks = read('server/src/stages/directorV2/editLooks.ts');
    expect(looks).not.toMatch(/JENSEN_|REFERENCE_CONTENT_TYPES|matchesJensenReference/);
    expect(looks).not.toMatch(/'motivational'|'opinion'/);
    expect(looks).toContain('profileCarriesDesignedGraphics');
  });
  it('the bias only revisits the sparse look and reads profile fields only', () => {
    const looks = read('server/src/stages/directorV2/editLooks.ts');
    expect(looks).toContain('resolution.look.id !== FALLBACK_LOOK_ID');
    expect(read('server/src/pipeline/analyzeVideo.ts')).toContain('structure: contentProfile.structure');
    expect(read('server/src/stages/motionDirector/libraryFallback.ts')).toContain('library_seed_topup');
  });
});
