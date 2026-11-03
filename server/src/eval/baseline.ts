/**
 * Baseline manifests for the evaluation harness. Pure Node (git + fs); no model, no network.
 *
 *   A. LEGACY COMPATIBILITY baseline: the approved working state with experimental flags off — code-state id,
 *      flags, fixtures and goldens with hashes. Goldens are self-generated pins of that state, not ground truth.
 *   B. EXPERIMENTAL CAPABILITY baseline: an index of existing Phase 9–12 artifacts, classified by what they are and
 *      which stages they exercise. Existing evidence is hashed, never modified.
 */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';

export const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');
export const sha256File = (path: string): string => sha256(readFileSync(path));

const git = (root: string, args: string[]): string => execFileSync('git', args, {cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024});

/** Source trees that define behaviour. Media, outputs, node_modules and the eval baselines themselves are excluded. */
const CODE_ROOTS = ['server/src', 'remotion/src', 'prompts', 'server/package.json', 'remotion/package.json', 'server/tsconfig.json'];
const EXCLUDED = [/^server\/src\/eval\/(baselines|golden)\//, /(^|\/)node_modules\//, /\.(mp4|webm|png|jpg|jpeg|woff2?|ttf|otf)$/i];

export type CodeState = {
  head: string;
  branch: string;
  dirtyTrackedFiles: number;
  untrackedSourceFiles: number;
  /** sha256 over every behaviour-defining file's `path:sha256` (sorted). Changes if any such file changes. */
  treeSha256: string;
  trackedDiffSha256: string;
  note: string;
};

export function listCodeFiles(root: string): string[] {
  const tracked = git(root, ['ls-files', '-co', '--exclude-standard', '--', ...CODE_ROOTS]).split('\n').filter(Boolean);
  return [...new Set(tracked)].filter(path => !EXCLUDED.some(pattern => pattern.test(path)) && existsSync(join(root, path))).sort();
}

export function codeState(root: string): CodeState {
  const files = listCodeFiles(root);
  const lines = files.map(path => `${path}:${sha256File(join(root, path))}`);
  const status = git(root, ['status', '--porcelain', '--', ...CODE_ROOTS]).split('\n').filter(Boolean);
  return {
    head: git(root, ['rev-parse', 'HEAD']).trim(),
    branch: git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).trim(),
    dirtyTrackedFiles: status.filter(line => !line.startsWith('??')).length,
    untrackedSourceFiles: status.filter(line => line.startsWith('??')).length,
    treeSha256: sha256(lines.join('\n')),
    trackedDiffSha256: sha256(git(root, ['diff', 'HEAD', '--', ...CODE_ROOTS])),
    note: 'The working tree has uncommitted work; HEAD alone does not identify the approved state. treeSha256 does.',
  };
}

export type ArtifactClass =
  | 'saved_response_replay_fixture'
  | 'synthetic_fixture'
  | 'hand_built_blueprint_render'
  | 'earlier_pipeline_output'
  | 'saved_response_replay_render'
  | 'design_document'
  | 'test_source';

export type Stage =
  | 'transcription' | 'v1_director' | 'v2_director' | 'planBRoll' | 'resolveDirectedZooms' | 'finalizeEdits' | 'assembler_v2' | 'compiler_v2'
  | 'analyzeVideo_assembly' | 'remotion_render' | 'blueprint_schema' | 'motion_graphics' | 'none';

export type ArtifactRule = {
  match: RegExp;
  cls: ArtifactClass;
  stages: Stage[];
  /** What the artifact does NOT exercise or prove. */
  limits: string;
};

