/**
 * WP9D: Claude-custom explain plates for windows the library cannot cover. Mock generator only: no network, no model, no render. Pure: no model, no network, no render.
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {EDIT_LOOKS, remapLookForUnusableMatte, resolveEditLook} from '../directorV2/editLooks.ts';
import {polishRequestedEdits, POLISH_LEAN_EDITS} from '../../lib/editToolkits.ts';
import {explainPlateLimit, seedLibraryGraphics} from '../motionDirector/transcriptLibrarySeed.ts';
import {applyPolishDensityFill, MIN_BEAT_GAP_SEC} from './polishDensityFill.ts';
import {applyEditLookToDirection} from './lookDirection.ts';
import {engagementWindows, isTextChipCadenceOnly, libraryCoverStarts, meetsEngagementBar, uncoveredEngagementWindows} from './engagementCadence.ts';
import {isGroundedInTranscript} from './groundedText.ts';
import {buildClaudePlateBriefs, detectExplainPlateGaps, MAX_CLAUDE_PLATES} from './explainPlateGaps.ts';
import {coverStartsOf, runClaudeExplainPlates} from '../motionDirector/claudePlates.ts';
import {libraryGraphicSource} from '../motionDirector/libraryRegistry.ts';
import {occupiedFromDirection, planEngagementBeats} from './engagementMixer.ts';
import {addLibrarySeeds} from '../motionDirector/libraryFallback.ts';
import {assembleDirectedGraphics, type MotionDirectorResult} from '../motionDirector/motionDirector.ts';
import {resolveLibraryGraphic} from '../motionDirector/libraryRegistry.ts';
import type {VisualDirection} from './geminiDirector.ts';
import type {WordToken} from '../../types/blueprint.ts';

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
const WORDS: WordToken[] = SENTENCES.flatMap((sentence, index) => {
  const tokens = sentence.split(' ');
  const slot = 3.5 / tokens.length;
  return tokens.map((text, i) => ({text, start: Math.round((index * 4 + i * slot) * 1000) / 1000, end: Math.round((index * 4 + (i + 1) * slot) * 1000) / 1000}));
});
const DURATION = 36;
const norm = (text: string) => text.replace(/[.,]/g, '').toLowerCase();
const spoken = ` ${WORDS.map(word => norm(word.text)).join(' ')} `;
const LEAN = new Set<string>(POLISH_LEAN_EDITS);

const direction = (over: Partial<VisualDirection> = {}): VisualDirection => ({
  hookTitle: 'Ship faster', hookSubtitle: '', hookStyle: 'bold' as never, topic: 't', visualQueries: [],
  caption: {} as never, suggestedLutIds: [], preferredLutId: '',
  zooms: [], moments: [], depthOverlays: [], insetReveals: [], motionGraphics: [], mediaContainers: [], frameInsets: [], semanticEmphasis: [],
  estimatedCostUsd: 0, source: 'gemini', ...over,
});
const thin = (): VisualDirection => direction({
  zooms: [{timestamp: 6, durationSec: 2.5}, {timestamp: 15, durationSec: 2.5}, {timestamp: 27, durationSec: 2.5}],
  moments: [{timestamp: 20, searchKeyword: 'x', media: 'text', layout: 'lockup', anchor: 'top_right', overlayText: 'Never confuse being busy', textStyle: 'stack', accentColor: '#fff'} as never],
});
const remapped = remapLookForUnusableMatte(resolveEditLook('talking_head'), false).resolution.look;
const enforced = applyEditLookToDirection(thin(), remapped, {matteUsable: false}).direction;
const fill = (over: Partial<Parameters<typeof applyPolishDensityFill>[0]> = {}) => applyPolishDensityFill({direction: enforced, look: remapped, words: WORDS, outputDurationSec: DURATION, requested: LEAN, matteUsable: false, ...over});





const emptyDirector: MotionDirectorResult = {graphics: [], refusals: [], notes: '', costUsd: 0, model: 'x', latencyMs: 0, raw: null};
const transcript = WORDS.map(word => word.text).join(' ');
const usage = {inputTokens: 10, outputTokens: 10, cacheReadInputTokens: 0, cacheCreationInputTokens: 0};
const upload = async (_code: string, sha: string) => `https://cdn.example/${sha}.js`;
const edit = {brollClips: [], visualOverlays: [], motionGraphics: [], mediaContainers: [], hookTitle: '', hookStartSec: 0, hookDurationSec: 0, insetReveals: [], depthOverlays: [], semanticEmphasis: [], frameInsets: []} as never;
const captionBand = {top: 0.8, bottom: 0.95};
const run = (over: Record<string, unknown> = {}) => runClaudeExplainPlates({preferLibrary: false, director: emptyDirector, edit, words: WORDS, outputDurationSec: DURATION, captionBand, lookId: remapped.id, buildOptions: {upload, runtimeCheck: false}, ...over} as never);
/** A mock "Claude" that answers with a valid module (a library composition's source, as the worker's own tests do) and counts its calls. */
const mockGenerator = (calls: unknown[]) => async (request: unknown) => {
  calls.push(request);
  const source = libraryGraphicSource({compositionId: 'QuoteCallout', props: {quote: 'Pick one metric'}} as never);
  return {text: '```tsx\n' + source + '\n```', stopReason: 'end_turn', model: 'claude-sonnet-5-5', usage};
};

