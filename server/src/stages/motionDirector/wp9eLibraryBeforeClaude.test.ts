/**
 * WP9E: on the polish explain-plate path the library seeds (+ plate anchors) ALWAYS run first, whether or not Claude is allowed; Claude plates only fill the windows they left uncovered.
 * Offline: the worker is stubbed (no model, no upload, no render); the motion Director is a controlled fixture (no Gemini).
 */
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterAll, beforeEach, describe, expect, it, vi} from 'vitest';

const hoisted = vi.hoisted(() => ({calls: [] as Array<{kind: 'library' | 'claude'; id: string}>, failSeedOnce: false as boolean, failedSeed: ''}));
const stubResult = (brief: {id: string; placement: string; content: Record<string, unknown>; graphicSide?: string}) => ({
  id: brief.id,
  module: {url: `https://cdn.example/${brief.id}.js`, sha256: brief.id},
  placement: brief.placement === 'split_screen' ? {mode: 'split_screen', graphicSide: brief.graphicSide ?? 'top'} : {mode: brief.placement},
  props: {content: brief.content},
  brief: {purpose: 'p', visualIntent: 'v'},
  source: '',
  bytes: 0,
  gzipBytes: 0,
  model: null,
  attempts: [],
  usage: {inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0},
  costUsd: 0,
  previewPath: null,
  warnings: [],
});
vi.mock('../../motionWorker/worker.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../../motionWorker/worker.ts')>();
  return {
    ...actual,
    publishGraphicSource: async (brief: {id: string; placement: string; content: Record<string, unknown>}) => {
      hoisted.calls.push({kind: 'library', id: brief.id});
      // One seed fails its library publish AND its Claude fallback below: that window is the residual gap.
      if (hoisted.failSeedOnce && !hoisted.failedSeed && brief.id.startsWith('seed-')) {
        hoisted.failedSeed = brief.id;
        throw new Error('library module failed validation');
      }
      return stubResult(brief);
    },
    generateMotionGraphic: async (brief: {id: string; placement: string; content: Record<string, unknown>}) => {
      hoisted.calls.push({kind: 'claude', id: brief.id});
      if (brief.id === hoisted.failedSeed) throw new actual.MotionWorkerError('stubbed seed fallback failure', brief.id, [], null);
      return stubResult(brief);
    },
  };
});

const {runMotionGraphicsStage} = await import('./index.ts');

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
const WORDS = SENTENCES.flatMap((sentence, index) => {
  const tokens = sentence.split(' ');
  const slot = 3.5 / tokens.length;
  return tokens.map((text, i) => ({text, start: Math.round((index * 4 + i * slot) * 1000) / 1000, end: Math.round((index * 4 + (i + 1) * slot) * 1000) / 1000}));
});
const work = mkdtempSync(join(tmpdir(), 'wp9e-'));
const fixture = join(work, 'director.json');
writeFileSync(fixture, JSON.stringify({graphics: []}));
afterAll(() => rmSync(work, {recursive: true, force: true}));

const stage = (over: Record<string, unknown> = {}) =>
  runMotionGraphicsStage({
    transcript: WORDS.map(word => word.text).join(' '),
    words: WORDS,
    outputDurationSec: 36,
    languageCode: 'en',
    edit: {brollClips: [], visualOverlays: [], motionGraphics: [], mediaContainers: [], hookTitle: '', hookStartSec: 0, hookDurationSec: 0, insetReveals: [], depthOverlays: [], semanticEmphasis: [], frameInsets: []},
    preferLibrary: true,
    explainPlates: true,
    lookId: 'explainer_cutaway',
    workerOptions: {upload: async () => 'x', maxRepairAttempts: 0},
    ...over,
  } as never);
const windowOf = (start: number) => Math.floor(start / 8);

beforeEach(() => {
  hoisted.calls.length = 0;
  hoisted.failSeedOnce = false;
  hoisted.failedSeed = '';
  process.env.MOTION_DIRECTOR_FIXTURE = fixture;
});

