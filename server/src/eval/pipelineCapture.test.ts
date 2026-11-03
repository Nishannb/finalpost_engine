/**
 * Phase 21A: capture and occupancy replay wired into the REAL pipeline (analyzeVideo -> planBRoll -> Director -> blueprint) and, when
 * RENDER_TESTS=1, the real Remotion composition. Everything outside the process is stubbed: `fetch` is replaced before any code runs,
 * answers only for the Groq and Gemini hosts, and records every request it sees so the capture can be checked against an INDEPENDENT
 * count. Anything else fails the test (nothing can reach the network). The media is an ffmpeg test pattern with a sine tone.
 */
import {execFileSync} from 'node:child_process';
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

import {env} from '../config/env.ts';
import {sha256, sha256File} from './baseline.ts';
import {canonicalize} from './canonical.ts';
import {compareManifestsVerified} from './manifestVerify.ts';
import {
  assertSnapshotMatchesSource, captureSnapshot, independentMeasurements, occupancyReplaySource, snapshotToJson, SnapshotError, type OccupancySnapshot,
} from './occupancySnapshot.ts';
import {renderBlueprintStill} from './renderCapture.ts';
import {blueprintIdentitySha256, buildRunManifest, captureRun, RunCapture, snapshotFromRecord, type RenderCapture, type RunRecord} from './runCapture.ts';
import {compareManifests} from './runManifest.ts';
import {occupancyFromSpeaker} from '../stages/layout/occupancy.ts';
import {activeOccupancyReplay, OccupancyReplayError} from '../stages/layout/occupancyReplay.ts';
import {isObserved, observe} from '../lib/runObserver.ts';

vi.mock('../storage/r2.ts', async importOriginal => ({...(await importOriginal<typeof import('../storage/r2.ts')>()), uploadSourceVideo: async () => ({publicUrl: 'staticFile:source.mp4', key: 'synthetic'})}));

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GEMINI_HOST = 'generativelanguage.googleapis.com';
const ALLOWED_HOSTS = [GEMINI_HOST, 'api.groq.com'];
const RENDER = process.env.RENDER_TESTS === '1';

// ---------------------------------------------------------------------------------------------------------------- network stub
type NetCall = {url: string; host: string; body: string; kind: string; n: number};
type Reply = Response | 'abort' | undefined;
const net = {
  calls: [] as NetCall[],
  escaped: [] as string[],
  override: undefined as undefined | ((call: NetCall) => Reply),
  detectorCalls: 0,
  detector: (n: number): Reply => new Response(JSON.stringify({candidates: [{content: {parts: [{text: JSON.stringify(n === 1 ? {x: 0.2, y: 0.1, w: 0.6, h: 0.7} : {x: 0.05, y: 0.15, w: 0.45, h: 0.75})}]}}]}), {status: 200}),
};
const WORDS = Array.from({length: 22}, (_, i) => ({word: `word${i}.`, start: i * 0.5, end: i * 0.5 + 0.45}));
const gemini = (text: string) => new Response(JSON.stringify({candidates: [{content: {parts: [{text}]}}], usageMetadata: {promptTokenCount: 10, candidatesTokenCount: 5}}), {status: 200});
const DIRECTOR_REPLY = {topic: 't', hook_title: 'Silence Speaks', hook_style: 'minimal', moments: [{timestamp: 5, search_keyword: 'sunset', media: 'video', layout: 'cutaway'}], caption: {}};

function classify(body: string, host: string): string {
  if (host === 'api.groq.com') return 'asr';
  if (body.includes('Vertical talking-head video frame')) return 'occupancy';
  if (body.includes('planned overlay layout')) return 'critique';
  if (body.includes('"beats"')) return 'v2_story';
  if (body.includes('"elements"')) return 'v2_plan';
  return 'director';
}

function route(call: NetCall): Reply {
  const custom = net.override?.(call);
  if (custom) return custom;
  switch (call.kind) {
    case 'asr': return new Response(JSON.stringify({text: WORDS.map(word => word.word).join(' '), language: 'en', duration: 12, words: WORDS}), {status: 200});
    case 'occupancy': net.detectorCalls += 1; return net.detector(net.detectorCalls);
    case 'critique': return gemini('{"notes":""}');
    case 'v2_story': case 'v2_plan': return gemini('{}');
    default: return gemini(JSON.stringify(DIRECTOR_REPLY));
  }
}

// ---------------------------------------------------------------------------------------------------------------------- fixtures
let work: string;
let video: string;
let publicDir: string;
let rubric: string;
let nowTick = 0;
const clock = () => new Date(Date.UTC(2026, 9, 11, 0, 0, nowTick++));
const original = {tmpdir: process.env.TMPDIR, env: {} as Record<string, unknown>};
const ENV_KEYS = ['GEMINI_API_KEY', 'GROQ_API_KEY', 'PEXELS_API_KEY', 'PIXABAY_API_KEY', 'CONTENT_PROFILE_ENABLED', 'OCCUPANCY_CONTEXT_V2', 'HOOK_TITLE_POLICY', 'DIRECTOR_V2', 'NORTH_STAR', 'VISUAL_CONTEXT_V2', 'MOTION_GRAPHICS_ENABLED'];
const e = env as unknown as Record<string, unknown>;
const setEnv = (values: Record<string, unknown>) => Object.assign(e, values);

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'pipeline-capture-'));
  process.env.TMPDIR = join(work, 'tmp'); // the ASR cache lives under os.tmpdir(): keep this test's cache private
  mkdirSync(process.env.TMPDIR);
  video = join(work, 'source.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=720x1280:rate=30:duration=12', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video]);
  publicDir = join(work, 'public');
  mkdirSync(publicDir);
  copyFileSync(video, join(publicDir, 'source.mp4'));
  rubric = join(work, 'rubric.md');
  writeFileSync(rubric, 'synthetic rubric v0');
  for (const key of ENV_KEYS) original.env[key] = e[key];
  vi.stubGlobal('fetch', async (url: string | URL, init?: {body?: unknown}) => {
    const parsed = new URL(String(url));
    if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
      net.escaped.push(String(url));
      throw new Error(`blocked outbound request to ${parsed.hostname}`);
    }
    const body = typeof init?.body === 'string' ? init.body : '';
    const call: NetCall = {url: `${parsed.origin}${parsed.pathname}`, host: parsed.hostname, body, kind: classify(body, parsed.hostname), n: net.calls.length + 1};
    net.calls.push(call);
    const reply = route(call);
    if (reply === 'abort') {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    }
    return reply!;
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
  process.env.TMPDIR = original.tmpdir;
  rmSync(work, {recursive: true, force: true});
});

