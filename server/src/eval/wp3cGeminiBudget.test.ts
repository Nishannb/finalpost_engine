/**
 * WP3C pure tests of the per-edit Gemini request cap. The counter is injected (a budget object), the "attempts" are direct calls to the reservation function, and no request is
 * made. Import graph: lib/geminiEditBudget.ts -> lib/errors.ts -> lib/billingGuard.ts (node:async_hooks only). `lib/http.ts`, `analysisRunner.ts` and `analyzeVideo.ts` import the
 * logger, so their wiring is proved by reading their source. No logger, `.env`, SDK, FFmpeg, Chromium or network.
 */
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {
  createGeminiEditBudget,
  currentGeminiBudget,
  GEMINI_HOST,
  GeminiBudgetError,
  geminiBudgetFromLimit,
  isGeminiUrl,
  reserveGeminiAttempt,
  withGeminiBudget,
} from '../lib/geminiEditBudget.ts';
import type {EngineErrorCode} from '../lib/errors.ts';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts: string[]) => readFileSync(resolve(SRC, ...parts), 'utf8');
// WP3D: the default budget now reserves slots for the Director, occupancy and the content profile. These WP3C tests are about the counting itself, with generic labels, so they use
// the plain counter (no reservations); the reservation behaviour has its own tests in wp3dGeminiPriority.test.ts.
const plain = (n: number) => createGeminiEditBudget(n, {reservations: []});

const GEMINI = `https://${GEMINI_HOST}/v1beta/models/gemini-x:generateContent`;

describe('the budget object', () => {
  it('allows exactly the cap, then refuses without counting the refusals as attempts', () => {
    const budget = plain(3);
    expect([1, 2, 3, 4, 5].map(() => budget.reserve('Director').ok)).toEqual([true, true, true, false, false]);
    expect(budget.report()).toMatchObject({maxRequests: 3, attempted: 3, refused: 2, stopped: true});
  });
  it('records attempts per label (labels only) and reports not stopped until a refusal happens', () => {
    const budget = plain(5);
    budget.reserve('Director');
    budget.reserve('Director');
    budget.reserve('asset describe');
    expect(budget.report()).toMatchObject({maxRequests: 5, attempted: 3, refused: 0, stopped: false, byLabel: {Director: 2, 'asset describe': 1}});
  });
  it('a zero or invalid cap refuses everything', () => {
    for (const cap of [0, -1, Number.NaN, 0.4]) expect(plain(cap).reserve('x').ok, String(cap)).toBe(false);
  });
  it('concurrent callers cannot take more than the cap (the reservation is synchronous)', async () => {
    const budget = plain(4);
    const results = await Promise.all(Array.from({length: 25}, async (_, i) => {
      await Promise.resolve();
      if (i % 2) await new Promise(resolve => setTimeout(resolve, 1));
      return budget.reserve(`call${i % 3}`).ok;
    }));
    expect(results.filter(Boolean)).toHaveLength(4);
    expect(budget.report()).toMatchObject({attempted: 4, refused: 21});
  });
  it('the report is a copy (callers cannot change the count through it)', () => {
    const budget = plain(2);
    budget.reserve('a');
    const report = budget.report();
    report.byLabel.a = 99;
    report.attempted = 99;
    expect(budget.report()).toMatchObject({attempted: 1, byLabel: {a: 1}});
  });
});

describe('the env value', () => {
  it('unset or 0: no budget at all (today\'s behaviour)', () => {
    expect(geminiBudgetFromLimit(0)).toBeUndefined();
  });
  it('a positive number is that many attempts (rounded down)', () => {
    expect(geminiBudgetFromLimit(7)!.report().maxRequests).toBe(7);
    expect(geminiBudgetFromLimit(7.9)!.report().maxRequests).toBe(7);
  });
  it('negative, NaN, infinite or sub-one values fail closed: no Gemini request is allowed', () => {
    for (const raw of [-1, Number.NaN, Number.POSITIVE_INFINITY, 0.5]) {
      const budget = geminiBudgetFromLimit(raw);
      expect(budget, String(raw)).toBeDefined();
      expect(budget!.reserve('x').ok, String(raw)).toBe(false);
    }
  });
});

