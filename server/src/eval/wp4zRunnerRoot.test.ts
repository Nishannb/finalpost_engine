/**
 * WP4Z source-text tests: the experiment runner derives its repository root from its own location instead of a fixed absolute path. The runner is READ, never spawned or imported (it
 * would start the experiment machinery); experimentMode.ts is the pure parser the runner loads first. No logger, no `.env`, no network, no model call, no process spawned.
 */
import {existsSync, readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {parseExperimentInvocation} from '../lib/experimentMode.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const RUNNER = resolve(REPO, 'remotion/out/phase36-readiness/run_experiment.ts');
const source = readFileSync(RUNNER, 'utf8');
const code = source.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, '');

describe('the repository root in the runner', () => {
  it('is derived from the runner\'s own file location, three levels up', () => {
    expect(code).toContain("const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');");
    expect(code).toContain("import {fileURLToPath} from 'node:url';");
  });
  it('no fixed absolute path to a checkout remains in the runner\'s code (the paid source path is the user\'s file, not the repository)', () => {
    expect(code).not.toContain('/Users/nishanbaral/Desktop/apps/finalpost_engine');
    expect(code).toContain("const PAID_SOURCE = '/Users/nishanbaral/Downloads/2.mp4';"); // unchanged
  });
  it('the derived root is this repository, and every module the runner loads before its first decision exists there', () => {
    const derived = resolve(dirname(RUNNER), '../../..');
    expect(derived).toBe(REPO);
    for (const relative of ['server/src/lib/experimentMode.ts', 'remotion/out/phase36-readiness/dry-run/fixture_policy.ts', 'server/src/config/env.ts', 'server/src/lib/experimentPreflight.ts', 'server/src/lib/claimOutputDir.ts', 'server/src/lib/runOwnership.ts']) {
      expect(existsSync(resolve(derived, relative)), relative).toBe(true);
    }
  });
  it('every dynamic import in the runner still goes through ROOT', () => {
    const imports = [...code.matchAll(/await import\(([^)]+)\)/g)].map(match => match[1] as string);
    expect(imports.length).toBeGreaterThan(8);
    for (const specifier of imports) expect(specifier, specifier).toContain('${ROOT}');
  });
  it('the refusal path and the approval gate are untouched: exit 2 from refuseRun, mode refusal first, then P36_APPROVED', () => {
    expect(code).toContain('const refuseRun = (reason: string, exitCode = 2): never => {');
    expect(code).toContain('if (!invocation.ok) refuseRun(invocation.reason);');
    expect(code).toContain("if (MODE === 'paid' && process.env.P36_APPROVED !== 'yes') refuseRun('P36_APPROVED=yes is required (this run makes paid provider calls)');");
    expect(code.indexOf('if (!invocation.ok)')).toBeLessThan(code.indexOf("process.env.P36_APPROVED !== 'yes'"));
    expect(code).toContain("process.exit(verdict.status === 'success' ? 0 : 1);");
  });
});

describe('what the runner decides (the pure parser it calls; nothing is spawned)', () => {
  const parse = (args: string[], env: Record<string, string | undefined> = {}) =>
    parseExperimentInvocation({args, env, marker: undefined, currentFetch: globalThis.fetch, tmpRoots: []});
  it('the tests\' invocation (an output directory and no --mode) is refused for the missing mode, which refuseRun turns into exit 2', () => {
    for (const value of [undefined, '', 'YES', 'true', '1', 'yes ', 'no', 'yes']) {
      const result = parse(['/tmp/p36-should-not-exist'], value === undefined ? {} : {P36_APPROVED: value});
      expect(result.ok, String(value)).toBe(false);
      expect((result as {reason: string}).reason).toBe('--mode=paid or --mode=offline is required');
    }
  });
  it('with --mode=paid the approval gate refuses everything except the exact value yes', () => {
    for (const value of [undefined, '', 'YES', 'true', '1', 'yes ', 'no']) {
      const result = parse(['--mode=paid', '/tmp/p36-should-not-exist'], value === undefined ? {} : {P36_APPROVED: value});
      expect(result.ok, String(value)).toBe(false);
      expect((result as {reason: string}).reason).toMatch(/P36_APPROVED=yes is required/);
    }
  });
  it('only the exact approval with --mode=paid is accepted by the parser (it would then continue to the preflight and the claim; nothing runs here)', () => {
    expect(parse(['--mode=paid'], {P36_APPROVED: 'yes'})).toMatchObject({ok: true, mode: 'paid'});
  });
  it('an unknown or repeated mode, an unknown option and a second directory are refused', () => {
    expect(parse(['--mode=weird']).ok).toBe(false);
    expect(parse(['--mode=paid', '--mode=paid'], {P36_APPROVED: 'yes'}).ok).toBe(false);
    expect(parse(['--mode=paid', '--force'], {P36_APPROVED: 'yes'}).ok).toBe(false);
    expect(parse(['--mode=paid', 'a', 'b'], {P36_APPROVED: 'yes'}).ok).toBe(false);
  });
});

describe('why a wrong root gave exit 1 (source order)', () => {
  it('the first module the runner loads is a top-level await import under ROOT, placed before the first refusal can run, so a missing module rejects the whole program (Node exits 1) before refuseRun (exit 2)', () => {
    const firstImport = code.indexOf('await import(`${ROOT}/server/src/lib/experimentMode.ts`)');
    expect(firstImport).toBeGreaterThan(code.indexOf('const refuseRun'));
    expect(firstImport).toBeLessThan(code.indexOf('if (!invocation.ok)'));
  });
});
