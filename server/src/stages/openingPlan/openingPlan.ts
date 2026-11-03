/**
 * The art-directed opening and colour direction, as the Director returns them after watching the whole video.
 *
 * The Director decides: central promise, audience, angle, the wording, the treatment, the palette roles. This module VALIDATES that the plan is grounded
 * in the actual video (evidence spread across the timeline, wording that is in the transcript), keeps the text out of the face and the caption band,
 * measures the text against the real footage behind it, and returns either a render-ready `openingTreatment` or a precise reason it was rejected
 * (the caller then falls back to the standard hook, which is never silently dropped). It never claims a treatment it did not produce.
 */

import {z} from 'zod';

import {decideTextTreatment, MASK_REVEAL_KINDS, type BehindSubjectEntry, type SpeakerBox, textTreatmentSchema} from '../textTreatment/textTreatment.ts';
import {fitOpeningBox, OPENING_TOP_UI, type OpeningAlign} from './openingBoxFit.ts';
import {behindSubjectColors, COLOR_ROLES, textOverFootage, validateColorRoles, type ColorRole, type RegionStats, type RoleReport} from './colorRoles.ts';

export const OPENING_TREATMENTS = ['plain', 'curved', 'mask_reveal', 'layered', 'behind_subject'] as const;

export const openingPlanSchema = z.object({
  central_promise: z.string().min(3).max(300),
  audience: z.string().min(2).max(200),
  angle: z.string().min(3).max(300),
  /** Moments of the video that justify the plan. Spread across the timeline is checked, not trusted. */
  evidence: z.array(z.object({time_sec: z.number().min(0), what: z.string().min(3).max(200)})).min(2).max(8),
  concept: z.string().min(3).max(400),
  hook_wording: z.string().trim().min(2).max(40),
  wording_source: z.enum(['spoken', 'paraphrase']),
  /** The moment whose look the design is built around. Recorded; the video itself still starts at its first frame. */
  source_frame_time_sec: z.number().min(0),
  treatment: z.enum(OPENING_TREATMENTS),
  curve: z
    .object({
      shape: z.enum(['arc', 'circle', 'path']).default('arc'),
      curvature: z.number().min(-1).max(1).default(0.35),
      direction: z.enum(['clockwise', 'counterclockwise']).default('clockwise'),
      rotationDeg: z.number().min(-30).max(30).default(0),
    })
    .nullish(),
  /** mask_reveal only: the clip animation that reveals the second half of the wording. */
  reveal: z.enum(MASK_REVEAL_KINDS).nullish(),
  text_masking_reason: z.string().max(300).default(''),
  placement: z.object({center_y: z.number().min(0.06).max(0.9), width_frac: z.number().min(0.4).max(0.96), height_frac: z.number().min(0.06).max(0.4).optional(), align: z.enum(['left', 'center', 'right']).default('center')}),
  contrast_treatment: z.enum(['none', 'outline', 'panel', 'shadow']).default('none'),
  frame0: z.string().max(400),
  animation: z.string().max(300),
  why_this_design: z.string().min(3).max(500),
});
export type OpeningPlan = z.infer<typeof openingPlanSchema>;

export const colorDirectionSchema = z.object({
  identity: z.string().min(3).max(300),
  footage_notes: z.string().max(400).default(''),
  roles: z.object(Object.fromEntries(COLOR_ROLES.map(role => [role, z.string()])) as Record<ColorRole, z.ZodString>),
});
export type ColorDirection = z.infer<typeof colorDirectionSchema>;

/** Response-schema fragments (Gemini's OBJECT dialect) appended to the Director v1 schema when the full video is attached. */
export const OPENING_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'OBJECT',
  properties: {
    central_promise: {type: 'STRING'},
    audience: {type: 'STRING'},
    angle: {type: 'STRING'},
    evidence: {type: 'ARRAY', items: {type: 'OBJECT', properties: {time_sec: {type: 'NUMBER'}, what: {type: 'STRING'}}, required: ['time_sec', 'what']}},
    concept: {type: 'STRING'},
    hook_wording: {type: 'STRING'},
    wording_source: {type: 'STRING', enum: ['spoken', 'paraphrase']},
    source_frame_time_sec: {type: 'NUMBER'},
    treatment: {type: 'STRING', enum: [...OPENING_TREATMENTS]},
    curve: {
      type: 'OBJECT',
      nullable: true,
      properties: {shape: {type: 'STRING', enum: ['arc', 'circle', 'path']}, curvature: {type: 'NUMBER'}, direction: {type: 'STRING', enum: ['clockwise', 'counterclockwise']}, rotationDeg: {type: 'NUMBER'}},
    },
    reveal: {type: 'STRING', enum: [...MASK_REVEAL_KINDS], nullable: true},
    text_masking_reason: {type: 'STRING'},
    placement: {type: 'OBJECT', properties: {center_y: {type: 'NUMBER'}, width_frac: {type: 'NUMBER'}, height_frac: {type: 'NUMBER'}, align: {type: 'STRING', enum: ['left', 'center', 'right']}}, required: ['center_y', 'width_frac']},
    contrast_treatment: {type: 'STRING', enum: ['none', 'outline', 'panel', 'shadow']},
    frame0: {type: 'STRING'},
    animation: {type: 'STRING'},
    why_this_design: {type: 'STRING'},
  },
  required: ['central_promise', 'audience', 'angle', 'evidence', 'concept', 'hook_wording', 'wording_source', 'source_frame_time_sec', 'treatment', 'placement', 'frame0', 'animation', 'why_this_design'],
};

