/**
 * Run manifest + comparison validation for controlled evaluations. Pure data and rules: no pipeline change, no model call.
 *
 * Ideas the rules enforce:
 *  - A field that is ABSENT makes a manifest invalid. A field whose value is not known is written explicitly as
 *    `{$unknown: "<non-empty reason>"}`. The two are never confused, and an unknown value can never be called "the same".
 *  - A field that is PRESENT must hold a value of the right type and domain (a 64-hex SHA-256, a non-empty identity string,
 *    a positive dimension, a flag in its allowed domain). `null`, `''` and malformed values are invalid, not "known".
 *    `null` is accepted only where it means "this stage is not part of the run" (a model or the prompt hashes it needs).
 *  - Two runs are an A/B comparison only if every required provenance field is KNOWN in both and equal in both, except the
 *    declared variable(s), which must be known in both and differ. A repeat is a separate, explicitly requested mode.
 *  - This module checks the SHAPE and DOMAIN of what a manifest claims. It cannot check that a claim is true; see
 *    `manifestCollector.ts` for the values that can be verified against actual files.
 */

export type Unknown = {$unknown: string};
export const unknown = (reason: string): Unknown => ({$unknown: reason});
export const isUnknown = (value: unknown): value is Unknown => typeof value === 'object' && value !== null && '$unknown' in value && typeof (value as Unknown).$unknown === 'string';

/** Leaves are strings, numbers, booleans, null, or arrays/objects of those, or an explicit Unknown. */
export type RunManifest = {
  manifestVersion: 1;
  /** Identity of THIS run. Never compared. */
  run: {id: string; arm: string; repeat: number; createdAt: string; status: 'complete' | 'incomplete' | 'failed'};
  /** Stage records of THIS run (identifier, timestamps, outcome). The ordered {id, status} list is compared; timestamps are not. */
  stages: Array<{id: string; startedAt: string; endedAt: string; status: 'ok' | 'failed' | 'skipped'}> | Unknown;
  source: {videoSha256: unknown; durationSec: unknown; sizeBytes: unknown; trim: unknown; transcriptSha256: unknown};
  pipeline: {headCommit: unknown; treeSha256: unknown; dirtyFileCount: unknown; path: unknown; nodeVersion: unknown};
  models: {director: unknown; motionDirector: unknown; graphicsWorker: unknown; transcription: unknown};
  prompts: {directorSystemSha256: unknown; directorSchemaSha256: unknown; promptFilesSha256: unknown; contentProfileBlockSha256: unknown};
  flags: Record<string, unknown> | Unknown;
  /** Which occupancy data the run used: a recorded snapshot replayed to every arm, or live detection (unfrozen, never comparable). */
  occupancy: {mode: unknown; snapshotSha256: unknown; receivedDigestSha256: unknown};
  visualContext: {enabled: unknown; frameTimesOutputSec: unknown; imagesAttached: unknown};
  broll: {mode: unknown; assets: unknown; stockFrozen: unknown};
  renderer: {engine: unknown; remotionVersion: unknown; fps: unknown; width: unknown; height: unknown; codec: unknown};
  rubric: {version: unknown; sha256: unknown};
  /** Artifacts this run produced. Never compared for equality. */
  outputs: Array<{kind: string; path: string; sha256: unknown}>;
};

/** Every path below must be present (known or explicitly unknown) for a manifest to be valid, and known to be comparable. */
export const REQUIRED_PROVENANCE_PATHS = [
  'source.videoSha256', 'source.durationSec', 'source.sizeBytes', 'source.trim', 'source.transcriptSha256',
  'pipeline.headCommit', 'pipeline.treeSha256', 'pipeline.dirtyFileCount', 'pipeline.path', 'pipeline.nodeVersion',
  'models.director', 'models.motionDirector', 'models.graphicsWorker', 'models.transcription',
  'prompts.directorSystemSha256', 'prompts.directorSchemaSha256', 'prompts.promptFilesSha256', 'prompts.contentProfileBlockSha256',
  'flags',
  'occupancy.mode', 'occupancy.snapshotSha256', 'occupancy.receivedDigestSha256',
  'visualContext.enabled', 'visualContext.frameTimesOutputSec', 'visualContext.imagesAttached',
  'broll.mode', 'broll.assets', 'broll.stockFrozen',
  'renderer.engine', 'renderer.remotionVersion', 'renderer.fps', 'renderer.width', 'renderer.height', 'renderer.codec',
  'rubric.version', 'rubric.sha256',
] as const;