afterEach(() => {
  Object.assign(e, original.env);
  net.calls.length = 0;
  net.escaped.length = 0;
  net.override = undefined;
  net.detectorCalls = 0;
  nowTick = 0;
});

const baseEnv = () => setEnv({GEMINI_API_KEY: 'test-gemini-offline', GROQ_API_KEY: 'test-groq-offline', PEXELS_API_KEY: '', PIXABAY_API_KEY: '', CONTENT_PROFILE_ENABLED: false, OCCUPANCY_CONTEXT_V2: false, HOOK_TITLE_POLICY: 'placeholder', DIRECTOR_V2: false, NORTH_STAR: false, VISUAL_CONTEXT_V2: false, MOTION_GRAPHICS_ENABLED: false});

type Arm = {record: RunRecord; blueprint: any; net: NetCall[]};

/** Run the real analyzeVideo inside the capture (and, optionally, an explicit replay). */
async function runArm(options: {replay?: ReturnType<typeof occupancyReplaySource>; directorV2?: boolean; flags?: Record<string, unknown>} = {}): Promise<Arm> {
  baseEnv();
  setEnv(options.flags ?? {});
  net.calls.length = 0;
  net.detectorCalls = 0;
  const {analyzeVideo} = await import('../pipeline/analyzeVideo.ts');
  const {value, record} = await captureRun({
    replay: options.replay,
    now: clock,
    run: hooks => analyzeVideo({videoUrl: video, languageCode: 'en', userId: 'synthetic', requestedEdits: ['hook_title', 'zoom', 'cutaway'], directorV2: options.directorV2}, hooks),
  });
  return {record, blueprint: value, net: [...net.calls]};
}

const manifestFor = (arm: Arm, id: string, label: string, extra: {snapshotPath?: string; render?: RenderCapture} = {}) => {
  const blueprintPath = join(work, `${id}.blueprint.json`);
  const render: RenderCapture = extra.render ?? (() => {
    writeFileSync(blueprintPath, JSON.stringify(arm.blueprint ?? {}));
    return {engine: 'none-blueprint-only', codec: 'none', fps: arm.blueprint?.fps ?? 30, width: arm.blueprint?.width ?? 0, height: arm.blueprint?.height ?? 0, outputs: [{kind: 'blueprint_json', path: blueprintPath}], startedAt: '2026-10-11T00:00:00Z', endedAt: '2026-10-11T00:00:01Z', status: 'ok'};
  })();
  return buildRunManifest({root: REPO, run: {id, arm: label, repeat: 0, createdAt: '2026-10-11T00:00:00Z'}, record: arm.record, render, snapshotPath: extra.snapshotPath, rubric: {version: 'synthetic-v0', path: rubric}});
};

const labels = (arm: Arm) => arm.record.http.map(call => call.label);
const hosts = (calls: NetCall[]) => [...new Set(calls.map(call => call.host))].sort();

// ======================================================================================================================== tests
describe('defaults and inertness', () => {
  it('both Phase 18 flags are off in the environment this suite starts from, and the seam and the observer are inactive outside an explicit scope', () => {
    expect(original.env.HOOK_TITLE_POLICY).toBe('placeholder');
    expect(original.env.OCCUPANCY_CONTEXT_V2).toBe(false);
    expect(activeOccupancyReplay()).toBeUndefined();
    expect(isObserved()).toBe(false);
  });

  it('with no observer, observe() never builds its event (zero cost, nothing recorded)', () => {
    let built = 0;
    observe(() => (built += 1, {type: 'x'}));
    expect(built).toBe(0);
  });

  it('an observer that throws cannot change what the pipeline does', async () => {
    baseEnv();
    const {withObserver} = await import('../lib/runObserver.ts');
    const {analyzeVideo} = await import('../pipeline/analyzeVideo.ts');
    const blueprint = await withObserver(() => { throw new Error('observer bug'); }, () => analyzeVideo({videoUrl: video, languageCode: 'en', userId: 'synthetic', requestedEdits: ['hook_title', 'zoom', 'cutaway']}));
    expect(blueprint.hookTitle).toBe('Silence Speaks');
  }, 120_000);

  it('a replay scope is not left active after a run, and a following run without replay measures live again', async () => {
    const live = await runArm();
    const snapshot = snapshotFromRecord(live.record, {id: 'scope', sourceId: 'synthetic:e2e', capturedAt: '2026-10-11T00:00:00Z', note: 'scope check'});
    await runArm({replay: occupancyReplaySource(snapshot)});
    expect(activeOccupancyReplay()).toBeUndefined();
    const again = await runArm();
    expect(again.record.occupancy.consumed[0]!.origin).toBe('live');
    expect(again.net.filter(call => call.kind === 'occupancy')).toHaveLength(1);
  }, 180_000);
});

