/**
 * Speaker occupancy from real stills — the compositor refuses to draw
 * graphics on the person. Gemini Vision reads 1–2 frames; if that fails we
 * still return a conservative speaker box rather than covering mid-frame.
 */

import {promises as fs} from 'node:fs';

import {env} from '../../config/env.ts';
import {requestJson} from '../../lib/http.ts';
import {stageLogger} from '../../lib/logger.ts';
import {extractStillJpeg} from '../../media/ffmpeg.ts';
import type {MotionAnchor, VisualAnchor} from '../../types/blueprint.ts';

const log = stageLogger('occupancy');

export type NormRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type Occupancy = {
  speaker: NormRect;
  preferredSide: 'left' | 'right';
  graphicAnchor: MotionAnchor;
  overlayAnchor: VisualAnchor;
  source: 'vision' | 'fallback';
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {parts?: Array<{text?: string}>};
  }>;
};

export const CAPTION_BAND: NormRect = {x: 0, y: 0.76, w: 1, h: 0.24};

/** Corner title box — small enough to miss a centered talking head. */
export function hookRectForAnchor(anchor: MotionAnchor | VisualAnchor): NormRect {
  if (anchor === 'top_left' || anchor === 'top') {
    return {x: 0.04, y: 0.05, w: 0.36, h: 0.15};
  }
  if (anchor === 'top_right') {
    return {x: 0.6, y: 0.05, w: 0.36, h: 0.15};
  }
  if (anchor === 'bottom_left') {
    return {x: 0.04, y: 0.56, w: 0.32, h: 0.14};
  }
  if (anchor === 'bottom_right' || anchor === 'bottom') {
    return {x: 0.64, y: 0.56, w: 0.32, h: 0.14};
  }
  return {x: 0.6, y: 0.05, w: 0.36, h: 0.15};
}

export async function measureOccupancy(input: {
  sourcePath: string;
  durationSec: number;
  stillPath: string;
}): Promise<Occupancy> {
  const at = Math.max(0.4, Math.min(input.durationSec * 0.28, input.durationSec - 0.4));
  try {
    await extractStillJpeg(input.sourcePath, input.stillPath, at);
    const vision = await detectSpeakerFromStill(input.stillPath);
    if (vision) {
      return occupancyFromSpeaker(vision, 'vision');
    }
  } catch (error) {
    log.warn({error}, 'occupancy vision failed; using conservative speaker box');
  }
  return occupancyFromSpeaker({x: 0.18, y: 0.16, w: 0.64, h: 0.62}, 'fallback');
}

export async function measureOccupancyAt(input: {
  sourcePath: string;
  durationSec: number;
  stillPath: string;
  atSec: number;
}): Promise<Occupancy> {
  const at = Math.max(0.2, Math.min(input.atSec, input.durationSec - 0.2));
  try {
    await extractStillJpeg(input.sourcePath, input.stillPath, at);
    const vision = await detectSpeakerFromStill(input.stillPath);
    if (vision) {
      return occupancyFromSpeaker(vision, 'vision');
    }
  } catch (error) {
    log.warn({error, at}, 'occupancy slice failed; using conservative speaker box');
  }
  return occupancyFromSpeaker({x: 0.18, y: 0.16, w: 0.64, h: 0.62}, 'fallback');
}

export function occupancyFromSpeaker(
  speaker: NormRect,
  source: Occupancy['source'],
): Occupancy {
  const box = clampRect(speaker);
  const leftGap = box.x;
  const rightGap = 1 - (box.x + box.w);
  const preferredSide: 'left' | 'right' = rightGap >= leftGap ? 'right' : 'left';
  const graphicAnchor: MotionAnchor =
    preferredSide === 'right' ? 'top_right' : 'top_left';
  const overlayAnchor: VisualAnchor =
    preferredSide === 'right' ? 'top_right' : 'top_left';
  return {speaker: box, preferredSide, graphicAnchor, overlayAnchor, source};
}

export type LegalSlot = {
  id: string;
  anchor: VisualAnchor;
  rect: NormRect;
  size: 'accent' | 'hero';
  kind: 'graphic' | 'card' | 'emphasis' | 'pip';
};