/** Flags that change what a run does; every manifest must state each one (known or explicitly unknown), in its allowed domain. */
export const REQUIRED_FLAGS = ['HOOK_TITLE_POLICY', 'OCCUPANCY_CONTEXT_V2', 'VISUAL_CONTEXT_V2', 'GENERATED_TRANSITIONS_ENABLED', 'DIRECTOR_V2', 'NORTH_STAR'] as const;
/** Pipeline settings that also change what a run does; stated inside `flags`, in their allowed domain. */
export const REQUIRED_SETTINGS = ['PIPELINE_MODE', 'ZOOM_SCALE', 'MOTION_GRAPHICS_ENABLED', 'CONTENT_PROFILE_ENABLED', 'HOOK_DURATION_SEC', 'BROLL_MOMENT_COUNT', 'GEMINI_MODEL'] as const;

export type Check = (value: unknown) => string | null;
const isNum = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const SHA256 = /^[0-9a-f]{64}$/;
const SHA1 = /^[0-9a-f]{40}$/;

export const checks = {
  sha256: ((value: unknown) => (typeof value === 'string' && SHA256.test(value) ? null : 'must be a 64-character lowercase hexadecimal SHA-256')) as Check,
  commit: ((value: unknown) => (typeof value === 'string' && SHA1.test(value) ? null : 'must be a 40-character lowercase hexadecimal commit id')) as Check,
  nonEmpty: ((value: unknown) => (typeof value === 'string' && value.trim().length > 0 ? null : 'must be a non-empty string')) as Check,
  positive: ((value: unknown) => (isNum(value) && value > 0 ? null : 'must be a finite number greater than 0')) as Check,
  positiveInt: ((value: unknown) => (Number.isInteger(value) && (value as number) > 0 ? null : 'must be a positive integer')) as Check,
  nonNegInt: ((value: unknown) => (Number.isInteger(value) && (value as number) >= 0 ? null : 'must be a non-negative integer')) as Check,
  boolean: ((value: unknown) => (typeof value === 'boolean' ? null : 'must be true or false')) as Check,
  version: ((value: unknown) => (typeof value === 'string' && /^v?\d+\.\d+\.\d+/.test(value) ? null : 'must be a version such as 4.0.524')) as Check,
  oneOf: (allowed: readonly string[]): Check => value => (typeof value === 'string' && allowed.includes(value) ? null : `must be one of ${allowed.join(', ')}`),
};

/** Allowed domain of each required flag / setting. */
export const FLAG_DOMAINS: Record<string, Check> = {
  HOOK_TITLE_POLICY: checks.oneOf(['placeholder', 'optional']),
  OCCUPANCY_CONTEXT_V2: checks.boolean,
  VISUAL_CONTEXT_V2: checks.boolean,
  GENERATED_TRANSITIONS_ENABLED: checks.boolean,
  DIRECTOR_V2: checks.boolean,
  NORTH_STAR: checks.boolean,
  PIPELINE_MODE: checks.oneOf(['lean', 'full']),
  ZOOM_SCALE: checks.positive,
  MOTION_GRAPHICS_ENABLED: checks.boolean,
  CONTENT_PROFILE_ENABLED: checks.boolean,
  HOOK_DURATION_SEC: checks.positive,
  BROLL_MOMENT_COUNT: checks.positiveInt,
  GEMINI_MODEL: checks.nonEmpty,
};

const get = (root: unknown, path: string): {present: boolean; value: unknown} => {
  let node: unknown = root;
  for (const part of path.split('.')) {
    if (typeof node !== 'object' || node === null || !(part in (node as Record<string, unknown>))) {
      return {present: false, value: undefined};
    }
    node = (node as Record<string, unknown>)[part];
  }
  return {present: true, value: node};
};

/** Stable JSON (sorted keys) so equal values compare equal regardless of key order. */
export function stable(value: unknown): string {
  const norm = (item: unknown): unknown =>
    Array.isArray(item) ? item.map(norm) : item && typeof item === 'object' ? Object.fromEntries(Object.keys(item).sort().map(key => [key, norm((item as Record<string, unknown>)[key])])) : item;
  return JSON.stringify(norm(value));
}