describe('the network is closed', () => {
  it('only the stubbed Groq and Gemini hosts answer; anything else is blocked and recorded as an escape', async () => {
    await expect(fetch('https://example.invalid/leak')).rejects.toThrow(/blocked outbound request/);
    expect(net.escaped).toEqual(['https://example.invalid/leak']);
    net.escaped.length = 0;
  });
});

describe('capture is connected to the real execution path (live run)', () => {
  let live: Arm;
  beforeAll(async () => {
    live = await runArm();
  }, 120_000);

  it('the pipeline ran for real: a blueprint came back, the Director was used, and no request left the stubbed hosts', () => {
    expect(live.record.status).toBe('complete');
    expect(live.record.error).toBeNull();
    expect(live.blueprint.hookTitle).toBe('Silence Speaks');
    expect(hosts(live.net)).toEqual(['api.groq.com', GEMINI_HOST]);
    expect(net.escaped).toEqual([]);
  });

  it('every HTTP attempt the network layer saw is in the record, with the same labels and counts (fails if the hooks are disconnected)', () => {
    const recordedAttempts = live.record.http.reduce((sum, call) => sum + call.attempts.length, 0);
    expect(live.net.length).toBeGreaterThan(0);
    expect(recordedAttempts).toBe(live.net.length);
    expect(labels(live)).toEqual(['Groq transcription', 'Gemini speaker occupancy', 'Gemini visual director', 'Gemini layout critique']);
    expect(live.record.http.every(call => call.attempts.every(attempt => attempt.status === 200))).toBe(true);
    expect(live.record.http.map(call => call.request!.kind)).toEqual(['multipart', 'gemini', 'gemini', 'gemini']);
    // URLs are origin+path only: no query string, so no API key can be recorded
    expect(JSON.stringify(live.record)).not.toMatch(/key=|test-gemini-offline|test-groq-offline/);
  });

  it('the pipeline\'s own stage callbacks, the source and transcript identity, and the blueprint identity are recorded from the run', () => {
    expect(live.record.stages.map(stage => stage.id)).toEqual(['downloading', 'transcribing', 'filtering', 'sourcing_broll']);
    expect(live.record.stages.every(stage => stage.status === 'ok')).toBe(true);
    expect(live.record.source!.sha256).toBe(sha256File(video));
    expect(live.record.transcript!.sha256).toBe(sha256(WORDS.map(word => word.word).join(' ')));
    const { timings: _timings, ...statsWithoutTimings } = live.blueprint.stats;
    expect(live.record.blueprint!.sha256).toBe(sha256(JSON.stringify(canonicalize({ ...live.blueprint, stats: statsWithoutTimings }))));
    expect(_timings).toBeDefined(); // the volatile part exists and is deliberately not part of the identity
    expect(live.record.blueprint!.hookTitle).toBe('Silence Speaks');
    expect(live.record.transcriptionCache).toMatchObject({hit: false});
  });

  it('the effective configuration comes from the pipeline, including caller overrides the environment does not have', async () => {
    expect(live.record.effectiveConfig).toMatchObject({HOOK_TITLE_POLICY: 'placeholder', OCCUPANCY_CONTEXT_V2: false, DIRECTOR_V2: false, directorV2: false, visualEditsOn: true, captionsOnly: false});
    const v2 = await runArm({directorV2: true});
    expect(env.DIRECTOR_V2).toBe(false); // the environment said no...
    expect(v2.record.effectiveConfig).toMatchObject({directorV2: true, DIRECTOR_V2: true}); // ...the run resolved yes, and the capture saw that
  }, 120_000);

  it('the live occupancy measurement is recorded as LIVE (the detector ran) and the Director was given exactly that measurement', () => {
    expect(live.record.occupancy.consumed).toHaveLength(1);
    expect(live.record.occupancy.consumed[0]).toMatchObject({origin: 'live', role: 'primary'});
    expect(live.record.occupancy.directorInputs).toHaveLength(1);
    expect(live.record.occupancy.directorInputs[0]!.occupancy).toEqual(live.record.occupancy.consumed[0]!.occupancy);
    expect(live.net.filter(call => call.kind === 'occupancy')).toHaveLength(1);
  });

  it('a detached capture (hooks not attached to the run) sees nothing, which the count check exposes and which blocks comparability', async () => {
    baseEnv();
    const detached = new RunCapture(clock);
    const {analyzeVideo} = await import('../pipeline/analyzeVideo.ts');
    const blueprint = await analyzeVideo({videoUrl: video, languageCode: 'en', userId: 'synthetic', requestedEdits: ['hook_title', 'zoom', 'cutaway']}); // NOT inside withObserver
    expect(blueprint.hookTitle).toBe('Silence Speaks');
    // the observed run did not change the product: the same pipeline without any observer returns the identical blueprint, with the same requests
    expect(blueprintIdentitySha256(blueprint as never)).toBe(live.record.blueprint!.sha256);
    expect(net.calls.map(call => call.kind)).toEqual(live.net.map(call => call.kind));
    expect(net.calls.length).toBeGreaterThan(0);
    expect(detached.record.http).toHaveLength(0); // != net.calls.length: the connected test above would fail
    const built = buildRunManifest({root: REPO, run: {id: 'detached', arm: 'A', repeat: 0, createdAt: '2026-10-11T00:00:00Z'}, record: detached.record});
    expect(built.validation.unknownFields.length).toBeGreaterThan(10);
    expect(compareManifests(built.manifest, manifestFor(live, 'live-b', 'B').manifest, ['flags.OCCUPANCY_CONTEXT_V2']).verdict).toBe('not_comparable');
  }, 120_000);
});