describe('WP9E library plates come first, Claude only fills what is left', () => {
  it('claudeAllowed true + explainPlates: library seeds still run and are delivered; with every window covered Claude is never called', async () => {
    const result = await stage({claudeAllowed: true});
    expect(result.warnings.some(warning => warning.startsWith('motion_graphic:library_seed:') && !warning.endsWith(':none'))).toBe(true);
    const libraryCalls = hoisted.calls.filter(call => call.kind === 'library');
    expect(libraryCalls.length).toBeGreaterThanOrEqual(3);
    expect(libraryCalls.every(call => call.id.startsWith('seed-'))).toBe(true);
    expect(hoisted.calls.filter(call => call.kind === 'claude')).toEqual([]);
    expect(result.warnings.some(warning => warning.startsWith('explain_plates:claude_plate'))).toBe(false);
    expect(new Set(result.generatedGraphics.map(graphic => windowOf(graphic.start))).size).toBe(result.generatedGraphics.length);
  });
  it('claudeAllowed true: a window the library left uncovered gets a Claude plate, after every library call, and only that window', async () => {
    hoisted.failSeedOnce = true;
    const result = await stage({claudeAllowed: true});
    // WP9F: the plate brief is structured and library-shaped, so it is published from the library (no generator call); either way it comes after every seed.
    const plates = hoisted.calls.filter(call => call.id.startsWith('claude-plate-'));
    expect(plates).toHaveLength(1);
    expect(hoisted.calls.filter(call => call.kind === 'claude' && call.id.startsWith('claude-plate-'))).toEqual([]);
    const lastSeed = hoisted.calls.map(call => call.id.startsWith('seed-')).lastIndexOf(true);
    const firstPlate = hoisted.calls.findIndex(call => call.id.startsWith('claude-plate-'));
    expect(firstPlate).toBeGreaterThan(lastSeed);
    // the plate sits in a window no delivered library graphic covers
    const plate = result.generatedGraphics.find(graphic => graphic.id.startsWith('claude-plate-'))!;
    expect(plate).toBeDefined();
    const libraryWindows = result.generatedGraphics.filter(graphic => graphic.id.startsWith('seed-')).map(graphic => windowOf(graphic.start));
    expect(libraryWindows).not.toContain(windowOf(plate.start));
    expect(result.warnings).toContain(`explain_plates:library_hit:${plate.id}`);
    // the failed seed's own Claude fallback failed, so the plate is the only graphic in that window
    expect(result.warnings.some(warning => warning === `motion_dropped:${hoisted.failedSeed}`)).toBe(true);
  });
  it('claudeAllowed false: library seeds unchanged, the generator is never called; (WP9G) the residual gap is filled by a library hit, not skipped', async () => {
    hoisted.failSeedOnce = true;
    const result = await stage({claudeAllowed: false});
    expect(hoisted.calls.filter(call => call.kind === 'claude')).toEqual([]);
    expect(result.warnings.filter(warning => warning.startsWith('motion_graphic:library_seed:')).length).toBeGreaterThanOrEqual(3);
    expect(result.warnings.some(warning => warning.startsWith('explain_plates:library_hit:claude-plate-'))).toBe(true);
    expect(result.warnings.some(warning => warning.startsWith('explain_plates:claude_gap_skipped:'))).toBe(false);
    expect(result.warnings.some(warning => warning.startsWith('explain_plates:claude_plate:'))).toBe(false);
  });
  it('claudeAllowed false and nothing failed: same seeds as the allowed run, no gap warning', async () => {
    const allowed = await stage({claudeAllowed: true});
    const allowedIds = allowed.generatedGraphics.map(graphic => graphic.id);
    hoisted.calls.length = 0;
    const libraryOnly = await stage({claudeAllowed: false});
    expect(libraryOnly.generatedGraphics.map(graphic => graphic.id)).toEqual(allowedIds);
    expect(libraryOnly.warnings.some(warning => warning.startsWith('explain_plates:'))).toBe(false);
  });
  it('off the explain path nothing changes: Claude allowed + no explainPlates seeds nothing', async () => {
    const result = await stage({claudeAllowed: true, explainPlates: false});
    expect(hoisted.calls).toEqual([]);
    expect(result.generatedGraphics).toEqual([]);
  });
  it('a failed motion Director does not skip the library on this path', async () => {
    process.env.MOTION_DIRECTOR_FIXTURE = join(work, 'does-not-exist.json');
    const result = await stage({claudeAllowed: true});
    expect(result.warnings).toContain('motion_director_failed');
    expect(hoisted.calls.filter(call => call.kind === 'library').length).toBeGreaterThanOrEqual(3);
  });
  it('source pins: seeding is not gated on Claude being off, plates run after the main worker on delivered graphics, no clip / content-type bias', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    expect(source).toContain('(input.claudeAllowed === false || Boolean(input.explainPlates))');
    expect(source).toContain('mainWorker?.generatedGraphics');
    expect(source.indexOf('if (seedMode) {\n    const seeded')).toBeLessThan(source.indexOf('runClaudeExplainPlates({'));
    expect(source).not.toMatch(/jensen|contentType\s*===|'motivational'|'opinion'|pexels|stockSearch/i);
  });
});
