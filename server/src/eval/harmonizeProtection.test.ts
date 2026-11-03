/**
 * Phase 29, Step 1b: content-profile harmonisation no longer overwrites a colour the Director explicitly wrote.
 *
 * Contract under test (see remotion/out/phase29-audit/REPORT.md):
 *  - protected fields: frame-inset marginColor, media-container canvasColor, kinetic-text accentColor, emphasis accentColor;
 *  - protected only when provenance is `director` AND the value is a usable 6-digit hex;
 *  - `profile`, `default`, `fallback` and UNKNOWN (no provenance) values are harmonised exactly as before;
 *  - text colours stay derived: they are recomputed against the background that is actually drawn.
 * Also pins how North Star stages forward provenance (carry when unchanged, unknown when they change a value).
 */
import {describe, expect, it, vi} from 'vitest';

import {isDirectorColor, provenanceOf, provenanceSnapshot, stampProvenance} from '../lib/provenance.ts';
import type {FrameInset, MediaContainerMoment, MotionGraphic, SemanticEmphasis} from '../types/blueprint.ts';
import {designFromProfile, harmonizeEdits, readableOn, type HarmonizeInput} from '../stages/contentProfile/artDirection.ts';
import {parseContentProfile} from '../stages/contentProfile/contentProfile.ts';
import {applyThesisTokens} from '../stages/northStar/thesisTokens.ts';
import {applyPlateContrast} from '../stages/northStar/plateContrast.ts';
import {enforceCompositionLaws} from '../stages/northStar/compositionLaws.ts';
import {promoteMotionDesign} from '../stages/northStar/designSystem.ts';
import {occupancyFromSpeaker} from '../stages/layout/occupancy.ts';
import type {VisualDirection} from '../stages/broll/geminiDirector.ts';
import {PROFILE_RESPONSE, runV1, runV2, V2_CASES, type Deps} from './phase28Scenarios.ts';

const hoisted = vi.hoisted(() => ({direction: null as unknown}));
vi.mock('../stages/broll/geminiDirector.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../stages/broll/geminiDirector.ts')>();
  return {...actual, directorConfigured: () => true, planVisualDirection: async () => hoisted.direction as VisualDirection};
});
vi.mock('../stages/directorV2/geminiClient.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../stages/directorV2/geminiClient.ts')>();
  return {
    ...actual,
    frameParts: async () => [],
    callDirectorModel: async () => ({json: {graphic_anchors: [{index: 0, anchor: 'top_left'}], drop_overlay_indexes: [], drop_graphic_indexes: [], drop_emphasis_indexes: [], overlay_anchors: [], notes: 'x'}, estimatedCostUsd: 0, model: 'stub', latencyMs: 0}),
  };
});
let nextId = 1;
vi.mock('../stages/broll/stockSearch.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../stages/broll/stockSearch.ts')>();
  const asset = () => ({assetUrl: `https://stock.invalid/${nextId}.mp4`, provider: 'pexels' as const, providerId: nextId++, width: 1080, height: 1920, durationSec: 12, credit: 'x', creditUrl: ''});
  return {...actual, stockConfigured: () => true, findBRollAsset: async () => asset(), findPhotoAsset: async () => asset(), listBRollAssets: async () => [asset(), asset(), asset()]};
});
const {planBRoll} = await import('../stages/broll/brollPlanner.ts');
const {critiqueNorthStarProxy} = await import('../stages/northStar/proxyCritic.ts');
const deps: Deps = {planBRoll: planBRoll as never, setDirection: direction => { hoisted.direction = direction; }};

const design = designFromProfile(parseContentProfile(PROFILE_RESPONSE));
const caption = {position: 'bottom', bottomFrac: 0.2, textColor: '#FFFFFF', highlightColor: '#FFE600', boxColor: null, template: 'clean', animation: 'scale', fontScale: 1} as never;
const base = (over: Partial<HarmonizeInput> = {}): HarmonizeInput => ({design, footageLuminance: 0.3, motionGraphics: [], semanticEmphasis: [], frameInsets: [], mediaContainers: [], caption, captionLocked: false, ...over});

