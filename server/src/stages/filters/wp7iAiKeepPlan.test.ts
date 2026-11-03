/**
 * WP7I offline tests: the AI keep-plan module (prompt, parse, apply + guards), a hand-authored response for the REAL dump transcript (bp_d01c80609acf4209a22d), the model call with `fetch`
 * stubbed (no network), and source pins for the analyzeVideo wiring. No live model, no audio, no video.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {afterEach, describe, expect, it, vi} from 'vitest';

import {env} from '../../config/env.ts';
import {buildCutsDebugDump} from '../../lib/cutsDebugDump.ts';
import type {WordToken} from '../../types/blueprint.ts';
import {keepSegmentsFor} from './autoTrim.ts';
import {buildCaptionWords} from './autoZoom.ts';
import {applyAiKeepPlan, buildKeepPlanPrompt, buildKeepPlanSegments, parseKeepPlan, requestAiKeepPlan} from './cutsAiKeepPlan.ts';
import {buildTimeline} from './timeline.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const dump = JSON.parse(readFileSync(resolve(HERE, 'fixtures/bp_d01c80609acf4209a22d.words.json'), 'utf8')) as {sourceDurationSec: number; words: WordToken[]};
const RESPONSE = readFileSync(resolve(HERE, 'fixtures/bp_d01c80609acf4209a22d.aiKeepPlan.response.json'), 'utf8');
const DURATION = dump.sourceDurationSec;

function captionsFor(exclusions: Array<{start: number; end: number}>) {
  const timeline = buildTimeline(keepSegmentsFor(exclusions, DURATION));
  return buildCaptionWords(dump.words, timeline, exclusions).map(word => word.text).join(' ');
}
const count = (text: string, phrase: RegExp) => (text.match(phrase) ?? []).length;

describe('segments and prompt', () => {
  const segments = buildKeepPlanSegments(dump.words);
  it('numbers the real transcript into sentence / pause segments with source seconds', () => {
    expect(segments).toHaveLength(19);
    expect(segments[0]).toMatchObject({index: 1, text: 'This is exactly how Figma revolutionized'});
    expect(segments[3]).toMatchObject({index: 4, start: 13.1, end: 18.74});
    expect(segments.at(-1)!.text).toBe('Now the solution.');
  });
  it('the prompt states the product goal, the strict schema and lists every segment', () => {
    const {system, user} = buildKeepPlanPrompt(segments, DURATION);
    expect(system).toMatch(/JSON only/);
    for (const needle of ['exactly ONE source range', 'coach', 'yeah', '"keep":[{"start"']) expect(user).toContain(needle);
    expect(user).toContain('[19] 89.08-91.92 Now the solution.');
  });
  it('hesitation sounds are not listed', () => {
    const text = buildKeepPlanSegments([{text: 'hello', start: 0, end: 0.3}, {text: 'um', start: 0.31, end: 0.5}, {text: 'there.', start: 0.51, end: 0.9}]).map(s => s.text);
    expect(text).toEqual(['hello there.']);
  });
});

describe('parseKeepPlan', () => {
  it('reads plain and fenced JSON, drops malformed ranges, rejects other shapes', () => {
    expect(parseKeepPlan('{"keep":[{"start":1,"end":2,"reason":"r"}],"notes":"n"}')).toEqual({keep: [{start: 1, end: 2, reason: 'r'}], notes: 'n'});
    expect(parseKeepPlan('```json\n{"keep":[{"start":1,"end":2},{"start":"x","end":3},null]}\n```')!.keep).toEqual([{start: 1, end: 2}]);
    for (const bad of ['', 'not json', '[]', '{"drop":[]}', '{"keep":"all"}']) expect(parseKeepPlan(bad), bad).toBeNull();
  });
});

describe('the real dump transcript with the hand-authored keep plan', () => {
  const plan = parseKeepPlan(RESPONSE)!;
  const applied = applyAiKeepPlan({words: dump.words, plan, sourceDurationSec: DURATION});
  it('is accepted by every guard', () => {
    expect(applied.ok).toBe(true);
  });
  const result = applied as Extract<typeof applied, {ok: true}>;
  const captions = captionsFor(result.exclusions);
  it('kept text passes the product assertions: no orphan Redefined, one Figma-raised take, one pitch-deck line, no yeah, no doubled Collaboration', () => {
    expect(captions).not.toMatch(/revolutionized\s*$/);
    expect(captions).not.toContain('Redefined');
    expect(count(captions, /This is exactly how Figma/g)).toBe(1);
    expect(count(captions, /Figma raised/g)).toBe(1);
    expect(captions).toContain('Figma raised millions by solving a single problem'); // WP7K: the 3.18 s "raised" take is swapped for the fluent sibling
    expect(count(captions, /pitch deck/g)).toBe(1);
    expect(captions).not.toMatch(/\byeah\b/i);
    expect(captions).not.toMatch(/Collaboration\./);
    expect(captions).not.toContain('sorted it out');
    expect(count(captions, /productivity/g)).toBe(1);
    expect(captions).toBe(
      'This is exactly how Figma revolutionized the space for collaborative design. ' +
        'Figma raised millions by solving a single problem that every design team faces. ' +
        "Here's how pitch deck brought their vision to fruition. " +
        "highlighted how design tools weren't built for collaborative efforts. " +
        'Creating bottlenecks in productivity. ' +
        "That's the problem right there.", // WP7K: stuck their / Figma / traditional / Now (>= 1.5 s) are cut out
    );
  });
  it('exclusions are sorted, non-overlapping and inside [0, duration]; kept ranges match the plan', () => {
    for (const [i, range] of result.exclusions.entries()) {
      expect(range.start).toBeGreaterThanOrEqual(0);
      expect(range.end).toBeLessThanOrEqual(DURATION);
      expect(range.end).toBeGreaterThan(range.start);
      if (i > 0) expect(range.start).toBeGreaterThan(result.exclusions[i - 1]!.end);
    }
    expect(result.keepRanges).toHaveLength(6); // the two adjacent kept stretches (70.8-80.48, 81.46-83.42) share one run: only dead air sits between them
    expect(result.removedSpeechFrac).toBeLessThanOrEqual(0.8);
  });
  it('a replay is deterministic', () => {
    expect(applyAiKeepPlan({words: dump.words, plan, sourceDurationSec: DURATION})).toEqual(applied);
  });
});

describe('guards fall back (ok:false with a reason)', () => {
  const run = (keep: Array<{start: number; end: number}>, words = dump.words) => applyAiKeepPlan({words, plan: {keep}, sourceDurationSec: DURATION});
  it('empty / missing plan', () => {
    expect(applyAiKeepPlan({words: dump.words, plan: null, sourceDurationSec: DURATION})).toMatchObject({ok: false, reason: 'empty_plan'});
    expect(run([])).toMatchObject({ok: false, reason: 'empty_plan'});
  });
  it('ranges outside the video or zero-length are unusable', () => {
    expect(run([{start: 500, end: 600}])).toMatchObject({ok: false, reason: 'invalid_ranges'});
    expect(run([{start: 3, end: 3.01}])).toMatchObject({ok: false, reason: 'invalid_ranges'});
  });
  it('a plan that matches no word is an empty timeline', () => {
    expect(run([{start: 4, end: 5.5}])).toMatchObject({ok: false, reason: 'empty_timeline'});
  });
  it('keeping almost nothing is refused', () => {
    expect(run([{start: 81.46, end: 83.42}])).toMatchObject({ok: false, reason: 'too_little_kept'});
  });
  it('removing more than 80% of the speech is refused', () => {
    let t = 0;
    const synthetic = Array.from({length: 30}, (_, i) => {
      const word = {text: `w${i}`, start: t, end: t + (i < 10 ? 0.1 : 0.9)};
      t = word.end + 0.05;
      return word;
    });
    expect(applyAiKeepPlan({words: synthetic, plan: {keep: [{start: 0, end: synthetic[9]!.end}]}, sourceDurationSec: t + 1})).toMatchObject({ok: false, reason: 'would_remove_too_much'});
  });
  it('no words', () => {
    expect(run([{start: 0, end: 5}], [])).toMatchObject({ok: false, reason: 'no_words'});
  });
  it('swapped start/end and ranges past the end are clamped, not rejected', () => {
    const result = run([{start: 49.42, end: 5}, {start: 58.2, end: 9999}]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.exclusions.at(-1)!.end).toBeLessThanOrEqual(DURATION);
  });
});

describe('requestAiKeepPlan (fetch stubbed, nothing leaves the process)', () => {
  const e = env as unknown as {GEMINI_API_KEY: string};
  const original = e.GEMINI_API_KEY;
  afterEach(() => {
    vi.unstubAllGlobals();
    e.GEMINI_API_KEY = original;
  });
  const gemini = (text: string) => new Response(JSON.stringify({candidates: [{content: {parts: [{text}]}}]}), {status: 200});

  it('sends ONE text-only request and parses the recorded response', async () => {
    e.GEMINI_API_KEY = 'offline-test-key';
    const seen: Array<{url: string; body: string}> = [];
    vi.stubGlobal('fetch', async (url: string | URL, init?: {body?: unknown}) => {
      seen.push({url: String(url), body: String(init?.body ?? '')});
      return gemini(RESPONSE);
    });
    const result = await requestAiKeepPlan({words: dump.words, sourceDurationSec: DURATION, model: 'test-model'});
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toContain('/models/test-model:generateContent');
    expect(seen[0]!.body).toContain('[4] 13.1-18.74 This is exactly how Figma revolutionized the space');
    expect(seen[0]!.body).not.toMatch(/inlineData|fileData/);
    expect(result.plan!.keep).toHaveLength(6);
    expect(result.model).toBe('test-model');
  });
  it('invalid JSON from the model -> no plan, reason invalid_response', async () => {
    e.GEMINI_API_KEY = 'offline-test-key';
    vi.stubGlobal('fetch', async () => gemini('sure! here you go'));
    expect(await requestAiKeepPlan({words: dump.words, sourceDurationSec: DURATION})).toMatchObject({plan: null, reason: 'invalid_response'});
  });
  it('a failing model never throws: reason model_failed', async () => {
    e.GEMINI_API_KEY = 'offline-test-key';
    vi.stubGlobal('fetch', async () => new Response('boom', {status: 400}));
    expect(await requestAiKeepPlan({words: dump.words, sourceDurationSec: DURATION})).toMatchObject({plan: null, reason: 'model_failed'});
  });
});

describe('wiring pins', () => {
  const analyze = readFileSync(resolve(HERE, '..', '..', 'pipeline', 'analyzeVideo.ts'), 'utf8');
  it('analyzeVideo calls the keep-plan module on the cuts path only, with the flag and the fallback warnings', () => {
    expect(analyze).toContain("import {applyAiKeepPlan, requestAiKeepPlan} from '../stages/filters/cutsAiKeepPlan.ts';");
    expect(analyze).toContain('if (speechCutsOn && env.CUTS_AI_KEEP_PLAN && env.GEMINI_API_KEY) {');
    expect(analyze).toContain('await requestAiKeepPlan({words: activeWords, sourceDurationSec: activeDurationSec})');
    expect(analyze).toContain('cuts_ai_keep_plan_applied:');
    expect(analyze).toContain('cuts_ai_keep_plan_skipped:');
    expect(analyze).toContain('...(cutsAiApplied ? {skip: true} : {})');
    expect(analyze).toContain('const removalCap = cutsAiApplied ? CUTS_AI_MAX_TIMELINE_REMOVAL : maxRemoval;');
    expect(analyze).toContain('aiKeepPlan: cutsAiDebug');
  });
  it('no visual model is switched on: the visual flags still key off cutsPath', () => {
    expect(analyze).toContain('const visualEditsOn = !cutsOnlyVisualsOff && visualToolkitsRequested(requestedEdits);');
    expect(analyze).toContain('const motionGraphicsRequested = !cutsOnlyVisualsOff &&');
    expect(readFileSync(resolve(HERE, '..', '..', 'config', 'env.ts'), 'utf8')).toMatch(/CUTS_AI_KEEP_PLAN: bool\(true\)/);
  });
  it('the debug dump carries aiKeepPlan when given', () => {
    const built = buildCutsDebugDump({
      blueprintId: 'bp_x', editProfile: 'cuts', sourceDurationSec: 1, words: [], trimExclusions: [], droppedTakes: 0, restarts: 0, echoes: 0, captionWords: [],
      aiKeepPlan: {model: 'm', applied: true, raw: '{}', normalizedKeep: [{start: 0, end: 1}], exclusions: []},
    });
    expect(built).toHaveProperty('aiKeepPlan.model', 'm');
    expect(buildCutsDebugDump({...{blueprintId: 'bp_x', editProfile: 'cuts', sourceDurationSec: 1, words: [], trimExclusions: [], droppedTakes: 0, restarts: 0, echoes: 0, captionWords: []}})).not.toHaveProperty('aiKeepPlan');
  });
});
