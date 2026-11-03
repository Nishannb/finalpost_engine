/**
 * Occupancy snapshot + replay boundary (offline experiment tooling; NOT used by production, no model, no network).
 *
 * Why: speaker occupancy is itself measured by a model (Gemini vision) that can fail and fall back to a default box, so two live
 * runs can differ in the MEASUREMENT, not only in how the measurement is described. To compare occupancy WORDINGS fairly, the
 * measurements are captured once, hashed, and replayed identically to both arms.
 *
 * What a snapshot preserves, exactly as measured (nothing is derived or "improved"):
 *   - each measurement's instants (source seconds as requested, output seconds as placed or `null` when it fell in a trimmed
 *     silence), and the full `Occupancy` object the engine consumes (speaker box, side, anchors, `source: vision | fallback`);
 *   - which measurement is the primary one, and which entries are REPEATS of an earlier measurement (not independent evidence);
 *   - the source identity (id and hash or an explicit unknown) and how the snapshot was made.
 * What it deliberately cannot say: a face box (the engine has no face detector, so any face box is an estimate computed later and
 * is rejected here), confidence, or anything about times that were not measured (those stay unknown).
 *
 * A malformed or incomplete snapshot is REJECTED with reasons; nothing is filled in, defaulted or repaired.
 */
import {existsSync, readFileSync, statSync} from 'node:fs';

import {occupancyFromSpeaker, type Occupancy} from '../stages/layout/occupancy.ts';
import {OccupancyReplayError, type OccupancyReplaySource} from '../stages/layout/occupancyReplay.ts';
import {sha256} from './baseline.ts';
import {isUnknown, stable, type Unknown} from './runManifest.ts';

export type SnapshotMeasurement = {
  id: string;
  /** `primary` = the single frame analyzeVideo measures before planning; `sampled` = the extra frames perception measures. */
  role: 'primary' | 'sampled';
  /** Second in the decoded source file that was measured (what `measureOccupancyAt` is asked for). */
  sourceSec: number;
  /** Where that instant sits on the output timeline; `null` = it lies in a trimmed silence and cannot be placed. */
  outputSec: number | null;
  /** The measured result, exactly as the engine consumes it. */
  occupancy: Occupancy;
  /** Present only on a REPEAT of an earlier independent measurement (same instant, same value). Never independent evidence. */
  repeatOf?: string;
};

export type OccupancySnapshot = {
  snapshotVersion: 1;
  id: string;
  source: {sourceId: string; videoSha256: string | Unknown};
  capture: {method: 'synthetic' | 'recorded'; capturedAt: string; note: string};
  outputDurationSec: number;
  measurements: SnapshotMeasurement[];
  /** SHA-256 over the canonical form of everything above. */
  contentSha256: string;
};

export type SnapshotProblem = {path: string; reason: string};

export class SnapshotError extends Error {
  readonly problems: SnapshotProblem[];

  constructor(problems: SnapshotProblem[]) {
    super(`invalid occupancy snapshot: ${problems.map(item => `${item.path}: ${item.reason}`).join('; ')}`);
    this.problems = problems;
  }
}

const SHA256 = /^[0-9a-f]{64}$/;
const TOP_KEYS = ['snapshotVersion', 'id', 'source', 'capture', 'outputDurationSec', 'measurements', 'contentSha256'];
const MEASUREMENT_KEYS = ['id', 'role', 'sourceSec', 'outputSec', 'occupancy', 'repeatOf'];
const OCCUPANCY_KEYS = ['speaker', 'preferredSide', 'graphicAnchor', 'overlayAnchor', 'source'];
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isNum = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const EPS = 1e-9;

/** The canonical content hash of a snapshot (its own `contentSha256` field is excluded). */
export function snapshotContentHash(snapshot: Omit<OccupancySnapshot, 'contentSha256'> | OccupancySnapshot): string {
  const {contentSha256: _ignored, ...rest} = snapshot as OccupancySnapshot;
  return sha256(stable(rest));
}

