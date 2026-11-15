/**
 * First local listening test (Phase 1.4 preparation; NOT executed). Pure builders, no I/O.
 *
 * The edit: the real "hi" talking-head edit whose source video is on disk (remotion/public/hi.mp4, 48.72 s, 720x1280, with audio). Its words, caption
 * words and keep segments come verbatim from the saved capture fixture server/src/eval/fixtures/v1-hi-relationship-89d9a6364d.json (a real earlier
 * run, replayed offline). Only the timing data is used: no B-roll, overlays or graphics, so the render needs no network and the picture is the speaker.
 *
 * The plan (hand-authored): music enters on the first hard cut with a 1 s fade-in, drops to `quiet` while the speaker turns reflective, stops under
 * "embrace the pause", returns for "and watch your vulnerability bloom", and holds-and-fades to the end under the call to action. Two subtle hits mark
 * the two hard cuts. Ducking is the voice-relative `talking` envelope throughout.
 *
 * The bed is NOT chosen here: no real, rights-cleared bed exists locally (see PHASE_1_4_IMPLEMENTATION_REPORT.md). The caller supplies one.
 */

import {buildEventSheet} from '../eventSheet/buildEventSheet.ts';
import type {EditEventSheet} from '../eventSheet/types.ts';
import type {AudioPlanInput} from '../audioPlan/planSchema.ts';

export const FIRST_LISTENING_ASSET_ID = 'first-listening-bed';

export type CaptureFixture = {
  id: string;
  sourceDurationSec: number;
  outputDurationSec: number;
  transcript: string;
  words: Array<{text: string; start: number; end: number}>;
  captionWords: Array<{text: string; start: number; end: number; sentenceIndex: number}>;
  keepSegments: Array<{sourceStart: number; sourceEnd: number; outputStart: number}>;
};

/** Minimal blueprint of the real edit: timing only, speaker footage from remotion/public/hi.mp4. fps 30 is the pipeline's output rate. */
export function firstListeningBlueprint(fixture: CaptureFixture): Record<string, unknown> {
  return {
    schemaVersion: 1,
    blueprintId: 'adir_first_listening_hi',
    videoUrl: 'staticFile:hi.mp4',
    languageCode: 'en',
    fps: 30,
    width: 1080,
    height: 1920,
    sourceDurationSec: fixture.sourceDurationSec,
    outputDurationSec: fixture.outputDurationSec,
    words: fixture.words,
    captionWords: fixture.captionWords,
    transcript: fixture.transcript,
    keepSegments: fixture.keepSegments,
    zoomTriggers: [],
    brollClips: [],
    hookTitle: '',
  };
}

const wordId = (sheet: EditEventSheet, index: number, text: string): string => {
  const word = sheet.speech.words.find(item => item.id === `w${index}`);
  if (!word || word.text !== text) throw new Error(`expected w${index} = "${text}" in the first-listening edit, found "${word?.text ?? 'nothing'}"`);
  return word.id;
};

const cutAt = (sheet: EditEventSheet, sec: number): string => {
  const cut = sheet.events.find(event => event.type === 'cut' && Math.abs((event.anchor?.sec ?? event.time.startSec) - sec) < 0.001);
  if (!cut) throw new Error(`no hard cut at ${sec}s in the first-listening edit`);
  return cut.id;
};

/** The hand-authored plan. Every anchor is checked against the sheet (text and time), so a changed edit fails loudly instead of drifting. */
export function firstListeningPlan(sheet: EditEventSheet): AudioPlanInput {
  const firstCut = cutAt(sheet, 4.16);
  const lastCut = cutAt(sheet, 41.62);
  return {
    version: 1,
    eventSheet: {version: 2, timingHash: sheet.timingHash},
    visualContentHash: sheet.visualContentHash,
    music: {
      assetId: FIRST_LISTENING_ASSET_ID,
      start: {kind: 'event', eventId: firstCut, at: 'impact'},
      end: {kind: 'end'},
      align: {kind: 'auto'},
      fadeIn: 'long',
      ending: 'fade',
      sections: [
        {from: {kind: 'word', wordId: wordId(sheet, 65, 'Our'), at: 'start'}, to: {kind: 'word', wordId: wordId(sheet, 82, 'settle.'), at: 'end'}, energy: 'low', level: 'quiet', why: 'The speaker turns reflective ("Our digital age trains us to fear silence…"): pull the bed back.'},
        {from: {kind: 'word', wordId: wordId(sheet, 93, 'embrace'), at: 'start'}, to: {kind: 'word', wordId: wordId(sheet, 95, 'pause,'), at: 'end'}, energy: 'low', level: 'out', why: 'Stop-down: the music itself pauses under "embrace the pause".'},
      ],
      why: 'Enter after the cold-open hook on the first cut; stay under the voice; let the ending breathe under the call to action.',
    },
    sfx: [
      {id: 'cut-into-topic', anchor: {kind: 'event', eventId: firstCut, at: 'impact'}, sound: {kind: 'builtin', name: 'hit'}, level: 'subtle', priority: 1, why: 'Mark the cut from the hook into the topic, with the music entry.'},
      {id: 'cut-into-cta', anchor: {kind: 'event', eventId: lastCut, at: 'impact'}, sound: {kind: 'builtin', name: 'hit'}, level: 'subtle', priority: 2, why: 'Mark the cut into the call to action.'},
    ],
    policy: {onInvalidElement: 'reject_plan', fallback: 'voice_only'},
    provenance: {author: 'hand', note: 'Phase 1.4 first listening test'},
  };
}

export const firstListeningSheet = (fixture: CaptureFixture): EditEventSheet => buildEventSheet(firstListeningBlueprint(fixture));
