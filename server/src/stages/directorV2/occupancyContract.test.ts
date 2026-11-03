/**
 * Pins the KNOWN discrepancy between the declared occupancy semantics (prompts/stage2_creative_director.user.v1.md, not edited)
 * and what the producer emits. The prompt is not changed in this phase; if either side changes, this test fails and the
 * wording/proposal in remotion/out/phase15-audit/PROPOSED_OCCUPANCY_WORDING.md must be re-reviewed.
 */
import {describe, expect, it} from 'vitest';

import {occupancyFromSpeaker} from '../layout/occupancy.ts';
import {buildTimeline} from '../filters/timeline.ts';
import {declaredOccupancySampling, occupancyContractMismatches, producedOccupancySampling, undisclosedMismatches} from './occupancyContract.ts';
import {formatOccupancySlices} from './perception.ts';

const dense = (measured: Array<{atSec: number; source: 'vision' | 'fallback'}>, duration: number) => {
  const objects = measured.map(item => ({atSec: item.atSec, occupancy: occupancyFromSpeaker({x: 0.2, y: 0.1, w: 0.6, h: 0.7}, item.source)}));
  const slices: Array<{atSec: number; occupancy: (typeof objects)[number]['occupancy']}> = [];
  for (let t = 0; t <= duration + 0.001; t += 0.5) {
    const nearest = objects.reduce((best, slice) => (Math.abs(slice.atSec - t) < Math.abs(best.atSec - t) ? slice : best));
    slices.push({atSec: Number(t.toFixed(2)), occupancy: nearest.occupancy});
  }
  return {objects, slices};
};

