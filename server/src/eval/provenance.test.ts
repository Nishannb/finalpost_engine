/**
 * Phase 28, Step 1a: design-value provenance — origin at creation, and survival through every stage that rebuilds an edit.
 *
 * Provenance is metadata only (nothing reads it to decide anything yet). These tests run the REAL v1 parser, v2 compiler, planner
 * remapping, layout compositor / geometric patches, edit-conflict validator and finalizeEdits (with and without a content profile)
 * on crafted Director output. Offline: Director and stock search are stubbed, no network.
 *
 * What they pin down: (1) an explicit #000000 and a defaulted #000000 are distinguishable at every stage; (2) values the content-profile
 * harmonisation rewrites are re-stamped `profile` (its behaviour is unchanged and pinned elsewhere); (3) fallback-produced items say
 * `fallback`; (4) provenance never serialises and never affects equality.
 */
import {describe, expect, it, vi} from 'vitest';

import {buildTimeline} from '../stages/filters/timeline.ts';
import {carryProvenance, carryProvenanceAfterRewrite, colorOrigin, provenanceOf, provenanceSnapshot, stampProvenance} from '../lib/provenance.ts';
import {PROVENANCE, type FrameInset, type MediaContainerMoment, type MotionGraphic, type SemanticEmphasis} from '../types/blueprint.ts';
import {validateAndApply, type EditPlanView} from '../lib/editConflicts.ts';
import {EditLedger} from '../lib/editLedger.ts';
import {applyGeometricPatches, applyVisionPatches, type LayoutPlan} from '../stages/layout/layoutCritique.ts';
import {composeBeautifulLayout} from '../stages/layout/slotCompositor.ts';
import {occupancyFromSpeaker} from '../stages/layout/occupancy.ts';
import {designFromProfile} from '../stages/contentProfile/artDirection.ts';
import {parseContentProfile} from '../stages/contentProfile/contentProfile.ts';
import {fallbackMotionPlan} from '../stages/broll/motionGraphicsPlan.ts';
import {parseVisualDirectorJson, type VisualDirection} from '../stages/broll/geminiDirector.ts';
import {craftedV1Response, fallbackDirection, PROFILE_RESPONSE, PROFILE_RESPONSE_BAD_MOOD, runV1, runV2, V2_CASES, type Deps} from './phase28Scenarios.ts';

const hoisted = vi.hoisted(() => ({direction: null as unknown}));
vi.mock('../stages/broll/geminiDirector.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../stages/broll/geminiDirector.ts')>();
  return {...actual, directorConfigured: () => true, planVisualDirection: async () => hoisted.direction as VisualDirection};
});
let nextId = 1;
vi.mock('../stages/broll/stockSearch.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../stages/broll/stockSearch.ts')>();
  const asset = () => ({assetUrl: `https://stock.invalid/${nextId}.mp4`, provider: 'pexels' as const, providerId: nextId++, width: 1080, height: 1920, durationSec: 12, credit: 'x', creditUrl: ''});
  return {...actual, stockConfigured: () => true, findBRollAsset: async () => asset(), findPhotoAsset: async () => asset(), listBRollAssets: async () => [asset(), asset(), asset()]};
});
const {planBRoll} = await import('../stages/broll/brollPlanner.ts');
const deps: Deps = {planBRoll: planBRoll as never, setDirection: direction => { hoisted.direction = direction; }};

const graphic = (list: MotionGraphic[], text: string) => list.find(item => item.text === text)!;
const emphasis = (list: SemanticEmphasis[], text: string) => list.find(item => item.text === text)!;
const origin = (item: object, field: string) => provenanceOf(item, field);

