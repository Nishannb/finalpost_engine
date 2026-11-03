/**
 * Re-check a manifest's recorded hashes against the files on disk, when those files are available. Offline, read-only.
 *
 * A manifest is a claim. The collector hashes files when it builds one, but a manifest can be edited, can outlive its files, or can
 * be written by a harness that did not hash anything. This module closes that loop for the files it can reach:
 *   verified_match   the file exists and its SHA-256 equals the recorded one
 *   mismatch         the file exists and its SHA-256 differs from the recorded one  (the manifest is wrong: never comparable)
 *   file_unavailable the file is not there to check (not a failure; the value stays unverified)
 *   recorded_unknown the manifest itself says the hash is unknown (nothing to check)
 */
import {existsSync, statSync} from 'node:fs';
import {isAbsolute, resolve} from 'node:path';

import {sha256File} from './baseline.ts';
import {compareManifests, isUnknown, type CompareOptions, type Comparison} from './runManifest.ts';

export type FileCheck = {
  label: string;
  path: string;
  status: 'verified_match' | 'mismatch' | 'file_unavailable' | 'recorded_unknown';
  recorded: string | null;
  actual: string | null;
};

export type VerifyOptions = {
  /** Directory that relative paths resolve against. */
  root: string;
  /** asset id -> path. The manifest records asset ids and hashes, not paths, so a caller who has the files says where they are. */
  assetPaths?: Record<string, string>;
  sourcePath?: string;
  transcriptPath?: string;
  rubricPath?: string;
};

const SHA = /^[0-9a-f]{64}$/;

function check(label: string, path: string | undefined, recorded: unknown, root: string): FileCheck | null {
  if (path === undefined) {
    return null;
  }
  const absolute = isAbsolute(path) ? path : resolve(root, path);
  if (isUnknown(recorded)) {
    return {label, path, status: 'recorded_unknown', recorded: null, actual: null};
  }
  const recordedHash = typeof recorded === 'string' && SHA.test(recorded) ? recorded : null;
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    return {label, path, status: 'file_unavailable', recorded: recordedHash, actual: null};
  }
  const actual = sha256File(absolute);
  return {label, path, status: recordedHash !== null && recordedHash === actual ? 'verified_match' : 'mismatch', recorded: recordedHash, actual};
}

export function verifyManifestFiles(manifest: unknown, options: VerifyOptions): {checks: FileCheck[]; mismatches: FileCheck[]; unverified: FileCheck[]} {
  const m = manifest as Record<string, any>;
  const checks: FileCheck[] = [];
  const add = (item: FileCheck | null) => item && checks.push(item);
  for (const [index, output] of (Array.isArray(m?.outputs) ? m.outputs : []).entries()) {
    add(check(`outputs[${index}]`, typeof output?.path === 'string' ? output.path : undefined, output?.sha256, options.root));
  }
  add(check('source.videoSha256', options.sourcePath, m?.source?.videoSha256, options.root));
  add(check('source.transcriptSha256', options.transcriptPath, m?.source?.transcriptSha256, options.root));
  add(check('rubric.sha256', options.rubricPath, m?.rubric?.sha256, options.root));
  const assets: Array<{id?: string; sha256?: unknown}> = Array.isArray(m?.broll?.assets) ? m.broll.assets : [];
  for (const [index, asset] of assets.entries()) {
    if (asset?.id !== undefined && options.assetPaths && asset.id in options.assetPaths) {
      add(check(`broll.assets[${index}] (${asset.id})`, options.assetPaths[asset.id], asset.sha256, options.root));
    }
  }
  return {
    checks,
    mismatches: checks.filter(item => item.status === 'mismatch'),
    unverified: checks.filter(item => item.status === 'file_unavailable' || item.status === 'recorded_unknown'),
  };
}

export type VerifiedComparison = Comparison & {
  fileChecks: {A: FileCheck[]; B: FileCheck[]};
  /** Recorded hashes that could not be re-checked (file absent or recorded as unknown). A comparable verdict may still carry these. */
  unverified: string[];
};

/**
 * `compareManifests`, then the same decision with recorded hashes re-checked against the files that are available. A recorded hash
 * that disagrees with its file makes the pair incomparable. Files that are not available do not, but are listed as unverified.
 */
export function compareManifestsVerified(a: unknown, b: unknown, declaredVariables: string[], files: {A: VerifyOptions; B: VerifyOptions}, options: CompareOptions = {}): VerifiedComparison {
  const comparison = compareManifests(a, b, declaredVariables, options);
  const va = verifyManifestFiles(a, files.A);
  const vb = verifyManifestFiles(b, files.B);
  const reasons = [...comparison.reasons];
  for (const [label, verification] of [['A', va], ['B', vb]] as const) {
    for (const item of verification.mismatches) {
      reasons.push(`${label} ${item.label}: the recorded hash does not match the file on disk (${item.path})`);
    }
  }
  const unverified = [
    ...va.unverified.map(item => `A ${item.label} (${item.status})`),
    ...vb.unverified.map(item => `B ${item.label} (${item.status})`),
  ];
  const mismatched = va.mismatches.length + vb.mismatches.length > 0;
  return {
    ...comparison,
    verdict: mismatched ? 'not_comparable' : comparison.verdict,
    reasons,
    fileChecks: {A: va.checks, B: vb.checks},
    unverified,
  };
}
