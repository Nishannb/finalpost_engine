/**
 * WP1: product-path contract tests. Imports ONLY pure modules (userBrollContract, productEditProfile, productClaudeBudget -> claudeBudget) and node built-ins: no logger,
 * no `.env`, no provider SDK, no FFmpeg, no network, no real media. Source-text checks read repository files and show what the code DECLARES; they are not run-time proof.
 */
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {createBoundedClaudeGenerator} from '../lib/productClaudeBudget.ts';
import {analyzeOverridesFor, decideClaudeBound, normalizeEditProfile, profileFingerprintKey} from '../lib/productEditProfile.ts';
import {assetsOfferedToDirector, enforceUserBrollContract, isGenericAssetDescription, pickTaggedUserAsset, stillsForSlideshow, uniqueAssetsById} from '../stages/broll/userBrollContract.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(path.resolve(here, '../..', relative), 'utf8');

// Synthetic assets only (ids follow the product's positional scheme).
const asset = (n: number, kind: string, extra: Record<string, unknown> = {}) => ({id: `ub_${n}`, url: `https://creator.example/asset${n}`, kind, ...extra});
const A = [asset(1, 'clip'), asset(2, 'photo'), asset(3, 'photo'), asset(4, 'document'), asset(5, 'tall')];
const byId = new Map(A.map(a => [a.id, a]));

describe('B-roll contract: exact ids, no substitution', () => {
  it('returns the asset only for an exact, existing id', () => {
    expect(pickTaggedUserAsset('ub_3', byId)?.id).toBe('ub_3');
    for (const bad of [null, undefined, '', 'ub_99', 'UB_3', ' ub_3', 'ub_3 ', 'ub_', 'stock_1', '12345']) expect(pickTaggedUserAsset(bad as string | null | undefined, byId), String(bad)).toBeNull();
  });
  it('with no supplied B-roll nothing can be picked', () => {
    expect(pickTaggedUserAsset('ub_1', new Map())).toBeNull();
  });
  it('duplicate ids keep the first asset and are reported (a Map would silently keep the last)', () => {
    const dup = [asset(1, 'clip', {url: 'https://creator.example/first'}), asset(1, 'photo', {url: 'https://creator.example/second'}), asset(2, 'photo')];
    const result = uniqueAssetsById(dup);
    expect(result.assets.map(a => a.url)).toEqual(['https://creator.example/first', 'https://creator.example/asset2']);
    expect(result.duplicates).toEqual(['ub_1']);
    expect(uniqueAssetsById(A).duplicates).toEqual([]);
  });
  it('a still pulls in other unused stills only in the legacy mode; the contract shows just the requested asset', () => {
    const used = new Set<string>();
    expect(stillsForSlideshow(byId.get('ub_2')!, byId, used, {}).map(a => a.id)).toEqual(['ub_2', 'ub_3', 'ub_4']); // legacy: unrelated unused stills are added
    expect(stillsForSlideshow(byId.get('ub_2')!, byId, used, {userBrollOnly: true}).map(a => a.id)).toEqual(['ub_2']);
    expect(stillsForSlideshow(byId.get('ub_1')!, byId, used, {userBrollOnly: true})).toEqual([]); // a clip is not a still
    expect(stillsForSlideshow(byId.get('ub_2')!, byId, new Set(['ub_3']), {}).map(a => a.id)).toEqual(['ub_2', 'ub_4']); // legacy still skips used ones
  });
  it('assets without a real description are withheld from the Director under the contract, without renumbering anything', () => {
    const described = [{...asset(1, 'clip'), described: true}, {...asset(2, 'photo'), described: false}, {...asset(3, 'photo')}];
    expect(assetsOfferedToDirector(described, {userBrollOnly: true}).map(a => a.id)).toEqual(['ub_1', 'ub_3']); // ub_2 withheld; ub_3 keeps its id
    expect(assetsOfferedToDirector(described, {}).map(a => a.id)).toEqual(['ub_1', 'ub_2', 'ub_3']); // legacy offers all
  });
  it('recognises the placeholder captions the describer writes when it fails', () => {
    for (const generic of ['Creator-supplied still image', 'Creator-supplied visual', 'Creator B-roll clip (~12.3s)', ' Creator B-roll clip (~4s) ']) expect(isGenericAssetDescription(generic), generic).toBe(true);
    for (const real of ['A woman holds a phone at a desk', 'Screenshot of a pricing page', 'Creator-supplied still image of a red car']) expect(isGenericAssetDescription(real), real).toBe(false);
  });
});

