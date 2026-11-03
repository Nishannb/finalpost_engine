/**
 * WP5D tests: an mvp edit with no Gemini attempt cap says so (gemini_edit_budget_unconfigured). lib/geminiEditBudget.ts is pure (node:async_hooks and the error taxonomy only); analyzeVideo.ts
 * (logger) and env.ts are read as text. No render, no Chromium, no network, no model call. The four unsafe suites are not run.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {GEMINI_BUDGET_UNCONFIGURED_WARNING, geminiBudgetFromLimit, geminiBudgetUnconfiguredWarning} from '../lib/geminiEditBudget.ts';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts: string[]) => readFileSync(resolve(SRC, ...parts), 'utf8');
const stripComments = (source: string) => source.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

describe('geminiBudgetUnconfiguredWarning', () => {
  it('mvp with the cap unset or 0 returns the exact string', () => {
    expect(geminiBudgetUnconfiguredWarning('mvp', 0)).toBe('gemini_edit_budget_unconfigured');
    expect(geminiBudgetUnconfiguredWarning('mvp', -0)).toBe('gemini_edit_budget_unconfigured');
    expect(GEMINI_BUDGET_UNCONFIGURED_WARNING).toBe('gemini_edit_budget_unconfigured');
  });
  it('mvp with a positive cap returns null', () => {
    for (const cap of [1, 5, 10, 100, 2.5]) expect(geminiBudgetUnconfiguredWarning('mvp', cap), String(cap)).toBeNull();
  });
  it('legacy (or an unset profile) never warns, whatever the cap', () => {
    for (const profile of ['legacy', undefined] as const) for (const cap of [0, 5, -1, NaN]) expect(geminiBudgetUnconfiguredWarning(profile, cap), `${profile} ${cap}`).toBeNull();
  });
  it('negative, NaN and infinite values follow geminiBudgetFromLimit: they fail closed (a zero budget), so they are a configured budget and give null', () => {
    for (const cap of [-1, -100, NaN, Infinity, -Infinity]) {
      const budget = geminiBudgetFromLimit(cap);
      expect(budget, String(cap)).toBeDefined(); // a budget exists (fail closed), not "no budget"
      expect(geminiBudgetUnconfiguredWarning('mvp', cap), String(cap)).toBeNull();
    }
  });
  it('is true exactly when geminiBudgetFromLimit returns no budget, on mvp (the same sense as the budget code)', () => {
    for (const cap of [0, 1, 2, 10, -1, NaN, 0.5, Infinity]) {
      expect(geminiBudgetUnconfiguredWarning('mvp', cap) !== null, String(cap)).toBe(geminiBudgetFromLimit(cap) === undefined);
    }
  });
  it('is deterministic and returns only the string or null', () => {
    for (const [profile, cap] of [['mvp', 0], ['mvp', 3], ['legacy', 0]] as const) {
      const out = geminiBudgetUnconfiguredWarning(profile, cap);
      expect(out === null || out === 'gemini_edit_budget_unconfigured').toBe(true);
    }
  });
});

describe('the call site and what is not changed (source text)', () => {
  const analyze = stripComments(read('pipeline', 'analyzeVideo.ts'));
  const env = stripComments(read('config', 'env.ts'));
  const budget = stripComments(read('lib', 'geminiEditBudget.ts'));
  it('analyzeVideo pushes it once, from the profile and the configured cap, only when non-null, right after the Claude-bound warning', () => {
    expect(analyze.match(/geminiBudgetUnconfiguredWarning\(/g)).toHaveLength(1);
    expect(analyze).toContain('const geminiUncapped = geminiBudgetUnconfiguredWarning(input.editProfile, env.GEMINI_EDIT_MAX_REQUESTS);');
    expect(analyze).toContain('if (geminiUncapped) {\n      warnings.push(geminiUncapped);\n    }');
    expect(analyze.indexOf('geminiBudgetUnconfiguredWarning(')).toBeGreaterThan(analyze.indexOf('warnings.push(`claude_graphics_disabled:${claudeBound.reason}`);'));
    expect(analyze).toContain("import {currentGeminiBudget, geminiBudgetUnconfiguredWarning} from '../lib/geminiEditBudget.ts';");
  });
  it('it is only a warning: the job is not refused (no throw or return near the call) and the Claude bound logic is as before', () => {
    const at = analyze.indexOf('const geminiUncapped');
    const block = analyze.slice(at, at + 260);
    expect(block).not.toMatch(/throw|return|EngineError/);
    expect(analyze).toContain('const claudeBound = decideClaudeBound({');
    expect(analyze).toContain("warnings.push(`claude_graphics_disabled:${claudeBound.reason}`);");
  });
  it('the default of GEMINI_EDIT_MAX_REQUESTS and the budget semantics are unchanged', () => {
    expect(env).toContain('GEMINI_EDIT_MAX_REQUESTS: num(0),');
    expect(budget).toContain('if (raw === 0) return undefined;');
    expect(budget).toContain('if (!Number.isFinite(raw) || raw < 0) return createGeminiEditBudget(0, {plan});');
    expect(budget).toContain('return createGeminiEditBudget(raw, {plan});');
  });
  it('the helper module stays logger-free (async_hooks and the error taxonomy only)', () => {
    expect([...budget.matchAll(/^import .* from '([^']+)'/gm)].map(match => match[1]).sort()).toEqual(['./errors.ts', './productEditProfile.ts', 'node:async_hooks']); // WP8A: the shared mvp-like profile helper (itself import-free)
  });
  it('the runner still wraps the job with the budget from the same variable', () => {
    expect(stripComments(read('pipeline', 'analysisRunner.ts'))).toContain('withGeminiBudget(geminiBudgetFromLimit(env.GEMINI_EDIT_MAX_REQUESTS, geminiBudgetPlanFor(extras.editProfile))');
  });
  it('the other defaults are untouched', () => {
    expect(env).toMatch(/PRODUCT_EDIT_PROFILE:[^\n]*cuts/);
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED:\s*bool\(false\)/);
    expect(env).toContain('CLAUDE_EDIT_BUDGET_USD: num(0),');
  });
});
