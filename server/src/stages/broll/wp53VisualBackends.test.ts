/**
 * WP53: visual backends (riso / collage_gbro / anidoodle) INSIDE the existing toolkits. Offline only: no Chrome, no Gemini, no R2.
 */
import {existsSync, mkdtempSync, readdirSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {env} from '../../config/env.ts';
import {EDIT_TOOLKITS} from '../../lib/editToolkits.ts';
import {resolvePolishSkill} from './explainerPacing.ts';
import {MOTION_TEMPLATE_CATALOG, MOTION_TEMPLATE_IDS, SKILL_MOTION_TEMPLATE_ALLOWLIST, planMotionTemplateBeats, type MotionTemplateWord} from './motionTemplateCatalog.ts';
import {anidoodleRenderArgs, prepareAnidoodle, safeDoodleStyle} from './visualBackend/anidoodleAdapter.ts';
import {collageRenderEnabled, prepareCollage} from './visualBackend/collageAdapter.ts';
import {DOODLE_STYLE_ALLOWLIST, dropEmphasisCoveredByVisualBackend, planVisualBackendBeats, type RisoPayload} from './visualBackend/planVisualBackendBeats.ts';
import {buildRisoCompositionHtml, risoCacheKey, resolveRisoRoot} from './visualBackend/risoAdapter.ts';
import {mapPaletteToRiso, validateSceneSpec} from './visualBackend/sceneSpec.ts';
import {nativeFallbackFor, runVisualBackendStage} from './visualBackend/visualBackendStage.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../../../..');

function wordsOf(text: string, start = 1, step = 0.3): MotionTemplateWord[] {
  return text.split(/\s+/).map((word, index) => ({text: word, start: start + index * step, end: start + index * step + step - 0.05}));
}
const ALL_ON = {riso: true, collage: true, anidoodle: true};
const RISO_ON = {riso: true, collage: false, anidoodle: false};
const plan = (text: string, extra: Partial<Parameters<typeof planVisualBackendBeats>[0]> = {}, start = 1) =>
  planVisualBackendBeats({skill: 'explainer', durationSec: 30, words: wordsOf(text, start), flags: RISO_ON, ...extra});

