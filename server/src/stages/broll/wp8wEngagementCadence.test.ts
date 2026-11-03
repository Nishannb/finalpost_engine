/**
 * WP8W: engagement cadence under polish. Matte-fail look remap, the cadence contract + fill, and the sparse-profile cap. Pure: no model, no network, no render.
 * The fixture is a generic ~36 s talk (Gate-6 shaped: talking_head requested, no usable matte, sparse profile, thin Director = zooms + one lockup).
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {editLookWarnings, EDIT_LOOKS, enforceEditLook, remapLookForUnusableMatte, resolveEditLook} from '../directorV2/editLooks.ts';
import {raisePolishProfileCap} from '../motionDirector/polishProfileCap.ts';
import {applyPolishDensityFill} from './polishDensityFill.ts';
import {applyEditLookToDirection} from './lookDirection.ts';
import {engagementWindows, isFaceOverlayOnlyEdit, SEC_PER_ENGAGE, strongBeatTimes, uncoveredEngagementWindows} from './engagementCadence.ts';
import type {VisualDirection} from './geminiDirector.ts';
import type {ContentProfile} from '../contentProfile/contentProfile.ts';
import type {WordToken} from '../../types/blueprint.ts';

const look = (id: string) => EDIT_LOOKS.find(entry => entry.id === id)!;
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const SENTENCES = [
  'Most teams choose between speed and quality every single week.',
  'Here is the thing nobody tells you about shipping software quickly.',
  'Small habits compound into something very large over time.',
  'Pick one metric and protect it from everything else around you.',
  'Never confuse being busy with making real progress forward.',
  'Clarity beats effort when the goal is unclear to everyone.',
  'Write the plan down and share it with your whole team.',
  'Then keep the standard high and ship it anyway today.',
  'Start building something real with these tools right now.',
];
function transcript(secPerSentence = 4): WordToken[] {
  const words: WordToken[] = [];
  SENTENCES.forEach((sentence, index) => {
    const tokens = sentence.split(' ');
    const slot = (secPerSentence - 0.5) / tokens.length;
    tokens.forEach((text, i) => words.push({text, start: Math.round((index * secPerSentence + i * slot) * 1000) / 1000, end: Math.round((index * secPerSentence + (i + 1) * slot) * 1000) / 1000}));
  });
  return words;
}
const WORDS = transcript();
const DURATION = 36;
const norm = (text: string) => text.replace(/[.,]/g, '').toLowerCase();
const spoken = ` ${WORDS.map(word => norm(word.text)).join(' ')} `;

const direction = (over: Partial<VisualDirection> = {}): VisualDirection => ({
  hookTitle: 'Ship faster', hookSubtitle: '', hookStyle: 'bold' as never, topic: 't', visualQueries: [],
  caption: {} as never, suggestedLutIds: [], preferredLutId: '',
  zooms: [], moments: [], depthOverlays: [], insetReveals: [], motionGraphics: [], mediaContainers: [], frameInsets: [], semanticEmphasis: [],
  estimatedCostUsd: 0, source: 'gemini', ...over,
});
/** Thin Director: zooms + one lockup (a face overlay) + a kinetic line, no cutaway / card. */
const thin = (): VisualDirection => direction({
  zooms: [{timestamp: 6, durationSec: 2.5}, {timestamp: 15, durationSec: 2.5}, {timestamp: 27, durationSec: 2.5}],
  moments: [{timestamp: 20, searchKeyword: 'x', media: 'text', layout: 'lockup', anchor: 'top_right', overlayText: 'Never confuse being busy', textStyle: 'stack', accentColor: '#fff'} as never],
  motionGraphics: [{start: 9, end: 11.5, text: 'Small habits compound', role: 'primary', shape: 'none', accentColor: '#fff', textColor: '#fff', anchor: 'top', entrance: 'fade_blur', exit: 'fade', fontScale: 1} as never],
});
const LEAN = new Set(['captions', 'zoom', 'hook_title', 'kinetic_text', 'lockup', 'card', 'bubble', 'emphasis', 'counter']);

