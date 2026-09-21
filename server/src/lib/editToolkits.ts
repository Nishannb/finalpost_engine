/**
 * Edit-toolkit registry for the AI Director and first-video CLI.
 *
 * The Director decides WHERE and WITH WHAT a toolkit is used. Passing
 * `--edits=cutaway,inset_reveal` requires those toolkits to be placed (the
 * Director still chooses WHERE). Omit `--edits` for the lean pipeline
 * (captions, auto-trim, auto-zoom, hook title). `--full-edits` or `--edits=all`
 * unlocks every toolkit. Hook title and zoom are director-owned; the engine never fills them.
 */

import {CAPTION_TEMPLATES, type CaptionTemplateId} from '../types/blueprint.ts';
import {INSET_GRAPHIC_TEMPLATES} from './insetReveal.ts';

export type EditToolkitCategory =
  | 'visual'
  | 'caption'
  | 'grade'
  | 'audio'
  | 'cta'
  | 'always';

export type EditToolkit = {
  id: string;
  aliases: string[];
  category: EditToolkitCategory;
  /** Director v2 element kinds this toolkit maps to (empty if not an element). */
  directorKinds: string[];
  /** v1 director moment layouts this toolkit maps to. */
  layouts: string[];
  description: string;
};

export const EDIT_TOOLKITS: EditToolkit[] = [
  {
    id: 'hook_title',
    aliases: ['hook', 'title'],
    category: 'visual',
    directorKinds: ['hook_title'],
    layouts: [],
    description: 'Opening title card timed to the first spoken words.',
  },
  {
    id: 'captions',
    aliases: ['caption', 'caption_style', 'caption-style', 'caption_template'],
    category: 'caption',
    directorKinds: [],
    layouts: [],
    description:
      'Burned captions. Always on. Pass --captions=<template> to pick the kinetic look.',
  },
  {
    id: 'cutaway',
    aliases: ['broll', 'b-roll', 'b_roll', 'brolls'],
    category: 'visual',
    directorKinds: ['cutaway'],
    layouts: ['cutaway'],
    description: 'Full-frame B-roll that cuts away from (or covers) the speaker.',
  },
  {
    id: 'split',
    aliases: ['split_screen', 'split-screen'],
    category: 'visual',
    directorKinds: ['split'],
    layouts: ['split'],
    description: 'Animated split-screen: speaker plus a related visual.',
  },
  {
    id: 'cutout',
    aliases: ['speaker_cutout', 'speaker-cutout'],
    category: 'visual',
    directorKinds: ['cutout'],
    layouts: ['cutout'],
    description: 'Speaker keyed in front of a designed plate or B-roll.',
  },
  {
    id: 'card',
    aliases: ['media_card', 'photo_card'],
    category: 'visual',
    directorKinds: ['card', 'slideshow'],
    layouts: ['card', 'pip', 'sticker', 'composite'],
    description: 'Photo/screenshot card treatments, including slideshows.',
  },
  {
    id: 'bubble',
    aliases: ['chat', 'message_card'],
    category: 'visual',
    directorKinds: ['bubble'],
    layouts: ['bubble'],
    description: 'Chat/message-style cards in a legal slot.',
  },
  {
    id: 'lockup',
    aliases: ['quote', 'stack'],
    category: 'visual',
    directorKinds: ['lockup'],
    layouts: ['lockup', 'chip', 'banner', 'stat'],
    description: 'Stacked spoken phrase or slogan in a legal slot.',
  },
  {
    id: 'kinetic_text',
    aliases: ['kinetic', 'motion_text'],
    category: 'visual',
    directorKinds: ['kinetic_text'],
    layouts: [],
    description: 'Motion-graphic type with shape and entrance choreography.',
  },
  {
    id: 'counter',
    aliases: ['count', 'count_up'],
    category: 'visual',
    directorKinds: ['counter'],
    layouts: [],
    description: 'Animated count-up for a huge spoken number.',
  },
  {
    id: 'emphasis',
    aliases: ['semantic_emphasis'],
    category: 'visual',
    directorKinds: ['emphasis'],
    layouts: [],
    description: 'Speech-synced emphasis on a word or phrase.',
  },
  {
    id: 'zoom',
    aliases: ['punch_zoom', 'punch-in'],
    category: 'visual',
    directorKinds: ['zoom'],
    layouts: [],
    description: 'Punch-in / push on the speaker. Never during a cutaway.',
  },
  {
    id: 'media_container',
    aliases: ['container', 'pip_corner'],
    category: 'visual',
    directorKinds: ['media_container'],
    layouts: [],
    description: 'Speaker shrinks into a card/inset while revealing a canvas.',
  },
  {
    id: 'frame_inset',
    aliases: ['margin_inset', 'frame-inset'],
    category: 'visual',
    directorKinds: ['frame_inset'],
    layouts: [],
    description:
      'Shrinks the WHOLE picture (including captions) to reveal a colored margin. Not inset_reveal.',
  },
  {
    id: 'depth_overlay',
    aliases: ['behind_subject', 'behind-subject', 'behind_subject_overlay'],
    category: 'visual',
    directorKinds: ['depth_overlay'],
    layouts: [],
    description:
      'Speaker stays full-frame, masked in front. A clip slides in from above or below, then plays behind them. Not a cutaway.',
  },
  {
    id: 'inset_reveal',
    aliases: [
      'inset',
      'inset_scale',
      'inset-scale',
      'inset_scale_reveal',
      'inset-reveal',
      'inset-scale-reveal',
    ],
    category: 'visual',
    directorKinds: ['inset_reveal'],
    layouts: [],
    description:
      'Whole video shrinks into a rounded card over a colored background with captions below, then returns to full frame. Not B-roll and not depth_overlay.',
  },
  {
    id: 'delivery_shaping',
    aliases: ['delivery', 'pacing', 'delivery-shaping', 'audio_pacing'],
    category: 'audio',
    directorKinds: [],
    layouts: [],
    description:
      'Audio and pacing only: trims dead air/fillers, adds deliberate beats, pitch-preserving tempo changes, gain and dynamics. The speaker’s voice identity is unchanged.',
  },
  {
    id: 'transition',
    aliases: ['wipe', 'whip'],
    category: 'visual',
    directorKinds: ['transition'],
    layouts: [],
    description: 'Wipe / burn / whip between moments.',
  },
  {
    id: 'lut',
    aliases: ['color', 'grade', 'color_grade'],
    category: 'grade',
    directorKinds: [],
    layouts: [],
    description: 'Color grade from the on-disk LUT catalog. Pass --lut=<id> to force one.',
  },
  {
    id: 'sound',
    aliases: ['sfx', 'audio'],
    category: 'audio',
    directorKinds: [],
    layouts: [],
    description: 'Music bed, ducking, and SFX hits tied to cuts and emphasis.',
  },
  {
    id: 'cta',
    aliases: ['call_to_action'],
    category: 'cta',
    directorKinds: [],
    layouts: [],
    description: 'Interactive call to action timed to speech.',
  },
];

