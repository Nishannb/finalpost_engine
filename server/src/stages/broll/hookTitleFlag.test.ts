/**
 * HOOK_TITLE_POLICY, end to end and offline. The HTTP layer is mocked, so the REAL planVisualDirection → parser → planBRoll →
 * finalizeEdits chain runs and its model request can be inspected. Nothing is sent anywhere.
 */
import {createHash} from 'node:crypto';

import {afterEach, describe, expect, it, vi} from 'vitest';

import {env} from '../../config/env.ts';
import {outcomeOf} from '../../lib/editLedger.ts';
import {compileCreativePlan} from '../directorV2/compiler.ts';
import type {CreativePlan, PerceptionPack} from '../directorV2/types.ts';
import {buildTimeline} from '../filters/timeline.ts';
import {loadV1Fixtures} from '../../eval/fixtures.ts';
import {finalizeEdits} from '../../pipeline/finalizeEdits.ts';
import {timelineBlueprintSchema} from '../../../../remotion/src/blueprintSchema.ts';
import {cleanHookTitle, fallbackVisualDirection, parseVisualDirectorJson} from './geminiDirector.ts';
import {fallbackMotionPlan} from './motionGraphicsPlan.ts';

const captured = vi.hoisted(() => ({bodies: [] as Array<Record<string, any>>, responseText: ''}));
vi.mock('../../lib/http.ts', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/http.ts')>()),
  requestJson: async (_url: string, options: {body?: string}) => {
    captured.bodies.push(JSON.parse(options.body ?? '{}'));
    return {candidates: [{content: {parts: [{text: captured.responseText}]}}], usageMetadata: {promptTokenCount: 1, candidatesTokenCount: 1}};
  },
}));
vi.mock('./stockSearch.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('./stockSearch.ts')>();
  const asset = (query: unknown) => {
    const id = parseInt(createHash('sha1').update(String(query)).digest('hex').slice(0, 7), 16);
    return {assetUrl: `https://stock.invalid/${id}.mp4`, provider: 'pexels' as const, providerId: id, width: 1080, height: 1920, durationSec: 12, credit: 's', creditUrl: ''};
  };
  return {...actual, stockConfigured: () => true, findBRollAsset: async (q: unknown) => asset(q), findPhotoAsset: async (q: unknown) => asset(q), listBRollAssets: async (q: unknown) => [asset(q), asset(`${String(q)}/2`)]};
});
const {planBRoll} = await import('./brollPlanner.ts');

const e = env as unknown as {HOOK_TITLE_POLICY: string; GEMINI_API_KEY: string};
const original = {policy: e.HOOK_TITLE_POLICY, key: e.GEMINI_API_KEY};
afterEach(() => {
  e.HOOK_TITLE_POLICY = original.policy;
  e.GEMINI_API_KEY = original.key;
  captured.bodies.length = 0;
});
const withPolicy = (policy: 'placeholder' | 'optional') => {
  e.HOOK_TITLE_POLICY = policy;
};

const record = (hook: unknown) => JSON.stringify({topic: 't', ...(hook === undefined ? {} : {hook_title: hook}), moments: [{timestamp: 8, search_keyword: 'sunset', media: 'video', layout: 'cutaway'}], caption: {}});
const ABSENT = [undefined, null, '', '   ', '\n\t '] as const;

describe('flag default', () => {
  it('HOOK_TITLE_POLICY defaults to placeholder (and OCCUPANCY_CONTEXT_V2 to off)', () => {
    expect(original.policy).toBe('placeholder');
    expect(env.OCCUPANCY_CONTEXT_V2).toBe(false);
  });
});

describe('parser', () => {
  it.each(ABSENT)('placeholder: hook_title=%j → "WATCH THIS" (unchanged)', hook => {
    withPolicy('placeholder');
    expect(parseVisualDirectorJson(record(hook), 40, 'T.').hookTitle).toBe('WATCH THIS');
  });

  it.each(ABSENT)('optional: hook_title=%j → no title', hook => {
    withPolicy('optional');
    expect(parseVisualDirectorJson(record(hook), 40, 'T.').hookTitle).toBe('');
  });

  it.each(['placeholder', 'optional'] as const)('%s: a real title renders normally and is cleaned the same way', policy => {
    withPolicy(policy);
    expect(parseVisualDirectorJson(record('  The Quietest   Moments Speak Loudest Today Friend '), 40, 'T.').hookTitle).toBe('The Quietest Moments Speak Loudest Today');
    expect(parseVisualDirectorJson(record('Silence Speaks'), 40, 'T.').hookTitle).toBe('Silence Speaks');
    expect(cleanHookTitle('   ')).toBe('');
  });
});

