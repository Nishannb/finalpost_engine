/**
 * Phase 24: the real planBRoll on the Phase 23 "morning habits" data (trimmed timeline, three local clips of 5 / 3 / 6 s, one beat with no local
 * asset). The Director reply is the fixture's authored one, parsed by the real parser; stock is stubbed. No network, no model.
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {env} from '../../config/env.ts';
import {summarizeEditOutcomes} from '../../lib/cutawayOutcomes.ts';
import {buildTimeline} from '../filters/timeline.ts';
import fixture from './__fixtures__/morning-habits-planner.json' with {type: 'json'};
import type {VisualDirection} from './geminiDirector.ts';

const hoisted = vi.hoisted(() => ({configured: false, lookups: 0}));

vi.mock('./geminiDirector.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('./geminiDirector.ts')>();
  const data = (await import('./__fixtures__/morning-habits-planner.json', {with: {type: 'json'}})).default;
  return {
    ...actual,
    directorConfigured: () => true,
    planVisualDirection: async () => ({...actual.parseVisualDirectorJson(data.directorRaw, data.sourceDurationSec, data.transcript), estimatedCostUsd: 0, source: 'gemini'}) as unknown as VisualDirection,
  };
});
vi.mock('./stockSearch.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('./stockSearch.ts')>();
  return {
    ...actual,
    stockConfigured: () => hoisted.configured,
    findBRollAsset: async () => { hoisted.lookups += 1; return null; },
    findPhotoAsset: async () => { hoisted.lookups += 1; return null; },
    listBRollAssets: async () => { hoisted.lookups += 1; return []; },
  };
});

const {planBRoll} = await import('./brollPlanner.ts');
const timeline = buildTimeline(fixture.keepSegments as never);
const e = env as unknown as Record<string, unknown>;
const original = {sched: e.CUTAWAY_SCHEDULING};

const plan = (options: {userAssets?: boolean} = {}) =>
  planBRoll({
    transcript: fixture.transcript,
    sourceDurationSec: fixture.sourceDurationSec,
    timeline,
    words: fixture.words as never,
    captionWords: fixture.captionWords as never,
    userBrollAssets: options.userAssets === false ? [] : (fixture.userAssets as never),
    requestedEdits: ['cutaway', 'hook_title', 'zoom'],
  });

beforeEach(() => {
  hoisted.configured = false;
  hoisted.lookups = 0;
});
afterEach(() => {
  e.CUTAWAY_SCHEDULING = original.sched;
});

const asset = (url: string) => fixture.userAssets.find(item => item.url === url)!;
const cutawayEntries = (result: Awaited<ReturnType<typeof plan>>) => result.ledger!.entries().filter(entry => entry.type === 'cutaway');

describe('legacy scheduling (default) still behaves exactly as before', () => {
  it('drops the sunlight beat because trimming made it adjacent to the water beat, and says so with the registered reason', async () => {
    e.CUTAWAY_SCHEDULING = 'legacy';
    const result = await plan();
    expect(result.clips.map(clip => [clip.start, clip.end])).toEqual([[6.625, 10.034], [16.091, 20.81]]);
    const second = cutawayEntries(result)[1]!;
    expect(second.events.at(-1)).toMatchObject({stage: 'plan_assembly', decision: 'dropped', reason: 'clip_within_1.5s_of_previous_clip'});
    expect(result.cutawaySchedule).toBeUndefined();
  });
});

describe('beat-preserving scheduling (CUTAWAY_SCHEDULING=beat_preserving)', () => {
  beforeEach(() => {
    e.CUTAWAY_SCHEDULING = 'beat_preserving';
  });

  it('keeps all three local-asset beats as separate cutaways with their own distinct assets (tests 1, 2, 5)', async () => {
    const result = await plan();
    expect(result.clips).toHaveLength(3);
    expect(new Set(result.clips.map(clip => clip.assetUrl)).size).toBe(3);
    expect(result.clips.map(clip => clip.assetUrl.split('/').pop())).toEqual(['broll_ub1.mp4', 'broll_ub2.mp4', 'broll_ub3.mp4']);
    // the editorial gate keeps 3.2 s of speaker between cutaways in a list-like talk (4.5 s otherwise); the later beats are delayed
    // (within 2.5 s of the time the Director asked for) and the earlier one shortened only as far as needed, instead of being dropped
    expect(result.clips.map(clip => [clip.start, clip.end])).toEqual([[6.625, 10.034], [13.236, 16.008], [19.21, 20.81]]);
    for (let i = 1; i < result.clips.length; i += 1) {
      expect(result.clips[i]!.start - result.clips[i - 1]!.end).toBeGreaterThanOrEqual(3.2 - 1e-9);
    }
    expect(result.warnings).toContain('cutaway_schedule_adjusted:3');
    // and the gate, which runs after the scheduler, finds nothing left to drop
    expect(cutawayEntries(result).flatMap(entry => entry.events).filter(event => event.stage === 'editorial_gate' && event.decision === 'dropped')).toEqual([]);
  });

  it('no clip is longer than its asset, so nothing is read past a valid frame or looped (test 3); the cut-off is recorded (test 4)', async () => {
    const result = await plan();
    for (const clip of result.clips) {
      expect(clip.end - clip.start).toBeLessThanOrEqual(asset(clip.assetUrl.replace(/^.*\//, '/synthetic/')).durationSec + 1e-9);
      expect(clip.durationSec).toBe(asset(clip.assetUrl.replace(/^.*\//, '/synthetic/')).durationSec);
    }
    const byId = new Map(result.cutawaySchedule!.map(decision => [decision.id, decision]));
    const water = [...byId.values()].find(decision => decision.final?.start === 6.625)!;
    expect(water.adjustments).toEqual([expect.objectContaining({code: 'truncated_to_beat', shownSec: 3.409, assetDurationSec: 5, limit: 'extension_cap'})]);
    // every asset is cut short by a recorded rule here; none is looped and none is shown past its last frame
    const notebook = [...byId.values()].find(decision => decision.final?.start === 19.21)!;
    expect(notebook.adjustments.map(item => item.code)).toEqual(['delayed_for_spacing', 'truncated_to_beat']);
  });

  it('keeps planned and final timing apart in the ledger: proposed stays the Director time, final is the scheduled window (tests 6 and C)', async () => {
    const result = await plan();
    const [water, sunlight, notebook] = cutawayEntries(result);
    expect(sunlight!.proposed.start).toBeCloseTo(11.296, 3);
    expect(sunlight!.final).toEqual({start: 13.236, end: 16.008});
    expect(sunlight!.events.find(event => event.reason?.startsWith('cutaway_schedule:'))).toMatchObject({stage: 'plan_assembly', decision: 'accepted', reason: 'cutaway_schedule:delayed_for_spacing,shortened_for_next_beat,truncated_to_beat', change: {from: {start: 10.114, end: 16.011}, to: {start: 13.236, end: 16.008}}});
    expect(water!.final).toEqual({start: 6.625, end: 10.034});
    expect(notebook!.final).toEqual({start: 19.21, end: 20.81});
  });

  it('gives every planned cutaway an explicit outcome, including the one whose asset does not exist (tests 6 and 7)', async () => {
    const result = await plan();
    const report = summarizeEditOutcomes(result.ledger!.entries(), {scheduling: 'beat_preserving'});
    expect(report.cutaways).toHaveLength(4);
    expect(report.cutaways.map(item => item.outcome)).toEqual([
      'in_blueprint_as_planned', 'in_blueprint_modified_timing', 'in_blueprint_modified_timing', 'asset_unavailable_or_unconfigured',
    ]);
    const missing = report.cutaways[3]!;
    expect(missing).toMatchObject({reason: 'stock_disabled_or_unconfigured', stage: 'moment_planner', finalSpan: null});
    expect(missing.cause).toBe('stock_disabled:user_assets_supplied+stock_unconfigured');
    expect(report.cutaways.some(item => item.outcome === 'unknown_insufficient_evidence' || item.outcome === 'dropped_unexpectedly')).toBe(false);
  });

  it('records the Director zoom that the parser discarded; it is not silently replaced (test 8)', async () => {
    const result = await plan();
    expect(result.parseRejections).toEqual([expect.objectContaining({kind: 'zoom', code: 'zoom_before_3.5s'})]);
  });
});

describe('disabled stock lookup is distinguishable from a lookup that ran and found nothing (test 7)', () => {
  const lostCause = async (options: Parameters<typeof plan>[0]) => {
    const result = await plan(options);
    const last = cutawayEntries(result).map(entry => entry.events.at(-1)!).filter(event => event.decision === 'rejected');
    return {result, last};
  };

  it('user assets present: stock is disabled and never called, even with a key configured', async () => {
    hoisted.configured = true;
    const {last} = await lostCause({userAssets: true});
    expect(hoisted.lookups).toBe(0);
    expect(last.map(event => event.reason)).toEqual(['stock_disabled_or_unconfigured']);
    expect(last[0]!.cause).toBe('stock_disabled:user_assets_supplied');
  });

  it('no user assets, key configured: stock IS searched, finds nothing, and the cause says so', async () => {
    hoisted.configured = true;
    const {last} = await lostCause({userAssets: false});
    expect(hoisted.lookups).toBeGreaterThan(0);
    expect(last.length).toBe(4);
    expect(last.every(event => event.reason === 'no_stock_video' && event.cause === 'stock_search_ran_no_result')).toBe(true);
  });

  it('no user assets, no key: unconfigured, and nothing was searched', async () => {
    hoisted.configured = false;
    const {last} = await lostCause({userAssets: false});
    expect(hoisted.lookups).toBe(0);
    expect(last.every(event => event.reason === 'stock_disabled_or_unconfigured' && event.cause === 'stock_unconfigured')).toBe(true);
  });
});

describe('the report is attached to the blueprint stats type and only claims pipeline evidence', () => {
  it('states that it is not proof of rendered frames', () => {
    const report = summarizeEditOutcomes([], {scheduling: 'legacy'});
    expect(report).toMatchObject({version: 1, evidence: 'pipeline_ledger_not_rendered_frames', cutaways: [], directorParseRejections: [], fallbackSubstitutions: [], directorFallbackReason: null});
  });
});
