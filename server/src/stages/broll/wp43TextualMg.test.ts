/**
 * WP43 Skill C (textual motion graphics): library registry hit, publish path, stage, analyze wiring pins (flag gated), Skill A / Skill B untouched, recipe ids. Offline: no network, no model, no Chromium
 * (the generated TSX goes through the worker's real typecheck + compile; the publisher is a fake).
 */
import {existsSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

import {textualMgFontPx, textualMgLines} from '../../../../remotion/src/lib/textualMgLines.ts';
import {MOTION_RECIPE_IDS} from '../../../../remotion/src/motion/recipes/motionRecipes.ts';
import {env} from '../../config/env.ts';
import {mergeMuteRanges} from '../../lib/captionMute.ts';
import {validateGraphicSource, type MotionGraphicResult} from '../../motionWorker/worker.ts';
import {
  LIBRARY_COMPOSITION_IDS,
  LIBRARY_COMPOSITIONS,
  REGISTRY_RECIPE_IDS,
  TEXTUAL_MG_REGISTRY_FAMILIES,
  libraryGraphicSource,
  resolveLibraryGraphic,
} from '../motionDirector/libraryRegistry.ts';
import {TEXTUAL_MG_CATALOG, TEXTUAL_MG_FAMILIES} from './textualMgCatalog.ts';
import {planTextualMgPlates} from './textualMgPlanner.ts';
import {TEXTUAL_MG_GRAPHIC_ID_PREFIX, publishTextualMgPlates, textualMgBrief, type TextualMgPublisher} from './textualMgPublish.ts';
import {runTextualMgStage} from './textualMgStage.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../../../..');
const read = (...parts: string[]) => readFileSync(join(repo, ...parts), 'utf8');
const analyze = read('server/src/pipeline/analyzeVideo.ts');

/** The Skill C block of analyzeVideo (from its WP43 marker to the WP11A mute computation). */
const skillCBlock = (() => {
  const start = analyze.indexOf('// WP43: SKILL C');
  const end = analyze.indexOf('// WP11A: one text job at a time');
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return analyze.slice(start, end);
})();

const words = [
  {text: 'Six', start: 0.2, end: 0.4},
  {text: 'billion', start: 0.4, end: 0.7},
  {text: 'people', start: 0.7, end: 1.0},
  {text: 'watch', start: 1.0, end: 1.2},
  {text: 'short', start: 1.2, end: 1.4},
  {text: 'videos', start: 1.4, end: 1.8},
  {text: 'but', start: 8.0, end: 8.2},
  {text: 'almost', start: 8.2, end: 8.5},
  {text: 'none', start: 8.5, end: 8.8},
  {text: 'convert', start: 8.8, end: 9.2},
  {text: 'Follow', start: 18.0, end: 18.3},
  {text: 'for', start: 18.3, end: 18.5},
  {text: 'more', start: 18.5, end: 18.8},
];

const fakeResult = (brief: {id: string; content: Record<string, unknown>}): MotionGraphicResult =>
  ({
    id: brief.id,
    module: {url: `https://cdn.invalid/${brief.id}.js`, sha256: 'a'.repeat(64)},
    placement: {mode: 'overlay'},
    props: {content: brief.content},
    brief: {purpose: 'p', visualIntent: 'v'},
  }) as unknown as MotionGraphicResult;

const okPublisher = (async (brief: {id: string; content: Record<string, unknown>}) => fakeResult(brief)) as unknown as TextualMgPublisher;