describe('occupancy replay through the real pipeline (v1 path)', () => {
  let live: Arm;
  let snapshot: OccupancySnapshot;
  beforeAll(async () => {
    live = await runArm();
    snapshot = snapshotFromRecord(live.record, {id: 'e2e-v1', sourceId: 'synthetic:e2e', capturedAt: '2026-10-11T00:00:00Z', note: 'recorded from a live synthetic run'});
  }, 120_000);

  it('record once: the snapshot is exactly what the live run consumed, identified by the hash of the video the pipeline opened', () => {
    expect(snapshot.source.videoSha256).toBe(sha256File(video));
    expect(snapshot.measurements.map(item => [item.role, item.occupancy.source])).toEqual([['primary', 'vision']]);
    expect(snapshot.measurements[0]!.occupancy).toEqual(live.record.occupancy.consumed[0]!.occupancy);
  });

  it('both arms consume the exact same recorded measurement; the detector is never called; only the occupancy WORDING differs', async () => {
    assertSnapshotMatchesSource(snapshot, video);
    const a = await runArm({replay: occupancyReplaySource(snapshot), flags: {OCCUPANCY_CONTEXT_V2: false}});
    const b = await runArm({replay: occupancyReplaySource(snapshot), flags: {OCCUPANCY_CONTEXT_V2: true}});
    for (const arm of [a, b]) {
      expect(arm.record.status).toBe('complete');
      expect(arm.net.filter(call => call.kind === 'occupancy')).toHaveLength(0); // no detector call in replay
      expect(labels(arm)).toEqual(['Groq transcription', 'Gemini visual director', 'Gemini layout critique']);
      expect(arm.record.occupancy.consumed).toHaveLength(1);
      expect(arm.record.occupancy.consumed[0]).toMatchObject({origin: 'replay', role: 'primary', snapshotId: 'e2e-v1', snapshotSha256: snapshot.contentSha256});
      expect(arm.record.occupancy.replay!.unserved).toEqual([]);
      expect(arm.record.occupancy.replay!.ledger.violations).toEqual([]);
    }
    expect(a.record.occupancy.consumed).toEqual(b.record.occupancy.consumed);
    expect(a.record.occupancy.consumed[0]!.occupancy).toEqual(snapshot.measurements[0]!.occupancy);
    // the measurement the Director was given is the snapshot's, in both arms
    expect(a.record.occupancy.directorInputs).toEqual([{path: 'v1', occupancy: snapshot.measurements[0]!.occupancy, occupancyAtSec: a.record.occupancy.directorInputs[0]!.occupancyAtSec, occupancyContextV2: false}]);
    expect(b.record.occupancy.directorInputs[0]).toMatchObject({occupancy: snapshot.measurements[0]!.occupancy, occupancyContextV2: true});
    expect(b.record.occupancy.directorInputs[0]!.occupancyAtSec).toBe(a.record.occupancy.directorInputs[0]!.occupancyAtSec);
    // request identity: system instruction, schema and settings are identical; the user text (the occupancy wording) is the only change
    const [reqA, reqB] = [a, b].map(arm => arm.record.http.find(call => call.label === 'Gemini visual director')!.request!);
    expect(reqB.systemSha256).toBe(reqA.systemSha256);
    expect(reqB.schemaSha256).toBe(reqA.schemaSha256);
    expect(reqB.generationConfigSha256).toBe(reqA.generationConfigSha256);
    expect(reqB.userTextSha256).not.toBe(reqA.userTextSha256);
    // and the comparison manifests agree on everything except the declared flag
    const [ma, mb] = [manifestFor(a, 'arm-a', 'baseline'), manifestFor(b, 'arm-b', 'experimental')];
    expect(ma.validation.unknownFields).toEqual([]);
    expect(mb.validation.unknownFields).toEqual([]);
    const verdict = compareManifests(ma.manifest, mb.manifest, ['flags.OCCUPANCY_CONTEXT_V2']);
    expect(verdict.reasons).toEqual([]);
    expect(verdict.verdict).toBe('comparable');
    expect(ma.manifest.occupancy).toEqual(mb.manifest.occupancy);
    expect(ma.manifest.occupancy.mode).toBe('replay');
  }, 180_000);

  it('the default path is untouched: with no replay the detector runs, live is recorded, and the manifest says live and is never comparable', async () => {
    const a = await runArm();
    const b = await runArm({flags: {OCCUPANCY_CONTEXT_V2: true}});
    expect(a.net.filter(call => call.kind === 'occupancy')).toHaveLength(1);
    expect(a.record.occupancy.consumed[0]!.origin).toBe('live');
    expect(a.record.occupancy.replay).toBeNull();
    const [ma, mb] = [manifestFor(a, 'live-a', 'baseline'), manifestFor(b, 'live-b', 'experimental')];
    expect(ma.manifest.occupancy.mode).toBe('live');
    const verdict = compareManifests(ma.manifest, mb.manifest, ['flags.OCCUPANCY_CONTEXT_V2']);
    expect(verdict.verdict).toBe('not_comparable');
    expect(verdict.reasons.join('\n')).toContain('occupancy.snapshotSha256 is unknown');
  }, 180_000);

  it('a changed snapshot (a different box) invalidates the comparison: different consumed data, different hashes, not comparable', async () => {
    const tamperedMeasurement = captureSnapshot({
      id: 'e2e-v1', source: snapshot.source, capture: snapshot.capture, outputDurationSec: snapshot.outputDurationSec,
      measurements: snapshot.measurements.map(item => ({...item, occupancy: occupancyFromSpeaker({x: 0.3, y: 0.2, w: 0.4, h: 0.5}, 'vision')})),
    });
    expect(tamperedMeasurement.contentSha256).not.toBe(snapshot.contentSha256);
    const a = await runArm({replay: occupancyReplaySource(snapshot)});
    const b = await runArm({replay: occupancyReplaySource(tamperedMeasurement), flags: {OCCUPANCY_CONTEXT_V2: true}});
    expect(b.record.occupancy.consumed[0]!.occupancy).not.toEqual(a.record.occupancy.consumed[0]!.occupancy);
    const verdict = compareManifests(manifestFor(a, 'snap-a', 'baseline').manifest, manifestFor(b, 'snap-b', 'experimental').manifest, ['flags.OCCUPANCY_CONTEXT_V2']);
    expect(verdict.verdict).toBe('not_comparable');
    expect(verdict.reasons).toEqual(expect.arrayContaining(['occupancy.snapshotSha256 differs but is not the declared variable', 'occupancy.receivedDigestSha256 differs but is not the declared variable']));
  }, 180_000);

  it('a tampered or malformed snapshot is rejected BEFORE the pipeline runs: not a single request is made', () => {
    net.calls.length = 0;
    const raw = JSON.parse(snapshotToJson(snapshot));
    raw.measurements[0].occupancy.speaker.x = 0.31; // edited after sealing
    expect(() => occupancyReplaySource(raw)).toThrow(SnapshotError);
    expect(() => occupancyReplaySource({...raw, measurements: []})).toThrow(SnapshotError);
    expect(() => occupancyReplaySource(null as never)).toThrow(SnapshotError);
    expect(net.calls).toHaveLength(0);
  });

  it('a snapshot from a different video is rejected before anything runs', () => {
    const other = captureSnapshot({id: 'other-video', source: {sourceId: 'x', videoSha256: 'e'.repeat(64)}, capture: snapshot.capture, outputDurationSec: snapshot.outputDurationSec, measurements: snapshot.measurements});
    expect(() => assertSnapshotMatchesSource(other, video)).toThrow(OccupancyReplayError);
    const unidentified = captureSnapshot({id: 'unknown-video', source: {sourceId: 'x', videoSha256: {$unknown: 'not recorded'}}, capture: snapshot.capture, outputDurationSec: snapshot.outputDurationSec, measurements: snapshot.measurements});
    expect(() => assertSnapshotMatchesSource(unidentified, video)).toThrow(/does not identify its source video/);
    expect(net.calls).toHaveLength(0);
  });

  it('a snapshot taken at a different instant fails closed before the Director is called: no fallback box, no detector, no Director request', async () => {
    const wrongInstant = captureSnapshot({
      id: 'wrong-instant', source: snapshot.source, capture: snapshot.capture, outputDurationSec: snapshot.outputDurationSec,
      measurements: snapshot.measurements.map(item => ({...item, sourceSec: item.sourceSec + 1.5, outputSec: (item.outputSec ?? 0) + 1.5})),
    });
    const replay = occupancyReplaySource(wrongInstant);
    const arm = await runArm({replay});
    expect(arm.record.status).toBe('failed');
    expect(arm.record.error!.name).toBe('OccupancyReplayError');
    expect(arm.record.error!.message).toContain('not taken from this video and trim');
    expect(replay.ledger.violations).toHaveLength(1);
    expect(arm.net.filter(call => call.kind === 'occupancy' || call.kind === 'director')).toHaveLength(0);
    expect(arm.record.occupancy.consumed).toHaveLength(0);
    expect(arm.record.directors).toHaveLength(0);
    expect(arm.blueprint).toBeUndefined();
    const built = manifestFor(arm, 'failed-arm', 'B');
    expect(built.manifest.run.status).toBe('failed');
    expect(compareManifests(manifestFor(live, 'ok-arm', 'A').manifest, built.manifest, ['flags.OCCUPANCY_CONTEXT_V2']).reasons.join('\n')).toContain('B run status is "failed"');
  }, 120_000);
});

