/**
 * Diagnostic: does the occupancy text the Director receives match the sampling semantics the prompt template DECLARES?
 *
 * The v2 user template says "OCCUPANCY (per time slice, every ~0.5s): speaker box, face box, LEGAL_SLOTS …". The producer
 * (`perception.formatOccupancySlices`) emits, by mode:
 *   legacy        dense 0.5 s lines that are nearest-neighbour COPIES of 3 measurements, with a heuristic `face=` box;
 *   visual-context only the measured instants (no copies, no face box).
 * This module reports the difference as machine-readable mismatch codes so a wording or producer change cannot drift
 * silently. It reads the template; it never edits it.
 */
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {env} from '../../config/env.ts';
import {formatOccupancySlices} from './perception.ts';
import type {PerceptionPack} from './types.ts';

const here = dirname(fileURLToPath(import.meta.url));
export const OCCUPANCY_TEMPLATE_PATH = join(here, '..', '..', '..', '..', 'prompts', 'stage2_creative_director.user.v1.md');

export type DeclaredOccupancy = {line: string | null; claimsPerSlice: boolean; stepSec: number | null; claimsFaceBox: boolean};

export function declaredOccupancySampling(template = readFileSync(OCCUPANCY_TEMPLATE_PATH, 'utf8')): DeclaredOccupancy {
  const line = template.split('\n').find(candidate => /^OCCUPANCY\b/.test(candidate)) ?? null;
  const step = line ? /every\s*~?\s*([\d.]+)\s*s/i.exec(line) : null;
  return {line, claimsPerSlice: Boolean(line && /per time slice/i.test(line)), stepSec: step ? Number(step[1]) : null, claimsFaceBox: Boolean(line && /face box/i.test(line))};
}

export type ProducedOccupancy = {
  mode: 'dense_copies' | 'measured_only';
  /** Lines of occupancy the Director is shown. */
  linesShown: number;
  /** Distinct measurements behind them. */
  measurements: number;
  /** Median spacing between the shown lines' times (s); null for a single line. */
  spacingSec: number | null;
  facePrinted: boolean;
  /** Time of the last line shown, and of the last slice that exists: lines beyond the first ones are cut by the formatter. */
  lastShownSec: number | null;
  lastSliceSec: number | null;
  /** What the text itself tells the Director (so a discrepancy with the template can be disclosed, not just present). */
  disclosure: {copies: boolean; estimatedFace: boolean; coverageCut: boolean; defaultBoxMarked: boolean; measuredSpanStated: boolean};
};

export function producedOccupancySampling(pack: PerceptionPack): ProducedOccupancy {
  const text = formatOccupancySlices(pack);
  const lines = text.split('\n').filter(line => line.startsWith('@'));
  const times = lines.map(line => Number(/^@([\d.]+)s/.exec(line)![1]));
  const gaps = times.slice(1).map((time, i) => time - times[i]!).sort((a, b) => a - b);
  const measured = pack.occupancyMeasured ?? pack.measuredOccupancy ?? pack.occupancySlices;
  // Dense slices share their measurement by reference (nearest-neighbour copy), so distinct objects = real measurements.
  const distinct = new Set(measured.map(slice => slice.occupancy)).size;
  return {
    mode: pack.measuredOccupancy || env.OCCUPANCY_CONTEXT_V2 ? 'measured_only' : 'dense_copies',
    linesShown: lines.length,
    measurements: pack.measuredOccupancy ? pack.measuredOccupancy.length : pack.occupancyMeasured && env.OCCUPANCY_CONTEXT_V2 ? pack.occupancyMeasured.length : distinct,
    spacingSec: gaps.length > 0 ? Number(gaps[Math.floor(gaps.length / 2)]!.toFixed(2)) : null,
    facePrinted: /\bface=/.test(text),
    lastShownSec: times.length > 0 ? times.at(-1)! : null,
    lastSliceSec: pack.occupancySlices.length > 0 ? pack.occupancySlices.at(-1)!.atSec : null,
    disclosure: {
      copies: /NOT an independent observation|copies of a few measurements|speaker position is unknown|no line repeats another/.test(text),
      estimatedFace: /face= is an estimate|face box ESTIMATE/.test(text) || !/\bface=/.test(text),
      coverageCut: /later times are not listed/.test(text),
      defaultBoxMarked: /DEFAULT BOX|position UNKNOWN|DEFAULT box/.test(text),
      measuredSpanStated: /measurements span/.test(text),
    },
  };
}

export type OccupancyMismatch =
  | 'dense_lines_are_copies_of_fewer_measurements'
  | 'face_box_printed_is_a_heuristic'
  | 'declared_per_slice_but_only_measured_instants_shown'
  | 'declared_face_box_but_none_printed'
  | 'declared_step_differs_from_produced_spacing'
  | 'shown_lines_stop_before_the_end_of_the_video';

export function occupancyContractMismatches(declared: DeclaredOccupancy, produced: ProducedOccupancy): OccupancyMismatch[] {
  const out: OccupancyMismatch[] = [];
  if (produced.mode === 'dense_copies') {
    if (produced.measurements < produced.linesShown) {
      out.push('dense_lines_are_copies_of_fewer_measurements');
    }
    if (declared.claimsFaceBox && produced.facePrinted) {
      out.push('face_box_printed_is_a_heuristic');
    }
  } else {
    if (declared.claimsPerSlice) {
      out.push('declared_per_slice_but_only_measured_instants_shown');
    }
    if (declared.claimsFaceBox && !produced.facePrinted) {
      out.push('declared_face_box_but_none_printed');
    }
  }
  if (declared.stepSec !== null && produced.spacingSec !== null && Math.abs(declared.stepSec - produced.spacingSec) > 0.01) {
    out.push('declared_step_differs_from_produced_spacing');
  }
  // legacy formatOccupancySlices keeps every other slice and at most 16 lines, so a long video is only described at its start.
  if (produced.mode === 'dense_copies' && produced.lastShownSec !== null && produced.lastSliceSec !== null && produced.lastSliceSec - produced.lastShownSec > 1) {
    out.push('shown_lines_stop_before_the_end_of_the_video');
  }
  return out;
}

/**
 * Discrepancies with the template that the occupancy text does NOT tell the Director about. Empty means every known
 * difference between what the template declares and what the producer emits is disclosed in the text itself.
 */
export function undisclosedMismatches(declared: DeclaredOccupancy, produced: ProducedOccupancy): OccupancyMismatch[] {
  return occupancyContractMismatches(declared, produced).filter(code => {
    if (code === 'dense_lines_are_copies_of_fewer_measurements') {
      return !produced.disclosure.copies;
    }
    if (code === 'face_box_printed_is_a_heuristic') {
      return !produced.disclosure.estimatedFace;
    }
    if (code === 'shown_lines_stop_before_the_end_of_the_video') {
      return !produced.disclosure.coverageCut;
    }
    // step / per-slice wording differences cannot be disclosed by the data without editing the template line itself
    return true;
  });
}
