/**
 * Text treatments the Director can request (curved typography, text masking) and the deterministic decision about HOW each is delivered.
 *
 * The Director asks; this module decides, and says so. Four kinds are delivered by the Remotion toolkit through the existing Claude worker
 * (`curved`, `clip_window`, `mask_reveal`, `layered`: shape clipping and layering only). `behind_subject` is different: it needs a real foreground matte
 * (an alpha video of the speaker). With one, the compositor draws the text between the footage and the speaker; without one, the request is
 * downgraded to a `layered` panel treatment and the downgrade is recorded. Nothing here ever reports depth-aware masking that was not drawn.
 */

import {z} from 'zod';

export const MASK_REVEAL_KINDS = ['wipe-right', 'wipe-left', 'wipe-up', 'wipe-down', 'iris', 'slit'] as const;
export const TEXT_TREATMENT_KINDS = ['curved', 'clip_window', 'mask_reveal', 'layered', 'behind_subject'] as const;
export type TextTreatmentKind = (typeof TEXT_TREATMENT_KINDS)[number];

const MAX_TREATMENT_TEXT = 40;

export const textTreatmentSchema = z
  .object({
    kind: z.enum(TEXT_TREATMENT_KINDS),
    /** The words the treatment shows. Short on purpose: curved or masked long copy is unreadable. */
    text: z.string().trim().min(1).max(MAX_TREATMENT_TEXT),
    curve: z
      .object({
        shape: z.enum(['arc', 'circle', 'path']).default('arc'),
        /** arc: -1..1, + arches up, - bowls down. */
        curvature: z.number().min(-1).max(1).default(0.35),
        direction: z.enum(['clockwise', 'counterclockwise']).default('clockwise'),
        align: z.enum(['start', 'center', 'end']).default('center'),
        rotationDeg: z.number().min(-30).max(30).default(0),
      })
      .optional(),
    reveal: z.enum(MASK_REVEAL_KINDS).optional(),
    /** behind_subject only: vertical centre and width of the text block, as frame fractions. */
    centerY: z.number().min(0.08).max(0.92).optional(),
    widthFrac: z.number().min(0.4).max(0.96).optional(),
  })
  .superRefine((treatment, ctx) => {
    if (treatment.kind === 'curved' && !treatment.curve) {
      ctx.addIssue({code: 'custom', message: 'curved needs curve settings', path: ['curve']});
    }
    if (treatment.kind === 'mask_reveal' && !treatment.reveal) {
      ctx.addIssue({code: 'custom', message: 'mask_reveal needs a reveal kind', path: ['reveal']});
    }
    if (treatment.kind !== 'curved' && treatment.kind !== 'behind_subject' && treatment.curve) {
      ctx.addIssue({code: 'custom', message: 'curve only applies to curved and behind_subject', path: ['curve']});
    }
  });

export type TextTreatment = z.infer<typeof textTreatmentSchema>;

export type SpeakerBox = {x: number; y: number; w: number; h: number};

/** Share of a text block's width NOT covered by the speaker's box (0..1). Behind-subject text must stay mostly readable. */
export function visibleFractionBehindSubject(text: {centerY: number; widthFrac: number; heightFrac: number}, speaker: SpeakerBox | undefined): number {
  if (!speaker) {
    return 1;
  }
  const textTop = text.centerY - text.heightFrac / 2;
  const textBottom = text.centerY + text.heightFrac / 2;
  if (textBottom <= speaker.y || textTop >= speaker.y + speaker.h) {
    return 1;
  }
  const left = (1 - text.widthFrac) / 2;
  const right = left + text.widthFrac;
  const overlap = Math.max(0, Math.min(right, speaker.x + speaker.w) - Math.max(left, speaker.x));
  return Math.max(0, 1 - overlap / text.widthFrac);
}

export type BehindSubjectEntry = {
  start: number;
  end: number;
  text: string;
  centerY: number;
  widthFrac: number;
  heightFrac: number;
  curvature: number;
  reveal: 'fade' | 'sweep';
  reason: string;
  /** Text colour and optional outline, chosen against the footage behind the text. Required: an entry with no measured colours is never created. */
  color: string;
  strokeColor?: string;
};

export type TextTreatmentDecision =
  | {route: 'behind_subject_track'; entry: BehindSubjectEntry; note: string}
  /** Delivered by the toolkit through the Claude worker. `downgradedFrom` is set when a behind_subject request could not be honoured. */
  | {route: 'toolkit'; treatment: TextTreatment; downgradedFrom?: 'behind_subject'; note: string};

