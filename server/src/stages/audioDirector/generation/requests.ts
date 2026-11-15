/**
 * Phase 1.5 generation requests: what the Director asks a generator to MAKE, kept separate from how the result is PLACED (AudioPlan + compile.ts).
 *
 *  - BgmGenerationRequest: one original bed for one edit. It carries the story (subject, narrative), the musical identity (genre, mood, instruments,
 *    texture, tempo, key), intro and ending behaviour, the duration the edit needs, voice-over compatibility, and a PROGRESSION: contiguous story
 *    segments anchored to the Event Sheet (words, events), each with a role (intro / establish / build / peak / settle / pause / resolve / outro),
 *    an energy and an emotion. The music is asked to evolve with the story, not to fit one mood.
 *  - SfxGenerationRequest: one individually identifiable sound for ONE Event Sheet event, with a semantic purpose that must fit the event's type.
 *    There is no request without an event: a timestamp alone never earns a sound.
 *
 * Timing guarantees stay with the compiler: a request resolves anchors to seconds for the generator's information, but the generated file is placed
 * by the existing deterministic path (placement, ducking, sections, fades, SFX transient alignment, word mask, budget). A `pause` in the progression
 * is a request for the music to breathe there; the audible stop is the plan's `out` section, which the compiler executes (see `warnings`).
 *
 * Pure: no I/O, no clock, no randomness. Request ids are content hashes, so the same inputs always produce the same requests.
 */

import {createHash} from 'node:crypto';

import {z} from 'zod';

import {SFX_MAX_HITS, SFX_MIN_SPACING_SEC, SFX_WORD_MASK_SEC} from '../../../lib/polishSfx.ts';
import {resolveAnchor, SFX_LEVEL_LU} from '../audioPlan/compile.ts';
import {anchorSchema, audioPlanSchema, sfxTimingSchema, type Anchor, type AudioPlan} from '../audioPlan/planSchema.ts';
import {buildSpeechGuard, PAUSE_PREONSET, placeSfxSafely, SFX_FAMILIES} from '../audioPlan/sfxSafety.ts';
import {canonicalJson} from '../eventSheet/hash.ts';
import type {EditEventSheet, EventType, SheetEvent} from '../eventSheet/types.ts';

export const GENERATION_REQUEST_VERSION = 1 as const;

export type RequestIssue = {ref: string; code: string; detail: string};

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const round3 = (value: number) => Math.round(value * 1000) / 1000 + 0;
const tag = z.string().trim().min(1).max(40);

/** The voice-first constraints every bed request carries (docs/audio/VOICE_FIRST.md; agents/music_specialist/prompts.py NEGATIVE_PROMPT, SUPPORT_TAGS). */
export const VOICE_FIRST_MUSIC_CONSTRAINTS = Object.freeze(['instrumental', 'no vocals', 'no lead melody', 'sparse arrangement', 'nothing busy in 1-4 kHz', 'supportive under speech'] as const);
/** Voice-relative bed levels the compiler applies (stages/music/duckEnvelope.ts `talking`). Recorded so the generator knows how loud the bed will sit. */
export const TALKING_DUCK_LU = Object.freeze({speech: -18, pause: -9, open: -4});

// ---------------------------------------------------------------------------------------------------------------------------------
// BGM
// ---------------------------------------------------------------------------------------------------------------------------------

export const STORY_ROLES = ['intro', 'establish', 'build', 'peak', 'settle', 'pause', 'resolve', 'outro'] as const;
export type StoryRole = (typeof STORY_ROLES)[number];