describe('provenance helpers', () => {
  it('stamps, merges, reports unknown for an unstamped field, and never becomes enumerable or serialised', () => {
    const item: {a: string; b: string} = {a: '#000000', b: '#111111'};
    expect(provenanceOf(item, 'a')).toBeUndefined();
    stampProvenance(item, {a: 'director'});
    stampProvenance(item, {b: 'default'});
    expect(provenanceSnapshot(item)).toEqual({a: 'director', b: 'default'});
    expect(provenanceOf(item, 'c')).toBeUndefined();
    expect(Object.keys(item)).toEqual(['a', 'b']);
    expect(JSON.stringify(item)).toBe('{"a":"#000000","b":"#111111"}');
    expect(Object.getOwnPropertySymbols(item)).toEqual([PROVENANCE]);
    expect(item).toEqual({a: '#000000', b: '#111111'});
    expect(item).toStrictEqual({a: '#000000', b: '#111111'});
  });

  it('object spread drops provenance (so a stage must carry it), and absence is unknown, never "director"', () => {
    const stamped = stampProvenance({color: '#000000'}, {color: 'director'});
    const spread = {...stamped};
    expect(provenanceOf(spread, 'color')).toBeUndefined();
    expect(provenanceOf(carryProvenance(stamped, spread), 'color')).toBe('director');
  });

  it('carryProvenance keeps the target\'s own entries over the source\'s, and is a no-op without a source map', () => {
    const from = stampProvenance({x: 1, y: 2}, {x: 'director', y: 'director'});
    const to = stampProvenance({x: 1, y: 2}, {y: 'default'});
    carryProvenance(from, to);
    expect(provenanceSnapshot(to)).toEqual({x: 'director', y: 'default'});
    const bare = {x: 1};
    expect(carryProvenance({}, bare)).toBe(bare);
    expect(provenanceSnapshot(bare)).toBeUndefined();
  });

  it('carryProvenanceAfterRewrite re-stamps only the fields whose value changed', () => {
    const before = stampProvenance({accent: '#111111', text: '#FFFFFF'}, {accent: 'director', text: 'director'});
    const after = carryProvenanceAfterRewrite(before, {accent: '#222222', text: '#FFFFFF'}, {accent: 'profile', text: 'profile'});
    expect(provenanceSnapshot(after)).toEqual({accent: 'profile', text: 'director'});
  });

  it.each([
    ['#000000', 'director'], ['#abc', 'director'], ['#AABBCC', 'director'], [' #112233 ', 'director'],
    ['red', 'default'], ['', 'default'], ['#12', 'default'], ['#GGGGGG', 'default'], [undefined, 'default'], [null, 'default'], [123, 'default'],
  ])('colorOrigin(%j) = %s', (raw, expected) => {
    expect(colorOrigin(raw)).toBe(expected);
  });
});