/** Strictly validate an untrusted value. Returns every problem found; never repairs anything. */
export function validateSnapshot(raw: unknown): SnapshotProblem[] {
  const problems: SnapshotProblem[] = [];
  const bad = (path: string, reason: string) => problems.push({path, reason});
  if (!isObject(raw)) {
    return [{path: '', reason: 'must be an object'}];
  }
  for (const key of Object.keys(raw)) {
    if (!TOP_KEYS.includes(key)) {
      bad(key, key === 'face' ? 'face boxes are not part of a snapshot (the engine has no face detector; any face box would be an estimate)' : 'unexpected field');
    }
  }
  if (raw.snapshotVersion !== 1) {
    bad('snapshotVersion', 'must be 1');
  }
  if (!nonEmpty(raw.id)) {
    bad('id', 'must be a non-empty string');
  }
  const source = raw.source;
  if (!isObject(source)) {
    bad('source', 'must be an object {sourceId, videoSha256}');
  } else {
    for (const key of Object.keys(source)) {
      if (!['sourceId', 'videoSha256'].includes(key)) {
        bad(`source.${key}`, 'unexpected field');
      }
    }
    if (!nonEmpty(source.sourceId)) {
      bad('source.sourceId', 'must be a non-empty string');
    }
    if (isUnknown(source.videoSha256)) {
      if (!nonEmpty(source.videoSha256.$unknown)) {
        bad('source.videoSha256', 'an unknown value must give a non-empty reason');
      }
    } else if (typeof source.videoSha256 !== 'string' || !SHA256.test(source.videoSha256)) {
      bad('source.videoSha256', 'must be a 64-character lowercase hexadecimal SHA-256 or an explicit {$unknown}');
    }
  }
  const capture = raw.capture;
  if (!isObject(capture)) {
    bad('capture', 'must be an object {method, capturedAt, note}');
  } else {
    for (const key of Object.keys(capture)) {
      if (!['method', 'capturedAt', 'note'].includes(key)) {
        bad(`capture.${key}`, 'unexpected field');
      }
    }
    if (capture.method !== 'synthetic' && capture.method !== 'recorded') {
      bad('capture.method', 'must be "synthetic" or "recorded"');
    }
    if (typeof capture.capturedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(capture.capturedAt) || Number.isNaN(Date.parse(capture.capturedAt))) {
      bad('capture.capturedAt', 'must be an ISO-8601 timestamp');
    }
    if (typeof capture.note !== 'string') {
      bad('capture.note', 'must be a string');
    }
  }
  const duration = raw.outputDurationSec;
  if (!isNum(duration) || duration <= 0) {
    bad('outputDurationSec', 'must be a finite number > 0');
  }
  if (typeof raw.contentSha256 !== 'string' || !SHA256.test(raw.contentSha256)) {
    bad('contentSha256', 'must be a 64-character lowercase hexadecimal SHA-256');
  }

  const measurements = raw.measurements;
  if (!Array.isArray(measurements) || measurements.length === 0) {
    bad('measurements', 'must be a non-empty list: a snapshot with no measurement states nothing, and nothing is invented for it');
  } else {
    const seenIds = new Map<string, number>();
    const independentSource = new Map<number, string>();
    const independentOutput = new Map<number, string>();
    let primaries = 0;
    measurements.forEach((entry, index) => {
      const at = `measurements[${index}]`;
      if (!isObject(entry)) {
        bad(at, 'must be an object');
        return;
      }
      for (const key of Object.keys(entry)) {
        if (!MEASUREMENT_KEYS.includes(key)) {
          bad(`${at}.${key}`, key === 'face' ? 'face boxes are not part of a snapshot (any face box would be an estimate, not a measurement)' : 'unexpected field');
        }
      }
      if (!nonEmpty(entry.id)) {
        bad(`${at}.id`, 'must be a non-empty string');
      } else if (seenIds.has(entry.id)) {
        bad(`${at}.id`, `duplicate id ${entry.id}`);
      } else {
        seenIds.set(entry.id, index);
      }
      if (entry.role !== 'primary' && entry.role !== 'sampled') {
        bad(`${at}.role`, 'must be "primary" or "sampled"');
      }
      if (!isNum(entry.sourceSec) || entry.sourceSec < 0) {
        bad(`${at}.sourceSec`, 'must be a finite number >= 0');
      }
      if (entry.outputSec !== null && (!isNum(entry.outputSec) || entry.outputSec < 0 || (isNum(duration) && entry.outputSec > duration + EPS))) {
        bad(`${at}.outputSec`, 'must be null (not placeable) or a time within [0, outputDurationSec]');
      }
      const occupancy = entry.occupancy;
      if (!isObject(occupancy)) {
        bad(`${at}.occupancy`, 'must be the full Occupancy object');
      } else {
        for (const key of Object.keys(occupancy)) {
          if (!OCCUPANCY_KEYS.includes(key)) {
            bad(`${at}.occupancy.${key}`, key === 'face' ? 'face boxes are not part of a snapshot' : 'unexpected field');
          }
        }
        const speaker = occupancy.speaker;
        const rectOk = isObject(speaker) && ['x', 'y', 'w', 'h'].every(key => isNum(speaker[key]));
        if (!rectOk) {
          bad(`${at}.occupancy.speaker`, 'must be {x, y, w, h}, all finite numbers');
        } else {
          const r = speaker as Record<'x' | 'y' | 'w' | 'h', number>;
          if (r.x < 0 || r.y < 0 || r.w <= 0 || r.h <= 0 || r.x + r.w > 1 + EPS || r.y + r.h > 1 + EPS) {
            bad(`${at}.occupancy.speaker`, 'must be a normalized box inside the frame (x,y >= 0; w,h > 0; x+w <= 1; y+h <= 1)');
          }
        }
        if (occupancy.source !== 'vision' && occupancy.source !== 'fallback') {
          bad(`${at}.occupancy.source`, 'must be "vision" or "fallback" (a missing source would hide whether this was detected)');
        }
        if (rectOk && (occupancy.source === 'vision' || occupancy.source === 'fallback') && stable(occupancyFromSpeaker(speaker as never, occupancy.source)) !== stable(occupancy)) {
          bad(`${at}.occupancy`, 'derived fields (preferredSide, anchors) do not match the speaker box and source: the recorded Occupancy is not what the engine would produce');
        }
      }
      if (entry.role === 'primary') {
        primaries += 1;
      }
      if (entry.repeatOf !== undefined) {
        if (!nonEmpty(entry.repeatOf)) {
          bad(`${at}.repeatOf`, 'must be a non-empty id');
        } else {
          const targetIndex = seenIds.get(entry.repeatOf);
          const target = targetIndex === undefined ? undefined : measurements[targetIndex];
          if (!isObject(target)) {
            bad(`${at}.repeatOf`, `refers to ${entry.repeatOf}, which is not an earlier measurement`);
          } else if (target.repeatOf !== undefined) {
            bad(`${at}.repeatOf`, 'a repeat of a repeat: refer to the original independent measurement');
          } else if (target.sourceSec !== entry.sourceSec || target.outputSec !== entry.outputSec || stable(target.occupancy) !== stable(entry.occupancy)) {
            bad(`${at}.repeatOf`, 'a repeat must have the same instants and the same value as the measurement it repeats; a different value is a different observation and is not supported');
          }
        }
        if (entry.role === 'primary') {
          bad(`${at}.role`, 'a repeat cannot be the primary measurement');
        }
      } else {
        if (isNum(entry.sourceSec)) {
          const clash = independentSource.get(entry.sourceSec);
          if (clash !== undefined) {
            bad(`${at}.sourceSec`, `two independent measurements at the same source instant (${clash}); a duplicate must say repeatOf so it is not counted as separate evidence`);
          }
          independentSource.set(entry.sourceSec, String(entry.id));
        }
        if (isNum(entry.outputSec)) {
          const clash = independentOutput.get(entry.outputSec);
          if (clash !== undefined) {
            bad(`${at}.outputSec`, `two independent measurements at the same output instant (${clash}); a duplicate must say repeatOf`);
          }
          independentOutput.set(entry.outputSec, String(entry.id));
        }
      }
    });
    if (primaries > 1) {
      bad('measurements', 'at most one measurement may be the primary');
    }
  }
  if (problems.length === 0 && snapshotContentHash(raw as unknown as OccupancySnapshot) !== raw.contentSha256) {
    bad('contentSha256', 'does not match the snapshot content: it was edited after capture, or the hash is wrong');
  }
  return problems;
}