export const bgmIntentSchema = z.strictObject({
  /** What the video is about, in a phrase. */
  subject: z.string().trim().min(1).max(160),
  /** How the story unfolds, in the Director's words. Recorded for audit and future prompt work; not sent verbatim (see runware.ts). */
  narrative: z.string().trim().min(1).max(600),
  identity: z.strictObject({
    genre: tag,
    moodWords: z.array(tag).min(1).max(4),
    instruments: z.array(tag).min(1).max(4),
    texture: z.array(tag).max(3).default([]),
    /** Extra things to avoid, on top of VOICE_FIRST_MUSIC_CONSTRAINTS. */
    avoid: z.array(tag).max(6).default([]),
  }),
  tempo: z.strictObject({bpm: z.number().int().min(60).max(140), feel: z.enum(['steady', 'laid_back', 'driving', 'half_time'])}),
  key: z.string().regex(/^[A-G](#|b)? (major|minor)$/),
  /** How the bed should begin: from nothing, swelling in, or already moving. */
  intro: z.enum(['silent_entry', 'soft_swell', 'immediate']),
  /** How it should end: settle on a resolved chord, fade, or stop on a button. */
  ending: z.enum(['resolve', 'fade', 'button']),
  /** Contiguous story segments covering the music window, in order. */
  progression: z
    .array(
      z.strictObject({
        from: anchorSchema,
        to: anchorSchema,
        role: z.enum(STORY_ROLES),
        energy: z.enum(['low', 'medium', 'high']),
        emotion: z.string().trim().min(1).max(60),
        why: z.string().max(240).optional(),
      }),
    )
    .min(1)
    .max(12),
});
export type BgmIntent = z.infer<typeof bgmIntentSchema>;
export type BgmIntentInput = z.input<typeof bgmIntentSchema>;

export type ResolvedSegment = {
  role: StoryRole;
  energy: 'low' | 'medium' | 'high';
  emotion: string;
  /** Output seconds, and seconds into the music window (what the generated bed's own clock will be once placed from its start). */
  startSec: number;
  endSec: number;
  bedStartSec: number;
  bedEndSec: number;
  fromRef: string;
  toRef: string;
  /** Plan sections (by index) this segment overlaps: where the compiler will execute level changes. */
  planSections: number[];
};

export type BgmGenerationRequest = {
  version: typeof GENERATION_REQUEST_VERSION;
  kind: 'bgm';
  requestId: string;
  videoId: string;
  eventSheet: {version: number; timingHash: string};
  subject: string;
  narrative: string;
  identity: BgmIntent['identity'];
  tempo: BgmIntent['tempo'];
  key: string;
  intro: BgmIntent['intro'];
  ending: BgmIntent['ending'];
  /** The music window from the plan (frame-quantised like the compiler). */
  window: {startSec: number; endSec: number; durationSec: number};
  progression: ResolvedSegment[];
  voice: {voLufs: number | null; speechCoverage: number; duckLu: typeof TALKING_DUCK_LU; constraints: readonly string[]};
};

export type BgmRequestResult = {ok: true; request: BgmGenerationRequest; warnings: string[]} | {ok: false; errors: RequestIssue[]};

function speechCoverage(sheet: EditEventSheet, startSec: number, endSec: number): number {
  const spans = sheet.speech.words
    .map(word => [Math.max(startSec, word.time.startSec), Math.min(endSec, word.time.endSec ?? word.time.startSec)] as const)
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let covered = 0;
  let cursor = startSec;
  for (const [a, b] of spans) {
    const from = Math.max(a, cursor);
    if (b > from) covered += b - from;
    cursor = Math.max(cursor, b);
  }
  return endSec > startSec ? Math.round((covered / (endSec - startSec)) * 1000) / 1000 : 0;
}

/**
 * (sheet, plan, intent) -> one BGM generation request. The plan supplies the music window and the sections the compiler will execute; the intent
 * supplies the story and the music's identity. Every progression anchor must resolve on this sheet, and the segments must cover the window in order.
 */
export function buildBgmRequest(input: {sheet: EditEventSheet; plan: unknown; intent: unknown; videoId: string; voLufs?: number | null}): BgmRequestResult {
  const errors: RequestIssue[] = [];
  const warnings: string[] = [];
  const planParsed = audioPlanSchema.safeParse(input.plan);
  if (!planParsed.success) return {ok: false, errors: [{ref: 'plan', code: 'plan_invalid', detail: planParsed.error.issues[0]?.message ?? 'invalid'}]};
  const plan: AudioPlan = planParsed.data;
  const intentParsed = bgmIntentSchema.safeParse(input.intent);
  if (!intentParsed.success) return {ok: false, errors: intentParsed.error.issues.map(issue => ({ref: `intent.${issue.path.join('.')}`, code: 'intent_invalid', detail: issue.message}))};
  const intent = intentParsed.data;
  const {sheet} = input;
  if (plan.eventSheet.timingHash !== sheet.timingHash) return {ok: false, errors: [{ref: 'plan.eventSheet.timingHash', code: 'stale_timing', detail: 'the plan was written for a different edit timing'}]};
  if (!plan.music) return {ok: false, errors: [{ref: 'plan.music', code: 'no_music_in_plan', detail: 'the plan decides no music, so there is no bed to generate'}]};

  const events = new Map(sheet.events.map(event => [event.id, event]));
  const fps = sheet.fps;
  const start = resolveAnchor(sheet, events, plan.music.start);
  const end = resolveAnchor(sheet, events, plan.music.end);
  if (!start.ok) errors.push({ref: 'plan.music.start', code: start.code, detail: start.detail});
  if (!end.ok) errors.push({ref: 'plan.music.end', code: end.code, detail: end.detail});
  if (!start.ok || !end.ok) return {ok: false, errors};
  const windowStart = Math.round(start.timeSec * fps) / fps;
  const windowEnd = Math.min(end.timeSec, sheet.durationFrames / fps);
  if (windowEnd - windowStart < 1 / fps) return {ok: false, errors: [{ref: 'plan.music', code: 'music_window_empty', detail: `${windowStart}..${windowEnd}s`}]};

  const sections = plan.music.sections.map(section => {
    const from = resolveAnchor(sheet, events, section.from);
    const to = resolveAnchor(sheet, events, section.to);
    return from.ok && to.ok ? {from: from.timeSec, to: to.timeSec, level: section.level} : null;
  });
  const frame = 1 / fps + 1e-6;
  const progression: ResolvedSegment[] = [];
  intent.progression.forEach((segment, index) => {
    const ref = `intent.progression[${index}]`;
    const from = resolveAnchor(sheet, events, segment.from as Anchor);
    const to = resolveAnchor(sheet, events, segment.to as Anchor);
    if (!from.ok) return errors.push({ref: `${ref}.from`, code: from.code, detail: from.detail});
    if (!to.ok) return errors.push({ref: `${ref}.to`, code: to.code, detail: to.detail});
    // The window's own edges are exact (the compiler frame-quantises the entry); anything within a frame of an edge is that edge.
    const startSec = Math.abs(from.timeSec - windowStart) <= frame ? windowStart : from.timeSec;
    const endSec = Math.abs(to.timeSec - windowEnd) <= frame ? windowEnd : to.timeSec;
    if (endSec <= startSec) return errors.push({ref, code: 'segment_empty_or_reversed', detail: `${round3(startSec)}..${round3(endSec)}s`});
    if (startSec < windowStart - 1e-6 || endSec > windowEnd + 1e-6) return errors.push({ref, code: 'segment_outside_music_window', detail: `${round3(startSec)}..${round3(endSec)}s is outside ${round3(windowStart)}..${round3(windowEnd)}s`});
    const planSections = sections.flatMap((section, i) => (section && section.from < endSec && section.to > startSec ? [i] : []));
    if (segment.role === 'pause' && !planSections.some(i => ['out', 'quiet'].includes(sections[i]!.level))) {
      warnings.push(`pause_not_executed_by_plan:${ref} (generation cannot guarantee a pause; add an out or quiet section to the plan)`);
    }
    progression.push({
      role: segment.role,
      energy: segment.energy,
      emotion: segment.emotion,
      startSec: round3(startSec),
      endSec: round3(endSec),
      bedStartSec: round3(startSec - windowStart),
      bedEndSec: round3(endSec - windowStart),
      fromRef: `${from.ref}@${from.at}`,
      toRef: `${to.ref}@${to.at}`,
      planSections,
    });
  });
  if (errors.length === 0) {
    if (Math.abs(progression[0]!.startSec - round3(windowStart)) > 0.0015) errors.push({ref: 'intent.progression[0]', code: 'progression_does_not_start_with_music', detail: `starts at ${progression[0]!.startSec}s, music at ${round3(windowStart)}s`});
    if (Math.abs(progression.at(-1)!.endSec - round3(windowEnd)) > 0.0015) errors.push({ref: `intent.progression[${progression.length - 1}]`, code: 'progression_does_not_end_with_music', detail: `ends at ${progression.at(-1)!.endSec}s, music at ${round3(windowEnd)}s`});
    for (let i = 1; i < progression.length; i += 1) {
      const gap = progression[i]!.startSec - progression[i - 1]!.endSec;
      if (Math.abs(gap) > frame) errors.push({ref: `intent.progression[${i}]`, code: gap > 0 ? 'progression_gap' : 'progression_overlap', detail: `${progression[i - 1]!.endSec}s -> ${progression[i]!.startSec}s`});
    }
  }
  if (errors.length > 0) return {ok: false, errors};

  const body = {
    version: GENERATION_REQUEST_VERSION,
    kind: 'bgm' as const,
    videoId: input.videoId,
    eventSheet: {version: sheet.version, timingHash: sheet.timingHash},
    subject: intent.subject,
    narrative: intent.narrative,
    identity: intent.identity,
    tempo: intent.tempo,
    key: intent.key,
    intro: intent.intro,
    ending: intent.ending,
    window: {startSec: round3(windowStart), endSec: round3(windowEnd), durationSec: round3(windowEnd - windowStart)},
    progression,
    voice: {
      voLufs: typeof input.voLufs === 'number' && Number.isFinite(input.voLufs) ? input.voLufs : null,
      speechCoverage: speechCoverage(sheet, windowStart, windowEnd),
      duckLu: TALKING_DUCK_LU,
      constraints: VOICE_FIRST_MUSIC_CONSTRAINTS,
    },
  };
  if (body.voice.voLufs === null) warnings.push('vo_lufs_unknown (the bed will be muted at compile time unless the voice level is measured)');
  return {ok: true, request: {...body, requestId: `bgmreq-v1:${sha256(canonicalJson(body))}`}, warnings};
}

// ---------------------------------------------------------------------------------------------------------------------------------
// SFX
// ---------------------------------------------------------------------------------------------------------------------------------

export const SFX_PURPOSES = ['keyword_appearance', 'title_reveal', 'scene_change', 'product_reveal', 'punch_in', 'visual_emphasis', 'important_action', 'emotional_pause', 'outro_resolution'] as const;
export type SfxPurpose = (typeof SFX_PURPOSES)[number];

/** Which Event Sheet event types can carry each purpose. A purpose on any other type is refused (no sound without a matching visual event). */
export const PURPOSE_EVENT_TYPES: Readonly<Record<SfxPurpose, readonly EventType[]>> = Object.freeze({
  keyword_appearance: ['kinetic_event', 'kinetic_line', 'kinetic_gap_caption', 'behind_subject_text', 'semantic_emphasis', 'stage_accent'],
  title_reveal: ['hook_title', 'opening_treatment', 'explainer_claim'],
  scene_change: ['cut', 'transition', 'stage_cutaway', 'explainer_layout', 'newsroom_layout'],
  product_reveal: ['inset_reveal', 'media_container', 'frame_inset', 'broll', 'generated_graphic', 'stage_span'],
  punch_in: ['impact_punch_in', 'zoom'],
  visual_emphasis: ['impact_flash', 'impact_sat_pop', 'kinetic_flash', 'kinetic_exit', 'semantic_emphasis', 'grade_beat', 'stage_accent'],
  important_action: ['motion_graphic', 'visual_overlay', 'depth_overlay', 'media_container'],
  emotional_pause: ['impact_bw_span', 'grade_beat', 'stage_span'],
  outro_resolution: ['cut', 'transition', 'motion_graphic', 'visual_overlay', 'media_container', 'stage_cutaway', 'hook_title'],
});
/** An outro sound must sit in the last quarter of the edit. */
export const OUTRO_FRACTION = 0.75;

/** The SFX families (shared with the compiler's timing windows: audioPlan/sfxSafety.ts). */
export {SFX_FAMILIES};

export const sfxIntentSchema = z
  .strictObject({
    eventId: z.string().min(1).max(200),
    purpose: z.enum(SFX_PURPOSES),
    character: z.strictObject({family: z.enum(SFX_FAMILIES), description: z.string().trim().min(1).max(160)}),
    durationSec: z.strictObject({min: z.number().min(0.05).max(5), max: z.number().min(0.05).max(5)}),
    /** The plan's SFX level words (compile.ts SFX_LEVEL_LU): how far under the voice the sound peaks. */
    intensity: z.enum(['subtle', 'normal', 'featured']),
    /** Essential sounds win budget conflicts and are reported when they cannot be produced. */
    essential: z.boolean(),
    allowConditionalVisibility: z.boolean().default(false),
    why: z.string().max(240).optional(),
  })
  .refine(value => value.durationSec.min <= value.durationSec.max, {message: 'durationSec.min must not exceed durationSec.max', path: ['durationSec']});
export type SfxIntentInput = z.input<typeof sfxIntentSchema>;

export type SfxGenerationRequest = {
  version: typeof GENERATION_REQUEST_VERSION;
  kind: 'sfx';
  requestId: string;
  videoId: string;
  eventSheet: {version: number; timingHash: string};
  event: {id: string; type: EventType; source: string; anchorAt: 'impact' | 'start'; timeSec: number; anchorSource: string; label: string | null};
  purpose: SfxPurpose;
  character: {family: (typeof SFX_FAMILIES)[number]; description: string};
  durationSec: {min: number; max: number};
  intensity: 'subtle' | 'normal' | 'featured';
  levelVsVoiceLu: number;
  essential: boolean;
  allowConditionalVisibility: boolean;
  voice: {inSpeech: boolean; nearestWordOnsetSec: number | null; wordMaskSec: number};
  /** Phase SFX-3: present only when a timing policy was given. The planned placement (from placeSfxSafely, the compiler's own function). */
  timing?: {policy: 'speech_safe' | 'speech_hybrid' | 'speech_pause_preonset'; tier?: 'speech_clear' | 'acoustic_pause' | 'pre_onset' | 'onset_accent'; originalStartFrame: number; startFrame: number; shiftFrames: number; overlapsSpeech: boolean; durationSec: number};
};

export type SfxRequestSet = {
  requests: SfxGenerationRequest[];
  /** Intents that can never produce a placeable sound (unknown event, wrong type, inside the word mask, duplicate...). */
  refused: RequestIssue[];
  /** Valid intents left out by the voice-first budget (spacing, cap). Optional sounds go first. */
  dropped: RequestIssue[];
  /** Essential intents that were refused or dropped. Non-empty = the Director's essential sound set cannot be honoured as written. */
  essentialUnmet: string[];
};

const eventLabel = (event: SheetEvent): string | null => {
  for (const key of ['keyword', 'text', 'label', 'title']) if (typeof event.attrs[key] === 'string' && event.attrs[key]) return String(event.attrs[key]).slice(0, 80);
  return null;
};

/** (sheet, intents) -> individually identifiable SFX requests, one per event, each tied to an Event Sheet event. Never throws. */
export function buildSfxRequests(input: {
  sheet: EditEventSheet;
  intents: readonly unknown[];
  videoId: string;
  /** Phase SFX-2 (optional): the plan's speech-safe timing. When given, an intent that could never be placed is refused before payment. */
  timing?: unknown;
}): SfxRequestSet {
  const {sheet} = input;
  const events = new Map(sheet.events.map(event => [event.id, event]));
  const refused: RequestIssue[] = [];
  const candidates: SfxGenerationRequest[] = [];
  const seen = new Set<string>();
  const essentialIds = new Set<string>();
  const compositionEnd = sheet.durationFrames / sheet.fps;
  const timingParsed = input.timing === undefined ? null : sfxTimingSchema.safeParse(input.timing);
  const timing = timingParsed && timingParsed.success ? timingParsed.data : null;
  const guard = timing ? buildSpeechGuard(sheet, timing) : null;
  input.intents.forEach((raw, index) => {
    const parsed = sfxIntentSchema.safeParse(raw);
    const ref = `sfx[${index}]`;
    if (!parsed.success) return refused.push({ref, code: 'intent_invalid', detail: parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')});
    const intent = parsed.data;
    const eventRef = `${ref}:${intent.eventId}`;
    if (intent.essential) essentialIds.add(intent.eventId);
    if (seen.has(intent.eventId)) return refused.push({ref: eventRef, code: 'duplicate_event', detail: 'one generated sound per event; this event already has a request'});
    const event = events.get(intent.eventId);
    if (!event) return refused.push({ref: eventRef, code: 'unknown_event', detail: 'not an event of this sheet (unknown, excluded or not rendered)'});
    if (event.duplicateOf) return refused.push({ref: eventRef, code: 'duplicate_of_event', detail: `the same visual as ${event.duplicateOf}; request the sound on that event`});
    if (!PURPOSE_EVENT_TYPES[intent.purpose].includes(event.type)) return refused.push({ref: eventRef, code: 'purpose_event_type_mismatch', detail: `${intent.purpose} cannot sit on a ${event.type} event`});
    const anchorAt = event.impact ? 'impact' : 'start';
    const anchor = resolveAnchor(sheet, events, {kind: 'event', eventId: event.id, at: anchorAt});
    if (!anchor.ok) return refused.push({ref: eventRef, code: anchor.code, detail: anchor.detail});
    if (anchor.conditional && !intent.allowConditionalVisibility) return refused.push({ref: eventRef, code: 'anchor_conditional_visibility', detail: `${event.id} is only drawn under render-time conditions`});
    if (intent.purpose === 'outro_resolution' && anchor.timeSec < compositionEnd * OUTRO_FRACTION) return refused.push({ref: eventRef, code: 'not_in_outro', detail: `${round3(anchor.timeSec)}s is before the last quarter (${round3(compositionEnd * OUTRO_FRACTION)}s)`});
    // The compiler lands a transient 0..1 frame AFTER its anchor (it never plays early), then refuses it inside (onset, onset + mask]. A request whose
    // landing frame can touch that window is refused here, before anything is paid for.
    const frameSec = 1 / sheet.fps;
    const onset = sheet.speech.words.find(word => anchor.timeSec + frameSec > word.time.startSec + 1e-6 && anchor.timeSec <= word.time.startSec + SFX_WORD_MASK_SEC + 1e-6);
    // SFX-3: with a timing policy the policy's own onset protection decides (exactly as the compiler does); the legacy mask applies without one.
    if (onset && !timing) return refused.push({ref: eventRef, code: 'word_mask', detail: `${round3(anchor.timeSec)}s lands within ${SFX_WORD_MASK_SEC * 1000} ms after ${onset.id} (${onset.time.startSec}s); the compiler would refuse the sound, so it is not generated`});
    let plannedPlacement: SfxGenerationRequest['timing'] | undefined;
    if (timingParsed && !timingParsed.success) return refused.push({ref: eventRef, code: 'timing_invalid', detail: timingParsed.error.issues.map(issue => issue.message).join('; ')});
    if (timing && guard) {
      // Pre-payment check with what is known before generation: the request's longest duration, its family window, the transient at the file start.
      // The compiler re-checks with the measured asset; this only avoids paying for sounds that could never be placed.
      const baseStartFrame = Math.ceil(Math.max(0, anchor.timeSec) * sheet.fps - 1e-6);
      const placed = placeSfxSafely({
        policy: timing.policy,
        baseStartFrame,
        fps: sheet.fps,
        compositionFrames: sheet.durationFrames,
        durationSec: intent.durationSec.max,
        family: intent.character.family,
        level: intent.intensity,
        eventEndSec: event.time.endSec,
        guard,
        // Validation Sprint 2: the generated file's transient offset is not known yet; assume it is a little late (an onset accent's hit must still
        // land before the word). Only the onset-accent tier reads it, and only under speech_pause_preonset with underSpeech: 'onset_accent'.
        transientOffsetSec: PAUSE_PREONSET.prepaymentTransientAllowanceSec,
        eventStartSec: event.time.startSec,
      });
      if (!placed.ok) return refused.push({ref: eventRef, code: placed.reason, detail: `${round3(anchor.timeSec)}s: ${placed.detail}`});
      plannedPlacement = {policy: timing.policy, ...(placed.tier ? {tier: placed.tier} : {}), originalStartFrame: baseStartFrame, startFrame: placed.startFrame, shiftFrames: placed.shiftFrames, overlapsSpeech: placed.overlapsSpeech, durationSec: intent.durationSec.max};
    }
    const inSpeech = sheet.speech.words.some(word => anchor.timeSec >= word.time.startSec && anchor.timeSec < (word.time.endSec ?? word.time.startSec));
    const nearest = sheet.speech.words.reduce<number | null>((best, word) => (best === null || Math.abs(word.time.startSec - anchor.timeSec) < Math.abs(best - anchor.timeSec) ? word.time.startSec : best), null);
    const body = {
      version: GENERATION_REQUEST_VERSION,
      kind: 'sfx' as const,
      videoId: input.videoId,
      eventSheet: {version: sheet.version, timingHash: sheet.timingHash},
      event: {id: event.id, type: event.type, source: event.source, anchorAt, timeSec: round3(anchor.timeSec), anchorSource: anchor.source, label: eventLabel(event)},
      purpose: intent.purpose,
      character: intent.character,
      durationSec: intent.durationSec,
      intensity: intent.intensity,
      levelVsVoiceLu: SFX_LEVEL_LU[intent.intensity],
      essential: intent.essential,
      allowConditionalVisibility: intent.allowConditionalVisibility,
      voice: {inSpeech, nearestWordOnsetSec: nearest, wordMaskSec: SFX_WORD_MASK_SEC},
      ...(plannedPlacement ? {timing: plannedPlacement} : {}),
    } as const;
    // SFX-1: only an intent that passed every check consumes its event, so a refused intent never blocks a later valid one for the same event.
    seen.add(intent.eventId);
    candidates.push({...body, requestId: `sfxreq-v1:${sha256(canonicalJson(body))}`});
  });

  // The same voice-first budget the compiler enforces (lib/polishSfx.ts), applied BEFORE paying for sounds: essential first, then time, then event id.
  const dropped: RequestIssue[] = [];
  const kept: SfxGenerationRequest[] = [];
  const order = [...candidates].sort((a, b) => Number(b.essential) - Number(a.essential) || a.event.timeSec - b.event.timeSec || (a.event.id < b.event.id ? -1 : 1));
  for (const request of order) {
    const ref = `sfx:${request.event.id}`;
    if (kept.length >= SFX_MAX_HITS) {
      dropped.push({ref, code: 'sfx_cap', detail: `more than ${SFX_MAX_HITS} sounds`});
      continue;
    }
    const near = kept.find(item => Math.abs(item.event.timeSec - request.event.timeSec) < SFX_MIN_SPACING_SEC - 1e-9);
    if (near) {
      dropped.push({ref, code: 'sfx_spacing', detail: `within ${SFX_MIN_SPACING_SEC}s of ${near.event.id}`});
      continue;
    }
    kept.push(request);
  }
  const requests = kept.sort((a, b) => a.event.timeSec - b.event.timeSec || (a.event.id < b.event.id ? -1 : 1));
  const produced = new Set(requests.map(request => request.event.id));
  return {requests, refused, dropped, essentialUnmet: [...essentialIds].filter(id => !produced.has(id)).sort()};
}