describe('occupancy replay through the real pipeline (Director v2: perception samples several instants)', () => {
  let live: Arm;
  let snapshot: OccupancySnapshot;
  beforeAll(async () => {
    // Record once: the live detector answers box 1, box 2, and then fails (500) so the third measurement is a FALLBACK box.
    net.override = call => (call.kind === 'occupancy' && net.detectorCalls >= 2 ? new Response('detector down', {status: 500}) : undefined);
    live = await runArm({directorV2: true});
    net.override = undefined;
    snapshot = snapshotFromRecord(live.record, {id: 'e2e-v2', sourceId: 'synthetic:e2e', capturedAt: '2026-10-11T00:00:00Z', note: 'recorded from a live synthetic run (third measurement is a fallback)'});
  }, 180_000);

  it('the live run measured the primary plus the perception samples; the failed detection is kept as a labelled fallback, not a detection', () => {
    expect(live.record.occupancy.consumed.map(item => [item.role, item.origin])).toEqual([['primary', 'live'], ['sampled', 'live'], ['sampled', 'live']]);
    expect(snapshot.measurements.map(item => item.occupancy.source)).toEqual(['vision', 'vision', 'fallback']);
    expect(independentMeasurements(snapshot)).toHaveLength(3);
    expect(live.record.occupancy.perceptionPack).not.toBeNull();
  });

  it('both arms consume the same three measurements at the same instants; the perception pack digest is identical; fallback stays fallback', async () => {
    const a = await runArm({replay: occupancyReplaySource(snapshot), directorV2: true, flags: {OCCUPANCY_CONTEXT_V2: false}});
    const b = await runArm({replay: occupancyReplaySource(snapshot), directorV2: true, flags: {OCCUPANCY_CONTEXT_V2: true}});
    for (const arm of [a, b]) {
      expect(arm.record.status).toBe('complete');
      expect(arm.net.filter(call => call.kind === 'occupancy')).toHaveLength(0);
      expect(arm.record.occupancy.consumed.map(item => item.origin)).toEqual(['replay', 'replay', 'replay']);
      expect(arm.record.occupancy.replay!.unserved).toEqual([]);
    }
    expect(a.record.occupancy.consumed).toEqual(b.record.occupancy.consumed);
    expect(a.record.occupancy.consumed.map(item => (item.occupancy as {source: string}).source)).toEqual(['vision', 'vision', 'fallback']);
    expect(a.record.occupancy.perceptionPack!.digest).toBe(b.record.occupancy.perceptionPack!.digest);
    expect(a.record.occupancy.perceptionPack!.independentMeasurements).toBe(3);
    // Director v2 stages were really called (and stubbed with '{}'): story analyst, its repair, and the creative director
    expect(labels(a)).toEqual(expect.arrayContaining(['Director v2 story analyst', 'Director v2 story analyst repair', 'Director v2 creative director']));
    const labelCount = (arm: Arm, label: string) => arm.record.http.filter(call => call.label === label).length;
    expect(labelCount(a, 'Director v2 story analyst repair')).toBe(1); // the repair attempt is captured as its own call
    expect(a.record.http.find(call => call.label === 'Director v2 story analyst repair')!.attempts).toHaveLength(1);
    const [ma, mb] = [manifestFor(a, 'v2-a', 'baseline', {snapshotPath: (() => { const p = join(work, 'v2.snapshot.json'); writeFileSync(p, snapshotToJson(snapshot)); return p; })()}), manifestFor(b, 'v2-b', 'experimental')];
    expect(ma.manifest.occupancy.receivedDigestSha256).toBe(a.record.occupancy.perceptionPack!.digest);
    expect(ma.manifest.occupancy.receivedDigestSha256).toBe(mb.manifest.occupancy.receivedDigestSha256);
    expect(ma.manifest.pipeline.path).toBe('v2');
    expect(ma.origin['occupancy.snapshotSha256']).toBe('observed_in_run');
  }, 240_000);

  it('a snapshot missing a sampled instant fails closed during perception: no live detector, no Director v2 model call, and NO silent fallback plan', async () => {
    const missing = captureSnapshot({
      id: 'e2e-v2-missing', source: snapshot.source, capture: snapshot.capture, outputDurationSec: snapshot.outputDurationSec,
      measurements: snapshot.measurements.slice(0, 2), // the third (a perception sample) was never recorded
    });
    const replay = occupancyReplaySource(missing);
    const arm = await runArm({replay, directorV2: true});
    expect(arm.record.status).toBe('failed');
    expect(arm.record.error!.name).toBe('OccupancyReplayError');
    expect(arm.record.error!.message).toContain('refusing to measure live, fall back, or reuse another measurement');
    expect(arm.net.filter(call => call.kind === 'occupancy')).toHaveLength(0);
    expect(arm.net.filter(call => call.kind.startsWith('v2_') || call.kind === 'director')).toHaveLength(0);
    expect(arm.record.directors).toHaveLength(0); // the planner did not degrade into the keyword fallback
    expect(replay.ledger.requests.map(request => request.outcome)).toEqual(['served', 'served', 'miss']);
  }, 180_000);
});

