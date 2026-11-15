/**
 * The deterministic AudioPlan compiler: (AudioPlan, EditEventSheet, assets, voice loudness) -> AudioTimeline. Pure: no I/O, no clock, no randomness.
 *
 * Reuses, instead of re-implementing:
 *   stages/music/placement.ts      placeMusic: downbeat start, lift alignment, energy fit, loop hand-off, button vs hold-and-fade ending
 *   stages/music/intensity.ts      buildIntensityCurve: the per-second edit intensity placement correlates with
 *   stages/music/duckEnvelope.ts   buildDuckEnvelope (`talking`, voice-relative -18 / -9 / -4 LU), VO_LUFS_ASSUMED
 *   stages/music/bedLoudness.ts    buildBedLoudnessTrack: loudness-aware ducking for beds with a loudness map
 *   lib/sfxCatalog.ts              pickEntry (deterministic catalogue choice), catalogVolume (voice-relative SFX level and ceiling)
 *   lib/polishSfx.ts               SFX_WORD_MASK_SEC, SFX_MIN_SPACING_SEC, SFX_MAX_HITS (the voice-first SFX rules)
 *   eventSheet/hash.ts             canonicalJson (plan hash)
 *
 * Two kinds of failure:
 *   plan-level (schema, stale timing identity, sheet version, duplicate cue ids)  -> always rejected
 *   element-level (an anchor, asset or rule that one element cannot satisfy)     -> per plan.policy.onInvalidElement: reject the plan or drop the element
 * Budget enforcement (SFX spacing and cap) drops the lowest-priority cues and is never a rejection.
 */

import {createHash} from 'node:crypto';

import {catalogVolume, pickEntry, SFX_DEFAULT_VOICE_OFFSET_LU, type SfxEntry} from '../../../lib/sfxCatalog.ts';
import {SFX_MAX_HITS, SFX_MIN_SPACING_SEC, SFX_WORD_MASK_SEC} from '../../../lib/polishSfx.ts';
import {buildSpeechGuard, defaultSfxFamily, placeSfxSafely, type SpeechGuard} from './sfxSafety.ts';
import {scheduleBudget, scheduleLayering} from './sfxSchedule.ts';
import {buildBedLoudnessTrack} from '../../music/bedLoudness.ts';
import {bedMuteReason, classifyTranscript, classifyVoiceLoudness, decideBedLevel, voiceReferenceLufs, type TranscriptState, type VoiceLoudnessState} from '../../music/bgmFailSafe.ts';
import {buildIntensityCurve} from '../../music/intensity.ts';
import {HOLD_FADE_SEC, placeMusic} from '../../music/placement.ts';
import {canonicalJson} from '../eventSheet/hash.ts';
import type {EditEventSheet, SheetEvent} from '../eventSheet/types.ts';
import {BUILTIN_SFX, type AudioAssetCatalog, type MusicAsset} from './assets.ts';
import {audioPlanSchema, type Anchor, type AudioPlan, type MusicIntent, type SfxCue} from './planSchema.ts';
import {AUDIO_TIMELINE_VERSION, type AudioTimeline, type DroppedElement, type GainKeyframe, type TimelineMusic, type TimelineSection, type TimelineSfx} from './timeline.ts';

/** Section level -> gain in dB (applied on top of the duck; never above 0). */
export const SECTION_GAIN_DB = Object.freeze({full: 0, reduced: -4, quiet: -8, out: Number.NEGATIVE_INFINITY});
/** Level changes between sections ramp over this window, centred on the boundary (shorter for short sections, see sectionRampHalf). */
export const SECTION_RAMP_SEC = 0.25;
/** A section boundary closer than this to the music window's start or end IS that edge: no ramp (the bed is not playing outside the window). */
export const SECTION_EDGE_EPS_SEC = 0.0005;
/** Shortest segment (a section, or a full-level gap between section boundaries) that can execute its level: two frames, so its plateau (at least half its length) contains a rendered frame. */
export const minSectionSegmentSec = (fps: number) => 2 / fps;
export const FADE_IN_SEC = Object.freeze({none: 0, short: 0.25, long: 1});
/** SFX level words -> LU under the voice. `normal` is the existing catalogue default (lib/sfxCatalog.ts); catalogVolume caps everything at -6 LU. */
export const SFX_LEVEL_LU = Object.freeze({subtle: -16, normal: SFX_DEFAULT_VOICE_OFFSET_LU, featured: -7});

export type CompileContext = {
  sheet: EditEventSheet;
  assets: AudioAssetCatalog;
  /**
   * Speech-gated voice loudness (LUFS), e.g. AudioDesign.voLufs / measureVoLufs. Phase SFX-3D: absent or invalid is NEVER replaced by an assumed level:
   * the bed is muted and SFX are dropped (music/bgmFailSafe.ts), unless the voice track is established as absent (`voiceTrack: 'absent'`).
   */
  voLufs?: number;
  /** Phase SFX-3D: whether the source has a voice track. Default: 'absent' when the sheet's probe says the source has no audio, else 'unknown'. */
  voiceTrack?: 'present' | 'absent' | 'unknown';
  /**
   * Phase SFX-3D: what the transcription step reported. Only 'succeeded' lets an EMPTY word list mean "no speech"; with 'unknown' (default) or
   * 'failed', an empty list is an unavailable transcript and the bed is held at the speech level for the whole video.
   */
  speechAnalysis?: 'succeeded' | 'failed' | 'unknown';
  /** The human SFX catalogue (lib/sfxCatalog.ts loadSfxCatalog().entries). Absent = empty: catalogue cues are unavailable. */
  sfxCatalog?: readonly SfxEntry[];
  /** Seeds deterministic catalogue choices (pickEntry). */
  videoId: string;
};

