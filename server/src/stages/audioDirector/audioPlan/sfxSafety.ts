/**
 * Phase SFX-2/SFX-3: speech-aware SFX placement. Pure and deterministic; frame-grid only. The ONE decision function shared by the compiler (compile.ts)
 * and, before any payment, the SFX request builder (generation/requests.ts): same inputs give the same decision, frame and reason.
 *
 * Policies (opt-in per plan via `sfxTiming`; absent = the legacy rules, byte-identical):
 *
 *   `speech_safe` (SFX-2): the WHOLE sound [start, start + duration] must not overlap any spoken word widened by `speechMarginSec` on both sides.
 *
 *   `speech_hybrid` (SFX-3, approved product policy "Option D"):
 *     - Long and sustained families (whoosh, sweep, riser, swell, texture, stinger): exactly the `speech_safe` rule.
 *     - Short transients (impact, pop, click) take a speech-clear position when one exists in their window. Otherwise they may sit UNDER speech
 *       only when ALL hold: measured audible duration <= 200 ms; intensity `subtle` (the existing level, unchanged); the sound does not start within
 *       120 ms after any word onset (the existing SFX_WORD_MASK_SEC) and does not start exactly on an onset; its tail ends before the next word
 *       onset minus `speechMarginSec`; no unreliable word timing is involved. Otherwise it is dropped with the precise reason.
 *
 *   Both: the sound moves only inside its family's semantic window around ITS OWN anchor (never to another event); nearest frame first, later before
 *   earlier at equal distance; no truncation (a tail past the composition end, or past a sustained family's event end, is not placed); word timing is
 *   never invented (unreliable words block up to the next word start; an empty word list is missing timing unless `speechAbsent: true`).
 */

import {SFX_WORD_MASK_SEC} from '../../../lib/polishSfx.ts';
import type {EditEventSheet} from '../eventSheet/types.ts';
import {containingSilence, type VoiceActivityMap} from './voiceActivity.ts';

export const SFX_FAMILIES = ['whoosh', 'impact', 'riser', 'pop', 'click', 'swell', 'sweep', 'texture', 'stinger'] as const;
export type SfxFamily = (typeof SFX_FAMILIES)[number];
export type SfxLevel = 'subtle' | 'normal' | 'featured';
export type SfxTimingPolicyName = 'speech_safe' | 'speech_hybrid' | 'speech_pause_preonset';

/** Default margin around each spoken word. Rationale: the legacy rule already protects 120 ms after an onset (lib/polishSfx.ts SFX_WORD_MASK_SEC);
 *  100 ms on BOTH sides of the whole word keeps a sound clear of consonant onsets and word releases without inventing word boundaries. */
export const SFX_SPEECH_MARGIN_SEC = 0.1;
/** A word longer than this is not trusted as a single word (alignment drift). */
export const MAX_PLAUSIBLE_WORD_SEC = 3;

/** speech_hybrid: the families that may play under speech, their maximum measured duration, the only level allowed there, and the onset guard. */
export const HYBRID_UNDER_SPEECH = Object.freeze({
  families: Object.freeze(['impact', 'pop', 'click'] as const),
  maxDurationSec: 0.2,
  level: 'subtle' as const,
  onsetProtectionSec: SFX_WORD_MASK_SEC,
});

/**
 * Per-family semantic windows and caps. Rationale:
 *   - Impacts, pops, clicks and stingers mark the moment itself: never earlier (product spec 5.6: sound before the picture reads as a mistake), at most
 *     100 ms (3 frames at 30 fps) later, which still reads as synchronous.
 *   - Whooshes, sweeps and risers lead INTO a visual by convention: up to 500 ms earlier, at most 100 ms later.
 *   - Swells and textures underscore a visible element: up to 250 ms either way; they must end before the element's visible end.
 *   - Max durations follow the request ceiling for one-shots in speech-dense shorts (one-shots 1.5 s, stingers 2 s, sustained 3 s).
 */