const inset = (marginColor: string, origin?: 'director' | 'profile' | 'default' | 'fallback'): FrameInset => {
  const item: FrameInset = {start: 5, end: 9, scale: 0.8, marginColor};
  return origin ? stampProvenance(item, {marginColor: origin}) : item;
};
const kinetic = (accentColor: string, origin?: 'director' | 'profile' | 'default' | 'fallback', over: Partial<MotionGraphic> = {}): MotionGraphic => {
  const item: MotionGraphic = {start: 10, end: 13, text: 'Hello', role: 'primary', shape: 'pill', accentColor, textColor: '#FFFFFF', anchor: 'top_left', entrance: 'scale_pop', exit: 'fade', fontScale: 1, ...over};
  return origin ? stampProvenance(item, {accentColor: origin}) : item;
};
const emph = (accentColor: string, origin?: 'director' | 'profile' | 'default' | 'fallback'): SemanticEmphasis => {
  const item: SemanticEmphasis = {start: 10, end: 12.5, text: 'Hi', weight: 'primary', treatment: 'scale', accentColor, anchor: 'top_right'};
  return origin ? stampProvenance(item, {accentColor: origin}) : item;
};
const container = (canvasColor: string, origin?: 'director' | 'profile' | 'default' | 'fallback', extra: Partial<MediaContainerMoment> = {}): MediaContainerMoment => {
  const item: MediaContainerMoment = {start: 12, end: 16, mode: 'card', canvasColor, cornerRadius: 18, scale: 0.8, transitionSec: 0.9, canvasTitle: 'Pause', canvasTitleColor: '#123456', ...extra};
  return origin ? stampProvenance(item, {canvasColor: origin}) : item;
};

describe('isDirectorColor', () => {
  it('requires director provenance AND a usable 6-digit hex; unknown is never true', () => {
    expect(isDirectorColor(stampProvenance({c: '#FF00AA'}, {c: 'director'}), 'c')).toBe(true);
    expect(isDirectorColor(stampProvenance({c: '#abc'}, {c: 'director'}), 'c')).toBe(false); // 3-digit: the luminance maths gives NaN
    expect(isDirectorColor(stampProvenance({c: 'red'}, {c: 'director'}), 'c')).toBe(false);
    expect(isDirectorColor(stampProvenance({c: '  '}, {c: 'director'}), 'c')).toBe(false);
    for (const origin of ['profile', 'default', 'fallback'] as const) {
      expect(isDirectorColor(stampProvenance({c: '#FF00AA'}, {c: origin}), 'c')).toBe(false);
    }
    expect(isDirectorColor({c: '#FF00AA'}, 'c')).toBe(false);
    expect(isDirectorColor(undefined, 'c')).toBe(false);
  });
});

