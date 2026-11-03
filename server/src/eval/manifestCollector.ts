/**
 * Offline run-manifest collector. Pure Node (fs + git); no model call, no network, no clock, no randomness.
 *
 * It builds a `RunManifest` (see runManifest.ts) for ONE run and says, field by field, where each value came from:
 *   - verified_from_file    read and hashed from an actual file at collection time (source video, transcript, B-roll assets,
 *                           outputs, prompt files, rubric file, installed Remotion version)
 *   - verified_from_git     read from git / the working tree (commit, tree digest, dirty counts)
 *   - verified_from_runtime read from this process (Node version, the feature-flag / setting snapshot)
 *   - supplied              passed in by the caller. The collector CANNOT check that it is true (which model was called, which
 *                           frames were attached, what the renderer was told, the trim list, the video's duration)
 *   - unknown               not supplied and not derivable; written as `{$unknown: reason}`, never guessed
 *   - not_applicable        a stage that is not part of this run (written as `null` where the schema allows it)
 *
 * It never reads `.env`, never dumps the process environment (only the named flags and settings), and only lists files under the
 * behaviour-defining code roots that `baseline.ts` already defines. It is NOT wired into production, and it refuses to write a
 * manifest into the frozen baseline/golden directories or over an existing file.
 */
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {dirname, join, relative, resolve, sep} from 'node:path';

import {codeState, listCodeFiles, sha256, sha256File} from './baseline.ts';
import {checkPackMatchesSnapshot, independentMeasurements, loadSnapshotFile, occupancyInputDigest, repeatMeasurements, SnapshotError, type OccupancySnapshot} from './occupancySnapshot.ts';
import {PROMPT_FILES} from './promptLint.ts';
import {REQUIRED_FLAGS, REQUIRED_SETTINGS, unknown, validateManifest, type ManifestValidation, type RunManifest, type Unknown} from './runManifest.ts';

export type Origin = 'verified_from_file' | 'verified_from_git' | 'verified_from_runtime' | 'supplied' | 'unknown' | 'not_applicable';

type ModelStage = 'director' | 'motionDirector' | 'graphicsWorker' | 'transcription';
type ModelInfo = {id: string; [key: string]: unknown};

export type CollectInput = {
  /** Repository root (contains server/, remotion/, prompts/). */
  root: string;
  /** Identity of this run; `createdAt` is supplied so the collector stays deterministic. */
  run: {id: string; arm: string; repeat: number; createdAt: string; status: 'complete' | 'incomplete' | 'failed'};
  /** Stage records of the run (identifier, timestamps, outcome). Supplied by the run harness; the collector cannot observe them. */
  stages?: Array<{id: string; startedAt: string; endedAt: string; status: 'ok' | 'failed' | 'skipped'}>;
  /**
   * Occupancy used by the run. `snapshotPath` is read and strictly validated (its hash is then verified from the file);
   * `receivedPack` is the occupancy-bearing pack object the harness says the arm received (its digest is computed here, but the
   * object itself is supplied, so the collector can show it matches the snapshot, not that the pipeline really used it).
   */
  occupancy?: {mode?: 'replay' | 'live'; snapshotPath?: string; receivedPack?: Parameters<typeof occupancyInputDigest>[0]};
  source?: {videoPath?: string; durationSec?: number; trim?: Array<{sourceStart: number; sourceEnd: number; outputStart: number}>; transcriptPath?: string};
  pipeline?: {path?: 'v1' | 'v2'};
  /** `null` = the stage is not part of the run. A key that is absent is recorded as unknown, not as "not included". */
  models?: Partial<Record<ModelStage, ModelInfo | null>>;
  prompts?: {directorSystemSha256?: string; directorSchemaSha256?: string; contentProfileBlockSha256?: string};
  /** Snapshot of flags/settings (named keys only). Defaults to the live `env`, read by `collectFromEnv`. */
  config?: Record<string, unknown>;
  visualContext?: {frameTimesOutputSec?: number[]; imagesAttached?: number};
  broll?: {mode?: 'stock' | 'creator' | 'none'; assets?: Array<{id: string; path: string}>; stockFrozen?: boolean};
  renderer?: {engine?: string; fps?: number; width?: number; height?: number; codec?: string};
  rubric?: {version?: string; path?: string};
  outputs?: Array<{kind: string; path: string}>;
};

