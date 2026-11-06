/**
 * Free basic-captions path: Groq transcription + caption render only. (A) behavior: inside a withNoGemini scope every Gemini
 * request is refused BEFORE it is sent and no nested budget can widen that; (B) source pins: the gate in analyzeVideo, the runner
 * and the captions-edit job keep the free path off speech cuts, the AI keep-plan, the Director, B-roll, motion graphics (Claude)
 * and teleprompter clean. No network, no model call.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {afterEach, describe, expect, it, vi} from 'vitest';

import {
  createGeminiEditBudget,
  currentGeminiBudget,
  GEMINI_HOST,
  reserveGeminiAttempt,
  withGeminiBudget,
  withNoGemini,
} from '../lib/geminiEditBudget.ts';
import {requestWithRetry} from '../lib/http.ts';

const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...parts: string[]) => readFileSync(resolve(SERVER, ...parts), 'utf8');
const geminiUrl = `https://${GEMINI_HOST}/v1beta/models/x:generateContent`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('A: withNoGemini refuses every Gemini request before it is sent', () => {
  it('refuses every label, including the reserved Director / keep-plan / romanization ones', async () => {
    await withNoGemini(async () => {
      for (const label of ['Gemini visual director', 'cuts ai keep plan', 'Director v2 creative director', 'content profile', 'romanization', 'anything else']) {
        expect(() => reserveGeminiAttempt(geminiUrl, label, 'internal'), label).toThrow(/request limit was reached/);
      }
      expect(currentGeminiBudget()?.report().attempted).toBe(0);
    });
  });

  it('a nested withGeminiBudget (a configured server cap) cannot widen the zero budget', async () => {
    await withNoGemini(() =>
      withGeminiBudget(createGeminiEditBudget(50), async () => {
        expect(() => reserveGeminiAttempt(geminiUrl, 'Gemini visual director', 'internal')).toThrow();
      }),
    );
  });

  it('the real HTTP choke point never reaches fetch for a Gemini URL', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await withNoGemini(async () => {
      await expect(requestWithRetry(geminiUrl, {method: 'POST', label: 'Gemini visual director', retries: 0})).rejects.toThrow(/request limit/);
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('outside the scope, and for a full (Pro) job, nothing changes: no budget unless the server configures one', async () => {
    expect(currentGeminiBudget()).toBeUndefined();
    expect(() => reserveGeminiAttempt(geminiUrl, 'Gemini visual director', 'internal')).not.toThrow();
    await withGeminiBudget(createGeminiEditBudget(3), async () => {
      expect(() => reserveGeminiAttempt(geminiUrl, 'Gemini visual director', 'internal')).not.toThrow();
    });
  });
});

describe('B: the free path is gated in the analysis code (source pins)', () => {
  const analyze = read('src/pipeline/analyzeVideo.ts');
  const runner = read('src/pipeline/analysisRunner.ts');
  const captions = read('src/pipeline/captionsEditRunner.ts');
  const route = read('src/http/routes/editRoutes.ts');

  it('analyzeVideo forces the legacy profile and a captions-only list, and turns every paid stage off, before anything else runs', () => {
    const gate = analyze.slice(analyze.indexOf('if (input.basicCaptions) {'), analyze.indexOf('const basicCaptions = Boolean(input.basicCaptions);'));
    for (const piece of [
      "editProfile: 'legacy'",
      "requestedEdits: ['captions']",
      'teleprompterClean: false',
      'directorV2: false',
      'northStar: false',
      'forceDeliveryShaping: false',
      'generatedGraphicsEnabled: false',
      'userBrollUrls: []',
    ]) {
      expect(gate, piece).toContain(piece);
    }
    // The gate sits before the profile switches are derived from the input.
    expect(analyze.indexOf('if (input.basicCaptions) {')).toBeLessThan(analyze.indexOf('const speechCutsOn ='));
    expect(analyze).toContain('const northStar = !basicCaptions && Boolean(input.northStar || flags.northStar);'); // flags = the job's EffectiveFlags (env unless a style pins it)
    expect(analyze).toContain('const directorV2 = !basicCaptions && Boolean(input.directorV2 || flags.directorV2 || northStar);');
  });

  it('legacy means no speech cuts, so the keep-plan, denoise and retake branches are never entered', () => {
    expect(analyze).toContain("const speechCutsOn = input.editProfile === 'cuts' || input.editProfile === 'polish';");
    expect(analyze).toContain('if (speechCutsOn && env.CUTS_AI_KEEP_PLAN && env.GEMINI_API_KEY) {');
    expect(analyze).toContain('if (speechCutsOn && env.CUTS_DENOISE_ENABLED) {');
    // Captions-only + not teleprompter clean + not speech cuts = the silence trim is skipped.
    expect(analyze).toContain('(captionsOnly && !teleprompterClean && !speechCutsOn) ||');
    // A captions-only edit takes the captionsOnlyVisualPlan branch: no Director, no B-roll planner.
    expect(analyze).toContain('if (captionsOnly) {');
  });

  it('the runner: legacy profile, a Gemini deny-all scope, no script, and a cache key that cannot collide with a full job', () => {
    expect(runner).toContain("extras = {...extras, editProfile: 'legacy'};");
    expect(runner).toContain('basicCaptions ? withNoGemini(fn) : fn()');
    expect(runner).toContain("teleprompterClean: false, scriptText: undefined");
    expect(runner).toContain("scriptKey: basicCaptions ? 'basic_captions' : scriptKey,");
    expect(runner).toContain('basicCaptions: extras.basicCaptions,');
  });

  it('the captions job passes basicCaptions only for mode basic_captions, never for teleprompter_clean, and the route accepts the mode', () => {
    expect(captions).toContain("basicCaptions: job.mode === 'basic_captions',");
    expect(captions).toContain("input.mode === 'basic_captions'");
    expect(route).toContain("'basic_captions'");
    expect(route).toMatch(/z\.enum\(\['captions', 'teleprompter_clean', 'basic_captions'/);
  });

  it('the free render does not trim (trimEnabled follows teleprompterClean only) and keeps CaptionKit / Remotion as before', () => {
    expect(captions).toContain('trimEnabled: teleprompterClean,');
    expect(captions).toContain('burnCaptionsWithCaptionKit(');
    expect(captions).toContain('brollEnabled: false,');
    expect(captions).toContain('zoomEnabled: false,');
  });
});