/** Corner/edge boxes that do not sit on the speaker or the caption band. */
export function legalSlots(occupancy: Occupancy): LegalSlot[] {
  const paddedSpeaker = inflate(occupancy.speaker, 0.04);
  const candidates: LegalSlot[] = [
    {
      id: 'card_tr',
      anchor: 'top_right',
      rect: {x: 0.62, y: 0.055, w: 0.34, h: 0.2},
      size: 'accent',
      kind: 'card',
    },
    {
      id: 'card_tl',
      anchor: 'top_left',
      rect: {x: 0.04, y: 0.055, w: 0.34, h: 0.2},
      size: 'accent',
      kind: 'card',
    },
    {
      id: 'emph_tr',
      anchor: 'top_right',
      rect: {x: 0.52, y: 0.08, w: 0.44, h: 0.14},
      size: 'accent',
      kind: 'emphasis',
    },
    {
      id: 'emph_tl',
      anchor: 'top_left',
      rect: {x: 0.04, y: 0.08, w: 0.44, h: 0.14},
      size: 'accent',
      kind: 'emphasis',
    },
    {
      id: 'pip_br',
      anchor: 'bottom_right',
      rect: {x: 0.68, y: 0.46, w: 0.28, h: 0.24},
      size: 'accent',
      kind: 'pip',
    },
    {
      id: 'pip_bl',
      anchor: 'bottom_left',
      rect: {x: 0.04, y: 0.46, w: 0.28, h: 0.24},
      size: 'accent',
      kind: 'pip',
    },
    {
      id: 'pip_tr',
      anchor: 'top_right',
      rect: {x: 0.68, y: 0.08, w: 0.28, h: 0.24},
      size: 'accent',
      kind: 'pip',
    },
    {
      id: 'pip_tl',
      anchor: 'top_left',
      rect: {x: 0.04, y: 0.08, w: 0.28, h: 0.24},
      size: 'accent',
      kind: 'pip',
    },
    {
      id: 'hero_left',
      anchor: 'top_left',
      rect: {x: 0.04, y: 0.08, w: 0.66, h: 0.54},
      size: 'hero',
      kind: 'card',
    },
    {
      id: 'hero_right',
      anchor: 'top_right',
      rect: {x: 0.3, y: 0.08, w: 0.66, h: 0.54},
      size: 'hero',
      kind: 'card',
    },
  ];
  return candidates.filter(slot => {
    if (slot.size === 'hero') {
      return true;
    }
    if (rectsOverlap(slot.rect, CAPTION_BAND)) {
      return false;
    }
    return overlapArea(slot.rect, paddedSpeaker) < 0.025;
  });
}

export function describeOccupancyForDirector(occupancy: Occupancy): string {
  const {speaker} = occupancy;
  const slots = legalSlots(occupancy);
  const accent = slots.filter(slot => slot.size === 'accent');
  const pip = slots.filter(slot => slot.kind === 'pip');
  const lines = [
    'FRAME_OCCUPANCY (9:16 fractions). Never cover the speaker box with graphics, cards, titles, or emphasis.',
    `speaker_box: x=${fmt(speaker.x)} y=${fmt(speaker.y)} w=${fmt(speaker.w)} h=${fmt(speaker.h)} source=${occupancy.source}`,
    `open_side: ${occupancy.preferredSide}`,
    'LEGAL_SLOTS (accent overlays only):',
    ...(accent.length > 0
      ? accent.map(
          slot =>
            `- ${slot.id} kind=${slot.kind} anchor=${slot.anchor} rect=${fmt(slot.rect.x)},${fmt(slot.rect.y)},${fmt(slot.rect.w)},${fmt(slot.rect.h)}`,
        )
      : ['- none; keep the talking-head full-bleed and use cutaways instead of shrinking it']),
    'media_containers are optional. pip_corner is legal ONLY when timed hero cards/graphics fill the leftover canvas. An empty canvas (plain white/color with a small speaker tile) is a failed edit — keep full-bleed.',
    pip.length > 0
      ? `optional_pip_slots (above captions): ${pip.map(slot => slot.anchor).join(', ')}`
      : 'optional_pip_slots: none',
    'CAPTION_BAND y>=0.76 is reserved. Titles, cards, and pip tiles must end above y=0.72.',
  ];
  return lines.join('\n');
}

function fmt(value: number): string {
  return value.toFixed(2);
}

export function rectsOverlap(a: NormRect, b: NormRect, pad = 0): boolean {
  return (
    a.x - pad < b.x + b.w &&
    a.x + a.w + pad > b.x &&
    a.y - pad < b.y + b.h &&
    a.y + a.h + pad > b.y
  );
}