describe('harmonizeEdits: Director-origin values are protected, everything else behaves as before', () => {
  it('frame-inset margin', () => {
    const out = harmonizeEdits(base({frameInsets: [inset('#FF00AA', 'director'), inset('#FF00AA', 'profile'), inset('#FF00AA', 'default'), inset('#FF00AA', 'fallback'), inset('#FF00AA'), inset('#abc', 'director'), inset('red', 'director')]})).frameInsets;
    expect(out.map(item => item.marginColor)).toEqual(['#FF00AA', design.surfaceColor, design.surfaceColor, design.surfaceColor, design.surfaceColor, design.surfaceColor, design.surfaceColor]);
    expect(provenanceOf(out[0], 'marginColor')).toBe('director'); // the protected edit is returned as is
  });

  it('media-container canvas, and a title colour that must read on the canvas actually drawn', () => {
    const unreadable = stampProvenance(container('#000000', 'director', {canvasTitleColor: '#000000'}), {canvasColor: 'director', canvasTitleColor: 'director'});
    const [keptBoth, keptCanvasOnly, notKept, unknown, titleDirectorCanvasDefault, blackOnBlack] = harmonizeEdits(
      base({
        mediaContainers: [
          stampProvenance(container('#FFFFFF', 'director'), {canvasColor: 'director', canvasTitleColor: 'director'}),
          container('#FFFFFF', 'director'), // title not the Director's: recomputed against the kept canvas
          container('#FFFFFF', 'default'),
          container('#FFFFFF'),
          stampProvenance(container('#FFFFFF', 'default'), {canvasColor: 'default', canvasTitleColor: 'director'}), // canvas will change, so the title cannot be kept
          unreadable,
        ],
      }),
    ).mediaContainers;
    expect([keptBoth!.canvasColor, keptBoth!.canvasTitleColor]).toEqual(['#FFFFFF', '#123456']);
    expect([keptCanvasOnly!.canvasColor, keptCanvasOnly!.canvasTitleColor]).toEqual(['#FFFFFF', readableOn('#FFFFFF', design.inkColor)]);
    // a Director title that does not read on the Director canvas is not kept: the canvas stays, the title is re-derived
    expect([blackOnBlack!.canvasColor, blackOnBlack!.canvasTitleColor]).toEqual(['#000000', readableOn('#000000', design.inkColor)]);
    expect(blackOnBlack!.canvasTitleColor).not.toBe('#000000');
    for (const item of [notKept!, unknown!, titleDirectorCanvasDefault!]) {
      expect([item.canvasColor, item.canvasTitleColor]).toEqual([design.surfaceColor, readableOn(design.surfaceColor, design.inkColor)]); // the previous behaviour
    }
  });

  it('kinetic-text accent; its text colour is derived against the accent that is actually used', () => {
    const [kept, profileOrigin, unknown] = harmonizeEdits(base({motionGraphics: [kinetic('#FFFF00', 'director'), kinetic('#FFFF00', 'profile'), kinetic('#FFFF00')]})).motionGraphics;
    expect(kept!.accentColor).toBe('#FFFF00');
    expect(kept!.textColor).toBe(readableOn('#FFFF00', '#FFFFFF', design.inkColor));
    expect(profileOrigin!.accentColor).toBe(design.primaryColor);
    expect(unknown!.accentColor).toBe(design.primaryColor);
    const secondary = harmonizeEdits(base({motionGraphics: [kinetic('#FFFF00', 'default', {role: 'secondary'})]})).motionGraphics[0]!;
    expect(secondary.accentColor).toBe(design.secondaryColor);
  });

  it('emphasis accent', () => {
    const [kept, defaulted, unknown] = harmonizeEdits(base({semanticEmphasis: [emph('#FFFF00', 'director'), emph('#FFFF00', 'default'), emph('#FFFF00')]})).semanticEmphasis;
    expect([kept!.accentColor, defaulted!.accentColor, unknown!.accentColor]).toEqual(['#FFFF00', design.primaryColor, design.primaryColor]);
  });

  it('the `changed` counters count what was actually rewritten', () => {
    const out = harmonizeEdits(base({frameInsets: [inset('#FF00AA', 'director'), inset('#FF00AA', 'default')], motionGraphics: [kinetic('#FFFF00', 'director'), kinetic('#FFFF00')]}));
    expect(out.changed.frameInsets).toBe(1);
    // the protected graphic keeps its accent but its WHITE text no longer reads on the yellow accent, so it is re-derived: both count
    expect(out.motionGraphics[0]!.accentColor).toBe('#FFFF00');
    expect(out.motionGraphics[0]!.textColor).not.toBe('#FFFFFF');
    expect(out.changed.motionGraphics).toBe(2);
  });

  it('with no provenance at all (unknown), the result equals the pre-1b result for every field', () => {
    const plain = base({
      frameInsets: [inset('#FF00AA')], mediaContainers: [container('#FFFFFF')], motionGraphics: [kinetic('#FFFF00')], semanticEmphasis: [emph('#FFFF00')],
    });
    const out = harmonizeEdits(plain);
    expect(out.frameInsets[0]!.marginColor).toBe(design.surfaceColor);
    expect(out.mediaContainers[0]).toMatchObject({canvasColor: design.surfaceColor, canvasTitleColor: readableOn(design.surfaceColor, design.inkColor)});
    expect(out.motionGraphics[0]!.accentColor).toBe(design.primaryColor);
    expect(out.semanticEmphasis[0]!.accentColor).toBe(design.primaryColor);
  });

  it('a spread copy has lost its provenance and is therefore treated as unknown (overwritten), never as director', () => {
    const stamped = inset('#FF00AA', 'director');
    expect(harmonizeEdits(base({frameInsets: [{...stamped}]})).frameInsets[0]!.marginColor).toBe(design.surfaceColor);
  });
});