describe('WP53 flags + catalog', () => {
  it('flags default false and roots default empty', () => {
    expect(env.POLISH_RISO_TEMPLATES).toBe(false);
    expect(env.POLISH_COLLAGE_BROLL).toBe(false);
    expect(env.POLISH_ANIDOODLE).toBe(false);
    expect(env.EIAN_RISO_ROOT).toBe('');
    expect(env.ANIDOODLE_ENGINE_ROOT).toBe('');
    expect(env.COLLAGE_BROLL_ROOT).toBe('');
  });

  it('catalog contains clip_27..34 and the allowlists match the table', () => {
    const ids = MOTION_TEMPLATE_IDS.slice(26, 34);
    expect(ids).toEqual(['clip_27_riso_number', 'clip_28_riso_versus', 'clip_29_riso_compare', 'clip_30_riso_converge', 'clip_31_riso_quote', 'clip_32_riso_chapter', 'clip_33_collage_assemble', 'clip_34_doodle_explain']);
    expect(MOTION_TEMPLATE_CATALOG.slice(26, 34).map(r => r.id)).toEqual(ids);
    const toolkits = Object.fromEntries(MOTION_TEMPLATE_CATALOG.slice(26, 34).map(r => [r.id, r.toolkit]));
    expect(toolkits).toEqual({clip_27_riso_number: 'counter', clip_28_riso_versus: 'emphasis', clip_29_riso_compare: 'counter', clip_30_riso_converge: 'kinetic_text', clip_31_riso_quote: 'kinetic_text', clip_32_riso_chapter: 'kinetic_text', clip_33_collage_assemble: 'cutaway', clip_34_doodle_explain: 'cutaway'});
    const skillsOf = (id: string) => Object.entries(SKILL_MOTION_TEMPLATE_ALLOWLIST).filter(([, list]) => list.includes(id as never)).map(([skill]) => skill).sort();
    expect(skillsOf('clip_27_riso_number')).toEqual(['default', 'explainer', 'newsroom_mg']);
    expect(skillsOf('clip_28_riso_versus')).toEqual(['default', 'explainer', 'newsroom_mg']);
    expect(skillsOf('clip_29_riso_compare')).toEqual(['default', 'explainer', 'newsroom_mg']);
    expect(skillsOf('clip_30_riso_converge')).toEqual(['default', 'explainer']);
    expect(skillsOf('clip_31_riso_quote')).toEqual(['default', 'explainer']);
    expect(skillsOf('clip_32_riso_chapter')).toEqual(['default', 'explainer', 'faceless']);
    expect(skillsOf('clip_33_collage_assemble')).toEqual(['default', 'explainer', 'faceless']);
    expect(skillsOf('clip_34_doodle_explain')).toEqual(['default', 'explainer']);
  });

  it('CLIP_01..26 allowlist lengths are unchanged: only the new ids were appended', () => {
    const native = (list: readonly string[]) => list.filter(id => MOTION_TEMPLATE_IDS.indexOf(id as never) < 26);
    expect(Object.fromEntries(Object.entries(SKILL_MOTION_TEMPLATE_ALLOWLIST).map(([k, v]) => [k, native(v).length]))).toEqual({faceless: 15, explainer: 21, textual_mg: 12, newsroom_mg: 19, default: 22});
    for (const list of Object.values(SKILL_MOTION_TEMPLATE_ALLOWLIST)) {
      const firstNew = list.findIndex(id => MOTION_TEMPLATE_IDS.indexOf(id) >= 26);
      if (firstNew >= 0) expect(list.slice(firstNew).every(id => MOTION_TEMPLATE_IDS.indexOf(id) >= 26)).toBe(true);
    }
  });

  it('adds no edit-toolkit ids (riso / collage / doodle / anidoodle)', () => {
    for (const id of ['riso', 'collage', 'doodle', 'anidoodle']) expect(EDIT_TOOLKITS.map(t => t.id as string)).not.toContain(id);
  });

  it('the native motion-template planner never falls back onto a backend row', () => {
    const text = 'Here is the product gallery with photos and the sale countdown and a notification message then proof';
    const result = planMotionTemplateBeats({skill: 'explainer', durationSec: 40, words: wordsOf(text, 1, 0.5)});
    for (const beat of result.beats) expect(Number(beat.templateId.slice(5, 7))).toBeLessThanOrEqual(26);
  });

  it('resolvePolishSkill priority is unchanged', () => {
    expect(resolvePolishSkill({faceless: true, explainer: true, newsroom: true}).skill).toBe('faceless');
    expect(resolvePolishSkill({faceless: false, explainer: true, newsroom: true}).skill).toBe('newsroom_mg');
    expect(resolvePolishSkill({faceless: false, explainer: true}).skill).toBe('explainer');
    expect(resolvePolishSkill({faceless: false, explainer: false}).skill).toBe('default');
    expect(readFileSync(join(here, 'explainerPacing.ts'), 'utf8')).not.toMatch(/riso|collage|anidoodle/i);
  });
});