describe('the scope and the chokepoint call', () => {
  it('outside a scope nothing is counted and nothing throws, however many attempts', () => {
    expect(currentGeminiBudget()).toBeUndefined();
    for (let i = 0; i < 100; i += 1) expect(() => reserveGeminiAttempt(GEMINI, 'Director', 'broll_failed')).not.toThrow();
  });
  it('withGeminiBudget(undefined, fn) just runs fn', async () => {
    expect(await withGeminiBudget(undefined, async () => currentGeminiBudget())).toBeUndefined();
  });
  it('inside a scope only Gemini attempts take a slot; other hosts and bad URLs are not counted', async () => {
    const budget = plain(2);
    await withGeminiBudget(budget, async () => {
      reserveGeminiAttempt('https://api.groq.com/openai/v1/audio/transcriptions', 'ASR', 'transcribe_failed');
      reserveGeminiAttempt('https://api.pexels.com/videos/search', 'stock', 'broll_failed');
      reserveGeminiAttempt('not a url', 'x', 'broll_failed');
      reserveGeminiAttempt(`https://example.com/?next=${GEMINI}`, 'y', 'broll_failed');
      expect(budget.report().attempted).toBe(0);
      reserveGeminiAttempt(GEMINI, 'Director', 'broll_failed');
      reserveGeminiAttempt(GEMINI, 'Director retry', 'broll_failed');
      expect(() => reserveGeminiAttempt(GEMINI, 'Director fallback model', 'broll_failed')).toThrow(GeminiBudgetError);
    });
    expect(budget.report()).toMatchObject({attempted: 2, refused: 1});
  });
  it('the scope follows awaits and timers, so a retry later in the same job is counted', async () => {
    const budget = plain(3);
    await withGeminiBudget(budget, async () => {
      reserveGeminiAttempt(GEMINI, 'a', 'broll_failed');
      await new Promise(resolve => setTimeout(resolve, 2));
      reserveGeminiAttempt(GEMINI, 'b', 'broll_failed');
      await Promise.resolve();
      expect(currentGeminiBudget()).toBe(budget);
    });
    expect(budget.report().attempted).toBe(2);
    expect(currentGeminiBudget()).toBeUndefined();
  });
  it('two jobs running at the same time keep separate budgets', async () => {
    const a = plain(2);
    const b = plain(5);
    const job = (budget: typeof a, attempts: number) =>
      withGeminiBudget(budget, async () => {
        let refused = 0;
        for (let i = 0; i < attempts; i += 1) {
          await new Promise(resolve => setTimeout(resolve, 1));
          try {
            reserveGeminiAttempt(GEMINI, 'x', 'broll_failed');
          } catch {
            refused += 1;
          }
        }
        return refused;
      });
    const [ra, rb] = await Promise.all([job(a, 6), job(b, 6)]);
    expect([ra, rb]).toEqual([4, 1]);
    expect(a.report().attempted).toBe(2);
    expect(b.report().attempted).toBe(5);
  });
  it('isGeminiUrl matches the host exactly', () => {
    expect(isGeminiUrl(GEMINI)).toBe(true);
    expect(isGeminiUrl(`https://evil.${GEMINI_HOST}.example.com/x`)).toBe(false);
    expect(isGeminiUrl(`https://sub.${GEMINI_HOST}/x`)).toBe(false);
  });
});