describe('through the real stages (parse/compile -> planner -> layout -> finalizeEdits with a content profile)', () => {
  it('v1: explicit Director colours survive, defaulted and invalid ones are harmonised', async () => {
    const run = await runV1(deps, PROFILE_RESPONSE);
    const out = run.finalizedProfile!;
    expect(out.frameInsets.map(item => [item.marginColor, provenanceOf(item, 'marginColor')])).toEqual([['#000000', 'director'], [design.surfaceColor, 'profile']]);
    expect(out.mediaContainers.map(item => [item.canvasColor, provenanceOf(item, 'canvasColor')])).toEqual([['#000000', 'director'], [design.surfaceColor, 'profile']]);
    const byText = (text: string) => out.motionGraphics.find(item => item.text === text)!;
    expect([byText('EXPLICIT BLACK').accentColor, provenanceOf(byText('EXPLICIT BLACK'), 'accentColor')]).toEqual(['#000000', 'director']);
    for (const text of ['NO COLOURS', 'INVALID COLOURS']) {
      expect(byText(text).accentColor).not.toBe('#000000');
      expect(provenanceOf(byText(text), 'accentColor')).toBe('profile');
    }
    const emphasis = (text: string) => out.semanticEmphasis.find(item => item.text === text)!;
    expect([emphasis('explicit').accentColor, provenanceOf(emphasis('explicit'), 'accentColor')]).toEqual(['#000000', 'director']);
    expect([emphasis('defaulted').accentColor, provenanceOf(emphasis('defaulted'), 'accentColor')]).toEqual([design.secondaryColor === emphasis('defaulted').accentColor ? design.secondaryColor : design.primaryColor, 'profile']);
    // the version without a profile is untouched by any of this
    expect(run.finalizedNoProfile.frameInsets.map(item => item.marginColor)).toEqual(['#000000', '#000000']);
  });

  it('v2: explicit margin_color / canvas_color / accent_color survive; borrowed colours and defaults are harmonised', async () => {
    const expectations: Array<[string, (out: Awaited<ReturnType<typeof runV2>>['finalizedProfile']) => unknown, unknown]> = [
      ['frame margin explicit black', out => out.frameInsets[0]!.marginColor, '#000000'],
      ['frame canvas colour', out => out.frameInsets[0]!.marginColor, design.surfaceColor], // borrowed canvas_color is not an explicit margin
      ['frame accent colour', out => out.frameInsets[0]!.marginColor, design.surfaceColor],
      ['frame defaulted', out => out.frameInsets[0]!.marginColor, design.surfaceColor],
      ['frame invalid colour', out => out.frameInsets[0]!.marginColor, design.surfaceColor],
      ['container explicit', out => out.mediaContainers[0]!.canvasColor, '#000000'],
      ['container defaulted', out => out.mediaContainers[0]!.canvasColor, design.surfaceColor],
      ['kinetic explicit', out => out.motionGraphics[0]!.accentColor, '#000000'],
      ['kinetic defaulted', out => out.motionGraphics[0]!.accentColor, design.primaryColor],
      ['emphasis explicit', out => out.semanticEmphasis[0]!.accentColor, '#000000'],
      ['emphasis defaulted', out => out.semanticEmphasis[0]!.accentColor, design.primaryColor],
    ];
    for (const [label, pick, expected] of expectations) {
      const snapshot = await runV2(deps, V2_CASES.find(item => item.label === label)!);
      expect([label, pick(snapshot.finalizedProfile)]).toEqual([label, expected]);
    }
  });
});

