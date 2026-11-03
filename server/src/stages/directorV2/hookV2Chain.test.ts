/**
 * Phase 20A (A2): a v2 `hook_title` element that is SCHEDULED but carries no text, followed through the real compiler, the real
 * planBRoll/planVisualPlan, the edit ledger, finalizeEdits and the blueprint schema. runDirectorV2 is replaced by the REAL
 * compileCreativePlan output (no perception, no Gemini); nothing is sent anywhere.
 */
import {afterEach, describe, expect, it, vi} from 'vitest';

import {env} from '../../config/env.ts';
import {outcomeOf} from '../../lib/editLedger.ts';
import {finalizeEdits} from '../../pipeline/finalizeEdits.ts';
import {timelineBlueprintSchema} from '../../../../remotion/src/blueprintSchema.ts';
import {buildTimeline} from '../filters/timeline.ts';
import {compileCreativePlan} from './compiler.ts';
import type {CreativePlan, PerceptionPack} from './types.ts';

const holder = vi.hoisted(() => ({next: null as null | Record<string, unknown>}));
vi.mock('./runDirectorV2.ts', () => ({runDirectorV2: async () => holder.next}));
vi.mock('../../lib/http.ts', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/http.ts')>()),
  requestJson: async () => {
    throw new Error('network must not be used in this test');
  },
}));
const {planBRoll} = await import('../broll/brollPlanner.ts');

const e = env as unknown as {HOOK_TITLE_POLICY: string};
const originalPolicy = e.HOOK_TITLE_POLICY;
afterEach(() => {
  e.HOOK_TITLE_POLICY = originalPolicy;
  holder.next = null;
});

const words = Array.from({length: 40}, (_, i) => ({id: `w${i}`, text: `w${i}`, start: i * 0.5, end: i * 0.5 + 0.45, sentenceId: 's0'}));
const pack = {words, sentences: [], userAssets: [], occupancySlices: [], outputDurationSec: 20, speakerCutoutAvailable: false, requestedEdits: [], storyboard: [], transcript: '', language: 'en', creatorProfile: '', speakerCutoutNote: '', audio: {pauses: [], emphasisWordIds: [], energyPeaks: []}} as unknown as PerceptionPack;

const planWith = (hookElement: Record<string, unknown> | null, hookTitle: string): CreativePlan =>
  ({
    editThesis: 't', editThesisParts: {} as never, hookTitle, hookStyle: 'minimal' as never, caption: undefined as never, preferredLutId: '', suggestedLutIds: [],
    elements: hookElement ? [{id: 'h1', beatId: 'b1', intent: 'hook', kind: 'hook_title', wordRange: {startWordId: 'w0', endWordId: 'w6'}, ...hookElement}] : [],
    estimatedCostUsd: 0, promptVersion: 'x', inputHash: 'x', raw: {},
  }) as unknown as CreativePlan;

const CASES: Array<[string, Record<string, unknown> | null, string]> = [
  ['element with empty text', {text: ''}, ''],
  ['element with whitespace-only text', {text: '   '}, ''],
  ['element with no text field', {}, ''],
  ['no hook element at all', null, ''],
];