export type Evidence = {
  commit: string;
  branch: string;
  /** Tracked behaviour-defining files that differ from HEAD, with the SHA-256 of their current content (null = deleted). */
  trackedChanges: Array<{status: string; path: string; sha256: string | null}>;
  /** Untracked behaviour-defining files (not ignored), with their SHA-256. */
  untrackedFiles: Array<{path: string; sha256: string}>;
  trackedDiffSha256: string;
  /** What the occupancy snapshot file contained and whether the supplied pack matches it. Absent when no snapshot was supplied. */
  occupancy?: {snapshotId: string; snapshotSha256: string; independentMeasurements: number; repeats: number; receivedMatchesSnapshot: boolean | null; problems: string[]};
  /** Number of behaviour-defining files covered by `treeSha256`. */
  codeFileCount: number;
  note: string;
};

export type Collected = {
  manifest: RunManifest;
  /** Working-tree evidence behind pipeline.treeSha256. Store next to the manifest; it is not compared. */
  evidence: Evidence;
  /** Where each provenance field came from. Keys are manifest paths (and `outputs[i]`, `broll.assets[i]`). */
  origin: Record<string, Origin>;
  validation: ManifestValidation;
};

const git = (root: string, args: string[]): string => execFileSync('git', args, {cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024});

/** Flags and settings the manifest records. Only these names are ever read from the environment. */
export const CONFIG_KEYS = [...REQUIRED_FLAGS, ...REQUIRED_SETTINGS] as const;

