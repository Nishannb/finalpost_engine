/**
 * S2: transcript provider. Default = the existing Groq word timings (wrapped), or a JSON transcript from the CLI (`--transcript`). WhisperX is an optional adapter that is only loaded when WHISPERX=1.
 * Words are converted to FRAME indices at the source fps here; nothing downstream sees float seconds.
 */
import {readFile} from 'node:fs/promises';

import type {KineticWord} from './schema.ts';

export type RawWord = {text: string; start: number; end: number};

export interface TranscriptProvider {
  readonly id: string;
  readonly version: string;
  words(input: {videoPath: string; fps: number; durationSec: number}): Promise<RawWord[]>;
}

const HERO_THRESHOLD = 0.65;
export const HERO_EMPHASIS_THRESHOLD = HERO_THRESHOLD;

const STOP = new Set('a an the and or but so if of to in on at for with is are was were be been it this that i you we he she they me my your our as by from do did does have has had not no yes just very really um uh like'.split(' '));
export const normToken = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, '');

/** Cheap emphasis in [0,1] from duration + caps / punctuation / length heuristics (no model). */
export function emphasisScore(w: RawWord, prev?: RawWord, next?: RawWord): number {
  const t = w.text.trim();
  const core = normToken(t);
  if (!core) return 0;
  let s = 0;
  const dur = Math.max(0, w.end - w.start);
  s += Math.min(0.3, (dur / (0.3 + core.length * 0.05)) * 0.2); // long for its length = stressed
  if (core.length >= 6) s += 0.22;
  else if (core.length >= 4) s += 0.18;
  if (STOP.has(core)) s -= 0.4;
  if (/^[A-Z]{2,}[^a-z]*$/.test(t)) s += 0.4;
  else if (/^\p{Lu}/u.test(t) && prev && /[.!?]$/.test(prev.text.trim()) === false) s += 0.1; // mid-sentence capital
  if (/[!?]$/.test(t)) s += 0.2;
  else if (/[.,;:]$/.test(t)) s += 0.08;
  if (prev && w.start - prev.end > 0.28) s += 0.12; // a pause before the word
  if (next && next.start - w.end > 0.28) s += 0.08;
  return Math.max(0, Math.min(1, +s.toFixed(3)));
}

export function toKineticWords(raw: RawWord[], fps: number): KineticWord[] {
  const sorted = raw.filter(w => w.text.trim() && Number.isFinite(w.start) && Number.isFinite(w.end)).sort((a, b) => a.start - b.start);
  let lastEnd = 0;
  return sorted.map((w, i) => {
    const startFrame = Math.max(lastEnd, Math.round(w.start * fps));
    const endFrame = Math.max(startFrame + 1, Math.round(w.end * fps));
    lastEnd = endFrame;
    return {idx: i, text: w.text.trim(), startFrame, endFrame, emphasisScore: emphasisScore(w, sorted[i - 1], sorted[i + 1])};
  });
}

export const heroCandidates = (words: KineticWord[]): KineticWord[] => words.filter(w => w.emphasisScore >= HERO_THRESHOLD);

/** `--transcript` JSON: `[{text,start,end}]`, `{words:[{word|text,start,end}]}`. */
export class JsonTranscriptProvider implements TranscriptProvider {
  readonly id = 'json';
  readonly version = '1';
  private readonly path: string;
  constructor(path: string) {
    this.path = path;
  }
  async words(): Promise<RawWord[]> {
    const parsed = JSON.parse(await readFile(this.path, 'utf8')) as unknown;
    const arr = Array.isArray(parsed) ? parsed : (parsed as {words?: unknown[]}).words;
    if (!Array.isArray(arr)) throw new Error('transcript json: expected an array or {words: []}');
    return arr.map((w: any) => ({text: String(w.text ?? w.word ?? ''), start: Number(w.start), end: Number(w.end)}));
  }
}

/** Existing Groq word timings. The ASR module (and env) is imported lazily so pure tests never load config. */
export class GroqTranscriptProvider implements TranscriptProvider {
  readonly id = 'groq';
  readonly version = 'whisper-large-v3-turbo';
  private readonly extractAudio: (videoPath: string) => Promise<{audioPath: string; audioBytes: number}>;
  constructor(extractAudio: (videoPath: string) => Promise<{audioPath: string; audioBytes: number}>) {
    this.extractAudio = extractAudio;
  }
  async words(input: {videoPath: string; fps: number; durationSec: number}): Promise<RawWord[]> {
    const {transcribeAudio, transcriptionConfigured} = await import('../transcribe/groqTranscribe.ts');
    if (!transcriptionConfigured()) throw new Error('GROQ_API_KEY not configured (pass --transcript <json>)');
    const audio = await this.extractAudio(input.videoPath);
    const res = await transcribeAudio({...audio, languageCode: 'auto', durationSec: input.durationSec});
    return res.words.map(w => ({text: w.text, start: w.start, end: w.end}));
  }
}

/** Optional WhisperX adapter: NOT imported unless WHISPERX=1. Typed stub; there is no in-repo implementation, so enabling it without one throws and the caller falls back to Groq / JSON. */
export async function loadWhisperXProvider(): Promise<TranscriptProvider> {
  if (process.env.WHISPERX !== '1') throw new Error('WhisperX adapter is disabled (set WHISPERX=1)');
  throw new Error('WhisperX adapter is not installed in this repo; use Groq or --transcript');
}
