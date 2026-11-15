/** Test-only fixtures for the AudioPlan compiler (imported by *.test.ts files). */

import {buildEventSheet} from '../eventSheet/buildEventSheet.ts';
import type {EditEventSheet} from '../eventSheet/types.ts';
import {base, kineticSpec} from '../eventSheet/testFixtures.ts';
import {musicCatalog, type MusicAsset} from './assets.ts';
import type {AudioPlanInput} from './planSchema.ts';

/** The Phase 1.2 synthetic edit: 10 s, a hard cut at 4 s, a whip-blur transition peaking at frame 181, kinetic type with a light-leak flash. */
export const exampleSheet = (): EditEventSheet => buildEventSheet(base({kinetic: kineticSpec()}));

/** A synthetic 120 BPM 4/4 bed (bar = 2 s): quiet first four bars, a measured lift at 8 s, a 4-bar loop body. Placement metadata as agents/music_specialist measures it. */
export const BED_120: MusicAsset = {
  id: 'bed-120',
  kind: 'music',
  source: 'generated',
  url: 'https://assets.invalid/beds/bed-120/bed.wav',
  fullUrl: 'https://assets.invalid/beds/bed-120/bed_full.wav',
  loopUrl: 'https://assets.invalid/beds/bed-120/bed_loop.wav',
  fullDurationSec: 40,
  integratedLufs: -16,
  bpm: 120,
  placement: {
    downbeatTimes: Array.from({length: 20}, (_, i) => i * 2),
    energyMap: Array.from({length: 20}, (_, i) => (i < 4 ? 0.25 : 0.8)),
    liftSec: 8,
    liftBar: 4,
    barSec: 2,
    fullDurationSec: 40,
    hasLoop: true,
    loopDurationSec: 8,
    loopBars: 4,
    loudnessMap: Array.from({length: 20}, (_, i) => (i < 4 ? -20 : -15)),
  },
  rights: {cleared: true, licence: 'synthetic test asset'},
};

export const exampleAssets = (extra: MusicAsset[] = []) => musicCatalog([BED_120, ...extra]);

/** The hand-authored example plan: a bed across the whole edit with its lift on the hard cut, a hit on the cut, a soft whoosh on the transition peak. */
export const examplePlan = (sheet: EditEventSheet, extra: Partial<AudioPlanInput> = {}): AudioPlanInput => ({
  version: 1,
  eventSheet: {version: 2, timingHash: sheet.timingHash},
  visualContentHash: sheet.visualContentHash,
  music: {
    assetId: 'bed-120',
    start: {kind: 'start'},
    end: {kind: 'end'},
    align: {kind: 'lift_at', anchor: {kind: 'event', eventId: 'cut@4000', at: 'impact'}},
    ending: 'auto',
    why: 'Steady bed; the measured lift lands on the cut into the second thought.',
  },
  sfx: [
    {id: 'cut-hit', anchor: {kind: 'event', eventId: 'cut@4000', at: 'impact'}, sound: {kind: 'builtin', name: 'hit'}, level: 'normal', priority: 1, why: 'Mark the hard cut.'},
    {id: 'whip', anchor: {kind: 'event', eventId: 'transition@6000', at: 'impact'}, sound: {kind: 'builtin', name: 'whoosh'}, level: 'subtle', priority: 2, why: 'Carry the whip into the B-roll.'},
  ],
  provenance: {author: 'hand', note: 'Phase 1.3 example'},
  ...extra,
});
