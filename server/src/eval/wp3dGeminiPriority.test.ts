/**
 * WP3D pure tests: with a Gemini request cap, the Director (then occupancy, then the content profile) keeps one reserved attempt, and everything else, asset descriptions
 * included, draws only from what is left. The pipeline is SIMULATED with direct calls to the chokepoint's reservation function: no request is made. Import graph:
 * lib/geminiEditBudget.ts -> lib/errors.ts -> lib/billingGuard.ts (node:async_hooks only). The call sites and http.ts import the logger and are checked by reading their source.
 * No logger, `.env`, SDK, FFmpeg, Chromium or network.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {
  classifyGeminiLabel,
  createGeminiEditBudget,
  GEMINI_HOST,
  geminiBudgetFromLimit,
  RESERVED_CLASSES,
  RESERVED_LABELS,
  reserveGeminiAttempt,
  withGeminiBudget,
} from '../lib/geminiEditBudget.ts';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts: string[]) => readFileSync(resolve(SRC, ...parts), 'utf8');
const GEMINI = `https://${GEMINI_HOST}/v1beta/models/gemini-x:generateContent`;

const L = {
  profile: 'content profile',
  describe: 'Gemini user asset describe',
  occupancy: 'Gemini speaker occupancy',
  director: 'Gemini visual director',
  critique: 'Gemini layout critique',
  motion: 'motion graphics director',
  romanize: 'Gemini romanize captions',
  v2: 'Director v2 creative director',
  northStar: 'North-star semantic asset gate',
  delivery: 'delivery director attempt 1',
} as const;

type Sent = Record<string, number>;

/** One simulated analyze job in the pipeline's order. Every logical call tries ALL its attempts (the worst case: every attempt fails, so retries and fallbacks follow). */
async function simulate(rawCap: number, plan: {assets?: number; directorAttempts?: number; order?: 'pipeline' | 'director_first'} = {}): Promise<Sent> {
  const assets = plan.assets ?? 12;
  const directorAttempts = plan.directorAttempts ?? 4;
  const sent: Sent = {};
  const attempt = (label: string, times: number) => {
    for (let i = 0; i < times; i += 1) {
      try {
        reserveGeminiAttempt(GEMINI, label, 'broll_failed');
        sent[label] = (sent[label] ?? 0) + 1;
      } catch {
        sent[label] ??= 0;
      }
    }
  };
  const describeAssets = () => {
    for (let i = 0; i < assets; i += 1) attempt(L.describe, 2); // retries:1 => 2 attempts per asset
  };
  await withGeminiBudget(geminiBudgetFromLimit(rawCap), async () => {
    await Promise.resolve();
    attempt(L.profile, 1);
    if (plan.order === 'director_first') attempt(L.director, directorAttempts);
    describeAssets();
    attempt(L.occupancy, 1);
    if (plan.order !== 'director_first') attempt(L.director, directorAttempts);
    attempt(L.critique, 1);
    attempt(L.motion, 5);
  });
  return sent;
}

describe('the cap is unset: nothing changes', () => {
  it('no budget exists and every simulated attempt is sent', async () => {
    expect(geminiBudgetFromLimit(0)).toBeUndefined();
    expect(await simulate(0)).toEqual({[L.profile]: 1, [L.describe]: 24, [L.occupancy]: 1, [L.director]: 4, [L.critique]: 1, [L.motion]: 5});
  });
});

describe('the reservation order when the cap is smaller than the reserve', () => {
  const at = (cap: number) => createGeminiEditBudget(cap).report();
  it('hands slots out as Director, then occupancy, then the content profile; the rest is the general pool', () => {
    expect(at(1)).toMatchObject({reservedAtStart: {director: 1, occupancy: 0, content_profile: 0}, poolAtStart: 0});
    expect(at(2)).toMatchObject({reservedAtStart: {director: 1, occupancy: 1, content_profile: 0}, poolAtStart: 0});
    expect(at(3)).toMatchObject({reservedAtStart: {director: 1, occupancy: 1, content_profile: 1}, poolAtStart: 0});
    expect(at(5)).toMatchObject({reservedAtStart: {director: 1, occupancy: 1, content_profile: 1}, poolAtStart: 2});
    expect(at(100)).toMatchObject({poolAtStart: 97});
  });
  it('a zero or invalid cap reserves nothing and refuses everything', () => {
    for (const cap of [0, -3, Number.NaN]) {
      const budget = createGeminiEditBudget(cap);
      expect(budget.report().reservedAtStart).toEqual({director: 0, occupancy: 0, content_profile: 0});
      expect(budget.reserve(L.director).ok).toBe(false);
    }
  });
});