describe('WP8W matte-fail look remap', () => {
  it('talking_head without a usable matte becomes explainer_cutaway, reported as edit_look_matte_fallback', () => {
    const remapped = remapLookForUnusableMatte(resolveEditLook('talking_head'), false);
    expect(remapped.resolution.look.id).toBe('explainer_cutaway');
    expect(remapped.matteFallbackFrom).toBe('talking_head');
    expect(editLookWarnings({id: 'explainer_cutaway', requested: 'talking_head', fellBack: false, dropped: [], matteFallbackFrom: 'talking_head'})).toContain('edit_look_matte_fallback:talking_head->explainer_cutaway');
  });
  it('a usable matte keeps talking_head; no other look is remapped', () => {
    expect(remapLookForUnusableMatte(resolveEditLook('talking_head'), true).resolution.look.id).toBe('talking_head');
    expect(remapLookForUnusableMatte(resolveEditLook('talking_head'), true).matteFallbackFrom).toBeUndefined();
    for (const id of ['split_story', 'explainer_cutaway', 'minimal_captions']) {
      const remapped = remapLookForUnusableMatte(resolveEditLook(id), false);
      expect(remapped.resolution.look.id).toBe(id);
      expect(remapped.matteFallbackFrom).toBeUndefined();
    }
  });
  it('under the remapped look cutaway / card are allowed and cutout / depth stay dropped', () => {
    const explainer = remapLookForUnusableMatte(resolveEditLook('talking_head'), false).resolution.look;
    const kept = enforceEditLook([{id: 'a', kind: 'cutaway'}, {id: 'b', kind: 'card'}, {id: 'c', kind: 'cutout'}, {id: 'd', kind: 'depth_overlay'}], explainer, {matteUsable: false});
    expect(kept.kept.map(item => item.id)).toEqual(['a', 'b']);
  });
});

describe('WP8W engagement cadence contract (pure)', () => {
  it('windows: one per SEC_PER_ENGAGE, a short tail is not judged', () => {
    expect(SEC_PER_ENGAGE).toBe(8);
    expect(engagementWindows(36)).toHaveLength(4);
    expect(engagementWindows(36.9)).toHaveLength(4);
    expect(engagementWindows(37)).toHaveLength(5);
    expect(engagementWindows(21)).toHaveLength(3);
    expect(engagementWindows(5)).toHaveLength(0);
  });
  it('zooms, emphasis, kinetic text and the hook never cover a window; cards, cutaways and splits do', () => {
    expect(uncoveredEngagementWindows(thin(), DURATION).map(window => window.index)).toEqual([0, 1, 3]);
    const card = direction({moments: [{timestamp: 2, layout: 'chip'} as never, {timestamp: 10, layout: 'cutaway'} as never, {timestamp: 18, layout: 'split'} as never, {timestamp: 26, layout: 'lockup'} as never]});
    expect(uncoveredEngagementWindows(card, DURATION)).toHaveLength(0);
    expect(strongBeatTimes(card)).toHaveLength(4);
    expect(uncoveredEngagementWindows(thin(), DURATION, [3, 12, 30]).map(window => window.index)).toEqual([]);
  });
  it('classifies lockups + zooms + kinetic text as a face-overlay-only edit', () => {
    expect(isFaceOverlayOnlyEdit(thin())).toBe(true); // a lockup covers a window but is still a face overlay, not a cutaway / card / split
    expect(isFaceOverlayOnlyEdit(direction({zooms: thin().zooms, motionGraphics: thin().motionGraphics}))).toBe(true);
    expect(isFaceOverlayOnlyEdit(direction({moments: [{timestamp: 10, layout: 'chip'} as never]}))).toBe(false);
  });
});