export const SFX_FAMILY_TIMING: Readonly<Record<SfxFamily, {earlierSec: number; laterSec: number; maxDurationSec: number; sustained: boolean}>> = Object.freeze({
  impact: {earlierSec: 0, laterSec: 0.1, maxDurationSec: 1.5, sustained: false},
  pop: {earlierSec: 0, laterSec: 0.1, maxDurationSec: 1.5, sustained: false},
  click: {earlierSec: 0, laterSec: 0.1, maxDurationSec: 1.5, sustained: false},
  stinger: {earlierSec: 0, laterSec: 0.1, maxDurationSec: 2, sustained: false},
  whoosh: {earlierSec: 0.5, laterSec: 0.1, maxDurationSec: 1.5, sustained: false},
  sweep: {earlierSec: 0.5, laterSec: 0.1, maxDurationSec: 1.5, sustained: false},
  riser: {earlierSec: 0.5, laterSec: 0, maxDurationSec: 2, sustained: false},
  swell: {earlierSec: 0.25, laterSec: 0.25, maxDurationSec: 3, sustained: true},
  texture: {earlierSec: 0.25, laterSec: 0.25, maxDurationSec: 3, sustained: true},
});

/** At most one SFX audible at a time, and at most 2 SFX in any ~3 s stretch (rapid edits do not stack sounds). Added to the legacy 0.8 s / 8 budget. */
export const SFX_MAX_LAYERS = 1;
export const SFX_DENSITY = Object.freeze({windowSec: 3, max: 2});

export type SfxTimingPolicy = {policy: SfxTimingPolicyName; speechMarginSec: number; speechAbsent: boolean; voiceActivity?: VoiceActivityMap; asrOnsetInsideSilence?: 'acoustic' | 'strict'; underSpeech?: 'none' | 'onset_accent'};

/**
 * `speech_pause_preonset` (Production Completion Sprint 1; opt-in, AUDIO_DIRECTOR_SFX_PLACEMENT=pause_preonset). Nothing is ever placed under speech.
 * Hierarchy, per candidate position inside the event's sync window:
 *   1. speech_clear    the speech_safe rule on the ASR words (whole sound >= speechMarginSec from every word).
 *   2. acoustic_pause  the whole sound, widened by releaseGuardSec before and preOnsetGuardSec after, lies inside ONE measured silence of the
 *                      creator's voice (voiceActivity.ts) that is at least genuinePauseSec long. Any family.
 *   3. pre_onset       the same containment inside a shorter measured silence, for short transients only (impact, pop, click, <= 150 ms): the sound
 *                      ends at least preOnsetGuardSec before the voice resumes (the protected onset). Transients may land up to preOnsetEarlierSec
 *                      before their anchor here (below the ITU-R BT.1359 audio-lead detectability threshold, 45 ms); never more than the family's later limit.
 *   4. otherwise rejected ('no_pause_or_preonset_gap').
 * In tiers 2 and 3 the existing ASR onset mask still applies: a sound never starts within SFX_WORD_MASK_SEC (120 ms) after an ASR word onset. An ASR
 * onset that falls INSIDE a measured silence is an alignment artifact (contiguous ASR words); the protected onset there is the acoustic one (the
 * silence end), which the containment already protects. Without a voice-activity map only tier 1 runs (fail safe). Levels are the existing words.
 */
export const PAUSE_PREONSET = Object.freeze({
  releaseGuardSec: 0.05,
  preOnsetGuardSec: 0.06,
  genuinePauseSec: 0.25,
  preOnsetFamilies: Object.freeze(['impact', 'pop', 'click'] as const),
  preOnsetMaxDurationSec: 0.15,
  preOnsetEarlierSec: 0.04,
  minSoundSec: 0.05,
  /**
   * Visual Event Sound Design (opt-in, underSpeech: 'onset_accent'): a short transient may accent a word AS IT IS SPOKEN, under these limits:
   * impact / pop / click only, <= maxDurationSec; the sound STARTS (its transient lands) within leadSec BEFORE a protected word onset, never after
   * it (so never inside the 120 ms post-onset mask); its tail ends >= tailGuardSec before the NEXT protected onset (it never spans two words); the
   * asset is speech-band carved (generation/speechCarve.ts, -18 dB around 2 kHz) - the compiler refuses an uncarved asset in this tier.
   * The sync is the Kinetic contract itself: a word's visual landing IS its speech onset (remotion/src/kinetic/spec.ts startFrame).
   */
  accent: Object.freeze({maxDurationSec: 0.15, leadSec: 0.04, tailGuardSec: 0.06}),
  /** Validation Sprint 2: before payment the measured transient offset is unknown; an accent's hit is checked as if it were this late (ingest crops
   *  leading silence, so a generated transient sits within a few ms of the file start). The compiler always uses the measured value. */
  prepaymentTransientAllowanceSec: 0.015,
  /** Validation Sprint 2: an onset accent may lead its anchor (a Kinetic word's landing, 1-2 frames after its speech onset) by up to this much, but
   *  NEVER before the event's first visible frame (eventStartSec): the sound sits on the visible start of the motion, its hit before the onset. */
  accentMaxLeadSec: 0.07,
});
export type PlacementTier = 'speech_clear' | 'acoustic_pause' | 'pre_onset' | 'onset_accent';