export const MIN_VISIBLE_FRACTION = 0.45;

/**
 * Decide how a request is delivered. `matteUsable` must come from the same gate the renderer uses (an alpha video plus a verified keyed cutout);
 * when in doubt the caller passes false and the text gets a panel instead.
 */
export function decideTextTreatment(
  treatment: TextTreatment,
  context: {
    matteUsable: boolean;
    speakerBox?: SpeakerBox;
    /**
     * WP3N (mvp, undetected speaker only): the speaker's position is unknown, so there is no box to place text behind. A behind-subject request is then delivered as a layered panel
     * instead of being placed from a missing (or default) box. Absent/false: unchanged (a missing box still means "no constraint" for other callers).
     */
    speakerUnknown?: boolean;
    start: number;
    end: number;
    reason: string;
    /**
     * Colours proven legible against the footage behind the text (see `behindSubjectColors`). Behind-subject text has no backing panel, so without
     * proven colours the request is downgraded instead of drawn in a guessed colour.
     */
    behindColors?: {color: string; strokeColor?: string} | null;
  },
): TextTreatmentDecision {
  if (treatment.kind !== 'behind_subject') {
    return {route: 'toolkit', treatment, note: `${treatment.kind}: toolkit (shape/layer clipping, not subject-aware)`};
  }
  const downgrade = (why: string): TextTreatmentDecision => ({
    route: 'toolkit',
    treatment: {...treatment, kind: 'layered', reveal: treatment.reveal ?? 'wipe-right'},
    downgradedFrom: 'behind_subject',
    note: `behind_subject unavailable (${why}); delivered as a layered panel, not depth-aware`,
  });
  if (!context.matteUsable) {
    return downgrade('no_foreground_matte');
  }
  if (!context.behindColors) {
    return downgrade('no_safe_text_colour');
  }
  if (context.speakerUnknown) {
    return downgrade('speaker_unmeasured');
  }
  const widthFrac = treatment.widthFrac ?? 0.9;
  const centerY = treatment.centerY ?? 0.3;
  const heightFrac = 0.2;
  const visible = visibleFractionBehindSubject({centerY, widthFrac, heightFrac}, context.speakerBox);
  if (visible < MIN_VISIBLE_FRACTION) {
    return downgrade(`text_mostly_hidden_${visible.toFixed(2)}`);
  }
  return {
    route: 'behind_subject_track',
    entry: {
      start: context.start,
      end: context.end,
      text: treatment.text,
      centerY,
      widthFrac,
      heightFrac,
      curvature: treatment.curve?.curvature ?? 0,
      reveal: treatment.reveal === 'wipe-right' || treatment.reveal === 'wipe-left' ? 'sweep' : 'fade',
      reason: context.reason,
      color: context.behindColors.color,
      ...(context.behindColors.strokeColor ? {strokeColor: context.behindColors.strokeColor} : {}),
    },
    note: `behind_subject: drawn between footage and the speaker's alpha matte (${(visible * 100).toFixed(0)}% of the text visible)`,
  };
}

/** The instruction appended to the Claude brief so the worker builds exactly the requested treatment with the toolkit's primitives. */
export function treatmentInstruction(treatment: TextTreatment): string {
  const text = JSON.stringify(treatment.text);
  switch (treatment.kind) {
    case 'curved': {
      const curve = treatment.curve!;
      return `TEXT TREATMENT (required): set ${text} on a curve with <CurvedText shape="${curve.shape}" curvature={${curve.curvature}} direction="${curve.direction}" align="${curve.align}" rotationDeg={${curve.rotationDeg}} …/> inside contentBox. Take the text from content; if a different headline is in content, prefer content. Keep it legible: if onLayout-style checks would shrink it below ~28 px, shorten via the content, never by overflowing.`;
    }
    case 'clip_window':
      return `TEXT TREATMENT (required): show ${text} through a <ClipWindow> shape so it slides/appears only inside the window. This is shape clipping, not subject-aware.`;
    case 'mask_reveal':
      return `TEXT TREATMENT (required): reveal ${text} with <MaskReveal kind="${treatment.reveal}"> (an animated clip region). This is a mask transition, not subject-aware.`;
    case 'layered':
      return `TEXT TREATMENT (required): compose ${text} with <LayeredText> (background panel, text, foreground shape clipped by foregroundRegion).${treatment.reveal ? ` Reveal with <MaskReveal kind="${treatment.reveal}">.` : ''} This is plain layering, not subject-aware: never describe it as depth-aware.`;
    case 'behind_subject':
      return '';
  }
}