describe('v1 Director path: parse -> planner remap -> layout -> finalize', () => {
  it('parser: an explicit #000000 and a defaulted #000000 are distinguishable', () => {
    const {raw, fixture} = craftedV1Response();
    const direction = parseVisualDirectorJson(raw, fixture.sourceDurationSec, fixture.transcript);
    const [explicit, defaulted] = direction.frameInsets;
    expect(explicit!.marginColor).toBe('#000000');
    expect(defaulted!.marginColor).toBe('#000000');
    expect(origin(explicit!, 'marginColor')).toBe('director');
    expect(origin(defaulted!, 'marginColor')).toBe('default');

    const kinetic = graphic(direction.motionGraphics, 'EXPLICIT BLACK');
    expect([kinetic.accentColor, kinetic.textColor]).toEqual(['#000000', '#000000']);
    expect([origin(kinetic, 'accentColor'), origin(kinetic, 'textColor')]).toEqual(['director', 'director']);
    const none = graphic(direction.motionGraphics, 'NO COLOURS');
    expect([origin(none, 'accentColor'), origin(none, 'textColor')]).toEqual(['default', 'default']);
    const invalid = graphic(direction.motionGraphics, 'INVALID COLOURS');
    expect([invalid.accentColor, invalid.textColor]).toEqual(['#FACC15', '#FFFFFF']);
    expect([origin(invalid, 'accentColor'), origin(invalid, 'textColor')]).toEqual(['default', 'default']);

    const [boxExplicit, boxDefault] = direction.mediaContainers;
    expect([boxExplicit!.canvasColor, origin(boxExplicit!, 'canvasColor'), origin(boxExplicit!, 'canvasTitleColor')]).toEqual(['#000000', 'director', 'director']);
    expect([boxDefault!.canvasColor, origin(boxDefault!, 'canvasColor'), origin(boxDefault!, 'canvasTitleColor')]).toEqual(['#F8FAFC', 'default', 'default']);

    expect(origin(emphasis(direction.semanticEmphasis, 'explicit'), 'accentColor')).toBe('director');
    expect(origin(emphasis(direction.semanticEmphasis, 'defaulted'), 'accentColor')).toBe('default');
  });

  it('Phase 29 contract: a v1 frame inset that only supplies canvas_color borrows it, so the margin is `default`, not the Director\'s choice; margin_color is explicit', () => {
    const {raw, fixture} = craftedV1Response();
    const parse = (inset: Record<string, unknown>) =>
      parseVisualDirectorJson(JSON.stringify({...(JSON.parse(raw) as Record<string, unknown>), frame_insets: [{start: 15, end: 19.5, scale: 0.8, ...inset}]}), fixture.sourceDurationSec, fixture.transcript).frameInsets[0]!;
    const borrowed = parse({canvas_color: '#123456'});
    const camel = parse({marginColor: '#654321'});
    const invalid = parse({margin_color: 'teal', canvas_color: '#123456'});
    expect([borrowed.marginColor, origin(borrowed, 'marginColor')]).toEqual(['#123456', 'default']);
    expect([camel.marginColor, origin(camel, 'marginColor')]).toEqual(['#654321', 'director']);
    expect([invalid.marginColor, origin(invalid, 'marginColor')]).toEqual(['#000000', 'default']); // an unusable explicit margin_color is replaced by the constant (it does not fall through to canvas_color)
  });

  it('every edit keeps its provenance through planner remap, layout compositor + geometric patches, and finalizeEdits (no profile)', async () => {
    const run = await runV1(deps);
    const stages: Array<[string, {motionGraphics: MotionGraphic[]; mediaContainers: MediaContainerMoment[]; semanticEmphasis: SemanticEmphasis[]; frameInsets?: FrameInset[]}]> = [
      ['planned', run.planned],
      ['laid out', {...run.laidOut!, frameInsets: run.planned.frameInsets}],
      ['finalized', run.finalizedNoProfile],
    ];
    for (const [name, stage] of stages) {
      expect(stage.motionGraphics.length, name).toBe(3);
      expect(stage.mediaContainers.length, name).toBe(2);
      expect(stage.semanticEmphasis.length, name).toBe(2);
      expect(stage.frameInsets!.length, name).toBe(2);
      const explicit = graphic(stage.motionGraphics, 'EXPLICIT BLACK');
      expect([explicit.accentColor, origin(explicit, 'accentColor'), origin(explicit, 'textColor')], `${name} explicit kinetic`).toEqual(['#000000', 'director', 'director']);
      const none = graphic(stage.motionGraphics, 'NO COLOURS');
      expect([origin(none, 'accentColor'), origin(none, 'textColor')], `${name} defaulted kinetic`).toEqual(['default', 'default']);
      const invalid = graphic(stage.motionGraphics, 'INVALID COLOURS');
      expect([origin(invalid, 'accentColor'), origin(invalid, 'textColor')], `${name} invalid kinetic`).toEqual(['default', 'default']);
      expect(stage.frameInsets!.map(inset => [inset.marginColor, origin(inset, 'marginColor')]), `${name} frame insets`).toEqual([['#000000', 'director'], ['#000000', 'default']]);
      expect(stage.mediaContainers.map(box => [box.canvasColor, origin(box, 'canvasColor')]), `${name} containers`).toEqual([['#000000', 'director'], ['#F8FAFC', 'default']]);
      expect([origin(emphasis(stage.semanticEmphasis, 'explicit'), 'accentColor'), origin(emphasis(stage.semanticEmphasis, 'defaulted'), 'accentColor')], `${name} emphasis`).toEqual(['director', 'default']);
    }
  });

  it('with a content profile, harmonizeEdits rewrites non-Director colours (Director-origin ones are protected since Phase 29 step 1b); rewritten values are `profile`, untouched ones keep their origin', async () => {
    const run = await runV1(deps, PROFILE_RESPONSE);
    const before = run.finalizedNoProfile;
    const after = run.finalizedProfile!;
    // Phase 28 pinned the old overwrite of both ([#101010, #101010]). Phase 29 protects the Director's explicit margin/canvas; the defaulted one is still harmonised.
    expect(after.frameInsets.map(inset => inset.marginColor)).toEqual(['#000000', '#101010']);
    expect(after.frameInsets.map(inset => origin(inset, 'marginColor'))).toEqual(['director', 'profile']);
    expect(after.mediaContainers.map(box => origin(box, 'canvasColor'))).toEqual(['director', 'profile']);

    const pairs: Array<[string, object[], object[], string[]]> = [
      ['motionGraphics', before.motionGraphics, after.motionGraphics, ['accentColor', 'textColor']],
      ['semanticEmphasis', before.semanticEmphasis, after.semanticEmphasis, ['accentColor', 'textColor']],
      ['frameInsets', before.frameInsets, after.frameInsets, ['marginColor']],
      ['mediaContainers', before.mediaContainers, after.mediaContainers, ['canvasColor', 'canvasTitleColor']],
    ];
    let rewritten = 0;
    let kept = 0;
    for (const [name, b, a, fields] of pairs) {
      expect(a.length, name).toBe(b.length);
      a.forEach((item, index) => {
        for (const field of fields) {
          const valueBefore = (b[index] as Record<string, unknown>)[field];
          const valueAfter = (item as Record<string, unknown>)[field];
          if (valueBefore === valueAfter) {
            kept += 1;
            expect(origin(item, field), `${name}[${index}].${field} unchanged`).toBe(origin(b[index]!, field));
          } else {
            rewritten += 1;
            expect(origin(item, field), `${name}[${index}].${field} rewritten`).toBe('profile');
          }
        }
      });
    }
    expect(rewritten).toBeGreaterThan(5);
    expect(kept).toBeGreaterThanOrEqual(0);
  });

  it('a profile whose mood the classifier did not supply labels the rewritten values `default`, not `profile`', async () => {
    const run = await runV1(deps, PROFILE_RESPONSE_BAD_MOOD);
    expect(run.finalizedProfile!.frameInsets.map(inset => origin(inset, 'marginColor'))).toEqual(['director', 'default']); // the explicit one is protected, the defaulted one is harmonised to a default-origin value
    expect(origin(run.finalizedProfile!.design!, 'surfaceColor')).toBe('default');
    expect(origin(run.finalizedProfile!.design!, 'contentType')).toBe('profile');
  });

  it('items produced by the deterministic fallback say `fallback` (fallbackVisualDirection, and ensureMotionCoverage when the Director gave none)', () => {
    const direction = fallbackDirection();
    expect(direction.motionGraphics.length).toBeGreaterThan(0);
    for (const item of direction.motionGraphics) {
      expect([origin(item, 'accentColor'), origin(item, 'textColor')]).toEqual(['fallback', 'fallback']);
    }
    for (const item of direction.semanticEmphasis) {
      expect(origin(item, 'accentColor')).toBe('fallback');
    }
    const {raw, fixture} = craftedV1Response();
    const bare = {...(JSON.parse(raw) as Record<string, unknown>), motion_graphics: [], semantic_emphasis: []};
    const parsed = parseVisualDirectorJson(JSON.stringify(bare), fixture.sourceDurationSec, fixture.transcript);
    expect(parsed.motionGraphics.length).toBeGreaterThan(0);
    for (const item of parsed.motionGraphics) {
      expect(origin(item, 'accentColor')).toBe('fallback');
    }
  });
});