describe('B-roll contract: backstop', () => {
  const urls = A.map(a => a.url);
  const clip = (provider: string, assetUrl: string) => ({provider, assetUrl, start: 1, end: 3});
  const overlay = (layout: string, provider: string, assetUrl: string, extra: Record<string, unknown> = {}) => ({layout, provider, assetUrl, ...extra});

  it('keeps supplied creator assets in every composition type: full-screen, top/bottom split, transparent overlay, picture-in-picture', () => {
    const overlays = ['cutaway', 'split', 'composite', 'pip', 'card', 'cutout'].map((layout, i) => overlay(layout, 'user', urls[i % urls.length]!));
    const out = enforceUserBrollContract({clips: [clip('user', urls[0]!)], overlays, depthOverlays: [], suppliedUrls: urls});
    expect(out.dropped).toEqual([]);
    expect(out.overlays.map(o => o.layout)).toEqual(['cutaway', 'split', 'composite', 'pip', 'card', 'cutout']);
    expect(out.clips).toHaveLength(1);
  });
  it('removes stock placements and creator placements whose url was never supplied, with the reason', () => {
    const out = enforceUserBrollContract({
      clips: [clip('pexels', 'https://stock.example/v'), clip('pixabay', 'https://stock.example/p'), clip('user', 'https://other.example/not-supplied'), clip('user', urls[0]!)],
      overlays: [overlay('cutaway', 'pexels', 'https://stock.example/x'), overlay('pip', 'user', 'https://other.example/y')],
      depthOverlays: [{provider: 'pexels', assetUrl: 'https://stock.example/d'}, {assetUrl: ''}],
      suppliedUrls: urls,
    });
    expect(out.clips.map(c => c.assetUrl)).toEqual([urls[0]]);
    expect(out.overlays).toEqual([]);
    expect(out.depthOverlays).toEqual([{assetUrl: ''}]); // no provider and no asset: not B-roll, left alone
    expect(out.dropped.map(d => `${d.kind}:${d.reason}`).sort()).toEqual(['clip:stock_provider', 'clip:stock_provider', 'clip:unsupplied_asset', 'depth_overlay:stock_provider', 'overlay:stock_provider', 'overlay:unsupplied_asset']);
  });
  it('drops a stock slide from a slideshow, and removes the slideshow entirely when fewer than two slides remain', () => {
    const slide = (provider: string, assetUrl: string) => ({provider, assetUrl});
    const three = overlay('split', 'user', urls[1]!, {slides: [slide('user', urls[1]!), slide('user', urls[2]!), slide('pexels', 'https://stock.example/s')]});
    const two = overlay('split', 'user', urls[1]!, {slides: [slide('user', urls[1]!), slide('pexels', 'https://stock.example/s')]});
    const out = enforceUserBrollContract({clips: [], overlays: [three, two], depthOverlays: [], suppliedUrls: urls});
    expect((out.overlays[0] as {slides: unknown[]}).slides).toHaveLength(2);
    expect((out.overlays[1] as {slides?: unknown[]}).slides).toBeUndefined();
    expect(out.dropped.filter(d => d.kind === 'slide')).toHaveLength(2);
  });
  it('leaves engine-made overlays and text-only overlays alone, and with nothing supplied still keeps non-B-roll editing', () => {
    const out = enforceUserBrollContract({clips: [], overlays: [overlay('lockup', '', ''), overlay('card', 'generated', 'https://generated.example/g')], depthOverlays: [], suppliedUrls: []});
    expect(out.overlays).toHaveLength(2);
    expect(out.dropped).toEqual([]);
  });
});