export const COLOR_DIRECTION_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'OBJECT',
  properties: {
    identity: {type: 'STRING'},
    footage_notes: {type: 'STRING'},
    roles: {type: 'OBJECT', properties: Object.fromEntries(COLOR_ROLES.map(role => [role, {type: 'STRING'}])), required: [...COLOR_ROLES]},
  },
  required: ['identity', 'roles'],
};

/** What the Director is told, appended to the visual Director prompt when it can see the whole video. */
export const OPENING_DIRECTIVE = `OPENING AND COLOR DIRECTION (you have watched the whole video; do this BEFORE choosing any other edit):
1. State the video's central promise, audience and strongest angle from evidence in the video: at least two moments, spread across the timeline (opening_plan.evidence, with time_sec).
2. Design the OPENING as a composition for timestamp 0. Wording must be grounded: preferably words the speaker actually says (wording_source "spoken"), otherwise a faithful paraphrase ("paraphrase"). 2-7 words, at most 40 characters. No generic hook.
3. Choose a treatment for THIS video: plain (a well-composed title), curved (a short phrase on an arc), mask_reveal (the second half of the wording is revealed through an animated mask; the first half is already readable on frame 0, so the first half must work alone and wording needs at least two words), layered (panel + text + foreground shape), or behind_subject (text behind the speaker; needs a real cut-out, which usually does not exist, and the engine will say when it was delivered another way). Text masking is optional: a simple, well-composed opening beats a forced effect that hurts readability or hides the speaker.
4. Placement: center_y and width_frac as frame fractions, away from the speaker's face and the caption band (y >= 0.76). Frame 0 must already look finished; the animation may only add an accent sweep, a settle and an exit.
5. color_direction: an identity and semantic roles as #RRGGBB (primary_text, secondary_text, accent, graphic_background, panel, highlight, data) chosen after looking at the footage's actual colors, brightness, skin tones and background. Not a default palette. Text over footage must contrast the footage behind it; roles must contrast their backgrounds. Use at most two accent hues.`;

// ---- resolution -----------------------------------------------------------------------------------------------------------------------------

export type OpeningTreatmentSpec = {
  text: string;
  kind: 'plain' | 'curved' | 'layered' | 'mask_reveal';
  /** mask_reveal: [lead, rest]. `lead` is fully visible from frame 0; `rest` is revealed through the `textReveal` mask. */
  lines?: [string, string];
  textReveal?: (typeof MASK_REVEAL_KINDS)[number];
  curve?: {shape: 'arc' | 'circle' | 'path'; curvature: number; direction: 'clockwise' | 'counterclockwise'; rotationDeg: number};
  centerY: number;
  widthFrac: number;
  heightFrac: number;
  align: 'left' | 'center' | 'right';
  font: 'display' | 'body';
  weight: number;
  textColor: string;
  accentColor: string;
  strokeColor?: string;
  panel?: {color: string; opacity: number};
  startSec: number;
  durationSec: number;
  plan: Record<string, string>;
};

export type OpeningReport = {
  accepted: boolean;
  /** Why the plan was rejected, when it was. The standard hook then stands. */
  rejection?: string;
  /** How the treatment was actually delivered (never "behind_subject" unless a matte drew it). */
  delivered: 'plain' | 'curved' | 'mask_reveal' | 'layered' | 'behind_subject' | 'none';
  requested: OpeningPlan['treatment'] | null;
  fallbacks: string[];
  corrections: string[];
  placement?: {centerY: number; widthFrac: number; heightFrac: number};
  worstContrast?: number;
  roles?: RoleReport;
};

