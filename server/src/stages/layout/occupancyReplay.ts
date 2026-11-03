/**
 * Explicit occupancy replay seam. When a caller runs the pipeline inside `withOccupancyReplay(source, ...)`, the two occupancy
 * measurement functions serve RECORDED measurements instead of running the speaker detector. Outside that scope (the default, and
 * the only behaviour production ever has) nothing here is consulted.
 *
 * Fail closed: a source answers a request it cannot satisfy by throwing `OccupancyReplayError`. The pipeline's own catch-alls
 * (which turn a failed detection into a default "fallback" box, and a failed Director v2 into the keyword fallback) must NOT turn
 * that into a plausible-looking measurement, so they rethrow it. The seam takes an already-validated source object; it never reads
 * a path, the environment, or any file.
 */
import {AsyncLocalStorage} from 'node:async_hooks';

import type {Occupancy} from './occupancy.ts';

export class OccupancyReplayError extends Error {
  readonly kind: 'miss' | 'mismatch';

  constructor(kind: 'miss' | 'mismatch', message: string) {
    super(message);
    this.name = 'OccupancyReplayError';
    this.kind = kind;
  }
}

export interface OccupancyReplaySource {
  /** Snapshot id and canonical content hash: recorded in run evidence as the identity of the data consumed. */
  readonly id: string;
  readonly contentSha256: string;
  /** The primary measurement (the frame near 28 % of the source). Must throw OccupancyReplayError when it cannot be served exactly. */
  primary(request: {sampleSourceSec: number; durationSec: number}): Occupancy;
  /** An extra sampled measurement at a requested source time. Must throw OccupancyReplayError when none was recorded for it. */
  at(request: {atSec: number; durationSec: number}): Occupancy;
}

const store = new AsyncLocalStorage<OccupancyReplaySource>();

export function withOccupancyReplay<T>(source: OccupancyReplaySource, fn: () => Promise<T>): Promise<T> {
  return store.run(source, fn);
}

export function activeOccupancyReplay(): OccupancyReplaySource | undefined {
  return store.getStore();
}