describe('fallbackMotionPlan: both emphasis branches and the no-text case', () => {
  const plan = (transcript: string) => fallbackMotionPlan({transcript, durationSec: 40, hookTitle: 'HOOK'});
  it('the huge-number branch and the third-phrase branch both stamp `fallback`', () => {
    const numeric = plan('I made $5 million last year. Real connection matters most. Honest work always wins. Keep showing up daily.');
    expect(numeric.semanticEmphasis.length).toBe(1);
    expect(numeric.semanticEmphasis[0]!.treatment).toBe('count');
    expect(origin(numeric.semanticEmphasis[0]!, 'accentColor')).toBe('fallback');
    const phrase = plan('Real connection matters most. Honest work always wins. Keep showing up daily. Small steps compound over time.');
    expect(phrase.semanticEmphasis.length).toBe(1);
    expect(phrase.semanticEmphasis[0]!.treatment).toBe('type_reveal');
    expect(origin(phrase.semanticEmphasis[0]!, 'accentColor')).toBe('fallback');
    for (const item of [...numeric.motionGraphics, ...phrase.motionGraphics]) {
      expect([origin(item, 'accentColor'), origin(item, 'textColor')]).toEqual(['fallback', 'fallback']);
    }
  });
});

describe('v2 Director path: compiler defaults vs explicit values', () => {
  const run = async (label: string) => runV2(deps, V2_CASES.find(item => item.label === label)!);
  const everyStage = (snapshot: Awaited<ReturnType<typeof runV2>>) => [snapshot.direction, snapshot.planned, snapshot.finalizedNoProfile];

  it('kinetic text and emphasis: explicit vs defaulted, through every stage', async () => {
    const explicit = await run('kinetic explicit');
    for (const stage of everyStage(explicit)) {
      const item = stage.motionGraphics[0]!;
      expect([item.accentColor, item.textColor, origin(item, 'accentColor'), origin(item, 'textColor')]).toEqual(['#000000', '#000000', 'director', 'director']);
    }
    const defaulted = await run('kinetic defaulted');
    for (const stage of everyStage(defaulted)) {
      const item = stage.motionGraphics[0]!;
      expect([item.accentColor, item.textColor, origin(item, 'accentColor'), origin(item, 'textColor')]).toEqual(['#F4E8C1', '#FFFFFF', 'default', 'default']);
    }
    for (const stage of everyStage(await run('emphasis explicit'))) {
      expect([stage.semanticEmphasis[0]!.accentColor, origin(stage.semanticEmphasis[0]!, 'accentColor')]).toEqual(['#000000', 'director']);
    }
    for (const stage of everyStage(await run('emphasis defaulted'))) {
      expect([stage.semanticEmphasis[0]!.accentColor, origin(stage.semanticEmphasis[0]!, 'accentColor')]).toEqual(['#F4E8C1', 'default']);
    }
  });

  it('media container canvas colour', async () => {
    for (const stage of everyStage(await run('container explicit'))) {
      expect([stage.mediaContainers[0]!.canvasColor, origin(stage.mediaContainers[0]!, 'canvasColor')]).toEqual(['#000000', 'director']);
    }
    for (const stage of everyStage(await run('container defaulted'))) {
      expect([stage.mediaContainers[0]!.canvasColor, origin(stage.mediaContainers[0]!, 'canvasColor')]).toEqual(['#111111', 'default']);
    }
  });

  it('frame inset margin: the three Director fields it may come from, the constant, and an unusable value', async () => {
    const expectations: Array<[string, string, string]> = [
      ['frame margin explicit black', '#000000', 'director'],
      // Phase 29 contract: only margin_color is the Director's choice of margin. canvas_color / accent_color are borrowed by the compiler's fallback chain.
      ['frame canvas colour', '#222222', 'default'],
      ['frame accent colour', '#333333', 'default'],
      ['frame defaulted', '#000000', 'default'],
      ['frame invalid colour', '#000000', 'default'],
    ];
    for (const [label, value, expected] of expectations) {
      const snapshot = await run(label);
      for (const stage of everyStage(snapshot)) {
        expect([label, stage.frameInsets[0]!.marginColor, origin(stage.frameInsets[0]!, 'marginColor')]).toEqual([label, value, expected]);
      }
    }
  });

  it('planner remap: a frame inset that reaches it with no colour gets the remap\'s own #000000, labelled `default`; one with a colour keeps `director`', async () => {
    const base = (await run('frame margin explicit black')).direction;
    const plan = async (marginColor: string) => {
      const inset = base.frameInsets[0]!;
      deps.setDirection({...base, frameInsets: [carryProvenance(inset, {...inset, marginColor})], estimatedCostUsd: 0});
      const captionWords = Array.from({length: 80}, (_, i) => ({text: `word${i}`, start: i * 0.5, end: i * 0.5 + 0.45, sentenceIndex: 0}));
      return deps.planBRoll({transcript: 'word0', sourceDurationSec: 40, timeline: buildTimeline([{sourceStart: 0, sourceEnd: 40, outputStart: 0}] as never), words: captionWords as never, captionWords: captionWords as never, requestedEdits: null, directorV2: true} as never);
    };
    const empty = (await plan('')).frameInsets[0]!;
    expect([empty.marginColor, origin(empty, 'marginColor')]).toEqual(['#000000', 'default']);
    const supplied = (await plan('#000000')).frameInsets[0]!;
    expect([supplied.marginColor, origin(supplied, 'marginColor')]).toEqual(['#000000', 'director']);
  });

  it('with a content profile, the rewritten v2 values are `profile`', async () => {
    const snapshot = await run('frame defaulted');
    expect(snapshot.finalizedProfile.frameInsets[0]!.marginColor).toBe('#101010');
    expect(origin(snapshot.finalizedProfile.frameInsets[0]!, 'marginColor')).toBe('profile');
    const explicit = await run('frame margin explicit black');
    expect([explicit.finalizedProfile.frameInsets[0]!.marginColor, origin(explicit.finalizedProfile.frameInsets[0]!, 'marginColor')]).toEqual(['#000000', 'director']);
  });
});

