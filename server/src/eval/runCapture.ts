/**
 * Run capture for the REAL pipeline (offline tooling; not imported by production code).
 *
 * `captureRun` executes a pipeline function inside two explicit scopes:
 *   - an observer (lib/runObserver.ts): production code reports what it is actually doing (HTTP attempts, occupancy measurements it
 *     consumed, the perception pack it built, the configuration it resolved, the blueprint it returned);
 *   - optionally an occupancy replay (stages/layout/occupancyReplay.ts), which serves recorded measurements and fails closed.
 * The resulting RunRecord describes what was CONSUMED, not what was requested. Anything production cannot report is listed in
 * `unobserved`, and `buildRunManifest` turns it into an explicit unknown rather than a guess.
 *
 * Origin vocabulary used for manifest fields (see `RunOrigin`):
 *   observed_in_run       reported by the observer attached to the real execution path; the harness did not declare it
 *   verified_from_file    hashed from an actual file by this tooling
 *   verified_from_git     read from git / the working tree
 *   verified_from_runtime read from this process (Node version, installed Remotion version)
 *   supplied              passed in by the caller; NOT verified
 *   unknown / not_applicable
 * Request bodies, headers and URL query strings are never stored: only digests, model ids and the origin+path of a URL.
 */
import {existsSync, statSync} from 'node:fs';
import {isAbsolute, resolve} from 'node:path';

import {withObserver, type RunEvent} from '../lib/runObserver.ts';
import {framesSentToDirector} from '../stages/directorV2/perception.ts';
import {withOccupancyReplay, type OccupancyReplaySource} from '../stages/layout/occupancyReplay.ts';
import {sha256, sha256File} from './baseline.ts';
import {canonicalize} from './canonical.ts';
import {collectManifest, type CollectInput, type Evidence, type Origin} from './manifestCollector.ts';
import {captureSnapshot, occupancyInputDigest, sourceToOutputSec, type OccupancySnapshot, type ReplayLedger} from './occupancySnapshot.ts';
import {isUnknown, stable, unknown, validateManifest, type ManifestValidation, type RunManifest, type Unknown} from './runManifest.ts';

export type RunOrigin = Origin | 'observed_in_run';

export type RequestDigest = {
  bodySha256: string | null;
  kind: 'gemini' | 'multipart' | 'other' | 'none';
  /** Gemini: hashes of the system instruction, the response schema, the generation settings without the schema, and the text parts. */
  systemSha256?: string;
  schemaSha256?: string;
  generationConfigSha256?: string;
  userTextSha256?: string;
  imageCount?: number;
  /** Multipart (ASR): the non-file fields. */
  formFields?: Record<string, string>;
};

export type HttpCallRecord = {
  callId: number;
  label: string;
  method: string;
  url: string; // origin + path, no query string
  /** Model id parsed from a Gemini URL (`/models/<id>:generateContent`), if any. */
  model: string | null;
  request: RequestDigest | null;
  attempts: Array<{attempt: number; status: number | null; error?: string}>;
};

export type ConsumedOccupancy = {
  origin: 'replay' | 'live';
  role: 'primary' | 'sampled';
  requestedSourceSec: number;
  snapshotId?: string;
  snapshotSha256?: string;
  occupancy: unknown;
};

export type RunRecord = {
  startedAt: string;
  endedAt: string;
  status: 'complete' | 'incomplete' | 'failed';
  error: {name: string; message: string} | null;
  stages: Array<{id: string; startedAt: string; endedAt: string; status: 'ok' | 'failed' | 'skipped'}>;
  effectiveConfig: Record<string, unknown> | null;
  source: {sha256: string; bytes: number} | null;
  transcript: {sha256: string; wordCount: number; detectedLanguage: string} | null;
  transcriptionCache: {hit: boolean; model: string} | null;
  http: HttpCallRecord[];
  occupancy: {
    consumed: ConsumedOccupancy[];
    perceptionPack: {digest: string; storyboardTimesOutputSec: number[]; framesSentToDirector: number; independentMeasurements: number} | null;
    directorInputs: Array<{path: string; occupancy: unknown; occupancyAtSec: number | null; occupancyContextV2: boolean}>;
    replay: {snapshotId: string; snapshotSha256: string; ledger: ReplayLedger; unserved: string[]} | null;
  };
  directors: Array<{path: string; source: string; hookTitle: string; moments: number; warnings: string[]}>;
  blueprint: {
    sha256: string; fps: number; width: number; height: number; sourceDurationSec: number; outputDurationSec: number;
    keepSegments: unknown; hookTitle: string; hookStartSec: number; hookDurationSec: number; assetUrls: string[]; videoUrl: string;
  } | null;
  /** Things this tooling cannot see, so no manifest field may claim them. */
  unobserved: string[];
  observerErrors: string[];
};