type Span = {fromSec: number; toSec: number; wordId: string; reliable: boolean; onsetSec: number; wordEndSec: number | null; protectedOnsetSec?: number};
export type SpeechGuard = {status: 'missing'} | {status: 'ok'; marginSec: number; blocked: ReadonlyArray<Span>; silences?: ReadonlyArray<readonly [number, number]>; strictAsrOnsets?: boolean; onsetAccents?: boolean};

/** Blocked spans built from the Event Sheet's own word times (output domain). Never extends a word with a guessed end. */
export function buildSpeechGuard(sheet: EditEventSheet, policy: Pick<SfxTimingPolicy, 'speechMarginSec' | 'speechAbsent'> & {policy?: SfxTimingPolicyName; voiceActivity?: VoiceActivityMap; asrOnsetInsideSilence?: 'acoustic' | 'strict'; underSpeech?: 'none' | 'onset_accent'}): SpeechGuard {
  const base = buildSpeechGuardInner(sheet, policy);
  return base.status === 'ok' && policy.policy === 'speech_pause_preonset' && policy.underSpeech === 'onset_accent' ? {...base, onsetAccents: true} : base;
}

function buildSpeechGuardInner(sheet: EditEventSheet, policy: Pick<SfxTimingPolicy, 'speechMarginSec' | 'speechAbsent'> & {policy?: SfxTimingPolicyName; voiceActivity?: VoiceActivityMap; asrOnsetInsideSilence?: 'acoustic' | 'strict'}): SpeechGuard {
  const guard = buildAsrSpeechGuard(sheet, policy);
  // The measured silences are attached only for the policy that uses them (the other policies' guards are unchanged).
  if (guard.status === 'ok' && policy.policy === 'speech_pause_preonset' && policy.voiceActivity) {
    const silences = policy.voiceActivity.silences;
    if (policy.asrOnsetInsideSilence === 'strict') return {...guard, silences, strictAsrOnsets: true};
    // `acoustic`: an ASR onset strictly inside a measured silence is an alignment artifact; its protected onset is where the voice resumes.
    const blocked = guard.blocked.map(span => {
      const inside = silences.find(([from, to]) => span.onsetSec > from + EPS && span.onsetSec < to - EPS);
      return inside ? {...span, protectedOnsetSec: inside[1]} : span;
    });
    return {...guard, blocked, silences};
  }
  return guard;
}

function buildAsrSpeechGuard(sheet: EditEventSheet, policy: Pick<SfxTimingPolicy, 'speechMarginSec' | 'speechAbsent'>): SpeechGuard {
  const words = sheet.speech.words;
  const end = sheet.durationFrames / sheet.fps;
  const m = policy.speechMarginSec;
  if (words.length === 0) return policy.speechAbsent ? {status: 'ok', marginSec: m, blocked: []} : {status: 'missing'};
  const blocked: Span[] = [];
  let previousStart = -Infinity;
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i]!;
    const start = word.time.startSec;
    const wordEnd = word.time.endSec;
    if (!Number.isFinite(start)) return {status: 'missing'};
    const nextStart = words.slice(i + 1).map(next => next.time.startSec).find(value => Number.isFinite(value) && value > start) ?? end;
    const reliable = wordEnd !== null && Number.isFinite(wordEnd) && wordEnd > start && wordEnd - start <= MAX_PLAUSIBLE_WORD_SEC && start >= previousStart - 1e-6;
    blocked.push({fromSec: start - m, toSec: (reliable ? (wordEnd as number) : nextStart) + m, wordId: word.id, reliable, onsetSec: start, wordEndSec: reliable ? (wordEnd as number) : null});
    previousStart = Math.max(previousStart, start);
  }
  return {status: 'ok', marginSec: m, blocked};
}