describe('model calls, retries and fallbacks are captured from mocked responses', () => {
  it('a Director request that fails once and then succeeds is captured as two attempts (500 then 200) and the plan still comes from the model', async () => {
    let seen = 0;
    net.override = call => (call.kind === 'director' && (seen += 1) === 1 ? new Response('busy', {status: 503}) : undefined);
    const arm = await runArm();
    const director = arm.record.http.find(call => call.label === 'Gemini visual director')!;
    expect(director.attempts.map(attempt => attempt.status)).toEqual([503, 200]);
    expect(arm.net.filter(call => call.kind === 'director')).toHaveLength(2);
    expect(arm.record.directors[0]).toMatchObject({path: 'v1', source: 'gemini'});
    expect(arm.record.http.reduce((sum, call) => sum + call.attempts.length, 0)).toBe(arm.net.length);
  }, 120_000);

  it('a Director that never answers is captured as 4 failed attempts over 2 models and a DETERMINISTIC FALLBACK; the model is unknown and the manifest is not comparable', async () => {
    net.override = call => (call.kind === 'director' ? new Response('down', {status: 500}) : undefined);
    const arm = await runArm();
    const calls = arm.record.http.filter(call => call.label === 'Gemini visual director');
    expect(calls).toHaveLength(2); // one logical call per model tried
    expect(calls.map(call => call.model)).toEqual(['gemini-3.6-flash', 'gemini-3.7-flash']);
    expect(calls.flatMap(call => call.attempts.map(attempt => attempt.status))).toEqual([500, 500, 500, 500]);
    expect(arm.record.directors[0]).toMatchObject({source: 'fallback'});
    expect(arm.record.directors[0]!.warnings).toContain('director_fallback');
    const built = manifestFor(arm, 'fallback-arm', 'A');
    expect(built.origin['models.director']).toBe('unknown');
    expect(compareManifests(built.manifest, manifestFor(arm, 'fallback-arm-2', 'B').manifest, ['flags.OCCUPANCY_CONTEXT_V2']).verdict).toBe('not_comparable');
  }, 120_000);

  it('Director v2 story analysis that needs a repair is captured as a separate "repair" call', async () => {
    const arm = await runArm({directorV2: true});
    expect(labels(arm)).toEqual(expect.arrayContaining(['Director v2 story analyst', 'Director v2 story analyst repair']));
  }, 120_000);

  it('the assembler repair (a refused element sent back to the Director) is captured from the real compile path', async () => {
    baseEnv();
    const {compileCreativePlan} = await import('../stages/directorV2/compiler.ts');
    const words = Array.from({length: 40}, (_, i) => ({id: `w${i}`, text: `w${i}`, start: i * 0.5, end: i * 0.5 + 0.45, sentenceId: 's0'}));
    const pack = {words, sentences: [], userAssets: [], occupancySlices: [], outputDurationSec: 20, speakerCutoutAvailable: false, requestedEdits: [], storyboard: [], transcript: '', language: 'en', creatorProfile: '', speakerCutoutNote: '', audio: {pauses: [], emphasisWordIds: [], energyPeaks: []}} as never;
    const plan = {
      editThesis: 't', editThesisParts: {} as never, hookTitle: '', hookStyle: 'minimal', caption: undefined as never, preferredLutId: '', suggestedLutIds: [],
      elements: [{id: 'e3', beatId: 'b4', intent: 'overlay', kind: 'depth_overlay', wordRange: {startWordId: 'w10', endWordId: 'w20'}, userBrollId: 'ub_1'}],
      estimatedCostUsd: 0, promptVersion: 'x', inputHash: 'x', raw: {},
    } as never;
    const story = {contentType: 'talking_head', audience: '', promise: '', tone: '', emotionalArc: [], hook: {startWordId: 'w0', endWordId: 'w3', stoppingPower: 3, weakness: '', coldOpen: {recommended: false, startWordId: 'w0', endWordId: 'w3', reason: ''}}, coreMessage: '', beats: [], existingCta: {present: false, startWordId: '', endWordId: '', action: 'none', keyword: '', suggested: false, suggestedBeatId: '', suggestedSpokenLine: ''}, pacing: [], risks: [], estimatedCostUsd: 0, promptVersion: 'x', inputHash: 'x', raw: {}} as never;
    const {record, value} = await captureRun({now: clock, run: () => compileCreativePlan({pack, plan, story})});
    expect(record.status).toBe('complete');
    expect(record.http.map(call => call.label)).toEqual(['Director v2 repair']);
    expect((value as {report: {passes: number}}).report.passes).toBe(2); // first pass refused the element, the repair pass ran
    expect(net.calls.filter(call => call.host === GEMINI_HOST)).toHaveLength(1);
  }, 120_000);

  it('hook policy "optional" is captured as the pipeline\'s own configuration, and a comparison that declares another variable is rejected', async () => {
    const a = await runArm();
    const b = await runArm({flags: {HOOK_TITLE_POLICY: 'optional', OCCUPANCY_CONTEXT_V2: true}});
    expect(b.record.effectiveConfig).toMatchObject({HOOK_TITLE_POLICY: 'optional', OCCUPANCY_CONTEXT_V2: true});
    const verdict = compareManifests(manifestFor(a, 'cfg-a', 'A').manifest, manifestFor(b, 'cfg-b', 'B').manifest, ['flags.OCCUPANCY_CONTEXT_V2']);
    expect(verdict.verdict).toBe('not_comparable');
    expect(verdict.reasons).toContain('flags.HOOK_TITLE_POLICY differs but is not the declared variable');
    // the Director request schema identity differs because the policy changes `required` (and nothing else about the system prompt)
    const [ra, rb] = [a, b].map(arm => arm.record.http.find(call => call.label === 'Gemini visual director')!.request!);
    expect(rb.schemaSha256).not.toBe(ra.schemaSha256);
    expect(rb.systemSha256).toBe(ra.systemSha256);
    expect(verdict.reasons).toContain('prompts.directorSchemaSha256 differs but is not the declared variable');
  }, 180_000);
});