const through = async (policy: 'placeholder' | 'optional', plan: CreativePlan) => {
  e.HOOK_TITLE_POLICY = policy;
  const compiled = await compileCreativePlan({pack, plan, noRepair: true});
  holder.next = {direction: compiled.direction, pack, plan: compiled.plan, report: compiled.report};
  const timeline = buildTimeline([{start: 0, end: 20}] as never);
  const planned = await planBRoll({
    transcript: words.map(word => word.text).join(' '), sourceDurationSec: 20, timeline, words: words as never, captionWords: words as never,
    directorV2: true, sourcePath: '/nonexistent/source.mp4', workspace: {file: (name: string) => `/nonexistent/${name}`} as never,
    requestedEdits: [],
  } as never);
  expect(planned.warnings.some(warning => warning.startsWith('director_v2:'))).toBe(true);
  const ledger = planned.ledger!;
  const finalized = finalizeEdits({
    ledger, contentProfile: null, footageLuminance: 0.4, captionLocked: false, durationSec: timeline.outputDurationSec,
    hook: {text: planned.hookTitle, start: planned.hookStartSec ?? 0, end: (planned.hookStartSec ?? 0) + Math.max(1.2, planned.hookDurationSec || 0), anchor: 'top_left'},
    caption: planned.caption, brollClips: planned.clips, visualOverlays: planned.overlays, insetReveals: planned.insetReveals, frameInsets: planned.frameInsets, mediaContainers: planned.mediaContainers,
    motionGraphics: planned.motionGraphics, semanticEmphasis: planned.semanticEmphasis, depthOverlays: planned.depthOverlays, transitions: planned.transitions, zoomTriggers: [], generatedGraphics: [],
    speaker: {box: {x: 0.18, y: 0.16, w: 0.64, h: 0.62}, source: 'fallback'}, speakerCutout: {available: false},
  });
  return {compiled, planned, ledger, finalized};
};

describe('v2: a scheduled hook element with no text, scheduler → direction → planner → ledger → finalizeEdits → blueprint', () => {
  it.each(CASES)('optional policy, %s: the final plan has no title, no window, no ledger hook, no hook conflict edit, and the blueprint title is empty', async (_name, element, hookTitle) => {
    const {planned, ledger, finalized} = await through('optional', planWith(element, hookTitle));
    expect(planned.hookTitle).toBe('');
    expect(planned.hookStartSec).toBe(0);
    expect(planned.hookDurationSec).toBe(0);
    expect(ledger.entries().filter(entry => entry.type === 'hook_title')).toEqual([]);
    expect(ledger.entries().some(entry => entry.events.some(event => event.track === 'HookTitle'))).toBe(false);
    expect(finalized.decisions.some(decision => decision.id.startsWith('hook_title'))).toBe(false);
    expect(timelineBlueprintSchema.shape.hookTitle.parse(planned.hookTitle)).toBe('');
  });

  it.each(CASES)('placeholder policy, %s: v2 never substituted a title, so the result is the same empty hook (compatibility with the default)', async (_name, element, hookTitle) => {
    const {planned, ledger} = await through('placeholder', planWith(element, hookTitle));
    expect(planned.hookTitle).toBe('');
    expect(planned.hookTitle).not.toBe('WATCH THIS');
    expect(ledger.entries().filter(entry => entry.type === 'hook_title')).toEqual([]);
  });

  it('the compiler may still schedule the (textless) hook element and give the direction a time window; the planner is what removes it under "optional"', async () => {
    e.HOOK_TITLE_POLICY = 'optional';
    const compiled = await compileCreativePlan({pack, plan: planWith({text: ''}, ''), noRepair: true});
    const scheduledHook = compiled.assembler.scheduled.find(element => element.kind === 'hook_title');
    // This is the boundary Phase 19 flagged: record what actually happens so a change to it is noticed.
    expect(compiled.direction.hookTitle).toBe('');
    if (scheduledHook) {
      expect(compiled.direction.hookStartSec).toBe(scheduledHook.resolved.start);
      expect(compiled.direction.hookEndSec).toBe(scheduledHook.resolved.end);
    } else {
      expect(compiled.direction.hookStartSec).toBeUndefined();
    }
  });

  it('a real v2 title still reaches the plan, the ledger (rendered on HookTitle) and the blueprint under both policies', async () => {
    for (const policy of ['placeholder', 'optional'] as const) {
      const {planned, ledger} = await through(policy, planWith({text: 'Silence Speaks'}, 'Silence Speaks'));
      expect(planned.hookTitle).toBe('Silence Speaks');
      expect(planned.hookDurationSec).toBeGreaterThan(0);
      const hook = ledger.entries().filter(entry => entry.type === 'hook_title');
      expect(hook, policy).toHaveLength(1);
      expect(outcomeOf(hook[0]!), policy).toBe('rendered');
      expect(hook[0]!.events.at(-1)).toMatchObject({track: 'HookTitle', visibility: 'visible'});
    }
  });
});