export type PlacementInput = {
  policy: SfxTimingPolicyName;
  /** Start frame the legacy rule would use (transient on the anchor, rounded so it is never early). */
  baseStartFrame: number;
  fps: number;
  compositionFrames: number;
  /** Audible duration: the measured (ingested) file duration in the compiler; the request's maximum before payment. */
  durationSec: number;
  family: SfxFamily;
  level: SfxLevel;
  /** Visible end of the anchor event, when it has one (only enforced for sustained families). */
  eventEndSec: number | null;
  guard: SpeechGuard;
  /** The asset's speech band is carved (compiler: measured from the manifest). Before payment: undefined (the sound will be carved if accented). */
  speechBandCarved?: boolean;
  /** Measured transient offset inside the file (compiler); 0 before payment. An onset accent's TRANSIENT must not land after the onset. */
  transientOffsetSec?: number;
  /** Validation Sprint 2: the offset that reproduces the planned transient frame. Chosen when valid and of the same quality as the default choice. */
  preferredShiftFrames?: number;
  /** Validation Sprint 2: the anchor event's first visible instant (an onset accent never starts before it). Absent = no extra accent lead. */
  eventStartSec?: number | null;
};

export type PlacementDropReason =
  | 'speech_timing_missing'
  | 'sfx_too_long'
  | 'speech_overlap_no_safe_placement'
  | 'speech_timing_unreliable'
  | 'tail_crosses_video_end'
  | 'tail_crosses_event_end'
  | 'onset_protection'
  | 'tail_crosses_next_onset'
  | 'too_long_for_under_speech'
  | 'not_subtle_for_under_speech'
  | 'no_pause_or_preonset_gap'
  | 'no_safe_placement';

export type PlacementResult =
  | {ok: true; startFrame: number; shiftFrames: number; overlapsSpeech: boolean; tier?: PlacementTier}
  | {ok: false; reason: PlacementDropReason; detail: string};

const EPS = 1e-9;

/** Why a short transient may NOT play under speech at all (null = it may, subject to the per-position checks). */
function underSpeechIneligibility(input: PlacementInput): 'too_long_for_under_speech' | 'not_subtle_for_under_speech' | 'speech_overlap_no_safe_placement' | null {
  if (input.policy !== 'speech_hybrid') return 'speech_overlap_no_safe_placement';
  if (!(HYBRID_UNDER_SPEECH.families as readonly string[]).includes(input.family)) return 'speech_overlap_no_safe_placement';
  if (input.durationSec > HYBRID_UNDER_SPEECH.maxDurationSec + EPS) return 'too_long_for_under_speech';
  if (input.level !== HYBRID_UNDER_SPEECH.level) return 'not_subtle_for_under_speech';
  return null;
}

