/**
 * Event-specific generated SFX for a finished edit: the production use of the existing AudioDirector chain. Nothing here is a second SFX system:
 *
 *   final blueprint -> buildEventSheet -> planEventSfxIntents (one designed sound per SFX-eligible edit event)
 *     -> buildSfxRequests (speech_hybrid timing, decided BEFORE any payment) -> runGenerationJob (provider transport, cache, ledger, price refusal)
 *     -> ingestGeneration (trim, measure, manifest) -> applyGeneratedAssets -> compileAudioPlan (speech_hybrid placement, budget, layers, levels)
 *     -> toRemotionAudioDesign (renderer hits: src, measured duration, level, sourceChannels)
 *
 * Sound design is deterministic per event type (purpose, family, length, attack/timbre description for the provider prompt). Levels are the
 * existing policy words: `normal` (the catalogue default, peak 10 LU under the voice) where the event sits clear of speech, and `subtle` only where
 * the speech_hybrid policy allows a short transient under speech (it requires `subtle` there). No level is raised beyond the existing words.
 * The voice level must be MEASURED; without it the stage does not run (no level is ever set from a guessed voice).
 */

import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {audioCatalog} from '../audioPlan/assets.ts';
import {compileAudioPlan} from '../audioPlan/compile.ts';
import {AUDIO_PLAN_VERSION} from '../audioPlan/planSchema.ts';
import {toRemotionAudioDesign} from '../audioPlan/remotionAdapter.ts';
import {HYBRID_UNDER_SPEECH, PAUSE_PREONSET} from '../audioPlan/sfxSafety.ts';
import type {VoiceActivityMap} from '../audioPlan/voiceActivity.ts';
import {directSoundDesign, type DesignDecision} from './soundDesignDirector.ts';
import {scheduleBudget, scheduleLayering} from '../audioPlan/sfxSchedule.ts';
import {MIRELO_USAGE_CONFIRMED, MIRELO_USAGE_UNCONFIRMED, sfxRightsConfirmed, VERIFIED_SFX_CONTRACT, type VerifiedSfxContract} from '../generation/sfxContract.ts';
import {publishGeneratedSfxHits, type SfxObjectStore} from './sfxAssetHost.ts';

type GeneratedUsage = {cleared: boolean; licence: string; restriction: string};
import type {AudioDesign, TimelineBlueprint} from '../../../types/blueprint.ts';
import {classifyVoiceLoudness, type VoiceLoudnessState} from '../../music/bgmFailSafe.ts';
import {buildEventSheet} from '../eventSheet/buildEventSheet.ts';
import type {EditEventSheet, EventType} from '../eventSheet/types.ts';
import {applyGeneratedAssets, DEFAULT_USAGE, ingestGeneration, manifestAssets} from '../generation/manifest.ts';
import {buildSfxRequests, type SfxGenerationRequest, type SfxIntentInput, type SfxPurpose} from '../generation/requests.ts';
import {FetchRunwareTransport} from '../generation/fetchTransport.ts';
import {createTransport, runGenerationJob, type RunwareTransport} from '../generation/runware.ts';
import type {SfxCacheStore} from '../generation/sfxCache.ts';
import type {SfxLedgerOptions} from '../generation/sfxLedger.ts';

type Design = {purpose: SfxPurpose; family: SfxIntentInput['character']['family']; durationSec: {min: number; max: number}; description: string; essential: boolean};

/**
 * One designed sound per event type. The description is the provider prompt (runware.ts sfxPrompt): attack, length and timbre for THIS edit move.
 * Families map to the compiler's timing windows (audioPlan/sfxSafety.ts): transients sit on their anchor, whooshes lead into a cut.
 */