describe('library registry: TextualMgPlate', () => {
  it('is registered (66 after the text match cut), overlay friendly (not opaque / overlay only), and exported by the toolkit', () => {
    expect(LIBRARY_COMPOSITION_IDS).toHaveLength(66);
    expect(LIBRARY_COMPOSITION_IDS).toContain('TextualMgPlate');
    const entry = LIBRARY_COMPOSITIONS.find(row => row.id === 'TextualMgPlate')!;
    expect(entry.opaqueOnly).toBeUndefined();
    expect(entry.overlayOnly).toBeUndefined();
    const index = read('remotion/src/motion/index.ts');
    expect(index).toMatch(/export \{TextualMgPlate\b/);
    expect(index).toMatch(/export const compositions = \{[^}]*\bTextualMgPlate\b/);
  });

  it('hits on textualMg, on textualMgFamily + text, and on a skillC tag + text; copy is verbatim', () => {
    const a = resolveLibraryGraphic({placement: 'overlay', content: {textualMg: 'Six billion people'}})!;
    expect(a.compositionId).toBe('TextualMgPlate');
    expect(a.props).toMatchObject({text: 'Six billion people', family: 'snap_elastic', recipeId: 'elastic_type_snap'});
    const b = resolveLibraryGraphic({placement: 'overlay', content: {textualMgFamily: 'mask_reveal', text: 'Meet the new engine'}})!;
    expect(b.props).toMatchObject({text: 'Meet the new engine', family: 'mask_reveal', recipeId: 'split_mask_reveal'});
    const c = resolveLibraryGraphic({placement: 'overlay', content: {skillC: true, text: 'But then it broke'}})!;
    expect(c.compositionId).toBe('TextualMgPlate');
    expect(c.props.text).toBe('But then it broke');
    const d = resolveLibraryGraphic({placement: 'overlay', content: {tag: 'skillC', text: 'Follow for more'}})!;
    expect(d.compositionId).toBe('TextualMgPlate');
  });

  it('works over media (overlay / pip) and on a full-bleed brief, with no `background: boolean` (type has its own ground prop)', () => {
    for (const placement of ['overlay', 'pip', 'full_screen']) {
      const hit = resolveLibraryGraphic({placement, content: {textualMg: 'Type over media'}})!;
      expect(hit.compositionId, placement).toBe('TextualMgPlate');
      expect(hit.props.background).toBeUndefined();
    }
    expect(resolveLibraryGraphic({placement: 'overlay', content: {textualMg: 'Soft', background: 'soft_plate'}})!.props.background).toBe('soft_plate');
  });

  it('plain text / statement briefs are NOT hijacked (no skill C tag, no textualMg key)', () => {
    expect(resolveLibraryGraphic({placement: 'full_screen', content: {text: 'Just a statement'}})!.compositionId).toBe('FullscreenStatement');
    expect(resolveLibraryGraphic({placement: 'overlay', content: {text: 'Loose text'}})).toBeNull();
    expect(resolveLibraryGraphic({placement: 'overlay', content: {headline: 'Big headline'}})!.compositionId).toBe('BigKineticHeadline');
  });

  it('misses (never rewrites) on too long copy, an unknown family, or an empty string', () => {
    expect(resolveLibraryGraphic({placement: 'overlay', content: {textualMg: 'one two three four five six seven eight nine'}})).toBeNull();
    expect(resolveLibraryGraphic({placement: 'overlay', content: {textualMg: 'x'.repeat(90)}})).toBeNull();
    expect(resolveLibraryGraphic({placement: 'overlay', content: {textualMgFamily: 'blend_extrude', text: 'Deferred'}})).toBeNull();
    expect(resolveLibraryGraphic({placement: 'overlay', content: {textualMg: '   '}})).toBeNull();
  });

  it('recipeId is kept only when it belongs to the family; counter props pass through for counter_metric', () => {
    const own = resolveLibraryGraphic({placement: 'overlay', content: {textualMgFamily: 'scramble_glitch', text: 'Glitch it', recipeId: 'glitch_text_reveal'}})!;
    expect(own.props.recipeId).toBe('glitch_text_reveal');
    const foreign = resolveLibraryGraphic({placement: 'overlay', content: {textualMgFamily: 'scramble_glitch', text: 'Glitch it', recipeId: 'type_trail'}})!;
    expect(foreign.props.recipeId).toBe('scramble_settle');
    const counter = resolveLibraryGraphic({placement: 'overlay', content: {textualMg: 'Six billion', counter: {to: 6e9, prefix: '$', decimals: 0}}})!;
    expect(counter.props).toMatchObject({family: 'counter_metric', recipeId: 'counter_snap', counter: {to: 6e9, prefix: '$', decimals: 0}});
  });

  it('emits Tiny TSX importing TextualMgPlate that passes the worker typecheck + compile', async () => {
    const hit = resolveLibraryGraphic({placement: 'overlay', content: {textualMgFamily: 'smear_blur', text: 'Smear in'}})!;
    const source = libraryGraphicSource(hit);
    expect(source).toContain("import {TextualMgPlate, type GraphicProps} from '@finalpost/motion';");
    expect(source.split('\n').length).toBeLessThan(20);
    const {report, compiled} = await validateGraphicSource(source);
    expect(report).toEqual({safety: [], typecheck: [], compile: [], runtime: []});
    expect(compiled?.bytes).toBeGreaterThan(0);
  }, 60_000);

  it('recipes: every catalog recipe is in MOTION_RECIPE_IDS and the registry copy', () => {
    for (const row of TEXTUAL_MG_CATALOG) {
      for (const recipe of row.recipes) {
        expect(MOTION_RECIPE_IDS, `${row.id}:${recipe}`).toContain(recipe);
        expect(REGISTRY_RECIPE_IDS, `${row.id}:${recipe}`).toContain(recipe);
      }
    }
    // the registry's inline copy equals the catalog (the registry imports nothing)
    expect(Object.keys(TEXTUAL_MG_REGISTRY_FAMILIES)).toEqual([...TEXTUAL_MG_FAMILIES]);
    for (const row of TEXTUAL_MG_CATALOG) expect([...TEXTUAL_MG_REGISTRY_FAMILIES[row.id]!]).toEqual([...row.recipes]);
    expect(TEXTUAL_MG_FAMILIES).toHaveLength(7);
    // blend_extrude stays deferred: no family, no recipe
    expect(TEXTUAL_MG_FAMILIES as readonly string[]).not.toContain('blend_extrude');
  });
});

describe('glyph recipe line breaking (never mid-word)', () => {
  it('breaks into whole-word balanced lines, at most 3, and fits the box', () => {
    const lines = textualMgLines('Here is the trick that changes everything');
    expect(lines.length).toBeLessThanOrEqual(3);
    expect(lines.join(' ')).toBe('Here is the trick that changes everything');
    for (const line of lines) expect(line.split(' ').every(word => 'Here is the trick that changes everything'.split(' ').includes(word))).toBe(true);
    expect(textualMgLines('Stop scrolling')).toEqual(['Stop scrolling']);
    expect(textualMgLines('Supercalifragilisticexpialidocious')).toEqual(['Supercalifragilisticexpialidocious']);
    expect(textualMgLines('')).toEqual([]);
    const px = textualMgFontPx(lines, 930, 108);
    expect(px).toBeLessThanOrEqual(108);
    expect(px * 0.6 * Math.max(...lines.map(line => line.length))).toBeLessThanOrEqual(930);
  });
});

describe('planner: blocked ranges', () => {
  it('skips a plate that would overlap a blocked span (never shifts), and says so', () => {
    const open = planTextualMgPlates({durationSec: 20, words});
    expect(open.plates[0]!.trigger).toBe('hook_title');
    const blocked = planTextualMgPlates({durationSec: 20, words, blockedRanges: [{start: 0, end: 3}]});
    expect(blocked.plates.some(plate => plate.trigger === 'hook_title')).toBe(false);
    expect(blocked.plates.every(plate => plate.start >= 3 - 0.05 || plate.end <= 0.05)).toBe(true);
    expect(blocked.warnings.some(w => w.startsWith('polish_textual_mg:skipped_blocked:'))).toBe(true);
  });

  it('stays sparse: never more than ~1 plate per 8 s, no wall-to-wall text', () => {
    const plan = planTextualMgPlates({durationSec: 20, words});
    const covered = plan.plates.reduce((sum, plate) => sum + (plate.end - plate.start), 0);
    expect(covered / 20).toBeLessThan(0.35);
  });
});

describe('publish + stage (fake publisher)', () => {
  const plates = planTextualMgPlates({durationSec: 20, words}).plates;

  it('builds an overlay library brief per plate (no Claude, id prefix kept)', () => {
    const brief = textualMgBrief(plates[0]!, 0);
    expect(brief.placement).toBe('overlay');
    expect(brief.id.startsWith(TEXTUAL_MG_GRAPHIC_ID_PREFIX)).toBe(true);
    expect(brief.content).toMatchObject({textualMg: plates[0]!.text, textualMgFamily: plates[0]!.family, recipeId: plates[0]!.recipeId});
  });

  it('publishes plates as GeneratedGraphics at the plate window', async () => {
    const {published, failed} = await publishTextualMgPlates(plates, {publisher: okPublisher});
    expect(failed).toEqual([]);
    expect(published).toHaveLength(plates.length);
    published.forEach((item, index) => {
      expect(item.graphic.id).toBe(`${TEXTUAL_MG_GRAPHIC_ID_PREFIX}${index + 1}`);
      expect(item.graphic.start).toBe(item.plate.start);
      expect(item.graphic.end).toBe(item.plate.end);
      expect(item.graphic.placement.mode).toBe('overlay');
    });
  });

  it('a failing publisher places nothing and mutes nothing (captions stay on)', async () => {
    const failing = (async () => {
      throw new Error('upload down');
    }) as unknown as TextualMgPublisher;
    const stage = await runTextualMgStage({words, durationSec: 20, publish: {publisher: failing}});
    expect(stage.graphics).toEqual([]);
    expect(stage.muteRanges).toEqual([]);
    expect(stage.warnings.some(w => w.startsWith('polish_textual_mg:publish_failed:'))).toBe(true);
  });

  it('stage: graphics + mute ranges for the published plates, warnings polish_textual_mg:*', async () => {
    const stage = await runTextualMgStage({words, durationSec: 20, publish: {publisher: okPublisher}});
    expect(stage.graphics.length).toBe(stage.published.length);
    expect(stage.muteRanges).toEqual(stage.published.map(item => ({startSec: item.plate.start, endSec: item.plate.end})));
    expect(stage.warnings.every(w => w.startsWith('polish_textual_mg:'))).toBe(true);
    expect(stage.warnings).toContain(`polish_textual_mg:published:${stage.published.length}`);
  });

  it('an empty / short clip is a no-op (no publish call)', async () => {
    let calls = 0;
    const counting = (async (brief: {id: string; content: Record<string, unknown>}) => {
      calls += 1;
      return fakeResult(brief);
    }) as unknown as TextualMgPublisher;
    const stage = await runTextualMgStage({words: [], durationSec: 30, publish: {publisher: counting}});
    expect(stage.graphics).toEqual([]);
    expect(calls).toBe(0);
  });

  it('plate mute ranges merge into the WP11A ranges (touching spans collapse, order kept)', () => {
    expect(mergeMuteRanges([{startSec: 5, endSec: 6}, {startSec: 1, endSec: 2}, {startSec: 1.9, endSec: 3}])).toEqual([
      {startSec: 1, endSec: 3},
      {startSec: 5, endSec: 6},
    ]);
  });
});

describe('analyzeVideo wiring (flag gated)', () => {
  it('POLISH_TEXTUAL_MG defaults OFF in env.ts, .env.example and the runtime env', () => {
    expect(read('server/src/config/env.ts')).toMatch(/POLISH_TEXTUAL_MG: bool\(false\)/);
    expect(read('.env.example')).toMatch(/# POLISH_TEXTUAL_MG=0/);
    expect(env.POLISH_TEXTUAL_MG).toBe(false);
  });

  it('the Skill C block runs ONLY on polish + the flag, and is the only caller of the stage', () => {
    expect(skillCBlock).toMatch(/if \(polishPath && flags\.textualMg\)/);
    expect((analyze.match(/runTextualMgStage\(/g) ?? []).length).toBe(1);
    expect(analyze).toMatch(/polish_textual_mg:skipped:no_motion/);
    expect(analyze).toMatch(/polish_textual_mg:failed/);
  });

  it('publishes through the motion graphics list and merges only mute ranges into the blueprint', () => {
    expect(skillCBlock).toMatch(/motion = \{\.\.\.motion, generatedGraphics: \[\.\.\.motion\.generatedGraphics, \.\.\.textualMg\.graphics\]/);
    expect(analyze).toMatch(/mergeMuteRanges\(\[\.\.\.muteRangesWp11a, \.\.\.textualMgMute(, \.\.\.motionTemplateMute)?(, \.\.\.visualBackendMute)?\]\)/);
    expect(analyze).toMatch(/\.\.\.\(muteRanges\.length > 0 \? \{captionMuteRanges: muteRanges\} : \{\}\)/);
  });

  it('plates are never planned over the hook title, full-frame graphics or explainer / cutaway media', () => {
    expect(skillCBlock).toMatch(/hookBlocked/);
    expect(skillCBlock).toMatch(/placement\.mode === 'full_screen' \|\| graphic\.placement\.mode === 'split_screen'/);
    expect(skillCBlock).toMatch(/overlay\.layout === 'cutaway'/);
  });

  it('adds no SFX: Skill C graphics are filtered out of the SFX scheduler input', () => {
    expect(analyze).toMatch(/filter\(graphic => !graphic\.id\.startsWith\(TEXTUAL_MG_GRAPHIC_ID_PREFIX\)\)/);
    expect(read('server/src/stages/broll/textualMgStage.ts')).not.toMatch(/sfx|audioDesign/i);
  });
});

describe('Skill A / Skill B are untouched', () => {
  it('the Skill C block touches no caption direction, no explainer mount, no faceless lane, no accumulate / chunk-swap', () => {
    expect(skillCBlock).not.toMatch(/broll\.caption\s*=/);
    expect(skillCBlock).not.toMatch(/captionDirection/);
    expect(skillCBlock).not.toMatch(/explainerMount\s*=/);
    expect(skillCBlock).not.toMatch(/facelessDoc/);
    expect(skillCBlock).not.toMatch(/accumulate|chunk_swap|polishExplainerCaptions|polishAccumulate/i);
    expect(skillCBlock).not.toMatch(/broll\.transitions\s*=/);
  });

  it('the Skill B mount (WP42) and the Skill A faceless lane (WP36) are still in analyzeVideo', () => {
    expect(analyze).toMatch(/resolvePolishSkill\(\{\s*faceless: Boolean\(polishPath && flags\.facelessDoc\),\s*explainer: Boolean\(polishPath && flags\.explainerSkill\),\s*newsroom: Boolean\(polishPath && flags\.newsroomMg\),?\s*\}\)/); // WP44 added the newsroom flag to the lane switch
    expect(analyze).toMatch(/planExplainerMount\(/);
    expect(analyze).toMatch(/explainerLayoutTrack: explainerMount\.layoutTrack, explainerClaimBeats: explainerMount\.claimBeats/);
    expect(analyze).toMatch(/polishExplainerCaptions\(broll\.caption/);
    expect(analyze).toMatch(/planFacelessDocLane\(/);
    expect(analyze).toMatch(/word_by_word_accumulate/);
    expect(analyze).toMatch(/polish_explainer_mounted:transitions_cleared/);
  });

  it('the remotion side kept the Skill B mount + Skill A proofs, and the plate is a separate composition', () => {
    const short = read('remotion/src/ShortVideo.tsx');
    expect(short).toMatch(/explainerLayoutTrack/);
    expect(existsSync(join(repo, 'remotion/src/motion/compositions/TextualMgPlate.tsx'))).toBe(true);
    expect(existsSync(join(repo, 'remotion/out/phase36-readiness/wp42-explainer-mounted.mp4'))).toBe(true);
    expect(existsSync(join(repo, 'remotion/out/phase36-readiness/wp36-faceless-doc.mp4'))).toBe(true);
    const pkg = read('remotion/package.json');
    expect(pkg).toMatch(/"preview:wp42"/);
    expect(pkg).toMatch(/"preview:wp43"/);
  });

  it('the server never imports the remotion plate (React / motion): only the server catalog copy', () => {
    for (const file of ['textualMgCatalog.ts', 'textualMgPlanner.ts', 'textualMgPublish.ts', 'textualMgStage.ts']) {
      const source = read('server/src/stages/broll', file);
      expect(source, file).not.toMatch(/remotion\/src\/motion/);
      expect(source, file).not.toMatch(/from ['"]react['"]/);
      expect(source, file).not.toMatch(/from ['"][^'"]*TextualMgPlate/);
    }
    expect(read('server/src/stages/motionDirector/libraryRegistry.ts')).not.toMatch(/^import /m);
  });
});

describe('proof outputs (after npm run preview:wp43)', () => {
  it('records the preview script + report path', () => {
    expect(existsSync(join(repo, 'remotion/scripts/wp43-preview.mjs'))).toBe(true);
    expect(existsSync(join(repo, 'remotion/scripts/wp43/entry.tsx'))).toBe(true);
  });
});
