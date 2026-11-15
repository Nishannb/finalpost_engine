/**
 * The story request for the first personalised BGM of the hi edit (Phase 1.6). Hand-authored in Phase 1.5 (not produced by a model) and kept unchanged:
 * its request id is pinned by generateFirstBgm.test.ts, so any edit to it is caught.
 */
import {readFileSync} from 'node:fs';

import type {BgmIntentInput} from '../generation/requests.ts';
import {firstListeningPlan, firstListeningSheet, type CaptureFixture} from './firstListening.ts';
import {CAPTURE_FIXTURE} from './prepareFirstListening.ts';

export const hiSheet = firstListeningSheet(JSON.parse(readFileSync(CAPTURE_FIXTURE, 'utf8')) as CaptureFixture);
export const hiPlan = firstListeningPlan(hiSheet);
export const W = (sheet: typeof hiSheet, n: number, at: 'start' | 'end') => ({kind: 'word' as const, wordId: sheet.speech.words[n]!.id, at});

/** A story arc for the hi edit, anchored to the same words as the plan's sections. */
export function hiIntent(over: Partial<BgmIntentInput> = {}): BgmIntentInput {
  return {
    subject: 'Why silence in conversation builds connection',
    narrative: 'Opens on a hook about awkward silence, explains why we rush to fill it, turns reflective about the digital age, pauses on "embrace the pause", then resolves warmly into the call to action.',
    identity: {genre: 'ambient', moodWords: ['warm', 'reflective'], instruments: ['felt piano', 'soft synth pad'], texture: ['airy'], avoid: ['percussion fills']},
    tempo: {bpm: 72, feel: 'laid_back'},
    key: 'D major',
    intro: 'soft_swell',
    ending: 'resolve',
    progression: [
      {from: hiPlan.music!.start!, to: W(hiSheet, 65, 'start'), role: 'establish', energy: 'medium', emotion: 'curious'},
      {from: W(hiSheet, 65, 'start'), to: W(hiSheet, 82, 'end'), role: 'settle', energy: 'low', emotion: 'reflective'},
      {from: W(hiSheet, 82, 'end'), to: W(hiSheet, 93, 'start'), role: 'build', energy: 'medium', emotion: 'hopeful'},
      {from: W(hiSheet, 93, 'start'), to: W(hiSheet, 95, 'end'), role: 'pause', energy: 'low', emotion: 'still'},
      {from: W(hiSheet, 95, 'end'), to: {kind: 'end'}, role: 'resolve', energy: 'medium', emotion: 'warm'},
    ],
    ...over,
  };
}