export const LEAN_DEFAULT_EDITS = ['captions'] as const;

const ALWAYS_ON_TOOLKIT_IDS = new Set<string>();
const ALWAYS_ON_KINDS = new Set<string>();
const VISUAL_OPT_IN_IDS = new Set(
  EDIT_TOOLKITS.filter(toolkit => toolkit.category === 'visual' && toolkit.id !== 'zoom').map(
    toolkit => toolkit.id,
  ),
);

const ALIAS_TO_ID = new Map<string, string>();
for (const toolkit of EDIT_TOOLKITS) {
  ALIAS_TO_ID.set(toolkit.id, toolkit.id);
  for (const alias of toolkit.aliases) {
    ALIAS_TO_ID.set(alias, toolkit.id);
  }
}

export function normalizeToolkitId(raw: string): string | null {
  const key = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (!key) {
    return null;
  }
  return ALIAS_TO_ID.get(key) ?? null;
}

export function parseEditAllowlist(raw: string[] | undefined | null): {
  allowed: Set<string> | null;
  unknown: string[];
  omitted: boolean;
  explicitAll: boolean;
} {
  const tokens = (raw ?? [])
    .flatMap(value => value.split(','))
    .map(value => value.trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    return {allowed: null, unknown: [], omitted: true, explicitAll: false};
  }
  if (tokens.some(token => token.toLowerCase() === 'all')) {
    return {allowed: null, unknown: [], omitted: false, explicitAll: true};
  }
  const allowed = new Set<string>();
  const unknown: string[] = [];
  for (const token of tokens) {
    const id = normalizeToolkitId(token);
    if (!id) {
      unknown.push(token);
      continue;
    }
    allowed.add(id);
  }
  return {
    allowed: allowed.size > 0 ? allowed : null,
    unknown,
    omitted: false,
    explicitAll: false,
  };
}

export function resolvePipelineEdits(input: {
  allowed: Set<string> | null;
  omitted?: boolean;
  explicitAll?: boolean;
  fullEdits?: boolean;
  pipelineMode?: 'lean' | 'full';
}): string[] | null {
  if (input.fullEdits || input.explicitAll) {
    return null;
  }
  if (input.allowed && input.allowed.size > 0) {
    return [...input.allowed];
  }
  if ((input.pipelineMode ?? 'lean') === 'full') {
    return null;
  }
  return [...LEAN_DEFAULT_EDITS];
}