const CAPTION_TOP = 0.76;
/** Smallest title block (frame fraction of height) the opening may shrink to when only a narrow band above the face is free. */
const MIN_OPENING_HEIGHT = 0.09;
/** Height (frame fraction) of a behind-subject text block; the same value `decideTextTreatment` uses for the visible-fraction check. */
const BEHIND_SUBJECT_HEIGHT = 0.2;
const tokenize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').split(/\s+/).filter(token => token.length >= 3);

/** Share of the wording's content words that occur in the transcript. */
export function wordingOverlap(wording: string, transcript: string): number {
  const tokens = tokenize(wording);
  if (tokens.length === 0) {
    return 0;
  }
  const spoken = new Set(tokenize(transcript));
  return tokens.filter(token => spoken.has(token)).length / tokens.length;
}

export function evidenceSpread(evidence: OpeningPlan['evidence'], durationSec: number): {distinct: number; spanFrac: number; inRange: boolean} {
  const times = evidence.map(item => item.time_sec);
  const inRange = times.every(time => time >= 0 && time <= durationSec + 0.5);
  const distinct = new Set(times.map(time => Math.round(time))).size;
  return {distinct, spanFrac: durationSec > 0 ? (Math.max(...times) - Math.min(...times)) / durationSec : 0, inRange};
}

const rangesOverlap = (aTop: number, aBottom: number, bTop: number, bBottom: number) => aTop < bBottom && bTop < aBottom;

export type ResolveInput = {
  plan: unknown;
  colorDirection: unknown;
  transcript: string;
  durationSec: number;
  hookDurationSec: number;
  speakerBox?: SpeakerBox;
  /**
   * WP3O (mvp, undetected speaker only): the speaker's position is unknown and no box is given. The opening is then neither moved off a "face" nor placed behind a "speaker" from a
   * default box: a behind-subject request takes the shared downgrade (`speaker_unmeasured`, a layered panel). Absent/false: unchanged.
   */
  speakerUnknown?: boolean;
  matteUsable: boolean;
  /** Footage statistics for a frame-relative box over the opening seconds (worst case over several moments). */
  measure: (box: {x: number; y: number; w: number; h: number}) => Promise<RegionStats>;
};