export function placeSfxSafely(input: PlacementInput): PlacementResult {
  if (input.policy === 'speech_pause_preonset') return placePausePreonset(input);
  const window = SFX_FAMILY_TIMING[input.family];
  if (input.guard.status === 'missing') return {ok: false, reason: 'speech_timing_missing', detail: 'no usable word timing: an SFX cannot be proven safe for speech'};
  if (input.durationSec > window.maxDurationSec + EPS) return {ok: false, reason: 'sfx_too_long', detail: `${input.durationSec}s > ${window.maxDurationSec}s for ${input.family}`};
  const guard = input.guard;
  const later = Math.floor(window.laterSec * input.fps + 1e-6);
  const earlier = Math.floor(window.earlierSec * input.fps + 1e-6);
  const offsets = [0];
  for (let k = 1; k <= Math.max(later, earlier); k += 1) {
    if (k <= later) offsets.push(k);
    if (k <= earlier) offsets.push(-k);
  }
  const compositionEnd = input.compositionFrames / input.fps;
  const ineligible = underSpeechIneligibility(input);
  const reasons: string[] = [];
  const valid: Array<{offset: number; overlapsSpeech: boolean}> = [];
  for (const offset of offsets) {
    const startFrame = input.baseStartFrame + offset;
    if (startFrame < 0 || startFrame >= input.compositionFrames) {
      reasons.push('outside_composition');
      continue;
    }
    const startSec = startFrame / input.fps;
    const endSec = startSec + input.durationSec;
    if (endSec > compositionEnd + EPS) {
      reasons.push('tail_crosses_video_end');
      continue;
    }
    if (window.sustained && input.eventEndSec !== null && endSec > input.eventEndSec + EPS) {
      reasons.push('tail_crosses_event_end');
      continue;
    }
    const touching = guard.blocked.filter(span => startSec < span.toSec - EPS && endSec > span.fromSec + EPS);
    if (touching.length === 0) {
      valid.push({offset, overlapsSpeech: false});
      continue;
    }
    if (touching.some(span => !span.reliable)) {
      reasons.push('speech_timing_unreliable');
      continue;
    }
    if (ineligible) {
      reasons.push(ineligible);
      continue;
    }
    // Under speech (speech_hybrid, short subtle transient): protect onsets, never cross the next one.
    const onsetGuard = guard.blocked.find(span => startSec > span.onsetSec + EPS && startSec <= span.onsetSec + HYBRID_UNDER_SPEECH.onsetProtectionSec + EPS);
    if (onsetGuard) {
      reasons.push('onset_protection');
      continue;
    }
    const nextOnset = guard.blocked.map(span => span.onsetSec).filter(onset => onset >= startSec - EPS).sort((a, b) => a - b)[0];
    if (nextOnset !== undefined && endSec > nextOnset - guard.marginSec + EPS) {
      reasons.push('tail_crosses_next_onset');
      continue;
    }
    valid.push({offset, overlapsSpeech: true});
  }
  // A speech-clear position always wins over an under-speech one; then the order above (nearest, later first).
  const fallback = valid.find(item => !item.overlapsSpeech) ?? valid[0];
  const preferred = input.preferredShiftFrames === undefined ? undefined : valid.find(item => item.offset === input.preferredShiftFrames && item.overlapsSpeech === fallback?.overlapsSpeech);
  const best = preferred ?? fallback;
  if (best) return {ok: true, startFrame: input.baseStartFrame + best.offset, shiftFrames: best.offset, overlapsSpeech: best.overlapsSpeech};

  const tried = `${offsets.length} frame position(s) from ${-earlier} to +${later}`;
  const unique = [...new Set(reasons)];
  if (unique.includes('speech_timing_unreliable')) return {ok: false, reason: 'speech_timing_unreliable', detail: `${tried}; a placement depends on unreliable word timing`};
  if (unique.length === 1) {
    const only = unique[0] as PlacementDropReason;
    const detail: Record<string, string> = {
      speech_overlap_no_safe_placement: 'every one overlaps speech (margin applied)',
      tail_crosses_video_end: 'the tail always passes the composition end',
      tail_crosses_event_end: "the tail always passes the event's visible end",
      onset_protection: `every under-speech position starts within ${HYBRID_UNDER_SPEECH.onsetProtectionSec * 1000} ms after a word onset`,
      tail_crosses_next_onset: 'every under-speech position runs into the next word onset (margin applied)',
      too_long_for_under_speech: `${input.durationSec}s is longer than the ${HYBRID_UNDER_SPEECH.maxDurationSec}s allowed under speech`,
      not_subtle_for_under_speech: `level ${input.level}: only ${HYBRID_UNDER_SPEECH.level} may play under speech`,
    };
    if (only in detail) return {ok: false, reason: only, detail: `${tried}; ${detail[only]}`};
  }
  // speech_hybrid with mixed reasons: report the under-speech rule that blocked the positions inside speech (speech_safe keeps its SFX-2 behaviour).
  if (input.policy === 'speech_hybrid') {
    const boundary = new Set(['outside_composition', 'tail_crosses_video_end', 'tail_crosses_event_end']);
    const underSpeech = new Set(['onset_protection', 'tail_crosses_next_onset']);
    for (const reason of ['onset_protection', 'tail_crosses_next_onset', 'too_long_for_under_speech', 'not_subtle_for_under_speech', 'speech_overlap_no_safe_placement'] as const) {
      if (unique.includes(reason) && unique.every(item => boundary.has(item) || item === reason || (underSpeech.has(reason) && underSpeech.has(item)))) {
        return {ok: false, reason, detail: `${tried}; blocked by ${unique.join(', ')}`};
      }
    }
  }
  return {ok: false, reason: 'no_safe_placement', detail: `${tried}; blocked by ${unique.join(', ')}`};
}