export type ManifestValidation = {
  valid: boolean;
  /** Required keys that are absent. */
  missing: string[];
  /** Keys that are present but hold a malformed value (wrong type, bad hash, empty string, null where a value is required, …). */
  invalid: Array<{path: string; reason: string}>;
  /** Keys explicitly marked unknown: valid, but never comparable. */
  unknownFields: string[];
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value) && !isUnknown(value);

/** Missing = key absent. Invalid = present but malformed. Unknown = present as `{$unknown: reason}` (valid, but blocks comparison). */
export function validateManifest(manifest: unknown): ManifestValidation {
  const missing: string[] = [];
  const invalid: Array<{path: string; reason: string}> = [];
  const unknownFields: string[] = [];
  if (!manifest || typeof manifest !== 'object' || (manifest as {manifestVersion?: unknown}).manifestVersion !== 1) {
    return {valid: false, missing: ['manifestVersion'], invalid, unknownFields};
  }

  /** Validate a leaf: an explicit unknown is recorded (its reason must be non-empty); anything else must pass `check`. */
  const leaf = (path: string, value: unknown, check: Check) => {
    if (isUnknown(value)) {
      if (value.$unknown.trim().length === 0) {
        invalid.push({path, reason: 'an unknown value must give a non-empty reason'});
      } else {
        unknownFields.push(path);
      }
      return;
    }
    const problem = check(value);
    if (problem) {
      invalid.push({path, reason: problem});
    }
  };
  const present = (path: string) => get(manifest, path).present && get(manifest, path).value !== undefined;
  const value = (path: string) => get(manifest, path).value;

  for (const top of ['run', 'outputs', 'stages']) {
    if (!get(manifest, top).present) {
      missing.push(top);
    }
  }
  for (const path of REQUIRED_PROVENANCE_PATHS) {
    if (!present(path)) {
      missing.push(path);
    }
  }

  // run identity (never compared, but must be well-formed)
  if (get(manifest, 'run').present) {
    if (!isRecord(value('run'))) {
      invalid.push({path: 'run', reason: 'must be an object'});
    } else {
      for (const [key, check] of [['id', checks.nonEmpty], ['arm', checks.nonEmpty], ['repeat', checks.nonNegInt], ['status', checks.oneOf(['complete', 'incomplete', 'failed'])], ['createdAt', ((v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v)) ? null : 'must be an ISO-8601 timestamp')) as Check]] as const) {
        if (!present(`run.${key}`)) {
          missing.push(`run.${key}`);
        } else {
          const v = value(`run.${key}`);
          const problem = check(v);
          if (problem) {
            invalid.push({path: `run.${key}`, reason: problem});
          }
        }
      }
    }
  }

  const simple: Array<[string, Check]> = [
    ['source.videoSha256', checks.sha256], ['source.durationSec', checks.positive], ['source.sizeBytes', checks.positiveInt], ['source.transcriptSha256', checks.sha256],
    ['pipeline.headCommit', checks.commit], ['pipeline.treeSha256', checks.sha256], ['pipeline.dirtyFileCount', checks.nonNegInt], ['pipeline.path', checks.oneOf(['v1', 'v2'])], ['pipeline.nodeVersion', checks.version],
    ['visualContext.enabled', checks.boolean], ['visualContext.imagesAttached', checks.nonNegInt],
    ['broll.mode', checks.oneOf(['stock', 'creator', 'none'])], ['broll.stockFrozen', checks.boolean],
    ['renderer.engine', checks.nonEmpty], ['renderer.remotionVersion', checks.version], ['renderer.fps', checks.positiveInt], ['renderer.width', checks.positiveInt], ['renderer.height', checks.positiveInt], ['renderer.codec', checks.nonEmpty],
    ['rubric.version', checks.nonEmpty], ['rubric.sha256', checks.sha256],
  ];
  for (const [path, check] of simple) {
    if (present(path)) {
      leaf(path, value(path), check);
    }
  }

  // source.trim: a non-empty list of well-formed keep segments
  if (present('source.trim')) {
    leaf('source.trim', value('source.trim'), trim => {
      if (!Array.isArray(trim) || trim.length === 0) {
        return 'must be a non-empty list of {sourceStart, sourceEnd, outputStart}';
      }
      for (const [index, segment] of trim.entries()) {
        const s = segment as Record<string, unknown> | null;
        if (!s || !isNum(s.sourceStart) || !isNum(s.sourceEnd) || !isNum(s.outputStart) || s.sourceStart < 0 || s.outputStart < 0 || s.sourceEnd <= s.sourceStart) {
          return `segment ${index} must have finite sourceStart >= 0, sourceEnd > sourceStart and outputStart >= 0`;
        }
      }
      return null;
    });
  }
  if (present('visualContext.frameTimesOutputSec')) {
    leaf('visualContext.frameTimesOutputSec', value('visualContext.frameTimesOutputSec'), times =>
      Array.isArray(times) && times.every(time => isNum(time) && time >= 0) ? null : 'must be a list of finite times >= 0 seconds');
  }

  // occupancy: a replayed snapshot (hash known) or live detection (nothing frozen, so both hashes must be explicitly unknown).
  if (present('occupancy.mode') && present('occupancy.snapshotSha256') && present('occupancy.receivedDigestSha256')) {
    leaf('occupancy.mode', value('occupancy.mode'), checks.oneOf(['replay', 'live']));
    const mode = value('occupancy.mode');
    const snapshot = value('occupancy.snapshotSha256');
    const received = value('occupancy.receivedDigestSha256');
    if (mode === 'replay') {
      leaf('occupancy.snapshotSha256', snapshot, checks.sha256);
      leaf('occupancy.receivedDigestSha256', received, checks.sha256);
    } else if (mode === 'live') {
      for (const [path, item] of [['occupancy.snapshotSha256', snapshot], ['occupancy.receivedDigestSha256', received]] as const) {
        if (!isUnknown(item)) {
          invalid.push({path, reason: 'live occupancy detection is not frozen, so this must be an explicit unknown (a hash would claim a replay that did not happen)'});
        } else {
          leaf(path, item, () => null);
        }
      }
    }
  }

  // stages: identified, ordered, timestamped, with an outcome.
  if (get(manifest, 'stages').present) {
    const stages = value('stages');
    if (isUnknown(stages)) {
      leaf('stages', stages, () => null);
    } else if (!Array.isArray(stages) || stages.length === 0) {
      invalid.push({path: 'stages', reason: 'must be a non-empty list of {id, startedAt, endedAt, status} (or an explicit unknown)'});
    } else {
      const ids = new Set<string>();
      stages.forEach((stage, index) => {
        const at = `stages[${index}]`;
        if (!isRecord(stage)) {
          invalid.push({path: at, reason: 'must be an object'});
          return;
        }
        if (checks.nonEmpty(stage.id)) {
          invalid.push({path: `${at}.id`, reason: 'must be a non-empty string'});
        } else {
          if (ids.has(stage.id as string)) {
            invalid.push({path: `${at}.id`, reason: `duplicate stage id ${stage.id as string}`});
          }
          ids.add(stage.id as string);
        }
        const iso = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v));
        for (const key of ['startedAt', 'endedAt']) {
          if (!iso(stage[key])) {
            invalid.push({path: `${at}.${key}`, reason: 'must be an ISO-8601 timestamp'});
          }
        }
        if (iso(stage.startedAt) && iso(stage.endedAt) && Date.parse(stage.endedAt as string) < Date.parse(stage.startedAt as string)) {
          invalid.push({path: `${at}.endedAt`, reason: 'ends before it starts'});
        }
        if (stage.status !== 'ok' && stage.status !== 'failed' && stage.status !== 'skipped') {
          invalid.push({path: `${at}.status`, reason: 'must be ok, failed or skipped'});
        }
      });
    }
  }

  // models: null = the stage is not part of this run; otherwise an object with a non-empty id (the model/version string).
  const modelIncluded: Record<string, boolean | 'unknown'> = {};
  for (const stage of ['director', 'motionDirector', 'graphicsWorker', 'transcription']) {
    const path = `models.${stage}`;
    if (!present(path)) {
      continue;
    }
    const model = value(path);
    if (model === null) {
      modelIncluded[stage] = false;
      continue;
    }
    modelIncluded[stage] = isUnknown(model) ? 'unknown' : true;
    leaf(path, model, v => (isRecord(v) && typeof v.id === 'string' && v.id.trim().length > 0 ? null : 'must be null (stage not included) or an object with a non-empty model id'));
  }

  // prompts: required when the model-backed stage that uses them is included.
  const promptField = (path: string, needed: boolean | 'unknown', allowNullReason: string) => {
    if (!present(path)) {
      return;
    }
    const v = value(path);
    if (v === null) {
      if (needed !== false) {
        invalid.push({path, reason: `must be a SHA-256 (or an explicit unknown) because ${allowNullReason}`});
      }
      return;
    }
    leaf(path, v, checks.sha256);
  };
  const anyIncluded = (...stages: string[]): boolean | 'unknown' => {
    const states = stages.map(stage => modelIncluded[stage]);
    return states.includes(true) ? true : states.includes('unknown') ? 'unknown' : false;
  };
  promptField('prompts.directorSystemSha256', modelIncluded.director ?? 'unknown', 'models.director is part of the run');
  promptField('prompts.directorSchemaSha256', modelIncluded.director ?? 'unknown', 'models.director is part of the run');
  promptField('prompts.promptFilesSha256', anyIncluded('director', 'motionDirector', 'graphicsWorker'), 'a prompt-using model stage is part of the run');
  const profileFlag = get(manifest, 'flags.CONTENT_PROFILE_ENABLED').value;
  promptField(
    'prompts.contentProfileBlockSha256',
    modelIncluded.director === false || profileFlag === false ? false : 'unknown',
    'the Director runs with the content profile enabled',
  );

  // flags: required flags and settings, each in its allowed domain; extra flags must be scalars.
  if (present('flags')) {
    const flags = value('flags');
    if (isUnknown(flags)) {
      leaf('flags', flags, () => null);
    } else if (!isRecord(flags)) {
      invalid.push({path: 'flags', reason: 'must be an object of flag values'});
    } else {
      for (const name of [...REQUIRED_FLAGS, ...REQUIRED_SETTINGS]) {
        if (!(name in flags) || flags[name] === undefined) {
          missing.push(`flags.${name}`);
        } else {
          leaf(`flags.${name}`, flags[name], FLAG_DOMAINS[name]!);
        }
      }
      for (const [name, flagValue] of Object.entries(flags)) {
        if (!(name in FLAG_DOMAINS)) {
          leaf(`flags.${name}`, flagValue, v => (['string', 'number', 'boolean'].includes(typeof v) ? null : 'must be a string, number or boolean'));
        }
      }
    }
  }

  // broll: no assets for mode "none"; otherwise a non-empty, uniquely identified list with a SHA-256 (or explicit unknown) each.
  if (present('broll.assets')) {
    const mode = get(manifest, 'broll.mode').value;
    const assets = value('broll.assets');
    if (isUnknown(assets)) {
      leaf('broll.assets', assets, () => null);
    } else if (!Array.isArray(assets)) {
      invalid.push({path: 'broll.assets', reason: 'must be a list of {id, sha256}'});
    } else {
      if (mode === 'none' && assets.length > 0) {
        invalid.push({path: 'broll.assets', reason: 'must be empty when broll.mode is "none"'});
      }
      if ((mode === 'stock' || mode === 'creator') && assets.length === 0) {
        invalid.push({path: 'broll.assets', reason: `must list the assets used when broll.mode is "${String(mode)}"`});
      }
      const seen = new Set<string>();
      assets.forEach((asset, index) => {
        if (!isRecord(asset) || typeof asset.id !== 'string' || asset.id.trim().length === 0) {
          invalid.push({path: `broll.assets[${index}].id`, reason: 'must be a non-empty string'});
          return;
        }
        if (seen.has(asset.id)) {
          invalid.push({path: `broll.assets[${index}].id`, reason: `duplicate asset id ${asset.id}`});
        }
        seen.add(asset.id);
        if (!('sha256' in asset)) {
          missing.push(`broll.assets[${index}].sha256`);
        } else {
          leaf(`broll.assets[${index}].sha256`, asset.sha256, checks.sha256);
        }
      });
    }
  }

  // outputs: identified (kind, path) and hashed (SHA-256, or explicit unknown).
  const outputs = value('outputs');
  if (Array.isArray(outputs)) {
    const paths = new Set<string>();
    outputs.forEach((output, index) => {
      if (!isRecord(output)) {
        invalid.push({path: `outputs[${index}]`, reason: 'must be an object {kind, path, sha256}'});
        return;
      }
      for (const key of ['kind', 'path', 'sha256']) {
        if (!(key in output)) {
          missing.push(`outputs[${index}].${key}`);
        }
      }
      if ('kind' in output) {
        leaf(`outputs[${index}].kind`, output.kind, checks.nonEmpty);
      }
      if ('path' in output) {
        leaf(`outputs[${index}].path`, output.path, checks.nonEmpty);
        if (typeof output.path === 'string') {
          if (paths.has(output.path)) {
            invalid.push({path: `outputs[${index}].path`, reason: `duplicate output path ${output.path}`});
          }
          paths.add(output.path);
        }
      }
      if ('sha256' in output) {
        leaf(`outputs[${index}].sha256`, output.sha256, checks.sha256);
      }
    });
  } else if (get(manifest, 'outputs').present) {
    invalid.push({path: 'outputs', reason: 'must be a list'});
  }

  return {valid: missing.length === 0 && invalid.length === 0, missing, invalid, unknownFields: [...new Set(unknownFields)]};
}