describe('what a refusal looks like to the stage', () => {
  const codes: EngineErrorCode[] = ['broll_failed', 'render_failed', 'transcribe_failed', 'internal'];
  it('keeps the caller\'s failure code, so the existing catch / fallback runs as for any failed call', () => {
    for (const code of codes) {
      const error = new GeminiBudgetError('Visual Director', code);
      expect(error.code).toBe(code);
      expect(error.name).toBe('EngineError');
    }
  });
  it('is never reported as a timeout (some callers answer a timeout with one more request)', () => {
    expect(new GeminiBudgetError('x', 'upstream_timeout').code).toBe('internal');
  });
  it('says nothing about the URL, key, prompt, credits or billing', () => {
    const error = new GeminiBudgetError('Visual Director', 'broll_failed');
    expect(error.message).toBe("Visual Director was not sent: this edit's request limit was reached");
    expect(error.message).not.toMatch(/https?:|key|credit|billing|quota|402|googleapis/i);
    expect(JSON.stringify(error.details)).toBe('{"reason":"edit_request_limit"}');
  });
});

// ---- wiring and coverage, by reading source --------------------------------------------------------------------------------------------------------------------
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? (name === 'node_modules' ? [] : walk(path)) : [path];
  });
const sources = walk(SRC).filter(path => path.endsWith('.ts') && !path.endsWith('.test.ts')).map(path => relative(SRC, path));