describe('model request (prompt text unchanged; only the schema "required" list follows the policy)', () => {
  const direct = async (policy: 'placeholder' | 'optional', hook: unknown) => {
    withPolicy(policy);
    e.GEMINI_API_KEY = 'test-key';
    captured.responseText = record(hook);
    const {planVisualDirection} = await import('./geminiDirector.ts');
    const direction = await planVisualDirection({transcript: 'Have you ever noticed how quiet moments speak. Today we explore silence.', sourceDurationSec: 40, momentCount: 3});
    return {direction, body: captured.bodies.at(-1)!};
  };

  it('placeholder: the Director omitting a title yields "WATCH THIS", and hook_title stays required', async () => {
    const {direction, body} = await direct('placeholder', undefined);
    expect(direction.hookTitle).toBe('WATCH THIS');
    expect(body.generationConfig.responseSchema.required).toEqual(['hook_title', 'moments', 'topic', 'caption']);
  });

  it('optional: an omitted title yields NO title (the transcript-derived fallback is not substituted) and hook_title is not required', async () => {
    const {direction, body} = await direct('optional', undefined);
    expect(direction.hookTitle).toBe('');
    expect(body.generationConfig.responseSchema.required).toEqual(['moments', 'topic', 'caption']);
  });

  it('the system instruction and the user prompt are byte-identical under both policies', async () => {
    const a = await direct('placeholder', 'Silence Speaks');
    const b = await direct('optional', 'Silence Speaks');
    expect(b.body.systemInstruction).toEqual(a.body.systemInstruction);
    expect(b.body.contents).toEqual(a.body.contents);
    expect(b.direction.hookTitle).toBe('Silence Speaks');
    expect(a.direction.hookTitle).toBe('Silence Speaks');
  });
});

describe('Director-less fallback and the motion-graphics placeholder', () => {
  const transcript = 'Have you ever noticed how the quietest moments speak the loudest? Today we explore silence.';

  it('placeholder: the fallback uses a transcript snippet as the hook (unchanged)', () => {
    withPolicy('placeholder');
    expect(fallbackVisualDirection({transcript, sourceDurationSec: 30, momentCount: 1}).hookTitle).toBe('Have you ever noticed how the');
  });

  it('optional: the fallback invents no title, but topic and style are still derived', () => {
    withPolicy('optional');
    const fallback = fallbackVisualDirection({transcript, sourceDurationSec: 30, momentCount: 1});
    expect(fallback.hookTitle).toBe('');
    expect(fallback.topic).toBe('Have you ever noticed how the');
    expect(fallback.hookStyle).toBeTruthy();
  });

  it('placeholder: with no phrase and no title the kinetic fallback shows "WATCH THIS" (unchanged); optional shows nothing', () => {
    withPolicy('placeholder');
    expect(fallbackMotionPlan({transcript: '', durationSec: 20, hookTitle: ''}).motionGraphics.map(item => item.text)).toContain('WATCH THIS');
    withPolicy('optional');
    expect(fallbackMotionPlan({transcript: '', durationSec: 20, hookTitle: ''}).motionGraphics).toEqual([]);
  });

  it('optional keeps a real phrase: only the placeholder is removed', () => {
    withPolicy('optional');
    expect(fallbackMotionPlan({transcript: 'Silence deepens emotional connection between partners.', durationSec: 20, hookTitle: ''}).motionGraphics.length).toBeGreaterThan(0);
  });
});