describe('cap 1: the single slot is the Director\'s', () => {
  it('sends the Director once and no asset description, occupancy or content profile', async () => {
    const sent = await simulate(1);
    expect(sent[L.director]).toBe(1);
    expect(sent[L.describe]).toBe(0);
    expect(sent[L.occupancy]).toBe(0);
    expect(sent[L.profile]).toBe(0);
    expect(Object.values(sent).reduce((a, b) => a + b, 0)).toBe(1);
  });
  it('even though the descriptions run first in the pipeline, the Director is still sendable afterwards', async () => {
    const sent = await simulate(1, {assets: 12});
    expect(sent[L.describe]).toBe(0);
    expect(sent[L.director]).toBe(1);
  });
  it('the Director gets its attempt when it is the very first call too', async () => {
    const sent = await simulate(1, {order: 'director_first'});
    expect(sent[L.director]).toBe(1);
    expect(sent[L.describe]).toBe(0);
  });
});

describe('caps 2 and 3', () => {
  it('cap 2: Director and occupancy; no content profile, no description', async () => {
    const sent = await simulate(2);
    expect([sent[L.director], sent[L.occupancy], sent[L.profile], sent[L.describe]]).toEqual([1, 1, 0, 0]);
  });
  it('cap 3: all three reserved stages send once; no description, no Director retry, nothing else', async () => {
    const sent = await simulate(3);
    expect([sent[L.director], sent[L.occupancy], sent[L.profile], sent[L.describe], sent[L.critique], sent[L.motion]]).toEqual([1, 1, 1, 0, 0, 0]);
  });
});

describe('a cap of the reserve plus two description attempts', () => {
  it('cap 5: exactly two description attempts are sent, then they stop; the reserved stages still send', async () => {
    const sent = await simulate(5);
    expect(sent[L.describe]).toBe(2);
    expect([sent[L.profile], sent[L.occupancy], sent[L.director]]).toEqual([1, 1, 1]);
    expect(sent[L.critique]).toBe(0);
    expect(Object.values(sent).reduce((a, b) => a + b, 0)).toBe(5);
  });
  it('the descriptions that find no slot get a refusal the existing per-asset fallback handles (an error, not a hang)', async () => {
    let refusedDescriptions = 0;
    await withGeminiBudget(geminiBudgetFromLimit(5), async () => {
      for (let i = 0; i < 12; i += 1) {
        try {
          reserveGeminiAttempt(GEMINI, L.describe, 'broll_failed');
        } catch (error) {
          expect((error as {code: string}).code).toBe('broll_failed');
          refusedDescriptions += 1;
        }
      }
    });
    expect(refusedDescriptions).toBe(10);
  });
  it('with the Director first, its retries take the pool and the descriptions get nothing, but the reserved stages are still intact', async () => {
    const sent = await simulate(5, {order: 'director_first'});
    expect(sent[L.director]).toBe(3); // reserved first attempt + the two pool slots
    expect(sent[L.describe]).toBe(0);
    expect([sent[L.profile], sent[L.occupancy]]).toEqual([1, 1]);
  });
  it('a large cap lets every simulated call through', async () => {
    const sent = await simulate(100);
    expect(sent).toEqual({[L.profile]: 1, [L.describe]: 24, [L.occupancy]: 1, [L.director]: 4, [L.critique]: 1, [L.motion]: 5});
  });
});

describe('reserved slots cannot be taken by other stages', () => {
  it('cap 3: every other stage is refused, then the three reserved stages still send', async () => {
    await withGeminiBudget(geminiBudgetFromLimit(3), async () => {
      for (const label of [L.describe, L.critique, L.motion, L.romanize, L.v2, L.northStar, L.delivery]) {
        for (let i = 0; i < 10; i += 1) expect(() => reserveGeminiAttempt(GEMINI, label, 'broll_failed'), label).toThrow();
      }
      for (const label of [L.director, L.occupancy, L.profile]) expect(() => reserveGeminiAttempt(GEMINI, label, 'broll_failed'), label).not.toThrow();
    });
  });
  it('a reserved stage uses its reserved slot once; its retries share the pool; a second reserved stage is not hurt', () => {
    const budget = createGeminiEditBudget(5);
    expect([1, 2, 3, 4].map(() => budget.reserve(L.director).ok)).toEqual([true, true, true, false]);
    expect(budget.reserve(L.occupancy).ok).toBe(true);
    expect(budget.reserve(L.profile).ok).toBe(true);
    expect(budget.report()).toMatchObject({attempted: 5, refused: 1, reservedUnused: {director: 0, occupancy: 0, content_profile: 0}});
  });
  it('an unused reservation stays held back from the others (stated limit): cap 5 and only descriptions gives two', async () => {
    const budget = createGeminiEditBudget(5);
    const results = Array.from({length: 10}, () => budget.reserve(L.describe).ok);
    expect(results.filter(Boolean)).toHaveLength(2);
    expect(budget.report().reservedUnused).toEqual({director: 1, occupancy: 1, content_profile: 1});
  });
  it('concurrent callers cannot exceed the cap or take a reserved slot', async () => {
    const budget = createGeminiEditBudget(6);
    const results = await Promise.all(Array.from({length: 40}, async (_, i) => {
      await Promise.resolve();
      return budget.reserve(L.describe).ok;
    }));
    expect(results.filter(Boolean)).toHaveLength(3); // 6 - 3 reserved
    expect(budget.reserve(L.director).ok).toBe(true);
    expect(budget.reserve(L.occupancy).ok).toBe(true);
    expect(budget.reserve(L.profile).ok).toBe(true);
  });
});