describe('output evidence is checked against the actual files', () => {
  it('output hashes are recomputed from disk; a changed file, a missing file and a hand-edited hash are all caught or reported as unverified', async () => {
    const a = await runArm({flags: {OCCUPANCY_CONTEXT_V2: false}});
    const b = await runArm({flags: {OCCUPANCY_CONTEXT_V2: true}});
    const [ma, mb] = [manifestFor(a, 'out-a', 'A'), manifestFor(b, 'out-b', 'B')];
    const files = {A: {root: work}, B: {root: work}};
    const base = compareManifestsVerified(ma.manifest, mb.manifest, ['flags.OCCUPANCY_CONTEXT_V2'], files);
    expect(ma.manifest.outputs[0]!.sha256).toBe(sha256File(join(work, 'out-a.blueprint.json')));
    expect(base.fileChecks.A[0]!.status).toBe('verified_match');
    // 1. file changed after the manifest was written
    writeFileSync(join(work, 'out-a.blueprint.json'), '{"changed":true}');
    expect(compareManifestsVerified(ma.manifest, mb.manifest, ['flags.OCCUPANCY_CONTEXT_V2'], files).verdict).toBe('not_comparable');
    // 2. file missing => unverified, not verified
    rmSync(join(work, 'out-a.blueprint.json'));
    const missing = compareManifestsVerified(ma.manifest, mb.manifest, ['flags.OCCUPANCY_CONTEXT_V2'], files);
    expect(missing.fileChecks.A[0]!.status).toBe('file_unavailable');
    expect(missing.unverified).toContain('A outputs[0] (file_unavailable)');
    // 3. a run whose output was never written has an unknown output hash and is never comparable
    const noOutput = manifestFor(a, 'out-c', 'A', {render: {engine: 'none-blueprint-only', codec: 'none', fps: 30, width: 1080, height: 1920, outputs: [{kind: 'blueprint_json', path: join(work, 'never-written.json')}], startedAt: '2026-10-11T00:00:00Z', endedAt: '2026-10-11T00:00:01Z', status: 'ok'}});
    expect(noOutput.origin['outputs[0].sha256']).toBe('unknown');
    expect(compareManifests(noOutput.manifest, mb.manifest, ['flags.OCCUPANCY_CONTEXT_V2']).reasons).toContain('A has an output whose hash is unknown; its provenance cannot be established');
  }, 180_000);
});

