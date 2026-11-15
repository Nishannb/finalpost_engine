/**
 * Director INPUT v2 (opt-in; the default prompt is byte-identical to before, pinned by directorInput.test.ts).
 *
 * What the Director sees today is `idx:text*` per word: no time, no pauses, no sentence or phrase structure, and a speaker box only when a matte exists. That is not enough to reason
 * about rhythm ("a hard beat before the reveal"), breath ("the speaker stops: give the type room") or composition ("the speaker stands left: the open side is right").
 *
 * This module derives, deterministically and without a model, what a human editor would read off the waveform and the transcript:
 *   - per word: start time (s) and spoken duration (s)
 *   - pause after each word (s), only when audible (>= 0.15 s)
 *   - boundaries: `phrase` (comma / colon / dash, or a pause >= 0.30 s) and `sentence` (. ! ? or a pause >= 0.70 s)
 *   - the speaker: measured box + where the open space is, or "unknown"
 * The transcript text and word order are NEVER altered: every word keeps its index and its exact text; annotations are separate tokens (round-trip pinned by a test).
 * Pure. No I/O, no model.
 */
import type {KineticWord} from './schema.ts';
import type {ShotScene} from './scene.ts';

export const PAUSE_AUDIBLE_SEC = 0.15;
export const PHRASE_PAUSE_SEC = 0.3;
export const SENTENCE_PAUSE_SEC = 0.7;

export type Boundary = 'phrase' | 'sentence' | null;
export type SpeechStructure = {
  /** seconds of silence between this word's end and the next word's start (0 for the last word) */
  pauseAfterSec: number[];
  /** the boundary AFTER word i (the last word always ends a sentence) */
  boundaryAfter: Boundary[];
  /** [firstIdx, lastIdx] of each sentence / phrase, in order; phrases nest inside sentences */
  sentences: Array<[number, number]>;
  phrases: Array<[number, number]>;
};

const SENTENCE_END = /[.!?…]["')\]]*$/;
const PHRASE_END = /[,;:–—-]["')\]]*$/;
const round2 = (n: number) => Math.round(n * 100) / 100;

export function analyzeSpeech(words: readonly KineticWord[], fps: number): SpeechStructure {
  const pauseAfterSec: number[] = [];
  const boundaryAfter: Boundary[] = [];
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i]!, next = words[i + 1];
    const pause = next ? Math.max(0, (next.startFrame - w.endFrame) / fps) : 0;
    pauseAfterSec.push(round2(pause));
    const text = w.text.trim();
    let b: Boundary = null;
    if (!next || SENTENCE_END.test(text) || pause >= SENTENCE_PAUSE_SEC) b = 'sentence';
    else if (PHRASE_END.test(text) || pause >= PHRASE_PAUSE_SEC) b = 'phrase';
    boundaryAfter.push(b);
  }
  const sentences: Array<[number, number]> = [];
  const phrases: Array<[number, number]> = [];
  let sFrom = 0, pFrom = 0;
  for (let i = 0; i < words.length; i += 1) {
    const b = boundaryAfter[i];
    if (b === 'sentence' || b === 'phrase') { phrases.push([pFrom, i]); pFrom = i + 1; }
    if (b === 'sentence') { sentences.push([sFrom, i]); sFrom = i + 1; }
  }
  return {pauseAfterSec, boundaryAfter, sentences, phrases};
}

/** `12:Nobody@3.40/0.28` = index : text @ start seconds / spoken duration. `*` (emphasis candidate) is appended exactly as in the plain format. */
export function formatWordRich(w: KineticWord, fps: number): string {
  return `${w.idx}:${w.text}@${round2(w.startFrame / fps)}/${round2((w.endFrame - w.startFrame) / fps)}${w.emphasisScore >= 0.65 ? '*' : ''}`;
}

/** One line per phrase: `P3 s2 @3.40-5.10 : <words> ‖0.45` (phrase id, sentence id, span in seconds, words, the pause after the phrase when audible, `¶` when it also ends a sentence). */
export function formatWordsRich(words: readonly KineticWord[], fps: number): string {
  if (words.length === 0) return '';
  const st = analyzeSpeech(words, fps);
  const sentenceOf = (i: number) => st.sentences.findIndex(([a, b]) => i >= a && i <= b) + 1;
  return st.phrases.map(([a, b], pi) => {
    const first = words[a]!, last = words[b]!;
    const pause = st.pauseAfterSec[b]!;
    const end = st.boundaryAfter[b] === 'sentence' ? ' ¶' : '';
    return `P${pi + 1} s${sentenceOf(a)} @${round2(first.startFrame / fps)}-${round2(last.endFrame / fps)} : ${words.slice(a, b + 1).map(w => formatWordRich(w, fps)).join(' ')}${pause >= PAUSE_AUDIBLE_SEC ? ` ‖${pause.toFixed(2)}` : ''}${end}`;
  }).join('\n');
}

/** The open space around a measured speaker, in words the Director can use (it never sees pixels). */
export function describeSpeaker(scene: ShotScene | undefined): string {
  if (!scene) return 'speaker: unknown';
  if (scene.estimated || (scene.boxSource === undefined && scene.noMatte)) return 'speaker: position NOT measured (a default guess): do not rely on side placement';
  const b = scene.subjectBox;
  const cx = b.x + b.w / 2;
  const side = cx < 0.42 ? 'left of centre' : cx > 0.58 ? 'right of centre' : 'centred';
  const open = cx < 0.42 ? 'the RIGHT side is open' : cx > 0.58 ? 'the LEFT side is open' : b.w < 0.62 ? 'both sides have some room' : 'little side room (a close-up)';
  const headroom = b.y >= 0.34 ? 'plenty of headroom above the head' : b.y >= 0.2 ? 'some headroom above the head' : 'no headroom (the head is near the top of the frame)';
  const how = scene.boxSource === 'measured' ? 'measured box, no person matte' : 'matte measured';
  return `speaker: ${side}, ${Math.round(b.w * 100)}% of the width x ${Math.round(b.h * 100)}% of the height (${how}); ${open}; ${headroom}`;
}

/** Added to the system prompt ONLY with the rich input, so the model can read the format. */
export const RICH_INPUT_LEGEND = `
INPUT FORMAT (rich): the WORDS block is grouped by phrase, one phrase per line: "P<phrase> s<sentence> @<start>-<end> seconds : <idx>:<text>@<start>/<duration> ... ‖<pause seconds after the phrase> ¶ (a sentence ends here)". Indices and texts are the transcript exactly; a "*" marks an emphasis candidate. Use the timing like an editor reads a waveform: a pause before a word is a beat you can build into; a long pause after a phrase is room to let a big word land or to leave the screen empty; short rapid words want fast, light type; a word held for a long time can carry a big composition. The SHOTS line states where the speaker is and where the open space is: put type in the open space, never on the face.`;