/** Family of a cue's sound when the plan does not state one (conservative: one-shot families never move earlier). */
export function defaultSfxFamily(sound: {kind: 'builtin'; name: string} | {kind: 'catalog'; cue: string} | {kind: 'asset'; assetId: string}): SfxFamily {
  if (sound.kind === 'builtin') return sound.name === 'whoosh' ? 'whoosh' : sound.name === 'pop' ? 'pop' : 'impact';
  if (sound.kind === 'catalog') {
    if (['cut', 'transition', 'zoom_in', 'zoom_out'].includes(sound.cue)) return 'whoosh';
    if (['caption_pop', 'kinetic_plate', 'ui'].includes(sound.cue)) return 'pop';
    if (sound.cue === 'ambience') return 'texture';
    return 'impact';
  }
  return 'impact';
}

/** `speech_pause_preonset` (see PAUSE_PREONSET). Pure, deterministic; never places a sound under speech. */
function placePausePreonset(input: PlacementInput): PlacementResult {
  const window = SFX_FAMILY_TIMING[input.family];
  if (input.guard.status === 'missing') return {ok: false, reason: 'speech_timing_missing', detail: 'no usable word timing: an SFX cannot be proven safe for speech'};
  if (input.durationSec > window.maxDurationSec + EPS) return {ok: false, reason: 'sfx_too_long', detail: `${input.durationSec}s > ${window.maxDurationSec}s for ${input.family}`};
  const guard = input.guard;
  const fps = input.fps;
  const later = Math.floor(window.laterSec * fps + 1e-6);
  const earlier = Math.floor(window.earlierSec * fps + 1e-6);
  const preOnsetCapable = (PAUSE_PREONSET.preOnsetFamilies as readonly string[]).includes(input.family) && input.durationSec <= PAUSE_PREONSET.preOnsetMaxDurationSec + EPS;
  const accentCapable = (PAUSE_PREONSET.preOnsetFamilies as readonly string[]).includes(input.family) && input.durationSec <= PAUSE_PREONSET.accent.maxDurationSec + EPS && input.speechBandCarved !== false;
  const accentLeadFrames = guard.onsetAccents && input.eventStartSec !== undefined && input.eventStartSec !== null ? Math.floor(PAUSE_PREONSET.accentMaxLeadSec * fps + 1e-6) : 0;
  const extraEarlier = preOnsetCapable ? Math.max(earlier, Math.floor(PAUSE_PREONSET.preOnsetEarlierSec * fps + 1e-6), accentLeadFrames) : earlier;
  const offsets = [0];
  for (let k = 1; k <= Math.max(later, extraEarlier); k += 1) {
    if (k <= later) offsets.push(k);
    if (k <= extraEarlier) offsets.push(-k);
  }
  const compositionEnd = input.compositionFrames / fps;
  const silences = guard.silences ?? null;
  const rank: Record<PlacementTier, number> = {speech_clear: 0, acoustic_pause: 1, pre_onset: 2, onset_accent: 3};
  const reasons = new Set<string>();
  let best: {offset: number; tier: PlacementTier} | null = null;
  for (const offset of offsets) {
    const startFrame = input.baseStartFrame + offset;
    if (startFrame < 0 || startFrame >= input.compositionFrames) {
      reasons.add('outside_composition');
      continue;
    }
    const startSec = startFrame / fps;
    const endSec = startSec + input.durationSec;
    if (endSec > compositionEnd + EPS) {
      reasons.add('tail_crosses_video_end');
      continue;
    }
    if (window.sustained && input.eventEndSec !== null && endSec > input.eventEndSec + EPS) {
      reasons.add('tail_crosses_event_end');
      continue;
    }
    const inFamilyWindow = offset >= -earlier && offset <= later;
    let tier: PlacementTier | null = null;
    const touching = guard.blocked.filter(span => startSec < span.toSec - EPS && endSec > span.fromSec + EPS);
    if (touching.length === 0 && inFamilyWindow) tier = 'speech_clear';
    else if (silences) {
      const onsetMasked = guard.blocked.some(span => {
        const onset = span.protectedOnsetSec ?? span.onsetSec;
        return startSec > onset + EPS && startSec <= onset + SFX_WORD_MASK_SEC + EPS;
      });
      const silence = containingSilence(silences, startSec - PAUSE_PREONSET.releaseGuardSec, endSec + PAUSE_PREONSET.preOnsetGuardSec);
      const crossesAsrOnset = guard.strictAsrOnsets === true && guard.blocked.some(span => span.onsetSec >= startSec - EPS && span.onsetSec <= endSec + PAUSE_PREONSET.preOnsetGuardSec + EPS);
      if (onsetMasked) reasons.add('onset_protection');
      else if (!silence) reasons.add('no_measured_silence');
      else if (crossesAsrOnset) reasons.add('asr_onset_strict');
      else if (silence[1] - silence[0] >= PAUSE_PREONSET.genuinePauseSec - EPS && inFamilyWindow) tier = 'acoustic_pause';
      else if (preOnsetCapable) tier = 'pre_onset';
      else reasons.add('silence_too_short_for_family');
    } else reasons.add(touching.length > 0 ? 'speech_overlap_voice_activity_unmeasured' : 'outside_family_window');
    const beyondPreOnsetLead = -offset > Math.max(earlier, Math.floor(PAUSE_PREONSET.preOnsetEarlierSec * fps + 1e-6));
    if (tier === 'pre_onset' && beyondPreOnsetLead) tier = null; // the extra lead is for onset accents only
    const beforeVisible = input.eventStartSec !== undefined && input.eventStartSec !== null && startSec < input.eventStartSec - EPS;
    if (!tier && guard.onsetAccents && accentCapable && !(beyondPreOnsetLead && beforeVisible)) {
      const onsets = guard.blocked.map(span => span.protectedOnsetSec ?? span.onsetSec).sort((a, b) => a - b);
      const hitSec = startSec + (input.transientOffsetSec ?? 0);
      const accented = onsets.find(onset => hitSec <= onset + EPS && hitSec >= onset - PAUSE_PREONSET.accent.leadSec - EPS);
      const masked = onsets.some(onset => hitSec > onset + EPS && hitSec <= onset + SFX_WORD_MASK_SEC + EPS);
      const next = accented === undefined ? undefined : onsets.find(onset => onset > accented + EPS);
      if (accented === undefined) reasons.add('accent_not_at_an_onset');
      else if (masked) reasons.add('onset_protection');
      else if (next !== undefined && endSec > next - PAUSE_PREONSET.accent.tailGuardSec + EPS) reasons.add('accent_tail_crosses_next_onset');
      else tier = 'onset_accent';
    }
    if (tier && (!best || rank[tier] < rank[best.tier] || (rank[tier] === rank[best.tier] && offset === input.preferredShiftFrames))) best = {offset, tier};
  }
  if (best) return {ok: true, startFrame: input.baseStartFrame + best.offset, shiftFrames: best.offset, overlapsSpeech: best.tier === 'onset_accent', tier: best.tier};
  const tried = `${offsets.length} frame position(s) from ${-extraEarlier} to +${later}`;
  const unique = [...reasons];
  if (unique.length > 0 && unique.every(reason => reason === 'tail_crosses_video_end' || reason === 'outside_composition')) return {ok: false, reason: 'tail_crosses_video_end', detail: `${tried}; the tail always passes the composition end`};
  if (unique.length > 0 && unique.every(reason => reason === 'onset_protection')) return {ok: false, reason: 'onset_protection', detail: `${tried}; every measured-silence position starts within ${SFX_WORD_MASK_SEC * 1000} ms after an ASR onset`};
  return {ok: false, reason: 'no_pause_or_preonset_gap', detail: `${tried}; no speech-clear, pause or pre-onset position (${unique.join(', ')})`};
}