export type CompileError = {level: 'plan' | 'element'; code: string; ref: string; detail: string};

export type CompileResult =
  | {ok: true; plan: AudioPlan; timeline: AudioTimeline}
  | {ok: false; errors: CompileError[]; fallback: 'rules_pipeline' | 'voice_only'; planHash: string | null};

const round3 = (value: number) => Math.round(value * 1000) / 1000 + 0;
const dbToGain = (db: number) => (db === Number.NEGATIVE_INFINITY ? 0 : 10 ** (db / 20));

export const planHash = (plan: AudioPlan): string => `plan-v1:${createHash('sha256').update(canonicalJson(plan), 'utf8').digest('hex')}`;

export type Resolved = {ok: true; timeSec: number; ref: string; at: string; source: string; conditional: boolean} | {ok: false; code: string; detail: string};

function anchorRef(anchor: Anchor): string {
  if (anchor.kind === 'event') return `event:${anchor.eventId}@${anchor.at}`;
  if (anchor.kind === 'word') return `word:${anchor.wordId}@${anchor.at}`;
  return anchor.kind;
}

/** Anchor -> output seconds. Impact is used only when the sheet established it; start never stands in for it. */
export function resolveAnchor(sheet: EditEventSheet, events: ReadonlyMap<string, SheetEvent>, anchor: Anchor): Resolved {
  const compositionEnd = sheet.durationFrames / sheet.fps;
  if (anchor.kind === 'start') return {ok: true, timeSec: 0, ref: 'start', at: 'start', source: 'composition_start', conditional: false};
  if (anchor.kind === 'end') return {ok: true, timeSec: compositionEnd, ref: 'end', at: 'end', source: 'composition_end', conditional: false};
  if (anchor.kind === 'word') {
    const word = sheet.speech.words.find(item => item.id === anchor.wordId);
    if (!word) return {ok: false, code: 'unknown_word', detail: `${anchor.wordId} is not a speech word of this sheet`};
    const time = anchor.at === 'start' ? word.time.startSec : word.time.endSec;
    if (time === null) return {ok: false, code: 'anchor_has_no_time', detail: `${anchor.wordId} has no ${anchor.at}`};
    return {ok: true, timeSec: time, ref: anchor.wordId, at: anchor.at, source: `word_${anchor.at}`, conditional: false};
  }
  const event = events.get(anchor.eventId);
  if (!event) return {ok: false, code: 'unknown_event', detail: `${anchor.eventId} is not an event of this sheet (unknown, excluded or not rendered)`};
  let time: number | null;
  let source: string;
  if (anchor.at === 'impact') {
    if (!event.impact) return {ok: false, code: 'impact_unavailable', detail: `${anchor.eventId}: ${event.impactUnavailable ?? 'no impact'}`};
    time = event.impact.time.sec;
    source = event.impact.source;
  } else {
    time = anchor.at === 'start' ? event.time.startSec : event.time.endSec;
    source = `event_${anchor.at}`;
    if (time === null) return {ok: false, code: 'anchor_has_no_time', detail: `${anchor.eventId} is an instant and has no end`};
  }
  if (event.visibility.hiddenDuring.some(window => time >= window.startSec && window.endSec !== null && time < window.endSec)) {
    return {ok: false, code: 'anchor_hidden', detail: `${anchor.eventId} is hidden at ${time}s`};
  }
  return {ok: true, timeSec: time, ref: anchor.eventId, at: anchor.at, source, conditional: event.visibility.status === 'conditional'};
}

type ElementSink = {errors: CompileError[]; dropped: DroppedElement[]; warnings: string[]};