export function slotRectForAnchor(anchor: MotionAnchor | VisualAnchor): NormRect {
  // Narrow side columns — full-width top bars always hit a talking-head face.
  if (anchor === 'top_left' || anchor === 'top') {
    return {x: 0.03, y: 0.07, w: 0.3, h: 0.18};
  }
  if (anchor === 'top_right') {
    return {x: 0.67, y: 0.07, w: 0.3, h: 0.18};
  }
  if (anchor === 'bottom_left') {
    return {x: 0.03, y: 0.56, w: 0.3, h: 0.16};
  }
  if (anchor === 'bottom_right' || anchor === 'bottom') {
    return {x: 0.67, y: 0.56, w: 0.3, h: 0.16};
  }
  return {x: 0.67, y: 0.07, w: 0.3, h: 0.18};
}

export function overlapArea(a: NormRect, b: NormRect): number {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return x * y;
}

export function legalHookAnchor(occupancy: Occupancy): VisualAnchor {
  const paddedSpeaker = inflate(occupancy.speaker, 0.04);
  const candidates: VisualAnchor[] = [
    occupancy.overlayAnchor,
    'top_right',
    'top_left',
  ];
  let best: VisualAnchor = occupancy.overlayAnchor;
  let bestOverlap = Number.POSITIVE_INFINITY;
  for (const anchor of candidates) {
    const slot = hookRectForAnchor(anchor);
    if (rectsOverlap(slot, CAPTION_BAND)) {
      continue;
    }
    const overlap = overlapArea(slot, paddedSpeaker);
    if (overlap < bestOverlap) {
      bestOverlap = overlap;
      best = anchor;
    }
  }
  return best;
}

export function legalGraphicAnchor(occupancy: Occupancy): MotionAnchor {
  const paddedSpeaker = inflate(occupancy.speaker, 0.03);
  const candidates: MotionAnchor[] = [
    occupancy.graphicAnchor,
    'top_right',
    'top_left',
    'bottom_right',
    'bottom_left',
  ];
  let best: MotionAnchor = occupancy.graphicAnchor;
  let bestOverlap = Number.POSITIVE_INFINITY;
  for (const anchor of candidates) {
    const slot = slotRectForAnchor(anchor);
    if (rectsOverlap(slot, CAPTION_BAND)) {
      continue;
    }
    const overlap = overlapArea(slot, paddedSpeaker);
    if (overlap < bestOverlap) {
      bestOverlap = overlap;
      best = anchor;
    }
  }
  return best;
}

function inflate(rect: NormRect, pad: number): NormRect {
  return clampRect({
    x: rect.x - pad,
    y: rect.y - pad,
    w: rect.w + pad * 2,
    h: rect.h + pad * 2,
  });
}

function clampRect(rect: NormRect): NormRect {
  const x = clamp01(rect.x);
  const y = clamp01(rect.y);
  const w = Math.max(0.12, Math.min(1 - x, rect.w));
  const h = Math.max(0.12, Math.min(1 - y, rect.h));
  return {x, y, w, h};
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

async function detectSpeakerFromStill(jpegPath: string): Promise<NormRect | null> {
  if (!env.GEMINI_API_KEY) {
    return null;
  }
  const jpeg = await fs.readFile(jpegPath);
  const model = env.GEMINI_MODEL || 'gemini-3.6-flash';
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(model)}:generateContent`;

  const body = await requestJson<GeminiResponse>(url, {
    method: 'POST',
    label: 'Gemini speaker occupancy',
    failureCode: 'broll_failed',
    timeoutMs: 25_000,
    retries: 1,
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: jpeg.toString('base64'),
              },
            },
            {
              text:
                'Vertical talking-head video frame. Return ONLY JSON:\n' +
                '{"x":0-1,"y":0-1,"w":0-1,"h":0-1}\n' +
                'Axis-aligned box around the PERSON (head + torso), fractions of the frame.\n' +
                'No markdown.',
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 80,
      },
    }),
  });

  const text = body.candidates?.[0]?.content?.parts
    ?.map(part => part.text ?? '')
    .join(' ')
    .trim();
  return parseSpeakerJson(text);
}

export function parseSpeakerJson(raw: string | undefined): NormRect | null {
  if (!raw) {
    return null;
  }
  const json = raw.replace(/```json|```/g, '').trim();
  const match = json.match(/\{[\s\S]*\}/);
  if (!match) {
    return null;
  }
  try {
    const record = JSON.parse(match[0]) as Record<string, unknown>;
    const x = Number(record.x);
    const y = Number(record.y);
    const w = Number(record.w ?? record.width);
    const h = Number(record.h ?? record.height);
    if (![x, y, w, h].every(Number.isFinite)) {
      return null;
    }
    return clampRect({x, y, w, h});
  } catch {
    return null;
  }
}