/** `undefined` / `[]` → lean default. `null` / `['all']` → every toolkit. */
export function defaultRequestedEdits(
  requested: string[] | null | undefined,
  pipelineMode: 'lean' | 'full' = 'lean',
): string[] | null {
  if (requested === null) {
    return null;
  }
  const tokens = (requested ?? [])
    .flatMap(value => value.split(','))
    .map(value => value.trim())
    .filter(Boolean);
  if (tokens.some(token => token.toLowerCase() === 'all')) {
    return null;
  }
  if (tokens.length > 0) {
    return tokens;
  }
  return pipelineMode === 'full' ? null : [...LEAN_DEFAULT_EDITS];
}

export function visualToolkitsRequested(
  requested: string[] | Set<string> | null | undefined,
): boolean {
  if (requested == null) {
    return true;
  }
  const ids = requested instanceof Set ? requested : new Set(requested);
  return [...ids].some(id => VISUAL_OPT_IN_IDS.has(id));
}

export function isLeanAllowlist(allowed: Set<string> | null | undefined): boolean {
  if (!allowed) {
    return false;
  }
  return ![...allowed].some(
    id => id !== 'captions' && id !== 'hook_title' && id !== 'zoom',
  );
}

export function isKindAllowed(kind: string, allowed: Set<string> | null): boolean {
  if (!allowed) {
    return true;
  }
  if (ALWAYS_ON_KINDS.has(kind)) {
    return true;
  }
  return EDIT_TOOLKITS.some(
    toolkit => allowed.has(toolkit.id) && toolkit.directorKinds.includes(kind),
  );
}

export function isLayoutAllowed(layout: string, allowed: Set<string> | null): boolean {
  if (!allowed) {
    return true;
  }
  return EDIT_TOOLKITS.some(
    toolkit => allowed.has(toolkit.id) && toolkit.layouts.includes(layout),
  );
}

export function allowedDirectorKinds(allowed: Set<string> | null): string[] {
  const kinds = new Set<string>();
  for (const toolkit of EDIT_TOOLKITS) {
    if (
      !allowed ||
      allowed.has(toolkit.id) ||
      toolkit.category === 'always' ||
      ALWAYS_ON_TOOLKIT_IDS.has(toolkit.id)
    ) {
      for (const kind of toolkit.directorKinds) {
        kinds.add(kind);
      }
    }
  }
  return [...kinds];
}

/** `--delivery-shaping` adds the toolkit to an existing --edits allowlist. */
export function mergeDeliveryShapingAllowlist(
  allowed: string[] | null,
  forceDeliveryShaping: boolean | undefined,
): string[] | null {
  if (allowed == null) {
    return null;
  }
  const next = new Set(allowed);
  if (forceDeliveryShaping === true) {
    next.add('delivery_shaping');
  }
  if (forceDeliveryShaping === false) {
    next.delete('delivery_shaping');
  }
  return [...next];
}

export function parseCaptionTemplateFlag(raw: string | undefined): CaptionTemplateId | null {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!value) {
    return null;
  }
  return (CAPTION_TEMPLATES as readonly string[]).includes(value)
    ? (value as CaptionTemplateId)
    : null;
}

export function formatEditToolkitList(): string {
  const rows = EDIT_TOOLKITS.map(toolkit => {
    const alias =
      toolkit.aliases.length > 0 ? `  aliases: ${toolkit.aliases.join(', ')}` : '';
    return `  ${toolkit.id.padEnd(18)} ${toolkit.description}${alias ? `\n${alias}` : ''}`;
  });
  const captions = CAPTION_TEMPLATES.join(', ');
  const graphics = INSET_GRAPHIC_TEMPLATES.map(
    item => `  ${item.id.padEnd(18)} ${item.description}`,
  ).join('\n');
  return [
    'Edit toolkits (pass with --edits=id,id or repeated --edit=id).',
    'The AI Director chooses WHERE and HOW each requested toolkit is used.',
    'Omit --edits for the lean pipeline: captions, auto-trim, auto-zoom, and hook title.',
    'Pass --full-edits or --edits=all to unlock every toolkit. Visual edit code stays in the repo.',
    'Pass --delivery-shaping to include audio/pacing even when --edits is already set.',
    '',
    ...rows,
    '',
    'Caption templates (pass with --captions=<id>):',
    `  ${captions}`,
    '',
    'Inset Scale Reveal motion-graphic templates (Director picks these for variant=motion_graphic):',
    graphics,
    '',
    'Examples:',
    '  npm run first-video -- "/path/clip.mp4" auto --captions=karaoke',
    '  npm run first-video -- "/path/clip.mp4" auto --full-edits --captions=karaoke',
    '  npm run first-video -- "/path/clip.mp4" auto --edits=inset_reveal,depth_overlay,cutaway --delivery-shaping --captions=karaoke',
    '  npm run first-video -- "/path/clip.mp4" auto --edit=cutaway --edit=inset_reveal --broll=/path/b1.mp4',
    '  npm run first-video -- --list-edits',
  ].join('\n');
}

