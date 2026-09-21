/**
 * Operations the AI Template Designer may emit.
 * Every id maps onto something Remotion already renders — do not invent new ones.
 */

import {CAPTION_TEMPLATES} from '../types/blueprint.ts';
import {CAPTION_IN_TYPES, EMPHASIS_TRIGGERS} from '../types/editSpec.ts';

export const MOTION_PRIMITIVES = {
  caption: [
    'caption.word_pop',
    'caption.phrase_pop',
    'caption.fade',
    'caption.slide',
    'caption.typewriter',
    'caption.highlight',
    'caption.box_highlight',
    'caption.underline',
    'caption.karaoke',
    'caption.pill',
    'caption.slam',
    'caption.weight_shift',
  ],
  text: ['text.scale', 'text.fade', 'text.bounce', 'text.shake'],
  camera: ['camera.zoom', 'camera.none'],
  transition: ['transition.cut'],
} as const;

export type MotionPrimitiveId =
  | (typeof MOTION_PRIMITIVES.caption)[number]
  | (typeof MOTION_PRIMITIVES.text)[number]
  | (typeof MOTION_PRIMITIVES.camera)[number]
  | (typeof MOTION_PRIMITIVES.transition)[number];

const ALL = new Set<string>([
  ...MOTION_PRIMITIVES.caption,
  ...MOTION_PRIMITIVES.text,
  ...MOTION_PRIMITIVES.camera,
  ...MOTION_PRIMITIVES.transition,
]);

export function isAllowedMotionPrimitive(id: string): boolean {
  return ALL.has(id.trim());
}

/** Prompt appendix: only these operations exist in the renderer today. */
export function formatMotionPrimitiveRegistry(): string {
  return [
    'FINALPOST MOTION PRIMITIVE REGISTRY (use only these):',
    `caption templates: ${CAPTION_TEMPLATES.join(', ')}`,
    `caption in types: ${CAPTION_IN_TYPES.join(', ')}`,
    `emphasis triggers: ${EMPHASIS_TRIGGERS.join(', ')}`,
    `caption ops: ${MOTION_PRIMITIVES.caption.join(', ')}`,
    `text ops: ${MOTION_PRIMITIVES.text.join(', ')}`,
    `camera ops: ${MOTION_PRIMITIVES.camera.join(', ')}`,
    `transitions: ${MOTION_PRIMITIVES.transition.join(', ')}`,
    'If the reference uses something else, pick the closest supported primitive.',
  ].join('\n');
}
