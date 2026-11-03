/**
 * MotionGraphicBrief: the self-contained request the Director hands the
 * motion-graphics worker. It says WHAT to show and in which kind of region;
 * timing in the edit (start/end) stays with the Director and is attached
 * later by toGeneratedGraphic().
 */

import {z} from 'zod';

import {textTreatmentSchema} from '../stages/textTreatment/textTreatment.ts';
import type {GeneratedGraphicPlacement, NormalizedBox} from '../types/blueprint.ts';

/** Graphics show short copy, not paragraphs. */
const MAX_CONTENT_STRING = 600;
/** Smaller PiPs cannot hold legible text. */
const MIN_PIP_SIZE = 0.12;

function longestString(value: unknown): number {
  if (typeof value === 'string') {
    return value.length;
  }
  if (value && typeof value === 'object') {
    return Math.max(0, ...Object.values(value).map(longestString));
  }
  return 0;
}

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'letters, digits, _ or -');

const unit = z.number().min(0).max(1);
const normalizedBoxSchema = z
  .object({x: unit, y: unit, w: z.number().gt(0).max(1), h: z.number().gt(0).max(1)})
  .refine(box => box.x + box.w <= 1.0001 && box.y + box.h <= 1.0001, 'box must stay inside the frame');

export const motionGraphicBriefSchema = z
  .object({
    id: idSchema,
    /** Why the graphic exists (what the viewer should take away). */
    goal: z.string().min(1).max(500),
    /** What it should look like and how it should move. */
    visualDescription: z.string().min(1).max(2000),
    placement: z.enum(['full_screen', 'split_screen', 'overlay', 'pip']),
    durationSeconds: z.number().min(0.5).max(60),
    /** Exact copy and data; passed to the graphic at render time as `content`. */
    content: z
      .record(z.string(), z.unknown())
      .refine(content => Object.keys(content).length > 0, 'content is empty: the graphic needs its copy/data')
      .refine(content => JSON.stringify(content).length <= 8_000, 'content larger than 8 KB')
      .refine(content => longestString(content) <= MAX_CONTENT_STRING, `a content string is longer than ${MAX_CONTENT_STRING} characters`),
    assets: z
      .array(
        z.object({
          id: idSchema,
          type: z.enum(['image', 'icon', 'video']),
          url: z.string().url().optional(),
          description: z.string().max(300).optional(),
        }),
      )
      .max(8)
      .default([]),
    designIntent: z
      .object({
        emphasis: z.array(z.string().max(200)).max(8).optional(),
        tone: z.string().max(200).optional(),
        hierarchy: z.string().max(500).optional(),
      })
      .optional(),
    constraints: z.array(z.string().max(300)).max(12).default([]),
    /** Optional structured text treatment (curved typography, masking). Delivered with the toolkit's primitives; see stages/textTreatment. */
    textTreatment: textTreatmentSchema.optional(),
    /** split_screen only: which half the graphic takes (the speaker gets the other). */
    graphicSide: z.enum(['top', 'bottom']).optional(),
    /** overlay (optional, default whole frame) and pip (required): frame-relative 0–1 box. */
    box: normalizedBoxSchema.optional(),
  })
  .superRefine((brief, ctx) => {
    const issue = (message: string, field: string) => ctx.addIssue({code: 'custom', message, path: [field]});
    if (brief.placement === 'split_screen' && !brief.graphicSide) {
      issue('split_screen needs graphicSide (top | bottom)', 'graphicSide');
    }
    if (brief.placement !== 'split_screen' && brief.graphicSide) {
      issue('graphicSide only applies to split_screen', 'graphicSide');
    }
    if (brief.placement === 'pip' && !brief.box) {
      issue('pip needs a box', 'box');
    }
    if (brief.placement === 'pip' && brief.box && (brief.box.w < MIN_PIP_SIZE || brief.box.h < MIN_PIP_SIZE)) {
      issue(`pip box must be at least ${MIN_PIP_SIZE} of the frame on each side`, 'box');
    }
    if ((brief.placement === 'full_screen' || brief.placement === 'split_screen') && brief.box) {
      issue('box only applies to overlay and pip', 'box');
    }
    brief.assets.forEach((asset, index) => {
      if (asset.type === 'image' && !asset.url) {
        ctx.addIssue({code: 'custom', message: 'image assets need a url', path: ['assets', index, 'url']});
      }
    });
  });

export type MotionGraphicBrief = z.infer<typeof motionGraphicBriefSchema>;
export type MotionGraphicBriefInput = z.input<typeof motionGraphicBriefSchema>;

export function parseBrief(input: unknown): MotionGraphicBrief {
  return motionGraphicBriefSchema.parse(input);
}

export function placementFor(brief: MotionGraphicBrief): GeneratedGraphicPlacement {
  switch (brief.placement) {
    case 'full_screen':
      return {mode: 'full_screen'};
    case 'split_screen':
      return {mode: 'split_screen', graphicSide: brief.graphicSide!};
    case 'overlay':
      return brief.box ? {mode: 'overlay', box: brief.box} : {mode: 'overlay'};
    case 'pip':
      return {mode: 'pip', box: brief.box!};
  }
}

export type Canvas = {width: number; height: number; fps: number};
export const DEFAULT_CANVAS: Canvas = {width: 1080, height: 1920, fps: 30};

/**
 * Pixel size of the region the graphic will be given. Mirrors regionFor() in
 * remotion/src/generated/placement.ts (split ratio 0.5); only used to tell the
 * author what to design for — the component always lays out from runtime props.
 */
export function regionSizeFor(brief: MotionGraphicBrief, canvas: Canvas): {width: number; height: number} {
  const {width: W, height: H} = canvas;
  if (brief.placement === 'full_screen') {
    return {width: W, height: H};
  }
  if (brief.placement === 'split_screen') {
    const top = Math.round(H * 0.5);
    return {width: W, height: brief.graphicSide === 'top' ? top : H - top};
  }
  const box: NormalizedBox = brief.box ?? {x: 0, y: 0, w: 1, h: 1};
  const x = Math.round(box.x * W);
  const y = Math.round(box.y * H);
  return {
    width: Math.max(1, Math.min(W - x, Math.round(box.w * W))),
    height: Math.max(1, Math.min(H - y, Math.round(box.h * H))),
  };
}

/** Image assets as the `assets` prop the toolkit expects ({[id]: {src}}). */
export function assetProps(brief: MotionGraphicBrief): Record<string, {src: string}> {
  return Object.fromEntries(
    brief.assets.filter(asset => asset.type === 'image' && asset.url).map(asset => [asset.id, {src: asset.url!}]),
  );
}