export function parseSnapshot(raw: unknown): {ok: true; snapshot: OccupancySnapshot} | {ok: false; problems: SnapshotProblem[]} {
  const problems = validateSnapshot(raw);
  return problems.length === 0 ? {ok: true, snapshot: raw as OccupancySnapshot} : {ok: false, problems};
}

export type CaptureInput = Omit<OccupancySnapshot, 'snapshotVersion' | 'contentSha256'>;

/** Build a snapshot from measurements that were ALREADY made (by a recorded detection run or a synthetic fixture) and seal it. */
export function captureSnapshot(input: CaptureInput): OccupancySnapshot {
  const unsealed = {snapshotVersion: 1 as const, ...JSON.parse(stable(input))};
  // Key order is irrelevant to the hash (stable() sorts); keep a fixed order for readable files.
  const snapshot = {...unsealed, contentSha256: snapshotContentHash(unsealed)} as OccupancySnapshot;
  const problems = validateSnapshot(snapshot);
  if (problems.length > 0) {
    throw new SnapshotError(problems);
  }
  return snapshot;
}

export function snapshotToJson(snapshot: OccupancySnapshot): string {
  return JSON.stringify(JSON.parse(stable(snapshot)), null, 1);
}

export function loadSnapshotFile(path: string): OccupancySnapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new SnapshotError([{path, reason: `cannot be read as JSON (${error instanceof Error ? error.message : 'error'})`}]);
  }
  const parsed = parseSnapshot(raw);
  if (!parsed.ok) {
    throw new SnapshotError(parsed.problems);
  }
  return parsed.snapshot;
}