export async function resolveOpening(input: ResolveInput): Promise<{spec: OpeningTreatmentSpec | null; report: OpeningReport; roles: RoleReport | null; behindSubject?: BehindSubjectEntry}> {
  const fallbacks: string[] = [];
  const corrections: string[] = [];
  const reject = (rejection: string, requested: OpeningReport['requested'] = null, roles: RoleReport | null = null) => ({spec: null, roles, report: {accepted: false, rejection, delivered: 'none' as const, requested, fallbacks, corrections, ...(roles ? {roles} : {})}});

  const colors = colorDirectionSchema.safeParse(input.colorDirection);
  const roles = colors.success ? validateColorRoles(colors.data.roles) : null;
  if (roles) {
    corrections.push(...roles.corrections.map(c => `role ${c.role}: ${c.from} -> ${c.to} (${c.reason})`));
  }

  const parsed = openingPlanSchema.safeParse(input.plan);
  if (!parsed.success) {
    return reject(`opening_plan_invalid:${parsed.error.issues.slice(0, 3).map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`, null, roles);
  }
  const plan = parsed.data;
  if (!roles) {
    return reject('color_direction_missing_or_invalid', plan.treatment);
  }

  const spread = evidenceSpread(plan.evidence, input.durationSec);
  if (!spread.inRange) {
    return reject('evidence_outside_video', plan.treatment, roles);
  }
  // A Director that only looked at the opening seconds cannot have understood the video: demand evidence across the timeline.
  if (spread.distinct < 2 || (input.durationSec >= 15 && spread.spanFrac < 0.25)) {
    return reject(`evidence_not_spread_across_video:${(spread.spanFrac * 100).toFixed(0)}%`, plan.treatment, roles);
  }
  const overlap = wordingOverlap(plan.hook_wording, input.transcript);
  const need = plan.wording_source === 'spoken' ? 0.7 : 0.34;
  if (overlap < need) {
    return reject(`wording_not_grounded:${overlap.toFixed(2)}<${need}`, plan.treatment, roles);
  }
  if (plan.wording_source === 'paraphrase') {
    fallbacks.push('wording_is_paraphrase_not_spoken');
  }

  // Placement: keep out of the caption band and out of the face.
  const heightFracRequested = plan.placement.height_frac ?? (plan.treatment === 'curved' ? 0.17 : 0.18);
  const widthFrac = plan.placement.width_frac;
  let centerY = plan.placement.center_y;
  const speaker = input.speakerUnknown ? undefined : input.speakerBox; // an unknown speaker has no box, even if one is passed by mistake
  const clampBand = () => Math.min(centerY, CAPTION_TOP - 0.02 - heightFracRequested / 2);
  if (centerY + heightFracRequested / 2 > CAPTION_TOP - 0.02) {
    const moved = clampBand();
    corrections.push(`placement: center_y ${centerY.toFixed(2)} -> ${moved.toFixed(2)} (kept out of the caption band)`);
    centerY = moved;
  }
  // Treatment delivery. Only behind_subject needs the shared decision (it can be refused); every other treatment is delivered exactly as asked.
  let kind: OpeningTreatmentSpec['kind'] = 'plain';
  let curve: OpeningTreatmentSpec['curve'];
  let lines: OpeningTreatmentSpec['lines'];
  let textReveal: OpeningTreatmentSpec['textReveal'];
  let delivered: OpeningReport['delivered'] = 'plain';
  if (plan.treatment === 'behind_subject') {
    const requested = textTreatmentSchema.safeParse({kind: 'behind_subject', text: plan.hook_wording, centerY, widthFrac});
    if (!requested.success) {
      return reject(`treatment_invalid:${requested.error.issues[0]?.message ?? 'unknown'}`, plan.treatment, roles);
    }
    // Text behind the speaker has no panel, so it needs colours proven against the footage it will sit on.
    const behindStats = await input.measure({x: (1 - widthFrac) / 2, y: centerY - BEHIND_SUBJECT_HEIGHT / 2, w: widthFrac, h: BEHIND_SUBJECT_HEIGHT});
    const behindColors = behindSubjectColors(behindStats, roles.roles);
    const decision = decideTextTreatment(requested.data, {matteUsable: input.matteUsable, speakerBox: speaker, ...(input.speakerUnknown ? {speakerUnknown: true} : {}), start: 0, end: input.hookDurationSec, reason: plan.why_this_design, behindColors});
    if (decision.route === 'behind_subject_track') {
      // Genuine subject-aware text: blueprint.behindSubjectTexts (the caller adds it); the opening spec is not used.
      return {
        spec: null,
        roles,
        behindSubject: {...decision.entry, end: Math.min(6, Math.max(1.5, input.hookDurationSec)), reveal: 'fade'},
        report: {accepted: true, delivered: 'behind_subject', requested: plan.treatment, fallbacks, corrections: [...corrections, decision.note], placement: {centerY, widthFrac, heightFrac: heightFracRequested}, roles},
      };
    }
    // Not delivered as requested: say so, and deliver an ordinary shape-layered panel (never described as depth-aware).
    fallbacks.push(decision.note);
    kind = 'layered';
    delivered = 'layered';
  } else if (plan.treatment === 'curved') {
    kind = 'curved';
    curve = {shape: plan.curve?.shape ?? 'arc', curvature: plan.curve?.curvature ?? 0.35, direction: plan.curve?.direction ?? 'clockwise', rotationDeg: plan.curve?.rotationDeg ?? 0};
    delivered = 'curved';
  } else if (plan.treatment === 'layered') {
    kind = 'layered';
    delivered = 'layered';
  } else if (plan.treatment === 'mask_reveal') {
    const split = splitForReveal(plan.hook_wording);
    if (split) {
      kind = 'mask_reveal';
      lines = split;
      textReveal = plan.reveal ?? 'wipe-right';
      delivered = 'mask_reveal';
    } else {
      // A reveal needs something already readable on frame 0 and something left to reveal. One word has neither: deliver it plain, and say so.
      fallbacks.push('mask_reveal_needs_two_words: delivered as a plain title (no text was masked)');
    }
  }

  // The face region: the speaker's upper part, narrowed to the middle of their box (shoulders and arms are not the face).
  const faceBottom = speaker ? speaker.y + speaker.h * 0.42 : 0;
  const faceLeft = speaker ? speaker.x + speaker.w * 0.2 : 0;
  const faceRight = speaker ? speaker.x + speaker.w * 0.8 : 0;
  // WP4S: check the box the renderer actually DRAWS (openingBox: left / center / right), kept inside x 0.06..0.86 and below the top 6% UI band, not a centered box.
  let heightFrac = heightFracRequested;
  let placedWidth = widthFrac;
  let placedAlign: OpeningAlign = plan.placement.align;
  const place = () => {
    const fitted = fitOpeningBox({centerY, widthFrac: placedWidth, heightFrac, align: placedAlign});
    centerY = fitted.centerY;
    placedWidth = fitted.widthFrac;
    placedAlign = fitted.align;
    corrections.push(...fitted.corrections);
    return fitted.box;
  };
  const drawn = place();
  if (speaker && rangesOverlap(drawn.y, drawn.y + drawn.h, speaker.y, faceBottom) && rangesOverlap(drawn.x, drawn.x + drawn.w, faceLeft, faceRight)) {
    // Prefer the same size above the face; otherwise a smaller block that still fits above it; otherwise reject (never cover the face).
    const topMargin = OPENING_TOP_UI;
    const gap = 0.02;
    const room = speaker.y - gap - topMargin;
    if (room >= heightFrac) {
      const above = speaker.y - gap - heightFrac / 2;
      corrections.push(`placement: center_y ${centerY.toFixed(2)} -> ${above.toFixed(2)} (kept off the face)`);
      centerY = above;
    } else if (room >= MIN_OPENING_HEIGHT) {
      const shrunk = Math.round(room * 1000) / 1000;
      corrections.push(`placement: height ${heightFrac.toFixed(2)} -> ${shrunk.toFixed(2)}, center_y ${centerY.toFixed(2)} -> ${(topMargin + shrunk / 2).toFixed(2)} (the band above the face is only ${room.toFixed(2)} of the frame)`);
      heightFrac = shrunk;
      centerY = topMargin + shrunk / 2;
    } else {
      return reject('no_clear_band_above_the_face', plan.treatment, roles);
    }
  }

  // Legibility against the footage actually behind the text.
  const box = place(); // the box that is drawn (re-fitted after any move above the face)
  const stats = await input.measure(box);
  const over = textOverFootage({textColor: roles.roles.primary_text, panelColor: roles.roles.panel, stats, large: true});
  corrections.push(...over.corrections.map(c => `${c.kind}${c.value ? ` ${c.value}` : ''}: ${c.reason}`));
  if (kind === 'layered' && !over.panel) {
    // Layered always carries its panel; use the role colour and make sure the text reads on it.
    const onPanel = textOverFootage({textColor: roles.roles.primary_text, panelColor: roles.roles.panel, stats: {...stats, p10: 0.01, p90: 0.01, spread: 0.3}, large: true});
    over.panel = onPanel.panel ?? {color: roles.roles.panel, opacity: 0.85};
    over.textColor = onPanel.textColor;
  }

  return {
    roles,
    report: {accepted: true, delivered, requested: plan.treatment, fallbacks, corrections, placement: {centerY, widthFrac: placedWidth, heightFrac}, worstContrast: over.worstContrast, roles},
    spec: {
      text: plan.hook_wording,
      kind,
      ...(curve ? {curve} : {}),
      ...(lines ? {lines, textReveal} : {}),
      centerY,
      widthFrac: placedWidth,
      heightFrac,
      align: placedAlign,
      font: 'display',
      weight: 900,
      textColor: over.textColor,
      accentColor: roles.roles.accent,
      ...(over.strokeColor ? {strokeColor: over.strokeColor} : {}),
      ...(over.panel ? {panel: over.panel} : {}),
      startSec: 0,
      durationSec: Math.min(6, Math.max(1.5, input.hookDurationSec)),
      plan: {
        centralPromise: plan.central_promise,
        audience: plan.audience,
        angle: plan.angle,
        concept: plan.concept,
        wordingSource: plan.wording_source,
        sourceFrameSec: plan.source_frame_time_sec.toFixed(2),
        textMaskingReason: plan.text_masking_reason,
        frame0: plan.frame0,
        animation: plan.animation,
        why: plan.why_this_design,
        requestedTreatment: plan.treatment,
        deliveredTreatment: delivered,
      },
    },
  };
}

/** The box the renderer draws the opening in, frame-relative. Mirrors remotion/src/lib/openingGeometry.ts (a test asserts parity). */
export function openingRect(spec: Pick<OpeningTreatmentSpec, 'centerY' | 'widthFrac' | 'heightFrac' | 'align'>): {x: number; y: number; w: number; h: number} {
  const x = spec.align === 'left' ? 0.06 : spec.align === 'right' ? 1 - 0.06 - spec.widthFrac : (1 - spec.widthFrac) / 2;
  return {x, y: spec.centerY - spec.heightFrac / 2, w: spec.widthFrac, h: spec.heightFrac};
}

/** Splits a wording into [lead, rest] at the word boundary that balances the two halves; null when it has fewer than two words. */
export function splitForReveal(text: string): [string, string] | null {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) {
    return null;
  }
  let best = 1;
  let bestGap = Infinity;
  for (let k = 1; k < words.length; k++) {
    const gap = Math.abs(words.slice(0, k).join(' ').length - words.slice(k).join(' ').length);
    if (gap < bestGap) {
      bestGap = gap;
      best = k;
    }
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
}