describe('content-profile design provenance', () => {
  it('a classifier-supplied profile yields `profile` tokens; an unsupplied mood yields `default` for the mood-derived tokens only', () => {
    const design = designFromProfile(parseContentProfile(PROFILE_RESPONSE));
    for (const field of ['contentType', 'displayFont', 'primaryColor', 'secondaryColor', 'inkColor', 'surfaceColor', 'motionPreset', 'cornerRadius', 'density']) {
      expect(origin(design, field), field).toBe('profile');
    }
    const defaulted = designFromProfile(parseContentProfile(PROFILE_RESPONSE_BAD_MOOD));
    expect(origin(defaulted, 'surfaceColor')).toBe('default');
    expect(origin(defaulted, 'displayFont')).toBe('default');
    expect(origin(defaulted, 'motionPreset')).toBe('profile');
  });

  it('a profile whose source is `fallback` yields `fallback` tokens (no production path builds one today: parseContentProfile always sets source `gemini`, and a failed classification returns no profile)', () => {
    const parsed = parseContentProfile(PROFILE_RESPONSE);
    expect(parsed.source).toBe('gemini');
    const fallback = {...parsed, source: 'fallback' as const};
    const design = designFromProfile(fallback);
    for (const field of ['contentType', 'displayFont', 'primaryColor', 'surfaceColor', 'density']) {
      expect(origin(design, field), field).toBe('fallback');
    }
  });
});