/** Measurements that count as independent observations (repeats excluded). */
export const independentMeasurements = (snapshot: OccupancySnapshot): SnapshotMeasurement[] => snapshot.measurements.filter(item => item.repeatOf === undefined);
export const repeatMeasurements = (snapshot: OccupancySnapshot): SnapshotMeasurement[] => snapshot.measurements.filter(item => item.repeatOf !== undefined);
export const primaryMeasurement = (snapshot: OccupancySnapshot): SnapshotMeasurement | null => snapshot.measurements.find(item => item.role === 'primary') ?? null;

type Slice = {atSec: number; occupancy: Occupancy};
export type PackOccupancy = {
  occupancySlices: Slice[];
  occupancyMeasured: Slice[];
  occupancyMeasurements: Array<{atSec: number; source: 'vision' | 'fallback'}>;
  outputDurationSec: number;
};

/**
 * The occupancy part of the perception pack that the engine builds from these measurements: the INDEPENDENT, PLACED measurements
 * (sorted by output time) and the dense 0.5 s nearest-neighbour copies of them. Mirrors `buildPerceptionPack`; the fidelity test
 * runs the real function against a replay of the same snapshot and requires the two to match.
 */
export function packOccupancyFromSnapshot(snapshot: OccupancySnapshot): PackOccupancy {
  const placed = independentMeasurements(snapshot)
    .filter(item => item.outputSec !== null)
    .map(item => ({atSec: item.outputSec as number, occupancy: structuredClone(item.occupancy)}))
    .sort((a, b) => a.atSec - b.atSec);
  const dense: Slice[] = [];
  for (let t = 0; placed.length > 0 && t <= snapshot.outputDurationSec + 0.001; t += 0.5) {
    const nearest = placed.reduce((best, slice) => (Math.abs(slice.atSec - t) < Math.abs(best.atSec - t) ? slice : best));
    dense.push({atSec: Number(t.toFixed(2)), occupancy: nearest.occupancy});
  }
  return {
    occupancySlices: dense,
    occupancyMeasured: placed,
    occupancyMeasurements: placed.map(slice => ({atSec: slice.atSec, source: slice.occupancy.source})),
    outputDurationSec: snapshot.outputDurationSec,
  };
}