const KNOWN_UNOBSERVED = [
  'requests made through a plain fetch() outside requestWithRetry (file downloads, webhooks, auth)',
  'calls made through the Anthropic SDK (its own transport and retries)',
  'the content of request bodies (only digests are kept)',
];

const text = (value: unknown) => (typeof value === 'string' ? value : '');

function digestBody(body: unknown): RequestDigest {
  if (body === undefined || body === null) {
    return {bodySha256: null, kind: 'none'};
  }
  if (typeof body === 'string') {
    const bodySha256 = sha256(body);
    try {
      const parsed = JSON.parse(body) as Record<string, any>;
      if (Array.isArray(parsed.contents)) {
        const parts: Array<Record<string, any>> = parsed.contents.flatMap((content: any) => (Array.isArray(content?.parts) ? content.parts : []));
        const {responseSchema, ...generationConfig} = (parsed.generationConfig ?? {}) as Record<string, any>;
        return {
          bodySha256, kind: 'gemini',
          systemSha256: sha256(stable(parsed.systemInstruction ?? null)),
          schemaSha256: sha256(stable(responseSchema ?? null)),
          generationConfigSha256: sha256(stable(generationConfig)),
          userTextSha256: sha256(parts.map(part => text(part?.text)).join('\n')),
          imageCount: parts.filter(part => part && typeof part === 'object' && 'inlineData' in part).length,
        };
      }
    } catch {
      /* not JSON */
    }
    return {bodySha256, kind: 'other'};
  }
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    const formFields: Record<string, string> = {};
    for (const [key, value] of body.entries()) {
      if (typeof value === 'string') {
        formFields[key] = value;
      }
    }
    return {bodySha256: sha256(stable(formFields)), kind: 'multipart', formFields};
  }
  return {bodySha256: null, kind: 'other'};
}

/**
 * Identity of a blueprint: canonical JSON (sorted keys, numbers rounded to 1e-4; `blueprintId`, `createdAt` and cost fields dropped by
 * `canonicalize`) WITHOUT `stats.timings`, which are wall-clock milliseconds and differ on every run of identical inputs.
 */
export function blueprintIdentitySha256(blueprint: Record<string, any>): string {
  const copy = structuredClone(blueprint);
  if (copy.stats && typeof copy.stats === 'object') {
    delete copy.stats.timings;
  }
  return sha256(JSON.stringify(canonicalize(copy)));
}

export class RunCapture {
  readonly http = new Map<number, HttpCallRecord>();
  readonly record: RunRecord;
  private stageOpen: {id: string; startedAt: string} | null = null;
  private readonly now: () => Date;

  constructor(now: () => Date) {
    this.now = now;
    this.record = {
      startedAt: now().toISOString(), endedAt: '', status: 'incomplete', error: null, stages: [], effectiveConfig: null, source: null, transcript: null,
      transcriptionCache: null, http: [],
      occupancy: {consumed: [], perceptionPack: null, directorInputs: [], replay: null},
      directors: [], blueprint: null, unobserved: [...KNOWN_UNOBSERVED], observerErrors: [],
    };
  }

  stage(id: string): void {
    this.endStage('ok');
    this.stageOpen = {id, startedAt: this.now().toISOString()};
  }

  endStage(status: 'ok' | 'failed'): void {
    if (this.stageOpen) {
      this.record.stages.push({id: this.stageOpen.id, startedAt: this.stageOpen.startedAt, endedAt: this.now().toISOString(), status});
      this.stageOpen = null;
    }
  }