describe('provenance is invisible to everything that serialises or compares', () => {
  it('stamped edits equal their JSON round trip and expose no extra keys', async () => {
    const run = await runV1(deps, PROFILE_RESPONSE);
    for (const item of [...run.planned.motionGraphics, ...run.planned.frameInsets, ...run.planned.mediaContainers, ...run.planned.semanticEmphasis, ...run.finalizedProfile!.frameInsets]) {
      expect(item).toEqual(JSON.parse(JSON.stringify(item))); // toEqual ignores pre-existing `undefined` keys that JSON drops; strict equality is pinned in the helper test above
      expect(Object.getOwnPropertySymbols(item).filter(symbol => Object.getOwnPropertyDescriptor(item, symbol)!.enumerable)).toEqual([]);
    }
    expect(JSON.stringify(run.finalizedProfile!.design)).not.toMatch(/provenance/i);
  });
});


// ---- every site that rebuilds an edit with a spread, exercised directly (the pipeline scenarios above only reach the always-rebuilt ones) ----

const kinetic = (over: Partial<MotionGraphic> = {}): MotionGraphic =>
  stampProvenance({start: 10, end: 13, text: 'Embrace', role: 'primary', shape: 'pill', accentColor: '#000000', textColor: '#000000', anchor: 'top_left', entrance: 'scale_pop', exit: 'fade', fontScale: 0.82, ...over} as MotionGraphic, {accentColor: 'director', textColor: 'default'});
