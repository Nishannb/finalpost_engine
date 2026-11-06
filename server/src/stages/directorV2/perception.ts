/**
 * Stage 0 — perception pack. Facts only: words, frames, occupancy slices, audio.
 */

import {stageLogger} from '../../lib/logger.ts';
import {extractStillJpeg} from '../../media/ffmpeg.ts';
import type {CaptionWord, WordToken} from '../../types/blueprint.ts';
import type {Timeline} from '../filters/timeline.ts';
import {CAPTION_BAND, describeOccupancyForDirector, legalSlots, measureOccupancyAt, occupancyFromSpeaker, occupancySampleSec} from '../layout/occupancy.ts';
import {env} from '../../config/env.ts';
import {jobFlag} from '../../lib/effectiveFlags.ts';
import {LEGACY_FRAME_SEND_LIMIT, legacyOccupancySliceTimes, legacyStoryboardTimes} from './storyboardPlan.ts';
import {buildVisualContext, coverageFrameTimes, formatVisualContext, outputToSourceSec} from './visualContext.ts';
import type {PerceptionPack, WordRef} from './types.ts';

import {observe} from '../../lib/runObserver.ts';

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
  /** Override of VISUAL_CONTEXT_V2 (tests). */
  visualContext?: boolean;
  /** Duration of the decoded source file; with `primaryOccupancy` it places that measurement at its true time. */
  activeSourceDurationSec?: number;
  sourceSize?: {width: number; height: number} | null;
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
  const useVisualContext = input.visualContext ?? jobFlag('visualContextV2', env.VISUAL_CONTEXT_V2);
  const keepSegments = input.timeline.keepSegments;
  /**
   * Stills are cut from the (untrimmed) source file, but every time in this pack is an OUTPUT time on the silence-trimmed
   * timeline. Map output → source through the keep segments for BOTH paths. (The default path used to decode the file at
   * the output time, so every frame after a silence cut showed an instant earlier than its label.)
   */
  const decodeAt = (outputSec: number) => outputToSourceSec(keepSegments, outputSec);
  const sourceDurationSec = input.activeSourceDurationSec ?? keepSegments.at(-1)?.sourceEnd ?? duration;

  const storyboard: PerceptionPack['storyboard'] = [];
  const storyboardTimes = useVisualContext ? coverageFrameTimes(duration) : legacyStoryboardTimes(duration);
  for (const [i, atSec] of storyboardTimes.entries()) {
    const path = input.stillDir(`storyboard-${i}.jpg`);
    const sourceSec = decodeAt(atSec);
    try {
      await extractStillJpeg(input.sourcePath, path, sourceSec);
      storyboard.push({atSec, path, sourceSec});
    } catch (error) {
      log.warn({atSec, error}, 'storyboard still failed');
    }
  }

  const occupancySlices: PerceptionPack['occupancySlices'] = [];
  // The main occupancy frame was taken at occupancySampleSec(source duration) in SOURCE time, not at 0.4 s: record it where it
  // was taken on the output timeline. If that instant lies in a trimmed silence it cannot be placed and is not used.
  let primaryAt: number | null = null;
  if (input.primaryOccupancy) {
    primaryAt = input.timeline.mapSourceToOutput(occupancySampleSec(sourceDurationSec));
    if (primaryAt !== null) {
      occupancySlices.push({atSec: primaryAt, occupancy: input.primaryOccupancy});
    }
  }
  // Pinned by golden/legacy-frame-times.json: [0.4, 0.45·d, d − 0.6]. With a placed primary the 0.4 s slot is not re-measured
  // (the call count is unchanged: the primary replaces it). The visual-context path keeps its own extra 0.4 s measurement.
  const legacyTimes = legacyOccupancySliceTimes(duration);
  const wanted = useVisualContext
    ? [duration * 0.45, Math.max(0.6, duration - 0.6), ...(primaryAt === null ? [0.4] : [])]
    : input.primaryOccupancy
      ? legacyTimes.slice(1)
      : legacyTimes;
  for (const [index, atSec] of wanted.entries()) {
    const occupancy = await measureOccupancyAt({
      sourcePath: input.sourcePath,
      durationSec: sourceDurationSec,
      stillPath: input.stillDir(`occ-${index}.jpg`),
      atSec: decodeAt(atSec),
    });
    occupancySlices.push({atSec, occupancy});
  }
  occupancySlices.sort((a, b) => a.atSec - b.atSec);
  if (occupancySlices.length === 0) {
    occupancySlices.push({
      atSec: 0.4,
      occupancy: occupancyFromSpeaker({x: 0.18, y: 0.16, w: 0.64, h: 0.62}, 'fallback'),
    });
  }

  const denseSlices = expandOccupancySlices(occupancySlices, duration);

  log.info({ms: Date.now() - started, words: words.length, frames: storyboard.length}, 'perception pack');
  const pack: PerceptionPack = {
    words,
    sentences,
    storyboard,
    occupancySlices: denseSlices,
    occupancyMeasurements: occupancySlices.map(slice => ({atSec: slice.atSec, source: slice.occupancy.source})),
    occupancyMeasured: occupancySlices,
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
    ...(useVisualContext
      ? {
          measuredOccupancy: occupancySlices,
          visualContext: buildVisualContext({
            durationSec: duration,
            keepSegments,
            storyboardOutputSec: storyboard.map(frame => frame.atSec),
            occupancy: occupancySlices.map(slice => ({outputSec: slice.atSec, occupancy: slice.occupancy})),
            sourceSize: input.sourceSize ?? null,
            sentWidthPx: 720,
          }),
        }
      : {}),
  };
  observe(() => ({type: 'perception_pack', pack}));
  return pack;
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

