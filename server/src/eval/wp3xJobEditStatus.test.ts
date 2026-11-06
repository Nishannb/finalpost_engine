/**
 * WP3X pure tests: the analysis job record says which profile ran and whether generated graphics ran. lib/productEditProfile.ts is pure (no import); the runner, analyzeVideo, the route and
 * the request schema (logger / SDK paths) are read as text. No provider call, render, FFmpeg or network.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {decideClaudeBound, jobGraphicsStatus, normalizeEditProfile, type ProductEditProfile} from '../lib/productEditProfile.ts';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts: string[]) => readFileSync(resolve(SRC, ...parts), 'utf8');
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

const decide = (profile: ProductEditProfile, graphicsOn: boolean, capUsd: number, callerSuppliedGenerator = false) =>
  decideClaudeBound({profile, graphicsOn, callerSuppliedGenerator, capUsd, maxRequests: 0, maxTokensPerCall: 0, defaultMaxRequests: 12});
const status = (profile: ProductEditProfile, requested: boolean, capUsd: number, callerSuppliedGenerator = false) =>
  jobGraphicsStatus({requested, bound: decide(profile, requested, capUsd, callerSuppliedGenerator)});

describe('graphics status from the decision the server already makes', () => {
  it('flag off: off, in both profiles and whatever the budget', () => {
    for (const profile of ['legacy', 'mvp'] as const) for (const cap of [0, 5, -1, NaN]) expect(status(profile, false, cap)).toBe('off');
  });
  it('legacy, flag on, no cap configured: on (today\'s unbounded behaviour)', () => {
    expect(status('legacy', true, 0)).toBe('on');
  });
  it('legacy, flag on, a usable cap: on', () => {
    expect(status('legacy', true, 2.5)).toBe('on');
  });
  it('mvp, flag on, a usable cap: on', () => {
    expect(status('mvp', true, 2.5)).toBe('on');
  });
  it('mvp, flag on, budget missing: skipped_budget', () => {
    expect(status('mvp', true, 0)).toBe('skipped_budget');
  });
  it('flag on, budget invalid (negative or NaN), either profile: skipped_budget', () => {
    for (const profile of ['legacy', 'mvp'] as const) for (const cap of [-1, NaN]) expect(status(profile, true, cap)).toBe('skipped_budget');
  });
  it('a caller-supplied generator is bounded by its caller: on', () => {
    expect(status('mvp', true, 0, true)).toBe('on');
  });
  it('is exactly: off iff not requested; skipped_budget iff requested and disabled; on otherwise', () => {
    for (const profile of ['legacy', 'mvp'] as const) {
      for (const requested of [false, true]) {
        for (const cap of [0, 1, -1, NaN]) {
          const bound = decide(profile, requested, cap);
          const expected = !requested ? 'off' : bound.action === 'disabled' ? 'skipped_budget' : 'on';
          expect(jobGraphicsStatus({requested, bound})).toBe(expected);
        }
      }
    }
  });
});

describe('the profile the job reports', () => {
  it('is the normalised server configuration (WP7C): the exact strings mvp and legacy opt out, everything else is cuts', () => {
    expect(normalizeEditProfile('mvp')).toBe('mvp');
    expect(normalizeEditProfile('legacy')).toBe('legacy');
    for (const raw of [undefined, null, '', 'MVP', 'mvp ', 'true', 1]) expect(normalizeEditProfile(raw)).toBe('cuts');
  });
  it('the default PRODUCT_EDIT_PROFILE is unchanged (read as text)', () => {
    expect(stripComments(read('config', 'env.ts'))).toMatch(/PRODUCT_EDIT_PROFILE:[^\n]*cuts/);
  });
});

describe('wiring (source text)', () => {
  const runner = stripComments(read('pipeline', 'analysisRunner.ts'));
  const analyze = stripComments(read('pipeline', 'analyzeVideo.ts'));
  const routes = stripComments(read('http', 'routes', 'analyzeRoutes.ts'));
  const schemas = read('http', 'schemas.ts');
  const types = read('types', 'blueprint.ts');
  it('the job type carries both optional fields', () => {
    const job = types.slice(types.indexOf('export type AnalysisJob'), types.indexOf('export type RenderJobStatus'));
    expect(job).toContain("editProfile?: 'legacy' | 'mvp' | 'cuts' | 'polish';");
    expect(job).toContain("graphics?: 'off' | 'on' | 'skipped_budget' | 'library_only';");
  });
  it('the runner sets editProfile on a new job and on a cache hit, from the server-resolved profile only', () => {
    expect(runner).toContain('const envProfile = normalizeEditProfile(env.PRODUCT_EDIT_PROFILE);');
    // Edit styles (Phase 2): a styled job takes its style's pinned profile (lib/styleRun.ts, server-side registry); still never the request body.
    expect(runner).toContain('const editProfile = styleRun ? styleRun.profile : envProfile;');
    expect(runner.match(/^\s*editProfile,/gm)!.length).toBeGreaterThanOrEqual(3); // cached job, queued job, runAnalysis extras
    expect(runner).not.toMatch(/editProfile:\s*input\./);
    expect(runner).not.toMatch(/graphics:\s*input\./);
  });
  it('the runner records graphics only through the analyzer\'s decision hook', () => {
    expect(runner).toContain('onGraphicsDecision: graphics => {');
    expect(runner).toContain('void patch(job.status, job.progress, {graphics});');
    expect(runner.match(/\bgraphics\b/g)!.length).toBeLessThan(10);
  });
  it('analyzeVideo reports the decision once, right after it makes it, from the same two values', () => {
    expect(analyze.match(/hooks\.onGraphicsDecision\?\./g)).toHaveLength(1);
    const decision = analyze.indexOf('const motionGraphicsOn = motionGraphicsRequested && (claudeAllowed || libraryOnly);');
    const report = analyze.indexOf('hooks.onGraphicsDecision?.(jobGraphicsStatus({requested: motionGraphicsRequested, bound: claudeBound, libraryOnly}));');
    expect(decision).toBeGreaterThan(0);
    expect(report).toBeGreaterThan(decision);
    expect(report - decision).toBeLessThan(200);
  });
  it('no HTTP body can set the fields: the request schema has neither name, and the start input has no such field', () => {
    expect(schemas).not.toMatch(/editProfile|graphics:|graphicsStatus/);
    expect(routes).not.toMatch(/editProfile|\bgraphics\b/);
    const start = runner.slice(runner.indexOf('export async function startAnalysis'), runner.indexOf('}): Promise<AnalysisJob>'));
    expect(start).not.toMatch(/editProfile|graphics/);
  });
  it('the poll route returns the stored job as it is, so the fields reach the app', () => {
    expect(routes).toContain('res.json({ok: true, job});');
  });
  it('the mapping module stays pure and the defaults are untouched', () => {
    expect(stripComments(read('lib', 'productEditProfile.ts'))).not.toMatch(/^import /m);
    expect(stripComments(read('config', 'env.ts'))).toMatch(/MOTION_GRAPHICS_ENABLED:\s*bool\(false\)/);
  });
});