describe('WP53 planner', () => {
  it('flags off -> no beats', () => {
    const result = planVisualBackendBeats({skill: 'explainer', durationSec: 30, words: wordsOf("I've helped over 200 people launch"), flags: {riso: false, collage: false, anidoodle: false}});
    expect(result.beats).toEqual([]);
    expect(result.warnings).toContain('visual_backend:skipped:flag_off');
  });

  it("\"I've helped over 200 people\" -> clip_27 with onScreen number 200 and no double emphasis", () => {
    const result = plan("I've helped over 200 people launch");
    expect(result.beats).toHaveLength(1);
    const beat = result.beats[0]!;
    expect(beat.templateId).toBe('clip_27_riso_number');
    expect(beat.scene.toolkit).toBe('counter');
    expect(beat.scene.numbers).toEqual([{label: 'people', value: 200, unit: 'people'}]);
    expect(beat.scene.onScreenText).toContain('people');
    expect((beat.payload as RisoPayload).data.number).toBe(200);
    expect(beat.muteCaptions).toBe(true);
    expect(beat.end - beat.start).toBeGreaterThanOrEqual(2.4);
    expect(beat.end - beat.start).toBeLessThanOrEqual(6.5);
    expect(validateSceneSpec(beat.scene).ok).toBe(true);
    const emphasis = [
      {start: 1.5, end: 2.2, text: '200', treatment: 'count'},
      {start: 1.5, end: 2.2, text: 'launch', treatment: 'pop'},
    ];
    const dropped = dropEmphasisCoveredByVisualBackend(emphasis, result.beats);
    expect(dropped.kept.map(e => e.text)).toEqual(['launch']);
    expect(dropped.warnings).toEqual(['visual_backend:emphasis_dropped:200']);
  });

  it('myth / fact -> clip_28 with both lines as substrings of the sentence', () => {
    const sentence = 'Most people think you need a big team, actually you need one good editor.';
    const result = plan(sentence);
    expect(result.beats).toHaveLength(1);
    const beat = result.beats[0]!;
    expect(beat.templateId).toBe('clip_28_riso_versus');
    const data = (beat.payload as RisoPayload).data as {before: {text: string}; after: {text: string}};
    expect(data.before.text).toBe('you need a big team');
    expect(data.after.text).toBe('you need one good editor');
    expect(sentence).toContain(data.before.text);
    expect(sentence).toContain(data.after.text);
  });

  it('two comparable quantities with a before / now cue -> clip_29 (not clip_28)', () => {
    const result = plan('It used to take 40 minutes, now it takes 2 minutes');
    expect(result.beats.map(b => b.templateId)).toEqual(['clip_29_riso_compare']);
    const data = (result.beats[0]!.payload as RisoPayload).data as {before: {base: number}; after: {base: number}};
    expect(data.before.base).toBe(2400);
    expect(data.after.base).toBe(120);
  });

  it('many -> few -> clip_30, chapter -> clip_32', () => {
    expect(plan('We cut it from 30 tools to 4 categories').beats.map(b => b.templateId)).toEqual(['clip_30_riso_converge']);
    const chapter = plan('Part one: the offer that sells');
    expect(chapter.beats.map(b => b.templateId)).toEqual(['clip_32_riso_chapter']);
    expect(((chapter.beats[0]!.payload as RisoPayload).data as {index: string}).index).toBe('01');
  });

  it('a number that is not in the transcript is ungrounded and rejected', () => {
    const result = plan("I've helped over 200 people launch");
    const bad = {...result.beats[0]!.scene, numbers: [{label: 'people', value: 500, unit: 'people'}]};
    const check = validateSceneSpec(bad);
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.warning).toBe('visual_backend:ungrounded');
    expect(validateSceneSpec({...result.beats[0]!.scene, onScreenText: ['a million followers']}).ok).toBe(false);
    // case / punctuation are normalised
    expect(validateSceneSpec({...result.beats[0]!.scene, onScreenText: ["I'VE helped, over"]}).ok).toBe(true);
  });

  it('a blocked range over the sentence -> no beat', () => {
    const result = plan("I've helped over 200 people launch", {blockedRanges: [{start: 0, end: 10}]});
    expect(result.beats).toEqual([]);
  });

  it('faceless (no clip_27 in its allowlist) plans no stat beat', () => {
    expect(plan("I've helped over 200 people launch", {skill: 'faceless'}).beats).toEqual([]);
  });

  it('quote: a conclusion near the end becomes clip_31 at most once; a news / tweet line stays with WP52', () => {
    const words = [...wordsOf('We tested this for a long time.', 1), ...wordsOf('So never start from a blank page.', 26)];
    const result = planVisualBackendBeats({skill: 'explainer', durationSec: 32, words, flags: RISO_ON});
    expect(result.beats.map(b => b.templateId)).toEqual(['clip_31_riso_quote']);
    const news = [...wordsOf('We tested this for a long time.', 1), ...wordsOf('Breaking news the founders just shut down the whole company today.', 22)];
    const refused = planVisualBackendBeats({skill: 'explainer', durationSec: 32, words: news, flags: RISO_ON});
    expect(refused.beats.map(b => b.templateId)).not.toContain('clip_31_riso_quote');
    // never over a second quote
    const twice = planVisualBackendBeats({skill: 'explainer', durationSec: 60, words: [...wordsOf('So never start from a blank page.', 40), ...wordsOf('So remember to always ship the draft.', 50)], flags: RISO_ON});
    expect(twice.beats.filter(b => b.templateId === 'clip_31_riso_quote').length).toBeLessThanOrEqual(1);
  });

  it('caps: at most two riso beats, never overlapping, never the same template twice', () => {
    const words = [
      ...wordsOf("I've helped over 200 people launch.", 1),
      ...wordsOf('Most people think you need a big team, actually you need one editor.', 10),
      ...wordsOf('It used to take 40 minutes, now it takes 2 minutes.', 20),
      ...wordsOf('We cut it from 30 tools to 4 categories.', 30),
    ];
    const result = planVisualBackendBeats({skill: 'explainer', durationSec: 45, words, flags: RISO_ON});
    expect(result.beats.length).toBeLessThanOrEqual(2);
    expect(new Set(result.beats.map(b => b.templateId)).size).toBe(result.beats.length);
    for (const [i, a] of result.beats.entries()) for (const b of result.beats.slice(i + 1)) expect(a.end <= b.start || b.end <= a.start).toBe(true);
  });

  it('collage: metaphor sentence plans one 5 s clip_33; doodle never double-covers it', () => {
    const sentence = 'Your audience is like a bridge between you and the product';
    const both = planVisualBackendBeats({skill: 'explainer', durationSec: 30, words: wordsOf(sentence), flags: {riso: false, collage: true, anidoodle: true}, anidoodleConfigured: true});
    expect(both.beats.map(b => b.templateId)).toEqual(['clip_33_collage_assemble']);
    const beat = both.beats[0]!;
    expect(beat.end - beat.start).toBeCloseTo(5, 5);
    expect(beat.scene.width).toBe(720);
    expect(beat.scene.height).toBe(1280);
    expect(beat.scene.onScreenText).toEqual([]);
  });

  it('doodle: only an unnumbered mechanism sentence, only when configured and the collage flag is off', () => {
    const sentence = 'Here is how it works inside the engine';
    const on = planVisualBackendBeats({skill: 'explainer', durationSec: 30, words: wordsOf(sentence), flags: {riso: false, collage: false, anidoodle: true}, anidoodleConfigured: true});
    expect(on.beats.map(b => b.templateId)).toEqual(['clip_34_doodle_explain']);
    expect((on.beats[0]!.payload as {style: string}).style).toBe('cut-paper');
    // WP54: no engine root no longer skips — the native DoodleDrawOn draws the beat
    const off = planVisualBackendBeats({skill: 'explainer', durationSec: 30, words: wordsOf(sentence), flags: {riso: false, collage: false, anidoodle: true}, anidoodleConfigured: false});
    expect(off.beats.map(b => b.templateId)).toEqual(['clip_34_doodle_explain']);
    expect(off.warnings).toContain('visual_backend:anidoodle:engine_unconfigured');
    expect(plan('Here is how it works with 3 parts', {flags: {riso: false, collage: false, anidoodle: true}, anidoodleConfigured: true}).beats).toEqual([]);
  });

  it('the doodle style allowlist is the professional eight; never ballpoint / embroidery / oil', () => {
    expect([...DOODLE_STYLE_ALLOWLIST]).toEqual(['cut-paper', 'pencil-watercolor', 'isometric', 'risograph', 'marker-comic', 'pixel', 'chalkboard', 'cyanotype']);
    expect(safeDoodleStyle('ballpoint')).toBe('cut-paper');
    expect(safeDoodleStyle('chalkboard')).toBe('chalkboard');
  });

  it('palette maps by mood: newsroom red stays red, never hardcoded pink', () => {
    expect(mapPaletteToRiso('#D62828', '#111111')).toBe('pal-red');
    expect(mapPaletteToRiso('#BFFF00', '#FFFFFF')).toBe('pal-teal');
    expect(mapPaletteToRiso('#2F6BFF', '#FFFFFF')).toBe('pal-blue');
    expect(mapPaletteToRiso('#888888', '#111111')).toBe('pal-ink');
    const beat = plan("I've helped over 200 people launch", {accent: '#D62828', ground: '#111111'}).beats[0]!;
    expect((beat.payload as RisoPayload).palette).toBe('pal-red');
    expect(((beat.payload as RisoPayload).data as {palette: string}).palette).toBe('pal-red');
  });
});

