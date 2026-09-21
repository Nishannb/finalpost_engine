/**
 * Stage 0 — perception pack. Facts only: words, frames, occupancy slices, audio.
 */

import {stageLogger} from '../../lib/logger.ts';
import {extractStillJpeg} from '../../media/ffmpeg.ts';
import type {CaptionWord, WordToken} from '../../types/blueprint.ts';
import type {Timeline} from '../filters/timeline.ts';
import {CAPTION_BAND, describeOccupancyForDirector, legalSlots, measureOccupancyAt, occupancyFromSpeaker} from '../layout/occupancy.ts';
import type {PerceptionPack, WordRef} from './types.ts';

const log = stageLogger('director-v2-perception');

export async function buildPerceptionPack(input: {
  captionWords: CaptionWord[];
  sourceWords: WordToken[];
  transcript: string;
  timeline: Timeline;
  sourcePath: string;
  stillDir: (name: string) => string;
  userAssets?: PerceptionPack['userAssets'];
  captionStyleGuide?: Record<string, unknown> | null;
  primaryOccupancy?: PerceptionPack['occupancySlices'][number]['occupancy'];
  language?: string;
  creatorProfile?: string;
  speakerCutoutAvailable?: boolean;
  speakerCutoutNote?: string;
  requestedEdits?: string[] | null;
  themeColors?: string[];
}): Promise<PerceptionPack> {
  const started = Date.now();
  const words: WordRef[] = input.captionWords.map((word, index) => ({
    id: `w${index}`,
    text: word.text,
    start: word.start,
    end: word.end,
    sentenceId: `s${word.sentenceIndex}`,
  }));
  const sentenceIds = [...new Set(words.map(word => word.sentenceId))];
  const sentences = sentenceIds.map(id => {
    const group = words.filter(word => word.sentenceId === id);
    return {
      id,
      wordIds: group.map(word => word.id),
      start: group[0]?.start ?? 0,
      end: group.at(-1)?.end ?? 0,
      text: group.map(word => word.text).join(' '),
    };
  });

  const duration = input.timeline.outputDurationSec;
  const storyboard: PerceptionPack['storyboard'] = [];
  const step = 1.5;
  const count = Math.min(10, Math.max(2, Math.ceil(duration / step)));
  for (let i = 0; i < count; i += 1) {
    const atSec = Math.min(duration - 0.15, 0.4 + i * step);
    const path = input.stillDir(`storyboard-${i}.jpg`);
    try {
      await extractStillJpeg(input.sourcePath, path, atSec);
      storyboard.push({atSec, path});
    } catch (error) {
      log.warn({atSec, error}, 'storyboard still failed');
    }
  }

  const occupancySlices: PerceptionPack['occupancySlices'] = [];
  const sliceTimes = [0.4, duration * 0.45, Math.max(0.6, duration - 0.6)];
  for (const [index, atSec] of sliceTimes.entries()) {
    if (index === 0 && input.primaryOccupancy) {
      occupancySlices.push({atSec, occupancy: input.primaryOccupancy});
      continue;
    }
    const occupancy = await measureOccupancyAt({
      sourcePath: input.sourcePath,
      durationSec: duration,
      stillPath: input.stillDir(`occ-${index}.jpg`),
      atSec,
    });
    occupancySlices.push({atSec, occupancy});
  }
  if (occupancySlices.length === 0) {
    occupancySlices.push({
      atSec: 0.4,
      occupancy: occupancyFromSpeaker({x: 0.18, y: 0.16, w: 0.64, h: 0.62}, 'fallback'),
    });
  }

  const denseSlices = expandOccupancySlices(occupancySlices, duration);

  log.info({ms: Date.now() - started, words: words.length, frames: storyboard.length}, 'perception pack');
  return {
    words,
    sentences,
    storyboard,
    occupancySlices: denseSlices,
    audio: audioFacts(words),
    transcript: input.transcript,
    outputDurationSec: duration,
    language: input.language || 'en',
    creatorProfile: input.creatorProfile || '',
    speakerCutoutAvailable: Boolean(input.speakerCutoutAvailable),
    speakerCutoutNote: input.speakerCutoutNote || '',
    userAssets: input.userAssets ?? [],
    captionStyleGuide: input.captionStyleGuide,
    requestedEdits: input.requestedEdits ?? null,
    themeColors: input.themeColors ?? [],
  };
}