export function allowedEditsPromptBlock(allowed: Set<string> | null): string {
  if (!allowed) {
    return 'ALLOWED_EDIT_STYLES: all renderer-backed kinds. Pick what this transcript needs.';
  }
  if (isLeanAllowlist(allowed)) {
    return [
      'PIPELINE_MODE: lean',
      'ALLOWED_EDIT_STYLES: captions, hook_title, zoom',
      'Place a distinctive hook_title and 1–3 punch-in zooms. Vary hook shape — never the same boxed card on every video. Use impact, poster, outline, stack, rail, bar, duo, underline, minimal, or boxed.',
      'You may ONLY emit these element kinds: hook_title, zoom.',
      'Do not emit cutaway, split, cutout, card, bubble, lockup, kinetic_text, counter, emphasis, media_container, frame_inset, depth_overlay, inset_reveal, or transition.',
      'Captions still render (they are not an element kind). Pick textColor/highlightColor that contrast THIS footage — never white-on-white or teal-on-cream.',
    ].join('\n');
  }
  const kinds = allowedDirectorKinds(allowed);
  const ids = [...allowed].sort().join(', ');
  const deliveryLine = allowed.has('delivery_shaping')
    ? 'delivery_shaping is enabled as an audio/pacing preflight. It is not a visual element kind. Visual timestamps are already on the shaped timeline.'
    : 'delivery_shaping is not in this allowlist. Do not assume pacing or loudness was changed.';
  return [
    `ALLOWED_EDIT_STYLES: ${ids}`,
    `REQUESTED_EDIT_STYLES: ${ids}`,
    'These are requests. You may decline a requested toolkit with a reason. Decide WHERE only if you use it.',
    `You may ONLY emit these element kinds: ${kinds.join(', ') || 'hook_title'}.`,
    deliveryLine,
    'hook_title and zoom are recommended when they serve this transcript. Do not invent them if they do not.',
    'Captions still render (they are not an element kind). Pick textColor/highlightColor that contrast THIS footage — never white-on-white or teal-on-cream.',
    'Do not emit any other visual toolkit.',
    'cutaway replaces the talking head. depth_overlay keeps the masked speaker in front and slides a clip in from above or below, then plays it.',
    'The same USER B-roll file may be reused for cutaway and depth_overlay at non-overlapping times.',
    'Every title, lockup, and overlay_text must cover only the TIMESTAMPED_WORDS it quotes.',
  ].join('\n');
}

export function lockCaptionTemplate<T extends {template?: CaptionTemplateId}>(
  caption: T,
  template: CaptionTemplateId | null | undefined,
): T {
  if (!template) {
    return caption;
  }
  return {...caption, template};
}

export function filterVisualDirection<T extends {
  moments?: Array<{layout: string}>;
  depthOverlays?: unknown[];
  insetReveals?: unknown[];
  frameInsets?: unknown[];
  mediaContainers?: unknown[];
  motionGraphics?: unknown[];
  semanticEmphasis?: unknown[];
  zooms?: unknown[];
}>(direction: T, allowed: Set<string> | null): T {
  if (!allowed) {
    return direction;
  }
  return {
    ...direction,
    moments: (direction.moments ?? []).filter(moment => isLayoutAllowed(moment.layout, allowed)),
    depthOverlays: allowed.has('depth_overlay') ? direction.depthOverlays : [],
    insetReveals: allowed.has('inset_reveal') ? direction.insetReveals : [],
    frameInsets: allowed.has('frame_inset') ? direction.frameInsets : [],
    mediaContainers: allowed.has('media_container') ? direction.mediaContainers : [],
    motionGraphics: allowed.has('kinetic_text') ? direction.motionGraphics : [],
    semanticEmphasis:
      allowed.has('emphasis') || allowed.has('counter')
        ? direction.semanticEmphasis
        : [],
    zooms: !allowed || allowed.has('zoom') ? direction.zooms : [],
  };
}