function containsUnknown(value: unknown): boolean {
  if (isUnknown(value)) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some(containsUnknown);
  }
  return typeof value === 'object' && value !== null && Object.values(value).some(containsUnknown);
}

export type FieldStatus = 'known_match' | 'known_mismatch' | 'unknown' | 'missing' | 'invalid';

export type Comparison = {
  verdict: 'comparable' | 'not_comparable' | 'repeat';
  /** Status of every compared provenance field: known and matching, known but mismatching, unknown (either run), missing, or malformed. */
  fields: Record<string, FieldStatus>;
  /** Why a verdict was not "comparable"/"repeat" — one entry per problem. */
  reasons: string[];
  /** Required fields that differ between the runs. */
  differing: string[];
  declaredVariables: string[];
};

export type CompareOptions = {
  /**
   * `ab` (default): the runs must differ in exactly the declared variable(s), and be different arms.
   * `repeat`: the runs must be two distinct runs of ONE configuration (same arm, nothing differing, no declared variable).
   * Identical runs are never accepted as an A/B, and an A/B is never accepted as a repeat.
   */
  mode?: 'ab' | 'repeat';
};

/**
 * Decide whether run A and run B form a valid comparison for `declaredVariables` (paths from REQUIRED_PROVENANCE_PATHS, or
 * `flags.<NAME>` for a single flag). Never returns "comparable" when anything required is missing, malformed or unknown.
 */