describe('B-roll contract wiring (source text; the planner itself is not executed here)', () => {
  const planner = read('src/stages/broll/brollPlanner.ts');
  it('north-star is ignored and stock is never allowed under the contract', () => {
    expect(planner).toContain('const northStar = Boolean(input.northStar) && !input.userBrollOnly;');
    expect(planner).toContain("warnings.push('user_broll_only:north_star_ignored');");
    expect(planner).toMatch(/const allowStock =\s+!input\.userBrollOnly &&/);
    expect(planner).toContain("'stock_disabled:user_broll_only'");
  });
  it('asset choice is exact-id under the contract: the picker returns first, the slideshow helper and depth planner do not substitute', () => {
    const picker = planner.slice(planner.indexOf('function pickUserBrollForMoment('), planner.indexOf('function pickUserBrollForMoment(') + 1600);
    expect(picker.indexOf('if (ctx.userBrollOnly)')).toBeLessThan(picker.indexOf('scoreUserBrollMatch'));
    expect(planner).toContain('return stillsForSlideshow(seed, ctx.userBrollById, ctx.usedUserIds, {userBrollOnly: ctx.userBrollOnly});');
    const depth = read('src/stages/broll/depthOverlayPlanner.ts');
    expect(depth).toContain('resolveUserDepthAsset(item, input.userBrollById, input.userBrollOnly)');
    expect(depth.indexOf('if (userBrollOnly) {')).toBeLessThan(depth.indexOf('assets.find(asset => asset.kind'));
  });
  it('the backstop runs before the plan is assembled and its result is what is returned', () => {
    expect(planner.indexOf('enforceUserBrollContract({')).toBeLessThan(planner.indexOf('const plan: VisualPlan = {'));
    expect(planner).toContain('clips: clipsOut.sort(');
    expect(planner).toContain('overlays: overlaysOut2,');
    expect(planner).toContain('depthOverlays: depthOut,');
  });
  it('the two assignment helpers that fill gaps with unused assets are not called anywhere (they are dead code, so they were never the cause)', () => {
    for (const file of ['src/stages/broll/brollPlanner.ts']) {
      const text = read(file);
      expect(text.match(/assignUserBrollToMoments\(/g)?.length).toBe(1); // the definition only
      expect(text.match(/injectForcedUserCutaways\(/g)?.length).toBe(1);
    }
  });
  it('asset ids stay positional (ub_<index of unique input>) and the describer records whether a real description exists', () => {
    const describer = read('src/stages/broll/userBrollDescribe.ts');
    expect(describer).toContain('const id = `ub_${i + 1}`;');
    expect(describer).toContain('described: Boolean(insight.description) && !isGenericAssetDescription(insight.description),');
  });
});

describe('product editing profile: one explicit boundary, default off', () => {
  it('WP7C: only the exact values "mvp" and "legacy" opt out; everything else (unset, empty, a typo) is the default, cuts', () => {
    expect(normalizeEditProfile('mvp')).toBe('mvp');
    expect(normalizeEditProfile('legacy')).toBe('legacy');
    for (const other of [undefined, null, '', 'MVP', 'Mvp', ' mvp', 'mvp ', 'true', '1', 'mvp2', 42]) expect(normalizeEditProfile(other), String(other)).toBe('cuts');
  });
  it('legacy adds nothing and keeps cache keys; mvp adds exactly the three options and never strict mode, provenance or graphics', () => {
    expect(analyzeOverridesFor('legacy')).toEqual({});
    expect(profileFingerprintKey('legacy')).toBe('');
    expect(analyzeOverridesFor('mvp')).toEqual({directorVideoInput: true, openingDirection: true, userBrollOnly: true});
    const keys = Object.keys(analyzeOverridesFor('mvp'));
    for (const forbidden of ['strictAiDirection', 'strictProvenance', 'generatedGraphicsEnabled', 'northStar', 'directorV2', 'motionWorkerOptions']) expect(keys).not.toContain(forbidden);
    expect(profileFingerprintKey('mvp')).not.toBe('');
  });
  it('is configured on the server only: not in any HTTP schema or route, and the cache key is extended only when non-legacy (source text)', () => {
    for (const file of ['src/http/schemas.ts', 'src/http/routes/analyzeRoutes.ts']) {
      const text = read(file);
      for (const name of ['PRODUCT_EDIT_PROFILE', 'editProfile', 'userBrollOnly', 'strictProvenance', 'CLAUDE_EDIT']) expect(text, `${file} ${name}`).not.toContain(name);
    }
    const runner = read('src/pipeline/analysisRunner.ts');
    expect(runner).toContain('normalizeEditProfile(env.PRODUCT_EDIT_PROFILE)');
    expect(runner).toContain('...analyzeOverridesFor(extras.editProfile ?? \'legacy\'),');
    expect(read('src/store/engineStore.ts')).toContain('...(input.editProfileKey ? [input.editProfileKey] : []),');
  });
  it('strict provenance and strict AI direction are not enabled by the product path (source text)', () => {
    for (const file of ['src/pipeline/analysisRunner.ts', 'src/lib/productEditProfile.ts']) {
      const text = read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(text, file).not.toMatch(/strictProvenance\s*:|strictAiDirection\s*:/);
    }
  });
});

describe('Claude bound decision: fail closed, no invented price', () => {
  const base = {profile: 'mvp' as const, graphicsOn: true, callerSuppliedGenerator: false, capUsd: 0, maxRequests: 0, maxTokensPerCall: 0, defaultMaxRequests: 15};
  it('does nothing when no graphics will be generated or when the caller supplies its own bounded generator (the Phase 36 runner)', () => {
    expect(decideClaudeBound({...base, graphicsOn: false})).toEqual({action: 'unbounded', why: 'no_generated_graphics'});
    expect(decideClaudeBound({...base, callerSuppliedGenerator: true, capUsd: 0.5})).toEqual({action: 'unbounded', why: 'caller_supplied_generator'});
  });
  it('mvp without a configured cap switches graphics off; legacy without one keeps today\'s behaviour', () => {
    expect(decideClaudeBound(base)).toEqual({action: 'disabled', reason: 'claude_budget_unconfigured'});
    expect(decideClaudeBound({...base, profile: 'legacy'})).toEqual({action: 'unbounded', why: 'legacy_unconfigured'});
  });
  it('an invalid (negative or NaN) cap switches graphics off in every profile', () => {
    for (const profile of ['mvp', 'legacy'] as const) for (const capUsd of [-1, -0.01, Number.NaN]) expect(decideClaudeBound({...base, profile, capUsd}), `${profile} ${capUsd}`).toEqual({action: 'disabled', reason: 'claude_budget_invalid'});
  });
  it('a positive cap bounds the edit; request and token settings fall back to safe values when unset or unusable', () => {
    expect(decideClaudeBound({...base, capUsd: 0.4})).toEqual({action: 'bounded', capUsd: 0.4, maxRequests: 15, maxTokensPerCall: 12_000, minTokensPerCall: 4_000});
    expect(decideClaudeBound({...base, profile: 'legacy', capUsd: 0.4, maxRequests: 6.9, maxTokensPerCall: 8000})).toMatchObject({action: 'bounded', maxRequests: 6, maxTokensPerCall: 8000});
    expect(decideClaudeBound({...base, capUsd: 0.4, maxTokensPerCall: 100})).toMatchObject({maxTokensPerCall: 12_000}); // below the minimum a call needs
    expect(decideClaudeBound({...base, capUsd: Number.POSITIVE_INFINITY})).toEqual({action: 'disabled', reason: 'claude_budget_invalid'});
  });
});

describe('per-edit Claude bound (reuses claudeBudget; pure, injected call)', () => {
  const PRICE = {input: 1e-6, output: 1e-5};
  const request = {system: 'S'.repeat(300), user: 'U'.repeat(300)};
  const config = (over: Partial<{capUsd: number; maxRequests: number; maxTokensPerCall: number}> = {}) => ({capUsd: 0.2, maxRequests: 10, maxTokensPerCall: 12_000, minTokensPerCall: 4_000, ...over});
  type Res = {model: string; stopReason: string; usage: {inputTokens: number; outputTokens: number}; cost: number};
  const make = (opts: {config?: ReturnType<typeof config>; price?: typeof PRICE | null; cost?: number | (() => number); fail?: boolean | ((n: number) => boolean); costThrows?: boolean} = {}) => {
    const sent: Array<{maxTokens: number}> = [];
    const bounded = createBoundedClaudeGenerator<{system: string; user: string}, Res>({
      config: opts.config ?? config(),
      price: opts.price === undefined ? PRICE : opts.price,
      generate: async (_request, maxTokens) => {
        sent.push({maxTokens});
        const failing = typeof opts.fail === 'function' ? opts.fail(sent.length) : opts.fail;
        if (failing) throw new Error('provider timeout');
        const cost = typeof opts.cost === 'function' ? opts.cost() : opts.cost ?? 0.001;
        return {model: 'm', stopReason: 'end_turn', usage: {inputTokens: 100, outputTokens: 50}, cost};
      },
      costOf: result => {
        if (opts.costThrows) throw new Error('unpriced model');
        return result.cost;
      },
      describe: result => ({model: result.model, stopReason: result.stopReason, usage: result.usage}),
    });
    return {bounded, sent};
  };
  const settle = (promises: Array<Promise<unknown>>) => Promise.allSettled(promises);

  it('concurrent callers cannot exceed the cap: with room for two calls, five simultaneous requests dispatch exactly two', async () => {
    const {bounded, sent} = make({cost: 0.09});
    const results = await settle(Array.from({length: 5}, () => bounded.generator(request)));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(2);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(3);
    expect(sent).toHaveLength(2);
    const report = bounded.report();
    expect(report.committedUsd).toBeCloseTo(0.18, 6);
    expect(report.committedUsd).toBeLessThanOrEqual(0.2);
    expect(report.openReservations).toBe(0);
    expect(report.refusals.map(r => r.reason)).toContain('budget_exhausted');
  });
  it('the ceiling handed to the call never exceeds the configured per-call maximum or what is left', async () => {
    const {bounded, sent} = make({cost: 0.09});
    await settle([bounded.generator(request), bounded.generator(request)]);
    expect(sent[0]!.maxTokens).toBeLessThanOrEqual(12_000);
    expect(sent[1]!.maxTokens).toBeLessThan(sent[0]!.maxTokens + 1);
    expect(sent[1]!.maxTokens).toBeGreaterThanOrEqual(4_000);
  });
  it('a call that fails after dispatch keeps its full reservation as spent; the slot is not returned and the next calls stop', async () => {
    const {bounded, sent} = make({fail: true});
    const first = await settle([bounded.generator(request)]);
    expect(first[0]!.status).toBe('rejected');
    const afterFirst = bounded.report();
    expect(afterFirst.committedUsd).toBeGreaterThan(0.1); // ~ max_tokens x output price + input bound, not zero
    expect(afterFirst.requests).toBe(1);
    await settle([bounded.generator(request), bounded.generator(request), bounded.generator(request)]);
    const report = bounded.report();
    expect(report.committedUsd).toBeGreaterThan(0.19); // the two reservations alone nearly exhaust the 0.20 cap, so the third call is refused
    expect(bounded.stoppedBy()).toMatch(/spend cap reached|refused a request/);
    expect(sent.length).toBeLessThanOrEqual(2);
    await expect(bounded.generator(request)).rejects.toThrow(/spend cap: refusing a Claude call/);
    expect(sent.length).toBeLessThanOrEqual(2); // nothing more was sent
  });
  it('retries are calls: repairs of one graphic and calls for other graphics share one request cap', async () => {
    const {bounded, sent} = make({config: config({capUsd: 5, maxRequests: 3})});
    await bounded.generator(request); // graphic A, first generation
    await bounded.generator(request); // graphic A, repair 1
    await bounded.generator(request); // graphic B
    await expect(bounded.generator(request)).rejects.toThrow(/request_cap/); // graphic A, repair 2
    expect(sent).toHaveLength(3);
    expect(bounded.report().refusals.map(r => r.reason)).toContain('request_cap');
  });
  it('a refusal stops every later call of the edit (shared stop)', async () => {
    const {bounded, sent} = make({config: config({maxRequests: 1})});
    await bounded.generator(request);
    await expect(bounded.generator(request)).rejects.toThrow(/request_cap/);
    expect(bounded.stoppedBy()).toMatch(/request_cap/);
    await expect(bounded.generator(request)).rejects.toThrow(/stopped/);
    expect(sent).toHaveLength(1);
  });
  it('missing, zero or non-finite price fails closed before anything is sent', async () => {
    for (const price of [null, {input: Number.NaN, output: 1e-5}, {input: 1e-6, output: Number.NaN}, {input: 1e-6, output: 0}]) {
      const {bounded, sent} = make({price});
      await expect(bounded.generator(request), JSON.stringify(price)).rejects.toThrow(/unknown_cost/);
      expect(sent).toHaveLength(0);
    }
  });
  it('an unusable cap or token ceiling fails closed (the guard never "defaults" a limit)', async () => {
    for (const bad of [{capUsd: 0}, {capUsd: -1}, {capUsd: Number.NaN}, {maxTokensPerCall: 0}]) {
      const {bounded, sent} = make({config: config(bad)});
      await expect(bounded.generator(request), JSON.stringify(bad)).rejects.toThrow(/unknown_cost/);
      expect(sent).toHaveLength(0);
    }
  });
  it('a reported cost that cannot be computed is charged as the whole reservation', async () => {
    const {bounded} = make({costThrows: true});
    await bounded.generator(request);
    expect(bounded.report().committedUsd).toBeGreaterThan(0.1);
  });
  it('the record explains the stop with counts, usage and reasons, and contains no prompt text or secrets', async () => {
    const secretRequest = {system: 'SYSTEM-SECRET-MARKER', user: 'USER-CONTENT-MARKER sk-ant-api03-not-a-real-key'};
    const {bounded} = make({config: config({maxRequests: 1})});
    await bounded.generator(secretRequest);
    await settle([bounded.generator(secretRequest)]);
    const text = JSON.stringify(bounded.report());
    expect(text).not.toMatch(/SYSTEM-SECRET-MARKER|USER-CONTENT-MARKER|sk-ant/);
    expect(text).toMatch(/request_cap/);
    expect(bounded.report()).toMatchObject({requests: 1, attempted: 1});
  });
});

describe('Claude bound wiring (source text; analyzeVideo is not executed here)', () => {
  const analyze = read('src/pipeline/analyzeVideo.ts');
  it('every Claude call of the product path goes through one bounded generator, and a caller-supplied generator (the Phase 36 runner) is left alone', () => {
    expect(analyze).toContain('callerSuppliedGenerator: Boolean(input.motionWorkerOptions?.generator),');
    expect(analyze).toContain('workerOptions = {...input.motionWorkerOptions, generator: boundedClaude.generator};');
    expect(analyze).toContain('workerOptions,\n');
    expect(analyze).toContain("dumpDirectorTrace('08-claude-budget', spend);");
    expect(analyze).toContain("warnings.push(`claude_graphics_disabled:${claudeBound.reason}`);");
    // WP8E: polish alone may run its graphics from the library when the Claude bound is disabled (library_only); every other profile still needs the bound
    expect(analyze).toContain('const motionGraphicsOn = motionGraphicsRequested && (claudeAllowed || libraryOnly);');
    expect(analyze).toContain('const claudeAllowed = claudeBound.action !== \'disabled\';')
  });
  it('the Phase 36 runner and its spend guard are untouched by the product bound', () => {
    const runner = readFileSync(path.resolve(here, '../../../remotion/out/phase36-readiness/run_experiment.ts'), 'utf8');
    expect(runner).not.toContain('productClaudeBudget');
    expect(runner).toContain('createMeteredGenerator');
  });
  it('the Director proxy degrades only in the mvp profile and never in strict runs', () => {
    expect(analyze).toContain("if (input.strictAiDirection || !mvpLike) {\n          throw error;");
  });
});
