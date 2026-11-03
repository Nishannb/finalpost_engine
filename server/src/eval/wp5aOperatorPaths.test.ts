/**
 * WP5A source-text tests: the live operator documents / scripts no longer hard-code the old checkout path. The files are only read (no script is run, no runner spawned, no logger, no network).
 * `bash -n` (parse only) is run once by hand for the shell script; this suite keeps the text rules.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (relative: string) => readFileSync(resolve(REPO, relative), 'utf8');
const OLD = '/Users/nishanbaral/Desktop/apps/finalpost_engine';

describe('PRE_RUN_CHECKLIST.md', () => {
  const text = read('remotion/out/phase36-readiness/PRE_RUN_CHECKLIST.md');
  it('does not contain the old absolute path', () => {
    expect(text).not.toContain(OLD);
  });
  it('gives the current repository root and a command that works from it, with the mode the runner requires', () => {
    expect(text).toContain('/Users/nishanbaral/Desktop/apps/creators_kinmel/finalpost_engine');
    expect(text).toContain('P36_APPROVED=yes node --experimental-strip-types remotion/out/phase36-readiness/run_experiment.ts remotion/out/phase36-experiment --mode=paid');
  });
  it('keeps the approval gate honest: exact yes, mode required, exit 2, and a fresh explicit authorization is still needed', () => {
    expect(text).toContain('Only the exact value `yes`');
    expect(text).toContain('`--mode=paid` is required');
    expect(text).toMatch(/not an authorization/);
    expect(text).toMatch(/fresh, explicit authorization/);
    expect(text).toContain('a paid run stays unauthorized until a fresh, explicit authorization is given');
    expect(text).not.toMatch(/reuses and overwrites a directory/);
  });
  it('keeps the caps and billing text', () => {
    for (const line of ['Cap 2 requests', 'Cap 10 requests, $0.05 estimated', 'Cap 4 requests, $0.25 estimated', 'estimates, not billing ceilings']) expect(text).toContain(line);
  });
});

describe('dry-run/chain_pf.sh', () => {
  const text = read('remotion/out/phase36-readiness/dry-run/chain_pf.sh');
  it('does not contain the old absolute path and derives its directory from its own location', () => {
    expect(text).not.toContain(OLD);
    expect(text).toContain('cd "$(dirname "$0")" || exit 1');
  });
  it('is otherwise unchanged: the synthetic fixture, the refusal to re-run, the scenario list and the done marker', () => {
    expect(text).toContain('[ -e chain_pf.done ] && {');
    expect(text).toContain('export DRY_SOURCE_FIXTURE="$PWD/fixture/synthetic_41s.mp4"');
    expect(text).toContain('unset P36_APPROVED PRELOAD');
    expect(text.match(/^\.\/run_scenario_pf\.sh /gm)).toHaveLength(10);
    expect(text).toContain('echo done > chain_pf.done');
    expect(text).not.toMatch(/P36_APPROVED=yes/);
  });
});

describe('the runner and the product are untouched by this package', () => {
  it('the runner still derives its root from its own location', () => {
    expect(read('remotion/out/phase36-readiness/run_experiment.ts')).toContain("const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');");
  });
  it('the defaults are unchanged', () => {
    const env = read('server/src/config/env.ts');
    expect(env).toMatch(/PRODUCT_EDIT_PROFILE: str\('cuts'\)/);
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED: bool\(false\)/);
  });
});