export function compareManifests(a: unknown, b: unknown, declaredVariables: string[], options: CompareOptions = {}): Comparison {
  const mode = options.mode ?? 'ab';
  const reasons: string[] = [];
  const differing: string[] = [];
  const fields: Record<string, FieldStatus> = {};
  const va = validateManifest(a);
  const vb = validateManifest(b);
  for (const [label, validation] of [['A', va], ['B', vb]] as const) {
    for (const path of validation.missing) {
      reasons.push(`${label} is missing ${path}`);
      fields[path] = 'missing';
    }
    for (const item of validation.invalid) {
      reasons.push(`${label} has an invalid ${item.path}: ${item.reason}`);
      fields[item.path] = 'invalid';
    }
  }
  if (mode === 'ab' && declaredVariables.length === 0) {
    reasons.push('no declared variable: an A/B comparison must name the one factor that is allowed to differ (or request mode "repeat" for a rerun of one configuration)');
  }
  if (mode === 'repeat' && declaredVariables.length > 0) {
    reasons.push('a repeat compares one configuration with itself, so it takes no declared variable');
  }
  if (reasons.length > 0) {
    return {verdict: 'not_comparable', reasons, fields, differing, declaredVariables};
  }

  // Failed or incomplete runs are evidence of a failure, not of a configuration: they can never be compared.
  for (const [label, root] of [['A', a], ['B', b]] as const) {
    const status = (get(root, 'run').value as RunManifest['run']).status;
    if (status !== 'complete') {
      reasons.push(`${label} run status is "${status}"; only complete runs can be compared`);
    }
    const stages = get(root, 'stages').value;
    if (isUnknown(stages)) {
      reasons.push(`${label} stages are unknown, so the run cannot be shown to have completed`);
      fields.stages = 'unknown';
    } else if (Array.isArray(stages) && stages.some((stage: {status?: string}) => stage.status === 'failed')) {
      reasons.push(`${label} has a failed stage (${stages.filter((stage: {status?: string}) => stage.status === 'failed').map((stage: {id: string}) => stage.id).join(', ')}); only runs whose stages all completed can be compared`);
    }
  }
  const sequence = (root: unknown) => {
    const stages = get(root, 'stages').value;
    return Array.isArray(stages) ? stages.map((stage: {id: string; status: string}) => `${stage.id}:${stage.status}`) : null;
  };
  const [seqA, seqB] = [sequence(a), sequence(b)];
  if (seqA && seqB && stable(seqA) !== stable(seqB)) {
    reasons.push(`the stage sequence differs (A: ${seqA.join(' > ')}; B: ${seqB.join(' > ')}); the runs did not execute the same pipeline`);
    fields.stages = 'known_mismatch';
  } else if (seqA && seqB) {
    fields.stages = 'known_match';
  }

  // Run identity: two different runs; an A/B is two arms, a repeat is one arm.
  const [runA, runB] = [get(a, 'run').value as RunManifest['run'], get(b, 'run').value as RunManifest['run']];
  if (runA.id === runB.id) {
    reasons.push(`both manifests describe the same run (${runA.id}); a comparison needs two runs`);
  }
  if (mode === 'ab' && runA.arm === runB.arm) {
    reasons.push(`both runs are arm "${runA.arm}"; an A/B comparison needs two arms`);
  }
  if (mode === 'repeat') {
    if (runA.arm !== runB.arm) {
      reasons.push(`a repeat must be the same arm, got "${runA.arm}" and "${runB.arm}"`);
    }
    if (runA.repeat === runB.repeat) {
      reasons.push(`both runs have repeat index ${runA.repeat}; a repeat needs distinct repeat indexes`);
    }
  }

  const flagNames = (root: unknown) => {
    const flags = get(root, 'flags').value;
    return flags && typeof flags === 'object' && !isUnknown(flags) ? Object.keys(flags) : [];
  };
  const leafPaths = [
    ...REQUIRED_PROVENANCE_PATHS.filter(path => path !== 'flags'),
    ...[...new Set([...flagNames(a), ...flagNames(b)])].map(name => `flags.${name}`),
  ];
  if (isUnknown(get(a, 'flags').value) || isUnknown(get(b, 'flags').value)) {
    reasons.push('flags are unknown in at least one run');
  }

  // Output provenance: runs being compared must each have recorded outputs with stated hashes.
  for (const [label, root] of [['A', a], ['B', b]] as const) {
    const outputs = get(root, 'outputs').value;
    if (!Array.isArray(outputs) || outputs.length === 0) {
      reasons.push(`${label} has no recorded outputs, so there is nothing to compare`);
    } else if (outputs.some(output => isUnknown((output as {sha256?: unknown}).sha256))) {
      reasons.push(`${label} has an output whose hash is unknown; its provenance cannot be established`);
    }
  }

  const declared = new Set(declaredVariables);
  for (const variable of declaredVariables) {
    if (!leafPaths.includes(variable) && variable !== 'flags') {
      reasons.push(`declared variable ${variable} is not a comparable provenance field`);
    }
  }
  for (const path of leafPaths) {
    const fa = get(a, path);
    const fb = get(b, path);
    const aMissing = !fa.present;
    const bMissing = !fb.present;
    const ua = !aMissing && (isUnknown(fa.value) || containsUnknown(fa.value));
    const ub = !bMissing && (isUnknown(fb.value) || containsUnknown(fb.value));
    if (aMissing !== bMissing && path.startsWith('flags.')) {
      reasons.push(`${path} is present in only one run`);
      differing.push(path);
      fields[path] = 'missing';
      continue;
    }
    if (ua || ub) {
      fields[path] = 'unknown';
      reasons.push(`${path} is unknown in ${ua && ub ? 'both runs' : ua ? 'A' : 'B'} (${[ua ? (isUnknown(fa.value) ? fa.value.$unknown : 'contains unknown') : '', ub ? (isUnknown(fb.value) ? fb.value.$unknown : 'contains unknown') : ''].filter(Boolean).join(' / ')}); unknown is never "equal"`);
      continue;
    }
    const differs = stable(fa.value) !== stable(fb.value);
    fields[path] = differs ? 'known_mismatch' : 'known_match';
    if (differs) {
      differing.push(path);
    }
    if (declared.has(path)) {
      if (!differs) {
        reasons.push(`declared variable ${path} does not differ`);
      }
    } else if (differs) {
      reasons.push(`${path} differs but is not the declared variable`);
    }
  }
  if (reasons.length > 0) {
    return {verdict: 'not_comparable', reasons, fields, differing, declaredVariables};
  }
  return {verdict: mode === 'repeat' ? 'repeat' : 'comparable', reasons, fields, differing, declaredVariables};
}
