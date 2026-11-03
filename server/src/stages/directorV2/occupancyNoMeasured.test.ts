/**
 * Phase 20A (A2): OCCUPANCY_CONTEXT_V2 when the pack has occupancy slices but no `occupancyMeasured` (and no `measuredOccupancy`),
 * e.g. a pack built by an older caller or by hand. The flag must fail safe: slices alone are never treated as independent
 * observations or as proof of visibility. No model call; the real formatters only.
 */
import {afterEach, describe, expect, it} from 'vitest';

import {env} from '../../config/env.ts';
import {occupancyFromSpeaker} from '../layout/occupancy.ts';
import {confirmedVisibilityText} from './creativeDirector.ts';
import {formatOccupancySlices} from './perception.ts';
import {declaredOccupancySampling, occupancyContractMismatches, producedOccupancySampling} from './occupancyContract.ts';
import {speakerVisibleRanges} from '../../lib/depthOverlay.ts';

const e = env as unknown as {OCCUPANCY_CONTEXT_V2: boolean};
const original = e.OCCUPANCY_CONTEXT_V2;
afterEach(() => {
  e.OCCUPANCY_CONTEXT_V2 = original;
});

const detected = occupancyFromSpeaker({x: 0.2, y: 0.1, w: 0.6, h: 0.7}, 'vision');
const slices = (count: number, share: boolean) =>
  Array.from({length: count}, (_, i) => ({atSec: i * 0.5, occupancy: share ? detected : occupancyFromSpeaker({x: 0.2, y: 0.1, w: 0.6, h: 0.7}, 'vision')}));
/** A pack with slices only: no occupancyMeasured, no measuredOccupancy, no occupancyMeasurements. */
const slicesOnly = (count = 40, share = true) => ({occupancySlices: slices(count, share), outputDurationSec: (count - 1) * 0.5}) as never;

describe('OCCUPANCY_CONTEXT_V2 on, slices exist but occupancyMeasured is absent: fails safe', () => {
  it('says no measurement exists (unknown at every time) rather than presenting the slices as observations', () => {
    e.OCCUPANCY_CONTEXT_V2 = true;
    const text = formatOccupancySlices(slicesOnly());
    expect(text).toMatch(/^OCCUPANCY: no speaker measurement exists/);
    expect(text).toContain('unknown at every time');
    expect(text.split('\n').filter(line => line.startsWith('@'))).toEqual([]);
    expect(text).not.toMatch(/DETECTED|face=|LEGAL_SLOTS/);
  });

  it('visibility is "unknown: not confirmed at any time", and nothing tells the Director to assume it', () => {
    e.OCCUPANCY_CONTEXT_V2 = true;
    const text = confirmedVisibilityText(slicesOnly());
    expect(text).toMatch(/^unknown: visibility is not confirmed at any time/);
    expect(text).toContain('Do not assume the speaker is visible');
    expect(text).not.toMatch(/treat as visible|assume (it|the speaker) is visible\b(?!\.)/i);
  });

  it('the same pack with the flag OFF keeps the legacy formatting (copies-of-a-few-measurements note, face= key, ≤16 lines)', () => {
    e.OCCUPANCY_CONTEXT_V2 = false;
    const text = formatOccupancySlices(slicesOnly());
    expect(text.split('\n')[0]).toMatch(/^NOTE: the lines below are copies of a few measurements, not independent observations/);
    expect(text.split('\n').filter(line => line.startsWith('@'))).toHaveLength(16);
    expect(text).toMatch(/face=/);
  });

  it('a pack with no slices at all is "No occupancy slices." under both states (unchanged)', () => {
    for (const on of [false, true]) {
      e.OCCUPANCY_CONTEXT_V2 = on;
      expect(formatOccupancySlices({occupancySlices: [], outputDurationSec: 10} as never)).toBe('No occupancy slices.');
    }
  });

  it('fallback-only slices cannot establish visibility under either state: speakerVisibleRanges is empty', () => {
    const fallback = occupancyFromSpeaker({x: 0.18, y: 0.16, w: 0.64, h: 0.62}, 'fallback');
    const onlyFallback = Array.from({length: 40}, (_, i) => ({atSec: i * 0.5, occupancy: fallback}));
    expect(speakerVisibleRanges(onlyFallback as never)).toEqual([]);
    expect(speakerVisibleRanges([] as never)).toEqual([]);
    for (const on of [false, true]) {
      e.OCCUPANCY_CONTEXT_V2 = on;
      expect(confirmedVisibilityText({occupancyMeasured: onlyFallback.slice(0, 1)} as never)).toMatch(/^unknown: visibility is not confirmed/);
    }
  });
});

describe('the contract diagnostic when only slices exist', () => {
  it('reports measured-only mode with the flag on; the "measurements" count reflects distinct objects, so hand-built unshared slices over-count', () => {
    e.OCCUPANCY_CONTEXT_V2 = true;
    const shared = producedOccupancySampling(slicesOnly(40, true));
    expect(shared).toMatchObject({mode: 'measured_only', linesShown: 0, measurements: 1});
    // Recorded limitation (not fixed here): without occupancyMeasured the diagnostic cannot tell independent measurements
    // from copies except by object identity, so 40 distinct-but-identical slice objects count as 40 measurements.
    const unshared = producedOccupancySampling(slicesOnly(40, false));
    expect(unshared.measurements).toBe(40);
    expect(unshared.linesShown).toBe(0);
  });

  it('with the flag off the same pack is reported as dense copies and the legacy mismatch is raised', () => {
    e.OCCUPANCY_CONTEXT_V2 = false;
    const produced = producedOccupancySampling(slicesOnly(40, true));
    expect(produced.mode).toBe('dense_copies');
    const declared = declaredOccupancySampling('Occupancy slices every 0.5 s, each with speaker box and face box.');
    expect(occupancyContractMismatches(declared, produced)).toContain('dense_lines_are_copies_of_fewer_measurements');
  });
});