describe('WP53 adapters + stage (no Chrome / Gemini / R2)', () => {
  it('riso: builds a composition whose DATA block is the grounded DATA (when the vendor tree is present)', () => {
    const root = resolveRisoRoot();
    const beat = plan("I've helped over 200 people launch").beats[0]!;
    expect(risoCacheKey(beat)).toMatch(/^[0-9a-f]{24}$/);
    expect(risoCacheKey(beat)).toBe(risoCacheKey(plan("I've helped over 200 people launch").beats[0]!));
    if (!root) return; // vendor tree is gitignored; scripts/vendor-eian-riso.sh installs it
    const html = buildRisoCompositionHtml(root, beat.payload as RisoPayload);
    expect(html).toContain('"number": 200');
    expect(html).toContain('"unit": "people"');
    expect(html).not.toContain('处信息');
  });

  it('native fallbacks exist for number and quote only where the library composition resolves', () => {
    const number = plan("I've helped over 200 people launch").beats[0]!;
    expect(nativeFallbackFor(number)?.composition).toBe('StatHighlight');
    // WP54: converge now maps onto StackedCardDeck (many -> few card stack)
    const converge = plan('We cut it from 30 tools to 4 categories').beats[0]!;
    expect(nativeFallbackFor(converge)?.composition).toBe('StackedCardDeck');
  });

  const fakePublisher = (async (brief: {id: string; content: Record<string, unknown>; placement?: string}) => ({
    id: brief.id,
    module: {url: `https://cdn.invalid/${brief.id}.js`, sha256: 'a'.repeat(64)},
    placement: {mode: brief.placement ?? 'full_screen'},
    props: {content: brief.content},
    brief: {purpose: 'p', visualIntent: 'v'},
  })) as unknown as Parameters<typeof runVisualBackendStage>[0]['publish'] extends infer P ? (P extends {publisher?: infer F} ? NonNullable<F> : never) : never;

  it('stage: publishes a riso beat as a silent full-screen graphic with backend / scene / empty assetUrl, and mutes captions', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'wp53-cache-'));
    const result = await runVisualBackendStage({polishSkill: 'explainer', words: wordsOf("I've helped over 200 people launch"), durationSec: 30, flags: RISO_ON, cacheDir, risoRoot: join(cacheDir, 'missing'), publish: {publisher: fakePublisher}});
    expect(result.graphics).toHaveLength(1);
    const props = result.graphics[0]!.props as {backend: string; scene: {templateId: string}; assetUrl: string};
    expect(props.backend).toBe('native'); // no Chrome in CI: native fallback picture
    expect(props.scene.templateId).toBe('clip_27_riso_number');
    expect(props.assetUrl).toBe('');
    expect(result.graphics[0]!.placement.mode).toBe('full_screen');
    expect(result.muteRanges).toHaveLength(1);
    expect(result.warnings).toEqual(expect.arrayContaining(['visual_backend:beats:1', 'visual_backend:riso:number']));
    expect(readdirSync(cacheDir)).toEqual([]); // analyze path renders nothing
  });

  it('stage (WP54): converge is no longer dropped — it publishes the StackedCardDeck fallback', async () => {
    const result = await runVisualBackendStage({polishSkill: 'explainer', words: wordsOf('We cut it from 30 tools to 4 categories'), durationSec: 30, flags: RISO_ON, publish: {publisher: fakePublisher}});
    expect(result.graphics).toHaveLength(1);
    expect(result.warnings).not.toContain('visual_backend:dropped:clip_30_riso_converge:no_fallback');
  });

  it('collage flag on without GEMINI: deferred, zero mp4, zero overlays', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'wp53-collage-'));
    expect(collageRenderEnabled({COLLAGE_RENDER: '1'} as NodeJS.ProcessEnv)).toBe(false);
    expect(collageRenderEnabled({GEMINI_API_KEY: 'k'} as NodeJS.ProcessEnv)).toBe(false);
    const result = await runVisualBackendStage({
      polishSkill: 'explainer',
      words: wordsOf('Your audience is like a bridge between you and the product'),
      durationSec: 30,
      flags: {riso: false, collage: true, anidoodle: false},
      cacheDir,
      publish: {publisher: fakePublisher},
    });
    expect(result.warnings).toContain('visual_backend:collage:deferred');
    expect(result.graphics).toEqual([]);
    expect(result.muteRanges).toEqual([]);
    const files = readdirSync(cacheDir);
    expect(files.filter(f => f.endsWith('.mp4'))).toEqual([]);
    const spec = JSON.parse(readFileSync(join(cacheDir, files.find(f => f.endsWith('.collage.json'))!), 'utf8'));
    expect(spec).toMatchObject({assemble: 'from_empty', durationSec: 5, silent: true, width: 720, height: 1280});
    const planned = planVisualBackendBeats({skill: 'explainer', durationSec: 30, words: wordsOf('Your audience is like a bridge between you and the product'), flags: {riso: false, collage: true, anidoodle: false}}).beats[0]!;
    expect(prepareCollage(planned, {cacheDir})).toMatchObject({ok: false, reason: 'collage:deferred'});
  });

  it('anidoodle unconfigured -> engine skipped, but the native DoodleDrawOn publishes (WP54)', async () => {
    expect(prepareAnidoodle({flagOn: true, root: ''})).toEqual({ok: false, reason: 'anidoodle:unconfigured'});
    expect(prepareAnidoodle({flagOn: false, root: '/x'}).reason).toBe('anidoodle:flag_off');
    expect(anidoodleRenderArgs('/root', 'film.json', 'out.mp4')).toEqual(['/root/tools/render.mjs', 'film.json', '--out', 'out.mp4']);
    const result = await runVisualBackendStage({polishSkill: 'explainer', words: wordsOf('Here is how it works inside the engine'), durationSec: 30, flags: {riso: false, collage: false, anidoodle: true}, anidoodleRoot: '', publish: {publisher: fakePublisher}});
    expect(result.graphics).toHaveLength(1);
    expect((result.graphics[0]!.props as {backend: string; doodleStyle: string}).doodleStyle).toBe('cut-paper');
    expect(result.warnings).toEqual(expect.arrayContaining(['visual_backend:anidoodle:engine_unconfigured', 'visual_backend:anidoodle:native_doodle']));
  });

  it('analyzeVideo wiring: flag-gated, planned before the WP45 templates, mute merged, no SFX, no R2 for the mp4', () => {
    const analyze = readFileSync(join(here, '../../pipeline/analyzeVideo.ts'), 'utf8');
    expect(analyze.match(/runVisualBackendStage\(/g)).toHaveLength(1);
    expect(analyze).toMatch(/if \(polishPath && \(visualBackendFlags\.riso \|\| visualBackendFlags\.collage \|\| visualBackendFlags\.anidoodle\)\)/);
    expect(analyze.indexOf('runVisualBackendStage(')).toBeLessThan(analyze.indexOf('runMotionTemplateStage('));
    expect(analyze).toMatch(/\.\.\.motionTemplateMute, \.\.\.visualBackendMute\]/);
    const stage = readFileSync(join(here, 'visualBackend/visualBackendStage.ts'), 'utf8');
    expect(stage).not.toMatch(/sfxHit|playSfx|audio:/i);
    for (const file of ['risoAdapter.ts', 'collageAdapter.ts', 'anidoodleAdapter.ts', 'planVisualBackendBeats.ts', 'sceneSpec.ts']) {
      const source = readFileSync(join(here, 'visualBackend', file), 'utf8');
      expect(existsSync(join(here, 'visualBackend', file))).toBe(true);
      expect(source).not.toMatch(/AIza|sk-[A-Za-z0-9]{20}/);
    }
    expect(readFileSync(join(repo, '.gitignore'), 'utf8')).toContain('vendor/eian-riso-broll/');
  });
});