export const EVENT_SFX_DESIGN: Readonly<Partial<Record<EventType, Design>>> = Object.freeze({
  zoom: {purpose: 'punch_in', family: 'impact', durationSec: {min: 0.12, max: 0.3}, description: 'tight punch-in impact, crisp fast transient, short dry low-mid body, no tail', essential: true},
  impact_punch_in: {purpose: 'punch_in', family: 'impact', durationSec: {min: 0.12, max: 0.3}, description: 'tight punch-in impact, crisp fast transient, short dry low-mid body, no tail', essential: true},
  cut: {purpose: 'scene_change', family: 'whoosh', durationSec: {min: 0.25, max: 0.5}, description: 'short airy swish leading into a hard cut, soft attack, quick soft tail', essential: true},
  transition: {purpose: 'scene_change', family: 'whoosh', durationSec: {min: 0.25, max: 0.5}, description: 'airy transition whoosh, smooth rise, clean quick release', essential: true},
  stage_cutaway: {purpose: 'scene_change', family: 'whoosh', durationSec: {min: 0.25, max: 0.5}, description: 'airy transition whoosh, smooth rise, clean quick release', essential: false},
  hook_title: {purpose: 'title_reveal', family: 'pop', durationSec: {min: 0.08, max: 0.15}, description: 'clean bright title reveal pop, fast attack, very short', essential: true},
  opening_treatment: {purpose: 'title_reveal', family: 'pop', durationSec: {min: 0.08, max: 0.15}, description: 'clean bright title reveal pop, fast attack, very short', essential: false},
  frame_inset: {purpose: 'product_reveal', family: 'pop', durationSec: {min: 0.08, max: 0.15}, description: 'soft UI reveal pop for a framed picture, gentle and short', essential: false},
  inset_reveal: {purpose: 'product_reveal', family: 'pop', durationSec: {min: 0.08, max: 0.15}, description: 'soft UI reveal pop for a framed picture, gentle and short', essential: false},
  broll: {purpose: 'product_reveal', family: 'pop', durationSec: {min: 0.08, max: 0.15}, description: 'soft UI reveal pop for a cutaway picture, gentle and short', essential: false},
  impact_flash: {purpose: 'visual_emphasis', family: 'impact', durationSec: {min: 0.1, max: 0.25}, description: 'bright accent snap for a white flash, crisp and very short', essential: false},
  impact_sat_pop: {purpose: 'visual_emphasis', family: 'pop', durationSec: {min: 0.08, max: 0.15}, description: 'bright colour-pop accent, short sparkle transient', essential: false},
  kinetic_flash: {purpose: 'visual_emphasis', family: 'click', durationSec: {min: 0.04, max: 0.08}, description: 'tiny soft tick for an on-screen word flash', essential: false},
  motion_graphic: {purpose: 'important_action', family: 'pop', durationSec: {min: 0.08, max: 0.15}, description: 'soft graphic entrance pop, short', essential: false},
  visual_overlay: {purpose: 'important_action', family: 'pop', durationSec: {min: 0.08, max: 0.15}, description: 'soft graphic entrance pop, short', essential: false},
});

/**
 * speech_pause_preonset only: the short variant tried when an event's designed sound cannot fit a measured gap (a whoosh needs >= 250 ms of clear
 * air plus guards; a cut that lands in a 150-200 ms pause can still take a crisp tick). Same purpose, a transient family, honest description.
 */
export const EVENT_SFX_SHORT_VARIANT: Readonly<Partial<Record<EventType, Pick<Design, 'family' | 'durationSec' | 'description'>>>> = Object.freeze({
  cut: {family: 'click', durationSec: {min: 0.05, max: 0.15}, description: 'soft digital interface click with an airy swish marking a hard cut'},
  transition: {family: 'click', durationSec: {min: 0.05, max: 0.15}, description: 'soft digital interface click with an airy swish marking a transition'},
  stage_cutaway: {family: 'click', durationSec: {min: 0.05, max: 0.15}, description: 'soft digital interface click with an airy swish marking a cutaway'},
});

/** Intents for every SFX-eligible event of the edit (deterministic). Conditional-visibility events are excluded (the builder would refuse them). */
export function planEventSfxIntents(sheet: EditEventSheet, intensity: SfxIntentInput['intensity'] = 'normal'): SfxIntentInput[] {
  const intents: SfxIntentInput[] = [];
  for (const event of sheet.events) {
    const design = EVENT_SFX_DESIGN[event.type];
    if (!design || event.visibility.status === 'conditional') continue;
    intents.push({eventId: event.id, purpose: design.purpose, character: {family: design.family, description: design.description}, durationSec: design.durationSec, intensity, essential: design.essential, why: `${event.type} at ${event.time.startSec}s`});
  }
  return intents;
}

export type EventSfxReport = {
  status: 'generated' | 'no_eligible_events' | 'refused' | 'nothing_placed';
  transport: 'live' | 'fixture' | 'disabled_or_other';
  eligible: number;
  requested: number;
  refusedBeforePayment: Array<{ref: string; code: string}>;
  budgetDropped: Array<{ref: string; code: string}>;
  generation?: {status: string; code?: string};
  compiled: number;
  compileDropped: Array<{ref: string; reason: string}>;
  placements: Array<{
    eventId: string;
    family: string;
    level: string;
    startSec: number;
    overlapsSpeech: boolean;
    volume: number;
    sourceChannels?: number;
    tier?: string;
    anchorSec?: number;
    offsetSec?: number;
    durationSec?: number;
    /** ASR word onsets inside [start, end + 60 ms]. Under speech_pause_preonset (`acoustic`) these lie inside a MEASURED silence (never speech). */
    asrOnsetsCovered?: Array<{word: string; asrOnsetSec: number}>;
  }>;
  /** The SFX placement policy used (speech_hybrid = the approved default; speech_pause_preonset = AUDIO_DIRECTOR_SFX_PLACEMENT=pause_preonset). */
  placementPolicy?: 'speech_hybrid' | 'speech_pause_preonset';
  /** speech_pause_preonset: whether a measured voice-activity map was available (without it only speech-clear placements are possible). */
  voiceActivity?: 'measured' | 'unavailable';
  /** Visual design mode: the Sound Design Director's decision for EVERY visual event (sounded, silent, folded, cooldown, spacing, budget). */
  designDecisions?: DesignDecision[];
};