describe('WP9D gap detector (pure)', () => {
  it('lists windows with no cover, each with a grounded 2-5 word phrase from that window', () => {
    const gaps = detectExplainPlateGaps({durationSec: DURATION, words: WORDS, coverStarts: [1, 17]});
    expect(gaps.map(gap => gap.windowIndex)).toEqual([1, 3]);
    for (const gap of gaps) {
      expect(gap.phraseStartSec).toBeGreaterThanOrEqual(gap.startSec);
      expect(gap.phraseStartSec).toBeLessThan(gap.endSec);
      expect(isGroundedInTranscript(gap.spokenPhrase, transcript)).toBe(true);
      expect(gap.spokenPhrase.split(' ').length).toBeGreaterThanOrEqual(2);
      expect(gap.spokenPhrase.split(' ').length).toBeLessThanOrEqual(5);
    }
  });
  it('no gaps when every window is covered; a window with no usable phrase is not a gap', () => {
    expect(detectExplainPlateGaps({durationSec: DURATION, words: WORDS, coverStarts: [1, 9, 17, 25]})).toEqual([]);
    expect(detectExplainPlateGaps({durationSec: DURATION, words: [], coverStarts: []})).toEqual([]);
  });
  it('briefs: copy is spoken words only, bounded, split top / full screen alternating', () => {
    const gaps = detectExplainPlateGaps({durationSec: DURATION, words: WORDS, coverStarts: []});
    expect(gaps.length).toBe(4);
    const briefs = buildClaudePlateBriefs(gaps, WORDS, 10);
    expect(briefs.length).toBe(MAX_CLAUDE_PLATES);
    expect(briefs.map(brief => brief.placement)).toEqual(['split_screen', 'full_screen', 'split_screen']);
    briefs.forEach((brief, index) => {
      expect(brief.graphicSide).toBe(index % 2 === 0 ? 'top' : undefined);
      // WP9F: structured, spoken-run content (the shape depends on the sentence); every string is spoken
      const strings: string[] = [];
      const walk = (node: unknown): void => { if (typeof node === 'string') strings.push(node); else if (Array.isArray(node)) node.forEach(walk); else if (node && typeof node === 'object') Object.entries(node).filter(([key]) => key !== 'recipeId').map(([, item]) => item).forEach(walk); };
      walk(JSON.parse(brief.contentJson));
      for (const text of strings) expect(isGroundedInTranscript(text, transcript), text).toBe(true);
      expect(WORDS[brief.anchorWordIndex]!.start).toBeLessThanOrEqual(gaps[index]!.phraseStartSec + 0.05);
    });
    expect(buildClaudePlateBriefs(gaps, WORDS, 1).length).toBe(1);
    expect(buildClaudePlateBriefs(gaps, WORDS, 0)).toEqual([]);
  });
  it('coverStartsOf counts full/split placements and leave-the-face library compositions, not overlays on the face', () => {
    const brief = (placement: string, content: Record<string, unknown>, start: number) => ({start, end: start + 3, reason: 'r', brief: {id: `g${start}`, goal: 'g', visualDescription: 'v', placement, durationSeconds: 3, content}}) as never;
    const starts = coverStartsOf({graphics: [brief('full_screen', {mood: 'x'}, 1), brief('split_screen', {mood: 'x'}, 9), brief('overlay', {lines: [{text: 'Pick one'}, {text: 'metric'}]}, 17), brief('overlay', {name: 'Brand'}, 25)]}, edit);
    expect(starts).toEqual(expect.arrayContaining([1, 9, 17]));
    expect(starts).not.toContain(25);
  });
});