describe('occupancy sampling: declared vs produced', () => {
  const declared = declaredOccupancySampling();

  it('reads the declaration from the (unchanged) template', () => {
    expect(declared).toMatchObject({claimsPerSlice: true, stepSec: 0.5, claimsFaceBox: true});
    expect(declared.line).toContain('OCCUPANCY (per time slice, every ~0.5s)');
  });

  it('legacy: lines are copies of 3 measurements, spaced 1 s (not the declared 0.5 s), capped at 16, and the face box is a heuristic', () => {
    const {objects, slices} = dense([{atSec: 0.4, source: 'vision'}, {atSec: 21.5, source: 'vision'}, {atSec: 47.2, source: 'vision'}], 47.82);
    const pack = {occupancySlices: slices, storyboard: [], timeline: buildTimeline([])} as never;
    const produced = producedOccupancySampling(pack);
    expect(produced).toMatchObject({mode: 'dense_copies', measurements: 3, spacingSec: 1, facePrinted: true, linesShown: 16});
    // 96 slices exist (every 0.5 s) but only the first 16 lines, every other slice, reach the Director: it hears about 0–15 s only.
    expect(produced.lastShownSec).toBe(15);
    expect(produced.lastSliceSec).toBe(47.5);
    expect(occupancyContractMismatches(declared, produced)).toEqual(['dense_lines_are_copies_of_fewer_measurements', 'face_box_printed_is_a_heuristic', 'declared_step_differs_from_produced_spacing', 'shown_lines_stop_before_the_end_of_the_video']);
    expect(objects).toHaveLength(3);
  });

  it('VISUAL_CONTEXT_V2: only the measured instants are shown and no face box is printed, so the template wording no longer matches', () => {
    const {objects, slices} = dense([{atSec: 3, source: 'vision'}, {atSec: 21.5, source: 'fallback'}, {atSec: 47.2, source: 'vision'}], 47.82);
    const pack = {occupancySlices: slices, measuredOccupancy: objects, visualContext: {}} as never;
    const produced = producedOccupancySampling(pack);
    expect(produced).toMatchObject({mode: 'measured_only', linesShown: 3, measurements: 3, facePrinted: false});
    expect(occupancyContractMismatches(declared, produced)).toEqual([
      'declared_per_slice_but_only_measured_instants_shown',
      'declared_face_box_but_none_printed',
      'declared_step_differs_from_produced_spacing',
    ]);
    expect(formatOccupancySlices(pack)).toContain('Between these instants the speaker position is unknown; measurements span');
  });

  it('a change to the declared step is detected even when the producer is unchanged', () => {
    const {slices} = dense([{atSec: 1, source: 'vision'}], 10);
    const produced = producedOccupancySampling({occupancySlices: slices} as never);
    const changed = declaredOccupancySampling('OCCUPANCY (per time slice, every ~2s): speaker box, LEGAL_SLOTS');
    expect(occupancyContractMismatches(changed, produced)).toContain('declared_step_differs_from_produced_spacing');
    expect(occupancyContractMismatches(declaredOccupancySampling('OCCUPANCY (measured instants only): speaker box'), produced)).not.toContain('declared_per_slice_but_only_measured_instants_shown');
  });

  // ---- default-path honesty (Phase 16): the text discloses what the template header does not ---------------------------------
  describe('default formatter discloses copies, estimated geometry and coverage', () => {
    const packFor = (measured: Array<{atSec: number; source: 'vision' | 'fallback'}>, duration: number, withList = true) => {
      const {slices} = dense(measured, duration);
      return {occupancySlices: slices, ...(withList ? {occupancyMeasurements: measured} : {})} as never;
    };
    const note = (pack: never) => formatOccupancySlices(pack).split('\n')[0]!;

    it('long clip: says there are only 3 measurements, that the lines repeat them, that face= is an estimate, and where the lines stop', () => {
      const pack = packFor([{atSec: 13.1, source: 'vision'}, {atSec: 21.5, source: 'vision'}, {atSec: 47.2, source: 'vision'}], 47.82);
      const line = note(pack);
      expect(line).toContain('NOTE: only 3 speaker measurements exist (13.1s detected; 21.5s detected; 47.2s detected)');
      expect(line).toContain('NOT an independent observation');
      expect(line).toContain('face= is an estimate (42% of the person-box height), not a detection');
      expect(line).toContain('the lines cover 0.0–15.0s of 47.5s; later times are not listed');
      const produced = producedOccupancySampling(pack);
      expect(produced.disclosure).toEqual({copies: true, estimatedFace: true, coverageCut: true, defaultBoxMarked: false, measuredSpanStated: true});
      // the discrepancies with the template header remain (the prompt is unchanged) but the data-level ones are no longer hidden
      expect(undisclosedMismatches(declaredOccupancySampling(), produced)).toEqual(['declared_step_differs_from_produced_spacing']);
    });

    it('short clip: no coverage-cut claim when every slice is shown', () => {
      const pack = packFor([{atSec: 4, source: 'vision'}], 8);
      const line = note(pack);
      expect(line).toContain('only 1 speaker measurement exists');
      expect(line).not.toContain('later times are not listed');
      expect(producedOccupancySampling(pack).disclosure.coverageCut).toBe(false);
      expect(undisclosedMismatches(declaredOccupancySampling(), producedOccupancySampling(pack))).not.toContain('shown_lines_stop_before_the_end_of_the_video');
    });

    it('repeated measurements: every line repeats the nearest of the listed measurements and the lines carry no independence claim', () => {
      const pack = packFor([{atSec: 5, source: 'vision'}, {atSec: 30, source: 'vision'}], 47.82);
      const produced = producedOccupancySampling(pack);
      expect(produced.measurements).toBe(2);
      expect(produced.linesShown).toBe(16);
      expect(note(pack)).toContain('only 2 speaker measurements exist');
    });

    it('missing measurement list: still says the lines are copies and the face is an estimate, without inventing counts', () => {
      const pack = packFor([{atSec: 5, source: 'vision'}], 20, false);
      const line = note(pack);
      expect(line).toContain('copies of a few measurements, not independent observations');
      expect(line).toContain('face= is an estimate');
      expect(line).not.toMatch(/only \d+ speaker/);
    });

    it('estimated geometry: the printed face box is exactly 42 % of the person-box height and is labelled an estimate', () => {
      const pack = packFor([{atSec: 5, source: 'vision'}], 6);
      const lineWithFace = formatOccupancySlices(pack).split('\n').find(line => line.startsWith('@'))!;
      expect(lineWithFace).toContain('speaker=0.20,0.10,0.60,0.70');
      expect(lineWithFace).toContain('face=0.20,0.10,0.60,0.29');
      expect(note(pack)).toContain('estimate');
    });

    it('a default (fallback) box is marked on every line it appears on and named in the note, never presented as a detection', () => {
      const pack = packFor([{atSec: 5, source: 'fallback'}], 6);
      const text = formatOccupancySlices(pack);
      expect(note(pack)).toContain('5.0s DEFAULT BOX, speaker not detected');
      for (const line of text.split('\n').filter(line => line.startsWith('@'))) {
        expect(line).toContain('[DEFAULT BOX — speaker not detected]');
      }
      expect(producedOccupancySampling(pack).disclosure.defaultBoxMarked).toBe(true);
    });

    it('detected lines carry no default-box marker', () => {
      const text = formatOccupancySlices(packFor([{atSec: 5, source: 'vision'}], 6));
      expect(text).not.toContain('DEFAULT BOX —');
    });
  });
});