/** AUDIO_DIRECTOR_SFX_PLACEMENT=pause_preonset selects the pause / pre-onset hierarchy; anything else keeps the approved speech_hybrid policy. */
export const resolveSfxPlacementPolicy = (env: NodeJS.ProcessEnv = process.env): 'speech_hybrid' | 'speech_pause_preonset' =>
  (env.AUDIO_DIRECTOR_SFX_PLACEMENT ?? '').trim().toLowerCase() === 'pause_preonset' ? 'speech_pause_preonset' : 'speech_hybrid';

/**
 * speech_pause_preonset: each intent gets the LONGEST duration (its design maximum down to PAUSE_PREONSET.minSoundSec, 10 ms steps) that the
 * placement policy accepts before payment; transients may be shortened below their design minimum (never below 50 ms), sustained families never.
 * The provider is then asked for exactly that length, and ingestion trims to it, so the compiler sees the same duration the decision used.
 */
function fitIntentsToGaps(sheet: EditEventSheet, intents: SfxIntentInput[], videoId: string, timing: Parameters<typeof buildSfxRequests>[0]['timing']): SfxIntentInput[] {
  return intents.map(intent => fitIntentToGap(sheet, intent, videoId, timing) ?? intent); // nothing fits: the real request pass refuses it
}

/** One intent sized to what the placement policy accepts (longest first), else its short variant, else null. Pure. */
export function fitIntentToGap(sheet: EditEventSheet, intent: SfxIntentInput, videoId: string, timing: Parameters<typeof buildSfxRequests>[0]['timing']): SfxIntentInput | null {
  const types = new Map(sheet.events.map(event => [event.id, event.type]));
  const fit = (intent: SfxIntentInput): SfxIntentInput | null => {
    const transient = (PAUSE_PREONSET.preOnsetFamilies as readonly string[]).includes(intent.character.family);
    const floor = transient ? PAUSE_PREONSET.minSoundSec : intent.durationSec.min;
    for (let ms = Math.round(intent.durationSec.max * 1000); ms >= Math.round(floor * 1000); ms -= 10) {
      const max = ms / 1000;
      const candidate = {...intent, durationSec: {min: Math.min(intent.durationSec.min, max), max}};
      if (buildSfxRequests({sheet, intents: [candidate], videoId, timing}).requests.length === 1) return candidate;
    }
    return null;
  };
  const fitted = fit(intent);
  if (fitted) return fitted;
  const type = types.get(intent.eventId) as EventType;
  const variant = EVENT_SFX_SHORT_VARIANT[type] ?? (type === 'kinetic_line' && intent.character.family === 'whoosh' ? KINETIC_SHORT_VARIANT : undefined);
  return variant ? fit({...intent, character: {family: variant.family, description: variant.description}, durationSec: variant.durationSec, why: `${intent.why ?? ''} (short variant: the designed sound does not fit a measured gap)`.slice(0, 300)}) : null;
}

/** A Kinetic word whose whoosh cannot fit keeps a crisp tick on its landing (it may then be an onset accent). */
const KINETIC_SHORT_VARIANT = Object.freeze({family: 'click' as const, durationSec: {min: 0.05, max: 0.1}, description: 'soft digital interface click as the word lands, low blip and airy tick'});

export type EventSfxResult = {hits: NonNullable<ReturnType<typeof lower>>; report: EventSfxReport};
const lower = (hits: unknown) => hits as Array<{at: number; kind: 'whoosh' | 'hit' | 'pop'; volume?: number; reason?: string; src?: string; durationSec?: number; sourceChannels?: 1 | 2}> | null;

/**
 * Runs the chain for one edit. Never throws for an expected refusal: returns hits (possibly empty) and the report. `voLufs` must be a measured,
 * valid voice level (the caller checks). `publicRoot`/`relDir`: where ingested files are written so the renderer can load them (staticFile).
 */