describe('the chokepoint (source text; http.ts imports the logger)', () => {
  const http = read('lib', 'http.ts');
  it('every attempt takes a slot before it is sent: inside the attempt loop, before the timer, the log record and the fetch', () => {
    const call = http.indexOf('reserveGeminiAttempt(url, label, failureCode);');
    expect(call).toBeGreaterThan(http.indexOf('for (let attempt = 0; attempt <= retries; attempt += 1) {'));
    expect(call).toBeLessThan(http.indexOf('new AbortController()'));
    expect(call).toBeLessThan(http.indexOf('observe(() => ({type: \'http_request\''));
    expect(call).toBeLessThan(http.indexOf('await fetch(url, {'));
    expect(http.match(/reserveGeminiAttempt\(/g)).toHaveLength(1); // the one call (the import has no parenthesis)
    expect(http.match(/\bfetch\(/g)).toHaveLength(1);
  });
  it('the retry sleep and the retry decision are untouched', () => {
    expect(http).toContain('await sleep(250 * 2 ** attempt + Math.floor(Math.random() * 150));');
    expect(http).toContain('const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);');
  });
});

describe('coverage: every Gemini request of the analyze job passes the chokepoint (source text)', () => {
  const HOST = ['generativelanguage', 'googleapis', 'com'].join('.');
  const geminiFiles = sources.filter(path => !path.startsWith('eval/') && !path.startsWith('scripts/') && path !== 'lib/spendGuard.ts' && read(path).includes(HOST));
  it('there are Gemini call sites to check, and each one goes through requestJson / requestWithRetry and has no raw fetch', () => {
    expect(geminiFiles.length).toBeGreaterThanOrEqual(8);
    for (const path of geminiFiles) {
      const text = read(path);
      expect(/\brequestJson\s*[<(]|\brequestWithRetry\s*\(/.test(text), path).toBe(true);
      expect(/\bfetch\s*\(/.test(text), path).toBe(false);
    }
  });
  it('the files that call the Director helpers (no URL of their own) have no raw fetch either', () => {
    for (const path of sources.filter(p => !p.startsWith('eval/') && !p.startsWith('scripts/') && /\bcallDirectorModel\s*\(/.test(read(p)))) {
      expect(/\bfetch\s*\(/.test(read(path)), path).toBe(false);
    }
  });
  it('the only raw fetch calls in the server are the transport, the webhook and auth: none of them builds a Gemini URL (WP4A: the downloader now uses node:http through pinnedGet)', () => {
    const rawFetch = sources.filter(path => !path.startsWith('eval/') && !path.startsWith('scripts/') && path !== 'lib/spendGuard.ts' && /\bfetch\s*\(/.test(read(path))).sort();
    expect(rawFetch).toEqual(['http/auth.ts', 'http/notifyCreator.ts', 'lib/http.ts']);
    for (const path of rawFetch) expect(read(path).includes(HOST), path).toBe(false);
  });
  it('the Gemini call sites listed here include the stages the task names', () => {
    for (const path of ['stages/broll/geminiDirector.ts', 'stages/broll/userBrollDescribe.ts', 'stages/directorV2/geminiClient.ts', 'stages/layout/occupancy.ts', 'stages/layout/layoutCritique.ts', 'stages/broll/romanizeCaptions.ts']) {
      expect(geminiFiles, path).toContain(path);
    }
    // content profile, motion Director, delivery planner and the North Star gates reach Gemini through callDirectorModel in directorV2/geminiClient.ts
    for (const path of ['stages/contentProfile/contentProfile.ts', 'stages/motionDirector/motionDirector.ts', 'stages/audio/deliveryPlanner.ts']) expect(read(path)).toMatch(/\bcallDirectorModel\b/);
  });
});

describe('activation: server env only; the experiment guard is separate (source text)', () => {
  it('only http.ts, analysisRunner.ts, analyzeVideo.ts and the first-video script import the budget; the experiment guard and runner do not', () => {
    const importers = sources.filter(path => path !== 'lib/geminiEditBudget.ts' && /geminiEditBudget\.ts'/.test(read(path))).sort();
    // scripts/firstVideo.ts now takes the same profile boundary and wraps its analyzeVideo call with the same env-derived budget (an edit made after WP3C, found while running WP6A's checks).
    // lib/styleRun.ts (edit styles, Phase 2) imports only the budget PLANS (pure data) to pick a styled job's plan; it creates no budget.
    expect(importers).toEqual(['lib/http.ts', 'lib/styleRun.ts', 'pipeline/analysisRunner.ts', 'pipeline/analyzeVideo.ts', 'scripts/firstVideo.ts']);
    for (const path of ['lib/spendGuard.ts', 'lib/experimentMode.ts', 'lib/claudeBudget.ts', 'lib/productClaudeBudget.ts']) expect(read(path)).not.toContain('geminiEditBudget');
  });
  it('the cap comes from the environment only: default 0, no dollar variable, nothing in the HTTP layer', () => {
    const env = read('config', 'env.ts');
    expect(env).toContain('GEMINI_EDIT_MAX_REQUESTS: num(0),');
    expect(env).not.toContain('GEMINI_EDIT_BUDGET_USD');
    for (const path of sources.filter(p => p.startsWith('http/'))) expect(read(path), path).not.toMatch(/GEMINI_EDIT|geminiEditBudget|geminiBudget/);
  });
  it('analysisRunner wraps only the analyzeVideo call, from the env value', () => {
    const runner = read('pipeline', 'analysisRunner.ts');
    // Edit styles (Phase 2): the budget is built by geminiBudgetFor, which is the env value exactly as before for every unstyled job (a styled job gets its style's cap).
    expect(runner).toContain('const geminiBudget = geminiBudgetFor(extras);');
    expect(runner).toContain('withGeminiBudget(geminiBudget, () => analyzeVideo(');
    expect(runner).toContain('return geminiBudgetFromLimit(env.GEMINI_EDIT_MAX_REQUESTS, geminiBudgetPlanFor(extras.editProfile));');
    expect(runner.match(/withGeminiBudget\(/g)).toHaveLength(1);
  });
  it('analyzeVideo reports the budget as warnings (counts only) before the blueprint is assembled, and throws nothing', () => {
    const av = read('pipeline', 'analyzeVideo.ts');
    expect(av).toContain('const geminiBudget = currentGeminiBudget();');
    expect(av).toContain('warnings.push(`gemini_budget:${spend.attempted}/${spend.maxRequests}`);');
    expect(av).toContain('warnings.push(`gemini_budget_stopped:${spend.refused}_refused`);');
    expect(av.indexOf('const geminiBudget = currentGeminiBudget();')).toBeLessThan(av.indexOf('const blueprint: TimelineBlueprint = {'));
  });
  it('the profile and the other defaults are unchanged', () => {
    const env = read('config', 'env.ts');
    expect(env).toContain("PRODUCT_EDIT_PROFILE: str('cuts')");
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED: bool\(false\)/);
  });
});