const emph = (over: Partial<SemanticEmphasis> = {}): SemanticEmphasis =>
  stampProvenance({start: 10, end: 12.4, text: 'True Presence', weight: 'primary', treatment: 'color', accentColor: '#000000', anchor: 'top_left', ...over} as SemanticEmphasis, {accentColor: 'director'});
const box = (over: Partial<MediaContainerMoment> = {}): MediaContainerMoment =>
  stampProvenance({start: 10, end: 15, mode: 'card', canvasColor: '#000000', cornerRadius: 36, scale: 0.6, transitionSec: 1, ...over} as MediaContainerMoment, {canvasColor: 'director'});
const view = (over: Partial<EditPlanView>): EditPlanView => ({durationSec: 47.82, captionDirection: {position: 'bottom', bottomFrac: 0.2}, speaker: {box: {x: 0.18, y: 0.16, w: 0.64, h: 0.62}, source: 'fallback'}, ...over});
const SPEAKER_EVERYWHERE = occupancyFromSpeaker({x: 0, y: 0, w: 1, h: 1}, 'fallback');

describe('rebuild sites carry provenance (the dedicated cases the scenarios above do not reach)', () => {
  it('editConflicts: a relocated or shortened edit keeps its provenance, and the relocation really happened', () => {
    const moved = validateAndApply(view({motionGraphics: [kinetic()], semanticEmphasis: [emph()]}), new EditLedger()).applied;
    expect(moved.semanticEmphasis[0]!.anchor).toBe('top_right');
    expect(provenanceSnapshot(moved.semanticEmphasis[0])).toEqual({accentColor: 'director'});

    const twoKinetic = validateAndApply(view({motionGraphics: [kinetic({text: 'First'}), kinetic({start: 11, end: 14, text: 'Second'})]}), new EditLedger()).applied;
    const second = twoKinetic.motionGraphics.find(item => item.text === 'Second')!;
    expect(second.anchor).not.toBe('top_left');
    expect(provenanceSnapshot(second)).toEqual({accentColor: 'director', textColor: 'default'});

    const shortened = validateAndApply(view({
      generatedGraphics: [{id: 'g', start: 20, end: 22, placement: {mode: 'full_screen'}, module: {url: 'https://example.invalid/m.js', sha256: '0'.repeat(64)}, props: {}}],
      motionGraphics: [kinetic({start: 21, end: 25, text: 'Quiet'})],
    }), new EditLedger()).applied;
    expect(shortened.motionGraphics[0]!.start).toBe(22);
    expect(provenanceSnapshot(shortened.motionGraphics[0])).toEqual({accentColor: 'director', textColor: 'default'});
  });

  const layout = (over: Partial<LayoutPlan>): LayoutPlan => ({hookTitle: '', hookAnchor: 'top_left', hookDurationSec: 0, caption: {position: 'bottom', bottomFrac: 0.2, textColor: '#FFFFFF', highlightColor: '#FFE600', boxColor: null, template: 'clean', animation: 'scale', fontScale: 1} as never, motionGraphics: [], overlays: [], mediaContainers: [], semanticEmphasis: [], ...over});

  it('layoutCritique.applyGeometricPatches: re-anchored graphics, emphasis and pip containers keep provenance', () => {
    const input = layout({
      motionGraphics: [kinetic({anchor: 'center'})],
      semanticEmphasis: [emph({anchor: 'top_right'})],
      mediaContainers: [box({mode: 'pip_corner', pipAnchor: 'bottom_right'})],
      overlays: [{start: 10, end: 15, layout: 'card', overlayText: 'fill', anchor: 'top_right', mediaKind: 'text', accentColor: '#FFFFFF'} as never],
    });
    const out = applyGeometricPatches(SPEAKER_EVERYWHERE, input);
    expect(out.motionGraphics[0]).not.toBe(input.motionGraphics[0]);
    expect(out.motionGraphics[0]!.anchor).not.toBe('center');
    expect(provenanceSnapshot(out.motionGraphics[0])).toEqual({accentColor: 'director', textColor: 'default'});
    expect(out.semanticEmphasis[0]).not.toBe(input.semanticEmphasis[0]);
    expect(provenanceSnapshot(out.semanticEmphasis[0])).toEqual({accentColor: 'director'});
    for (const container of out.mediaContainers) {
      expect(provenanceOf(container, 'canvasColor')).toBe('director');
    }
  });

  it('layoutCritique.applyGeometricPatches: a pip container moved to a safer corner keeps provenance', () => {
    const input = layout({
      mediaContainers: [box({mode: 'pip_corner', pipAnchor: 'bottom_left'})],
      overlays: [{start: 10, end: 15, layout: 'card', overlayText: 'fill', anchor: 'top_right', mediaKind: 'text', accentColor: '#FFFFFF'} as never],
    });
    const out = applyGeometricPatches(occupancyFromSpeaker({x: 0.05, y: 0.1, w: 0.4, h: 0.5}, 'fallback'), input);
    expect(out.mediaContainers.length).toBe(1);
    expect(out.mediaContainers[0]).not.toBe(input.mediaContainers[0]);
    expect(out.mediaContainers[0]!.pipAnchor).toBe('bottom_right'); // it really was moved
    expect(provenanceSnapshot(out.mediaContainers[0])).toEqual({canvasColor: 'director'});
  });

  it('layoutCritique.applyVisionPatches: patched anchors keep provenance', () => {
    const input = layout({motionGraphics: [kinetic()], semanticEmphasis: [emph()]});
    const out = applyVisionPatches(input, {graphic_anchors: [{index: 0, anchor: 'top_right'}], emphasis_anchors: [{index: 0, anchor: 'bottom_left'}]});
    expect([out.motionGraphics[0]!.anchor, out.semanticEmphasis[0]!.anchor]).toEqual(['top_right', 'bottom_left']);
    expect(out.motionGraphics[0]).not.toBe(input.motionGraphics[0]);
    expect(provenanceSnapshot(out.motionGraphics[0])).toEqual({accentColor: 'director', textColor: 'default'});
    expect(provenanceSnapshot(out.semanticEmphasis[0])).toEqual({accentColor: 'director'});
  });

  it('slotCompositor: unsafe anchors, staggered primaries and a pip_corner container are rebuilt with provenance', () => {
    const occupancy = occupancyFromSpeaker({x: 0.05, y: 0.1, w: 0.4, h: 0.5}, 'fallback'); // leaves a legal pip slot (the default speaker box leaves none and the pip is dropped)
    const input = {
      occupancy, hookStyle: 'stack' as never, caption: layout({}).caption,
      motionGraphics: [kinetic({anchor: 'center', start: 10, end: 13}), kinetic({anchor: 'top', start: 10.2, end: 13, text: 'Second'})],
      overlays: [],
      mediaContainers: [box({mode: 'pip_corner', start: 10, end: 14})],
      semanticEmphasis: [emph({anchor: undefined})],
    };
    const out = composeBeautifulLayout(input);
    expect(out.motionGraphics.length).toBe(2);
    out.motionGraphics.forEach((item, index) => {
      expect(item).not.toBe(input.motionGraphics[index]);
      expect(provenanceSnapshot(item), `kinetic ${index}`).toEqual({accentColor: 'director', textColor: 'default'});
    });
    expect(provenanceSnapshot(out.semanticEmphasis[0])).toEqual({accentColor: 'director'});
    expect(out.mediaContainers.length).toBe(1); // the kinetic text overlapping it supplies the canvas fill, so the pip is kept and rebuilt
    expect(out.mediaContainers[0]).not.toBe(input.mediaContainers[0]);
    expect(provenanceSnapshot(out.mediaContainers[0])).toEqual({canvasColor: 'director'});
  });
});
