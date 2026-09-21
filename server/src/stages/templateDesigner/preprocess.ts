/**
 * Sample frames, transcript, and scene cuts for the Template Designer.
 * Configurable interval — do not dump every frame into the model.
 */

import {env} from '../../config/env.ts';
import {stageLogger} from '../../lib/logger.ts';
import {
  detectSceneCuts,
  extractSpeechAudio,
  extractStillJpeg,
  probeMedia,
} from '../../media/ffmpeg.ts';
import {transcribeAudio} from '../transcribe/groqTranscribe.ts';
import type {WordToken} from '../../types/blueprint.ts';

const log = stageLogger('template-designer-preprocess');

export type DesignerFrame = {
  atSec: number;
  path: string;
  reason: 'interval' | 'scene' | 'speech';
};

export type DesignerPreprocess = {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  transcript: string;
  words: WordToken[];
  phrases: Array<{text: string; start: number; end: number}>;
  frames: DesignerFrame[];
  sceneCutsSec: number[];
  asrCostUsd: number;
};

function phraseBoundaries(words: WordToken[]): Array<{text: string; start: number; end: number}> {
  const phrases: Array<{text: string; start: number; end: number}> = [];
  let bucket: WordToken[] = [];
  const flush = () => {
    if (!bucket.length) {
      return;
    }
    phrases.push({
      text: bucket.map(w => w.text).join(' '),
      start: bucket[0].start,
      end: bucket[bucket.length - 1].end,
    });
    bucket = [];
  };
  for (const word of words) {
    bucket.push(word);
    if (/[.!?,]$/.test(word.text) || bucket.length >= 6) {
      flush();
    }
  }
  flush();
  return phrases;
}

export async function preprocessReferenceVideo(input: {
  sourcePath: string;
  stillPath: (name: string) => string;
}): Promise<DesignerPreprocess> {
  const probe = await probeMedia(input.sourcePath);
  const interval = Math.max(0.4, env.TEMPLATE_DESIGNER_FRAME_INTERVAL_SEC);
  const maxFrames = Math.max(8, Math.min(48, env.TEMPLATE_DESIGNER_MAX_FRAMES));
  const sceneCuts = (await detectSceneCuts(input.sourcePath)).filter(
    t => t > 0.2 && t < probe.durationSec - 0.2,
  );

  let words: WordToken[] = [];
  let transcript = '';
  let asrCostUsd = 0;
  if (probe.hasAudio) {
    try {
      const speech = await extractSpeechAudio(
        input.sourcePath,
        input.stillPath('speech.ogg'),
      );
      const transcription = await transcribeAudio({
        audioPath: speech.path,
        audioBytes: speech.bytes,
        languageCode: 'auto',
        durationSec: probe.durationSec,
      });
      words = transcription.words;
      transcript = transcription.transcript;
      asrCostUsd = transcription.estimatedCostUsd;
    } catch (error) {
      log.warn({error}, 'template designer transcript failed');
    }
  }

  const wanted = new Map<number, DesignerFrame['reason']>();
  const add = (at: number, reason: DesignerFrame['reason']) => {
    const t = Math.max(0.15, Math.min(probe.durationSec - 0.15, at));
    const key = Math.round(t * 10) / 10;
    if (!wanted.has(key) || reason !== 'interval') {
      wanted.set(key, reason);
    }
  };

  for (let t = 0.4; t < probe.durationSec; t += interval) {
    add(t, 'interval');
  }
  for (const cut of sceneCuts.slice(0, 12)) {
    add(cut, 'scene');
    add(cut + 0.18, 'scene');
  }
  for (const word of words) {
    if (word.text.replace(/[^A-Za-z]/g, '').length >= 7) {
      add((word.start + word.end) / 2, 'speech');
    }
  }

  const ordered = [...wanted.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(0, maxFrames);

  const frames: DesignerFrame[] = [];
  for (const [index, [atSec, reason]] of ordered.entries()) {
    const path = input.stillPath(`td-${index}.jpg`);
    try {
      await extractStillJpeg(input.sourcePath, path, atSec);
      frames.push({atSec, path, reason});
    } catch (error) {
      log.warn({atSec, error}, 'template designer still failed');
    }
  }

  return {
    durationSec: probe.durationSec,
    width: probe.width,
    height: probe.height,
    fps: probe.fps || 30,
    transcript,
    words,
    phrases: phraseBoundaries(words),
    frames,
    sceneCutsSec: sceneCuts.slice(0, 24),
    asrCostUsd,
  };
}
