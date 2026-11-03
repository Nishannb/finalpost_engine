/**
 * WP9F: richer explain plates (steps, before / after, chart, stat, contrast) from the full library vocabulary, structured grounded Claude briefs, library first. Mock generator only. Pure: no model, no network, no render.
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {remapLookForUnusableMatte, resolveEditLook} from '../directorV2/editLooks.ts';
import {plateShapeAt, seedLibraryGraphics} from '../motionDirector/transcriptLibrarySeed.ts';
import {isGroundedInTranscript} from './groundedText.ts';
import {buildClaudePlateBriefs, detectExplainPlateGaps, MAX_CLAUDE_PLATES} from './explainPlateGaps.ts';
import {runClaudeExplainPlates} from '../motionDirector/claudePlates.ts';
import {resolveLibraryGraphic} from '../motionDirector/libraryRegistry.ts';
import type {MotionDirectorResult} from '../motionDirector/motionDirector.ts';
import type {WordToken} from '../../types/blueprint.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const SENTENCES = [
  'Most teams choose between speed and quality every single week.',
  'First write the plan then ship the work finally review the results.',
  'Roughly 85 percent of projects slip without a clear owner.',
  'We went from slow launches to weekly releases.',
  'We shipped 40 features in spring and 12 bugs in summer.',
  'Clarity beats effort when the goal is unclear to everyone.',
  'Write the plan down and share it with your whole team.',
  'Then keep the standard high and ship it anyway today.',
  'Start building something real with these tools right now.',
];
const WORDS: WordToken[] = SENTENCES.flatMap((sentence, index) => {
  const tokens = sentence.split(' ');
  const slot = 3.5 / tokens.length;
  return tokens.map((text, i) => ({text, start: Math.round((index * 4 + i * slot) * 1000) / 1000, end: Math.round((index * 4 + (i + 1) * slot) * 1000) / 1000}));
});
const DURATION = 36;
const transcript = WORDS.map(word => word.text).join(' ');
const remapped = remapLookForUnusableMatte(resolveEditLook('talking_head'), false).resolution.look;
const strings = (node: unknown, out: string[] = []): string[] => {
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) node.forEach(item => strings(item, out));
  else if (node && typeof node === 'object') Object.entries(node).filter(([key]) => key !== 'recipeId').map(([, item]) => item).forEach(item => strings(item, out));
  return out;
};
const NEW_SHAPES = new Set(['ProcessSteps', 'BeforeAfter', 'ChartExplainer']);
const seedInput = {words: WORDS, outputDurationSec: DURATION, lookId: remapped.id, explainPlates: true};
const usage = {inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0};
const upload = async (_code: string, sha: string) => `https://cdn.example/${sha}.js`;
const emptyDirector: MotionDirectorResult = {graphics: [], refusals: [], notes: '', costUsd: 0, model: 'x', latencyMs: 0, raw: null};
const edit = {brollClips: [], visualOverlays: [], motionGraphics: [], mediaContainers: [], hookTitle: '', hookStartSec: 0, hookDurationSec: 0, insetReveals: [], depthOverlays: [], semanticEmphasis: [], frameInsets: []} as never;

describe('WP9F explain-plate seed variety', () => {
  const seed = seedLibraryGraphics(seedInput);
  const comps = Object.values(seed.compositions);
  it('a 36 s list + contrast + stat + before/after + chart fixture yields >= 3 distinct compositions, including a new shape', () => {
    expect(new Set(comps).size).toBeGreaterThanOrEqual(3);
    expect(comps.some(id => NEW_SHAPES.has(id))).toBe(true);
    expect(seed.raw.graphics.length).toBeLessThanOrEqual(seed.limit);
  });
  it('the new shapes are gated on explainPlates (standard seeding is unchanged)', () => {
    const standard = Object.values(seedLibraryGraphics({...seedInput, explainPlates: false}).compositions);
    expect(standard.some(id => NEW_SHAPES.has(id))).toBe(false);
  });
  it('each detector on its own sentence: steps (inline cues), stat, contrast, before/after, chart', () => {
    const at = (index: number) => plateShapeAt(WORDS, index * 4 + 0.2);
    expect(at(0)).toMatchObject({composition: 'VsClaim', content: {left: 'speed'}});
    expect((at(0)!.content.right as string).startsWith('quality')).toBe(true);
    expect(at(1)?.composition).not.toBe('ProcessSteps'); // WP29: the steps detector still exists, but a stepper is demoted off the polish path
    expect(at(2)).toMatchObject({composition: 'StatHighlight'});
    expect(at(3)).toMatchObject({composition: 'BeforeAfter', content: {before: {label: 'slow launches'}, after: {label: 'weekly releases'}}});
    expect(at(4)).toMatchObject({composition: 'ChartExplainer'});
    expect((at(4)!.content.data as Array<{label: string; value: number}>).map(row => row.value)).toEqual([40, 12]);
    expect(at(8)).toBeNull();
  });
  it('steps across sentences (First ... / Second ... / Finally ...) are NOT turned into a ProcessSteps stepper (WP29)', () => {
    const lines = ['First write the plan down.', 'Second ship the work.', 'Finally review the results together.'];
    const words = lines.flatMap((line, index) => line.split(' ').map((text, i) => ({text, start: index * 3 + i * 0.4, end: index * 3 + i * 0.4 + 0.35})));
    const shape = plateShapeAt(words, 0.2);
    expect(shape?.composition).not.toBe('ProcessSteps'); // WP29: demoted (no stepper for ordered cues on polish)
    expect(shape?.content.steps).toBeUndefined();
  });
  it('every seed string is a spoken run and the registry accepts the seed as a library hit of the same composition', () => {
    for (const graphic of seed.raw.graphics) {
      const content = JSON.parse(graphic.contentJson);
      for (const text of strings(content)) expect(isGroundedInTranscript(text, transcript), text).toBe(true);
      const hit = resolveLibraryGraphic({goal: graphic.goal, visualDescription: graphic.visualDescription, placement: graphic.placement, content});
      expect(hit, graphic.id).not.toBeNull();
      expect(hit!.compositionId).toBe(seed.compositions[graphic.id]);
    }
  });
  it('the lone percent sign of a stat suffix is not an ungrounded word, but a spoken-word check still bites', () => {
    expect(isGroundedInTranscript('%', transcript)).toBe(true);
    expect(isGroundedInTranscript('85 %', transcript)).toBe(true);
    expect(isGroundedInTranscript('85 % unicorns', transcript)).toBe(false);
  });
  it('a chart seed is a bar chart without any non-spoken string in its content', () => {
    const chartSeed = seed.raw.graphics.find(graphic => seed.compositions[graphic.id] === 'ChartExplainer');
    if (!chartSeed) return;
    expect(Object.keys(JSON.parse(chartSeed.contentJson))).toEqual(['data']);
    expect(resolveLibraryGraphic({goal: chartSeed.goal, visualDescription: chartSeed.visualDescription, placement: chartSeed.placement, content: JSON.parse(chartSeed.contentJson)})!.props.kind).toBe('bar');
  });
  it('plates stay one per window and carry no PointerCallout (not resolvable from a transcript)', () => {
    const windows = seed.raw.graphics.map(graphic => Math.floor(WORDS[graphic.anchorWordIndex]!.start / 8));
    expect(new Set(windows).size).toBe(windows.length);
    expect(comps).not.toContain('PointerCallout');
  });
});

describe('WP9F structured Claude plate briefs', () => {
  const gaps = detectExplainPlateGaps({durationSec: DURATION, words: WORDS, coverStarts: []});
  const briefs = buildClaudePlateBriefs(gaps, WORDS, 4);
  it('content is typed from the sentence around the gap, all strings spoken, and the description names the matching style', () => {
    expect(briefs.length).toBe(MAX_CLAUDE_PLATES);
    for (const brief of briefs) {
      const content = JSON.parse(brief.contentJson);
      for (const text of strings(content)) expect(isGroundedInTranscript(text, transcript), text).toBe(true);
      expect(brief.visualDescription).toMatch(/two-sided|big-number|step-by-step|before and after|bar chart|headline card/);
    }
    const shapes = briefs.map(brief => Object.keys(JSON.parse(brief.contentJson)).sort().join(','));
    expect(new Set(shapes).size).toBeGreaterThanOrEqual(2); // not one shape for every gap
  });
  it('each shape fits the style it is described as (and the library resolves it)', () => {
    for (const brief of briefs) {
      const hit = resolveLibraryGraphic({goal: brief.goal, visualDescription: brief.visualDescription, placement: brief.placement, content: JSON.parse(brief.contentJson)});
      expect(hit, brief.id).not.toBeNull();
      const style = ({VsClaim: /two-sided/, StatHighlight: /big-number/, ProcessSteps: /step-by-step/, BeforeAfter: /before and after/, ChartExplainer: /bar chart/, BigKineticHeadline: /headline card/} as Record<string, RegExp>)[hit!.compositionId];
      expect(style, hit!.compositionId).toBeDefined();
      expect(brief.visualDescription).toMatch(style!);
    }
  });
  it('a window whose sentence has no richer shape gets a plain {headline} of the spoken phrase', () => {
    const plain = buildClaudePlateBriefs(detectExplainPlateGaps({durationSec: DURATION, words: WORDS, coverStarts: [1, 5, 9, 13, 17, 21]}), WORDS, 3);
    expect(plain.length).toBeGreaterThan(0);
    for (const brief of plain) expect(Object.keys(JSON.parse(brief.contentJson))).toEqual(['headline']);
  });
});

describe('WP9F library first on the Claude gap path', () => {
  const calls: unknown[] = [];
  const generator = async (request: unknown) => {
    calls.push(request);
    return {text: 'no code', stopReason: 'end_turn', model: 'claude-sonnet-5-5', usage};
  };
  const run = (over: Record<string, unknown> = {}) =>
    runClaudeExplainPlates({director: emptyDirector, edit, words: WORDS, outputDurationSec: DURATION, captionBand: {top: 0.8, bottom: 0.95}, lookId: remapped.id, claudeAllowed: true, buildOptions: {upload, runtimeCheck: false, generator, maxRepairAttempts: 0}, ...over} as never);
  it('structured briefs resolve to library compositions: published as library hits, the generator is never called', async () => {
    calls.length = 0;
    const result = await run();
    expect(calls).toEqual([]);
    expect(result.outcome!.provenance.length).toBe(MAX_CLAUDE_PLATES);
    expect(result.outcome!.provenance.every(item => item.source === 'library')).toBe(true);
    expect(result.warnings.filter(warning => warning.startsWith('explain_plates:library_hit:')).length).toBe(MAX_CLAUDE_PLATES);
    expect(result.warnings.some(warning => warning.startsWith('explain_plates:claude_plate:'))).toBe(false);
    expect(result.outcome!.claudeCostUsd).toBe(0);
  }, 90_000);
  it('the builder is asked library-first by default; preferLibrary false turns it off (generator path, claude_plate warning)', async () => {
    const seen: unknown[] = [];
    const build = (async (_directed: unknown, options: {preferLibrary?: boolean}) => {
      seen.push(options.preferLibrary);
      return {generatedGraphics: [], results: [], failures: [], ledger: [], claudeCostUsd: 0, provenance: []};
    }) as never;
    await run({build});
    await run({build, preferLibrary: false});
    expect(seen).toEqual([true, false]);
    calls.length = 0;
    const custom = await run({preferLibrary: false});
    expect(calls.length).toBe(MAX_CLAUDE_PLATES);
    expect(custom.warnings.filter(warning => warning.startsWith('explain_plates:claude_plate_failed:')).length).toBe(MAX_CLAUDE_PLATES);
  }, 90_000);
});

describe('WP9F guards', () => {
  it('source pins: new detectors gated on explainPlates, library-first in the plate builder, no clip / content-type / stock / network branching', () => {
    const seedSource = read('../motionDirector/transcriptLibrarySeed.ts');
    expect(seedSource).toContain('...(input.explainPlates ? [steps(sentences, sentence.index), beforeAfter(sentence), chart(sentence), stampTitle(sentence), tweetCard(sentence)] : [])');
    expect(read('../motionDirector/claudePlates.ts')).toContain('preferLibrary: libraryOnly || input.preferLibrary !== false');
    expect(read('./explainPlateGaps.ts')).toContain('plateShapeAt(words, gap.phraseStartSec)');
    for (const file of ['./explainPlateGaps.ts', '../motionDirector/claudePlates.ts', '../motionDirector/transcriptLibrarySeed.ts']) expect(read(file), file).not.toMatch(/jensen|contentType\s*===|'motivational'|'opinion'|pexels|stockSearch|fetch\(/i);
  });
});