export function collectManifest(input: CollectInput): Collected {
  const root = resolve(input.root);
  const origin: Record<string, Origin> = {};
  const note = <T>(path: string, how: Origin, value: T): T => {
    origin[path] = how;
    return value;
  };
  const unk = (path: string, reason: string): Unknown => note(path, 'unknown', unknown(reason));
  const NOT_SUPPLIED = 'not supplied to the collector';

  const hashFile = (path: string, file: string | undefined, what: string): string | Unknown => {
    if (!file) {
      return unk(path, `${what}: ${NOT_SUPPLIED}`);
    }
    const absolute = resolve(root, file);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      return unk(path, `${what}: file not found at collection time (${file})`);
    }
    return note(path, 'verified_from_file', sha256File(absolute));
  };
  const supplied = <T>(path: string, value: T | undefined, what: string): T | Unknown =>
    value === undefined ? unk(path, `${what}: ${NOT_SUPPLIED}`) : note(path, 'supplied', value);

  // --- source ---
  const src = input.source ?? {};
  let sizeBytes: number | Unknown;
  if (src.videoPath && existsSync(resolve(root, src.videoPath)) && statSync(resolve(root, src.videoPath)).isFile()) {
    sizeBytes = note('source.sizeBytes', 'verified_from_file', statSync(resolve(root, src.videoPath)).size);
  } else {
    sizeBytes = unk('source.sizeBytes', 'source video unavailable, so its size is unknown');
  }
  const source = {
    videoSha256: hashFile('source.videoSha256', src.videoPath, 'source video'),
    durationSec: supplied('source.durationSec', src.durationSec, 'source duration'),
    sizeBytes,
    trim: supplied('source.trim', src.trim, 'keep segments'),
    transcriptSha256: hashFile('source.transcriptSha256', src.transcriptPath, 'transcript'),
  };

  // --- occupancy ---
  const occ = input.occupancy ?? {};
  let occupancyEvidence: Evidence['occupancy'];
  let occupancy: {mode: unknown; snapshotSha256: unknown; receivedDigestSha256: unknown};
  if (occ.mode === 'live') {
    occupancy = {
      mode: note('occupancy.mode', 'supplied', 'live'),
      snapshotSha256: unk('occupancy.snapshotSha256', 'live detection: nothing was frozen'),
      receivedDigestSha256: unk('occupancy.receivedDigestSha256', 'live detection: nothing was frozen'),
    };
  } else if (occ.snapshotPath === undefined) {
    occupancy = {
      mode: unk('occupancy.mode', `occupancy mode: ${NOT_SUPPLIED}`),
      snapshotSha256: unk('occupancy.snapshotSha256', `occupancy snapshot: ${NOT_SUPPLIED}`),
      receivedDigestSha256: unk('occupancy.receivedDigestSha256', `occupancy digest: ${NOT_SUPPLIED}`),
    };
  } else {
    let snapshot: OccupancySnapshot | null = null;
    let problem = '';
    try {
      snapshot = loadSnapshotFile(resolve(root, occ.snapshotPath));
    } catch (error) {
      problem = error instanceof SnapshotError ? error.message : `cannot read the snapshot (${error instanceof Error ? error.message : 'error'})`;
    }
    if (!snapshot) {
      occupancy = {
        mode: note('occupancy.mode', 'supplied', 'replay'),
        snapshotSha256: unk('occupancy.snapshotSha256', problem),
        receivedDigestSha256: unk('occupancy.receivedDigestSha256', `no valid snapshot to compare against (${problem})`),
      };
    } else {
      // The file was read, validated strictly, and its stored hash recomputed from its content: verified from the file.
      const received = occ.receivedPack;
      const cross = received ? checkPackMatchesSnapshot(snapshot, received) : null;
      occupancy = {
        mode: note('occupancy.mode', 'supplied', 'replay'),
        snapshotSha256: note('occupancy.snapshotSha256', 'verified_from_file', snapshot.contentSha256),
        receivedDigestSha256: received ? note('occupancy.receivedDigestSha256', 'supplied', occupancyInputDigest(received)) : unk('occupancy.receivedDigestSha256', `occupancy actually received by the run: ${NOT_SUPPLIED}`),
      };
      occupancyEvidence = {
        snapshotId: snapshot.id,
        snapshotSha256: snapshot.contentSha256,
        independentMeasurements: independentMeasurements(snapshot).length,
        repeats: repeatMeasurements(snapshot).length,
        receivedMatchesSnapshot: cross ? cross.matches : null,
        problems: cross ? cross.problems : [],
      };
    }
  }

  // --- pipeline (git / working tree) ---
  const state = codeState(root);
  const codeFiles = listCodeFiles(root);
  const codeSet = new Set(codeFiles);
  const tracked = new Set(git(root, ['ls-files']).split('\n').filter(Boolean));
  const trackedChanges = git(root, ['diff', '--name-status', 'HEAD'])
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [status, ...rest] = line.split('\t');
      return {status: status!, path: rest.at(-1)!};
    })
    .filter(change => codeSet.has(change.path) || (change.status.startsWith('D') && /^(server\/src|remotion\/src|prompts)\//.test(change.path)))
    .map(change => ({...change, sha256: existsSync(join(root, change.path)) ? sha256File(join(root, change.path)) : null}))
    .sort((a, b) => a.path.localeCompare(b.path));
  const untrackedFiles = codeFiles.filter(path => !tracked.has(path)).map(path => ({path, sha256: sha256File(join(root, path))}));
  const evidence: Evidence = {
    commit: state.head,
    branch: state.branch,
    trackedChanges,
    untrackedFiles,
    trackedDiffSha256: state.trackedDiffSha256,
    codeFileCount: codeFiles.length,
    ...(occupancyEvidence ? {occupancy: occupancyEvidence} : {}),
    note: 'treeSha256 covers every behaviour-defining file (tracked and untracked) by content; this lists which ones differ from HEAD. .env, media and node_modules are not listed.',
  };
  const pipeline = {
    headCommit: note('pipeline.headCommit', 'verified_from_git', state.head),
    treeSha256: note('pipeline.treeSha256', 'verified_from_git', state.treeSha256),
    dirtyFileCount: note('pipeline.dirtyFileCount', 'verified_from_git', state.dirtyTrackedFiles + state.untrackedSourceFiles),
    path: supplied('pipeline.path', input.pipeline?.path, 'pipeline path (v1/v2)'),
    nodeVersion: note('pipeline.nodeVersion', 'verified_from_runtime', process.version),
  };

  // --- models (always supplied: the collector cannot see what a run called) ---
  const models = {} as Record<ModelStage, ModelInfo | null | Unknown>;
  for (const stage of ['director', 'motionDirector', 'graphicsWorker', 'transcription'] as const) {
    const given = input.models?.[stage];
    if (given === undefined) {
      models[stage] = unk(`models.${stage}`, `${stage} model: ${NOT_SUPPLIED}`);
    } else if (given === null) {
      models[stage] = note(`models.${stage}`, 'not_applicable', null);
    } else {
      models[stage] = note(`models.${stage}`, 'supplied', given);
    }
  }
  const included = (stage: ModelStage) => models[stage] !== null;
  const anyPromptModel = included('director') || included('motionDirector') || included('graphicsWorker');

  // --- prompts ---
  let promptFilesSha256: string | null | Unknown;
  if (!anyPromptModel) {
    promptFilesSha256 = note('prompts.promptFilesSha256', 'not_applicable', null);
  } else {
    const lines = PROMPT_FILES.map(path => (existsSync(join(root, path)) ? `${path}:${sha256File(join(root, path))}` : `${path}:MISSING`));
    promptFilesSha256 = lines.some(line => line.endsWith(':MISSING'))
      ? unk('prompts.promptFilesSha256', 'a prompt file is missing at collection time')
      : note('prompts.promptFilesSha256', 'verified_from_file', sha256(lines.join('\n')));
  }
  const config = input.config ?? {};
  const prompts = {
    directorSystemSha256: models.director === null ? note('prompts.directorSystemSha256', 'not_applicable', null) : supplied('prompts.directorSystemSha256', input.prompts?.directorSystemSha256, 'director system-prompt hash'),
    directorSchemaSha256: models.director === null ? note('prompts.directorSchemaSha256', 'not_applicable', null) : supplied('prompts.directorSchemaSha256', input.prompts?.directorSchemaSha256, 'director response-schema hash'),
    promptFilesSha256,
    contentProfileBlockSha256:
      models.director === null || config.CONTENT_PROFILE_ENABLED === false
        ? note('prompts.contentProfileBlockSha256', 'not_applicable', null)
        : supplied('prompts.contentProfileBlockSha256', input.prompts?.contentProfileBlockSha256, 'content-profile block hash'),
  };

  // --- flags and settings: named keys only, from the snapshot ---
  const flags: Record<string, unknown> = {};
  for (const key of CONFIG_KEYS) {
    flags[key] = key in config ? note(`flags.${key}`, 'verified_from_runtime', config[key]) : unk(`flags.${key}`, `${key}: not present in the configuration snapshot`);
  }
  origin.flags = 'verified_from_runtime';

  // --- visual context ---
  const visualContext = {
    enabled: config.VISUAL_CONTEXT_V2 === undefined ? unk('visualContext.enabled', 'VISUAL_CONTEXT_V2: not present in the configuration snapshot') : note('visualContext.enabled', 'verified_from_runtime', config.VISUAL_CONTEXT_V2),
    frameTimesOutputSec: supplied('visualContext.frameTimesOutputSec', input.visualContext?.frameTimesOutputSec, 'frame times sent to the Director'),
    imagesAttached: supplied('visualContext.imagesAttached', input.visualContext?.imagesAttached, 'number of images attached'),
  };

  // --- B-roll ---
  let assets: unknown;
  if (input.broll?.assets === undefined) {
    assets = unk('broll.assets', `B-roll assets: ${NOT_SUPPLIED}`);
  } else {
    assets = input.broll.assets.map((asset, index) => ({id: asset.id, sha256: hashFile(`broll.assets[${index}].sha256`, asset.path, `asset ${asset.id}`)}));
    origin['broll.assets'] = 'supplied';
  }
  const broll = {mode: supplied('broll.mode', input.broll?.mode, 'B-roll mode'), assets, stockFrozen: supplied('broll.stockFrozen', input.broll?.stockFrozen, 'whether stock results were frozen')};

  // --- renderer ---
  // Remotion is hoisted to the repo-root node_modules in this monorepo; a workspace-local install takes precedence if present.
  const installed = [join(root, 'remotion', 'node_modules', 'remotion', 'package.json'), join(root, 'node_modules', 'remotion', 'package.json')].find(candidate => existsSync(candidate));
  const remotionVersion = installed
    ? note('renderer.remotionVersion', 'verified_from_file', (JSON.parse(readFileSync(installed, 'utf8')) as {version: string}).version)
    : unk('renderer.remotionVersion', 'the installed remotion package was not found');
  const renderer = {
    engine: supplied('renderer.engine', input.renderer?.engine, 'render engine'),
    remotionVersion,
    fps: supplied('renderer.fps', input.renderer?.fps, 'fps'),
    width: supplied('renderer.width', input.renderer?.width, 'width'),
    height: supplied('renderer.height', input.renderer?.height, 'height'),
    codec: supplied('renderer.codec', input.renderer?.codec, 'codec'),
  };

  // --- rubric ---
  const rubric = {version: supplied('rubric.version', input.rubric?.version, 'rubric version'), sha256: hashFile('rubric.sha256', input.rubric?.path, 'rubric file')};

  // --- outputs ---
  const outputs = (input.outputs ?? []).map((output, index) => ({kind: output.kind, path: output.path, sha256: hashFile(`outputs[${index}].sha256`, output.path, `output ${output.path}`)}));
  origin.outputs = 'verified_from_file';

  const stages = input.stages === undefined ? unk('stages', `stage records: ${NOT_SUPPLIED}`) : note('stages', 'supplied', input.stages);
  origin['run.status'] = 'supplied';
  const manifest = {manifestVersion: 1, run: {...input.run}, stages, source, pipeline, models, prompts, flags, occupancy, visualContext, broll, renderer, rubric, outputs} as unknown as RunManifest;
  return {manifest, evidence, origin, validation: validateManifest(manifest)};
}

/** Collect with the live feature-flag / setting snapshot from the engine's validated `env`. Import is dynamic so tests need no env. */
export async function collectFromEnv(input: Omit<CollectInput, 'config'>): Promise<Collected> {
  const {env} = await import('../config/env.ts');
  const config: Record<string, unknown> = {};
  for (const key of CONFIG_KEYS) {
    config[key] = (env as unknown as Record<string, unknown>)[key];
  }
  return collectManifest({...input, config});
}

const FROZEN_DIRS = [['server', 'src', 'eval', 'baselines'], ['server', 'src', 'eval', 'golden'], ['server', 'src', 'eval', 'fixtures']];

/**
 * Write a collected manifest (and its evidence) as `<name>.manifest.json` / `<name>.evidence.json` in `outDir`.
 * Refuses: an `outDir` inside a frozen baseline/golden/fixture directory, and any existing file.
 */
export function writeCollected(root: string, outDir: string, name: string, collected: Collected): {manifestPath: string; evidencePath: string} {
  const absolute = resolve(outDir);
  for (const parts of FROZEN_DIRS) {
    const frozen = resolve(root, ...parts);
    if (absolute === frozen || absolute.startsWith(frozen + sep)) {
      throw new Error(`refusing to write into the frozen directory ${relative(resolve(root), frozen)}`);
    }
  }
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new Error(`invalid manifest name ${JSON.stringify(name)}`);
  }
  const manifestPath = join(absolute, `${name}.manifest.json`);
  const evidencePath = join(absolute, `${name}.evidence.json`);
  for (const path of [manifestPath, evidencePath]) {
    if (existsSync(path)) {
      throw new Error(`refusing to overwrite existing ${path}`);
    }
  }
  mkdirSync(dirname(manifestPath), {recursive: true});
  writeFileSync(manifestPath, JSON.stringify({...collected.manifest}, null, 1));
  writeFileSync(evidencePath, JSON.stringify({evidence: collected.evidence, origin: collected.origin}, null, 1));
  return {manifestPath, evidencePath};
}
