/**
 * WP8H tests: (A) Edit Look enforcement on a whole fallback direction, (B) library-friendly motion briefs (key normalizer, prompt block), (C) the polish default caption template, (D) the beat
 * floor. Pure tests with the real deterministic fallback direction; source pins for the planner wiring. No network, no model call, no render.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {fallbackVisualDirection, type VisualDirection} from '../stages/broll/geminiDirector.ts';
import {applyEditLookToDirection, ensureLookMinimumBeats, kindForMomentLayout} from '../stages/broll/lookDirection.ts';
import {EDIT_LOOKS, editLookWarnings, FALLBACK_LOOK_ID, POLISH_CAPTION_TEMPLATES, POLISH_DEFAULT_CAPTION_TEMPLATE, polishCaptionTemplate} from '../stages/directorV2/editLooks.ts';
import {buildMotionDirectorPrompt} from '../stages/motionDirector/motionDirector.ts';
import {libraryContentKeysPromptBlock, normalizeMotionBriefForLibrary, resolveLibraryGraphic} from '../stages/motionDirector/libraryRegistry.ts';

const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT = resolve(SERVER, '..');
const read = (...parts: string[]) => readFileSync(resolve(ROOT, ...parts), 'utf8');
const look = (id: string) => EDIT_LOOKS.find(entry => entry.id === id)!;
const TRANSCRIPT = 'Most creators film everything in one take and then spend hours cutting the mistakes. Our editor removes the repeats and the uhms for you, and you keep the best take every time you record.';

const realFallback = (): VisualDirection => fallbackVisualDirection({transcript: TRANSCRIPT, sourceDurationSec: 40, momentCount: 4});
const sprinkled = (): VisualDirection => ({
  ...realFallback(),
  hookTitle: 'One take',
  hookSubtitle: 'no excuses',
  moments: [
    {timestamp: 6, searchKeyword: 'a', media: 'video', layout: 'cutaway', anchor: 'top', overlayText: '', textStyle: 'bar', accentColor: '#fff'},
    {timestamp: 12, searchKeyword: 'b', media: 'text', layout: 'lockup', anchor: 'top', overlayText: 'x', textStyle: 'stack', accentColor: '#fff'},
    {timestamp: 18, searchKeyword: 'c', media: 'image', layout: 'cutout', anchor: 'top', overlayText: '', textStyle: 'bar', accentColor: '#fff'},
    {timestamp: 24, searchKeyword: 'd', media: 'text', layout: 'chip', anchor: 'top', overlayText: 'y', textStyle: 'bar', accentColor: '#fff'},
  ],
  zooms: [{timestamp: 8, durationSec: 2.6}, {timestamp: 20, durationSec: 2.6}],
  depthOverlays: [{start: 9, end: 12, assetId: 'a', direction: 'up', reason: 'r'}],
  motionGraphics: [{start: 5, end: 7}, {start: 15, end: 17}, {start: 27, end: 29}] as never,
  semanticEmphasis: [{start: 30, end: 32, text: 'best', weight: 'medium', treatment: 'pill', accentColor: '#fff'}] as never,
});

describe('A: a fallback direction is run through the Edit Look', () => {
  it('the real deterministic fallback, under minimal_captions, keeps only zooms (and the captions, which are not elements) and blanks the hook', () => {
    const before = realFallback();
    expect(before.moments.length).toBeGreaterThan(0); // the fallback really does carry a sprinkle
    const {direction, dropped} = applyEditLookToDirection(before, look(FALLBACK_LOOK_ID));
    expect(direction.moments).toEqual([]);
    expect(direction.zooms).toEqual(before.zooms);
    for (const key of ['depthOverlays', 'insetReveals', 'motionGraphics', 'mediaContainers', 'frameInsets', 'semanticEmphasis'] as const) expect(direction[key], key).toEqual([]);
    expect(direction.caption).toEqual(before.caption);
    if (before.hookTitle) expect(direction.hookTitle).toBe('');
    expect(dropped.length).toBeGreaterThan(0);
    expect(dropped.every(drop => drop.reason === 'kind_not_in_look')).toBe(true);
  });
  it('extra kinds are stripped under minimal_captions: moment layouts, depth, kinetic text, emphasis and the hook', () => {
    const {direction, dropped} = applyEditLookToDirection(sprinkled(), look(FALLBACK_LOOK_ID));
    expect(direction.zooms).toHaveLength(2);
    expect(direction.moments).toEqual([]);
    expect(direction.depthOverlays).toEqual([]);
    expect(direction.motionGraphics).toEqual([]);
    expect(direction.semanticEmphasis).toEqual([]);
    expect(direction.hookTitle).toBe('');
    expect(direction.hookSubtitle).toBe('');
    expect(dropped.map(drop => drop.kind).sort()).toEqual(['cutaway', 'cutout', 'card', 'depth_overlay', 'emphasis', 'hook_title', 'kinetic_text', 'kinetic_text', 'kinetic_text', 'lockup'].sort());
  });
  it('under talking_head: cutout and depth need the matte; the graphic cap keeps the EARLIEST graphics in time order; nothing moves in time', () => {
    const noMatte = applyEditLookToDirection(sprinkled(), look('talking_head'), {matteUsable: false});
    expect(noMatte.direction.moments.map(moment => moment.layout)).toEqual(['lockup']); // cutaway/chip/cutout are not talking_head kinds
    expect(noMatte.direction.depthOverlays).toEqual([]);
    expect(noMatte.dropped.some(drop => drop.kind === 'depth_overlay' && drop.reason === 'matte_not_usable')).toBe(true);
    const withMatte = applyEditLookToDirection(sprinkled(), look('talking_head'), {matteUsable: true});
    // WP8P: the cap is 5 (was 2). Graphics counted in time order: kinetic_text@5, depth_overlay@9, lockup@12, kinetic_text@15, kinetic_text@27 all fit; the cutout is not a counted graphic
    expect(withMatte.direction.moments.map(moment => moment.layout)).toEqual(['lockup', 'cutout']);
    expect(withMatte.direction.motionGraphics.map(item => (item as unknown as {start: number}).start)).toEqual([5, 15, 27]);
    expect(withMatte.direction.depthOverlays).toHaveLength(1);
    expect(withMatte.dropped.filter(drop => drop.reason === 'over_max_graphics')).toEqual([]);
    expect(withMatte.direction.moments.map(moment => moment.timestamp)).toEqual([12, 18]); // times are never moved
    // a sixth graphic is over the cap and the LATEST one is the one dropped
    const crowded = {...sprinkled(), motionGraphics: [...sprinkled().motionGraphics, {start: 33, end: 35}] as never};
    const capped = applyEditLookToDirection(crowded, look('talking_head'), {matteUsable: true});
    expect(capped.direction.motionGraphics.map(item => (item as unknown as {start: number}).start)).toEqual([5, 15, 27]);
    expect(capped.dropped.filter(drop => drop.reason === 'over_max_graphics')).toHaveLength(1);
  });
  it('is pure: the input is not mutated, the result is deterministic, unknown layouts count as a card', () => {
    const input = sprinkled();
    const snapshot = JSON.stringify(input);
    expect(JSON.stringify(applyEditLookToDirection(input, look('split_story')))).toBe(JSON.stringify(applyEditLookToDirection(input, look('split_story'))));
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(kindForMomentLayout('cutaway')).toBe('cutaway');
    expect(kindForMomentLayout('composite')).toBe('cutaway');
    expect(kindForMomentLayout('mystery')).toBe('card');
  });
  it('the warnings for a fallback say minimal_captions was the look and list each drop', () => {
    const {dropped} = applyEditLookToDirection(sprinkled(), look(FALLBACK_LOOK_ID));
    const warnings = editLookWarnings({id: FALLBACK_LOOK_ID, requested: '', fellBack: true, dropped});
    expect(warnings.slice(0, 2)).toEqual(['edit_look:minimal_captions', 'edit_look_fallback:minimal_captions']);
    expect(warnings).toContain(`edit_look_dropped:${dropped.length}`);
    expect(warnings).toContain('edit_look_drop:hook_title:kind_not_in_look');
  });
});

describe('B: library-friendly motion briefs', () => {
  const brief = (content: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({goal: 'g', visualDescription: 'v', placement: 'full_screen', content, ...extra});
  it('every shape the prompt asks for resolves to its composition', () => {
    const cases: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
      ['StatHighlight', {value: 85, suffix: '%', label: 'less editing time'}, {}],
      ['BigKineticHeadline', {lines: ['One take', 'zero stress'], accent: 'zero'}, {}],
      ['BigKineticHeadline', {headline: 'Cut the repeats'}, {}],
      ['VsClaim', {left: 'Raw', right: 'Polished', center: 'VS'}, {}],
      ['TopicPills', {items: ['Retakes', 'Fillers', 'Noise']}, {placement: 'overlay', visualDescription: 'floating pills'}],
      ['FullscreenStatement', {statement: 'Keep the best take', sublabel: 'every time'}, {}],
      ['QuoteCallout', {quote: 'Ship the take, not the mistakes', author: 'The editor'}, {}],
      ['ProcessSteps', {title: 'How it works', steps: ['Record', 'Upload', 'Share']}, {}],
      ['BeforeAfter', {before: {label: 'Raw'}, after: {label: 'Polished'}}, {}],
    ];
    for (const [id, content, extra] of cases) expect(resolveLibraryGraphic(brief(content, extra) as never)?.compositionId, id).toBe(id);
  });
  it('the normalizer renames common alternate keys when the target is absent and the value has the right type', () => {
    expect(normalizeMotionBriefForLibrary({heading: 'Cut the repeats'})).toEqual({content: {headline: 'Cut the repeats'}, renamed: ['heading->headline']});
    expect(normalizeMotionBriefForLibrary({topics: ['a', 'b']}).content).toEqual({items: ['a', 'b']});
    expect(normalizeMotionBriefForLibrary({tags: ['a', 'b']}).renamed).toEqual(['tags->items']);
    expect(normalizeMotionBriefForLibrary({stages: ['a', 'b']}).content).toEqual({steps: ['a', 'b']});
    expect(normalizeMotionBriefForLibrary({leftText: 'Raw', rightText: 'Polished'}).content).toEqual({left: 'Raw', right: 'Polished'});
    expect(normalizeMotionBriefForLibrary({quote_text: 'Hello there'}).content).toEqual({quote: 'Hello there'});
    expect(normalizeMotionBriefForLibrary({big_number: 85, label: 'x'}).content).toEqual({value: 85, label: 'x'});
  });
  it('it never overwrites, never joins and never converts: a present target, a wrong type or unknown keys are left alone', () => {
    expect(normalizeMotionBriefForLibrary({heading: 'A', headline: 'B'})).toEqual({content: {heading: 'A', headline: 'B'}, renamed: []});
    expect(normalizeMotionBriefForLibrary({topics: 'a, b'}).content).toEqual({topics: 'a, b'});
    expect(normalizeMotionBriefForLibrary({heading: 5}).content).toEqual({heading: 5});
    expect(normalizeMotionBriefForLibrary({mood: 'calm'}).renamed).toEqual([]);
  });
  it('the normalizer does not mutate its input, and the registry uses it (alternate keys now hit; nothing is invented)', () => {
    const content = {topics: ['Retakes', 'Fillers']};
    normalizeMotionBriefForLibrary(content);
    expect(content).toEqual({topics: ['Retakes', 'Fillers']});
    const hit = resolveLibraryGraphic(brief({topics: ['Retakes', 'Fillers']}, {placement: 'overlay', visualDescription: 'floating topic pills'}) as never)!;
    expect(hit.compositionId).toBe('TopicPills');
    expect(hit.props).toEqual({items: [{label: 'Retakes'}, {label: 'Fillers'}]});
    expect(resolveLibraryGraphic(brief({heading: 'Cut the repeats'}) as never)!.compositionId).toBe('BigKineticHeadline');
    expect(resolveLibraryGraphic(brief({leftText: 'Raw', rightText: 'Polished'}) as never)!.props).toMatchObject({left: 'Raw', right: 'Polished'});
  });
  it('the prompt block names every key the registry resolves, and is added to the motion Director prompt only when asked', () => {
    const block = libraryContentKeysPromptBlock();
    for (const key of ['"value"', '"lines"', '"headline"', '"left"', '"right"', '"items"', '"statement"', '"quote"', '"steps"', '"before"', '"after"']) expect(block, key).toContain(key);
    const base = {transcript: 'one two three four', words: [{text: 'one', start: 0, end: 0.4}], outputDurationSec: 10, languageCode: 'en', occupied: []};
    expect(buildMotionDirectorPrompt(base)).not.toContain('LIBRARY-FRIENDLY CONTENT KEYS');
    expect(buildMotionDirectorPrompt({...base, libraryBriefs: true})).toContain('LIBRARY-FRIENDLY CONTENT KEYS');
    expect(buildMotionDirectorPrompt({...base, libraryBriefs: false})).toBe(buildMotionDirectorPrompt(base));
    expect(read('server/src/stages/motionDirector/index.ts')).toContain('libraryBriefs: input.preferLibrary,');
  });
});

describe('C: the polish default caption template', () => {
  it('keeps a clean outline template, replaces everything else (including gaming-stream and boxed or neon looks) with karaoke', () => {
    for (const keep of POLISH_CAPTION_TEMPLATES) expect(polishCaptionTemplate(keep)).toEqual({template: keep, replaced: false});
    for (const bad of ['gaming-stream', 'gaming-stream-theme', 'grape', 'box', 'beast', 'hormozi', 'pop', undefined, null, '']) expect(polishCaptionTemplate(bad as never), String(bad)).toEqual({template: POLISH_DEFAULT_CAPTION_TEMPLATE, replaced: true});
    expect(POLISH_DEFAULT_CAPTION_TEMPLATE).toBe('karaoke');
    expect(POLISH_CAPTION_TEMPLATES).not.toContain('gaming-stream');
    expect(POLISH_CAPTION_TEMPLATES).toContain(POLISH_DEFAULT_CAPTION_TEMPLATE);
  });
  it('the planner applies it only on polish with no caller template; an explicit template still wins afterwards; the backing plate stays off', () => {
    const planner = read('server/src/stages/broll/brollPlanner.ts');
    expect(planner).toContain('if (input.editLooks && !input.captionTemplate) {\n    const pick = polishCaptionTemplate(direction.caption.template);');
    expect(planner).toContain("boxColor: null, animation: 'highlight'}};");
    expect(planner.indexOf('if (input.editLooks && !input.captionTemplate) {')).toBeLessThan(planner.indexOf('if (input.captionTemplate) {\n    const before = direction.caption.template;'));
    expect(read('remotion/src/lib/captionSplit.ts')).toContain('return captions?.backingPlate === true;'); // WP8G: the full-width plate is opt-in only
    expect(read('remotion/src/ShortVideo.tsx')).toContain('captionBackingPlateEnabled(legibleCaptions)');
  });
  it('the cuts-only captions-only path is untouched (it already defaults to karaoke) and CaptionKit presets are not routed through the polish default', () => {
    const analyze = read('server/src/pipeline/analyzeVideo.ts');
    expect(analyze).toContain("caption = lockCaptionTemplate(caption, input.captionTemplate ?? 'karaoke');");
    expect(analyze).not.toContain('polishCaptionTemplate');
  });
});

describe('D: the beat floor and the planner wiring', () => {
  const stubs = [{timestamp: 11.2, durationSec: 2.6}, {timestamp: 24.8, durationSec: 2.6}, {timestamp: 30, durationSec: 2.6}];
  it('a non-minimal look with no zoom gets at most two deterministic zooms; a direction that already has one is left alone', () => {
    const empty = {...realFallback(), zooms: [], moments: []};
    const floored = ensureLookMinimumBeats(empty, look('talking_head'), stubs);
    expect(floored.addedZooms).toBe(2);
    expect(floored.direction.zooms).toEqual(stubs.slice(0, 2));
    expect(ensureLookMinimumBeats({...empty, zooms: [{timestamp: 9, durationSec: 2.6}]}, look('talking_head'), stubs).addedZooms).toBe(0);
    expect(ensureLookMinimumBeats(empty, look('explainer_cutaway'), []).addedZooms).toBe(0);
    expect(empty.zooms).toEqual([]); // not mutated
  });
  it('nothing but zooms is ever added (no moments, no stock, no assets, no invented copy)', () => {
    const empty = {...realFallback(), zooms: [], moments: []};
    const floored = ensureLookMinimumBeats(empty, look('split_story'), stubs).direction;
    expect({...floored, zooms: []}).toEqual({...empty, zooms: []});
  });
  it('the planner: a plan under a look gets its warnings once and the floor for a non-minimal look; no plan -> the fallback runs through minimal_captions', () => {
    const planner = read('server/src/stages/broll/brollPlanner.ts');
    for (const part of [
      'lookDecision = v2.plan?.editLook;',
      'warnings.push(...editLookWarnings(lookDecision));',
      "if (chosen && chosen.id !== FALLBACK_LOOK_ID) {",
      'warnings.push(`edit_look_min_beats:zoom:${floor.addedZooms}`);',
      'const enforced = applyEditLookToDirection(direction, minimal, {matteUsable: input.matteUsable});',
      "warnings.push(...editLookWarnings({id: FALLBACK_LOOK_ID, requested: '', fellBack: true, dropped: enforced.dropped}));",
    ]) expect(planner, part).toContain(part);
    expect(planner.match(/editLookWarnings\(/g)).toHaveLength(2);
    expect(planner.indexOf('const enforced = applyEditLookToDirection(')).toBeLessThan(planner.indexOf("const allowedEdits = input.requestedEdits?.length"));
  });
  it('the look direction module is pure (types and the look rules only)', () => {
    const module_ = read('server/src/stages/broll/lookDirection.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect([...module_.matchAll(/^import .* from '([^']+)'/gm)].map(match => match[1])).toEqual(['./geminiDirector.ts', '../directorV2/editLooks.ts']);
    expect(module_).toMatch(/^import type \{DirectedZoom, VisualDirection\} from '\.\/geminiDirector\.ts';/m);
    for (const word of ['process.env', 'fetch(', 'logger', 'readFile']) expect(module_).not.toContain(word);
  });
});
