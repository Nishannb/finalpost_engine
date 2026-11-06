/**
 * WP3Y pure tests: a cache hit reports the graphics decision stored with the cached result. lib/productEditProfile.ts is pure (no import); the store (env, kv) and the runner (logger) are read as
 * text. A Map stands in for the key-value store, driven through the same pure key/parse functions the store uses. No provider call, render, FFmpeg or network.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {graphicsStatusKey, jobGraphicsStatus, parseStoredGraphicsStatus, type JobGraphicsStatus} from '../lib/productEditProfile.ts';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts: string[]) => readFileSync(resolve(SRC, ...parts), 'utf8');
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

/** The store's behaviour, written against a Map with the store's own pure helpers (the real functions are proved by source text below). */
const fakeStore = () => {
  const kv = new Map<string, string>();
  return {
    kv,
    save: (blueprintId: string, meta: {graphics?: JobGraphicsStatus} = {}) => {
      if (meta.graphics) kv.set(graphicsStatusKey(blueprintId), meta.graphics);
    },
    hit: (blueprintId: string) => parseStoredGraphicsStatus(kv.get(graphicsStatusKey(blueprintId)) ?? null),
  };
};

describe('round trip', () => {
  it('a fresh save of on comes back as on', () => {
    const store = fakeStore();
    store.save('bp_1', {graphics: 'on'});
    expect(store.hit('bp_1')).toBe('on');
  });
  it('every value round-trips', () => {
    for (const value of ['off', 'on', 'skipped_budget'] as const) {
      const store = fakeStore();
      store.save('bp', {graphics: value});
      expect(store.hit('bp')).toBe(value);
    }
  });
  it('a hit returns the STORED skipped_budget even though the flag would now say off', () => {
    const store = fakeStore();
    store.save('bp_2', {graphics: 'skipped_budget'});
    // today the flag is off: a recomputation would say off, the stored value must win
    const recomputed = jobGraphicsStatus({requested: false, bound: {action: 'unbounded', why: 'no_generated_graphics'}});
    expect(recomputed).toBe('off');
    expect(store.hit('bp_2')).toBe('skipped_budget');
  });
  it('an old entry with no stored value leaves graphics absent (not off, on or skipped_budget)', () => {
    const store = fakeStore();
    expect(store.hit('bp_old')).toBeUndefined();
  });
  it('a save without a decision stores nothing', () => {
    const store = fakeStore();
    store.save('bp_3');
    store.save('bp_3', {});
    expect(store.kv.size).toBe(0);
  });
  it('entries are per blueprint and never mix', () => {
    const store = fakeStore();
    store.save('a', {graphics: 'on'});
    store.save('b', {graphics: 'off'});
    expect([store.hit('a'), store.hit('b'), store.hit('c')]).toEqual(['on', 'off', undefined]);
  });
});

describe('reading a stored value', () => {
  it('only the three known values come back; anything else is absent', () => {
    for (const bad of [undefined, null, '', 'ON', 'skipped', 'true', 1, true, {}, [], 'on ']) expect(parseStoredGraphicsStatus(bad)).toBeUndefined();
  });
  it('the key is separate from the blueprint and the index', () => {
    expect(graphicsStatusKey('bp_9')).toBe('engine:blueprint-graphics:bp_9');
    expect(graphicsStatusKey('bp_9')).not.toBe('engine:blueprint:bp_9');
  });
});

describe('wiring (source text)', () => {
  const store = stripComments(read('store', 'engineStore.ts'));
  const runner = stripComments(read('pipeline', 'analysisRunner.ts'));
  const schemas = read('http', 'schemas.ts');
  it('saveBlueprint stores the decision under the graphics key, with the blueprint\'s TTL, and only when there is one', () => {
    expect(store).toContain('meta: {graphics?: JobGraphicsStatus; styleReasons?: string[]} = {}'); // styleReasons: edit styles (Phase 2), stored under its own key
    expect(store).toContain('if (meta.graphics) {\n    await kv.set(graphicsStatusKey(blueprint.blueprintId), meta.graphics, ttl);');
  });
  it('the blueprint itself is stored exactly as before (no new field inside it)', () => {
    expect(store).toContain('JSON.stringify(blueprint),');
    expect(store).not.toMatch(/JSON\.stringify\(\{[^}]*graphics/);
  });
  it('loadBlueprintGraphicsStatus reads that key and passes it through the parser', () => {
    expect(store).toContain('parseStoredGraphicsStatus(await kv.get(graphicsStatusKey(blueprintId)))');
  });
  it('the runner copies the stored value on a hit, as stored, and never from the flag or the budget', () => {
    const hit = runner.slice(runner.indexOf('if (cached) {'), runner.indexOf('await assertAnalysisAllowed'));
    expect(hit).toContain('const storedGraphics = await loadBlueprintGraphicsStatus(cached.blueprintId);');
    expect(hit).toContain('...(storedGraphics ? {graphics: storedGraphics} : {}),');
    expect(hit).not.toMatch(/MOTION_GRAPHICS_ENABLED|CLAUDE_EDIT|decideClaudeBound|jobGraphicsStatus|generatedGraphicsEnabled/);
  });
  it('a fresh run saves the decision the job recorded (and nothing when none was made)', () => {
    // Edit styles (Phase 2) add the styled run's cap reasons under their own key; an unstyled run passes exactly what it did before.
    expect(runner).toContain('await saveBlueprint(blueprint, fingerprint, {...(job.graphics ? {graphics: job.graphics} : {}), ...(extras.styleRun?.engineFlags ? {styleReasons: capReasons} : {})});');
  });
  it('the other callers of saveBlueprint are untouched (two arguments, so nothing is stored)', () => {
    expect(read('pipeline', 'templateDesignerRunner.ts')).not.toMatch(/graphics:\s*(job|input)/);
  });
  it('no HTTP body can set either field', () => {
    expect(schemas).not.toMatch(/editProfile|graphics:|graphicsStatus/);
    expect(stripComments(read('http', 'routes', 'analyzeRoutes.ts'))).not.toMatch(/editProfile|\bgraphics\b/);
  });
  it('the queued job still omits graphics until the decision runs', () => {
    const queued = runner.slice(runner.indexOf("status: 'queued'"), runner.indexOf('await saveAnalysisJob(job);', runner.indexOf("status: 'queued'")));
    expect(queued).not.toContain('graphics');
  });
  it('the defaults are untouched', () => {
    const env = stripComments(read('config', 'env.ts'));
    expect(env).toMatch(/PRODUCT_EDIT_PROFILE:[^\n]*cuts/);
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED:\s*bool\(false\)/);
  });
});
