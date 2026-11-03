/**
 * WP42: Skill B (Explainer) MOUNTED in the production ShortVideo + blueprint (offline; no render, no network, no model).
 *   1. blueprint: `explainerLayoutTrack` + `explainerClaimBeats` (server type + remotion zod schema, dual-kept); the layout media tag `intent`
 *   2. mount plan (pure): hard-cut tiling, normalised claim beats with the plate's spoken line, media slots for B / C / D only
 *   3. media placement (injected resolver): one noun-locked still per slot as a tagged `cutaway` overlay; a miss = a text plate, never a gap / crash
 *   4. analyzeVideo wiring: the track is written ONLY behind the explainer skill, no soft transitions, Skill A / faceless gates untouched, mutual exclusion intact, flag default OFF
 *   5. ShortVideo mount: ExplainerLayoutFrame + LimeHighlightWipe, a hard cut (no crossfade / Sequence), classic path unchanged without a track
 *   6. renderer helpers (pure) + the offline proof
 */
import {existsSync, readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {explainerClaimBeatSchema, explainerLayoutSpanSchema, timelineBlueprintSchema, visualOverlaySchema} from '../../../../remotion/src/blueprintSchema.ts';
import {
  EXPLAINER_PICTURE_OWNING_OVERLAYS,
  activeExplainerSpanAt,
  claimBeatForSpan,
  explainerHardCutProblems,
  explainerMediaForSpan,
  explainerMediaIntent,
  isExplainerMedia,
  plateFontPx,
  splitPlateContext,
} from '../../../../remotion/src/lib/explainerMount.ts';
import {env} from '../../config/env.ts';
import {polishExplainerCaptions} from '../../lib/polishExplainerCaptions.ts';
import {planClaimVisuals} from './explainerClaims.ts';
import {
  BEAT_CONTEXT_WORDS_AFTER,
  BEAT_CONTEXT_WORDS_BEFORE,
  EXPLAINER_MEDIA_MAX_LOOKUPS,
  beatContext,
  hardCutTrack,
  placeExplainerMedia,
  planExplainerMount,
  type ExplainerPhotoResolver,
} from './explainerMount.ts';
import {planExplainerPacing, resolvePolishSkill, type ExplainerWord} from './explainerPacing.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const FPS = 30;

const fixture = JSON.parse(read('./fixtures/wp41-vo-words.json')) as {durationSec: number; words: ExplainerWord[]};
const pacing = planExplainerPacing({durationSec: fixture.durationSec, words: fixture.words});
const claimPlan = planClaimVisuals({segments: pacing.segments, words: fixture.words});
const mount = planExplainerMount({claimPlan, words: fixture.words, durationSec: fixture.durationSec});
const fakeResolver = (log: string[] = []): ExplainerPhotoResolver => {
  let next = 100;
  return async (query, options) => {
    log.push(`${query}|${options.orientation}`);
    next += 1;
    return {assetUrl: `https://images.example/photo-${next}.jpg`, provider: 'pexels', providerId: next, width: 1600, height: 1000, credit: 'x', creditUrl: 'https://x'};
  };
};

describe('WP42 1) blueprint fields (server type + remotion schema)', () => {
  it('the schema parses the track + beats and keeps them; absent stays absent (optional, no default)', () => {
    const base = {...(JSON.parse(read('../../../../remotion/props/sample.json')) as {blueprint: Record<string, unknown>}).blueprint};
    const withTrack = timelineBlueprintSchema.parse({...base, explainerLayoutTrack: mount.layoutTrack, explainerClaimBeats: mount.claimBeats});
    expect(withTrack.explainerLayoutTrack).toEqual(mount.layoutTrack);
    expect(withTrack.explainerClaimBeats).toEqual(mount.claimBeats);
    const without = timelineBlueprintSchema.parse(base);
    expect(without.explainerLayoutTrack).toBeUndefined();
    expect(without.explainerClaimBeats).toBeUndefined();
    expect(timelineBlueprintSchema.shape.explainerLayoutTrack.safeParse(undefined).success).toBe(true);
  });

  it('rejects an unknown layout, a negative time and a beat without a phrase', () => {
    expect(explainerLayoutSpanSchema.safeParse({start: 0, end: 3, layout: 'explainer_e'}).success).toBe(false);
    expect(explainerLayoutSpanSchema.safeParse({start: -1, end: 3, layout: 'explainer_a'}).success).toBe(false);
    expect(explainerClaimBeatSchema.safeParse({start: 1, end: 3, phraseStart: 1.2, phraseEnd: 1.6}).success).toBe(false);
    expect(explainerClaimBeatSchema.safeParse({start: 1, end: 3, phrase: '$5', phraseStart: 1.2, phraseEnd: 1.6}).success).toBe(true);
  });

  it('the server TimelineBlueprint type carries the same two fields (dual-kept)', () => {
    const types = read('../../types/blueprint.ts');
    expect(types).toContain("explainerLayoutTrack?: Array<{start: number; end: number; layout: 'explainer_a' | 'explainer_b' | 'explainer_c' | 'explainer_d'}>;");
    expect(types).toContain('explainerClaimBeats?: Array<{start: number; end: number; phrase: string; phraseStart: number; phraseEnd: number; kind?: string; context?: string}>;');
  });

  it('the layout media tag (`intent`) survives the overlay schema (it is the only way ShortVideo can tell layout media from a free overlay)', () => {
    const overlay = visualOverlaySchema.parse({start: 1, end: 3, layout: 'cutaway', mediaKind: 'image', keyword: 'k', overlayText: 'K', assetUrl: 'https://x/y.jpg', provider: 'pexels', providerId: 1, width: 1, height: 1, credit: '', creditUrl: '', intent: 'explainer_d'});
    expect(overlay.intent).toBe('explainer_d');
    expect(isExplainerMedia(overlay)).toBe(true);
    expect(visualOverlaySchema.parse({...overlay, intent: undefined}).intent).toBeUndefined();
  });
});

describe('WP42 2) planExplainerMount (pure)', () => {
  it('the layout track is the WP41 layout track as a clean HARD-CUT tiling: [0, duration], end === next.start exactly, no gap > 1 frame at 30 fps', () => {
    const track = mount.layoutTrack;
    expect(track[0]!.start).toBe(0);
    expect(track.at(-1)!.end).toBeCloseTo(fixture.durationSec, 2);
    track.forEach((span, index) => {
      expect(span.end).toBeGreaterThan(span.start);
      if (index > 0) expect(span.start).toBe(track[index - 1]!.end);
    });
    expect(explainerHardCutProblems(track, FPS)).toEqual([]);
    expect(track.map(span => span.layout)).toEqual(claimPlan.layoutTrack.map(span => span.layout));
    expect(new Set(track.map(span => span.layout))).toEqual(new Set(['explainer_a', 'explainer_b', 'explainer_c', 'explainer_d']));
  });

  it('hardCutTrack repairs gaps / overlaps / drift and drops empty spans (never a soft overlap)', () => {
    const messy = [
      {start: 0.5, end: 3, layout: 'explainer_b' as const},
      {start: 2.9, end: 6, layout: 'explainer_a' as const},
      {start: 6.4, end: 6.4, layout: 'explainer_c' as const},
      {start: 7, end: 10, layout: 'explainer_d' as const},
    ];
    const fixed = hardCutTrack(messy, 12);
    expect(fixed).toEqual([
      {start: 0, end: 3, layout: 'explainer_b'},
      {start: 3, end: 6, layout: 'explainer_a'},
      {start: 6, end: 12, layout: 'explainer_d'},
    ]);
    expect(explainerHardCutProblems(fixed, FPS)).toEqual([]);
    expect(explainerHardCutProblems([{start: 0, end: 2, layout: 'explainer_a'}, {start: 2.2, end: 4, layout: 'explainer_b'}], FPS)).toEqual(['gap:1:6f']);
    expect(explainerHardCutProblems([{start: 0, end: 2, layout: 'explainer_a'}, {start: 1.5, end: 4, layout: 'explainer_b'}], FPS)).toEqual(['overlap:1']);
    expect(hardCutTrack([], 10)).toEqual([]);
  });

  it('claim beats are the WP41 beats, normalised: phrase + speech times + the spoken line around the phrase', () => {
    expect(mount.claimBeats).toHaveLength(claimPlan.beats.length);
    expect(mount.claimBeats.length).toBeGreaterThanOrEqual(1);
    const beat = mount.claimBeats[0]!;
    const source = claimPlan.beats[0]!;
    expect(beat).toMatchObject({start: source.start, end: source.end, phrase: '$1.4 trillion', kind: 'article_highlight'});
    expect(beat.phraseStart).toBeGreaterThanOrEqual(beat.start);
    expect(beat.context.toLowerCase()).toContain('$1.4');
    expect(beat.context.split(' ').length).toBeLessThanOrEqual(BEAT_CONTEXT_WORDS_BEFORE + BEAT_CONTEXT_WORDS_AFTER + 3);
    // the beat IS a layout-B span of the track (the renderer finds it by those bounds)
    expect(mount.layoutTrack.some(span => span.layout === 'explainer_b' && claimBeatForSpan(mount.claimBeats, span) === beat)).toBe(true);
    expect(() => timelineBlueprintSchema.shape.explainerClaimBeats.parse(mount.claimBeats)).not.toThrow();
  });

  it('beatContext windows the words around the phrase and survives a phrase it cannot find', () => {
    const words: ExplainerWord[] = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen'.split(' ').map((text, index) => ({text, start: index * 0.3, end: index * 0.3 + 0.25}));
    const middle = beatContext(words, {start: 0, end: 5}, {start: 2.4, end: 2.65});
    expect(middle).toContain('nine');
    expect(middle.split(' ').length).toBeLessThanOrEqual(BEAT_CONTEXT_WORDS_BEFORE + BEAT_CONTEXT_WORDS_AFTER + 1);
    expect(beatContext(words, {start: 0, end: 5}, {start: 99, end: 100}).length).toBeGreaterThan(0);
    expect(beatContext([], {start: 0, end: 5}, {start: 1, end: 2})).toBe('');
  });

  it('media slots: B (not the claim beat) / C / D only, in order, inside the track; A and the beat plate need none', () => {
    const layouts = mount.slots.map(slot => slot.layout);
    expect(layouts.every(layout => layout === 'explainer_b' || layout === 'explainer_c' || layout === 'explainer_d')).toBe(true);
    expect(layouts).toContain('explainer_c');
    expect(layouts).toContain('explainer_d');
    const beatSpan = mount.layoutTrack.find(span => claimBeatForSpan(mount.claimBeats, span));
    expect(mount.slots.some(slot => beatSpan && slot.start === beatSpan.start)).toBe(false);
    expect(mount.slots.length).toBe(mount.layoutTrack.filter(span => span.layout !== 'explainer_a').length - mount.claimBeats.length);
    for (const slot of mount.slots) {
      expect(mount.layoutTrack.some(span => span.start === slot.start && span.end === slot.end && span.layout === slot.layout)).toBe(true);
      expect(slot.label.length).toBeGreaterThan(0);
    }
    expect(mount.slots.map(slot => slot.start)).toEqual([...mount.slots.map(slot => slot.start)].sort((a, b) => a - b));
  });

  it('warnings: polish_explainer_mounted:layouts:<n> and :beats:<n>', () => {
    expect(mount.warnings).toEqual([`polish_explainer_mounted:layouts:${mount.layoutTrack.length}`, `polish_explainer_mounted:beats:${mount.claimBeats.length}`]);
  });

  it('is deterministic and pure (no env, I/O, model, randomness); the renderer helper lib has no imports', () => {
    expect(planExplainerMount({claimPlan, words: fixture.words, durationSec: fixture.durationSec})).toEqual(mount);
    const code = stripComments(read('./explainerMount.ts'));
    expect(code).not.toMatch(/process\.env|import .*config\/env|from 'node:|fetch\(|Math\.random|Date\.now|logger/);
    expect(stripComments(read('../../../../remotion/src/lib/explainerMount.ts'))).not.toMatch(/^import /m);
  });

  it('writes no TransitionClip (the layout edges are hard cuts)', () => {
    expect(stripComments(read('./explainerMount.ts'))).not.toMatch(/TransitionClip|transitions\s*[:=]|whip|crossfade|dissolve/i);
  });
});

describe('WP42 3) placeExplainerMedia (injected resolver)', () => {
  it('one noun-locked still per slot as a tagged cutaway overlay: unique photos, https only, orientation by layout', async () => {
    const log: string[] = [];
    const result = await placeExplainerMedia({slots: mount.slots, resolver: fakeResolver(log)});
    expect(result.overlays).toHaveLength(mount.slots.length);
    expect(result.placed).toBe(mount.slots.length);
    expect(result.text).toBe(0);
    result.overlays.forEach((overlay, index) => {
      const slot = mount.slots[index]!;
      expect(overlay).toMatchObject({layout: 'cutaway', mediaKind: 'image', intent: slot.layout, start: slot.start, end: slot.end, overlayText: slot.label});
      expect(overlay.assetUrl).toMatch(/^https:\/\//);
      expect(isExplainerMedia(overlay)).toBe(true);
    });
    expect(new Set(result.overlays.map(overlay => overlay.providerId)).size).toBe(result.overlays.length);
    expect(log.some(line => line.endsWith('|portrait'))).toBe(true); // D is full-bleed portrait
    expect(log.some(line => line.endsWith('|landscape'))).toBe(true);
    expect(result.warnings).toEqual([`polish_explainer_mounted:media:${mount.slots.length}:${mount.slots.length}`]);
    for (const overlay of result.overlays) expect(() => visualOverlaySchema.parse(overlay)).not.toThrow();
  });

  it('no stock configured / no photo / a throwing resolver -> a TEXT plate of the slot label (never a gap, never a crash)', async () => {
    const none = await placeExplainerMedia({slots: mount.slots, resolver: null});
    expect(none.overlays.every(overlay => overlay.mediaKind === 'text' && overlay.assetUrl === '' && overlay.intent !== undefined)).toBe(true);
    expect(none.text).toBe(mount.slots.length);
    expect(none.warnings).toEqual([`polish_explainer_mounted:media:0:${mount.slots.length}`, `polish_explainer_mounted:media_text_plate:${mount.slots.length}`, 'polish_explainer_mounted:no_stock']);
    const boom = await placeExplainerMedia({slots: mount.slots, resolver: async () => { throw new Error('provider down'); }});
    expect(boom.overlays).toHaveLength(mount.slots.length);
    expect(boom.overlays.every(overlay => overlay.mediaKind === 'text')).toBe(true);
    const empty = await placeExplainerMedia({slots: mount.slots, resolver: async () => null});
    expect(empty.placed).toBe(0);
    const nonHttps = await placeExplainerMedia({slots: mount.slots.slice(0, 1), resolver: async () => ({assetUrl: 'http://insecure/x.jpg', provider: 'pexels', providerId: 9})});
    expect(nonHttps.overlays[0]!.mediaKind).toBe('text');
  });

  it('the lookup cap holds', async () => {
    let calls = 0;
    const result = await placeExplainerMedia({slots: mount.slots, maxLookups: 2, resolver: async () => { calls += 1; return null; }});
    expect(calls).toBeLessThanOrEqual(2);
    expect(result.lookups).toBeLessThanOrEqual(2);
    expect(EXPLAINER_MEDIA_MAX_LOOKUPS).toBeGreaterThanOrEqual(mount.slots.length);
  });
});

describe('WP42 4) analyzeVideo wiring (behind the explainer skill only)', () => {
  const analyze = stripComments(read('../../pipeline/analyzeVideo.ts'));
  const explainerBlock = analyze.slice(analyze.indexOf("if (polishSkill.skill === 'explainer') {"), analyze.indexOf('if (facelessDoc && voGrammar && motion)'));

  it('the mount runs INSIDE the explainer block, after the captions, and is the only place explainerMount is assigned', () => {
    expect(explainerBlock).toContain('planExplainerMount({claimPlan, words: captionWords, durationSec: timeline.outputDurationSec})');
    expect(explainerBlock).toContain('explainerMount = mount;');
    expect(explainerBlock).toContain('await placeExplainerMedia({');
    expect(explainerBlock.indexOf('polishExplainerCaptions(')).toBeLessThan(explainerBlock.indexOf('planExplainerMount('));
    expect(analyze.match(/explainerMount = mount;/g)).toHaveLength(1);
    expect(analyze.match(/planExplainerMount\(/g)).toHaveLength(1);
    expect(analyze.match(/placeExplainerMedia\(/g)).toHaveLength(1);
    expect(analyze).toContain('let explainerMount: ExplainerMountPlan | null = null;');
    expect(analyze.indexOf('let explainerMount')).toBeLessThan(analyze.indexOf("if (polishSkill.skill === 'explainer') {"));
  });

  it('the blueprint carries the two fields only when the mount ran; flag OFF writes nothing (the gate is the skill resolution)', () => {
    expect(analyze).toContain('...(explainerMount ? {explainerLayoutTrack: explainerMount.layoutTrack, explainerClaimBeats: explainerMount.claimBeats} : {}),');
    expect(analyze).toContain('resolvePolishSkill({');
    expect(analyze).toContain('newsroom: Boolean(polishPath && env.POLISH_NEWSROOM_MG)');
    expect(resolvePolishSkill({faceless: false, explainer: false}).skill).toBe('default'); // flag off -> the explainer block never runs -> explainerMount stays null
    expect(env.POLISH_EXPLAINER_SKILL).toBe(false);
  });

  it('a clip with no B / C / D span keeps the classic picture (nothing mounted, reported)', () => {
    expect(explainerBlock).toContain("mount.layoutTrack.some(span => span.layout !== 'explainer_a')");
    expect(explainerBlock).toContain("'polish_explainer_mounted:skipped:no_layouts'");
    const short = planExplainerMount({claimPlan: planClaimVisuals({segments: planExplainerPacing({durationSec: 8}).segments, words: []}), words: [], durationSec: 8});
    expect(short.layoutTrack.every(span => span.layout === 'explainer_a')).toBe(true);
  });

  it('hard cuts: the soft transitions are cleared for a mounted edit, after the density step and before the SFX / blueprint, with a warning', () => {
    expect(analyze).toContain('if (explainerMount) {');
    expect(analyze).toContain('broll.transitions = [];');
    expect(analyze).toContain('`polish_explainer_mounted:transitions_cleared:${cleared}`');
    expect(analyze.indexOf('polish_pace:transitions:')).toBeLessThan(analyze.indexOf('polish_explainer_mounted:transitions_cleared'));
    expect(analyze.indexOf('polish_explainer_mounted:transitions_cleared')).toBeLessThan(analyze.indexOf('schedulePolishSfxHits('));
    expect(analyze.indexOf('polish_explainer_mounted:transitions_cleared')).toBeLessThan(analyze.indexOf('const blueprint: TimelineBlueprint = {'));
  });

  it('no editorial still run is planned over a mounted edit (the whole runtime is blocked), the gate line itself is unchanged', () => {
    expect(analyze).toContain('if (polishPath && motion && !facelessDoc && env.POLISH_EDITORIAL_STILLS_ENABLED && stockConfigured()) {');
    expect(analyze).toContain('...(explainerMount ? [{start: 0, end: timeline.outputDurationSec}] : []),');
  });

  it('Skill A untouched + mutual exclusion intact: the exact accumulate / faceless gates, one lane call, faceless wins', () => {
    expect(analyze).toMatch(/if \(polishPath && env\.POLISH_ACCUMULATE_CAPTIONS && voGrammar && !\(input\.captionPreset \|\| ''\)\.trim\(\) && !captionGuide && !input\.captionTemplate\)/);
    expect(analyze).toContain('const facelessDoc = Boolean(polishPath && env.POLISH_FACELESS_DOC && voGrammar && motion && stockConfigured());');
    expect(analyze.match(/planFacelessDocLane\(/g)).toHaveLength(1);
    expect(analyze.split('\n').filter(line => line.includes('polishAccumulateCaptions(')).length).toBe(1);
    expect(analyze.split('\n').filter(line => line.includes('polishExplainerCaptions(')).length).toBeGreaterThanOrEqual(1);
    expect(resolvePolishSkill({faceless: true, explainer: true})).toEqual({skill: 'faceless', warnings: ['polish_pace:explainer_skipped:faceless_wins']});
    expect(resolvePolishSkill({faceless: false, explainer: true}).skill).toBe('explainer');
    expect(resolvePolishSkill({faceless: true, explainer: false}).skill).toBe('faceless');
    expect(resolvePolishSkill({faceless: false, explainer: true, newsroom: true}).skill).toBe('newsroom_mg');
    expect(env.POLISH_FACELESS_DOC).toBe(false);
    expect(env.POLISH_ACCUMULATE_CAPTIONS).toBe(true);
    // the explainer block never touches the faceless / TH modules
    expect(explainerBlock).not.toMatch(/thSkillA|talkingHead|planFacelessDocLane|facelessDoc/);
  });

  it('the captions the mount rides on are still the WP41 chunk-swap (yTrack from the same track)', () => {
    const {caption} = polishExplainerCaptions({position: 'center', bottomFrac: 0.2}, {layoutTrack: claimPlan.layoutTrack});
    expect(caption.mode).toBe('chunk_swap');
    expect(caption.yTrack).toHaveLength(mount.layoutTrack.length);
    expect(caption.yTrack!.map(entry => entry.start)).toEqual(mount.layoutTrack.map(span => span.start));
  });
});

describe('WP42 5) ShortVideo mount (source pins)', () => {
  const short = stripComments(read('../../../../remotion/src/ShortVideo.tsx'));
  const exLayouts = stripComments(read('../../../../remotion/src/components/ExplainerLayouts.tsx'));

  it('composes through ExplainerLayoutFrame (A speaker, B media over speaker, C / D media with the speaker hidden) and wraps the claim plate in LimeHighlightWipe', () => {
    expect(short).toContain("import {ExplainerLayoutFrame} from './components/ExplainerLayouts';");
    expect(short).toContain("import {LimeHighlightWipe} from './components/LimeHighlightWipe';");
    expect(short).toContain('<ExplainerLayoutFrame');
    expect(short).toContain('<LimeHighlightWipe');
    expect(short).toContain('<ExplainerClaimPlate');
    expect(short).toContain('blueprint.explainerLayoutTrack');
    expect(short).toContain('activeExplainerSpanAt(explainerTrack, frame, fps)');
    expect(short).toContain('claimBeatForSpan(blueprint.explainerClaimBeats, explainerSpan)');
    expect(short).toContain("speakerAt('50% 22%')"); // B: face-safe bottom half
    expect(short).toContain('opacity: 0'); // C / D: the speaker stays mounted (audio) but is not visible
    expect(exLayouts).toContain('ExplainerLayoutFrame');
  });

  it('a HARD cut: no Sequence / crossfade / spring between layouts inside the explainer picture', () => {
    const start = short.indexOf('const explainerPicture =');
    const end = short.indexOf('const picture = (');
    const block = short.slice(start, end);
    expect(block.length).toBeGreaterThan(200);
    expect(block).not.toMatch(/<Sequence|interpolate\(|spring\(|transition|crossfade|opacity: (?!0\b)/i);
  });

  it('classic / faceless / TH paths are unchanged without a track: the explainer branch is first, every other branch and track keeps its place', () => {
    expect(short).toContain('const explainerOn = explainerTrack.length > 0;');
    expect(short).toContain('allOverlays;'); // the classic overlays expression is the same array when no track
    expect(short).toContain('const generatedSplit = split || explainerOn ? undefined : activeGeneratedSplitAt(');
    expect(short).toContain('{style.brollEnabled && !explainerOn ? <CompositeTrack overlays={overlays} /> : null}');
    expect(short).toContain('!split && !cutout && !explainerOn ? (');
    const ladder = short.slice(short.indexOf('{explainerPicture ? ('), short.indexOf('{style.brollEnabled && blueprint.brollClips.length'));
    for (const needle of ['explainerPicture', '<SplitStage', '<GeneratedSplitStage', 'composite ? (', '<CutoutStage', 'classicStack']) expect(ladder, needle).toContain(needle);
    expect(ladder.indexOf('explainerPicture')).toBeLessThan(ladder.indexOf('<SplitStage'));
    // the transition track, impact FX, generated graphics, captions: still mounted, still in the same stack
    for (const needle of ['<TransitionTrack clips={blueprint.transitions} />', '<ImpactFxTrack fx={blueprint.impactFx} />', '<GeneratedGraphicTrack', '<DynamicCaptionRenderer', '<SemanticEmphasisTrack', '<HookTitle']) expect(short, needle).toContain(needle);
    expect(short.indexOf('<TransitionTrack')).toBeGreaterThan(short.indexOf('{explainerPicture ? ('));
    // the classic stack is the same nest as before (inset reveal > text behind subject > depth overlay > media container)
    const classic = short.slice(short.indexOf('const classicStack ='), short.indexOf('const explainerSpan'));
    expect(classic.indexOf('<InsetRevealTrack')).toBeLessThan(classic.indexOf('<TextBehindSubjectTrack'));
    expect(classic.indexOf('<TextBehindSubjectTrack')).toBeLessThan(classic.indexOf('<DepthOverlayTrack'));
    expect(classic).toContain('talkingHead={containedSpeaker}');
    // the classic speaker keeps its object position rule
    expect(short).toContain("const speaker = speakerAt(split || generatedSplit ? speakerObjectPosition : '50% 42%');");
  });

  it('the free picture-owning overlays and the layout media are filtered out of the free overlay track in an explainer edit', () => {
    expect(short).toContain('!isExplainerMedia(overlay)');
    expect(short).toContain('EXPLAINER_PICTURE_OWNING_OVERLAYS as readonly string[]');
    expect([...EXPLAINER_PICTURE_OWNING_OVERLAYS].sort()).toEqual(['composite', 'cutaway', 'cutout', 'split']);
  });

  it('the plate measures the phrase from the DOM and degrades gracefully (fallback band + warn, never a throw)', () => {
    const plate = stripComments(read('../../../../remotion/src/components/ExplainerMount.tsx'));
    for (const needle of ['delayRender', 'continueRender', 'getClientRects', 'document.fonts', 'EXPLAINER_FALLBACK_RECT', '.catch(']) expect(plate, needle).toContain(needle);
    expect(plate).not.toMatch(/Math\.random|Date\.now/);
    expect(short).toContain('was not measurable; using the fallback band');
  });
});

describe('WP42 6) renderer helpers (pure)', () => {
  const track = mount.layoutTrack;

  it('activeExplainerSpanAt is a hard cut: the last frame of a span is the old layout, the first frame of the next is the new one', () => {
    for (let index = 1; index < track.length; index += 1) {
      const cutFrame = Math.round(track[index]!.start * FPS);
      expect(activeExplainerSpanAt(track, cutFrame - 1, FPS)).toBe(track[index - 1]);
      expect(activeExplainerSpanAt(track, cutFrame, FPS)).toBe(track[index]);
    }
    expect(activeExplainerSpanAt(track, 0, FPS)).toBe(track[0]);
    expect(activeExplainerSpanAt(track, 99999, FPS)).toBe(track.at(-1));
    expect(activeExplainerSpanAt([], 5, FPS)).toBeNull();
  });

  it('every frame resolves to exactly one layout, across the whole runtime', () => {
    const frames = Math.round(fixture.durationSec * FPS);
    let changes = 0;
    let last: unknown = null;
    for (let frame = 0; frame < frames; frame += 1) {
      const span = activeExplainerSpanAt(track, frame, FPS);
      expect(span).not.toBeNull();
      if (last && span !== last) changes += 1;
      last = span;
    }
    expect(changes).toBe(track.length - 1);
  });

  it('media lookup: the overlay tagged for the span layout that overlaps it most; A has none; a free overlay is never layout media', () => {
    const c = track.find(span => span.layout === 'explainer_c')!;
    const overlays = [
      {start: c.start, end: c.end, intent: 'explainer_c', id: 'mine'},
      {start: c.start, end: c.end, intent: 'explainer_d', id: 'other layout'},
      {start: c.start, end: c.end, id: 'free'},
      {start: c.start + 1, end: c.start + 1.5, intent: 'explainer_c', id: 'shorter'},
    ];
    expect(explainerMediaForSpan(overlays, c)?.id).toBe('mine');
    expect(explainerMediaForSpan(overlays, track.find(span => span.layout === 'explainer_a')!)).toBeUndefined();
    expect(explainerMediaForSpan([], c)).toBeUndefined();
    expect(explainerMediaIntent('explainer_a')).toBeNull();
    expect(explainerMediaIntent('explainer_b')).toBe('explainer_b');
  });

  it('the claim beat is only ever the layout-B span with the same bounds', () => {
    const beat = mount.claimBeats[0]!;
    const bSpan = track.find(span => span.layout === 'explainer_b' && Math.abs(span.start - beat.start) < 0.02)!;
    expect(claimBeatForSpan(mount.claimBeats, bSpan)).toBe(beat);
    expect(claimBeatForSpan(mount.claimBeats, {...bSpan, layout: 'explainer_c'})).toBeUndefined();
    const hook = track[0]!;
    expect(hook.layout).toBe('explainer_b');
    expect(claimBeatForSpan(mount.claimBeats, hook)).toBeUndefined(); // the hook B span is stock media, not an article plate
    expect(claimBeatForSpan(undefined, bSpan)).toBeUndefined();
  });

  it('plate text: split around the phrase (case-insensitive), a missing phrase is appended so the highlight has a target', () => {
    expect(splitPlateContext('it processed $1.4 trillion last year', '$1.4 trillion')).toEqual({before: 'it processed ', phrase: '$1.4 trillion', after: ' last year'});
    expect(splitPlateContext('It Processed $1.4 TRILLION', '$1.4 trillion').phrase).toBe('$1.4 TRILLION');
    expect(splitPlateContext('nothing here', '40%')).toEqual({before: 'nothing here ... ', phrase: '40%', after: ''});
    expect(splitPlateContext(undefined, '40%')).toEqual({before: '', phrase: '40%', after: ''});
    expect(plateFontPx(40, 1080)).toBeGreaterThan(plateFontPx(200, 1080));
  });
});

describe('WP42 7) the offline proof', () => {
  const root = '../../../../remotion/';
  it('has the script and the npm script; it renders the PRODUCTION composition and never writes Skill A / WP40 / WP41 files', () => {
    const script = read(`${root}scripts/wp42-preview.mjs`);
    for (const needle of ["id: 'ShortVideo'", 'src/index.ts', 'planExplainerMount', 'placeExplainerMedia', 'explainerLayoutTrack', 'wp42-explainer-mounted.mp4', 'wp42-measured.json', 'everyCutIsHard']) expect(script, needle).toContain(needle);
    expect(script).not.toMatch(/wp36-faceless-doc\.mp4|wp36-plan\.json|wp40-explainer-layouts\.mp4|wp40-plan\.json|wp41-explainer-captions\.mp4|wp41-plan\.json/);
    const scripts = JSON.parse(read(`${root}package.json`)).scripts;
    expect(scripts['preview:wp42']).toBe('node scripts/wp42-preview.mjs');
    expect(scripts['preview:wp41']).toBe('node scripts/wp41-preview.mjs');
    expect(scripts['preview:wp40']).toBe('node scripts/wp40-preview.mjs');
  });

  const measuredPath = new URL(`${root}out/phase36-readiness/wp42-measured.json`, import.meta.url);
  it.skipIf(!existsSync(measuredPath))('the measured MP4: production ShortVideo, A / B / C / D hard cuts, speaker rules per layout, chunk-swap y, lime L->R wipe + dim', () => {
    const measured = JSON.parse(readFileSync(measuredPath, 'utf8'));
    expect(measured.video.width).toBe(540);
    expect(measured.video.durationSec).toBeGreaterThanOrEqual(20);
    expect(measured.video.durationSec).toBeLessThanOrEqual(30);
    expect(measured.cutsVerifiedOnFile).toBe(measured.cutsPlanned);
    expect(measured.checks).toEqual({
      productionComposition: true,
      allFourLayouts: true,
      layoutTrackTilesWithoutGaps: true,
      everyCutIsHard: true,
      cutsOnFile: true,
      speakerFullOnA: true,
      speakerBottomOnB: true,
      speakerHiddenOnCD: true,
      cIsWhiteGround: true,
      dIsDark: true,
      chunkSwapMode: true,
      captionYByLayout: true,
      captionYBothValues: true,
      limeAppears: true,
      limeWipesLeftToRight: true,
      restDims: true,
      noSoftTransitions: true,
    });
    for (const row of measured.cuts) expect(row.hard).toBe(true);
  });
});
