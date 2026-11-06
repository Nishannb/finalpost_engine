/**
 * WP3Z pure tests: the cache key carries the request's graphics decision when it is on or skipped_budget, and is unchanged when it is off. lib/productEditProfile.ts is pure (no import). The store
 * (env, logger via env) and the runner are read as text; a stand-in for the key's array-and-join, built with the same conditional-spread rule the store source shows, checks the byte-level claims.
 * No provider call, render, FFmpeg or network.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {graphicsFingerprintKey, requestGraphicsStatus, type JobGraphicsStatus, type ProductEditProfile} from '../lib/productEditProfile.ts';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts: string[]) => readFileSync(resolve(SRC, ...parts), 'utf8');
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

/** The store's key parts for a request, in the store's order: the shared parts, then the optional profile fragment, then the optional graphics fragment, joined with `|`. */
const key = (profile: string, graphics: string, base = 'url|en|0.5|0.1|1.2|8|visual|3|model|||') =>
  [base, ...(profile ? [profile] : []), ...(graphics ? [graphics] : [])].join('|');
const keyBefore = (profile: string, base = 'url|en|0.5|0.1|1.2|8|visual|3|model|||') => [base, ...(profile ? [profile] : [])].join('|'); // the key before this package

const server = (profile: ProductEditProfile, graphicsFlag: boolean, capUsd: number) => requestGraphicsStatus({profile, graphicsFlag, capUsd, maxRequests: 0, maxTokensPerCall: 0});

describe('the fragment', () => {
  it('is empty for off and distinct for the other two', () => {
    expect(graphicsFingerprintKey('off')).toBe('');
    expect(graphicsFingerprintKey('on')).toBe('graphics:on');
    expect(graphicsFingerprintKey('skipped_budget')).toBe('graphics:skipped_budget');
  });
});

describe('the key', () => {
  it('off matches today\'s key byte for byte, legacy (no profile fragment) and mvp', () => {
    expect(key('', graphicsFingerprintKey('off'))).toBe(keyBefore(''));
    expect(key('edit-profile:mvp-v1', graphicsFingerprintKey('off'))).toBe(keyBefore('edit-profile:mvp-v1'));
  });
  it('on does not match an off entry, and off does not match an on entry', () => {
    for (const profile of ['', 'edit-profile:mvp-v1']) {
      expect(key(profile, graphicsFingerprintKey('on'))).not.toBe(key(profile, graphicsFingerprintKey('off')));
      expect(key(profile, graphicsFingerprintKey('on'))).not.toBe(keyBefore(profile));
    }
  });
  it('skipped_budget does not match on, and does not match off', () => {
    for (const profile of ['', 'edit-profile:mvp-v1']) {
      const keys = (['off', 'on', 'skipped_budget'] as JobGraphicsStatus[]).map(status => key(profile, graphicsFingerprintKey(status)));
      expect(new Set(keys).size).toBe(3);
    }
  });
  it('the graphics fragment cannot be confused with the profile fragment or a base part', () => {
    expect(graphicsFingerprintKey('on')).not.toMatch(/^edit-profile:/);
    expect(key('', 'graphics:on')).not.toBe(key('edit-profile:mvp-v1', ''));
  });
});

describe('the decision this request would make now (the same helpers as analyzeVideo)', () => {
  it('flag off: off in both profiles whatever the budget', () => {
    for (const profile of ['legacy', 'mvp'] as const) for (const cap of [0, 5, -1]) expect(server(profile, false, cap)).toBe('off');
  });
  it('legacy, flag on, no cap: on; usable cap: on', () => {
    expect(server('legacy', true, 0)).toBe('on');
    expect(server('legacy', true, 3)).toBe('on');
  });
  it('mvp, flag on: usable cap on, missing cap skipped_budget, invalid cap skipped_budget', () => {
    expect(server('mvp', true, 3)).toBe('on');
    expect(server('mvp', true, 0)).toBe('skipped_budget');
    expect(server('mvp', true, -1)).toBe('skipped_budget');
  });
  it('a legacy job with the default flag keeps its key', () => {
    expect(graphicsFingerprintKey(server('legacy', false, 0))).toBe('');
  });
});

describe('wiring (source text)', () => {
  const store = stripComments(read('store', 'engineStore.ts'));
  const runner = stripComments(read('pipeline', 'analysisRunner.ts'));
  const schemas = read('http', 'schemas.ts');
  it('the store adds the fragment with the same conditional spread as the profile fragment, after it, and the join is unchanged', () => {
    const profile = store.indexOf('...(input.editProfileKey ? [input.editProfileKey] : []),');
    const graphics = store.indexOf('...(input.graphicsKey ? [input.graphicsKey] : []),');
    expect(profile).toBeGreaterThan(0);
    expect(graphics).toBeGreaterThan(profile);
    // Edit styles (Phase 2) append one more optional fragment after it, with the same empty-means-absent rule, then the join.
    const style = store.indexOf('...(input.styleKey ? [input.styleKey] : []),');
    expect(style).toBeGreaterThan(graphics);
    expect(store.slice(style, style + 120)).toContain("].join('|')");
    expect(store).toContain('graphicsKey?: string;');
  });
  it('the runner computes the decision from server configuration before the lookup, and does not read the stored blueprint for it', () => {
    const start = runner.slice(runner.indexOf('export async function startAnalysis'), runner.indexOf('async function runAnalysis'));
    const decision = start.indexOf('const graphicsAtRequest = requestGraphicsStatus({');
    const fingerprint = start.indexOf('const fingerprint = fingerprintSource({');
    const lookup = start.indexOf('loadBlueprintByFingerprint(fingerprint)');
    expect(decision).toBeGreaterThan(0);
    expect(decision).toBeLessThan(fingerprint);
    expect(fingerprint).toBeLessThan(lookup);
    expect(start.slice(decision, fingerprint)).toContain('graphicsFlag: effectiveFlags.motionGraphics');
    expect(start.slice(decision, fingerprint)).toContain('capUsd: effectiveFlags.libraryOnlyGraphics ? 0 : env.CLAUDE_EDIT_BUDGET_USD');
    expect(start.slice(decision, fingerprint)).not.toMatch(/loadBlueprint|cached|input\./);
    expect(start).toContain('graphicsKey: graphicsFingerprintKey(graphicsAtRequest),');
  });
  it('no HTTP body can set the status', () => {
    expect(schemas).not.toMatch(/graphics:|graphicsKey|graphicsStatus|editProfile/);
    expect(stripComments(read('http', 'routes', 'analyzeRoutes.ts'))).not.toMatch(/graphicsKey|graphicsFingerprintKey|requestGraphicsStatus/);
  });
  it('the other caller of fingerprintSource passes no graphics fragment, so its keys are unchanged', () => {
    expect(stripComments(read('scripts', 'firstVideo.ts'))).not.toContain('graphicsKey');
  });
  it('the defaults are untouched', () => {
    const env = stripComments(read('config', 'env.ts'));
    expect(env).toMatch(/PRODUCT_EDIT_PROFILE:[^\n]*cuts/);
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED:\s*bool\(false\)/);
  });
});