function expandOccupancySlices(
  measured: PerceptionPack['occupancySlices'],
  duration: number,
): PerceptionPack['occupancySlices'] {
  if (measured.length === 0) {
    return [];
  }
  const out: PerceptionPack['occupancySlices'] = [];
  for (let t = 0; t <= duration + 0.001; t += 0.5) {
    const nearest = measured.reduce((best, slice) =>
      Math.abs(slice.atSec - t) < Math.abs(best.atSec - t) ? slice : best,
    );
    out.push({atSec: Number(t.toFixed(2)), occupancy: nearest.occupancy});
  }
  return out;
}

export function formatWordIdTranscript(pack: PerceptionPack): string {
  return pack.words
    .map(word => `${word.id} [${word.start.toFixed(2)}-${word.end.toFixed(2)}] ${word.text}`)
    .join('\n');
}

export function formatFrameLabels(pack: PerceptionPack): string {
  if (pack.storyboard.length === 0) {
    return 'No storyboard frames attached.';
  }
  return pack.storyboard
    .map((frame, index) => `frame ${index} @ ${frame.atSec.toFixed(2)}s${frame.note ? ` — ${frame.note}` : ''}`)
    .join('\n');
}

export function formatAudioFacts(pack: PerceptionPack): string {
  const pauses = pack.audio.pauses
    .map(pause => `${pause.start.toFixed(2)}-${pause.end.toFixed(2)}`)
    .join(', ') || 'none';
  const peaks = pack.audio.energyPeaks
    .map(peak => `${peak.atSec.toFixed(2)} (${peak.score.toFixed(2)})`)
    .join(', ') || 'none';
  const emphasis = pack.audio.emphasisWordIds.join(', ') || 'none';
  return `pauses: ${pauses}\nenergy_peaks: ${peaks}\nemphasized_words: ${emphasis}`;
}

export function formatOccupancySlices(pack: PerceptionPack): string {
  if (pack.occupancySlices.length === 0) {
    return 'No occupancy slices.';
  }
  const sample = pack.occupancySlices.filter((_, index) => index % 2 === 0).slice(0, 16);
  return sample
    .map(slice => {
      const {speaker} = slice.occupancy;
      const slots = legalSlots(slice.occupancy)
        .map(slot => slot.id)
        .join(', ');
      return (
        `@${slice.atSec.toFixed(2)}s speaker=${speaker.x.toFixed(2)},${speaker.y.toFixed(2)},${speaker.w.toFixed(2)},${speaker.h.toFixed(2)} ` +
        `face=${speaker.x.toFixed(2)},${speaker.y.toFixed(2)},${speaker.w.toFixed(2)},${(speaker.h * 0.42).toFixed(2)} ` +
        `LEGAL_SLOTS=[${slots || 'none'}] CAPTION_BAND y>=${CAPTION_BAND.y.toFixed(2)}`
      );
    })
    .join('\n') + `\n\n${describeOccupancyForDirector(pack.occupancySlices[0]!.occupancy)}`;
}

export function audioFacts(words: WordRef[]): PerceptionPack['audio'] {
  const pauses: Array<{start: number; end: number}> = [];
  const emphasisWordIds: string[] = [];
  const energyPeaks: Array<{atSec: number; score: number}> = [];
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i]!;
    const hold = word.end - word.start;
    if (hold >= 0.35) {
      emphasisWordIds.push(word.id);
      energyPeaks.push({atSec: word.start, score: hold});
    }
    const next = words[i + 1];
    if (next && next.start - word.end >= 0.45) {
      pauses.push({start: word.end, end: next.start});
    }
  }
  return {pauses, emphasisWordIds, energyPeaks};
}

export function resolveWordRange(
  words: WordRef[],
  startWordId: string,
  endWordId: string,
  preRollMs = 0,
  postRollMs = 0,
): {start: number; end: number} | null {
  const byId = new Map(words.map(word => [word.id, word]));
  const startWord = byId.get(startWordId);
  const endWord = byId.get(endWordId);
  if (!startWord || !endWord) {
    return null;
  }
  const start = Math.max(0, startWord.start - preRollMs / 1000);
  const end = Math.max(start + 0.35, endWord.end + postRollMs / 1000);
  return {start, end};
}