describe('WP9D stage helper with a mock generator', () => {
  it('claude allowed: every gap (bounded) becomes a grounded brief, goes through the generator once each, and is warned', async () => {
    const calls: unknown[] = [];
    const result = await run({claudeAllowed: true, buildOptions: {upload, runtimeCheck: false, generator: mockGenerator(calls), maxRepairAttempts: 0}});
    expect(result.gaps.length).toBe(4);
    expect(result.directed.length).toBe(MAX_CLAUDE_PLATES);
    expect(calls.length).toBe(MAX_CLAUDE_PLATES);
    expect(result.outcome!.generatedGraphics.length).toBe(MAX_CLAUDE_PLATES);
    expect(result.outcome!.provenance.every(item => item.source === 'claude')).toBe(true); // library off for plates
    for (const graphic of result.directed) {
      expect(['split_screen', 'full_screen']).toContain(graphic.brief.placement);
      expect(isGroundedInTranscript(JSON.stringify(Object.entries(graphic.brief.content).filter(([key]) => key !== 'recipeId').map(([, item]) => item)), transcript)).toBe(true);
    }
    expect(result.warnings.filter(warning => warning.startsWith('explain_plates:claude_plate:')).length).toBe(MAX_CLAUDE_PLATES);
    expect(result.warnings.some(warning => warning.startsWith('explain_plates:claude_plate_failed:'))).toBe(false);
    expect(result.warnings).toContain('explain_plates:claude_gap_skipped:1'); // 4 gaps, 3 plates
  }, 60_000);
  it('claudeAllowed omitted behaves as allowed (existing convention)', async () => {
    const calls: unknown[] = [];
    await run({buildOptions: {upload, runtimeCheck: false, generator: mockGenerator(calls), maxRepairAttempts: 0}});
    expect(calls.length).toBeGreaterThan(0);
  }, 60_000);
  it('library-only (claudeAllowed false): the generator is never called; (WP9G) library-resolvable briefs are still published, the gap beyond the bound is reported', async () => {
    const calls: unknown[] = [];
    const result = await run({claudeAllowed: false, buildOptions: {upload, runtimeCheck: false, generator: mockGenerator(calls)}});
    expect(calls).toEqual([]);
    expect(result.outcome!.provenance.every(item => item.source === 'library')).toBe(true);
    expect(result.outcome!.generatedGraphics.length).toBe(MAX_CLAUDE_PLATES);
    expect(result.warnings.filter(warning => warning.startsWith('explain_plates:library_hit:')).length).toBe(MAX_CLAUDE_PLATES);
    expect(result.warnings).toContain('explain_plates:claude_gap_skipped:1');
  }, 60_000);
  it('library-only with briefs the library cannot resolve: nothing is built, every one is reported as skipped', async () => {
    const calls: unknown[] = [];
    const makeBriefs = (gaps: ReadonlyArray<{windowIndex: number; phraseStartSec: number}>) => gaps.slice(0, 2).map(gap => ({id: `claude-plate-${gap.windowIndex + 1}`, anchorWordIndex: WORDS.findIndex(word => word.start >= gap.phraseStartSec), durationSeconds: 3.5, reason: 'r', goal: 'g', visualDescription: 'v', placement: 'full_screen' as const, contentJson: JSON.stringify({mood: 'calm'})}));
    const result = await run({claudeAllowed: false, makeBriefs, buildOptions: {upload, runtimeCheck: false, generator: mockGenerator(calls)}});
    expect(calls).toEqual([]);
    expect(result.outcome).toBeNull();
    expect(result.warnings).toEqual([`explain_plates:claude_gap_skipped:${result.gaps.length}`]);
  });
  it('a generator that fails: a per-plate failure warning, no graphic, no throw', async () => {
    const generator = async () => ({text: 'no code', stopReason: 'end_turn', model: 'claude-sonnet-5-5', usage});
    const result = await run({claudeAllowed: true, buildOptions: {upload, runtimeCheck: false, generator, maxRepairAttempts: 0}});
    expect(result.outcome!.generatedGraphics).toEqual([]);
    expect(result.warnings.filter(warning => warning.startsWith('explain_plates:claude_plate_failed:')).length).toBe(MAX_CLAUDE_PLATES);
  }, 60_000);
  it('fully covered clip: nothing is requested (no call, no warning)', async () => {
    const calls: unknown[] = [];
    const covered = {graphics: [1, 9, 17, 25].map(start => ({start, end: start + 3, reason: 'r', brief: {id: `g${start}`, goal: 'g', visualDescription: 'v', placement: 'full_screen', durationSeconds: 3, content: {mood: 'x'}}}))} as never;
    const result = await run({director: covered, claudeAllowed: true, buildOptions: {upload, runtimeCheck: false, generator: mockGenerator(calls)}});
    expect(calls).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
  it('the look cap is shared: minimal_captions never gets a plate; a spent cap leaves the gaps reported', async () => {
    const calls: unknown[] = [];
    const generator = mockGenerator(calls);
    const minimal = await run({lookId: 'minimal_captions', claudeAllowed: true, buildOptions: {upload, runtimeCheck: false, generator}});
    expect(calls).toEqual([]);
    expect(minimal.directed).toEqual([]);
    const spent = {graphics: Array.from({length: remapped.maxGraphics}, (_, index) => ({start: 100 + index, end: 101 + index, reason: 'r', brief: {id: `x${index}`, goal: 'g', visualDescription: 'v', placement: 'overlay', durationSeconds: 1, content: {name: 'N'}}}))} as never;
    const full = await run({director: spent, claudeAllowed: true, buildOptions: {upload, runtimeCheck: false, generator}});
    expect(calls).toEqual([]);
    expect(full.warnings).toEqual([`explain_plates:claude_gap_skipped:${full.gaps.length}`]);
  });
});

describe('WP9D wiring and guards', () => {
  it('library-only polish with a rich fixture can still meet the bar from library plates alone (no Claude needed)', () => {
    const fillResult = fill({cutawayResolvable: false, explainPlates: true});
    const starts = fillResult.plateAnchors.map(anchor => anchor.startSec);
    expect(meetsEngagementBar(fillResult.direction, DURATION, starts)).toBe(true);
    expect(detectExplainPlateGaps({durationSec: DURATION, words: WORDS, coverStarts: starts})).toEqual([]);
  });
  it('source pins: stage and planner wiring, plates after the library, no clip / content-type / stock branching', () => {
    const stage = read('../motionDirector/index.ts');
    expect(stage).toContain('runClaudeExplainPlates');
    expect(stage).toContain('if (input.explainPlates)');
    expect(stage.indexOf('mainWorker')).toBeLessThan(stage.indexOf('runClaudeExplainPlates({'));
    expect(read('./brollPlanner.ts')).toContain('explain_plates:gaps_predicted:');
    for (const file of ['./explainPlateGaps.ts', '../motionDirector/claudePlates.ts']) expect(read(file), file).not.toMatch(/jensen|contentType\s*===|'motivational'|'opinion'|pexels|stockSearch|fetch\(|anthropic/i);
  });
});