export class SnapshotReplayError extends Error {}

/**
 * A stand-in for `measureOccupancyAt` that serves ONLY recorded measurements. A request for an instant the snapshot did not record
 * throws: it never measures, never falls back to a default box and never reuses the nearest measurement. Each reply is a deep
 * copy, so one arm cannot change what another arm receives. Wire it in with vi.mock in tests; production does not import it.
 */
export function replayMeasurer(snapshot: OccupancySnapshot, options: {toleranceSec?: number} = {}) {
  const tolerance = options.toleranceSec ?? 1e-6;
  const sampled = independentMeasurements(snapshot).filter(item => item.role === 'sampled');
  const requests: number[] = [];
  const served = new Set<string>();
  return {
    requests,
    measure: async (input: {atSec: number}): Promise<Occupancy> => {
      requests.push(input.atSec);
      const match = sampled.find(item => Math.abs(item.sourceSec - input.atSec) <= tolerance);
      if (!match) {
        throw new SnapshotReplayError(`snapshot ${snapshot.id} has no recorded measurement at source time ${input.atSec}: refusing to measure live, fall back, or reuse another measurement`);
      }
      served.add(match.id);
      return structuredClone(match.occupancy);
    },
    /** Recorded sampled measurements that were never requested (a replay that does not use the whole snapshot is suspect). */
    unserved: () => sampled.filter(item => !served.has(item.id)).map(item => item.id),
  };
}

/** The primary measurement as `buildPerceptionPack({primaryOccupancy})` and the v1 planner receive it, or null. */
export function primaryOccupancyInput(snapshot: OccupancySnapshot): {occupancy: Occupancy; outputSec: number | null} | null {
  const primary = primaryMeasurement(snapshot);
  return primary ? {occupancy: structuredClone(primary.occupancy), outputSec: primary.outputSec} : null;
}

/** Digest of the occupancy data an arm actually received, taken from the pack object itself. */
export function occupancyInputDigest(pack: {occupancySlices: Slice[]; occupancyMeasured?: Slice[]; occupancyMeasurements?: Array<{atSec: number; source: string}>; measuredOccupancy?: Slice[]; outputDurationSec: number}): string {
  return sha256(stable({
    occupancySlices: pack.occupancySlices.map(slice => ({atSec: slice.atSec, occupancy: slice.occupancy})),
    occupancyMeasured: pack.occupancyMeasured?.map(slice => ({atSec: slice.atSec, occupancy: slice.occupancy})) ?? null,
    occupancyMeasurements: pack.occupancyMeasurements ?? null,
    measuredOccupancy: pack.measuredOccupancy?.map(slice => ({atSec: slice.atSec, occupancy: slice.occupancy})) ?? null,
    outputDurationSec: pack.outputDurationSec,
  }));
}

export type ArmCheck = {
  /** True only when every arm received exactly the snapshot's data and the arms agree with each other. */
  identical: boolean;
  problems: string[];
  digests: Record<string, string>;
  expectedDigest: string;
  /** Independent measurements each arm saw (repeats and dense copies excluded). */
  independentSeen: Record<string, number>;
};

/**
 * Verify, BEFORE interpreting any output difference, that every arm received the snapshot's occupancy and nothing else:
 * equal digests across arms, equal to the digest of what the snapshot should produce, the same independent-measurement count, and
 * every measured entry traceable to a snapshot measurement. Any problem means the occupancy comparison is invalid.
 */