function elementError(sink: ElementSink, ref: string, code: string, detail: string) {
  sink.errors.push({level: 'element', code, ref, detail});
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Music
// ---------------------------------------------------------------------------------------------------------------------------------

function compileMusic(intent: MusicIntent, ctx: CompileContext, events: ReadonlyMap<string, SheetEvent>, bed: {transcript: TranscriptState; voice: VoiceLoudnessState}, sink: ElementSink): TimelineMusic | null {
  const {sheet} = ctx;
  const ref = `music:${intent.assetId}`;
  const before = sink.errors.length;
  const asset: MusicAsset | undefined = ctx.assets.music.get(intent.assetId);
  if (!asset) elementError(sink, ref, 'asset_unavailable', `no music asset ${intent.assetId}`);
  else if (asset.rights.cleared !== true) elementError(sink, ref, 'rights_not_cleared', `${intent.assetId}: ${asset.rights.licence}`);
  const start = resolveAnchor(sheet, events, intent.start);
  const end = resolveAnchor(sheet, events, intent.end);
  for (const [label, resolved] of [['start', start], ['end', end]] as const) {
    if (!resolved.ok) elementError(sink, `${ref}.${label}`, resolved.code, resolved.detail);
    else if (resolved.conditional) sink.warnings.push(`music_${label}_anchor_conditional_visibility:${resolved.ref}`);
  }
  const lift = intent.align.kind === 'lift_at' ? resolveAnchor(sheet, events, intent.align.anchor) : null;
  if (lift && !lift.ok) elementError(sink, `${ref}.align`, lift.code, lift.detail);
  if (sink.errors.length > before || !asset || !start.ok || !end.ok || (lift && !lift.ok)) return null;

  const fps = sheet.fps;
  const startFrame = Math.round(start.timeSec * fps);
  const startSec = startFrame / fps;
  const endAnchor = Math.min(end.timeSec, sheet.durationFrames / fps);
  if (endAnchor - startSec < 1 / fps) {
    elementError(sink, ref, 'music_window_empty', `music would play from ${startSec}s to ${endAnchor}s`);
    return null;
  }

  // Existing placement, in the music window's own clock (placeMusic treats its window start as video 0).
  const windowSec = endAnchor - startSec;
  const intensityFull = buildIntensityCurve({
    durationSec: sheet.durationSec,
    words: sheet.speech.words.map(word => ({start: word.time.startSec, end: word.time.endSec ?? word.time.startSec})),
    cutTimesSec: sheet.events.filter(event => event.type === 'cut' || event.type === 'transition').map(event => event.anchor?.sec ?? event.time.startSec),
    zoomTimesSec: sheet.events.filter(event => event.type === 'zoom' || event.type === 'impact_punch_in').map(event => event.time.startSec),
    plateTimesSec: sheet.events.filter(event => ['generated_graphic', 'motion_graphic', 'kinetic_event', 'stage_span'].includes(event.type)).map(event => event.time.startSec),
    popTimesSec: sheet.events.filter(event => event.type === 'semantic_emphasis').map(event => event.time.startSec),
  });
  const placement = placeMusic({
    bed: asset.placement,
    durationSec: windowSec,
    hookAtSec: lift && lift.ok ? lift.timeSec - startSec : -1e6,
    intensity: intensityFull.slice(Math.floor(startSec)),
    ...(asset.bpm !== undefined ? {bpm: asset.bpm} : {}),
  });
  if (placement.reason === 'no_valid_start') sink.warnings.push(`music_bed_shorter_than_window:${asset.id}`);
  if (placement.reason === 'no_meta') sink.warnings.push(`music_bed_has_no_placement_meta:${asset.id}`);
  const forcedFade = intent.ending === 'fade' && placement.reason !== 'no_valid_start';
  const endRel = forcedFade ? windowSec : placement.endSec;
  const endType = forcedFade ? 'hold-fade' : placement.endType;
  const endFadeSec = forcedFade ? HOLD_FADE_SEC : placement.endFadeSec;
  const endSec = round3(startSec + endRel);
  const loopFromSec = placement.loopFromSec === null ? null : round3(startSec + placement.loopFromSec);
  if (loopFromSec !== null && !asset.loopUrl) {
    elementError(sink, ref, 'loop_file_missing', `${asset.id} needs its loop body after ${loopFromSec}s but has no loopUrl`);
    return null;
  }

  // Sections.
  const sections: TimelineSection[] = [];
  intent.sections.forEach((section, index) => {
    const from = resolveAnchor(sheet, events, section.from);
    const to = resolveAnchor(sheet, events, section.to);
    const sref = `${ref}.sections[${index}]`;
    if (!from.ok) return elementError(sink, sref, from.code, from.detail);
    if (!to.ok) return elementError(sink, sref, to.code, to.detail);
    const fromSec = Math.max(startSec, from.timeSec);
    const toSec = Math.min(endSec, to.timeSec);
    if (toSec <= fromSec) return elementError(sink, sref, 'section_empty_or_reversed', `${anchorRef(section.from)} -> ${anchorRef(section.to)} gives ${fromSec}..${toSec}s inside the music window`);
    sections.push({fromSec: round3(fromSec), toSec: round3(toSec), energy: section.energy, level: section.level, gain: dbToGain(SECTION_GAIN_DB[section.level])});
  });
  sections.sort((a, b) => a.fromSec - b.fromSec);
  for (let i = 1; i < sections.length; i += 1) {
    if (sections[i]!.fromSec < sections[i - 1]!.toSec - 1e-9) elementError(sink, `${ref}.sections`, 'overlapping_sections', `${sections[i - 1]!.fromSec}..${sections[i - 1]!.toSec} overlaps ${sections[i]!.fromSec}..${sections[i]!.toSec}`);
  }
  if (sink.errors.length > before) return null;
  // Phase 1.4B: every segment next to a level change must be long enough to be heard at its level (never silently swallowed).
  for (const segment of sectionSegments(startSec, endSec, sections)) {
    if (!segment.rampedSide || segment.toSec - segment.fromSec >= minSectionSegmentSec(fps) - 1e-9) continue;
    const length = Math.round((segment.toSec - segment.fromSec) * 1000);
    if (segment.section) elementError(sink, `${ref}.sections`, 'section_too_short', `section ${segment.section.fromSec}..${segment.section.toSec}s is ${length} ms inside the music window; at least ${Math.round(minSectionSegmentSec(fps) * 1000)} ms (two frames) is needed to hear its level`);
    else elementError(sink, `${ref}.sections`, 'section_gap_too_short', `the full-level gap ${round3(segment.fromSec)}..${round3(segment.toSec)}s between section boundaries is ${length} ms; at least ${Math.round(minSectionSegmentSec(fps) * 1000)} ms (two frames) is needed`);
  }
  if (sink.errors.length > before) return null;

  const fadeInSec = round3(Math.min(FADE_IN_SEC[intent.fadeIn], (endSec - startSec) / 2));
  const automation = buildAutomation(startSec, endSec, fadeInSec, sections);

  // Phase SFX-3D: the level comes from the explicit transcript and voice states. For a valid transcript and a measured voice this is exactly the
  // previous buildDuckEnvelope call; a failure only ever makes the bed quieter (held at the speech level) or mutes it (decided before compileMusic).
  const decision = decideBedLevel({
    transcript: bed.transcript,
    voice: bed.voice,
    words: sheet.speech.words.map(word => ({start: word.time.startSec, end: word.time.endSec ?? word.time.startSec})),
    durationSec: sheet.durationFrames / fps,
    preset: 'talking',
    ...(asset.integratedLufs !== undefined ? {bedLufs: asset.integratedLufs} : {}),
  });
  if (decision.action === 'mute') {
    // A safety decision (SFX-3D/3G): dropped with its reason, never an element error (it must not reject the plan).
    sink.dropped.push({ref, reason: `bgm_muted_fail_safe:${decision.reason}`, detail: decision.reason === 'bed_loudness_unknown' ? `bed loudness ${decision.bed?.status ?? 'unknown'}: the bed is withheld (never levelled on an assumed loudness)` : 'the bed cannot be levelled safely'});
    sink.warnings.push(`bgm_muted_fail_safe:${decision.reason}`);
    return null;
  }
  if (decision.basis !== 'speech_and_measured_voice') sink.warnings.push(`bgm_level_basis:${decision.basis}`);
  let duck = decision.envelope;
  // Loudness-aware ducking (existing Phase 3.1 rule): its track is in video time from frame 0, so it applies when the bed enters at frame 0.
  if (startFrame === 0) {
    const track = buildBedLoudnessTrack({bed: asset.placement, startOffsetSec: placement.startOffsetSec, loopFromSec, durationSec: sheet.durationFrames / fps, duck, carved: Boolean(asset.carvedUrl)});
    if (track) duck = {...duck, bedLoudness: track};
  } else if (asset.placement?.loudnessMap?.length) sink.warnings.push('music_loudness_correction_skipped:late_entry');

  return {
    assetId: asset.id,
    source: asset.source,
    url: asset.url,
    fullUrl: asset.fullUrl ?? asset.url,
    loopUrl: asset.loopUrl ?? null,
    carvedUrl: asset.carvedUrl ?? null,
    fullDurationSec: asset.fullDurationSec,
    bpm: asset.bpm ?? null,
    startSec: round3(startSec),
    startFrame,
    endSec,
    endFadeSec,
    endType,
    sourceOffsetSec: placement.startOffsetSec,
    loopFromSec,
    fadeInSec,
    sections,
    automation,
    duck,
    bedLufs: asset.integratedLufs ?? null,
    placement: {
      reason: placement.reason,
      score: placement.score,
      startsOnDownbeat: placement.startsOnDownbeat,
      liftAtVideoSec: placement.liftAtVideoSec === null ? null : round3(startSec + placement.liftAtVideoSec),
      liftErrBeats: placement.liftErrBeats,
    },
  };
}

type Segment = {fromSec: number; toSec: number; section: TimelineSection | null; rampedSide: boolean};

/** Sections snapped to the window edges they touch (within SECTION_EDGE_EPS_SEC), so an edge is never mistaken for a level change. */
function snapToWindow(startSec: number, endSec: number, sections: readonly TimelineSection[]): TimelineSection[] {
  return sections.map(section => ({
    ...section,
    fromSec: Math.abs(section.fromSec - startSec) < SECTION_EDGE_EPS_SEC ? startSec : section.fromSec,
    toSec: Math.abs(section.toSec - endSec) < SECTION_EDGE_EPS_SEC ? endSec : section.toSec,
  }));
}

/** Interior boundaries: where the level can change inside the music window. Window edges are not boundaries (Phase 1.4B). */
function interiorBoundaries(startSec: number, endSec: number, snapped: readonly TimelineSection[]): number[] {
  return [...new Set(snapped.flatMap(section => [section.fromSec, section.toSec]))].filter(b => b > startSec && b < endSec).sort((a, b) => a - b);
}

/** The music window cut at its interior boundaries: each piece is inside one section or a full-level gap. */
function sectionSegments(startSec: number, endSec: number, sections: readonly TimelineSection[]): Segment[] {
  const snapped = snapToWindow(startSec, endSec, sections);
  const cuts = [startSec, ...interiorBoundaries(startSec, endSec, snapped), endSec];
  const out: Segment[] = [];
  for (let i = 0; i + 1 < cuts.length; i += 1) {
    const fromSec = cuts[i]!;
    const toSec = cuts[i + 1]!;
    const mid = (fromSec + toSec) / 2;
    out.push({fromSec, toSec, section: snapped.find(section => mid >= section.fromSec && mid < section.toSec) ?? null, rampedSide: i > 0 || i + 2 < cuts.length});
  }
  return out;
}

/**
 * Fade-in and section levels as linear keyframes.
 *  - A level change ramps across its boundary over SECTION_RAMP_SEC, centred on it, shortened when a neighbouring segment is short: each side of a
 *    boundary takes at most a quarter of the segment it enters, so every segment holds its level for at least half its length (Phase 1.4B). Segments
 *    of 0.5 s or more keep the full 0.25 s ramp, as before.
 *  - The music window's own start and end are not level changes: a section touching them holds its level there (Phase 1.4B).
 * Keyframes are the product of the fade-in ramp and the section curve, evaluated at every breakpoint (exact at breakpoints, linear between). The end
 * keyframe takes the value just before the end (the bed is silent from endSec).
 */
function buildAutomation(startSec: number, endSec: number, fadeInSec: number, sections: readonly TimelineSection[]): GainKeyframe[] {
  const snapped = snapToWindow(startSec, endSec, sections);
  const levelAt = (t: number) => snapped.find(section => t >= section.fromSec && t < section.toSec)?.gain ?? 1;
  const boundaries = interiorBoundaries(startSec, endSec, snapped);
  const cuts = [startSec, ...boundaries, endSec];
  const half = new Map(boundaries.map((b, index) => [b, Math.min(SECTION_RAMP_SEC / 2, (b - cuts[index]!) / 4, (cuts[index + 2]! - b) / 4)]));
  const sectionCurve = (t: number): number => {
    for (const b of boundaries) {
      const h = half.get(b)!;
      if (t > b - h && t < b + h) {
        const before = levelAt(b - h - 1e-9);
        const after = levelAt(b + h);
        return before + ((after - before) * (t - (b - h))) / (2 * h);
      }
    }
    return levelAt(t);
  };
  const fade = (t: number) => (fadeInSec > 0 ? Math.min(1, Math.max(0, (t - startSec) / fadeInSec)) : 1);
  const points = new Set<number>([startSec, endSec]);
  if (fadeInSec > 0) points.add(startSec + fadeInSec);
  for (const b of boundaries) for (const t of [b - half.get(b)!, b + half.get(b)!]) if (t > startSec && t < endSec) points.add(t);
  const keyframes = [...points]
    .sort((a, b) => a - b)
    .map(t => {
      const at = t >= endSec ? endSec - 1e-9 : t;
      return {timeSec: round3(t), gain: Math.round(fade(at) * sectionCurve(at) * 1e6) / 1e6};
    })
    // Phase 1.4 fix: two breakpoints less than 0.5 ms apart round to the same millisecond; keep the first so keyframe times are strictly increasing
    // (the renderer's contract, remotion/src/audio/musicTimeline.ts). The curve is continuous, so the dropped point differs by under 0.5 ms of slope.
    .filter((keyframe, index, all) => index === 0 || keyframe.timeSec > all[index - 1]!.timeSec);
  return keyframes.every(keyframe => keyframe.gain === 1) ? [] : keyframes;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// SFX
// ---------------------------------------------------------------------------------------------------------------------------------

type SfxCandidate = {cue: SfxCue; sfx: TimelineSfx; transientSec: number};

/** Phase SFX-2: the plan's speech-safe timing, when it opted in. */
type StrictTiming = {guard: SpeechGuard; speechMarginSec: number; policy: 'speech_safe' | 'speech_hybrid' | 'speech_pause_preonset'};

function compileSfxCue(cue: SfxCue, ctx: CompileContext, events: ReadonlyMap<string, SheetEvent>, voLufs: number, sink: ElementSink, timing: StrictTiming | null = null): SfxCandidate | null {
  const {sheet} = ctx;
  const fps = sheet.fps;
  const ref = `sfx:${cue.id}`;
  const anchor = resolveAnchor(sheet, events, cue.anchor);
  if (!anchor.ok) return elementError(sink, ref, anchor.code, anchor.detail), null;
  if (anchor.conditional && !cue.allowConditionalVisibility) return elementError(sink, ref, 'anchor_conditional_visibility', `${anchor.ref} is only drawn under render-time conditions; set allowConditionalVisibility to accept`), null;

  let builtin: TimelineSfx['builtin'] = null;
  let src: string | null = null;
  let assetRef: string;
  let fileDurationSec: number;
  let transientOffsetSec: number;
  let transientSource: string;
  let volume: number;
  let peakDbfs: number;
  let clamped: boolean;
  let sourceChannels: 1 | 2 | undefined;
  // under-speech onset accents need a carved asset; built-ins and catalogue files are never carved
  let speechBandCarved = false;
  const offsetLu = SFX_LEVEL_LU[cue.level];
  if (cue.sound.kind === 'builtin') {
    const file = BUILTIN_SFX[cue.sound.name];
    builtin = file.name;
    sourceChannels = file.channels;
    assetRef = `builtin:${file.name}`;
    fileDurationSec = file.durationSec;
    transientOffsetSec = file.transientOffsetSec;
    transientSource = 'measured_50pct_of_peak';
    // catalogVolume gives the target peak (voice + offset, capped at the voice ceiling); the file's own peak is compensated here.
    const target = catalogVolume(voLufs, offsetLu, 0);
    clamped = target.clamped;
    const gain = 10 ** ((target.peakDbfs - file.peakDbfs) / 20);
    volume = Math.min(1, Math.round(gain * 10000) / 10000);
    peakDbfs = file.peakDbfs + 20 * Math.log10(Math.max(1e-9, volume));
  } else if (cue.sound.kind === 'asset') {
    // Phase 1.5: a registered SFX asset (e.g. generated for this event). Placed and levelled exactly like a built-in: measured onset, file peak compensated.
    const asset = ctx.assets.sfx?.get(cue.sound.assetId);
    if (!asset) return elementError(sink, ref, 'asset_unavailable', `no SFX asset ${cue.sound.assetId}`), null;
    if (asset.rights.cleared !== true) return elementError(sink, ref, 'rights_not_cleared', `${asset.id}: ${asset.rights.licence}`), null;
    assetRef = `asset:${asset.id}`;
    src = asset.src;
    sourceChannels = asset.channels;
    speechBandCarved = asset.speechBandCarved === true;
    fileDurationSec = asset.durationSec;
    transientOffsetSec = asset.transientOffsetSec;
    transientSource = 'measured_50pct_of_peak';
    const target = catalogVolume(voLufs, offsetLu, 0);
    clamped = target.clamped;
    // a speech-band-carved asset is levelled from its pre-carve peak (its loudest part was the carved band: never compensate the carve)
    const levelPeak = asset.speechBandCarved === true && asset.levelPeakDbfs !== undefined ? asset.levelPeakDbfs : asset.peakDbfs;
    const gain = 10 ** ((target.peakDbfs - levelPeak) / 20);
    volume = Math.min(1, Math.round(gain * 10000) / 10000);
    peakDbfs = asset.peakDbfs + 20 * Math.log10(Math.max(1e-9, volume));
  } else {
    const entry = pickEntry(ctx.sfxCatalog ?? [], cue.sound.cue, ctx.videoId, anchor.timeSec);
    if (!entry) return elementError(sink, ref, 'asset_unavailable', `no catalogue entry for cue ${cue.sound.cue}`), null;
    assetRef = `catalog:${entry.fileName}`;
    src = `sfx-library/${entry.fileName}`;
    fileDurationSec = entry.duration;
    // The catalogue validator requires <= 10 ms of leading silence and a peak in [-3, 0] dBFS (lib/sfxCatalog.ts); onset is taken as the file start.
    transientOffsetSec = 0;
    transientSource = 'catalog_leading_silence_max_10ms';
    const level = catalogVolume(voLufs, offsetLu, entry.gainDb);
    volume = level.volume;
    peakDbfs = level.peakDbfs;
    clamped = level.clamped;
  }

  const desiredStart = cue.align === 'transient' ? anchor.timeSec - transientOffsetSec : anchor.timeSec;
  if (desiredStart < -1 / fps) return elementError(sink, ref, 'cannot_align_before_composition_start', `${assetRef} would start at ${round3(desiredStart)}s`), null;
  // Frame quantisation never makes a sound EARLY on its anchor (product spec 5.6: sound slightly after the picture reads as natural, before it reads as
  // a mistake): a transient-aligned cue rounds its start frame up, so the transient lands 0..1 frame after the anchor. A start-aligned cue rounds like the renderer.
  const startFrame = cue.align === 'transient' ? Math.ceil(Math.max(0, desiredStart) * fps - 1e-6) : Math.round(Math.max(0, desiredStart) * fps);
  if (startFrame >= sheet.durationFrames) return elementError(sink, ref, 'starts_after_composition_end', `frame ${startFrame} >= ${sheet.durationFrames}`), null;
  // Phase SFX-2 (opt-in): speech-safe placement. A sound that cannot be placed is DROPPED with its reason (a deliberate decision, like the budget),
  // never an element error, so it can never reject the plan. Without `sfxTiming` this block does not run and the legacy behaviour is unchanged.
  let placedFrame = startFrame;
  let placement: TimelineSfx['placement'] | undefined;
  if (timing) {
    const family = cue.family ?? defaultSfxFamily(cue.sound);
    const event = cue.anchor.kind === 'event' ? events.get(cue.anchor.eventId) : undefined;
    const placed = placeSfxSafely({policy: timing.policy, baseStartFrame: startFrame, fps, compositionFrames: sheet.durationFrames, durationSec: fileDurationSec, family, level: cue.level, eventEndSec: event?.time.endSec ?? null, guard: timing.guard, speechBandCarved, transientOffsetSec, eventStartSec: event?.time.startSec ?? null, ...(cue.plannedTransientFrame !== undefined ? {preferredShiftFrames: cue.align === 'transient' ? Math.round(cue.plannedTransientFrame - startFrame - transientOffsetSec * fps) : cue.plannedTransientFrame - startFrame} : {})});
    if (!placed.ok) {
      sink.dropped.push({ref, reason: placed.reason, detail: `${assetRef} on ${anchor.ref} at ${round3(anchor.timeSec)}s: ${placed.detail}`});
      return null;
    }
    placedFrame = placed.startFrame;
    placement = {
      policy: timing.policy,
      family,
      level: cue.level,
      originalStartFrame: startFrame,
      shiftFrames: placed.shiftFrames,
      shiftSec: round3(placed.shiftFrames / fps),
      speechMarginSec: timing.speechMarginSec,
      audibleDurationSec: fileDurationSec,
      overlapsSpeech: placed.overlapsSpeech,
      ...(placed.tier ? {tier: placed.tier} : {}),
    };
  }
  const transientSec = placedFrame / fps + transientOffsetSec;
  // speech_pause_preonset (acoustic mode): the 120 ms mask uses the same protected onsets as the placement (an ASR onset inside a measured silence
  // is replaced by the measured voice onset, sfxSafety.ts buildSpeechGuard). Every other policy: the ASR onsets, exactly as before.
  const protectedOnsets = timing?.policy === 'speech_pause_preonset' && timing.guard.status === 'ok' ? new Map(timing.guard.blocked.map(span => [span.wordId, span.protectedOnsetSec ?? span.onsetSec])) : null;
  const onsetOf = (word: (typeof sheet.speech.words)[number]) => protectedOnsets?.get(word.id) ?? word.time.startSec;
  const onset = sheet.speech.words.find(word => transientSec > onsetOf(word) + 1e-6 && transientSec <= onsetOf(word) + SFX_WORD_MASK_SEC + 1e-6);
  if (onset) return elementError(sink, ref, 'word_mask', `transient at ${round3(transientSec)}s is within ${SFX_WORD_MASK_SEC * 1000} ms after ${onset.id} (${onsetOf(onset)}s)`), null;
  const room = (sheet.durationFrames - placedFrame) / fps;
  // Under speech_safe the placement already guarantees the whole sound fits (no truncation); legacy keeps its trim at the composition end.
  const durationSec = round3(timing ? fileDurationSec : Math.min(fileDurationSec, room));
  return {
    cue,
    transientSec,
    sfx: {
      id: cue.id,
      assetRef,
      builtin,
      src,
      startSec: round3(placedFrame / fps),
      startFrame: placedFrame,
      durationSec,
      volume,
      ...(sourceChannels !== undefined ? {sourceChannels} : {}),
      peakVsVoiceLu: Math.round((peakDbfs - voLufs) * 100) / 100,
      clampedToVoiceCeiling: clamped,
      anchor: {ref: anchor.ref, at: anchor.at, timeSec: round3(anchor.timeSec), source: anchor.source},
      alignment: {mode: cue.align, transientOffsetSec, transientSource, frameErrorMs: Math.round(((cue.align === 'transient' ? transientSec : placedFrame / fps) - anchor.timeSec) * 10000) / 10},
      trimmedAtCompositionEnd: durationSec < fileDurationSec,
      ...(placement ? {placement} : {}),
    },
  };
}

/** Voice-first budget (lib/polishSfx.ts): at most SFX_MAX_HITS, transients at least SFX_MIN_SPACING_SEC apart. Priority, then time, then id decide.
 *  The rule lives in audioPlan/sfxSchedule.ts so the pre-payment planner applies exactly the same one. */
function applySfxBudget(candidates: SfxCandidate[], dropped: DroppedElement[]): TimelineSfx[] {
  const items = candidates.map(candidate => ({id: candidate.cue.id, priority: candidate.cue.priority, transientSec: candidate.transientSec, startSec: candidate.sfx.startSec, durationSec: candidate.sfx.durationSec, sfx: candidate.sfx}));
  const result = scheduleBudget(items);
  for (const drop of result.dropped) dropped.push({ref: `sfx:${drop.id}`, reason: drop.reason, detail: drop.detail});
  return result.kept.map(item => item.sfx).sort((a, b) => a.startSec - b.startSec || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Phase SFX-2 (speech_safe only), after the legacy budget: at most SFX_MAX_LAYERS sounds audible at once and at most SFX_DENSITY.max transients within
 * SFX_DENSITY.windowSec of each other. Priority, then time, then id decide; every loser is listed with its reason. (audioPlan/sfxSchedule.ts)
 */
function applySfxLayering(sfx: TimelineSfx[], priority: ReadonlyMap<string, number>, dropped: DroppedElement[]): TimelineSfx[] {
  const items = sfx.map(item => ({id: item.id, priority: priority.get(item.id) ?? 3, transientSec: item.startSec, startSec: item.startSec, durationSec: item.durationSec, sfx: item}));
  const result = scheduleLayering(items);
  for (const drop of result.dropped) dropped.push({ref: `sfx:${drop.id}`, reason: drop.reason, detail: drop.detail});
  return result.kept.map(item => item.sfx).sort((a, b) => a.startSec - b.startSec || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------------------------------------------

export function compileAudioPlan(input: unknown, ctx: CompileContext): CompileResult {
  const parsed = audioPlanSchema.safeParse(input);
  if (!parsed.success) {
    return {ok: false, planHash: null, fallback: 'rules_pipeline', errors: parsed.error.issues.map(issue => ({level: 'plan', code: 'schema_invalid', ref: issue.path.join('.') || '(root)', detail: issue.message}))};
  }
  const plan = parsed.data;
  const hash = planHash(plan);
  const {sheet} = ctx;
  const planErrors: CompileError[] = [];
  if (plan.eventSheet.version !== sheet.version) planErrors.push({level: 'plan', code: 'sheet_version_mismatch', ref: 'eventSheet.version', detail: `plan ${plan.eventSheet.version}, sheet ${sheet.version}`});
  if (plan.eventSheet.timingHash !== sheet.timingHash) planErrors.push({level: 'plan', code: 'stale_timing', ref: 'eventSheet.timingHash', detail: 'the edit timing changed since this plan was written'});
  const ids = plan.sfx.map(cue => cue.id);
  for (const id of new Set(ids.filter((id, index) => ids.indexOf(id) !== index))) planErrors.push({level: 'plan', code: 'duplicate_cue_id', ref: `sfx:${id}`, detail: 'cue ids must be unique'});
  if (planErrors.length > 0) return {ok: false, errors: planErrors, fallback: plan.policy.fallback, planHash: hash};

  const sink: ElementSink = {errors: [], dropped: [], warnings: []};
  if (plan.visualContentHash !== undefined && plan.visualContentHash !== sheet.visualContentHash) sink.warnings.push('visual_content_changed_since_plan');
  // Phase SFX-3D: explicit voice and transcript states; no assumed voice level, no failure read as "no speech" (music/bgmFailSafe.ts).
  const voice = classifyVoiceLoudness({measured: ctx.voLufs, voiceTrack: ctx.voiceTrack ?? (sheet.sourceHasAudio === false ? 'absent' : 'unknown')});
  const transcript = classifyTranscript({
    words: sheet.speech.words.map(word => ({start: word.time.startSec, end: word.time.endSec})),
    analysis: ctx.speechAnalysis ?? 'unknown',
    durationSec: sheet.durationSec,
  });
  const reference = voiceReferenceLufs(voice);
  if (voice.status === 'measurement_failed' || voice.status === 'invalid') sink.warnings.push(`voice_loudness_${voice.status}`);
  if (transcript.status === 'unavailable' || transcript.status === 'untrusted') sink.warnings.push(`transcript_${transcript.status}:${transcript.reason}`);
  const events = new Map(sheet.events.map(event => [event.id, event]));

  const muteReason = bedMuteReason(transcript, voice);
  let music: TimelineMusic | null = null;
  if (plan.music && muteReason) {
    // A safety decision, like the SFX budget: dropped with its reason, never an element error, so it cannot reject the plan.
    sink.dropped.push({ref: `music:${plan.music.assetId}`, reason: `bgm_muted_fail_safe:${muteReason}`, detail: `voice ${voice.status}, transcript ${transcript.status}: the bed cannot be levelled safely`});
    sink.warnings.push(`bgm_muted_fail_safe:${muteReason}`);
  } else if (plan.music) {
    const musicErrorsStart = sink.errors.length;
    const musicDroppedStart = sink.dropped.length;
    music = compileMusic(plan.music, ctx, events, {transcript, voice}, sink);
    if (!music && sink.dropped.length === musicDroppedStart) sink.dropped.push({ref: `music:${plan.music.assetId}`, reason: sink.errors.slice(musicErrorsStart).map(error => error.code).join(',') || 'invalid', detail: 'music element invalid'});
  }
  const candidates: SfxCandidate[] = [];
  const timing: StrictTiming | null = plan.sfxTiming ? {guard: buildSpeechGuard(sheet, plan.sfxTiming), speechMarginSec: plan.sfxTiming.speechMarginSec, policy: plan.sfxTiming.policy} : null;
  for (const cue of plan.sfx) {
    // Phase SFX-3D: an SFX level is set relative to the voice; with the voice level unknown none can be set safely.
    if (!reference) {
      sink.dropped.push({ref: `sfx:${cue.id}`, reason: 'voice_loudness_unknown', detail: `voice ${voice.status}: no SFX level can be set relative to the voice`});
      continue;
    }
    const errorsBefore = sink.errors.length;
    const droppedBefore = sink.dropped.length;
    const candidate = compileSfxCue(cue, ctx, events, reference.voLufs, sink, timing);
    if (candidate) candidates.push(candidate);
    else if (sink.dropped.length === droppedBefore) sink.dropped.push({ref: `sfx:${cue.id}`, reason: sink.errors.slice(errorsBefore).map(error => error.code).join(','), detail: sink.errors.slice(errorsBefore).map(error => error.detail).join('; ')});
  }
  if (sink.errors.length > 0 && plan.policy.onInvalidElement === 'reject_plan') return {ok: false, errors: sink.errors, fallback: plan.policy.fallback, planHash: hash};

  const dropped = [...sink.dropped];
  const budgeted = applySfxBudget(candidates, dropped);
  const sfx = timing ? applySfxLayering(budgeted, new Map(plan.sfx.map(cue => [cue.id, cue.priority])), dropped) : budgeted;
  const timeline: AudioTimeline = {
    version: AUDIO_TIMELINE_VERSION,
    planHash: hash,
    timingHash: sheet.timingHash,
    visualContentHash: sheet.visualContentHash,
    eventSheetVersion: sheet.version,
    fps: sheet.fps,
    durationSec: sheet.durationSec,
    durationFrames: sheet.durationFrames,
    voice: reference ? {voLufs: reference.voLufs, source: reference.source} : {voLufs: null, source: 'unavailable'},
    music,
    sfx,
    dropped,
    warnings: sink.warnings,
  };
  return {ok: true, plan, timeline};
}