/**
 * The storyboard frames the Director actually receives as images, in attachment order. The labels, the frame list and the
 * image attachment all come from THIS list, so a label can never describe a frame that was not sent.
 * Default path: the first LEGACY_FRAME_SEND_LIMIT (8) frames (the request budget is unchanged); the 2 extra stills the
 * legacy sampler cuts are never attached and are therefore never labelled. VISUAL_CONTEXT_V2: all frames it chose.
 */
export function framesSentToDirector(pack: PerceptionPack): PerceptionPack['storyboard'] {
  return pack.storyboard.slice(0, frameSendLimit(pack));
}

export function formatFrameLabels(pack: PerceptionPack): string {
  const sent = framesSentToDirector(pack);
  if (sent.length === 0) {
    return 'No storyboard frames attached.';
  }
  const labels = sent
    .map((frame, index) => `frame ${index} @ ${frame.atSec.toFixed(2)}s${frame.note ? ` — ${frame.note}` : ''}`)
    .join('\n');
  return pack.visualContext ? `${labels}\n\n${formatVisualContext(pack.visualContext)}` : labels;
}

/** Number of images attached: all frames when the visual context chose the spread, else the legacy budget. */
export function frameSendLimit(pack: PerceptionPack): number {
  return pack.visualContext ? pack.storyboard.length : LEGACY_FRAME_SEND_LIMIT;
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

/** The time span the measurements actually cover, and the regions outside it where nothing was measured. */
export function measuredSpanSentence(times: number[], durationSec: number): string {
  const sorted = [...times].sort((a, b) => a - b);
  const first = sorted[0]!;
  const last = sorted.at(-1)!;
  const gaps = [
    ...(first > 0.5 ? [`before ${first.toFixed(1)}s`] : []),
    ...(durationSec - last > 0.5 ? [`after ${last.toFixed(1)}s`] : []),
  ];
  return `measurements span ${first.toFixed(1)}–${last.toFixed(1)}s${gaps.length > 0 ? `; nothing was measured ${gaps.join(' or ')}` : ''}`;
}

/** Estimated face region: 42 % of the person-box height. Never printed as a measurement. */
const estimatedFace = (speaker: {x: number; y: number; w: number; h: number}) => `${speaker.x.toFixed(2)},${speaker.y.toFixed(2)},${speaker.w.toFixed(2)},${(speaker.h * 0.42).toFixed(2)}`;

/** Time ranges (output seconds) that contain no measurement: before the first, between, and after the last. */
export function unobservedRanges(times: number[], durationSec: number): Array<{start: number; end: number}> {
  const sorted = [...times].sort((a, b) => a - b);
  const out: Array<{start: number; end: number}> = [];
  let cursor = 0;
  for (const t of sorted) {
    if (t - cursor > 0.05) {
      out.push({start: cursor, end: t});
    }
    cursor = t;
  }
  if (durationSec - cursor > 0.05) {
    out.push({start: cursor, end: durationSec});
  }
  return out;
}

/**
 * OCCUPANCY_CONTEXT_V2: only the independent measurements, each at its own instant, each labelled detected or default; the
 * face box shown only as a labelled estimate; the covered span; and the time ranges that were NOT observed. No line repeats a
 * measurement, and nothing says the nearest measurement applies elsewhere.
 */
export function formatOccupancyContextV2(pack: PerceptionPack): string {
  const measured = pack.occupancyMeasured ?? pack.measuredOccupancy ?? [];
  const duration = pack.outputDurationSec || pack.occupancySlices.at(-1)?.atSec || 0;
  if (measured.length === 0) {
    return 'OCCUPANCY: no speaker measurement exists. The speaker position, the face and the safe slots are unknown at every time; do not assume them.\nCAPTION_BAND y>=' + CAPTION_BAND.y.toFixed(2) + ' is reserved.';
  }
  const lines = measured.map(slice => {
    const slots = legalSlots(slice.occupancy).map(slot => slot.id).join(', ');
    const {speaker, source} = slice.occupancy;
    const tail = `LEGAL_SLOTS=[${slots || 'none'}] CAPTION_BAND y>=${CAPTION_BAND.y.toFixed(2)}`;
    return source === 'vision'
      ? `@${slice.atSec.toFixed(2)}s speaker box DETECTED: ${speaker.x.toFixed(2)},${speaker.y.toFixed(2)},${speaker.w.toFixed(2)},${speaker.h.toFixed(2)} (this instant only; confidence not given) | face box ESTIMATE, not measured (42% of the person-box height): ${estimatedFace(speaker)} | ${tail}`
      : `@${slice.atSec.toFixed(2)}s speaker position UNKNOWN: detection failed; a conservative DEFAULT box (${speaker.x.toFixed(2)},${speaker.y.toFixed(2)},${speaker.w.toFixed(2)},${speaker.h.toFixed(2)}) is used only to choose safe slots, it is not the speaker's position | no face information | ${tail}`;
  });
  const unobserved = unobservedRanges(measured.map(slice => slice.atSec), duration);
  return [
    `OCCUPANCY (${measured.length} independent measurement${measured.length === 1 ? '' : 's'}; each line is a different instant; no line repeats another):`,
    ...lines,
    '',
    `${measuredSpanSentence(measured.map(slice => slice.atSec), duration)}.`,
    `NOT OBSERVED (no measurement; the speaker position, face and visibility are unknown here, and must not be assumed to match the nearest measurement): ${unobserved.map(range => `${range.start.toFixed(1)}–${range.end.toFixed(1)}s`).join(', ') || 'none'}.`,
  ].join('\n');
}

export function formatOccupancySlices(pack: PerceptionPack): string {
  if (pack.occupancySlices.length === 0) {
    return 'No occupancy slices.';
  }
  if (jobFlag('occupancyContextV2', env.OCCUPANCY_CONTEXT_V2)) {
    return formatOccupancyContextV2(pack);
  }
  if (pack.measuredOccupancy) {
    // VISUAL_CONTEXT_V2: report only what was measured, at the time it was measured. The 0.5 s slices in
    // `occupancySlices` are nearest-neighbour COPIES of these, and a fallback box is a default, not a measurement.
    const lines = pack.measuredOccupancy.map(slice => {
      const slots = legalSlots(slice.occupancy).map(slot => slot.id).join(', ');
      const {speaker, source} = slice.occupancy;
      const where =
        source === 'vision'
          ? `speaker box measured: ${speaker.x.toFixed(2)},${speaker.y.toFixed(2)},${speaker.w.toFixed(2)},${speaker.h.toFixed(2)} (this instant only)`
          : 'speaker position UNKNOWN (detection unavailable; a conservative default box is used only to choose safe slots)';
      return `@${slice.atSec.toFixed(2)}s ${where} LEGAL_SLOTS=[${slots || 'none'}] CAPTION_BAND y>=${CAPTION_BAND.y.toFixed(2)}`;
    });
    const span = measuredSpanSentence(pack.measuredOccupancy.map(slice => slice.atSec), pack.occupancySlices.at(-1)?.atSec ?? 0);
    return `${lines.join('\n')}\n\nBetween these instants the speaker position is unknown; ${span}.\n\n${describeOccupancyForDirector(pack.measuredOccupancy[0]!.occupancy)}`;
  }
  const sample = pack.occupancySlices.filter((_, index) => index % 2 === 0).slice(0, 16);
  // The lines below keep their structure (the prompt template describes them), but the data is a dense COPY of a few
  // measurements with an ESTIMATED face box and a capped length. Say so once, up front, so none of it reads as observed.
  const measurements = pack.occupancyMeasurements ?? [];
  const lastSlice = pack.occupancySlices.at(-1)?.atSec ?? 0;
  const lastShown = sample.at(-1)?.atSec ?? 0;
  const noteParts = [
    ...(measurements.length > 0
      ? [
          `only ${measurements.length} speaker measurement${measurements.length === 1 ? ' exists' : 's exist'} (${measurements
            .map(item => `${item.atSec.toFixed(1)}s ${item.source === 'vision' ? 'detected' : 'DEFAULT BOX, speaker not detected'}`)
            .join('; ')}); every line below repeats the nearest one and is NOT an independent observation`,
        ]
      : ['the lines below are copies of a few measurements, not independent observations']),
    ...(measurements.length > 0 ? [measuredSpanSentence(measurements.map(item => item.atSec), lastSlice)] : []),
    'face= is an estimate (42% of the person-box height), not a detection',
    ...(lastSlice - lastShown > 1 ? [`the lines cover 0.0–${lastShown.toFixed(1)}s of ${lastSlice.toFixed(1)}s; later times are not listed`] : []),
  ];
  const note = `NOTE: ${noteParts.join('. ')}.\n`;
  return (
    note +
    sample
      .map(slice => {
        const {speaker} = slice.occupancy;
        const slots = legalSlots(slice.occupancy)
          .map(slot => slot.id)
          .join(', ');
        return (
          `@${slice.atSec.toFixed(2)}s speaker=${speaker.x.toFixed(2)},${speaker.y.toFixed(2)},${speaker.w.toFixed(2)},${speaker.h.toFixed(2)} ` +
          // Legacy printed an invented face box (42 % of the person box); the visual-context path does not claim one.
          (pack.visualContext ? '' : `face=${speaker.x.toFixed(2)},${speaker.y.toFixed(2)},${speaker.w.toFixed(2)},${(speaker.h * 0.42).toFixed(2)} `) +
          `LEGAL_SLOTS=[${slots || 'none'}] CAPTION_BAND y>=${CAPTION_BAND.y.toFixed(2)}` +
          (slice.occupancy.source === 'fallback' ? ' [DEFAULT BOX — speaker not detected]' : '')
        );
      })
      .join('\n') +
    `\n\n${describeOccupancyForDirector(pack.occupancySlices[0]!.occupancy)}`
  );
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