describe('North Star stages forward provenance: carried when a value is unchanged, unknown when the stage changed it', () => {
  const stampedKinetic = (accentColor: string, textColor = '#FFFFFF') => stampProvenance(kinetic(accentColor, 'director', {textColor}), {accentColor: 'director', textColor: 'director'});
  const stampedEmphasis = (accentColor: string, treatment: SemanticEmphasis['treatment'] = 'scale') => stampProvenance({...emph(accentColor, 'director'), treatment}, {accentColor: 'director'});
  const tokens = {primary: '#0F766E', secondary: '#1D4ED8', ink: '#111827', paper: '#F7F4EE'};

  it('applyThesisTokens: a non-default colour is carried; a colour equal to a default accent is replaced, so its origin becomes unknown', () => {
    const out = applyThesisTokens({tokens, caption, overlays: [], motionGraphics: [stampedKinetic('#123456'), stampedKinetic('#FACC15')], semanticEmphasis: [stampedEmphasis('#123456'), stampedEmphasis('#FACC15')]});
    expect(provenanceSnapshot(out.motionGraphics[0])).toEqual({accentColor: 'director', textColor: 'director'});
    expect(out.motionGraphics[1]!.accentColor).toBe(tokens.primary);
    expect(provenanceOf(out.motionGraphics[1], 'accentColor')).toBeUndefined();
    expect(provenanceOf(out.motionGraphics[1], 'textColor')).toBe('director');
    expect(provenanceSnapshot(out.semanticEmphasis[0])).toEqual({accentColor: 'director'});
    expect(provenanceOf(out.semanticEmphasis[1], 'accentColor')).toBeUndefined();
  });

  it('applyPlateContrast: any field whose value changed has no provenance; any unchanged field keeps it', () => {
    const palette = {r: 0.95, g: 0.95, b: 0.95, luminance: 0.95} as never;
    const input = {caption, overlays: [], speakerPalette: palette, plateByUrl: new Map(), motionGraphics: [stampedKinetic('#FFFFFF', '#FFFFFF'), stampedKinetic('#111111', '#111111')], semanticEmphasis: [stampedEmphasis('#FFFFFF'), stampedEmphasis('#111111'), stampedEmphasis('#FFFFFF', 'color'), stampedEmphasis('#111111', 'color')]};
    const out = applyPlateContrast(input);
    expect([out.semanticEmphasis[2]!.treatment, out.semanticEmphasis[3]!.treatment]).toEqual(['underline', 'underline']); // the bright-plate branch that rebuilds the item with a new treatment
    expect(out.semanticEmphasis[3]!.accentColor).toBe('#111111'); // unchanged there, so its provenance must be carried
    let changed = 0;
    let kept = 0;
    const check = (before: object[], after: object[]) => after.forEach((item, index) => {
      for (const field of ['accentColor', 'textColor']) {
        const same = (before[index] as Record<string, unknown>)[field] === (item as Record<string, unknown>)[field];
        const had = provenanceOf(before[index], field);
        if (had === undefined) continue;
        if (same) { kept += 1; expect(provenanceOf(item, field), field).toBe(had); } else { changed += 1; expect(provenanceOf(item, field), field).toBeUndefined(); }
      }
    });
    check(input.motionGraphics, out.motionGraphics);
    check(input.semanticEmphasis, out.semanticEmphasis);
    expect(changed).toBeGreaterThan(0);
    expect(kept).toBeGreaterThan(0);
  });

  it('enforceCompositionLaws and promoteMotionDesign only forward the objects they were given', () => {
    const graphics = [stampedKinetic('#123456')];
    const emphasis = [stampedEmphasis('#123456')];
    const laws = enforceCompositionLaws({hookTitle: '', hookAnchor: 'top_left', hookDurationSec: 0, occupancySlices: [], fallbackOccupancy: occupancyFromSpeaker({x: 0.18, y: 0.16, w: 0.64, h: 0.62}, 'fallback'), overlays: [], motionGraphics: graphics, semanticEmphasis: emphasis});
    expect(laws.motionGraphics[0]).toBe(graphics[0]);
    expect(laws.semanticEmphasis[0]).toBe(emphasis[0]);
    const promoted = promoteMotionDesign({design, existing: graphics, emphasis});
    expect(promoted.motionGraphics[0]).toBe(graphics[0]);
    expect(promoted.semanticEmphasis[0]).toBe(emphasis[0]);
  });

  it('the proxy critic: an anchor patch rebuilds the graphic and keeps its colour provenance', async () => {
    const graphic = stampedKinetic('#123456');
    const out = await critiqueNorthStarProxy({pack: {storyboard: [{path: 'a.jpg'}]} as never, overlays: [], motionGraphics: [graphic], semanticEmphasis: []});
    expect(out.motionGraphics[0]).not.toBe(graphic);
    expect(out.motionGraphics[0]!.anchor).toBe('top_left');
    expect(provenanceSnapshot(out.motionGraphics[0])).toEqual({accentColor: 'director', textColor: 'director'});
  });
});
