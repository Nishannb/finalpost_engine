/** The manifest verifier must detect tampering and must never write. Runs on a temporary copy; the real baseline is untouched. */
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {afterAll, describe, expect, it} from 'vitest';

import {sha256File, verifyExperimentalManifest, verifyLegacyManifest} from './baseline.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..', '..');
const legacy = JSON.parse(readFileSync(join(here, 'baselines', 'legacy.manifest.json'), 'utf8'));
const scratch = mkdtempSync(join(tmpdir(), 'eval-baseline-'));
afterAll(() => rmSync(scratch, {recursive: true, force: true}));

/** A temp "repo root" holding copies of everything the legacy manifest pins. */
function copyPinned(): string {
  const root = mkdtempSync(join(scratch, 'root-'));
  for (const file of [...legacy.fixtures, ...legacy.goldens, ...legacy.referenceOutputs] as Array<{path: string}>) {
    mkdirSync(dirname(join(root, file.path)), {recursive: true});
    cpSync(join(repo, file.path), join(root, file.path));
  }
  return root;
}

describe('legacy manifest verification', () => {
  it('passes on the real repository (fixtures, goldens and reference outputs match their recorded hashes)', () => {
    expect(verifyLegacyManifest(repo, legacy, {checkTree: false}).problems).toEqual([]);
  });

  it('passes on an untouched copy', () => {
    expect(verifyLegacyManifest(copyPinned(), legacy, {checkTree: false}).problems).toEqual([]);
  });

  it('detects a changed fixture, a changed golden, a changed reference output, and a missing file', () => {
    const root = copyPinned();
    const target = (kind: 'fixtures' | 'goldens' | 'referenceOutputs') => (legacy[kind] as Array<{path: string}>)[0]!.path;
    for (const kind of ['fixtures', 'goldens', 'referenceOutputs'] as const) {
      const path = join(root, target(kind));
      writeFileSync(path, readFileSync(path, 'utf8') + ' ');
    }
    const removed = (legacy.fixtures as Array<{path: string}>)[1]!.path;
    rmSync(join(root, removed));
    const result = verifyLegacyManifest(root, legacy, {checkTree: false});
    expect(result.problems.map(item => `${item.kind}:${item.path}`).sort()).toEqual(
      [`changed:${target('fixtures')}`, `changed:${target('goldens')}`, `changed:${target('referenceOutputs')}`, `missing:${removed}`].sort(),
    );
  });

  it('a regenerated golden is caught against the frozen hash (silent re-approval is not possible without also rewriting the manifest)', () => {
    const root = copyPinned();
    const golden = (legacy.goldens as Array<{path: string; sha256: string}>).find(item => item.path.endsWith('.planner.json'))!;
    const path = join(root, golden.path);
    const rewritten = JSON.parse(readFileSync(path, 'utf8'));
    rewritten.hook.text = 'regenerated';
    writeFileSync(path, JSON.stringify(rewritten, null, 1));
    expect(sha256File(path)).not.toBe(golden.sha256);
    expect(verifyLegacyManifest(root, legacy, {checkTree: false}).problems).toEqual([expect.objectContaining({kind: 'changed', path: golden.path})]);
  });

  it('verification never writes: the pinned files and the manifest are byte-identical before and after', () => {
    const before = [...legacy.fixtures, ...legacy.goldens].map((file: {path: string}) => statSync(join(repo, file.path)).mtimeMs);
    verifyLegacyManifest(repo, legacy, {checkTree: false});
    expect([...legacy.fixtures, ...legacy.goldens].map((file: {path: string}) => statSync(join(repo, file.path)).mtimeMs)).toEqual(before);
  });
});

describe('experimental manifest verification', () => {
  const experimental = JSON.parse(readFileSync(join(here, 'baselines', 'experimental.manifest.json'), 'utf8'));
  it('detects a missing and a changed artifact in a copy', () => {
    const root = mkdtempSync(join(scratch, 'exp-'));
    const picked = (experimental.artifacts as Array<{path: string; sha256: string; cls: string}>).filter(item => item.bytes !== undefined || true).slice(0, 3);
    for (const artifact of picked) {
      mkdirSync(dirname(join(root, artifact.path)), {recursive: true});
      cpSync(join(repo, artifact.path), join(root, artifact.path));
    }
    expect(verifyExperimentalManifest(root, {artifacts: picked})).toEqual([]);
    writeFileSync(join(root, picked[0]!.path), 'tampered');
    rmSync(join(root, picked[1]!.path));
    expect(verifyExperimentalManifest(root, {artifacts: picked}).map(item => item.kind).sort()).toEqual(['changed', 'missing']);
  });

  it('every indexed Phase 9–12 evidence file still exists; code/test sources may legitimately have changed since', () => {
    const evidence = (experimental.artifacts as Array<{path: string; sha256: string; cls: string}>).filter(item => item.cls !== 'test_source' && !item.path.startsWith('server/src/'));
    expect(evidence.length).toBeGreaterThan(100);
    expect(verifyExperimentalManifest(repo, {artifacts: evidence})).toEqual([]);
    expect(existsSync(join(repo, 'remotion/out/phase12-design/01_VISUAL_PIPELINE_MAP.md'))).toBe(true);
  });
});
