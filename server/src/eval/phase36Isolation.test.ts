/**
 * Phase 36E: isolation tests (PREPARED, NOT RUN in Phase 36E). Imports only pure/lib modules and node built-ins: nothing here imports the logger, loads `.env`, builds a
 * provider client, spawns the runner, renders, or contacts a network. It does NOT call `installRealSourceDeny` (that would patch `fs` for the whole test process).
 * Temp directories are created with mkdtemp and only those are removed.
 */
import {existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

import {afterAll, describe, expect, it} from 'vitest';

import {checkOfflineOutDir, ENDPOINT_OVERRIDE_VARS, findEndpointOverrides, OFFLINE_SENTINEL, parseExperimentInvocation} from '../lib/experimentMode.ts';
import {preflightStatic} from '../lib/experimentPreflight.ts';
import {resolveLogDir} from '../lib/logDir.ts';
import {createRunOwnership, MANIFEST_FILE, planOwnedCleanup, readManifest, removeOwned} from '../lib/runOwnership.ts';
import {createSpendGuard} from '../lib/spendGuard.ts';
import {APPROVED_DIR, APPROVED_FIXTURES, REAL_SOURCE, validateDryOut, validateSyntheticFixture} from '../../../remotion/out/phase36-readiness/dry-run/fixture_policy.ts';
import {ALLOWED_PRELOADS, checkLaunch, groupSignalTarget, parseTimeoutSec, resolvePreload} from '../../../remotion/out/phase36-readiness/dry-run/launcher_policy.ts';
import {classifyEdges, forbiddenIdOf, isProtectedPath, judgeProbeCase, scanImportKinds, type ProbeObservation} from '../../../remotion/out/phase36-readiness/import-boundary/probe_policy.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const read = (relative: string) => readFileSync(path.join(repo, relative), 'utf8');

const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'p36e-')));
afterAll(() => rmSync(root, {recursive: true, force: true}));
const sub = (name: string) => {
  const dir = path.join(root, name);
  mkdirSync(dir, {recursive: true});
  return dir;
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------
const SENTINEL = OFFLINE_SENTINEL; // Phase 36G: the pinned constant; a marker no longer defines what counts as the sentinel
const FETCH = (async () => new Response('{}')) as unknown as typeof fetch;
const FIXTURE = path.join(root, 'fixture-dir', 'synthetic_41s.mp4');
const marker = () => ({version: 1 as const, fetch: FETCH, sentinel: SENTINEL, fixture: {path: FIXTURE, sha256: 'x'}, report: () => ({denied: 0, leaked: 0})});
const offlineOut = path.join(root, 'tmp-root', 'p36-dryrun-case1');
mkdirSync(path.join(root, 'tmp-root'), {recursive: true});
// Phase 36G: offline mode now requires an independent fixture validator (the real runner passes validateSyntheticFixture). Here it is a stub that accepts exactly the marker's fixture.
const validFixture = (candidate: string) => (candidate === FIXTURE ? ({ok: true, path: FIXTURE, sha256: 'x'} as const) : ({ok: false, reason: 'not the fixture'} as const));
const parse = (args: string[], env: Record<string, string | undefined> = {}, over: {marker?: unknown; currentFetch?: unknown; validateFixture?: unknown} = {}) =>
  parseExperimentInvocation({args, env, marker: 'marker' in over ? over.marker : marker(), currentFetch: 'currentFetch' in over ? over.currentFetch : FETCH, tmpRoots: [path.join(root, 'tmp-root')],
    validateFixture: ('validateFixture' in over ? over.validateFixture : validFixture) as never});
const offlineArgs = (extra: string[] = []) => [offlineOut, '--mode=offline', `--source=${FIXTURE}`, ...extra];

describe('mode separation (parseExperimentInvocation)', () => {
  it('rejects a missing, unknown, repeated or conflicting mode and stray options before anything else', () => {
    for (const args of [[], ['/x'], ['--mode=PAID'], ['--mode='], ['--mode=paid', '--mode=offline'], ['--mode=paid', '--bogus'], ['--mode=paid', 'a', 'b'], ['--mode=dry']]) {
      expect(parse(args, {P36_APPROVED: 'yes'}, {marker: undefined}).ok, JSON.stringify(args)).toBe(false);
    }
    expect(parse(['--mode=paid'], {P36_APPROVED: 'yes', P36_MODE: 'offline'}, {marker: undefined}).ok).toBe(false);
  });

  it('paid mode needs exactly P36_APPROVED=yes, refuses an offline marker, and accepts no offline-only option', () => {
    for (const value of [undefined, '', 'YES', 'true', '1', 'yes ', 'no']) expect(parse(['--mode=paid'], {P36_APPROVED: value}, {marker: undefined}).ok, String(value)).toBe(false);
    expect(parse(['--mode=paid'], {P36_APPROVED: 'yes'}, {marker: undefined})).toEqual({ok: true, mode: 'paid', outDir: null});
    expect(parse(['/out', '--mode=paid'], {P36_APPROVED: 'yes'}, {marker: undefined})).toMatchObject({ok: true, outDir: '/out'});
    expect(parse(['--mode=paid'], {P36_APPROVED: 'yes'}).ok).toBe(false); // a fake-transport marker is present
    expect(parse(['--mode=paid', `--source=${FIXTURE}`], {P36_APPROVED: 'yes'}, {marker: undefined}).ok).toBe(false);
    expect(parse(['--mode=paid', '--serve-port=4000'], {P36_APPROVED: 'yes'}, {marker: undefined}).ok).toBe(false);
  });

  it('offline mode starts only with the marker, the same fetch, the canonical fixture, sentinel keys, no overrides and a p36-dryrun-* directory inside a temporary root', () => {
    expect(parse(offlineArgs())).toMatchObject({ok: true, mode: 'offline', outDir: offlineOut, source: FIXTURE, servePort: 0});
    expect(parse(offlineArgs(), {GEMINI_API_KEY: SENTINEL, GROQ_API_KEY: SENTINEL, ANTHROPIC_API_KEY: SENTINEL}).ok).toBe(true);
    expect(parse(offlineArgs(['--serve-port=45678']))).toMatchObject({ok: true, servePort: 45678});
    expect(parse(offlineArgs(['--serve-port=80'])).ok).toBe(false);
    expect(parse(offlineArgs(['--serve-port=abc'])).ok).toBe(false);
  });

  it('offline mode refuses: no marker, wrong fetch, P36_APPROVED in any form, missing or foreign source, a real key, no explicit directory', () => {
    expect(parse(offlineArgs(), {}, {marker: undefined}).ok).toBe(false);
    expect(parse(offlineArgs(), {}, {marker: {...marker(), report: undefined}}).ok).toBe(false);
    expect(parse(offlineArgs(), {}, {currentFetch: (async () => new Response('x')) as unknown as typeof fetch}).ok).toBe(false);
    for (const value of ['yes', 'no', '1', 'anything']) expect(parse(offlineArgs(), {P36_APPROVED: value}).ok, value).toBe(false);
    expect(parse([offlineOut, '--mode=offline']).ok).toBe(false);
    expect(parse([offlineOut, '--mode=offline', '--source=']).ok).toBe(false);
    expect(parse([offlineOut, '--mode=offline', `--source=${path.join(root, 'other.mp4')}`]).ok).toBe(false);
    expect(parse(['--mode=offline', `--source=${FIXTURE}`]).ok).toBe(false);
    const real = parse(offlineArgs(), {GEMINI_API_KEY: 'sk-this-is-not-allowed-123'});
    expect(real.ok).toBe(false);
    expect(JSON.stringify(real)).not.toContain('sk-this-is-not-allowed-123'); // the value is never echoed
  });

  it('offline mode refuses every endpoint, proxy and injection variable (names reported, values never)', () => {
    for (const name of ENDPOINT_OVERRIDE_VARS) {
      const result = parse(offlineArgs(), {[name]: 'http://127.0.0.1:9999/secret-value'});
      expect(result.ok, name).toBe(false);
      expect(JSON.stringify(result), name).toContain(name);
      expect(JSON.stringify(result), name).not.toContain('secret-value');
    }
    expect(ENDPOINT_OVERRIDE_VARS).toContain('ANTHROPIC_BASE_URL');
    expect(findEndpointOverrides({ANTHROPIC_BASE_URL: ' ', HTTPS_PROXY: ''})).toEqual([]);
  });

  it('offline output directory: must be p36-dryrun-<id>, absolute, and inside a temporary root even through a symlinked parent', () => {
    const tmpRoot = path.join(root, 'tmp-root');
    expect(checkOfflineOutDir(path.join(tmpRoot, 'p36-dryrun-ok'), [tmpRoot])).toBeNull();
    expect(checkOfflineOutDir(path.join(tmpRoot, 'run-1'), [tmpRoot])).not.toBeNull();
    expect(checkOfflineOutDir('relative/p36-dryrun-x', [tmpRoot])).not.toBeNull();
    expect(checkOfflineOutDir(path.join(repo, 'remotion/out/p36-dryrun-x'), [tmpRoot])).not.toBeNull();
    expect(checkOfflineOutDir(path.join(tmpRoot, '..', 'p36-dryrun-x'), [tmpRoot])).not.toBeNull();
    const outside = sub('outside');
    symlinkSync(outside, path.join(tmpRoot, 'escape'));
    expect(checkOfflineOutDir(path.join(tmpRoot, 'escape', 'p36-dryrun-x'), [tmpRoot])).not.toBeNull();
  });
});

describe('log isolation (resolveLogDir and logger wiring)', () => {
  it('keeps the application default when unset or empty and validates any override instead of ignoring it', () => {
    expect(resolveLogDir('/app/logs', undefined)).toBe('/app/logs');
    expect(resolveLogDir('/app/logs', '  ')).toBe('/app/logs');
    expect(resolveLogDir('/app/logs', '/tmp/run/logs')).toBe('/tmp/run/logs');
    expect(resolveLogDir('/app/logs', '/tmp/run/logs/')).toBe('/tmp/run/logs');
    for (const bad of ['relative/logs', '/tmp/../etc', '/tmp/a\0b', '/tmp//x/../y']) expect(() => resolveLogDir('/app/logs', bad), bad).toThrow(/ENGINE_LOG_DIR/);
  });
  it('the logger resolves its directory through the validated override and the default is unchanged (static)', () => {
    const logger = read('server/src/lib/logger.ts');
    expect(logger).toContain("resolveLogDir(path.resolve(here, '../../../logs'), process.env.ENGINE_LOG_DIR)");
  });
  it('the runner imports no logger-bearing module before the claim, and directs logs/TMPDIR into the run before it imports them (static)', () => {
    const runner = read('remotion/out/phase36-readiness/run_experiment.ts');
    const at = (needle: string) => { const i = runner.indexOf(needle); expect(i, needle).toBeGreaterThan(0); return i; };
    const claim = at('claimOutputDir(outDir)');
    for (const needle of ['motionWorker/worker.ts`', 'media/ffmpeg.ts`', 'pipeline/analyzeVideo.ts`', 'stage' + 's/render/localRender.ts`', 'lib/logger']) {
      const i = runner.indexOf(needle);
      if (i >= 0) expect(i, needle).toBeGreaterThan(claim);
    }
    const order = [
      'parseExperimentInvocation({', "process.env.P36_APPROVED !== 'yes'", 'config/env.ts`', 'preflightStatic({', 'claimOutputDir(outDir)', 'createRunOwnership(outDir',
      'process.env.ENGINE_LOG_DIR =', 'process.env.TMPDIR =', 'motionWorker/worker.ts`', 'media/ffmpeg.ts`', 'preflightExperiment({', 'globalThis.fetch = guard.fetch', 'await analyzeVideo(',
    ].map(at);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(runner.indexOf('ENGINE_LOG_DIR')).toBeGreaterThan(claim);
  });
  it('the only runner-side imports before the gate are node built-ins and the pure mode parser (static)', () => {
    const runner = read('remotion/out/phase36-readiness/run_experiment.ts');
    const beforeGate = runner.slice(0, runner.indexOf("if (MODE === 'paid' && process.env.P36_APPROVED"));
    const imports = [...beforeGate.matchAll(/(?:import\s[^;]*from\s+'([^']+)'|await import\(`([^`]+)`\))/g)].map(match => match[1] ?? match[2]!);
    // Phase 36G: plus the pure fixture policy (node built-ins only), used to validate the offline fixture independently of the marker.
    expect(imports.filter(spec => !spec.startsWith('node:'))).toEqual(['${ROOT}/server/src/lib/experimentMode.ts', '${ROOT}/remotion/out/phase36-readiness/dry-run/fixture_policy.ts']);
  });
});

describe('fixture policy', () => {
  const approvedDir = sub('approved');
  const content = Buffer.from('synthetic fixture bytes');
  const sha = createHash('sha256').update(content).digest('hex');
  const table = {'fix.mp4': {sha256: sha, bytes: content.length}};
  const fix = path.join(approvedDir, 'fix.mp4');
  writeFileSync(fix, content);
  const real = path.join(sub('real'), '2.mp4');
  writeFileSync(real, Buffer.from('the real source'));
  const check = (candidate: unknown, over: {approvedDir?: string; approved?: typeof table; realSource?: string} = {}) => validateSyntheticFixture(candidate, {approvedDir, approved: table, realSource: real, ...over});

  it('accepts the approved fixture by canonical path, hash and size', () => {
    expect(check(fix)).toMatchObject({ok: true, path: realpathSync(fix), sha256: sha});
  });
  it('refuses a missing, empty, relative, NUL, nonexistent or non-file configuration (fail closed)', () => {
    for (const candidate of [undefined, '', 'fix.mp4', `${fix}\0x`, path.join(approvedDir, 'nope.mp4'), approvedDir, 42]) expect(check(candidate).ok, String(candidate)).toBe(false);
  });
  it('refuses a path outside the approved directory, a file not in the table, wrong size or wrong bytes', () => {
    const outside = path.join(sub('elsewhere'), 'fix.mp4');
    writeFileSync(outside, content);
    expect(check(outside).ok).toBe(false);
    const unlisted = path.join(approvedDir, 'unlisted.mp4');
    writeFileSync(unlisted, content);
    expect(check(unlisted).ok).toBe(false);
    expect(check(fix, {approved: {'fix.mp4': {sha256: sha, bytes: content.length + 1}}}).ok).toBe(false);
    expect(check(fix, {approved: {'fix.mp4': {sha256: '0'.repeat(64), bytes: content.length}}}).ok).toBe(false);
  });
  it('refuses a symlink that leads outside the approved directory, and a traversal', () => {
    const link = path.join(approvedDir, 'link.mp4');
    symlinkSync(real, link);
    expect(check(link, {approved: {'link.mp4': {sha256: sha, bytes: content.length}}}).ok).toBe(false);
    expect(check(path.join(approvedDir, '..', 'real', '2.mp4')).ok).toBe(false);
  });
  it('refuses the real source itself, a hard link to it, and a symlink alias of it, by identity not name', () => {
    expect(check(real).ok).toBe(false);
    const bytes = readFileSync(real);
    const hard = path.join(approvedDir, 'hard.mp4');
    linkSync(real, hard);
    const hardTable = {'hard.mp4': {sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length}};
    const result = check(hard, {approved: hardTable});
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).toMatch(/real source/);
    const alias = path.join(sub('alias'), 'looks-synthetic.mp4');
    symlinkSync(real, alias);
    expect(check(alias).ok).toBe(false);
  });
  it('the shipped table pins the shipped fixture and the plain preload and fixture preload both validate before doing anything (static)', () => {
    expect(Object.keys(APPROVED_FIXTURES)).toEqual(['synthetic_41s.mp4']);
    expect(APPROVED_DIR.endsWith(path.join('dry-run', 'fixture'))).toBe(true);
    // Phase 36H: a stand-in path replaces the real source, so this test no longer stats ~/Downloads/2.mp4. (Identity comparison against a real file is covered with temp files above.)
    expect(validateSyntheticFixture(path.join(APPROVED_DIR, 'synthetic_41s.mp4'), {realSource: path.join(root, 'absent-real-source.mp4')})).toMatchObject({ok: true});
    expect(REAL_SOURCE).toBe('/Users/nishanbaral/Downloads/2.mp4'); // the constant the policy refuses by path and identity; not accessed here
    for (const file of ['mock_preload.ts', 'mock_preload_fixture.ts']) {
      const source = read(`remotion/out/phase36-readiness/dry-run/${file}`);
      const validate = source.indexOf('validateSyntheticFixture(process.env.DRY_SOURCE_FIXTURE)');
      expect(validate, file).toBeGreaterThan(0);
      expect(validate, file).toBeLessThan(source.indexOf('fs.mkdirSync(OUT'));
      expect(validate, file).toBeLessThan(source.indexOf('await import('));
      expect(source, file).toContain("Symbol.for('finalpost.p36.offline')");
      expect(source, file).toContain('installRealSourceDeny(');
      expect(source, file).not.toContain('source_redirect');
    }
  });
  it('DRY_OUT must be inside a temporary root', () => {
    const tmp = path.join(root, 'tmp-root');
    expect(validateDryOut(path.join(tmp, 'mock'), [tmp])).toBeNull();
    expect(validateDryOut(path.join(repo, 'remotion/out/mock'), [tmp])).not.toBeNull();
    expect(validateDryOut(undefined, [tmp])).not.toBeNull();
    expect(validateDryOut('relative', [tmp])).not.toBeNull();
  });
  it('every launcher requires the fixture explicitly, never sets P36_APPROVED, and starts offline mode (static)', () => {
    const dir = 'remotion/out/phase36-readiness/dry-run';
    const runScenario = read(`${dir}/run_scenario.sh`);
    expect(runScenario).toContain('DRY_SOURCE_FIXTURE');
    expect(runScenario).toContain('--mode=offline');
    expect(runScenario).toContain('--source="$DRY_SOURCE_FIXTURE"');
    expect(runScenario).toMatch(/refusing: DRY_SOURCE_FIXTURE must name/);
    for (const file of ['run_scenario.sh', 'run_scenario_pf.sh', 'chain.sh', 'chain_r2.sh', 'chain_pf.sh']) expect(read(`${dir}/${file}`), file).not.toMatch(/P36_APPROVED=yes/);
    for (const file of ['chain.sh', 'chain_r2.sh', 'chain_pf.sh']) {
      const chain = read(`${dir}/${file}`);
      expect(chain, file).toContain('export DRY_SOURCE_FIXTURE="$PWD/fixture/synthetic_41s.mp4"');
      expect(chain, file).toMatch(/refusing: chain.*\.done exists/);
    }
  });
});

describe('per-run ownership and cleanup boundaries', () => {
  it('the manifest is created exclusively; a second creation in the same directory fails and the first is untouched', () => {
    const dir = sub('own1');
    createRunOwnership(dir, {runId: 'a', mode: 'offline'});
    const before = readFileSync(path.join(dir, MANIFEST_FILE), 'utf8');
    expect(() => createRunOwnership(dir, {runId: 'b', mode: 'offline'})).toThrow();
    expect(readFileSync(path.join(dir, MANIFEST_FILE), 'utf8')).toBe(before);
  });
  it('only entries created by this run and inside an allowed root are planned; pre-existing and foreign paths are skipped', () => {
    const dir = sub('own2');
    const shared = sub('own2-shared');
    const existing = path.join(shared, 'old.js');
    writeFileSync(existing, 'x');
    const mine = path.join(shared, 'new.js');
    const foreign = path.join(sub('own2-foreign'), 'other.js');
    const own = createRunOwnership(dir, {runId: 'r', mode: 'offline'});
    own.record(existing, 'file'); // existed before: not owned
    own.record(mine, 'file'); // does not exist yet: owned
    own.record(foreign, 'file');
    const plan = planOwnedCleanup(readManifest(dir)!, [shared]);
    expect(plan.remove).toEqual([mine]);
    expect(plan.skipped.map(item => item.reason).sort()).toEqual(['existed before this run; not owned', 'outside every allowed root']);
    expect(planOwnedCleanup(readManifest(dir)!, [shared]).remove).not.toContain(shared); // the root itself is never removable
  });
  it('removeOwned deletes only planned regular paths, never a sibling, a symlink or anything outside the roots', () => {
    const shared = sub('own3-shared');
    const planned = path.join(shared, 'a.js');
    const sibling = path.join(shared, 'b.js');
    writeFileSync(planned, 'x');
    writeFileSync(sibling, 'y');
    const target = sub('own3-target');
    const link = path.join(shared, 'link');
    symlinkSync(target, link);
    const removed = removeOwned({remove: [planned, link, path.join(os.homedir(), 'never-touched')], skipped: []}, [shared]);
    expect(removed).toEqual([planned]);
    expect(existsSync(planned)).toBe(false);
    expect(existsSync(sibling)).toBe(true);
    expect(existsSync(target)).toBe(true);
    expect(readdirSync(shared).sort()).toEqual(['b.js', 'link']);
  });
  it('the render sweep is optional and the offline runner turns it off; every shared scratch path is recorded before the render (static)', () => {
    expect(read('server/src/stages/render/localRender.ts')).toContain('if (input.sweepStaleScratch !== false)');
    const runner = read('remotion/out/phase36-readiness/run_experiment.ts');
    expect(runner).toContain("sweepStaleScratch: MODE === 'paid'");
    const record = runner.indexOf('ownership.record(path.join(ROOT, scratch)');
    expect(record).toBeGreaterThan(0);
    expect(record).toBeLessThan(runner.indexOf('await renderLocally('));
  });
});

describe('loopback and endpoint isolation in the spend guard', () => {
  const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models/x:generateContent';
  const make = (restrictLoopback?: boolean) => {
    const sent: string[] = [];
    const fetchImpl = (async (url: string | URL) => { sent.push(String(url)); return new Response('{}'); }) as typeof fetch;
    return {sent, guard: createSpendGuard({fetchImpl, geminiCapUsd: 1, maxRequestsPerHost: {'generativelanguage.googleapis.com': 5}, ...(restrictLoopback === undefined ? {} : {restrictLoopback})})};
  };
  const code = (promise: Promise<unknown>) => promise.then(() => 'sent', (error: {code?: string}) => error.code ?? 'error');

  it('unchanged by default: any loopback request is forwarded', async () => {
    const t = make();
    expect(await code(t.guard.fetch('http://127.0.0.1:5555/x'))).toBe('sent');
    expect(await code(t.guard.fetch('http://localhost:6666/x'))).toBe('sent');
  });
  it('restricted: only registered local ports are forwarded; a local proxy port, other hosts and IPv6 loopback are refused before the transport', async () => {
    const t = make(true);
    expect(await code(t.guard.fetch('http://127.0.0.1:5555/source.mp4'))).toBe('loopback_not_allowed');
    t.guard.allowLoopbackPort(5555);
    expect(await code(t.guard.fetch('http://127.0.0.1:5555/source.mp4'))).toBe('sent');
    expect(await code(t.guard.fetch('http://localhost:5555/source.mp4'))).toBe('sent');
    expect(await code(t.guard.fetch('http://127.0.0.1:5556/relay-to-anthropic'))).toBe('loopback_not_allowed');
    expect(await code(t.guard.fetch('http://[::1]:5555/x'))).toBe('host_not_allowed');
    expect(await code(t.guard.fetch('http://127.0.0.2:5555/x'))).toBe('host_not_allowed');
    expect(t.sent).toEqual(['http://127.0.0.1:5555/source.mp4', 'http://localhost:5555/source.mp4']);
    expect(t.guard.report().refused.map(item => item.reason)).toContain('loopback_not_allowed');
    expect(await code(t.guard.fetch(GEMINI, {method: 'POST', body: '{}'}))).toBe('sent');
  });
  it('the runner turns the restriction on and registers only its own video server port (static)', () => {
    const runner = read('remotion/out/phase36-readiness/run_experiment.ts');
    expect(runner).toContain('restrictLoopback: true');
    expect(runner).toContain('guard.allowLoopbackPort(servedPort)');
  });
  it('no source file sets a provider base URL: the Anthropic client is built only inside the per-call generator, after the guard (static)', () => {
    const worker = read('server/src/motionWorker/worker.ts');
    expect(worker.match(/new Anthropic\(/g)?.length).toBe(1);
    expect(worker.indexOf('new Anthropic(')).toBeGreaterThan(worker.indexOf('export function anthropicGenerator'));
    expect(worker).not.toMatch(/baseURL|ANTHROPIC_BASE_URL/);
  });
});

describe('static preflight', () => {
  const good = () => ({
    keysPresent: {GEMINI_API_KEY: true, GROQ_API_KEY: true, ANTHROPIC_API_KEY: true},
    caps: {geminiUsd: 0.05, claudeUsd: 0.25, geminiRequests: 10, claudeRequests: 4, groqRequests: 2},
    source: {exists: true, isFile: true, bytes: 10}, requestedEdits: ['zoom'], minGeminiRequestsNeeded: 4,
  });
  it('accepts a complete configuration and refuses missing keys, non-files, empty edits and bad caps', () => {
    expect(preflightStatic(good())).toEqual({ok: true, problems: []});
    const keys = good(); keys.keysPresent.GROQ_API_KEY = false;
    expect(preflightStatic(keys).problems.join()).toMatch(/GROQ_API_KEY/);
    const dir = good(); dir.source.isFile = false;
    expect(preflightStatic(dir).ok).toBe(false);
    const edits = good(); edits.requestedEdits = [];
    expect(preflightStatic(edits).ok).toBe(false);
    const caps = good(); caps.caps.claudeUsd = Number.NaN;
    expect(preflightStatic(caps).ok).toBe(false);
    const low = good(); low.caps.geminiRequests = 3;
    expect(preflightStatic(low).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Phase 36G (PREPARED, NOT RUN in Phase 36G unless the report says otherwise). Pure modules and node built-ins only.

describe('C-2: the offline fake-transport sentinel is pinned, not self-authenticating', () => {
  it('a valid marker is accepted only together with the independent fixture check', () => {
    expect(parse(offlineArgs())).toMatchObject({ok: true, mode: 'offline'});
  });
  it('missing marker, unfrozen-or-malformed marker and absent validator are refused (fail closed)', () => {
    expect(parse(offlineArgs(), {}, {marker: undefined}).ok).toBe(false);
    expect(parse(offlineArgs(), {}, {marker: null}).ok).toBe(false);
    expect(parse(offlineArgs(), {}, {marker: {...marker(), version: 2}}).ok).toBe(false);
    expect(parse(offlineArgs(), {}, {marker: {...marker(), fixture: undefined}}).ok).toBe(false);
    expect(parse(offlineArgs(), {}, {validateFixture: undefined}).ok).toBe(false);
  });
  it('a forged marker whose "sentinel" names a REAL-looking key value is refused, even when the environment key equals it (the old self-authentication hole)', () => {
    const forged = 'sk-forged-real-looking-key-0123456789';
    const result = parse(offlineArgs(), {GEMINI_API_KEY: forged}, {marker: {...marker(), sentinel: forged}});
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(forged); // never echoed
    expect(parse(offlineArgs(), {GEMINI_API_KEY: forged}).ok).toBe(false); // honest marker, real key: also refused
  });
  it('an altered marker is refused: another fetch, another fixture path, or an identity that differs from the independently validated fixture', () => {
    expect(parse(offlineArgs(), {}, {marker: {...marker(), fetch: (async () => new Response('x')) as unknown as typeof fetch}}).ok).toBe(false);
    expect(parse(offlineArgs(), {}, {marker: {...marker(), fixture: {path: path.join(root, 'elsewhere.mp4'), sha256: 'x'}}}).ok).toBe(false);
    expect(parse(offlineArgs(), {}, {marker: {...marker(), fixture: {path: FIXTURE, sha256: 'y'}}}).ok).toBe(false); // validator says sha "x"
    expect(parse(offlineArgs(), {}, {validateFixture: () => ({ok: false, reason: 'size differs'})}).ok).toBe(false);
  });
  it('the pinned sentinel is a placeholder constant, every preload imports it instead of keeping a copy, and the runner compares with it (static)', () => {
    expect(OFFLINE_SENTINEL).toBe('DRYRUN-NOT-A-REAL-KEY');
    for (const file of ['mock_preload.ts', 'mock_preload_fixture.ts']) {
      const source = read(`remotion/out/phase36-readiness/dry-run/${file}`);
      expect(source, file).toContain('.OFFLINE_SENTINEL');
      expect(source, file).not.toMatch(/const SENTINEL = '/);
    }
    const runner = read('remotion/out/phase36-readiness/run_experiment.ts');
    expect(runner).not.toContain('marker.sentinel');
    expect(runner).toContain('modeLib.OFFLINE_SENTINEL');
    expect(runner).toContain('validateFixture:');
  });
  it('every refusal is decided by the pure parser before .env, a provider client, the claim or any write (static order)', () => {
    const runner = read('remotion/out/phase36-readiness/run_experiment.ts');
    const at = (needle: string) => { const i = runner.indexOf(needle); expect(i, needle).toBeGreaterThan(0); return i; };
    const order = ['parseExperimentInvocation({', 'if (!invocation.ok) refuseRun', 'config/env.ts`', 'claimOutputDir(outDir)', 'motionWorker/worker.ts`'].map(at);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe('C-3: no refusal path appends to the protected log', () => {
  it('both modes direct the engine log into the claimed run BEFORE any logger-bearing module is imported; the application default is unchanged (static)', () => {
    const runner = read('remotion/out/phase36-readiness/run_experiment.ts');
    const setLog = runner.indexOf('process.env.ENGINE_LOG_DIR =');
    const offlineBlock = runner.indexOf("if (MODE === 'offline') {\n  const tmpDir");
    expect(setLog).toBeGreaterThan(runner.indexOf('claimOutputDir(outDir)'));
    expect(setLog).toBeLessThan(offlineBlock); // not inside the offline-only block: paid runs are covered too
    expect(setLog).toBeLessThan(runner.indexOf('motionWorker/worker.ts`'));
    expect(setLog).toBeLessThan(runner.indexOf('media/ffmpeg.ts`'));
    expect(read('server/src/lib/logger.ts')).toContain("resolveLogDir(path.resolve(here, '../../../logs'), process.env.ENGINE_LOG_DIR)");
    expect(resolveLogDir('/app/logs', undefined)).toBe('/app/logs');
  });
  it('the logger is the only module that opens engine.log, and nothing in the runner imports it before the claim (static)', () => {
    const runner = read('remotion/out/phase36-readiness/run_experiment.ts');
    expect(runner).not.toMatch(/lib\/logger/);
    expect(runner).not.toContain("'engine.log'");
  });
});

describe('C-4: launcher preload allowlist, fixture-before-process, timeout and process ownership', () => {
  const dir = sub('launch');
  writeFileSync(path.join(dir, 'mock_preload.ts'), '// stand-in');
  writeFileSync(path.join(dir, 'mock_preload_fixture.ts'), '// stand-in');
  const outside = sub('launch-outside');
  writeFileSync(path.join(outside, 'evil.ts'), '// outside');

  it('accepts exactly the allowlisted names that are regular files inside the directory', () => {
    expect([...ALLOWED_PRELOADS].sort()).toEqual(['mock_preload.ts', 'mock_preload_fixture.ts']);
    expect(resolvePreload('mock_preload.ts', dir)).toEqual({ok: true, path: path.join(realpathSync(dir), 'mock_preload.ts')});
    expect(resolvePreload('mock_preload_fixture.ts', dir).ok).toBe(true);
  });
  it('refuses unrecognised names, traversal, absolute paths, subdirectories and non-strings', () => {
    for (const name of ['mock_preload_audit.ts', 'evil.ts', '../launch-outside/evil.ts', `${outside}/evil.ts`, './mock_preload.ts', 'sub/mock_preload.ts', 'mock_preload.ts/', 'MOCK_PRELOAD.TS', '', undefined, 42, `mock_preload.ts\0`]) {
      expect(resolvePreload(name, dir).ok, String(name)).toBe(false);
    }
  });
  it('refuses an allowlisted name that is missing, is a directory, or is a symlink (even one that points inside the directory)', () => {
    const empty = sub('launch-empty');
    expect(resolvePreload('mock_preload.ts', empty).ok).toBe(false);
    const asDir = sub('launch-asdir');
    mkdirSync(path.join(asDir, 'mock_preload.ts'));
    expect(resolvePreload('mock_preload.ts', asDir).ok).toBe(false);
    const linked = sub('launch-linked');
    symlinkSync(path.join(outside, 'evil.ts'), path.join(linked, 'mock_preload.ts'));
    expect(resolvePreload('mock_preload.ts', linked).ok).toBe(false);
    const inside = sub('launch-inside-link');
    writeFileSync(path.join(inside, 'real.ts'), '//');
    symlinkSync(path.join(inside, 'real.ts'), path.join(inside, 'mock_preload.ts'));
    expect(resolvePreload('mock_preload.ts', inside).ok).toBe(false);
  });
  it('the timeout is a bounded whole number of seconds with a default', () => {
    expect(parseTimeoutSec(undefined)).toEqual({ok: true, seconds: 1800});
    expect(parseTimeoutSec('600')).toEqual({ok: true, seconds: 600});
    for (const bad of ['0', '29', '3601', '-5', '1e3', '12.5', 'abc', ' 60', '999999']) expect(parseTimeoutSec(bad).ok, bad).toBe(false);
  });
  it('only the supervisor\'s own child group can be signalled: never pid <= 1, an invalid pid or the supervisor itself', () => {
    expect(groupSignalTarget(4242, 100)).toBe(-4242);
    for (const pid of [undefined, 0, 1, -7, 2.5, Number.NaN, 100]) expect(groupSignalTarget(pid as number | undefined, 100), String(pid)).toBeNull();
  });
  it('checkLaunch refuses before any process: approval variable, endpoint/proxy/injection variables, bad preload, bad fixture, bad request-log directory, bad timeout', () => {
    const approvedDir = sub('launch-approved');
    const content = Buffer.from('synthetic');
    const fix = path.join(approvedDir, 'fix.mp4');
    writeFileSync(fix, content);
    const table = {'fix.mp4': {sha256: createHash('sha256').update(content).digest('hex'), bytes: content.length}};
    const tmpRoot = sub('launch-tmp');
    const dryOut = path.join(tmpRoot, 'mock');
    const base = {preload: 'mock_preload.ts', fixture: fix, dryOut, timeoutSec: '120', env: {} as Record<string, string | undefined>};
    const options = {dir, approvedDir, approved: table, realSource: path.join(outside, 'no-real.mp4'), tmpRoots: [tmpRoot]};
    expect(checkLaunch(base, options)).toMatchObject({ok: true, timeoutSec: 120});
    expect(checkLaunch({...base, env: {P36_APPROVED: 'yes'}}, options).ok).toBe(false);
    expect(checkLaunch({...base, env: {P36_APPROVED: '1'}}, options).ok).toBe(false);
    expect(checkLaunch({...base, env: {NODE_OPTIONS: '--require x'}}, options).ok).toBe(false);
    expect(checkLaunch({...base, env: {HTTPS_PROXY: 'http://127.0.0.1:1'}}, options).ok).toBe(false);
    expect(checkLaunch({...base, preload: 'evil.ts'}, options).ok).toBe(false);
    expect(checkLaunch({...base, fixture: path.join(outside, 'evil.ts')}, options).ok).toBe(false);
    expect(checkLaunch({...base, fixture: undefined}, options).ok).toBe(false);
    expect(checkLaunch({...base, dryOut: path.join(outside, 'mock')}, options).ok).toBe(false);
    expect(checkLaunch({...base, timeoutSec: '5'}, options).ok).toBe(false);
  });
  it('the launcher validates before it spawns, spawns only the runner in its own process group, and never deletes or kills anything else (static)', () => {
    const supervise = read('remotion/out/phase36-readiness/dry-run/supervise.ts');
    expect(supervise.indexOf('checkLaunch(')).toBeGreaterThan(0);
    expect(supervise.indexOf('checkLaunch(')).toBeLessThan(supervise.indexOf('spawn(process.execPath'));
    expect(supervise).toContain('detached: true');
    expect(supervise).toContain('groupSignalTarget(child.pid, process.pid)');
    expect(supervise.match(/process\.kill\(/g)?.length).toBe(2); // SIGTERM and SIGKILL, both on `target`
    expect(supervise.match(/process\.kill\(target,/g)?.length).toBe(2);
    for (const forbidden of ['rmSync', 'rm -rf', 'unlinkSync', 'pkill', 'killall', 'execSync', 'readdirSync', 'process.kill(-1', 'process.kill(0']) expect(supervise, forbidden).not.toContain(forbidden);
    const scenario = read('remotion/out/phase36-readiness/dry-run/run_scenario.sh');
    expect(scenario).toContain('supervise.ts');
    expect(scenario).not.toMatch(/--import\s/); // PRELOAD is no longer interpolated into a node command by the shell
    expect(scenario).toContain('--timeout-sec=');
    expect(scenario).not.toMatch(/\brm\b/); // the launcher removes nothing
  });
  it('every chain still refuses when its .done marker exists, exports the explicit fixture, never reads a fixed output path, and calls only the scenario launchers (static)', () => {
    for (const [file, marker] of [['chain.sh', 'chain.done'], ['chain_r2.sh', 'chain_r2.done'], ['chain_pf.sh', 'chain_pf.done']] as const) {
      const source = read(`remotion/out/phase36-readiness/dry-run/${file}`);
      expect(source, file).toContain(`[ -e ${marker} ] && {`);
      expect(source.indexOf(`[ -e ${marker}`), file).toBeLessThan(source.indexOf('./run_scenario'));
      expect(source, file).toContain('export DRY_SOURCE_FIXTURE=');
      expect(source, file).not.toMatch(/\brm\b|pkill|killall/);
      expect(source, file).not.toMatch(/node\s/);
      if (file === 'chain_pf.sh') expect(source).toContain('PRELOAD=mock_preload_fixture.ts'); // an allowlisted name
    }
    const scenario = read('remotion/out/phase36-readiness/dry-run/run_scenario.sh');
    expect(scenario).toContain('mktemp -d /private/tmp/p36-root-XXXXXX'); // each scenario reads only its own fresh root, so an older .done or output can never be taken for a new run
  });
});

describe('C-5: import-boundary probe policy (the probe itself is NOT executed here)', () => {
  const entry = 'file:///repo/run_experiment.ts';
  it('flags the logger, provider SDKs, worker, ffmpeg wrapper, renderer and pipeline, and nothing the refusal path may load', () => {
    for (const [url, id] of [
      ['file:///repo/server/src/lib/logger.ts', 'logger'], ['file:///repo/node_modules/pino/pino.js', 'pino'], ['file:///repo/node_modules/@anthropic-ai/sdk/index.js', 'anthropic-sdk'],
      ['file:///repo/server/src/motionWorker/worker.ts', 'motion-worker'], ['file:///repo/server/src/media/ffmpeg.ts', 'ffmpeg-wrapper'], ['file:///repo/server/src/pipeline/analyzeVideo.ts', 'analyze-video'],
      ['file:///repo/server/src/stages/render/localRender.ts', 'local-render'], ['file:///repo/node_modules/@remotion/bundler/dist/index.js', 'remotion'], ['file:///repo/server/src/lib/spendGuard.ts', 'spend-guard'],
    ] as const) expect(forbiddenIdOf(url), url).toBe(id);
    for (const url of ['file:///repo/server/src/lib/experimentMode.ts', 'file:///repo/server/src/config/env.ts', 'file:///repo/server/src/lib/claimOutputDir.ts', 'file:///repo/server/src/lib/experimentPreflight.ts', 'node:fs', 'file:///repo/node_modules/zod/index.js', 'file:///repo/node_modules/dotenv/lib/main.js']) {
      expect(forbiddenIdOf(url), url).toBeNull();
    }
  });
  it('distinguishes static from dynamic imports of the entry and marks everything below as transitive (static-vs-dynamic of deeper edges is NOT established)', () => {
    const kinds = scanImportKinds(["import fs from 'node:fs';", "import {x} from './a.ts';", "import './side.ts';", "export {y} from './b.ts';", "const m = await import('./late.ts');", 'const n = await import(`${ROOT}/x.ts`);'].join('\n'));
    expect(kinds.static.sort()).toEqual(['./a.ts', './b.ts', './side.ts', 'node:fs']);
    expect(kinds.dynamic).toEqual(['./late.ts', '${ROOT}/x.ts']); // a template import is listed as dynamic too; at run time the hook sees the evaluated string, which is not a static specifier either
    const edges = [
      {seq: 0, parent: null, specifier: 'entry', resolved: entry}, {seq: 1, parent: entry, specifier: './a.ts', resolved: 'file:///repo/a.ts'},
      {seq: 2, parent: entry, specifier: './late.ts', resolved: 'file:///repo/late.ts'}, {seq: 3, parent: 'file:///repo/a.ts', specifier: './deep.ts', resolved: 'file:///repo/deep.ts'},
    ];
    expect(classifyEdges(edges, entry, kinds).map(edge => edge.kind)).toEqual(['entry', 'static', 'dynamic', 'transitive']);
  });
  it('a transitive forbidden import is judged a failure, as are a process spawn, a network attempt, a protected write, a changed log and an output directory left behind', () => {
    const held: ProbeObservation = {preloadReady: true, exitCode: 2, stdoutStatus: 'not_run', edges: [{seq: 0, parent: entry, specifier: './x.ts', resolved: 'file:///repo/x.ts'}], violations: [], protectedLogBefore: {size: 5, mtimeMs: 1}, protectedLogAfter: {size: 5, mtimeMs: 1}, outDirExistedBefore: false, outDirExistsAfter: false, outDirEntriesAfter: []};
    const expectation = {name: 'case', exitCode: 2, status: 'not_run', outDirMustNotExist: true};
    expect(judgeProbeCase(expectation, held)).toEqual([]);
    expect(judgeProbeCase(expectation, {...held, edges: [...held.edges, {seq: 1, parent: 'file:///repo/x.ts', specifier: './logger.ts', resolved: 'file:///repo/server/src/lib/logger.ts'}]}).join()).toMatch(/forbidden module resolved: logger/);
    for (const kind of ['process_spawn', 'network', 'protected_write'] as const) expect(judgeProbeCase(expectation, {...held, violations: [{kind, detail: 'd'}]}).join(), kind).toContain(kind);
    expect(judgeProbeCase(expectation, {...held, protectedLogAfter: {size: 6, mtimeMs: 2}}).join()).toMatch(/protected log changed/);
    expect(judgeProbeCase(expectation, {...held, outDirExistsAfter: true}).join()).toMatch(/output directory exists/);
    expect(judgeProbeCase(expectation, {...held, stdoutStatus: 'preflight_failed'}).join()).toMatch(/different reason/); // refused, but not for the reason the case targets
    // Phase 36H: a probe whose preload never reported ready, or that recorded no module resolution at all, proves nothing and must not read as "held".
    expect(judgeProbeCase(expectation, {...held, preloadReady: false}).join()).toMatch(/preload never reported ready/);
    expect(judgeProbeCase(expectation, {...held, edges: []}).join()).toMatch(/no module resolution was recorded/);
    expect(judgeProbeCase({...expectation, outDirMustNotExist: false}, {...held, outDirEntriesAfter: ['run-manifest.json']}).join()).toMatch(/pre-existing output directory was modified/);
  });
  it('protected paths are matched lexically (the log, the served directory, public), not by name', () => {
    expect(isProtectedPath('/repo/logs/engine.log', ['/repo/logs'])).toBe(true);
    expect(isProtectedPath('/repo/logs-old/x', ['/repo/logs'])).toBe(false);
    expect(isProtectedPath('/repo/logs/../remotion/public/x', ['/repo/remotion/public'])).toBe(true);
  });
  it('the probe never sets the approval variable, requires explicit authorisation, imports no logger or provider SDK, and removes only its own scratch (static)', () => {
    const files = ['probe_policy.ts', 'probe_preload.ts', 'run_probe.ts'].map(name => [name, read(`remotion/out/phase36-readiness/import-boundary/${name}`)] as const);
    for (const [name, source] of files) {
      expect(source, name).not.toMatch(/P36_APPROVED\s*[:=]\s*['"]yes/);
      expect(source, name).not.toMatch(/^(?:import|export)\s[^\n]*from\s+['"](?!node:)[^'"]*(logger|worker|ffmpeg|localRender|analyzeVideo|@anthropic-ai|@google|groq)/m); // real import statements only (node: built-ins such as worker_threads are the denied surface, not a dependency), not the fake-module text the self-test writes
    }
    const driver = files.find(([name]) => name === 'run_probe.ts')![1];
    expect(driver).toContain("'--authorized'");
    expect(driver.match(/rmSync\(/g)?.length).toBe(2); // the self-test marker file and the single scratch directory it created
    expect(driver).toContain('rmSync(scratch, {recursive: true, force: true})');
    expect(driver).toContain('P36_|ANTHROPIC_'); // the child environment never inherits an approval or provider variable
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Phase 36I: probe hardening. Source-text checks only: they show what the code DECLARES, not that the denials work at run time.
describe('probe hardening (static; the probe has not been executed)', () => {
  const preload = read('remotion/out/phase36-readiness/import-boundary/probe_preload.ts');
  const driver = read('remotion/out/phase36-readiness/import-boundary/run_probe.ts');

  it('installs the hooks first, and every denial and the marker come after them', () => {
    const at = (needle: string) => { const i = preload.indexOf(needle); expect(i, needle).toBeGreaterThan(0); return i; };
    const order = ['registerHooks({', "asRecord(childProcess)[name]", 'globalThis.fetch = (() =>', 'denyEach(net,', 'for (const holder of [fs, fs.promises])', 'syncBuiltinESMExports();', "if (process.env.PROBE_OFFLINE === '1')", "record({type: 'ready'"].map(at);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(preload.indexOf('await import(')).toBeGreaterThan(preload.indexOf('syncBuiltinESMExports();')); // no protected module is loaded before the restrictions exist
  });
  it('declares denial of the global fetch, WebSocket, http(s), http2, net, tls, dns (callback and promise), dgram, workers and child processes', () => {
    for (const needle of ["'fetch'", 'WebSocket', "denyEach(http, 'http'", "denyEach(https, 'https'", "denyEach(http2, 'http2'", "denyEach(net, 'net', ['connect', 'createConnection'])", 'net.Socket.prototype', "denyEach(tls, 'tls'", "denyEach(dgram, 'dgram'",
      "denyEach(dns, 'dns'", "denyEach(dns.promises, 'dns.promises'", 'worker_threads.Worker', "'spawnSync'", "'execFileSync'", "'fork'"]) expect(preload, needle).toContain(needle);
  });
  it('guards sync, callback, promise and stream write APIs, both paths of two-path calls, and write-mode opens', () => {
    for (const needle of ["'writeFile'", "'appendFile'", "'mkdir'", "'rm'", "'rename'", "'copyFile'", "'cp'", "'symlink'", "'link'", "'createWriteStream'", '`${base}Sync`', 'for (const holder of [fs, fs.promises])', 'TWO_PATH', 'writeFlags(args[1])', '(write)`']) expect(preload, needle).toContain(needle);
  });
  it('the offline marker publishes the DENYING fetch (so the runner\'s same-fetch check passes without restoring a real network function)', () => {
    expect(preload.indexOf('globalThis.fetch = (() =>')).toBeLessThan(preload.indexOf('fetch: globalThis.fetch'));
  });
  it('the driver runs every probed child under Node\'s permission model: no child-process or worker permission, writes only to its scratch directory (static)', () => {
    expect(driver).toContain("'--permission'");
    expect(driver).toContain('--allow-fs-write=');
    expect(driver).not.toMatch(/--allow-child-process|--allow-worker|--allow-addons|--allow-wasi/);
    expect(driver.match(/permissionFlags\(/g)?.length).toBe(2); // the case runner and the self-test (the definition is an arrow function)
    expect(driver).toContain('permissionFlags([ROOT, scratch], [scratch])');
    expect(driver).not.toMatch(/Downloads/); // the real source's directory is never in an allowed path
  });
  it('the fixture policy treats "the permission model forbade looking at the real source" like "there is no real source", and any other error still refuses (static)', () => {
    const policy = read('remotion/out/phase36-readiness/dry-run/fixture_policy.ts');
    expect(policy).toContain("code !== 'ENOENT' && code !== 'ERR_ACCESS_DENIED'");
    expect(policy.indexOf("path.resolve(realSource) === canonical")).toBeLessThan(policy.indexOf('fs.realpathSync(realSource)')); // the pure path comparison runs first
    expect(policy.indexOf("sha256 !== entry.sha256")).toBeGreaterThan(policy.indexOf('ERR_ACCESS_DENIED')); // the pinned content hash is still enforced afterwards
  });
});