export async function runEventSfxStage(input: {
  sheet: EditEventSheet;
  voLufs: number;
  videoId: string;
  transport: RunwareTransport & {label?: string};
  publicRoot: string;
  relDir: string;
  workDir: string;
  maxUsd: number;
  sfxCache?: SfxCacheStore;
  sfxLedger?: SfxLedgerOptions;
  /** Absent = the approved speech_hybrid policy (unchanged). */
  placement?: {policy: 'speech_pause_preonset'; voiceActivity: VoiceActivityMap | null; underSpeech?: 'none' | 'onset_accent'; design?: 'visual'};
  /** Live transports only: the documentation-verified provider contract (generation/sfxContract.ts). Without it a live SFX job is refused. */
  sfxContract?: VerifiedSfxContract;
  /** Rights record written into the manifest for provider assets (fixture assets always carry the synthetic-fixture record). */
  usage?: GeneratedUsage;
}): Promise<EventSfxResult> {
  const transportLabel: EventSfxReport['transport'] = input.transport.live ? 'live' : input.transport.label === 'fixture' ? 'fixture' : 'disabled_or_other';
  const base: EventSfxReport = {status: 'no_eligible_events', transport: transportLabel, eligible: 0, requested: 0, refusedBeforePayment: [], budgetDropped: [], compiled: 0, compileDropped: [], placements: []};
  const plan = planEventSfxRequests({sheet: input.sheet, videoId: input.videoId, ...(input.placement ? {placement: input.placement} : {})});
  const report: EventSfxReport = {...base, ...plan.reportFields};
  if (report.eligible === 0) return {hits: [], report};
  if (plan.set.requests.length === 0) return {hits: [], report: {...report, status: 'nothing_placed'}};
  return generateAndCompile(input, report, plan.set, plan.timing);
}

/**
 * The pre-payment plan: which events get a sound, its family, prompt and length, decided by the placement policy BEFORE any provider request. Pure.
 * Used by runEventSfxStage and by the supervised first-live-SFX runner (listeningTest/generateFirstSfx.ts), so the approved plan is the one generated.
 */
function planEventSfxRequestsUnscheduled(input: {sheet: EditEventSheet; videoId: string; placement?: {policy: 'speech_pause_preonset'; voiceActivity: VoiceActivityMap | null; underSpeech?: 'none' | 'onset_accent'; design?: 'visual'}}): {
  timing: Parameters<typeof buildSfxRequests>[0]['timing'];
  set: ReturnType<typeof buildSfxRequests>;
  reportFields: Pick<EventSfxReport, 'eligible' | 'requested' | 'refusedBeforePayment' | 'budgetDropped'> & Partial<Pick<EventSfxReport, 'placementPolicy' | 'voiceActivity' | 'designDecisions'>>;
} {
  const fields = (eligible: number, set: ReturnType<typeof buildSfxRequests>) => ({
    eligible,
    requested: set.requests.length,
    refusedBeforePayment: set.refused.map(issue => ({ref: issue.ref, code: issue.code})),
    budgetDropped: set.dropped.map(issue => ({ref: issue.ref, code: issue.code})),
  });
  if (input.placement) {
    const timing = {
      policy: 'speech_pause_preonset' as const,
      ...(input.placement.voiceActivity ? {voiceActivity: input.placement.voiceActivity} : {}),
      ...(input.placement.underSpeech === 'onset_accent' ? {underSpeech: 'onset_accent' as const} : {}),
    };
    if (input.placement.design === 'visual') {
      // Sound Design Director: every drawn visual event is considered; importance-first within cooldowns, spacing and budget; the placement policy
      // vetoes what it cannot place, so the budget goes to the next most important event.
      // the veto also runs the compiler's schedule (audioPlan/sfxSchedule.ts) on everything accepted so far: a sound is accepted only if it AND every
      // earlier one survive, so no budget slot goes to a sound the compiler would drop
      const accepted: SfxIntentInput[] = [];
      const directed = directSoundDesign(input.sheet, {
        accept: intent => {
          const fitted = fitIntentToGap(input.sheet, intent, input.videoId, timing);
          if (!fitted) {
            const invalid = buildSfxRequests({sheet: input.sheet, intents: [intent], videoId: input.videoId, timing}).refused.find(issue => issue.code === 'intent_invalid');
            return invalid ? {veto: `invalid intent: ${invalid.detail}`.slice(0, 200)} : null;
          }
          const trial = buildSfxRequests({sheet: input.sheet, intents: [...accepted, fitted], videoId: input.videoId, timing});
          if (trial.requests.length !== accepted.length + 1) return {veto: `request budget: ${trial.dropped.map(d => `${d.ref} ${d.code}`).join(', ') || 'refused'}`};
          const conflict = scheduleConflict(trial.requests, input.sheet.fps);
          if (conflict) return {veto: `compiler schedule (pre-payment): ${conflict}`};
          accepted.push(fitted);
          return fitted;
        },
      });
      const set = buildSfxRequests({sheet: input.sheet, intents: directed.intents, videoId: input.videoId, timing});
      return {
        timing,
        set,
        reportFields: {...fields(directed.decisions.filter(d => d.decision !== 'silent' || d.reason.startsWith('no speech-safe')).length, set), placementPolicy: 'speech_pause_preonset', voiceActivity: input.placement.voiceActivity ? 'measured' : 'unavailable', designDecisions: directed.decisions},
      };
    }
    // Nothing goes under speech in this policy, so every sound keeps the `normal` level (the catalogue default); none is raised.
    const intents = fitIntentsToGaps(input.sheet, planEventSfxIntents(input.sheet, 'normal'), input.videoId, timing);
    const set = buildSfxRequests({sheet: input.sheet, intents, videoId: input.videoId, timing});
    return {timing, set, reportFields: {...fields(intents.length, set), placementPolicy: 'speech_pause_preonset', voiceActivity: input.placement.voiceActivity ? 'measured' : 'unavailable'}};
  }
  const timing = {policy: 'speech_hybrid' as const};
  // normal level where the event is clear of speech; a short transient that can only sit under speech is retried at `subtle` (the policy's rule)
  const normal = planEventSfxIntents(input.sheet, 'normal');
  if (normal.length === 0) return {timing, set: {requests: [], refused: [], dropped: []} as unknown as ReturnType<typeof buildSfxRequests>, reportFields: {eligible: 0, requested: 0, refusedBeforePayment: [], budgetDropped: []}};
  const first = buildSfxRequests({sheet: input.sheet, intents: normal, videoId: input.videoId, timing});
  // A short transient that can only sit UNDER speech is retried as the policy requires there: `subtle`, and no longer than its 200 ms limit (the same
  // designed sound, shortened). Everything else keeps its first decision (a whoosh under speech, an onset collision: refused).
  const retryIds = new Set(first.refused.filter(issue => issue.code === 'not_subtle_for_under_speech' || issue.code === 'too_long_for_under_speech').map(issue => issue.ref.split(':').slice(1).join(':')));
  const underSpeechMax = HYBRID_UNDER_SPEECH.maxDurationSec;
  const intents = normal.map(intent => {
    if (!retryIds.has(intent.eventId)) return intent;
    const max = Math.min(intent.durationSec.max, underSpeechMax);
    return {...intent, intensity: 'subtle' as const, durationSec: {min: Math.min(intent.durationSec.min, max), max}};
  });
  const set = buildSfxRequests({sheet: input.sheet, intents, videoId: input.videoId, timing});
  return {timing, set, reportFields: fields(normal.length, set)};
}