describe('what is and is not reserved', () => {
  it('exactly three exact labels are reserved', () => {
    expect(RESERVED_CLASSES).toEqual(['director', 'occupancy', 'content_profile']);
    expect(classifyGeminiLabel(L.director)).toBe('director');
    expect(classifyGeminiLabel(L.occupancy)).toBe('occupancy');
    expect(classifyGeminiLabel(L.profile)).toBe('content_profile');
    expect(Object.keys(RESERVED_LABELS)).toHaveLength(3);
  });
  it('asset descriptions, romanization, directorV2, North Star and every other stage are not reserved', () => {
    for (const label of [L.describe, L.critique, L.motion, L.romanize, 'Gemini hinglish captions', L.v2, 'Director v2 repair', 'Director v2 story analyst', L.northStar, 'North-star proxy composite critic', L.delivery, 'delivery emphasis marker', '', 'toString', '__proto__', 'Gemini visual director '.toUpperCase()]) {
      expect(classifyGeminiLabel(label), label).toBe('other');
    }
  });
});

describe('wiring (source text; the call sites and http.ts import the logger)', () => {
  it('each reserved label is exactly what its call site passes to the chokepoint', () => {
    expect(read('stages', 'broll', 'geminiDirector.ts')).toContain("label: 'Gemini visual director',");
    expect(read('stages', 'layout', 'occupancy.ts')).toContain("label: 'Gemini speaker occupancy',");
    expect(read('stages', 'contentProfile', 'contentProfile.ts')).toContain("label: 'content profile',");
    expect(read('stages', 'directorV2', 'geminiClient.ts')).toContain('label: input.label,'); // a callDirectorModel label reaches requestJson unchanged
    expect(read('stages', 'broll', 'userBrollDescribe.ts')).toContain("label: 'Gemini user asset describe',");
  });
  it('the chokepoint is unchanged since WP3C: one reservation call, no priority option on RequestOptions, retry logic untouched', () => {
    const http = read('lib', 'http.ts');
    expect(http.match(/reserveGeminiAttempt\(/g)).toHaveLength(1);
    expect(http).toContain('reserveGeminiAttempt(url, label, failureCode);');
    const options = http.slice(http.indexOf('export type RequestOptions = {'), http.indexOf('};', http.indexOf('export type RequestOptions = {')));
    expect(options).not.toMatch(/priority|reserve|class/i);
  });
  it('the pipeline order is not changed: the runner and analyzeVideo are as in WP3C', () => {
    expect(read('pipeline', 'analysisRunner.ts')).toContain('withGeminiBudget(geminiBudgetFromLimit(env.GEMINI_EDIT_MAX_REQUESTS, geminiBudgetPlanFor(extras.editProfile)), () => analyzeVideo(');
    const av = read('pipeline', 'analyzeVideo.ts');
    expect(av).toContain('const geminiBudget = currentGeminiBudget();');
    expect(av.indexOf('describeUserBrollAssets(')).toBeLessThan(av.indexOf('measureOccupancy({'));
  });
  it('the experiment guard and runner are untouched and do not import the budget; the default and the env value are unchanged', () => {
    for (const path of ['lib/spendGuard.ts', 'lib/experimentMode.ts', 'lib/claudeBudget.ts', 'lib/productClaudeBudget.ts']) expect(read(...path.split('/'))).not.toContain('geminiEditBudget');
    const env = read('config', 'env.ts');
    expect(env).toContain('GEMINI_EDIT_MAX_REQUESTS: num(0),');
    expect(env).toContain("PRODUCT_EDIT_PROFILE: str('cuts')");
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED: bool\(false\)/);
  });
});