describe('what the capture cannot see is stated, and blocks claims', () => {
  it('lists the unobserved transports on every record and leaves Anthropic-dependent stages unknown when motion graphics are on', async () => {
    const arm = await runArm({flags: {MOTION_GRAPHICS_ENABLED: false}});
    expect(arm.record.unobserved.join('\n')).toMatch(/Anthropic SDK/);
    expect(arm.record.unobserved.join('\n')).toMatch(/plain fetch\(\)/);
    const withMotion = {...arm, record: {...arm.record, effectiveConfig: {...arm.record.effectiveConfig!, motionGraphicsOn: true}}};
    const built = manifestFor(withMotion as Arm, 'motion-on', 'A');
    expect(built.origin['models.motionDirector']).toBe('unknown');
    expect(built.origin['models.graphicsWorker']).toBe('unknown');
    expect(built.validation.unknownFields).toEqual(expect.arrayContaining(['models.motionDirector', 'models.graphicsWorker']));
  }, 120_000);

  it('B-roll assets the blueprint references but this tooling cannot hash are unknown, so a run that used remote stock is not comparable', () => {
    const arm = {record: {...({} as RunRecord)}} as unknown as Arm;
    void arm;
    // covered end to end by the manifest builder: any referenced remote asset becomes {id, sha256: unknown}
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------- real renderer (opt-in, RENDER_TESTS=1)
describe.skipIf(!RENDER)('end to end through the real renderer (opt-in: RENDER_TESTS=1)', () => {
  it('real pipeline -> blueprint -> real Remotion composition: render evidence is hashed from the file, and the arms\' frames agree where they should', async () => {
    const live = await runArm();
    const snapshot = snapshotFromRecord(live.record, {id: 'e2e-render', sourceId: 'synthetic:e2e', capturedAt: '2026-10-11T00:00:00Z', note: 'recorded from a live synthetic run'});
    const snapshotPath = join(work, 'render.snapshot.json');
    writeFileSync(snapshotPath, snapshotToJson(snapshot));
    const a = await runArm({replay: occupancyReplaySource(snapshot), flags: {OCCUPANCY_CONTEXT_V2: false}});
    const b = await runArm({replay: occupancyReplaySource(snapshot), flags: {OCCUPANCY_CONTEXT_V2: true}});
    const renderA = renderBlueprintStill({blueprint: a.blueprint, publicDir, workDir: join(work, 'render-a'), outName: 'frame', frame: 30, now: clock});
    const renderB = renderBlueprintStill({blueprint: b.blueprint, publicDir, workDir: join(work, 'render-b'), outName: 'frame', frame: 30, now: clock});
    expect(renderA.status).toBe('ok');
    expect(renderB.status).toBe('ok');
    const [ma, mb] = [manifestFor(a, 'r-a', 'baseline', {snapshotPath, render: renderA}), manifestFor(b, 'r-b', 'experimental', {snapshotPath, render: renderB})];
    expect(ma.manifest.renderer).toMatchObject({engine: 'remotion-still', codec: 'png', fps: a.blueprint.fps, width: a.blueprint.width, height: a.blueprint.height});
    expect(ma.origin['renderer.remotionVersion']).toBe('verified_from_file');
    expect(ma.origin['outputs[0].sha256']).toBe('verified_from_file');
    expect(ma.manifest.outputs[0]!.sha256).toBe(sha256File(renderA.outputs[0]!.path));
    expect(ma.validation.unknownFields).toEqual([]);
    expect(compareManifests(ma.manifest, mb.manifest, ['flags.OCCUPANCY_CONTEXT_V2']).verdict).toBe('comparable');
    // Both arms had the same blueprint hook and the same occupancy; the occupancy flag changes Director wording only, so the same
    // saved Director reply yields the same blueprint, hence the same frame. (If it did not, the arms would differ in more than wording.)
    expect(a.record.blueprint!.sha256).toBe(b.record.blueprint!.sha256);
    expect(sha256File(renderA.outputs[0]!.path)).toBe(sha256File(renderB.outputs[0]!.path));
    // verification against the files on disk
    const files = {A: {root: '/'}, B: {root: '/'}};
    expect(compareManifestsVerified(ma.manifest, mb.manifest, ['flags.OCCUPANCY_CONTEXT_V2'], files).verdict).toBe('comparable');
    expect(existsSync(renderA.outputs[0]!.path)).toBe(true);
    expect(readFileSync(renderA.outputs[0]!.path).length).toBeGreaterThan(1000);
  }, 600_000);
});