async function generateAndCompile(
  input: Parameters<typeof runEventSfxStage>[0],
  base: EventSfxReport,
  set: ReturnType<typeof buildSfxRequests>,
  timing: Parameters<typeof buildSfxRequests>[0]['timing'],
): Promise<EventSfxResult> {
  const transportLabel = base.transport;
  // 2. generation (the provider's own refusals apply: price unknown on a live transport, ledger, cache)
  const job = await runGenerationJob({bgm: null, sfx: set.requests, transport: input.transport, maxUsd: input.maxUsd, workDir: input.workDir, ...(input.sfxCache ? {sfxCache: input.sfxCache} : {}), ...(input.sfxLedger ? {sfxLedger: input.sfxLedger} : {}), ...(input.sfxContract ? {sfxContract: input.sfxContract} : {})});
  if (job.status === 'refused') return {hits: [], report: {...base, status: 'refused', generation: {status: 'refused', code: job.code}}};
  const isFixture = transportLabel === 'fixture';
  const manifest = await ingestGeneration({
    videoId: input.videoId,
    sheet: input.sheet,
    bgm: null,
    sfx: set.requests,
    outcomes: job.outcomes,
    publicRoot: input.publicRoot,
    relDir: input.relDir,
    measureLufs: async () => {
      throw new Error('SFX ingest does not measure loudness');
    },
    usage: isFixture ? {cleared: true, licence: 'SYNTHETIC LOCAL FIXTURE (FixtureSfxTransport): not AI-generated, not provider output', restriction: 'offline tests and local proof renders only'} : (input.usage ?? DEFAULT_USAGE),
  });

  // 3. plan -> compile (speech_hybrid placement, budget, layers) -> renderer hits
  const plan = {
    version: AUDIO_PLAN_VERSION,
    eventSheet: {version: input.sheet.version, timingHash: input.sheet.timingHash},
    music: null,
    sfx: [],
    sfxTiming: timing,
    policy: {onInvalidElement: 'drop_element', fallback: 'rules_pipeline'},
    provenance: {author: 'rules', note: 'event-specific generated SFX (production stage)'},
  };
  const applied = applyGeneratedAssets(plan, manifest, set.requests);
  if (!applied.ok) return {hits: [], report: {...base, status: 'refused', generation: {status: 'completed'}, compileDropped: [{ref: 'plan', reason: applied.detail}]}};
  const compiled = compileAudioPlan(applied.plan, {sheet: input.sheet, assets: audioCatalog([], manifestAssets(manifest).sfx), voLufs: input.voLufs, videoId: input.videoId});
  if (!compiled.ok) return {hits: [], report: {...base, status: 'refused', generation: {status: 'completed'}, compileDropped: compiled.errors.map(error => ({ref: error.ref, reason: error.code}))}};
  const lowered = toRemotionAudioDesign(compiled.timeline);
  if (!lowered.ok) return {hits: [], report: {...base, status: 'refused', generation: {status: 'completed'}}};
  const byCue = new Map(compiled.timeline.sfx.map(sfx => [sfx.id, sfx]));
  const requestByEvent = new Map<string, SfxGenerationRequest>(set.requests.map(request => [request.event.id, request]));
  const placements = compiled.timeline.sfx.map(sfx => ({
    eventId: sfx.anchor.ref,
    family: sfx.placement?.family ?? requestByEvent.get(sfx.anchor.ref)?.character.family ?? 'unknown',
    level: sfx.placement?.level ?? 'normal',
    startSec: sfx.startSec,
    overlapsSpeech: sfx.placement?.overlapsSpeech ?? false,
    volume: sfx.volume,
    ...(sfx.placement?.tier ? {tier: sfx.placement.tier} : {}),
    ...(requestByEvent.get(sfx.anchor.ref) ? {anchorSec: requestByEvent.get(sfx.anchor.ref)!.event.timeSec, offsetSec: Math.round((sfx.startSec - requestByEvent.get(sfx.anchor.ref)!.event.timeSec) * 1000) / 1000} : {}),
    ...(sfx.sourceChannels ? {sourceChannels: sfx.sourceChannels} : {}),
    durationSec: sfx.durationSec,
    ...(sfx.placement?.tier
      ? {
          asrOnsetsCovered: input.sheet.speech.words
            .filter(word => word.time.startSec >= sfx.startSec - 1e-6 && word.time.startSec <= sfx.startSec + sfx.durationSec + PAUSE_PREONSET.preOnsetGuardSec + 1e-6)
            .map(word => ({word: word.text, asrOnsetSec: word.time.startSec})),
        }
      : {}),
  }));
  const hits = lower(lowered.audioDesign.hits) ?? [];
  return {
    hits,
    report: {
      ...base,
      status: hits.length > 0 ? 'generated' : 'nothing_placed',
      generation: {status: 'completed'},
      compiled: byCue.size,
      compileDropped: compiled.timeline.dropped.map(item => ({ref: item.ref, reason: item.reason})),
      placements,
    },
  };
}