describe('planner, ledger, conflict validator, blueprint (real chain, saved response with the hook removed)', () => {
  const fixture = loadV1Fixtures().find(item => item.id.startsWith('v1-hi-relationship'))!;
  const withoutHook = JSON.stringify((() => {
    const raw = JSON.parse(fixture.rawResponse);
    delete raw.hook_title;
    delete raw.hookTitle;
    return raw;
  })());

  const run = async (policy: 'placeholder' | 'optional') => {
    withPolicy(policy);
    e.GEMINI_API_KEY = 'test-key';
    captured.responseText = withoutHook;
    const timeline = buildTimeline(fixture.keepSegments as never);
    const plan = await planBRoll({transcript: fixture.transcript, sourceDurationSec: fixture.sourceDurationSec, timeline, words: fixture.words as never, captionWords: fixture.captionWords as never, requestedEdits: fixture.requestedEdits} as never);
    const ledger = plan.ledger!;
    const finalized = finalizeEdits({
      ledger, contentProfile: null, footageLuminance: 0.4, captionLocked: false, durationSec: timeline.outputDurationSec,
      hook: {text: plan.hookTitle, start: plan.hookStartSec ?? 0, end: (plan.hookStartSec ?? 0) + Math.max(1.2, plan.hookDurationSec || 0), anchor: 'top_left'},
      caption: plan.caption, brollClips: plan.clips, visualOverlays: plan.overlays, insetReveals: plan.insetReveals, frameInsets: plan.frameInsets, mediaContainers: plan.mediaContainers,
      motionGraphics: plan.motionGraphics, semanticEmphasis: plan.semanticEmphasis, depthOverlays: plan.depthOverlays, transitions: plan.transitions, zoomTriggers: [], generatedGraphics: [],
      speaker: {box: {x: 0.18, y: 0.16, w: 0.64, h: 0.62}, source: 'fallback'}, speakerCutout: {available: false},
    });
    return {plan, ledger, finalized};
  };

  it('placeholder (default): the omitted title becomes "WATCH THIS", is proposed, accepted and handed to HookTitle', async () => {
    const {plan, ledger} = await run('placeholder');
    expect(plan.hookTitle).toBe('WATCH THIS');
    expect(plan.hookDurationSec).toBeGreaterThan(0);
    const hook = ledger.entries().filter(entry => entry.type === 'hook_title');
    expect(hook).toHaveLength(1);
    expect(outcomeOf(hook[0]!)).toBe('rendered');
    expect(hook[0]!.events.at(-1)).toMatchObject({track: 'HookTitle', visibility: 'visible'});
  });

  it('optional: no title, no time window, no ledger entry, no hook conflict edit, nothing recorded as rendered', async () => {
    const {plan, ledger, finalized} = await run('optional');
    expect(plan.hookTitle).toBe('');
    expect(plan.hookStartSec).toBe(0);
    expect(plan.hookDurationSec).toBe(0);
    expect(ledger.entries().filter(entry => entry.type === 'hook_title')).toEqual([]);
    expect(ledger.entries().some(entry => entry.events.some(event => event.track === 'HookTitle'))).toBe(false);
    expect(finalized.decisions.some(decision => decision.id.startsWith('hook_title'))).toBe(false);
    // every other edit is still resolved (no entry left merely proposed or accepted)
    expect(ledger.entries().filter(entry => ['proposed_only', 'accepted_not_rendered'].includes(outcomeOf(entry)))).toEqual([]);
  });

  it('optional changes nothing else: the same clips, zooms-free transitions and inset reveals as the placeholder run', async () => {
    const a = await run('placeholder');
    const b = await run('optional');
    expect(b.plan.clips.map(clip => [clip.start, clip.end])).toEqual(a.plan.clips.map(clip => [clip.start, clip.end]));
    expect(b.plan.insetReveals.map(clip => clip.start)).toEqual(a.plan.insetReveals.map(clip => clip.start));
    expect(b.plan.transitions.map(item => item.at)).toEqual(a.plan.transitions.map(item => item.at));
  });

  it('the blueprint accepts the empty title and the renderer draws no hook element for it', async () => {
    expect(timelineBlueprintSchema.shape.hookTitle.parse('')).toBe('');
    const {readFileSync} = await import('node:fs');
    const {join, dirname} = await import('node:path');
    const {fileURLToPath} = await import('node:url');
    const short = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../../remotion/src/ShortVideo.tsx'), 'utf8');
    expect(short).toMatch(/\{blueprint\.hookTitle \? \(\s*<[\s\S]*?HookTitle/);
  });
});

describe('v2', () => {
  const words = Array.from({length: 40}, (_, i) => ({id: `w${i}`, text: `w${i}`, start: i * 0.5, end: i * 0.5 + 0.45, sentenceId: 's0'}));
  const pack = {words, sentences: [], userAssets: [], occupancySlices: [], outputDurationSec: 20, speakerCutoutAvailable: false, requestedEdits: []} as unknown as PerceptionPack;
  const plan = (hookTitle: string): CreativePlan => ({editThesis: 't', editThesisParts: {} as never, hookTitle, hookStyle: 'bold' as never, caption: undefined as never, preferredLutId: '', suggestedLutIds: [], elements: [], estimatedCostUsd: 0, promptVersion: 'x', inputHash: 'x', raw: {}}) as unknown as CreativePlan;

  it('no hook element: the direction has no title under both policies (v2 never substituted one); only the placeholder policy warns hook_missing', async () => {
    withPolicy('placeholder');
    const a = await compileCreativePlan({pack, plan: plan(''), noRepair: true});
    withPolicy('optional');
    const b = await compileCreativePlan({pack, plan: plan(''), noRepair: true});
    expect(a.direction.hookTitle).toBe('');
    expect(b.direction.hookTitle).toBe('');
    expect(a.assembler.sanity.some(note => note.startsWith('sanity:hook_missing'))).toBe(true);
    expect(b.assembler.sanity.some(note => note.startsWith('sanity:hook_missing'))).toBe(false);
  });
});
