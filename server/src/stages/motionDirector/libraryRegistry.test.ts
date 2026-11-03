/**
 * WP8D tests: the library registry (pure), every composition's generated module through the worker's real validation (typecheck + compile, no render), the library-first delivery in
 * buildGeneratedGraphics with a generator that fails the test if it is called, and source-text pins for the wiring and the economy defaults. No network, no model call, no Chromium.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {validateGraphicSource, type GenerateRequest, type GenerateResponse} from '../../motionWorker/worker.ts';
import {ELEMENT_KINDS} from '../directorV2/schemas.ts';
import {EDIT_LOOK_IDS} from '../directorV2/editLooks.ts';
import {buildGeneratedGraphics} from './buildGeneratedGraphics.ts';
import {LIBRARY_COMPOSITION_IDS, LIBRARY_COMPOSITIONS, libraryGraphicSource, resolveLibraryGraphic, type LibraryBriefInput} from './libraryRegistry.ts';

const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const REPO = resolve(SERVER, '..');
const read = (...parts: string[]) => readFileSync(resolve(REPO, ...parts), 'utf8');
const brief = (content: Record<string, unknown>, extra: Partial<LibraryBriefInput> = {}): LibraryBriefInput => ({goal: 'g', visualDescription: 'v', placement: 'full_screen', content, ...extra});

describe('the registry table', () => {
  it('has sixty-six unique compositions whose looks and stand-in kinds are real', () => {
    expect(LIBRARY_COMPOSITION_IDS).toHaveLength(66);
    expect(new Set(LIBRARY_COMPOSITION_IDS).size).toBe(66);
    for (const entry of LIBRARY_COMPOSITIONS) {
      expect(entry.propSchema.length, entry.id).toBeGreaterThan(5);
      for (const look of entry.looks) expect(EDIT_LOOK_IDS, `${entry.id}:${look}`).toContain(look);
      for (const kind of entry.kinds) expect(ELEMENT_KINDS as readonly string[], `${entry.id}:${kind}`).toContain(kind);
    }
  });
  it('every registered composition is exported by the toolkit and is in the compositions map', () => {
    const index = read('remotion/src/motion/index.ts');
    for (const id of LIBRARY_COMPOSITION_IDS) {
      expect(index, id).toMatch(new RegExp(`export \\{${id}\\b`));
      expect(index, id).toMatch(new RegExp(`export const compositions = \\{[^}]*\\b${id}\\b`));
    }
    expect(index).toContain('BrandLockupBar');
  });
  it('the toolkit README documents each new composition (Claude reads it when it does generate)', () => {
    const readme = read('remotion/src/motion/README.md');
    for (const id of ['BigKineticHeadline', 'TopicPills', 'VsClaim', 'FullscreenStatement', 'BrandLockupBar', 'StampTitle', 'TweetCard']) expect(readme).toContain(`| \`${id}\` |`);
  });
});

describe('resolveLibraryGraphic: hits', () => {
  it('number + label -> StatHighlight, with the count props kept and no copy changed', () => {
    const hit = resolveLibraryGraphic(brief({label: 'Revenue', from: 2, to: 10, prefix: '$', suffix: 'M'}))!;
    expect(hit.compositionId).toBe('StatHighlight');
    expect(hit.props).toEqual({value: {from: 2, to: 10, prefix: '$', suffix: 'M'}, label: 'Revenue', background: true});
    expect(resolveLibraryGraphic(brief({value: 85, label: 'Growth', sublabel: 'in a year'}))!.props).toMatchObject({value: {to: 85}, label: 'Growth', sublabel: 'in a year'});
    expect(resolveLibraryGraphic(brief({value: {to: 4.5, decimals: 1, suffix: '%'}, label: 'Rate'}))!.props.value).toEqual({to: 4.5, suffix: '%', decimals: 1});
  });
  it('steps -> ProcessSteps (strings or {label}), 2..6', () => {
    const hit = resolveLibraryGraphic(brief({title: '3 rules', steps: ['Control emotions', {label: 'Use nine hashtags'}, 'Nice transitions']}))!;
    expect(hit.compositionId).toBe('ProcessSteps');
    expect(hit.props).toMatchObject({steps: [{label: 'Control emotions'}, {label: 'Use nine hashtags'}, {label: 'Nice transitions'}], title: '3 rules', variant: 'steps'});
  });
  it('before + after -> BeforeAfter', () => {
    const hit = resolveLibraryGraphic(brief({before: {label: 'Before', value: '12h'}, after: {label: 'After', value: '2h'}, title: 'Editing time'}))!;
    expect(hit.compositionId).toBe('BeforeAfter');
    expect(hit.props).toMatchObject({before: {label: 'Before', value: '12h'}, after: {label: 'After', value: '2h'}, title: 'Editing time'});
  });
  it('labelled numbers -> ChartExplainer (bar when asked, else line)', () => {
    const data = [{label: 'Mon', value: 3}, {label: 'Tue', value: 7}];
    expect(resolveLibraryGraphic(brief({data}))!.props).toMatchObject({kind: 'line', data});
    expect(resolveLibraryGraphic(brief({data, kind: 'bar', title: 'Views'}))!.props).toMatchObject({kind: 'bar', title: 'Views'});
  });
  it('quote -> QuoteCallout with author and highlight', () => {
    const hit = resolveLibraryGraphic(brief({quote: 'Ship small, learn fast', author: 'Ada', highlight: ['learn fast']}))!;
    expect(hit.compositionId).toBe('QuoteCallout');
    expect(hit.props).toMatchObject({quote: 'Ship small, learn fast', author: 'Ada', highlight: ['learn fast']});
  });
  it('left + right -> VsClaim', () => {
    const hit = resolveLibraryGraphic(brief({left: 'NO CLUE', right: 'EXPERT', center: 'VS'}))!;
    expect(hit.compositionId).toBe('VsClaim');
    expect(hit.props).toMatchObject({left: 'NO CLUE', right: 'EXPERT', center: 'VS'});
  });
  it('lines or a headline -> BigKineticHeadline; a long headline splits at a word boundary, never truncated', () => {
    expect(resolveLibraryGraphic(brief({lines: ['Organic', 'WARMS', 'the audience'], accent: 'WARMS'}))!.props).toMatchObject({lines: [{text: 'Organic'}, {text: 'WARMS'}, {text: 'the audience'}], accent: 'WARMS'});
    const long = resolveLibraryGraphic(brief({headline: 'Organic warms the audience before the pitch'}))!;
    expect(long.compositionId).toBe('BigKineticHeadline');
    expect((long.props.lines as Array<{text: string}>).map(line => line.text).join(' ')).toBe('Organic warms the audience before the pitch');
  });
  it('items with a pill hint on an overlay -> TopicPills; the same items on a full-screen brief are a miss', () => {
    const items = ['Accountant', {label: 'Supply chain'}, 'Marketing'];
    const hit = resolveLibraryGraphic(brief({items}, {placement: 'overlay', visualDescription: 'floating topic pills one after another'}))!;
    expect(hit.compositionId).toBe('TopicPills');
    expect(hit.props).toEqual({items: [{label: 'Accountant'}, {label: 'Supply chain'}, {label: 'Marketing'}]});
    expect(resolveLibraryGraphic(brief({items}, {placement: 'full_screen', visualDescription: 'topic pills'}))).toBeNull();
    expect(resolveLibraryGraphic(brief({items}, {placement: 'overlay', visualDescription: 'a nice list'}))).toBeNull();
  });
  it('a statement (or text on a full-screen brief) -> FullscreenStatement; text on an overlay is a miss', () => {
    expect(resolveLibraryGraphic(brief({statement: 'Nobody reads a feature list', sublabel: 'they feel a story'}))!.compositionId).toBe('FullscreenStatement');
    expect(resolveLibraryGraphic(brief({text: 'One take, no excuses'}))!.props).toMatchObject({statement: 'One take, no excuses', background: true});
    expect(resolveLibraryGraphic(brief({text: 'One take, no excuses'}, {placement: 'overlay'}))).toBeNull();
  });
  it('brand + lockup hint on an overlay -> BrandLockupBar', () => {
    const hit = resolveLibraryGraphic(brief({brand: 'FINALPOST', tagline: 'cut clean'}, {placement: 'overlay', goal: 'a brand lockup'}))!;
    expect(hit.compositionId).toBe('BrandLockupBar');
    expect(hit.props).toEqual({name: 'FINALPOST', tagline: 'cut clean'});
    expect(resolveLibraryGraphic(brief({brand: 'FINALPOST'}, {placement: 'overlay', goal: 'a number'}))).toBeNull();
  });
  it('background follows the placement: opaque for full_screen / split_screen, transparent for overlay / pip', () => {
    for (const [placement, expected] of [['full_screen', true], ['split_screen', true], ['overlay', false], ['pip', false]] as const) {
      expect(resolveLibraryGraphic(brief({quote: 'Hello there'}, {placement}))!.props.background, placement).toBe(expected);
    }
  });
});

describe('resolveLibraryGraphic: misses (these go to the Claude path)', () => {
  it('empty or unusable content, unknown shapes and a missing label', () => {
    expect(resolveLibraryGraphic(brief({}))).toBeNull();
    expect(resolveLibraryGraphic({goal: 'x', visualDescription: 'y', placement: 'overlay'})).toBeNull();
    expect(resolveLibraryGraphic(brief({color: 'red', mood: 'calm'}))).toBeNull();
    expect(resolveLibraryGraphic(brief({value: 10}))).toBeNull(); // a number without a label
    expect(resolveLibraryGraphic(brief({steps: ['only one']}))).toBeNull();
    expect(resolveLibraryGraphic(brief({value: Number.NaN, label: 'x'}))).toBeNull();
  });
  it('a text-treatment brief is never delivered by a fixed composition', () => {
    expect(resolveLibraryGraphic(brief({statement: 'Behind you'}, {textTreatment: {kind: 'behind_subject', text: 'Behind you'}}))).toBeNull();
  });
  it('copy is never truncated: a string over the composition limit makes the brief a miss', () => {
    expect(resolveLibraryGraphic(brief({quote: 'x'.repeat(300)}))).toBeNull();
    expect(resolveLibraryGraphic(brief({left: 'a'.repeat(200), right: 'b'}))).toBeNull();
    expect(resolveLibraryGraphic(brief({lines: ['y'.repeat(60)]}))).toBeNull();
    expect(resolveLibraryGraphic(brief({label: 'z'.repeat(200), value: 5}))).toBeNull();
  });
  it('is deterministic, does not mutate its input, and never returns copy that is not in the content', () => {
    const input = brief({quote: 'Ship small', author: 'Ada'});
    const before = JSON.stringify(input);
    expect(JSON.stringify(resolveLibraryGraphic(input))).toBe(JSON.stringify(resolveLibraryGraphic(input)));
    expect(JSON.stringify(input)).toBe(before);
    const strings = JSON.stringify(resolveLibraryGraphic(input)!.props).match(/"([^"]+)"/g)!.map(item => item.slice(1, -1));
    const allowed = new Set(['quote', 'author', 'background', 'Ship small', 'Ada']);
    for (const value of strings) expect(allowed.has(value), value).toBe(true);
  });
  it('the module is pure: no env, logger, network or file access', () => {
    const module_ = read('server/src/stages/motionDirector/libraryRegistry.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(module_).not.toMatch(/^import /m);
    for (const word of ['process.env', 'fetch(', 'logger', 'readFile', 'requestJson']) expect(module_).not.toContain(word);
  });
});

const SAMPLES: Array<[string, Record<string, unknown>, Partial<LibraryBriefInput>]> = [
  ['StatHighlight', {label: 'Revenue', from: 2, to: 10}, {}],
  ['ProcessSteps', {steps: ['Plan', 'Shoot', 'Cut']}, {}],
  ['BeforeAfter', {before: {label: 'Before'}, after: {label: 'After'}}, {}],
  ['ChartExplainer', {data: [{label: 'A', value: 1}, {label: 'B', value: 2}]}, {}],
  ['QuoteCallout', {quote: 'Ship small', author: 'Ada'}, {}],
  ['VsClaim', {left: 'NO CLUE', right: 'EXPERT'}, {}],
  ['BigKineticHeadline', {lines: ['Organic', 'WARMS'], accent: 'WARMS'}, {}],
  ['TopicPills', {items: ['Accountant', 'Supply chain']}, {placement: 'overlay', visualDescription: 'floating pills'}],
  ['FullscreenStatement', {statement: 'One take', sublabel: 'no excuses'}, {}],
  ['BrandLockupBar', {brand: 'FINALPOST'}, {placement: 'overlay', goal: 'brand lockup'}],
  ['StampTitle', {stamp: '02 \u2014', title: 'Market size', subtitle: 'it keeps growing'}, {}],
  ['TweetCard', {body: 'Ship small things every single day', name: 'Ada', handle: '@ada', highlight: ['every single day']}, {}],
];

describe('every composition\'s generated module passes the worker\'s real validation (contract, typecheck, compile)', () => {
  it.each(SAMPLES)('%s', async (id, content, extra) => {
    const hit = resolveLibraryGraphic(brief(content, extra))!;
    expect(hit.compositionId).toBe(id);
    const source = libraryGraphicSource(hit);
    expect(source).toContain(`import {${id}, type GraphicProps} from '@finalpost/motion';`);
    const {report, compiled} = await validateGraphicSource(source);
    expect(report).toEqual({safety: [], typecheck: [], compile: [], runtime: []});
    expect(compiled?.bytes).toBeGreaterThan(0);
  }, 60_000);
});

const motionBrief = (id: string, content: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id,
  goal: 'goal',
  visualDescription: 'visual',
  placement: 'full_screen',
  durationSeconds: 3,
  content,
  ...extra,
});
const zero = {inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0};

describe('buildGeneratedGraphics: library first, Claude only as the fallback', () => {
  const uploads: string[] = [];
  const upload = async (_code: string, sha: string) => {
    uploads.push(sha);
    return `https://cdn.example/${sha}.js`;
  };
  const directed = (brief: ReturnType<typeof motionBrief>, start = 1) => ({brief: brief as never, start, end: start + 3, reason: 'r'});

  it('with preferLibrary, a fitting brief is delivered with NO generator call, zero Claude cost and library provenance', async () => {
    const calls: GenerateRequest[] = [];
    const generator = async (request: GenerateRequest): Promise<GenerateResponse> => {
      calls.push(request);
      throw new Error('the generator must not be called for a library brief');
    };
    const outcome = await buildGeneratedGraphics([directed(motionBrief('quote_1', {quote: 'Ship small', author: 'Ada'})), directed(motionBrief('vs_1', {left: 'NO CLUE', right: 'EXPERT'}), 5)], {generator, upload, runtimeCheck: false, preferLibrary: true});
    expect(calls).toEqual([]);
    expect(outcome.failures).toEqual([]);
    expect(outcome.generatedGraphics.map(graphic => graphic.id)).toEqual(['quote_1', 'vs_1']);
    expect(outcome.claudeCostUsd).toBe(0);
    expect(outcome.ledger).toEqual([]);
    expect(outcome.provenance).toEqual([{id: 'quote_1', source: 'library', compositionId: 'QuoteCallout'}, {id: 'vs_1', source: 'library', compositionId: 'VsClaim'}]);
    for (const graphic of outcome.generatedGraphics) expect(graphic.module.url).toMatch(/^https:\/\/cdn\.example\/[0-9a-f]+\.js$/);
    expect(outcome.results.every(result => result.model === null && result.attempts.length === 0 && result.costUsd === 0)).toBe(true);
  }, 90_000);

  it('a brief that does not fit falls back to the generator (called), and is recorded as a failure when the reply has no code', async () => {
    const calls: GenerateRequest[] = [];
    const generator = async (request: GenerateRequest): Promise<GenerateResponse> => {
      calls.push(request);
      return {text: 'Sorry, no code.', stopReason: 'end_turn', model: 'claude-sonnet-5-5', usage: zero};
    };
    const outcome = await buildGeneratedGraphics([directed(motionBrief('odd_1', {mood: 'calm', palette: 'warm'}))], {generator, upload, runtimeCheck: false, preferLibrary: true, maxRepairAttempts: 0});
    expect(calls).toHaveLength(1);
    expect(outcome.provenance).toEqual([]);
    expect(outcome.failures.map(failure => failure.id)).toEqual(['odd_1']);
  }, 60_000);

  it('without preferLibrary (every other profile) a fitting brief still goes to the generator: nothing changes', async () => {
    const calls: GenerateRequest[] = [];
    const generator = async (request: GenerateRequest): Promise<GenerateResponse> => {
      calls.push(request);
      return {text: 'Sorry, no code.', stopReason: 'end_turn', model: 'claude-sonnet-5-5', usage: zero};
    };
    const outcome = await buildGeneratedGraphics([directed(motionBrief('quote_2', {quote: 'Ship small'}))], {generator, upload, runtimeCheck: false, maxRepairAttempts: 0});
    expect(calls).toHaveLength(1);
    expect(outcome.provenance).toEqual([]);
  }, 60_000);

  it('a library module that fails validation falls back to the generator instead of dropping the graphic (and the fallback is Claude provenance)', async () => {
    const calls: GenerateRequest[] = [];
    const generator = async (request: GenerateRequest): Promise<GenerateResponse> => {
      calls.push(request);
      return {text: 'Sorry, no code.', stopReason: 'end_turn', model: 'claude-sonnet-5-5', usage: zero};
    };
    const failingUpload = async () => {
      throw new Error('upload down');
    };
    const outcome = await buildGeneratedGraphics([directed(motionBrief('quote_3', {quote: 'Ship small'}))], {generator, upload: failingUpload, runtimeCheck: false, preferLibrary: true, maxRepairAttempts: 0});
    expect(calls).toHaveLength(1); // the library publish failed (upload), so the generator was tried
    expect(outcome.generatedGraphics).toEqual([]);
  }, 60_000);
});

describe('wiring and economy (source text)', () => {
  const analyze = read('server/src/pipeline/analyzeVideo.ts');
  const stage = read('server/src/stages/motionDirector/index.ts');
  const builder = read('server/src/stages/motionDirector/buildGeneratedGraphics.ts');
  it('only polish prefers the library; the flag is threaded to the builder; provenance warnings are pushed', () => {
    expect(analyze).toContain('preferLibrary: polishPath,');
    expect(analyze.match(/preferLibrary:/g)).toHaveLength(1);
    expect(stage).toContain('preferLibrary?: boolean;');
    expect(stage).toContain('preferLibrary: input.preferLibrary,');
    expect(stage).toContain("`motion_graphic:library:${item.compositionId}` : 'motion_graphic:claude'");
  });
  it('the library branch runs before the generator, returns on success and falls through on any failure', () => {
    expect(builder).toContain('if (options.preferLibrary) {');
    expect(builder.indexOf('if (options.preferLibrary) {')).toBeLessThan(builder.indexOf('outcome.result = await generateMotionGraphic('));
    expect(builder).toContain('publishGraphicSource(brief, libraryGraphicSource(hit)');
    expect(builder).toContain('outcome.library = hit.compositionId;\n          return;');
    expect(builder).toContain("log.warn({id: brief.id, composition: hit.compositionId, error}, 'library graphic failed validation; falling back to the generator');");
  });
  it('the economy defaults are unchanged: graphics off by default, the motion stage still needs the flag and the Claude bound, the profile default is cuts', () => {
    const env = read('server/src/config/env.ts');
    expect(env).toContain('MOTION_GRAPHICS_ENABLED: bool(false),');
    expect(env).toContain("PRODUCT_EDIT_PROFILE: str('cuts'),");
    expect(analyze).toContain('const motionGraphicsOn = motionGraphicsRequested && (claudeAllowed || libraryOnly);'); // WP8E: polish may run library-only without a Claude bound
    expect(analyze).toContain('if (motionGraphicsOn) {');
  });
});

describe('the new compositions (source text; typechecked by the remotion tsc)', () => {
  const files = ['BigKineticHeadline', 'TopicPills', 'VsClaim', 'FullscreenStatement', 'BrandLockupBar', 'StampTitle', 'TweetCard'];
  it.each(files)('%s is theme- and safe-area-aware, uses only the motion primitives, and touches no network or font URL', name => {
    const source = read(`remotion/src/motion/compositions/${name}.tsx`);
    expect(source).toContain('safeArea');
    expect(source).toContain('contentBox(width, height, safeArea');
    expect(source).toMatch(new RegExp(`export const ${name}: React\\.FC<`));
    for (const word of ['fetch(', 'http://', 'https://', 'useEffect', 'Date.now', 'Math.random', 'fontFamily:']) expect(source, word).not.toContain(word);
    for (const match of source.matchAll(/^import .* from '([^']+)'/gm)) expect(match[1]!.startsWith('../') || match[1] === 'react', match[1]).toBe(true);
  });
  it('overlay comps have no background of their own; opaque ones default to a background', () => {
    expect(read('remotion/src/motion/compositions/TopicPills.tsx')).not.toContain('<Background');
    expect(read('remotion/src/motion/compositions/BrandLockupBar.tsx')).not.toContain('<Background');
    expect(read('remotion/src/motion/compositions/BigKineticHeadline.tsx')).toContain('background = false');
    expect(read('remotion/src/motion/compositions/VsClaim.tsx')).toContain('background = true');
    expect(read('remotion/src/motion/compositions/FullscreenStatement.tsx')).toContain('background = true');
  });
});