/** Where a local render can load ingested files from: `<remotion public>/<relDir>` (staticFile:<relDir>/...). */
export const eventSfxRelDir = (videoId: string): string => path.posix.join('generated-sfx', videoId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64));

// ------------------------------------------------------------------------------------------------------------------- production attachment
/** remotion/public (where the local renderer serves staticFile assets). AUDIO_DIRECTOR_SFX_PUBLIC_ROOT overrides it (tests, isolated runs). */
export function eventSfxPublicRoot(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = (env.AUDIO_DIRECTOR_SFX_PUBLIC_ROOT ?? '').trim();
  if (explicit) return path.resolve(explicit);
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../remotion/public');
}

/** The production switch. OFF unless AUDIO_DIRECTOR_SFX=1. */
export const eventSfxEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => (env.AUDIO_DIRECTOR_SFX ?? '').trim() === '1';

/**
 * analyzeVideo's call: generated, event-specific SFX for the finished blueprint. Returns the audio design to use and warnings. The existing hits are
 * kept unchanged unless at least one generated sound was placed (then the generated hits replace the generic built-in ones).
 *   - Lambda rendering: skipped (ingested files are local staticFile assets; a public asset host is not implemented yet).
 *   - Voice level not measured or invalid: skipped (an SFX level is never set from a guessed voice).
 */
export async function attachEventSfx(input: {
  blueprint: TimelineBlueprint;
  voice: VoiceLoudnessState | null;
  voiceTrack: 'present' | 'absent' | 'unknown';
  measureVoice: () => Promise<number | null>;
  videoId: string;
  /** Created lazily: the AudioDirector factory throws when generation is switched on without a live transport. */
  transport: () => RunwareTransport & {label?: string};
  publicRoot: string;
  workDir: string;
  lambdaRender: boolean;
  maxUsd?: number;
  /** speech_pause_preonset (AUDIO_DIRECTOR_SFX_PLACEMENT=pause_preonset): the voice-activity measurement. Absent = the approved speech_hybrid policy. */
  placement?: {policy: 'speech_pause_preonset'; measureVoiceActivity: () => Promise<VoiceActivityMap | null>; underSpeech?: 'none' | 'onset_accent'; design?: 'visual'};
  /** Live provider options (only used when the transport is live): the verified contract, the per-video ledger and the asset usage record. */
  live?: {contract: VerifiedSfxContract; ledger: SfxLedgerOptions | null; usage: GeneratedUsage};
  /** Lambda: the object store generated SFX are published to (production/sfxAssetHost.ts). Null/absent = skipped on Lambda (no public host). */
  lambdaStore?: () => Promise<SfxObjectStore | null>;
}): Promise<{audioDesign: AudioDesign | undefined; warnings: string[]; report: EventSfxReport | null}> {
  const current = input.blueprint.audioDesign;
  // An SFX stage never fails the edit: any unexpected error keeps the existing hits, with a warning.
  try {
    return await attachEventSfxUnguarded(input, current);
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String((error as {code: unknown}).code) : 'error';
    return {audioDesign: current, warnings: [`sfx:event_skipped:${code}`], report: null};
  }
}

