/**
 * Hook-title impact evidence (Phase 16). Documents OBSERVED code behaviour; implements nothing.
 *
 * 1. Where an omitted hook is turned into "WATCH THIS" (the only forcing point on the v1 parse path).
 * 2. That everything downstream of the parser already copes with an EMPTY hook title: replaying each saved response with its
 *    hook removed after parsing still passes every harness invariant. (This simulates a no-title Director outcome; it is not a
 *    model output and says nothing about whether a no-title edit is better.)
 */
import {createHash} from 'node:crypto';

import {describe, expect, it, vi} from 'vitest';

import {brollClipSchema, depthOverlayClipSchema, frameInsetSchema, insetRevealClipSchema, mediaContainerSchema, motionGraphicSchema, semanticEmphasisSchema, timelineBlueprintSchema, transitionClipSchema, visualOverlaySchema, zoomTriggerSchema} from '../../../remotion/src/blueprintSchema.ts';
import {fallbackVisualDirection, oneLineHook, parseVisualDirectorJson, type VisualDirection} from '../stages/broll/geminiDirector.ts';
import {buildConflictEdits, ledgerIdResolver} from '../lib/editConflicts.ts';
import {loadV1Fixtures} from './fixtures.ts';
import {runAll, type BlueprintSchemas} from './invariants.ts';
import {replayV1, type ReplayDeps} from './replayCore.ts';

const hoisted = vi.hoisted(() => ({direction: null as unknown}));
vi.mock('../stages/broll/geminiDirector.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../stages/broll/geminiDirector.ts')>();
  return {...actual, directorConfigured: () => true, planVisualDirection: async () => hoisted.direction as VisualDirection};
});
const asked = vi.hoisted(() => new Map<string, number>());
vi.mock('../stages/broll/stockSearch.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../stages/broll/stockSearch.ts')>();
  const asset = (query: unknown) => {
    const key = String(query ?? '');
    const n = (asked.get(key) ?? 0) + 1;
    asked.set(key, n);
    const id = parseInt(createHash('sha1').update(`${key}#${n}`).digest('hex').slice(0, 7), 16);
    return {assetUrl: `https://stock.invalid/${id}.mp4`, provider: 'pexels' as const, providerId: id, width: 1080, height: 1920, durationSec: 12, credit: 'stub', creditUrl: ''};
  };
  return {...actual, stockConfigured: () => true, findBRollAsset: async (q: unknown) => asset(q), findPhotoAsset: async (q: unknown) => asset(q), listBRollAssets: async (q: unknown) => [asset(q), asset(`${String(q)}/2`)]};
});
const {planBRoll} = await import('../stages/broll/brollPlanner.ts');
const deps: ReplayDeps = {setDirection: d => { hoisted.direction = d; asked.clear(); }, planBRoll: planBRoll as unknown as ReplayDeps['planBRoll']};
const schemas: BlueprintSchemas = {brollClip: brollClipSchema, visualOverlay: visualOverlaySchema, insetRevealClip: insetRevealClipSchema, frameInset: frameInsetSchema, mediaContainer: mediaContainerSchema, motionGraphic: motionGraphicSchema, semanticEmphasis: semanticEmphasisSchema, depthOverlayClip: depthOverlayClipSchema, transitionClip: transitionClipSchema, zoomTrigger: zoomTriggerSchema};

describe('observed: where a missing hook title is forced', () => {
  const record = (hook: unknown) => JSON.stringify({topic: 't', ...(hook === undefined ? {} : {hook_title: hook}), moments: [{timestamp: 8, search_keyword: 'sunset', media: 'video', layout: 'cutaway'}], caption: {}});

  it.each([undefined, '', '   ', null])('the v1 parser turns hook_title=%j into "WATCH THIS"', hook => {
    expect(parseVisualDirectorJson(record(hook), 40, 'Some transcript here.').hookTitle).toBe('WATCH THIS');
  });

  it('oneLineHook can never return an empty title; the transcript-derived fallback is not reached on this path', () => {
    expect(oneLineHook('')).toBe('WATCH THIS');
    expect(oneLineHook('   ')).toBe('WATCH THIS');
  });

  it('the transcript-derived fallback (used only when the Director call fails) takes the first <=6 words of the first sentence, mid-phrase, fillers and CTAs included', () => {
    const hook = (transcript: string) => fallbackVisualDirection({transcript, sourceDurationSec: 30, momentCount: 1}).hookTitle;
    expect(hook('Have you ever noticed how the quietest moments speak the loudest?')).toBe('Have you ever noticed how the');
    expect(hook("So, um, yeah. Let's get into it.")).toBe('So, um, yeah');
    expect(hook('Click the link in my bio to buy now and save fifty percent today only')).toBe('Click the link in my bio');
    expect(hook('')).toBe('WATCH THIS');
  });
});

describe('observed: everything after the parser already supports an empty hook title', () => {
  const fixtures = loadV1Fixtures();
  const noHook = (direction: VisualDirection): VisualDirection => ({...direction, hookTitle: '', hookStartSec: undefined, hookEndSec: undefined});

  it.each(fixtures.map(fixture => [fixture.id, fixture] as const))('%s: planner + conflict validator + ledger + blueprint schema accept a no-title plan', async (_id, fixture) => {
    const result = await replayV1(fixture, deps, 'identity', noHook);
    expect(result.plan.hookTitle).toBe('');
    // no hook ledger entry is created, no hook edit reaches the conflict validator, the blueprint field is an empty string
    expect(result.plan.ledger!.entries().filter(entry => entry.type === 'hook_title')).toEqual([]);
    const edits = buildConflictEdits({durationSec: result.timeline.outputDurationSec, hook: {text: '', start: 0, end: 0, anchor: 'top_left'}, captionDirection: {position: 'bottom', bottomFrac: 0.2}, speaker: {box: {x: 0.18, y: 0.16, w: 0.64, h: 0.62}, source: 'fallback'}} as never, ledgerIdResolver(result.plan.ledger!));
    expect(edits.some(edit => edit.type === 'hook_title')).toBe(false);
    expect(timelineBlueprintSchema.shape.hookTitle.parse('')).toBe('');
    // every machine invariant (survival, refusal precision, determinism, preservation, no silent no-op, conflict-stable) still holds
    const permuted = [{label: 'reverse', result: await replayV1(fixture, deps, 'reverse', noHook)}];
    expect(runAll(result, permuted, schemas).filter(item => !item.pass).map(item => `${item.id}: ${item.failures.join('; ')}`)).toEqual([]);
    // the other edits are unaffected by the missing title: same clips and zooms as with a title
    const withHook = await replayV1(fixture, deps, 'identity');
    expect(result.plan.clips.map(clip => clip.start)).toEqual(withHook.plan.clips.map(clip => clip.start));
    expect(result.zoomTriggers.map(zoom => zoom.start)).toEqual(withHook.zoomTriggers.map(zoom => zoom.start));
  });
});
