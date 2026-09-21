/**
 * Detect whether the talking-head can be keyed off a plain backdrop, then
 * describe that tool for the director. The cutout video itself is extracted
 * later only if the director actually uses layout=cutout.
 */

import {stageLogger} from '../../lib/logger.ts';
import {sampleStillPatch} from '../../media/ffmpeg.ts';

const log = stageLogger('speaker-cutout');

export type SpeakerCutout = {
  available: boolean;
  keyColor: string;
  similarity: number;
  blend: number;
  videoUrl?: string;
  speaker?: {x: number; y: number; w: number; h: number};
};

export type RgbSample = {r: number; g: number; b: number};

export function cutoutFromSamples(input: {
  corners: RgbSample[];
  center: RgbSample;
}): SpeakerCutout {
  if (input.corners.length < 3) {
    return {
      available: false,
      keyColor: '#000000',
      similarity: 0.12,
      blend: 0.06,
    };
  }
  const mean = average(input.corners);
  const spread = input.corners.reduce((sum, sample) => sum + distance(sample, mean), 0) /
    input.corners.length;
  const centerGap = distance(input.center, mean);
  const available = spread < 0.14 && centerGap > 0.08;
  return {
    available,
    keyColor: toHex(mean),
    similarity: available ? clamp(0.1 + spread * 0.6, 0.1, 0.22) : 0.12,
    blend: 0.06,
  };
}

export async function detectSpeakerCutout(stillPath: string): Promise<SpeakerCutout> {
  try {
    const corners = await Promise.all([
      sampleStillPatch(stillPath, 0.04, 0.04),
      sampleStillPatch(stillPath, 0.9, 0.04),
      sampleStillPatch(stillPath, 0.04, 0.9),
      sampleStillPatch(stillPath, 0.9, 0.9),
      sampleStillPatch(stillPath, 0.5, 0.04),
    ]);
    const center = await sampleStillPatch(stillPath, 0.5, 0.42);
    const detected = cutoutFromSamples({corners, center});
    log.info(
      {available: detected.available, keyColor: detected.keyColor},
      'speaker cutout probe',
    );
    return detected;
  } catch (error) {
    log.warn({error}, 'speaker cutout probe failed');
    return {
      available: false,
      keyColor: '#000000',
      similarity: 0.12,
      blend: 0.06,
    };
  }
}

export function describeCutoutForDirector(cutout: SpeakerCutout): string {
  if (!cutout.available) {
    return 'SPEAKER_CUTOUT: not available (busy background). Do not use layout=cutout.';
  }
  return [
    'SPEAKER_CUTOUT: available. The creator can be keyed off the backdrop.',
    'layout=cutout: B-roll or a designed canvas fills the frame; the creator stands in front as a cut-out (like a product/order explainer over chat cards).',
    `key_color=${cutout.keyColor}. Use this when speech is about messages, orders, products, screens, or proof — not on every video.`,
  ].join(' ');
}

export function ffmpegKeyColor(hex: string): string {
  return hex.replace('#', '0x').toUpperCase();
}

function average(samples: RgbSample[]): RgbSample {
  const n = samples.length || 1;
  return {
    r: samples.reduce((sum, sample) => sum + sample.r, 0) / n,
    g: samples.reduce((sum, sample) => sum + sample.g, 0) / n,
    b: samples.reduce((sum, sample) => sum + sample.b, 0) / n,
  };
}

function distance(a: RgbSample, b: RgbSample): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

function toHex(sample: RgbSample): string {
  const hex = (value: number) =>
    Math.round(clamp(value, 0, 1) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${hex(sample.r)}${hex(sample.g)}${hex(sample.b)}`.toUpperCase();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