describe('WP8W Gate-6 shaped fixture: remap + fill', () => {
  const remapped = remapLookForUnusableMatte(resolveEditLook('talking_head'), false).resolution.look;
  const enforced = applyEditLookToDirection(thin(), remapped, {matteUsable: false}).direction;
  const fill = applyPolishDensityFill({direction: enforced, look: remapped, words: WORDS, outputDurationSec: DURATION, requested: LEAN, matteUsable: false});

  it('the look is cutaway-capable', () => {
    expect(remapped.id).toBe('explainer_cutaway');
    expect(remapped.allowedElementKinds).toContain('cutaway');
    expect(remapped.allowedElementKinds).toContain('card');
  });
  it('every engagement window is covered by a strong beat (card / cutaway) after the fill', () => {
    expect(uncoveredEngagementWindows(fill.direction, DURATION)).toEqual([]);
    expect(fill.warnings.some(warning => warning.startsWith('polish_density_fill:cadence_'))).toBe(true);
  });
  it('the edit is not "captions + zooms + face overlays only"', () => {
    expect(isFaceOverlayOnlyEdit(fill.direction)).toBe(false);
    expect(fill.direction.moments.filter(moment => moment.layout === 'chip').length).toBeGreaterThanOrEqual(1);
    expect(strongBeatTimes(fill.direction).length).toBeGreaterThanOrEqual(4);
  });
  it('under an unusable matte the fill puts cards before kinetic text on the face', () => {
    const base = applyPolishDensityFill({direction: direction({zooms: thin().zooms}), look: remapped, words: WORDS, outputDurationSec: DURATION, requested: LEAN, matteUsable: false});
    const cards = (base.added.card ?? 0) + (base.added.cadence_card ?? 0); // WP8X: the cadence cover runs first and is counted under cadence_<kind>
    expect(cards).toBeGreaterThan(0);
    expect(base.added.kinetic_text ?? 0).toBeLessThanOrEqual(cards);
  });
  it('copy stays verbatim spoken substrings', () => {
    const texts = [...fill.direction.moments.map(item => item.overlayText), ...fill.direction.motionGraphics.map(item => item.text), ...fill.direction.semanticEmphasis.map(item => item.text)].filter(text => text && !['Never confuse being busy', 'Small habits compound'].includes(text));
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) expect(spoken).toContain(` ${norm(text)} `);
  });
  it('a cutaway (when requested) is a moment with queries from spoken words and counts against the look cap', () => {
    const withCutaway = applyPolishDensityFill({direction: enforced, look: remapped, words: WORDS, outputDurationSec: DURATION, requested: new Set([...LEAN, 'cutaway']), matteUsable: false});
    const cutaways = withCutaway.direction.moments.filter(moment => moment.layout === 'cutaway');
    expect(cutaways.length).toBeGreaterThan(0);
    expect(cutaways.length).toBeLessThanOrEqual(remapped.maxGraphics);
    for (const cutaway of cutaways) for (const query of cutaway.queries ?? []) for (const token of query.split(' ')) expect(spoken).toContain(` ${norm(token)} `);
  });
  it('minimal_captions and a missing look stay sparse; a usable matte keeps the original order', () => {
    expect(applyPolishDensityFill({direction: thin(), look: look('minimal_captions'), words: WORDS, outputDurationSec: DURATION, requested: LEAN, matteUsable: false}).added).toEqual({});
    const usable = applyPolishDensityFill({direction: direction(), look: look('talking_head'), words: WORDS, outputDurationSec: DURATION, requested: LEAN, matteUsable: true});
    expect(usable.added.kinetic_text ?? 0).toBeGreaterThan(0);
  });
});

describe('WP8W sparse profile does not starve polish', () => {
  const profile = (maxGraphics: number) => ({density: maxGraphics === 0 ? 'none' : 'sparse', policy: {maxGraphics}}) as unknown as ContentProfile;
  it('cap 1 on a 36 s clip is raised to the duration-scaled limit, with a warning', () => {
    const raised = raisePolishProfileCap(profile(1), DURATION);
    expect(raised.profile!.policy.maxGraphics).toBe(4);
    expect(raised.warning).toBe('polish_profile_cap_raised:1->4');
  });
  it('density none / cap 0 is honoured; a high cap is untouched; no profile is fine', () => {
    expect(raisePolishProfileCap(profile(0), DURATION)).toEqual({profile: profile(0)});
    expect(raisePolishProfileCap(profile(6), DURATION).warning).toBeUndefined();
    expect(raisePolishProfileCap(null, DURATION)).toEqual({profile: null});
  });
});

describe('WP8W source pins', () => {
  it('wired through the planner, the director and the motion stage; no clip / content-type branching', () => {
    expect(read('./brollPlanner.ts')).toContain('matteUsable: input.matteUsable ?? Boolean(input.speakerCutout?.videoUrl)');
    expect(read('../directorV2/creativeDirector.ts')).toContain('remapLookForUnusableMatte(biased.resolution, matteUsable)');
    expect(read('../motionDirector/index.ts')).toContain('raisePolishProfileCap(input.contentProfile, input.outputDurationSec)');
    for (const file of ['./engagementCadence.ts', './polishDensityFill.ts', '../motionDirector/polishProfileCap.ts', '../directorV2/editLooks.ts']) expect(read(file), file).not.toMatch(/jensen|contentType\s*===|'motivational'|'opinion'/i);
    expect(read('../directorV2/editLooks.ts')).toContain('edit_look_matte_fallback');
  });
});