  readonly observer = (event: RunEvent): void => {
    try {
      this.handle(event);
    } catch (error) {
      this.record.observerErrors.push(`${event.type}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  private handle(event: RunEvent): void {
    const e = event as Record<string, any>;
    switch (event.type) {
      case 'http_request': {
        const url = String(e.url);
        const model = /\/models\/([^/:]+):/.exec(url)?.[1] ?? null;
        let call = this.http.get(e.callId);
        if (!call) {
          call = {callId: e.callId, label: String(e.label), method: String(e.method), url, model, request: digestBody(e.body), attempts: []};
          this.http.set(e.callId, call);
          this.record.http.push(call);
        }
        call.attempts.push({attempt: e.attempt, status: null});
        break;
      }
      case 'http_response': {
        const call = this.http.get(e.callId);
        const attempt = call?.attempts.find(item => item.attempt === e.attempt);
        if (attempt) {
          attempt.status = e.status || null;
          if (e.error) {
            attempt.error = String(e.error);
          }
        }
        break;
      }
      case 'run_config':
        this.record.effectiveConfig = structuredClone(e.effective);
        break;
      case 'source': {
        const path = String(e.path);
        this.record.source = {sha256: sha256File(path), bytes: statSync(path).size};
        break;
      }
      case 'transcript':
        this.record.transcript = {sha256: sha256(text(e.transcript)), wordCount: Number(e.wordCount), detectedLanguage: text(e.detectedLanguage)};
        break;
      case 'transcription_cache':
        this.record.transcriptionCache = {hit: Boolean(e.hit), model: text(e.model)};
        break;
      case 'occupancy_consumed':
        this.record.occupancy.consumed.push({
          origin: e.origin, role: e.role, requestedSourceSec: e.requestedSourceSec, snapshotId: e.snapshotId, snapshotSha256: e.snapshotSha256, occupancy: structuredClone(e.occupancy),
        });
        break;
      case 'perception_pack': {
        const pack = e.pack as Parameters<typeof framesSentToDirector>[0] & Parameters<typeof occupancyInputDigest>[0];
        this.record.occupancy.perceptionPack = {
          digest: occupancyInputDigest(pack),
          storyboardTimesOutputSec: pack.storyboard.map(frame => frame.atSec),
          framesSentToDirector: framesSentToDirector(pack).length,
          independentMeasurements: pack.occupancyMeasured?.length ?? 0,
        };
        break;
      }
      case 'director_occupancy_input':
        this.record.occupancy.directorInputs.push({path: e.path, occupancy: structuredClone(e.occupancy), occupancyAtSec: e.occupancyAtSec, occupancyContextV2: Boolean(e.occupancyContextV2)});
        break;
      case 'director_result':
        this.record.directors.push({path: e.path, source: e.source, hookTitle: e.hookTitle, moments: e.moments, warnings: [...e.warnings]});
        break;
      case 'blueprint': {
        const b = e.blueprint as Record<string, any>;
        const urls = new Set<string>();
        for (const clip of [...(b.brollClips ?? []), ...(b.visualOverlays ?? [])]) {
          for (const key of ['assetUrl', 'url', 'src']) {
            if (typeof clip?.[key] === 'string') {
              urls.add(clip[key]);
            }
          }
        }
        this.record.blueprint = {
          sha256: blueprintIdentitySha256(b), fps: b.fps, width: b.width, height: b.height, sourceDurationSec: b.sourceDurationSec, outputDurationSec: b.outputDurationSec,
          keepSegments: structuredClone(b.keepSegments), hookTitle: text(b.hookTitle), hookStartSec: b.hookStartSec ?? 0, hookDurationSec: b.hookDurationSec ?? 0,
          assetUrls: [...urls].sort(), videoUrl: text(b.videoUrl),
        };
        break;
      }
      default:
        break;
    }
  }
}

export type CaptureOptions<T> = {
  /** Explicit, opt-in replay. Absent = the pipeline measures occupancy itself, exactly as in production. */
  replay?: OccupancyReplaySource & {ledger: ReplayLedger; unserved(): string[]};
  run: (hooks: {onStage: (stage: string, progress: number) => void}) => Promise<T>;
  now?: () => Date;
};

export async function captureRun<T>(options: CaptureOptions<T>): Promise<{value: T | undefined; record: RunRecord}> {
  const capture = new RunCapture(options.now ?? (() => new Date()));
  const hooks = {onStage: (stage: string) => capture.stage(stage)};
  let value: T | undefined;
  const execute = () => options.run(hooks);
  try {
    value = await withObserver(capture.observer, () => (options.replay ? withOccupancyReplay(options.replay, execute) : execute()));
    capture.endStage('ok');
  } catch (error) {
    capture.endStage('failed');
    capture.record.error = {name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : String(error)};
  }
  const record = capture.record;
  record.endedAt = (options.now ?? (() => new Date()))().toISOString();
  if (options.replay) {
    record.occupancy.replay = {snapshotId: options.replay.id, snapshotSha256: options.replay.contentSha256, ledger: options.replay.ledger, unserved: options.replay.unserved()};
  }
  const replayViolations = record.occupancy.replay?.ledger.violations.length ?? 0;
  record.status = record.error || replayViolations > 0 || record.observerErrors.length > 0 ? 'failed' : 'complete';
  return {value, record};
}

// ---------------------------------------------------------------------------------------------------------------------------------

export type RenderCapture = {
  engine: string;
  codec: string;
  fps: number;
  width: number;
  height: number;
  /** Absolute paths of the files the renderer wrote. They are hashed from disk here. */
  outputs: Array<{kind: string; path: string}>;
  startedAt: string;
  endedAt: string;
  status: 'ok' | 'failed';
};

export type BuildRunManifestInput = {
  root: string;
  run: {id: string; arm: string; repeat: number; createdAt: string};
  record: RunRecord;
  render?: RenderCapture;
  /** The snapshot file the replay was built from, when one was used (its hash is re-verified from the file). */
  snapshotPath?: string;
  rubric?: {version: string; path?: string};
};

export type BuiltRunManifest = {
  manifest: RunManifest;
  origin: Record<string, RunOrigin>;
  evidence: Evidence & {observed: Record<string, unknown>};
  validation: ManifestValidation;
};

const unk = (reason: string): Unknown => unknown(reason);

/**
 * Turn a RunRecord (+ the render capture) into a manifest. Observed values replace the collector's "supplied" ones; whatever was not
 * observed stays supplied-or-unknown. Status is `complete` only if the pipeline, the replay (no violations, nothing unserved) and
 * the renderer all finished.
 */
export function buildRunManifest(input: BuildRunManifestInput): BuiltRunManifest {
  const {record, render} = input;
  const cfg = record.effectiveConfig;
  const origin: Record<string, RunOrigin> = {};
  const mark = (path: string, how: RunOrigin) => {
    origin[path] = how;
  };

  // Stages: the pipeline's own stage callbacks, plus the render stage when a renderer ran.
  const stages = [...record.stages];
  if (render) {
    stages.push({id: 'render', startedAt: render.startedAt, endedAt: render.endedAt, status: render.status});
  }
  const replayUnserved = record.occupancy.replay?.unserved ?? [];
  const replayViolations = record.occupancy.replay?.ledger.violations ?? [];
  const complete = record.status === 'complete' && (!render || render.status === 'ok') && replayViolations.length === 0 && replayUnserved.length === 0;

  const director = record.http.filter(call => call.label === 'Gemini visual director' || call.label === 'Director v2 creative director');
  const directorSucceeded = director.filter(call => call.attempts.some(attempt => attempt.status !== null && attempt.status >= 200 && attempt.status < 300));
  const directorRequest = (directorSucceeded[0] ?? director[0])?.request ?? null;
  const asr = record.http.find(call => call.label === 'Groq transcription');
  const motionOn = cfg?.motionGraphicsOn === true;

  const collectInput: CollectInput = {
    root: input.root,
    run: {...input.run, status: complete ? 'complete' : record.status === 'failed' || (render && render.status === 'failed') ? 'failed' : 'incomplete'},
    stages,
    config: cfg ?? {},
    outputs: render?.outputs ?? [],
    rubric: input.rubric,
    occupancy: input.snapshotPath === undefined ? undefined : {snapshotPath: input.snapshotPath, mode: 'replay'},
  };
  const collected = collectManifest(collectInput);
  const manifest = JSON.parse(JSON.stringify(collected.manifest)) as Record<string, any>;
  for (const [key, how] of Object.entries(collected.origin)) {
    origin[key] = how;
  }

  // run.status / stages: the collector tagged them "supplied"; here they come from the observed callbacks and the render capture.
  mark('run.status', 'observed_in_run');
  mark('stages', record.stages.length > 0 ? 'observed_in_run' : 'unknown');
  if (record.stages.length === 0) {
    manifest.stages = unk('the pipeline reported no stage callbacks');
  }

  // Effective flags and settings: what the pipeline resolved while running, not what the caller says.
  if (cfg) {
    for (const key of Object.keys(manifest.flags)) {
      if (key in cfg) {
        manifest.flags[key] = cfg[key];
        mark(`flags.${key}`, 'observed_in_run');
      }
    }
    manifest.visualContext.enabled = cfg.VISUAL_CONTEXT_V2;
    mark('visualContext.enabled', 'observed_in_run');
    manifest.pipeline.path = cfg.directorV2 === true ? 'v2' : 'v1';
    mark('pipeline.path', 'observed_in_run');
  } else {
    for (const key of Object.keys(manifest.flags)) {
      manifest.flags[key] = unk('the pipeline reported no effective configuration');
      mark(`flags.${key}`, 'unknown');
    }
    manifest.visualContext.enabled = unk('no effective configuration observed');
    manifest.pipeline.path = unk('no effective configuration observed');
    mark('visualContext.enabled', 'unknown');
    mark('pipeline.path', 'unknown');
  }

  // Source and transcript identity, as hashed when the pipeline opened them.
  if (record.source) {
    manifest.source.videoSha256 = record.source.sha256;
    manifest.source.sizeBytes = record.source.bytes;
    mark('source.videoSha256', 'observed_in_run');
    mark('source.sizeBytes', 'observed_in_run');
  }
  if (record.transcript) {
    manifest.source.transcriptSha256 = record.transcript.sha256;
    mark('source.transcriptSha256', 'observed_in_run');
  }
  if (record.blueprint) {
    manifest.source.durationSec = record.blueprint.sourceDurationSec;
    manifest.source.trim = record.blueprint.keepSegments;
    manifest.renderer.fps = record.blueprint.fps;
    manifest.renderer.width = record.blueprint.width;
    manifest.renderer.height = record.blueprint.height;
    for (const path of ['source.durationSec', 'source.trim', 'renderer.fps', 'renderer.width', 'renderer.height']) {
      mark(path, 'observed_in_run');
    }
  }

  // Models. Gemini model ids come from the request URLs; ASR's model from its multipart fields; stages that did not run are null.
  const directorModels = [...new Set(director.map(call => call.model).filter((model): model is string => Boolean(model)))];
  const okModel = directorSucceeded[0]?.model ?? null;
  if (director.length === 0) {
    manifest.models.director = null;
    mark('models.director', 'observed_in_run'); // observed: no Director request was made (deterministic fallback or no key)
  } else if (okModel) {
    manifest.models.director = {id: okModel, requestedModels: directorModels};
    mark('models.director', 'observed_in_run');
  } else {
    manifest.models.director = unk(`Director requests were made (${directorModels.join(', ')}) but none succeeded, so the model that produced the plan is unknown`);
    mark('models.director', 'unknown');
  }
  if (asr?.request?.formFields?.model) {
    manifest.models.transcription = {id: asr.request.formFields.model};
    mark('models.transcription', 'observed_in_run');
  } else if (record.transcriptionCache?.hit) {
    manifest.models.transcription = {id: record.transcriptionCache.model, servedFromCache: true};
    mark('models.transcription', 'observed_in_run');
  } else {
    manifest.models.transcription = unk('no transcription request was observed');
    mark('models.transcription', 'unknown');
  }
  for (const stage of ['motionDirector', 'graphicsWorker'] as const) {
    if (cfg && !motionOn) {
      manifest.models[stage] = null;
      mark(`models.${stage}`, 'observed_in_run'); // derived from the effective configuration: the stage did not run
    } else {
      manifest.models[stage] = unk('the Anthropic SDK and the motion-graphics stage are not observed by this tooling');
      mark(`models.${stage}`, 'unknown');
    }
  }

  // Prompts: the system instruction and response schema as actually sent. The prompt FILES digest stays a file hash from the collector.
  if (manifest.models.director === null) {
    manifest.prompts.directorSystemSha256 = null;
    manifest.prompts.directorSchemaSha256 = null;
    mark('prompts.directorSystemSha256', 'not_applicable');
    mark('prompts.directorSchemaSha256', 'not_applicable');
  } else if (directorRequest?.systemSha256) {
    manifest.prompts.directorSystemSha256 = directorRequest.systemSha256;
    manifest.prompts.directorSchemaSha256 = directorRequest.schemaSha256;
    mark('prompts.directorSystemSha256', 'observed_in_run');
    mark('prompts.directorSchemaSha256', 'observed_in_run');
  } else {
    manifest.prompts.directorSystemSha256 = unk('the Director request could not be parsed');
    manifest.prompts.directorSchemaSha256 = unk('the Director request could not be parsed');
    mark('prompts.directorSystemSha256', 'unknown');
    mark('prompts.directorSchemaSha256', 'unknown');
  }
  if (record.http.some(call => call.label === 'content profile')) {
    manifest.prompts.contentProfileBlockSha256 = unk('a content-profile call was observed, but its block is embedded in the Director prompt and not hashed separately');
    mark('prompts.contentProfileBlockSha256', 'unknown');
  }

  // Images and frame times the Director actually received.
  const pack = record.occupancy.perceptionPack;
  manifest.visualContext.frameTimesOutputSec = pack ? pack.storyboardTimesOutputSec.slice(0, pack.framesSentToDirector) : [];
  manifest.visualContext.imagesAttached = directorRequest?.imageCount ?? (director.length === 0 ? 0 : unk('the Director request could not be parsed'));
  mark('visualContext.frameTimesOutputSec', 'observed_in_run');
  mark('visualContext.imagesAttached', director.length === 0 || directorRequest ? 'observed_in_run' : 'unknown');

  // Occupancy: which data the run consumed. A replay is recognised from the consumed measurements, not from the caller's say-so.
  const consumed = record.occupancy.consumed;
  const replayConsumed = consumed.length > 0 && consumed.every(item => item.origin === 'replay');
  const consumedDigest = sha256(stable(consumed.map(item => ({role: item.role, requestedSourceSec: item.requestedSourceSec, occupancy: item.occupancy}))));
  if (replayConsumed && record.occupancy.replay) {
    manifest.occupancy.mode = 'replay';
    manifest.occupancy.snapshotSha256 = record.occupancy.replay.snapshotSha256;
    manifest.occupancy.receivedDigestSha256 = pack ? pack.digest : consumedDigest;
    for (const path of ['occupancy.mode', 'occupancy.snapshotSha256', 'occupancy.receivedDigestSha256']) {
      mark(path, 'observed_in_run');
    }
    if (input.snapshotPath !== undefined) {
      // Cross-check: the file the caller names must be the snapshot the pipeline actually consumed.
      const fileHash = (collected.manifest.occupancy as {snapshotSha256: unknown}).snapshotSha256;
      if (fileHash !== record.occupancy.replay.snapshotSha256) {
        manifest.occupancy.snapshotSha256 = unk(`the snapshot file hashes to ${String(isUnknown(fileHash) ? 'an unknown value' : fileHash)} but the pipeline consumed ${record.occupancy.replay.snapshotSha256}`);
        mark('occupancy.snapshotSha256', 'unknown');
      }
    }
  } else if (consumed.length > 0 && consumed.every(item => item.origin === 'live')) {
    manifest.occupancy.mode = 'live';
    manifest.occupancy.snapshotSha256 = unk('live detection: nothing was frozen');
    manifest.occupancy.receivedDigestSha256 = unk('live detection: nothing was frozen');
    mark('occupancy.mode', 'observed_in_run');
    mark('occupancy.snapshotSha256', 'unknown');
    mark('occupancy.receivedDigestSha256', 'unknown');
  } else {
    const reason = consumed.length === 0 ? 'no occupancy measurement was observed' : 'the run consumed a mix of replayed and live occupancy';
    manifest.occupancy.mode = unk(reason);
    manifest.occupancy.snapshotSha256 = unk(reason);
    manifest.occupancy.receivedDigestSha256 = unk(reason);
    for (const path of ['occupancy.mode', 'occupancy.snapshotSha256', 'occupancy.receivedDigestSha256']) {
      mark(path, 'unknown');
    }
  }

  // B-roll: derived from what the blueprint actually references. Remote assets are never downloaded here, so their hashes are unknown.
  if (record.blueprint) {
    const assetUrls = record.blueprint.assetUrls;
    if (assetUrls.length === 0 && !record.http.some(call => /^(Pexels|Pixabay)/.test(call.label))) {
      manifest.broll.mode = 'none';
      manifest.broll.assets = [];
      manifest.broll.stockFrozen = true; // vacuous: no stock search was observed and the blueprint references no asset
      for (const path of ['broll.mode', 'broll.assets', 'broll.stockFrozen']) {
        mark(path, 'observed_in_run');
      }
    } else {
      manifest.broll.mode = 'stock';
      manifest.broll.assets = assetUrls.map((url, index) => ({id: `asset-${index + 1}`, sha256: unk(`remote asset ${url.split('?')[0]} was not downloaded or hashed`)}));
      manifest.broll.stockFrozen = unk('stock results are not frozen by this tooling');
      mark('broll.mode', 'observed_in_run');
      mark('broll.assets', 'unknown');
      mark('broll.stockFrozen', 'unknown');
    }
  }

  // Renderer: the settings the renderer was actually given, and the files it wrote (hashed from disk by the collector).
  if (render) {
    manifest.renderer.engine = render.engine;
    manifest.renderer.codec = render.codec;
    mark('renderer.engine', 'observed_in_run');
    mark('renderer.codec', 'observed_in_run');
    if (record.blueprint && (render.fps !== record.blueprint.fps || render.width !== record.blueprint.width || render.height !== record.blueprint.height)) {
      manifest.renderer.fps = unk('the renderer was given a different fps/size than the blueprint');
      mark('renderer.fps', 'unknown');
    }
  } else {
    manifest.renderer.engine = unk('no render was captured');
    manifest.renderer.codec = unk('no render was captured');
    mark('renderer.engine', 'unknown');
    mark('renderer.codec', 'unknown');
  }

  const validation = validateManifest(manifest);
  return {
    manifest: manifest as unknown as RunManifest,
    origin,
    evidence: {
      ...collected.evidence,
      observed: {
        httpCalls: record.http.map(call => ({label: call.label, model: call.model, attempts: call.attempts.length, statuses: call.attempts.map(attempt => attempt.status ?? attempt.error ?? null), request: call.request})),
        directors: record.directors,
        consumedOccupancy: consumed.map(item => ({origin: item.origin, role: item.role, requestedSourceSec: item.requestedSourceSec})),
        directorOccupancyInputs: record.occupancy.directorInputs,
        replayViolations, replayUnserved,
        transcriptionCache: record.transcriptionCache,
        blueprintSha256: record.blueprint?.sha256 ?? null,
        unobserved: record.unobserved,
        error: record.error,
      },
    },
    validation,
  };
}

/** Does this path exist as a regular file (used by tests that check evidence against disk). */
export function fileExists(path: string, root = process.cwd()): boolean {
  const absolute = isAbsolute(path) ? path : resolve(root, path);
  return existsSync(absolute) && statSync(absolute).isFile();
}



/**
 * "Record once": turn the measurements a LIVE run actually consumed into a sealed snapshot, with the source identity as the pipeline
 * hashed it. Every measurement is kept exactly as consumed (including `fallback` boxes). This is what a real recorded snapshot would
 * be made from; here it is applied to synthetic runs only.
 */
export function snapshotFromRecord(record: RunRecord, meta: {id: string; sourceId: string; capturedAt: string; note: string}): OccupancySnapshot {
  if (!record.source || !record.blueprint) {
    throw new Error('cannot build a snapshot: the run did not report its source or its blueprint');
  }
  const consumed = record.occupancy.consumed;
  if (consumed.length === 0 || consumed.some(item => item.origin !== 'live')) {
    throw new Error('cannot build a snapshot: it must come from a live run whose measurements were all live');
  }
  const keep = record.blueprint.keepSegments as Array<{sourceStart: number; sourceEnd: number; outputStart: number}>;
  return captureSnapshot({
    id: meta.id,
    source: {sourceId: meta.sourceId, videoSha256: record.source.sha256},
    capture: {method: 'recorded', capturedAt: meta.capturedAt, note: meta.note},
    outputDurationSec: record.blueprint.outputDurationSec,
    measurements: consumed.map((item, index) => ({
      id: `m${index}`,
      role: item.role,
      sourceSec: item.requestedSourceSec,
      outputSec: sourceToOutputSec(keep, item.requestedSourceSec),
      occupancy: structuredClone(item.occupancy) as OccupancySnapshot['measurements'][number]['occupancy'],
    })),
  });
}
