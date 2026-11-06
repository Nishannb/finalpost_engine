/**
 * WP8B tests: Edit Looks. Pure: the look table, resolution and fallback, enforcement (illegal kinds stripped, graphic cap, matte gate), the warnings, the schema / prompt helpers, and a fake Director
 * JSON parsed through the real `parseCreativePlan` (offline: no model call). Source-text pins for the polish wiring read analyzeVideo / brollPlanner (they import the logger).
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {occupancyFromSpeaker} from '../layout/occupancy.ts';
import {parseCreativePlan} from './creativeDirector.ts';
import {
  EDIT_LOOK_IDS,
  EDIT_LOOKS,
  editLookPromptBlock,
  editLookWarnings,
  enforceEditLook,
  FALLBACK_LOOK_ID,
  MATTE_DEPENDENT_KINDS,
  resolveEditLook,
  stage2SchemaWithEditLook,
} from './editLooks.ts';
import {audioFacts} from './perception.ts';
import {ELEMENT_KINDS, STAGE2_RESPONSE_SCHEMA} from './schemas.ts';
import type {PerceptionPack, WordRef} from './types.ts';

const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (...parts: string[]) => readFileSync(resolve(SERVER, ...parts), 'utf8');
const look = (id: string) => EDIT_LOOKS.find(entry => entry.id === id)!;
const els = (...kinds: string[]) => kinds.map((kind, index) => ({id: `e${index + 1}`, kind}));

describe('the look table', () => {
  it('has the four looks, the fallback among them, each with the full field set', () => {
    expect(EDIT_LOOK_IDS).toEqual(['talking_head', 'explainer_cutaway', 'split_story', 'minimal_captions']);
    expect(EDIT_LOOK_IDS).toContain(FALLBACK_LOOK_ID);
    for (const entry of EDIT_LOOKS) {
      expect(Object.keys(entry).sort()).toEqual(['allowedElementKinds', 'captionBias', 'graphicKinds', 'id', 'label', 'maxGraphics', 'notes', 'preferCutout', 'requireMatteForTextBehind'].sort());
      expect(entry.notes.length).toBeGreaterThan(20);
    }
  });
  it('every allowlist is a subset of the live ELEMENT_KINDS, graphic kinds are allowed kinds, and custom_graphic / custom_scene are not used', () => {
    for (const entry of EDIT_LOOKS) {
      for (const kind of entry.allowedElementKinds) expect(ELEMENT_KINDS as readonly string[], `${entry.id}:${kind}`).toContain(kind);
      for (const kind of entry.graphicKinds) expect(entry.allowedElementKinds, `${entry.id}:${kind}`).toContain(kind);
      expect(entry.allowedElementKinds as readonly string[]).not.toContain('custom_graphic');
      expect(entry.allowedElementKinds as readonly string[]).not.toContain('custom_scene');
    }
  });
  it('the allowlists, caps and matte flags are what the report says', () => {
    expect(look('talking_head')).toMatchObject({maxGraphics: 5, preferCutout: true, requireMatteForTextBehind: true});
    expect(look('talking_head').allowedElementKinds).toEqual(expect.arrayContaining(['cutout', 'kinetic_text', 'lockup', 'zoom']));
    expect(look('explainer_cutaway')).toMatchObject({maxGraphics: 5, preferCutout: false, requireMatteForTextBehind: false});
    // WP52: bubble removed from the polish look
    expect(look('explainer_cutaway').allowedElementKinds).toEqual(expect.arrayContaining(['card', 'cutaway', 'zoom']));
    expect(look('explainer_cutaway').allowedElementKinds).not.toContain('cutout');
    expect(look('split_story').allowedElementKinds).toEqual(expect.arrayContaining(['split', 'frame_inset', 'kinetic_text']));
    expect(look('minimal_captions')).toMatchObject({maxGraphics: 0, allowedElementKinds: ['zoom']});
  });
  it('only looks that need a matte allow matte-dependent kinds as text-behind, and they require the matte', () => {
    for (const entry of EDIT_LOOKS) {
      const usesMatte = entry.allowedElementKinds.some(kind => (MATTE_DEPENDENT_KINDS as readonly string[]).includes(kind));
      if (usesMatte) expect(entry.requireMatteForTextBehind, entry.id).toBe(true);
    }
  });
});

describe('resolution and fallback', () => {
  it('an exact id resolves; anything else falls back to minimal_captions and says so', () => {
    for (const id of EDIT_LOOK_IDS) expect(resolveEditLook(id)).toMatchObject({fellBack: false, requested: id, look: {id}});
    for (const raw of [undefined, null, '', 'Talking_Head', 'talking head', 'bonomi', 'unknown_look', 42, {}]) {
      expect(resolveEditLook(raw), String(raw)).toMatchObject({fellBack: true, look: {id: 'minimal_captions'}});
    }
    expect(resolveEditLook('bonomi').requested).toBe('bonomi');
  });
});

describe('enforcement', () => {
  it('strips illegal kinds and reports each drop', () => {
    const result = enforceEditLook(els('zoom', 'cutaway', 'kinetic_text', 'card', 'cutout', 'zoom'), look('minimal_captions'));
    expect(result.kept.map(item => item.kind)).toEqual(['zoom', 'zoom']);
    expect(result.dropped.map(item => [item.kind, item.reason])).toEqual([
      ['cutaway', 'kind_not_in_look'],
      ['kinetic_text', 'kind_not_in_look'],
      ['card', 'kind_not_in_look'],
      ['cutout', 'kind_not_in_look'],
    ]);
  });
  it('keeps every legal element of a look and preserves order', () => {
    const result = enforceEditLook(els('hook_title', 'zoom', 'card', 'cutaway'), look('explainer_cutaway'));
    expect(result.dropped).toEqual([]);
    expect(result.kept.map(item => item.kind)).toEqual(['hook_title', 'zoom', 'card', 'cutaway']);
  });
  it('caps designed graphics at maxGraphics, keeping the first ones in order', () => {
    // explainer graphicKinds = cutaway + media_container; cards are not capped. Six cutaways overflow POLISH_LOOK_MAX_GRAPHICS (5).
    const result = enforceEditLook(
      els('cutaway', 'zoom', 'media_container', 'cutaway', 'cutaway', 'cutaway', 'cutaway', 'card'),
      look('explainer_cutaway'),
    );
    expect(result.kept.map(item => item.kind)).toEqual(['cutaway', 'zoom', 'media_container', 'cutaway', 'cutaway', 'cutaway', 'card']);
    expect(result.dropped).toEqual([{id: 'e7', kind: 'cutaway', reason: 'over_max_graphics'}]);
    const talking = enforceEditLook(
      els('kinetic_text', 'lockup', 'kinetic_text', 'kinetic_text', 'kinetic_text', 'kinetic_text', 'zoom'),
      look('talking_head'),
      {matteUsable: true},
    );
    expect(talking.kept.map(item => item.id)).toEqual(['e1', 'e2', 'e3', 'e4', 'e5', 'e7']);
    expect(talking.dropped.map(item => item.reason)).toEqual(['over_max_graphics']);
  });
  it('drops text-behind / depth elements when the look needs a matte and none is usable; keeps them when it is', () => {
    const items = els('cutout', 'depth_overlay', 'zoom');
    const without = enforceEditLook(items, look('talking_head'));
    expect(without.kept.map(item => item.kind)).toEqual(['zoom']);
    expect(without.dropped.map(item => item.reason)).toEqual(['matte_not_usable', 'matte_not_usable']);
    expect(enforceEditLook(items, look('talking_head'), {matteUsable: false}).kept).toHaveLength(1);
    expect(enforceEditLook(items, look('talking_head'), {matteUsable: true}).dropped).toEqual([]);
  });
  it('does not mutate its input and is deterministic', () => {
    const items = els('zoom', 'cutaway');
    const before = JSON.stringify(items);
    expect(enforceEditLook(items, look('minimal_captions'))).toEqual(enforceEditLook(items, look('minimal_captions')));
    expect(JSON.stringify(items)).toBe(before);
  });
});

describe('warnings, schema and prompt helpers', () => {
  it('warnings name the look, the fallback, the count and each drop', () => {
    expect(editLookWarnings({id: 'talking_head', requested: 'talking_head', fellBack: false, dropped: []})).toEqual(['edit_look:talking_head']);
    expect(editLookWarnings({id: 'minimal_captions', requested: 'bonomi', fellBack: true, dropped: [{id: 'e1', kind: 'card', reason: 'kind_not_in_look'}]})).toEqual([
      'edit_look:minimal_captions',
      'edit_look_fallback:minimal_captions',
      'edit_look_dropped:1',
      'edit_look_drop:card:kind_not_in_look',
    ]);
  });
  it('the looks schema is a clone with a required edit_look enum; the base schema is untouched', () => {
    const base = JSON.stringify(STAGE2_RESPONSE_SCHEMA);
    const schema = stage2SchemaWithEditLook() as unknown as {properties: Record<string, {enum?: string[]}>; required: string[]};
    expect(schema.properties.edit_look!.enum).toEqual(EDIT_LOOK_IDS);
    expect(schema.required[0]).toBe('edit_look');
    expect(schema.required).toEqual(expect.arrayContaining(['edit_thesis', 'elements']));
    expect(JSON.stringify(STAGE2_RESPONSE_SCHEMA)).toBe(base);
    expect(Object.keys(STAGE2_RESPONSE_SCHEMA.properties)).not.toContain('edit_look');
  });
  it('the prompt block lists every look and asks for exactly one; a fixed look is stated for a repair', () => {
    const block = editLookPromptBlock();
    for (const id of EDIT_LOOK_IDS) expect(block).toContain(id);
    expect(block).toContain('EXACTLY ONE');
    expect(block).toContain('minimal_captions only for content that must stay plain');
    const fixed = editLookPromptBlock('split_story');
    expect(fixed).toContain('fixed for this edit');
    expect(fixed).toContain('"split_story"');
  });
});

const words: WordRef[] = [
  {id: 'w0', text: 'This', start: 1, end: 1.2, sentenceId: 's0'},
  {id: 'w1', text: 'hoodie', start: 1.3, end: 1.7, sentenceId: 's0'},
  {id: 'w2', text: 'sold', start: 1.8, end: 2.1, sentenceId: 's0'},
  {id: 'w3', text: 'out', start: 2.2, end: 2.5, sentenceId: 's0'},
];
function pack(cutout = false): PerceptionPack {
  return {
    words,
    sentences: [{id: 's0', wordIds: words.map(word => word.id), start: 1, end: 2.5, text: 'This hoodie sold out'}],
    storyboard: [],
    occupancySlices: [{atSec: 2, occupancy: occupancyFromSpeaker({x: 0.2, y: 0.18, w: 0.55, h: 0.64}, 'vision')}],
    audio: audioFacts(words),
    transcript: 'This hoodie sold out',
    outputDurationSec: 12,
    language: 'en',
    creatorProfile: '',
    speakerCutoutAvailable: cutout,
    speakerCutoutNote: '',
    userAssets: [],
  };
}
const element = (id: string, kind: string, start = 'w1', end = 'w2') => ({id, beat_id: 'b1', intent: 'x', kind, start_word_id: start, end_word_id: end, text: 'sold out'});
const director = (look: unknown, kinds: string[]) => ({
  ...(look === undefined ? {} : {edit_look: look}),
  edit_thesis: {look: 'cream type', rhythm: 'quiet', motion_language: 'slow', color_story: 'warm', why: 'fits'},
  cold_open: {use: false},
  caption_style: {template: 'clean', position: 'bottom'},
  elements: kinds.map((kind, index) => element(`e${index + 1}`, kind)),
  cta: {start_word_id: 'w3', end_word_id: 'w3', keyword: 'sold', suggested: false},
});

describe('fixture: a fake Director JSON through the real parser', () => {
  it('a wrong-kind plan under minimal_captions is stripped to zoom only (captions are not elements and stay)', () => {
    const plan = parseCreativePlan(director('minimal_captions', ['hook_title', 'zoom', 'cutaway', 'kinetic_text', 'card', 'lockup']), 0, pack(), undefined, {promptVersion: 'x', inputHash: '', editLooks: {}});
    expect(plan.elements.map(item => item.kind)).toEqual(['zoom']);
    expect(plan.editLook).toMatchObject({id: 'minimal_captions', fellBack: false});
    expect(plan.editLook!.dropped.map(drop => drop.kind)).toEqual(['hook_title', 'cutaway', 'kinetic_text', 'card', 'lockup']);
    expect(plan.caption.template).toBe('clean');
  });
  it('a missing, unknown or hallucinated look falls back to minimal_captions with a recorded request', () => {
    for (const raw of [undefined, 'bonomi_deluxe', 7]) {
      const plan = parseCreativePlan(director(raw, ['zoom', 'cutaway', 'lockup']), 0, pack(), undefined, {promptVersion: 'x', inputHash: '', editLooks: {}});
      expect(plan.elements.map(item => item.kind), String(raw)).toEqual(['zoom']);
      expect(plan.editLook).toMatchObject({id: 'minimal_captions', fellBack: true});
      expect(editLookWarnings(plan.editLook!)).toContain('edit_look_fallback:minimal_captions');
    }
  });
  it('a valid look keeps its own kinds, drops the others and the cap overflow', () => {
    const plan = parseCreativePlan(
      director('explainer_cutaway', ['zoom', 'cutaway', 'cutaway', 'cutaway', 'cutaway', 'cutaway', 'cutaway', 'lockup', 'card']),
      0,
      pack(),
      undefined,
      {promptVersion: 'x', inputHash: '', editLooks: {}},
    );
    expect(plan.elements.map(item => item.kind)).toEqual(['zoom', 'cutaway', 'cutaway', 'cutaway', 'cutaway', 'cutaway', 'card']);
    expect(plan.editLook!.dropped.map(drop => drop.reason)).toEqual(['over_max_graphics', 'kind_not_in_look']);
  });
  it('talking_head keeps the cutout only when the pack says the speaker cutout is available (WP8W: otherwise the plan moves to explainer_cutaway)', () => {
    const kinds = ['zoom', 'cutout', 'kinetic_text'];
    const noMatte = parseCreativePlan(director('talking_head', kinds), 0, pack(false), undefined, {promptVersion: 'x', inputHash: '', editLooks: {}});
    expect(noMatte.elements.map(item => item.kind)).toEqual(['zoom']);
    expect(noMatte.editLook).toMatchObject({id: 'explainer_cutaway', matteFallbackFrom: 'talking_head'});
    expect(parseCreativePlan(director('talking_head', kinds), 0, pack(true), undefined, {promptVersion: 'x', inputHash: '', editLooks: {}}).elements.map(item => item.kind)).toEqual(['zoom', 'cutout', 'kinetic_text']);
  });
  it('a repair keeps the first look: lookId wins over whatever the repair JSON says', () => {
    const plan = parseCreativePlan(director('explainer_cutaway', ['zoom', 'cutaway']), 0, pack(), undefined, {promptVersion: 'x', inputHash: '', editLooks: {lookId: 'minimal_captions'}});
    expect(plan.editLook).toMatchObject({id: 'minimal_captions', fellBack: false});
    expect(plan.elements.map(item => item.kind)).toEqual(['zoom']);
  });
  it('without looks (every other profile) the same JSON is parsed exactly as before: nothing stripped, no editLook field', () => {
    const plan = parseCreativePlan(director('minimal_captions', ['zoom', 'cutaway', 'lockup']), 0, pack());
    expect(plan.elements.map(item => item.kind)).toEqual(['zoom', 'cutaway', 'lockup']);
    expect('editLook' in plan).toBe(false);
  });
});

describe('wiring (source text)', () => {
  const analyze = read('src', 'pipeline', 'analyzeVideo.ts');
  const planner = read('src', 'stages', 'broll', 'brollPlanner.ts');
  const creative = read('src', 'stages', 'directorV2', 'creativeDirector.ts');
  const runner = read('src', 'stages', 'directorV2', 'runDirectorV2.ts');
  it('analyzeVideo switches looks on only for polish, and runs the v2 visual Director there', () => {
    expect(analyze).toContain('const visualDirectorV2 = directorV2 || polishPath;');
    expect(analyze).toContain('directorV2: visualDirectorV2,\n        editLooks: polishPath,');
    expect(analyze).toContain('alreadyOutput: visualDirectorV2,');
    expect(analyze).toContain('flags.visualContextV2 && !visualDirectorV2'); // the job's EffectiveFlags (env unless a style pins it)
    expect(analyze.match(/editLooks:/g)).toHaveLength(1);
    // the LLM delivery direction still reads the plain switch
    expect(analyze).toContain('const direction = directorV2\n');
  });
  it('the flag is threaded planBRoll -> runDirectorV2 -> designEdit, and the warnings are pushed', () => {
    expect(planner).toContain('editLooks?: boolean;');
    expect(planner).toContain('editLooks: input.editLooks,');
    expect(planner).toContain('lookDecision = v2.plan?.editLook;'); // WP8H: the warnings are pushed once, after the director block
    expect(planner).toContain('warnings.push(...editLookWarnings(lookDecision));');
    expect(runner).toContain('{editLooks: input.editLooks, matteUsable: input.matteUsable, lookBias: input.lookBias, kineticTypePrompt: input.kineticType?.prompt}'); // WP8C matte + WP8P look bias + WP55 phase 2 kinetic-type offer
  });
  it('designEdit changes the request only when looks are on; repair fixes the first look', () => {
    expect(creative).toContain("(options.editLooks ? `\\n\\n${editLookPromptBlock()}` : '')");
    expect(creative).toContain('responseSchema: options.editLooks ? stage2SchemaWithEditLook() : STAGE2_RESPONSE_SCHEMA,');
    expect(creative).toContain('const fixedLookId = previous.editLook?.id;');
    expect(creative).toContain('editLooks: fixedLookId ? {lookId: fixedLookId, matteUsable: previous.editLook?.matteUsable} : undefined,'); // WP8C
    expect(creative).toContain('if (meta.editLooks) {');
  });
  it('the module is pure (only the schema constants are imported) and there is no model, network or env use', () => {
    const module_ = read('src', 'stages', 'directorV2', 'editLooks.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect([...module_.matchAll(/^import .* from '([^']+)'/gm)].map(match => match[1])).toEqual(['./schemas.ts']);
    for (const word of ['process.env', 'fetch(', 'logger', 'requestJson', 'callDirectorModel']) expect(module_).not.toContain(word);
  });
});