async function attachEventSfxUnguarded(input: Parameters<typeof attachEventSfx>[0], current: AudioDesign | undefined): Promise<{audioDesign: AudioDesign | undefined; warnings: string[]; report: EventSfxReport | null}> {
  const store = input.lambdaRender ? ((await input.lambdaStore?.()) ?? null) : null;
  if (input.lambdaRender && !store) return {audioDesign: current, warnings: ['sfx:event_skipped:no_public_asset_host'], report: null};
  const voice = input.voice ?? classifyVoiceLoudness({measured: await input.measureVoice(), voiceTrack: input.voiceTrack});
  if (voice.status !== 'measured') return {audioDesign: current, warnings: [`sfx:event_skipped:voice_loudness_${voice.status}`], report: null};
  const sheet = buildEventSheet(input.blueprint, input.placement?.design === 'visual' ? {kineticLines: true} : {});
  mkdirSync(input.workDir, {recursive: true});
  const result = await runEventSfxStage({
    sheet,
    voLufs: voice.lufs,
    videoId: input.videoId,
    transport: input.transport(),
    publicRoot: input.publicRoot,
    relDir: eventSfxRelDir(input.videoId),
    workDir: input.workDir,
    maxUsd: input.maxUsd ?? 0,
    ...(input.placement
      ? {placement: {policy: input.placement.policy, voiceActivity: await input.placement.measureVoiceActivity(), ...(input.placement.underSpeech ? {underSpeech: input.placement.underSpeech} : {}), ...(input.placement.design ? {design: input.placement.design} : {})}}
      : {}),
    ...(input.live ? {sfxContract: input.live.contract, ...(input.live.ledger ? {sfxLedger: input.live.ledger} : {}), usage: input.live.usage} : {}),
  });
  const report = result.report;
  if (result.hits.length === 0) {
    return {audioDesign: current, warnings: [`sfx:event_none:${report.status}${report.generation?.code ? `:${report.generation.code}` : ''}`], report};
  }
  let hits = result.hits;
  if (store) {
    // Lambda: publish (content-addressed, HEAD before PUT) and point the hits at the hosted URLs; any failure keeps the edit's existing hits.
    const published = await publishGeneratedSfxHits(hits, {publicRoot: input.publicRoot, store});
    if (!published.ok) return {audioDesign: current, warnings: [`sfx:event_not_hosted:${published.code}`], report};
    hits = published.hits;
  }
  const audioDesign: AudioDesign = {...(current ?? {ducking: true, sfx: []}), hits};
  return {audioDesign, warnings: [`sfx:event_generated:${result.hits.length}`, ...(report.transport === 'fixture' ? ['sfx:event_fixture_transport'] : [])], report};
}

// ------------------------------------------------------------------------------------------------------------------- production switches
/**
 * Every switch is OFF by default and independent:
 *   AUDIO_DIRECTOR_SFX=1                         run the event-SFX stage at all
 *   AUDIO_DIRECTOR_SFX_PLACEMENT=pause_preonset   the pause / pre-onset placement hierarchy (else the approved speech_hybrid policy)
 *   AUDIO_DIRECTOR_SFX_LIVE=1                     the live Runware transport (FetchRunwareTransport, RUNWARE_API_KEY); else the existing factory
 *   AUDIO_DIRECTOR_SFX_MAX_USD=<n>                hard per-video cap; default 0 (a live job is then refused before any request)
 *   AUDIO_DIRECTOR_SFX_LEDGER_DIR=<dir>           the per-video SFX ledger directory (required for live; else refused)
 *   AUDIO_DIRECTOR_SFX_RIGHTS=mirelo_commercial_confirmed   the product owner's licence confirmation (else assets are not cleared and not placed)
 *   AUDIO_DIRECTOR_SFX_HOSTING=r2                 publish generated SFX to R2 for Lambda renders (else skipped on Lambda)
 */
export function createEventSfxTransport(env: NodeJS.ProcessEnv = process.env): RunwareTransport {
  if ((env.AUDIO_DIRECTOR_SFX_LIVE ?? '').trim() === '1') return new FetchRunwareTransport({apiKey: env.RUNWARE_API_KEY ?? ''});
  return createTransport(env);
}

