/**
 * AudioPlan v1: the director's INTENT for a soundtrack. Strict schema (unknown keys rejected), written so a model can author it later and a
 * human can author it now. It never contains seconds, frames, decibels, file paths or URLs: every time is an anchor into the Edit Event Sheet,
 * every level is a word, every sound is a registry name. The deterministic compiler (compile.ts) turns it into an AudioTimeline.
 *
 * Identity: `eventSheet.timingHash` must equal the sheet's `timingHash` (eventSheet/hash.ts). A timing change invalidates the plan.
 * `visualContentHash` is recorded for audit only: a picture-only change (a different B-roll clip at the same time) does NOT invalidate it.
 */

import {z} from 'zod';

import {SFX_CUES} from '../../../lib/sfxCatalog.ts';
import {EVENT_SHEET_VERSION} from '../eventSheet/types.ts';
import {SFX_FAMILIES, SFX_SPEECH_MARGIN_SEC} from './sfxSafety.ts';

export const AUDIO_PLAN_VERSION = 1 as const;

/** A moment of the finished edit. `impact` is only valid where the sheet established one (never replaced by `start`). */
export const anchorSchema = z.discriminatedUnion('kind', [
  z.strictObject({kind: z.literal('start')}),
  z.strictObject({kind: z.literal('end')}),
  z.strictObject({kind: z.literal('event'), eventId: z.string().min(1).max(200), at: z.enum(['start', 'end', 'impact'])}),
  z.strictObject({kind: z.literal('word'), wordId: z.string().regex(/^w\d+$/), at: z.enum(['start', 'end'])}),
]);
export type Anchor = z.infer<typeof anchorSchema>;

/** Section levels are words; the compiler maps them to gain (compile.ts SECTION_GAIN_DB). `out` = a stop-down (silence). */
export const SECTION_LEVELS = ['full', 'reduced', 'quiet', 'out'] as const;

export const musicIntentSchema = z.strictObject({
  /** Asset registry id (assets.ts). Never a URL. */
  assetId: z.string().min(1).max(200),
  start: anchorSchema.default({kind: 'start'}),
  end: anchorSchema.default({kind: 'end'}),
  /** How the bed lines up: `auto` = the existing placement (downbeat start, energy fit); `lift_at` = also land the bed's measured lift on this anchor. */
  align: z.discriminatedUnion('kind', [z.strictObject({kind: z.literal('auto')}), z.strictObject({kind: z.literal('lift_at'), anchor: anchorSchema})]).default({kind: 'auto'}),
  fadeIn: z.enum(['none', 'short', 'long']).default('none'),
  /** `auto` = the existing placement decides button (on a bar line) or hold-and-fade; `fade` = always hold-and-fade to the end anchor. */
  ending: z.enum(['auto', 'fade']).default('auto'),
  /** Voice-first: the bed is always ducked relative to the measured voice (stages/music/duckEnvelope.ts `talking`). Kept explicit; nothing else is allowed. */
  ducking: z.literal('talking').default('talking'),
  sections: z
    .array(
      z.strictObject({
        from: anchorSchema,
        to: anchorSchema,
        energy: z.enum(['low', 'medium', 'high']),
        level: z.enum(SECTION_LEVELS),
        why: z.string().max(240).optional(),
      }),
    )
    .max(16)
    .default([]),
  why: z.string().max(240).optional(),
});
export type MusicIntent = z.infer<typeof musicIntentSchema>;

export const BUILTIN_SFX_NAMES = ['whoosh', 'hit', 'pop'] as const;

export const sfxCueSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/),
  anchor: anchorSchema,
  /** `transient`: the sound's measured onset lands on the anchor. `start`: the file starts on the anchor. */
  align: z.enum(['transient', 'start']).default('transient'),
  sound: z.discriminatedUnion('kind', [
    z.strictObject({kind: z.literal('builtin'), name: z.enum(BUILTIN_SFX_NAMES)}),
    z.strictObject({kind: z.literal('catalog'), cue: z.enum(SFX_CUES)}),
    /** Phase 1.5: a registered SFX asset (assets.ts SfxAsset), e.g. one generated for this event. Never a URL or path. */
    z.strictObject({kind: z.literal('asset'), assetId: z.string().min(1).max(200)}),
  ]),
  level: z.enum(['subtle', 'normal', 'featured']).default('normal'),
  /** 1 = keep first when the budget (spacing, cap) forces a choice. */
  priority: z.number().int().min(1).max(5).default(3),
  /** A cue may only sit on an event whose visibility is `conditional` when this is true. */
  allowConditionalVisibility: z.boolean().default(false),
  /** Phase SFX-2 (optional): the sound's family, which selects its timing window under `sfxTiming`. Absent = derived from the sound (sfxSafety.ts). */
  family: z.enum(SFX_FAMILIES).optional(),
  /** Validation Sprint 2 (generated cues only): the transient frame the pre-payment plan scheduled. The compiler prefers the position that keeps it,
   *  so the planner's budget and the compiler's agree (audioPlan/sfxSchedule.ts). Absent = the placement's own preference, as before. */
  plannedTransientFrame: z.number().int().min(0).optional(),
  why: z.string().max(240).optional(),
});
export type SfxCue = z.infer<typeof sfxCueSchema>;