export const ARTIFACT_RULES: ArtifactRule[] = [
  {match: /^remotion\/out\/phase9-validation\/(hi-[^/]+)\/(props|ledger)\.json$/, cls: 'saved_response_replay_render', stages: ['planBRoll', 'finalizeEdits', 'analyzeVideo_assembly', 'blueprint_schema'], limits: 'Per the Phase 9 report these replayed saved Director responses through Phase 8 code; the replay script is not in the repo. Not independently reproducible here.'},
  {match: /^remotion\/out\/phase9-validation\/(hi-[^/]+)\/final\.mp4$/, cls: 'saved_response_replay_render', stages: ['remotion_render'], limits: 'Local Remotion render of the replayed plan on the real Hi clip.'},
  {match: /^remotion\/out\/phase9-validation\/hi-[^/]+\/(check\/|swatch\.rgb)/, cls: 'saved_response_replay_render', stages: ['remotion_render'], limits: 'Frames/samples extracted from the Phase 9 local render for visual checks.'},
  {match: /^remotion\/out\/phase1[01]-validation\/(README\.md|matte_frame0\.png)$|^remotion\/out\/phase1[01]-validation\/render_all\.sh$/, cls: 'hand_built_blueprint_render', stages: ['remotion_render'], limits: 'Scripts/notes/derived frame belonging to the synthetic-fixture renders.'},
  {match: /^remotion\/out\/phase9-validation\/stills\//, cls: 'hand_built_blueprint_render', stages: ['remotion_render'], limits: 'Stills used for geometry/legibility calibration; they show the renderer, not planner decisions.'},
  {match: /^remotion\/out\/phase10b-validation\/(props|public)\//, cls: 'hand_built_blueprint_render', stages: ['blueprint_schema'], limits: 'Hand-written blueprints over a synthetic ffmpeg clip. No planner, no Director.'},
  {match: /^remotion\/out\/phase10b-validation\/stills\//, cls: 'hand_built_blueprint_render', stages: ['remotion_render'], limits: 'Renderer-only evidence on synthetic frames.'},
  {match: /^remotion\/out\/phase11-validation\/(props|public)\//, cls: 'hand_built_blueprint_render', stages: ['blueprint_schema'], limits: 'Hand-written blueprints over synthetic clips/slides/matte. No planner, no Director.'},
  {match: /^remotion\/out\/phase11-validation\/stills\/before_/, cls: 'hand_built_blueprint_render', stages: ['remotion_render'], limits: 'Pre-fix renders kept as evidence of the defect.'},
  {match: /^remotion\/out\/phase11-validation\/stills\//, cls: 'hand_built_blueprint_render', stages: ['remotion_render'], limits: 'Renderer-only evidence on synthetic frames.'},
  {match: /^remotion\/out\/phase1[012]-[^/]+\/.*\.md$/, cls: 'design_document', stages: ['none'], limits: 'Prose; not an execution artifact.'},
  {match: /^remotion\/out\/phase(5|6|7)[^/]*\/.*\/director\/01-gemini-director\.json$/, cls: 'earlier_pipeline_output', stages: ['transcription', 'v1_director'], limits: 'Real Gemini response saved by an earlier phase (the raw material for the replay corpus).'},
  {match: /^remotion\/out\/phase(5|6|7)[^/]*\/.*\/blueprint\.json$/, cls: 'earlier_pipeline_output', stages: ['transcription', 'v1_director', 'planBRoll', 'analyzeVideo_assembly', 'motion_graphics'], limits: 'Produced by the code of its own phase. Planner behaviour has changed deliberately since, so it is reference only, never a golden.'},
  {match: /^server\/src\/eval\/fixtures\//, cls: 'saved_response_replay_fixture', stages: ['v1_director', 'planBRoll', 'resolveDirectedZooms', 'finalizeEdits', 'blueprint_schema'], limits: 'Real v1 responses; stock and Director call stubbed; no assembly, no render.'},
  {match: /^server\/src\/stages\/broll\/__fixtures__\//, cls: 'saved_response_replay_fixture', stages: ['v1_director', 'planBRoll', 'finalizeEdits'], limits: 'One saved Hi response with caption words; used by planBRoll.ledger.test.ts.'},
  {match: /^server\/src\/stages\/broll\/deterministicReplay\.test\.ts$/, cls: 'synthetic_fixture', stages: ['assembler_v2', 'compiler_v2', 'planBRoll', 'blueprint_schema'], limits: 'Synthetic v2 plans; no real v2 response exists in the repo.'},
  {match: /^server\/src\/.*\.test\.ts$/, cls: 'test_source', stages: ['none'], limits: 'Unit/contract tests; see the test file for the stage it exercises.'},
];

export type ArtifactEntry = {path: string; sha256: string; bytes: number; cls: ArtifactClass; stages: Stage[]; limits: string};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

export function classify(path: string): ArtifactRule | null {
  return ARTIFACT_RULES.find(rule => rule.match.test(path)) ?? null;
}

export function indexArtifacts(root: string, dirs: string[]): {entries: ArtifactEntry[]; unclassified: string[]} {
  const entries: ArtifactEntry[] = [];
  const unclassified: string[] = [];
  for (const dir of dirs) {
    const full = join(root, dir);
    if (!existsSync(full)) {
      continue;
    }
    for (const file of walk(full).sort()) {
      const path = relative(root, file).split('\\').join('/');
      const rule = classify(path);
      if (!rule) {
        unclassified.push(path);
        continue;
      }
      entries.push({path, sha256: sha256File(file), bytes: statSync(file).size, cls: rule.cls, stages: rule.stages, limits: rule.limits});
    }
  }
  return {entries, unclassified};
}

// ---- verification (read-only) ---------------------------------------------------------------------------------------

export type ManifestProblem = {kind: 'missing' | 'changed'; path: string; expected: string; actual: string | null};

export type ManifestVerification = {
  /** Fixtures, goldens and reference outputs that are missing or whose bytes changed. Any entry here is a real failure. */
  problems: ManifestProblem[];
  /**
   * The behaviour-defining tree differs from the recorded `treeSha256`. This is NOT a failure on its own (code changes
   * legitimately after a freeze) and it cannot be attributed to files: the manifest stores only the aggregate hash.
   */
  treeChanged: boolean;
};

/** Re-hash everything a legacy manifest pins. Never writes. `root` is the repo root the manifest paths are relative to. */
export function verifyLegacyManifest(root: string, manifest: {codeState?: {treeSha256?: string}; fixtures?: Array<{path: string; sha256: string}>; goldens?: Array<{path: string; sha256: string}>; referenceOutputs?: Array<{path: string; sha256: string}>}, options: {checkTree?: boolean} = {}): ManifestVerification {
  const problems: ManifestProblem[] = [];
  for (const file of [...(manifest.fixtures ?? []), ...(manifest.goldens ?? []), ...(manifest.referenceOutputs ?? [])]) {
    const full = join(root, file.path);
    if (!existsSync(full)) {
      problems.push({kind: 'missing', path: file.path, expected: file.sha256, actual: null});
      continue;
    }
    const actual = sha256File(full);
    if (actual !== file.sha256) {
      problems.push({kind: 'changed', path: file.path, expected: file.sha256, actual});
    }
  }
  const treeChanged = options.checkTree === false ? false : Boolean(manifest.codeState?.treeSha256) && codeState(root).treeSha256 !== manifest.codeState!.treeSha256;
  return {problems, treeChanged};
}

/** Same for the experimental index: artifacts that disappeared or changed since they were hashed. */
export function verifyExperimentalManifest(root: string, manifest: {artifacts?: Array<{path: string; sha256: string; cls: string}>}): ManifestProblem[] {
  const problems: ManifestProblem[] = [];
  for (const artifact of manifest.artifacts ?? []) {
    const full = join(root, artifact.path);
    if (!existsSync(full)) {
      problems.push({kind: 'missing', path: artifact.path, expected: artifact.sha256, actual: null});
    } else if (sha256File(full) !== artifact.sha256) {
      problems.push({kind: 'changed', path: artifact.path, expected: artifact.sha256, actual: sha256File(full)});
    }
  }
  return problems;
}