export function eventSfxLiveOptions(env: NodeJS.ProcessEnv, videoId: string): {contract: VerifiedSfxContract; ledger: SfxLedgerOptions | null; usage: GeneratedUsage} {
  const dir = (env.AUDIO_DIRECTOR_SFX_LEDGER_DIR ?? '').trim();
  return {contract: VERIFIED_SFX_CONTRACT, ledger: dir ? {dir: path.resolve(dir), videoId} : null, usage: sfxRightsConfirmed(env) ? MIRELO_USAGE_CONFIRMED : MIRELO_USAGE_UNCONFIRMED};
}

export function eventSfxMaxUsd(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number((env.AUDIO_DIRECTOR_SFX_MAX_USD ?? '').trim());
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export const eventSfxHostingEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => (env.AUDIO_DIRECTOR_SFX_HOSTING ?? '').trim() === 'r2';

/** AUDIO_DIRECTOR_SFX_DESIGN=visual: the Sound Design Director over every visual event (word-level Kinetic included). Implies pause_preonset. */
export const resolveSfxDesign = (env: NodeJS.ProcessEnv = process.env): 'visual' | null => ((env.AUDIO_DIRECTOR_SFX_DESIGN ?? '').trim() === 'visual' ? 'visual' : null);
/** AUDIO_DIRECTOR_SFX_UNDER_SPEECH=onset_accent: short speech-band-carved accents may land 0..40 ms before a word onset (sfxSafety.ts). */
export const resolveSfxUnderSpeech = (env: NodeJS.ProcessEnv = process.env): 'none' | 'onset_accent' => ((env.AUDIO_DIRECTOR_SFX_UNDER_SPEECH ?? '').trim() === 'onset_accent' ? 'onset_accent' : 'none');

/**
 * The pre-payment plan (Validation Sprint 2): the policy's requests, then the compiler's own budget and layering rules (audioPlan/sfxSchedule.ts) on
 * the PLANNED placements with margins for what the compiler can still change. A request the compiler would inevitably drop is removed here, with
 * its reason, before anything is paid for. Used by runEventSfxStage and the supervised first-live-SFX runner.
 */
export function planEventSfxRequests(input: Parameters<typeof planEventSfxRequestsUnscheduled>[0]): ReturnType<typeof planEventSfxRequestsUnscheduled> {
  const planned = planEventSfxRequestsUnscheduled(input);
  const fps = input.sheet.fps;
  const items = planned.set.requests.map(request => {
    const startSec = (request.timing ? request.timing.startFrame : Math.ceil(request.event.timeSec * fps - 1e-6)) / fps;
    return {id: request.requestId, priority: request.essential ? 1 : 3, transientSec: startSec, startSec, durationSec: request.durationSec.max, transientSpreadSec: SUSTAINED_ALIGN_START.has(request.character.family) ? request.durationSec.max : 0, request};
  });
  const budget = scheduleBudget(items, {spacingMarginSec: 1 / fps, displayId: item => item.request.event.id});
  const layered = scheduleLayering(budget.kept, {windowMarginSec: item => item.durationSec});
  const keptIds = new Set(layered.kept.map(item => item.id));
  const eventOf = new Map(items.map(item => [item.id, item.request.event.id]));
  const scheduleDrops = [...budget.dropped, ...layered.dropped].map(drop => ({ref: `sfx:${eventOf.get(drop.id)}`, code: `schedule_${drop.reason}`, detail: `${drop.detail} (pre-payment schedule, the compiler's rule)`}));
  if (scheduleDrops.length === 0) return planned;
  const set = {...planned.set, requests: planned.set.requests.filter(request => keptIds.has(request.requestId)), dropped: [...planned.set.dropped, ...scheduleDrops]};
  return {...planned, set, reportFields: {...planned.reportFields, requested: set.requests.length, budgetDropped: set.dropped.map(issue => ({ref: issue.ref, code: issue.code}))}};
}

/** Null when the compiler's schedule (with the pre-payment margins) keeps every one of these requests, else the first conflict. */
function scheduleConflict(requests: readonly SfxGenerationRequest[], fps: number): string | null {
  const items = requests.map(request => {
    const startSec = (request.timing ? request.timing.startFrame : Math.ceil(request.event.timeSec * fps - 1e-6)) / fps;
    return {id: request.requestId, priority: request.essential ? 1 : 3, transientSec: startSec, startSec, durationSec: request.durationSec.max, transientSpreadSec: SUSTAINED_ALIGN_START.has(request.character.family) ? request.durationSec.max : 0};
  });
  const budget = scheduleBudget(items, {spacingMarginSec: 1 / fps});
  const layered = scheduleLayering(budget.kept, {windowMarginSec: item => item.durationSec});
  const first = budget.dropped[0] ?? layered.dropped[0];
  return first ? `${first.reason} (${first.detail})` : null;
}

/** Families the manifest aligns on their start (generation/manifest.ts): their compiled transient can be anywhere inside the sound. */
const SUSTAINED_ALIGN_START: ReadonlySet<string> = new Set(['whoosh', 'sweep', 'riser', 'swell', 'texture', 'stinger']);