/**
 * Phase SFX-2 (optional, opt-in): speech-safe SFX timing (audioPlan/sfxSafety.ts). Absent = the legacy rules, unchanged.
 * `speechAbsent: true` states the edit has no speech; otherwise an empty word list is treated as missing timing.
 */
export const sfxTimingSchema = z.strictObject({
  /** `speech_safe` (SFX-2): no SFX overlaps speech. `speech_hybrid` (SFX-3, approved): long/sustained as speech_safe; short subtle transients
   *  (impact, pop, click, <= 200 ms measured) may sit under speech away from onsets (audioPlan/sfxSafety.ts). */
  policy: z.enum(['speech_safe', 'speech_hybrid', 'speech_pause_preonset']),
  speechMarginSec: z.number().min(0.05).max(0.5).default(SFX_SPEECH_MARGIN_SEC),
  speechAbsent: z.boolean().default(false),
  /** speech_pause_preonset only: the MEASURED voice-activity map (audioPlan/voiceActivity.ts). Absent = only speech-clear placements. */
  voiceActivity: z
    .strictObject({
      source: z.literal('measured'),
      frameSec: z.number().positive().max(0.05),
      speechP95Dbfs: z.number().finite(),
      noiseFloorDbfs: z.number().finite(),
      thresholdDbfs: z.number().finite(),
      silences: z.array(z.tuple([z.number().min(0), z.number().min(0)]).refine(([a, b]) => b > a, 'silence end must be after its start')),
    })
    .optional(),
  /** speech_pause_preonset only. `acoustic` (default): an ASR word onset that falls INSIDE a measured silence is treated as an alignment artifact; the
   *  protected onset is where the voice measurably resumes. `strict`: a sound never contains an ASR onset (nor one within preOnsetGuardSec after it). */
  asrOnsetInsideSilence: z.enum(['acoustic', 'strict']).default('acoustic'),
  /** speech_pause_preonset only. `onset_accent`: also allow a SHORT, speech-band-carved transient whose transient lands 0..40 ms before a protected
   *  word onset (audioPlan/sfxSafety.ts PAUSE_PREONSET.accent). `none` (default): nothing ever plays while the voice is active. */
  underSpeech: z.enum(['none', 'onset_accent']).default('none'),
});

export const audioPlanSchema = z.strictObject({
  version: z.literal(AUDIO_PLAN_VERSION),
  eventSheet: z.strictObject({
    version: z.literal(EVENT_SHEET_VERSION),
    timingHash: z.string().regex(/^timing-v1:[0-9a-f]{64}$/),
  }),
  /** Audit only; never invalidates the plan. */
  visualContentHash: z.string().regex(/^visual-v1:[0-9a-f]{64}$/).optional(),
  /** null = a deliberate decision to use no music. */
  music: musicIntentSchema.nullable(),
  sfx: z.array(sfxCueSchema).max(32).default([]),
  sfxTiming: sfxTimingSchema.optional(),
  policy: z
    .strictObject({
      /** `reject_plan`: any invalid element rejects the whole plan. `drop_element`: invalid elements are dropped (and listed); the rest compiles. */
      onInvalidElement: z.enum(['reject_plan', 'drop_element']).default('reject_plan'),
      /** What the caller should do when the plan is rejected. The compiler never runs the fallback itself. */
      fallback: z.enum(['rules_pipeline', 'voice_only']).default('rules_pipeline'),
    })
    .default({onInvalidElement: 'reject_plan', fallback: 'rules_pipeline'}),
  provenance: z.strictObject({author: z.enum(['hand', 'rules', 'model']), note: z.string().max(500).optional()}),
});

/** The parsed plan (defaults applied). */
export type AudioPlan = z.infer<typeof audioPlanSchema>;
/** What an author writes (defaults optional). */
export type AudioPlanInput = z.input<typeof audioPlanSchema>;