/** One run's received occupancy against the snapshot it claims to have replayed. Problems mean the claim is not supported. */
export function checkPackMatchesSnapshot(snapshot: OccupancySnapshot, pack: Parameters<typeof occupancyInputDigest>[0], label = 'run'): {matches: boolean; problems: string[]; digest: string; independentSeen: number} {
  const check = checkArmsReceivedSnapshot(snapshot, [{label, pack}, {label: `${label} (copy)`, pack}]);
  const problems = check.problems.filter(problem => problem.includes(`arm ${label} `) || problem.includes(`arm ${label}\u0020`)).map(problem => problem.replace(`arm ${label}`, label));
  return {matches: problems.length === 0, problems, digest: check.digests[label]!, independentSeen: check.independentSeen[label]!};
}

export function checkArmsReceivedSnapshot(snapshot: OccupancySnapshot, arms: Array<{label: string; pack: Parameters<typeof occupancyInputDigest>[0]}>): ArmCheck {
  const problems: string[] = [];
  const expected = packOccupancyFromSnapshot(snapshot);
  const expectedDigest = occupancyInputDigest(expected);
  const independent = independentMeasurements(snapshot).filter(item => item.outputSec !== null);
  const digests: Record<string, string> = {};
  const independentSeen: Record<string, number> = {};
  if (arms.length < 2) {
    problems.push('an occupancy comparison needs at least two arms');
  }
  for (const arm of arms) {
    digests[arm.label] = occupancyInputDigest(arm.pack);
    const measured = arm.pack.occupancyMeasured ?? [];
    independentSeen[arm.label] = measured.length;
    if (digests[arm.label] !== expectedDigest) {
      problems.push(`arm ${arm.label} did not receive the snapshot's occupancy data (digest differs from the snapshot's)`);
    }
    if (measured.length !== independent.length) {
      problems.push(`arm ${arm.label} saw ${measured.length} independent measurements; the snapshot has ${independent.length}`);
    }
    for (const slice of measured) {
      const source = independent.find(item => item.outputSec === slice.atSec && stable(item.occupancy) === stable(slice.occupancy));
      if (!source) {
        problems.push(`arm ${arm.label} has a measurement at ${slice.atSec}s that is not in the snapshot`);
      }
    }
    if (arm.pack.occupancySlices.length > 0 && measured.length === 0) {
      problems.push(`arm ${arm.label} has occupancy slices but no independent measurements behind them`);
    }
  }
  const unique = new Set(Object.values(digests));
  if (arms.length >= 2 && unique.size > 1) {
    problems.push('the arms received different occupancy data from each other');
  }
  return {identical: problems.length === 0, problems, digests, expectedDigest, independentSeen};
}


export type ReplayLedger = {
  /** Every measurement the pipeline asked the replay for, in order, and what it got. */
  requests: Array<{role: 'primary' | 'sampled'; requestedSourceSec: number; served: string | null; outcome: 'served' | 'miss' | 'mismatch'}>;
  /** Failures raised to the pipeline (each also thrown as OccupancyReplayError). */
  violations: string[];
};

/**
 * The object handed to `withOccupancyReplay` for the REAL pipeline. Built only from a snapshot that has already passed
 * `validateSnapshot` (an invalid or tampered value throws here, before anything runs). It never measures, never falls back to a
 * default box and never reuses the nearest measurement: a request it cannot serve exactly throws OccupancyReplayError, which the
 * pipeline's catch-alls rethrow. Replies are deep copies, so one arm cannot change what another receives.
 */
