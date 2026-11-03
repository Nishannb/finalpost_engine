/**
 * WP5B source-text tests: no dry-run helper (.sh / .ts) hard-codes a checkout path; each derives the repository root from its own location. The files are only read: nothing is run,
 * imported or spawned (no runner, no logger, no network). `bash -n` and a TypeScript syntax transpile were run once by hand for the edited files.
 */
import {readdirSync, readFileSync, existsSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

import {describe, expect, it} from 'vitest';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DRY = resolve(REPO, 'remotion/out/phase36-readiness/dry-run');
const OLD = '/Users/nishanbaral/Desktop/apps/finalpost_engine';
const NEW_ABSOLUTE = '/Users/nishanbaral/Desktop/apps/creators_kinmel';
const helpers = readdirSync(DRY).filter(name => /\.(sh|ts)$/.test(name)).sort();
const text = (name: string) => readFileSync(resolve(DRY, name), 'utf8');

describe('every dry-run .sh and .ts helper', () => {
  it('there are helpers to check', () => {
    expect(helpers).toEqual(expect.arrayContaining(['chain.sh', 'chain_pf.sh', 'chain_r2.sh', 'run_scenario.sh', 'run_scenario_pf.sh', 'mock_preload.ts', 'mock_preload_audit.ts', 'mock_preload_fixture.ts', 'guard_check.ts', 'rejudge.ts', 'recheck_outputs.ts', 'supervise.ts']));
  });
  it('none contains the old absolute path', () => {
    for (const name of helpers) expect(text(name).includes(OLD), name).toBe(false);
  });
  it('none replaces it with another fixed checkout path (it would break on the next move)', () => {
    for (const name of helpers) expect(text(name).includes(NEW_ABSOLUTE), name).toBe(false);
  });
});

describe('shell helpers derive their directory from their own location', () => {
  it('chain.sh, chain_r2.sh and chain_pf.sh start with cd "$(dirname "$0")"', () => {
    for (const name of ['chain.sh', 'chain_r2.sh', 'chain_pf.sh']) expect(text(name), name).toContain('cd "$(dirname "$0")" || exit 1');
  });
  it('run_scenario.sh derives D from itself and ROOT four levels up, then uses them as before', () => {
    const run = text('run_scenario.sh');
    expect(run).toContain('D="$(cd "$(dirname "$0")" && pwd)"');
    expect(run).toContain('ROOT="$(cd "$D/../../../.." && pwd)"');
    expect(run).toContain('cd $ROOT');
    expect(run).toContain('"$D/supervise.ts"');
  });
  it('their safety rules are unchanged: no approval variable, fresh temp root, offline mode only', () => {
    const run = text('run_scenario.sh');
    expect(run).toContain('refusing: P36_APPROVED must be unset');
    expect(run).toContain('--mode=offline');
    expect(run).toContain('mktemp -d /private/tmp/p36-root-XXXXXX');
    for (const name of ['chain.sh', 'chain_r2.sh', 'chain_pf.sh']) {
      expect(text(name), name).not.toMatch(/P36_APPROVED=yes/);
      expect(text(name), name).toMatch(/\[ -e chain\w*\.done \] && \{/);
    }
    expect(text('run_scenario_pf.sh')).toContain('exec "$(dirname "$0")/run_scenario.sh" "$@"');
  });
});

describe('TypeScript helpers derive the root from import.meta.url', () => {
  it('the three preloads compute ROOT four levels up from their own file, with the url import', () => {
    for (const name of ['mock_preload.ts', 'mock_preload_audit.ts', 'mock_preload_fixture.ts']) {
      const source = text(name);
      expect(source, name).toContain("const ROOT = fileURLToPath(new URL('../../../../', import.meta.url)).replace(/\\/$/, '');");
      expect(source, name).toContain("import {fileURLToPath} from 'node:url';");
    }
  });
  it('guard_check, rejudge and recheck_outputs resolve the server modules and the scenarios folder relative to themselves', () => {
    expect(text('guard_check.ts')).toContain("new URL('../../../../server/src/lib/spendGuard.ts', import.meta.url).href");
    for (const name of ['rejudge.ts', 'recheck_outputs.ts']) {
      expect(text(name), name).toContain("new URL('../../../../server/src/pipeline/experimentVerdict.ts', import.meta.url).href");
      expect(text(name), name).toContain("const base = fileURLToPath(new URL('./scenarios', import.meta.url));");
      expect(text(name), name).toContain("import {fileURLToPath} from 'node:url';");
    }
  });
  it('the derived paths land in this repository: the files each helper reaches exist', () => {
    for (const name of ['mock_preload.ts', 'mock_preload_audit.ts', 'mock_preload_fixture.ts', 'guard_check.ts', 'rejudge.ts', 'recheck_outputs.ts']) {
      const from = pathToFileURL(resolve(DRY, name));
      expect(fileURLToPath(new URL('../../../../', from)).replace(/\/$/, ''), name).toBe(REPO);
      expect(existsSync(fileURLToPath(new URL('../../../../server/src/lib/experimentMode.ts', from))), name).toBe(true);
      expect(existsSync(fileURLToPath(new URL('../../../../server/src/pipeline/experimentVerdict.ts', from))), name).toBe(true);
    }
  });
  it('the dynamic imports under ROOT in the preloads are still the same modules', () => {
    expect(text('mock_preload_fixture.ts')).toContain('await import(`${ROOT}/server/src/lib/experimentMode.ts`)');
    expect(text('mock_preload_fixture.ts')).toContain('await import(`${ROOT}/server/src/config/env.ts`)');
    expect(text('mock_preload.ts')).toContain('await import(`${ROOT}/server/src/config/env.ts`)');
  });
});

describe('what is not touched', () => {
  it('the runner keeps its derived root, the launcher policy keeps its allowlist, and the defaults are unchanged', () => {
    expect(readFileSync(resolve(REPO, 'remotion/out/phase36-readiness/run_experiment.ts'), 'utf8')).toContain("const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');");
    expect(text('launcher_policy.ts')).toContain("export const ALLOWED_PRELOADS: readonly string[] = ['mock_preload.ts', 'mock_preload_fixture.ts'];");
    const env = readFileSync(resolve(REPO, 'server/src/config/env.ts'), 'utf8');
    expect(env).toMatch(/PRODUCT_EDIT_PROFILE: str\('cuts'\)/);
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED: bool\(false\)/);
  });
});