export function occupancyReplaySource(snapshot: OccupancySnapshot, options: {toleranceSec?: number} = {}): OccupancyReplaySource & {ledger: ReplayLedger; unserved(): string[]} {
  const problems = validateSnapshot(snapshot);
  if (problems.length > 0) {
    throw new SnapshotError(problems);
  }
  const tolerance = options.toleranceSec ?? 1e-6;
  const primary = primaryMeasurement(snapshot);
  const sampled = independentMeasurements(snapshot).filter(item => item.role === 'sampled');
  const served = new Set<string>();
  const ledger: ReplayLedger = {requests: [], violations: []};
  const fail = (kind: 'miss' | 'mismatch', role: 'primary' | 'sampled', requestedSourceSec: number, message: string): never => {
    ledger.requests.push({role, requestedSourceSec, served: null, outcome: kind});
    ledger.violations.push(message);
    throw new OccupancyReplayError(kind, message);
  };
  return {
    id: snapshot.id,
    contentSha256: snapshot.contentSha256,
    ledger,
    primary: request => {
      if (!primary) {
        return fail('miss', 'primary', request.sampleSourceSec, `snapshot ${snapshot.id} has no primary measurement, but the pipeline asked for one at source time ${request.sampleSourceSec}`);
      }
      if (Math.abs(primary.sourceSec - request.sampleSourceSec) > tolerance) {
        return fail('mismatch', 'primary', request.sampleSourceSec, `snapshot ${snapshot.id} recorded its primary measurement at source time ${primary.sourceSec}, but the pipeline measures it at ${request.sampleSourceSec}: the snapshot was not taken from this video and trim`);
      }
      served.add(primary.id);
      ledger.requests.push({role: 'primary', requestedSourceSec: request.sampleSourceSec, served: primary.id, outcome: 'served'});
      return structuredClone(primary.occupancy);
    },
    at: request => {
      const match = sampled.find(item => Math.abs(item.sourceSec - request.atSec) <= tolerance);
      if (!match) {
        return fail('miss', 'sampled', request.atSec, `snapshot ${snapshot.id} has no recorded measurement at source time ${request.atSec}: refusing to measure live, fall back, or reuse another measurement`);
      }
      served.add(match.id);
      ledger.requests.push({role: 'sampled', requestedSourceSec: request.atSec, served: match.id, outcome: 'served'});
      return structuredClone(match.occupancy);
    },
    /** Independent recorded measurements the pipeline never asked for (a replay that skips part of the snapshot is suspect). */
    unserved: () => independentMeasurements(snapshot).filter(item => !served.has(item.id)).map(item => item.id),
  };
}


/**
 * Refuse, BEFORE anything runs, a snapshot recorded from a different video than the one about to be processed. A snapshot whose
 * source hash is an explicit unknown cannot be checked and is rejected too: a replay of unidentified measurements proves nothing.
 */
export function assertSnapshotMatchesSource(snapshot: OccupancySnapshot, sourceFile: string): void {
  if (isUnknown(snapshot.source.videoSha256)) {
    throw new OccupancyReplayError('mismatch', `snapshot ${snapshot.id} does not identify its source video (hash unknown), so it cannot be shown to belong to ${sourceFile}`);
  }
  if (!existsSync(sourceFile) || !statSync(sourceFile).isFile()) {
    throw new OccupancyReplayError('mismatch', `source file ${sourceFile} is not available to check against snapshot ${snapshot.id}`);
  }
  const actual = sha256(readFileSync(sourceFile));
  if (actual !== snapshot.source.videoSha256) {
    throw new OccupancyReplayError('mismatch', `snapshot ${snapshot.id} was recorded from a different video (${snapshot.source.videoSha256.slice(0, 12)}…) than ${sourceFile} (${actual.slice(0, 12)}…)`);
  }
}

/** The inverse of the pipeline's output->source mapping over the kept segments; `null` when the instant lies in a trimmed silence. */
export function sourceToOutputSec(keepSegments: ReadonlyArray<{sourceStart: number; sourceEnd: number; outputStart: number}>, sourceSec: number): number | null {
  for (const segment of keepSegments) {
    if (sourceSec >= segment.sourceStart && sourceSec < segment.sourceEnd) {
      return segment.outputStart + (sourceSec - segment.sourceStart);
    }
  }
  return null;
}
