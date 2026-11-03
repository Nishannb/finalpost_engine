/**
 * WP36: FACELESS DOCUMENTARY LANE (Metromedia: `on_camera_speaker: false`, `broll.coverage_pct: 100`). The talking head is not the world: every shot of the WP33 VO cut plan gets its own LITERAL stock still, so
 * the picture changes on each caption group (mean shot ~0.85 s) and the media covers ~100 % of the runtime. This module composes the earlier grammar work into one plan:
 *
 *   WP33 cut plan (shots = caption groups / holds / splits)  ->  one still per shot (WP30 scene resolver, literal to the spoken words of THAT shot)  ->  ImageRun items with exact per-shot holds
 *   (WP34 accumulate captions and WP35 impact FX / punch-in are planned by their own modules from the same cut plan and paint over this media; the framed cards here carry the WP35 white border + fly-out)
 *
 * PURE + ASYNC-INJECTED (like `editorialStillMontage`): no env, no logger, no network. The photo resolver is injected (production: `findPhotoAsset`, i.e. Pexels / Pixabay; tests: a fake).
 *
 * Rules (editref.md / metromedia-grammar.yaml):
 *  - one shot per caption group: a shot is exactly [start, end) of the cut plan, hard cut on every boundary (no gap, no overlap, no transition)
 *  - literal: the query comes from the words spoken in that shot (scene rules, then concrete nouns); a claim with no visible scene takes the neighbours' scene, then neutral editorial b-roll
 *  - solids gate (WP29): only https photo URLs, never a flat / solid fixture, never a video or gif; a miss re-uses an earlier photo (never a gap, never a solid)
 *  - motion: every full-bleed still pushes in linearly; WP39 `motionSpeed` sets how far (slow 1.04 DEFAULT / normal 1.06 / fast 1.08): money / headline holds and the hook shot are fast, breathing room and chapter-adjacent shots stay slow; ~15 % of the shots (never the last of a run, never < 0.6 s) are FRAMED cards: white border + blur_self world + 3D fly-out over the next shot
 *  - no gap > 0.3 s without media: chapter cards (and any other full-screen beat passed as `blockedRanges`) own their own span; everything else is a still
 *  - a run is an ImageRun of 2-6 stills (the library contract); a long montage is several consecutive runs that meet exactly (no gap between them)
 */
import {wordsInWindow, type CaptionWordLike} from './klipyContextQuery.ts';
import {EDITORIAL_BACKDROP, EDITORIAL_FALLBACK_SCENES, editorialRecipeAt, editorialStillQueries, isPhotoUrl, type EditorialPhotoResolver} from './editorialStillMontage.ts';
import {runCutTimes, type ImageRunPlan, type MotionSpeed, type TimeRange} from './labeledAssetPlacement.ts';
import type {VoCutPlan, VoHold} from './voCutGrammar.ts';
import {buildNounLockProfile, nounLockFallbacks, nounLockQueries, nounLockWarnings, resolveNounLocked, type NounLockProfile} from './nounLock.ts';

export const FACELESS_FRAMED_SHARE = 0.15;
export const FACELESS_FRAMED_MIN_SHOT_SEC = 0.6;
export const FACELESS_MAX_RUN_ITEMS = 6;
export const FACELESS_MIN_RUN_ITEMS = 2;
export const FACELESS_MAX_GAP_SEC = 0.3;
export const FACELESS_COVERAGE_TARGET = 0.95;
/** Lookups per edit: 4 attempts a shot at most, capped (~1 lookup / shot on average in practice). */
export const FACELESS_MAX_LOOKUPS = 260;
/** A re-used photo is not shown again within this many shots. */
export const FACELESS_REUSE_COOLDOWN = 4;
/** WP39: the hook shot (a shot starting before this) pushes fast; so does any shot overlapping a money / headline hold. */
export const FACELESS_HOOK_FAST_SEC = 1.5;
/** WP39: a shot this long is a breathing moment (slow push), and so is any shot within this many seconds of a chapter card edge. */
export const FACELESS_BREATHING_SHOT_SEC = 1.2;
export const FACELESS_CHAPTER_ADJACENT_SEC = 1.5;

const round = (value: number) => Math.round(value * 1000) / 1000;

export type FacelessShot = {
  start: number;
  end: number;
  src: string;
  /** The words spoken in this shot (what the still is literal to). */
  spoken: string;
  query: string;
  provider: string;
  providerId: number;
  /** The query is neutral editorial b-roll (the claim had no visible scene of its own). */
  fallbackScene: boolean;
  /** The photo was already shown earlier (lookups ran out or missed). */
  reused: boolean;
  /** A framed card (white border + fly-out) instead of a full-bleed still. */
  framed: boolean;
  recipeId?: string;
  /** WP39: the full-bleed push-in speed (absent on framed cards, which have no Ken Burns). */
  motionSpeed?: MotionSpeed;
};

export type FacelessDocStats = {
  durationSec: number;
  shotCount: number;
  meanShotSec: number;
  /** Photo seconds / duration (0-1). */
  photoCoverage: number;
  /** Photo + other full-screen beats (chapter cards) seconds / duration (0-1): the share of the runtime that is NOT the talking head. */
  mediaCoverage: number;
  /** The longest stretch with neither a still nor another full-screen beat (seconds). */
  maxGapSec: number;
  lookups: number;
  misses: number;
  reused: number;
  fallbackShots: number;
  framedShots: number;
  runs: number;
  /** WP39: full-bleed stills per push-in speed. */
  motionSpeeds: Record<MotionSpeed, number>;
  /** WP37: shots whose spoken words (or the words around a scene-less shot) named a noun to lock. */
  nounLocked: number;
  /** WP37: candidate photos the relevance judge refused. */
  nounLockRejected: number;
  /** WP37: locked shots that ended on neutral b-roll, a re-used photo, or nothing instead of a photo of the noun. */
  nounLockMisses: number;
};

export type FacelessDocLane = {
  runs: ImageRunPlan[];
  shots: FacelessShot[];
  /** Shots the lane could not fill (no photo and nothing to re-use); their time is a gap. */
  unfilled: TimeRange[];
  stats: FacelessDocStats;
  warnings: string[];
};

export type PlanFacelessDocInput = {
  /** The WP33 cut plan: `shots` are the cut-locked spans; `groups` carry the spoken words of each. */
  plan: Pick<VoCutPlan, 'shots' | 'groups'> & Partial<Pick<VoCutPlan, 'holds' | 'chapterCards'>>;
  words: readonly CaptionWordLike[];
  durationSec: number;
  resolver: EditorialPhotoResolver;
  /** Full-screen beats that already own their span (placed chapter cards, ...): the lane plants no still under them. */
  blockedRanges?: readonly TimeRange[];
  maxLookups?: number;
  /** Share of the shots drawn as framed cards (default 0.15). */
  framedShare?: number;
  /** WP39: the push-in speed of a shot with no special context (default `slow`). Breathing / chapter-adjacent shots are always slow; money / headline / hook shots are always fast. */
  defaultMotionSpeed?: MotionSpeed;
  /** WP37: noun-lock the queries and judge the candidates (default on; a shot with no noun to lock is untouched). */
  nounLock?: boolean;
};

/** WP39: the push-in speed of one shot from its context: fast on a money / headline hold or the hook, slow in breathing room (a long shot) or next to a chapter card, else `fallback` (default slow). */
export function facelessMotionSpeed(
  shot: TimeRange,
  context: {holds?: readonly Pick<VoHold, 'start' | 'end' | 'reason'>[]; chapterCards?: readonly {at: number; duration: number}[]; fallback?: MotionSpeed} = {},
): MotionSpeed {
  const overlaps = (start: number, end: number) => shot.start < end - 1e-6 && shot.end > start + 1e-6;
  if (shot.start < FACELESS_HOOK_FAST_SEC) return 'fast';
  if ((context.holds ?? []).some(hold => (hold.reason === 'money' || hold.reason === 'headline') && overlaps(hold.start, hold.end))) return 'fast';
  const nearCard = (context.chapterCards ?? []).some(card => overlaps(card.at - FACELESS_CHAPTER_ADJACENT_SEC, card.at + card.duration + FACELESS_CHAPTER_ADJACENT_SEC));
  if (nearCard || shot.end - shot.start >= FACELESS_BREATHING_SHOT_SEC) return 'slow';
  return context.fallback ?? 'slow';
}

/** The shots of the cut plan the lane must fill: each clipped to the free part outside `blocked`; a sliver under 0.1 s is left to the beat that owns the neighbouring span. */
export function facelessSlots(shots: readonly Pick<VoCutPlan['shots'][number], 'start' | 'end'>[], blocked: readonly TimeRange[], durationSec: number): TimeRange[] {
  const out: TimeRange[] = [];
  const owned = [...blocked].filter(range => range.end > range.start).sort((a, b) => a.start - b.start);
  for (const shot of shots) {
    let pieces: TimeRange[] = [{start: Math.max(0, shot.start), end: Math.min(durationSec, shot.end)}];
    for (const range of owned) {
      pieces = pieces.flatMap(piece => {
        if (range.end <= piece.start + 1e-6 || range.start >= piece.end - 1e-6) return [piece];
        const parts: TimeRange[] = [];
        if (range.start > piece.start + 1e-6) parts.push({start: piece.start, end: range.start});
        if (range.end < piece.end - 1e-6) parts.push({start: range.end, end: piece.end});
        return parts;
      });
    }
    for (const piece of pieces) if (piece.end - piece.start >= 0.1) out.push({start: round(piece.start), end: round(piece.end)});
  }
  return out;
}

/** The words spoken in a span: the cut plan's caption groups that start inside it, else the words that start inside it, else the nearest word before it. */
export function spokenInSpan(span: TimeRange, plan: Pick<VoCutPlan, 'groups'>, words: readonly CaptionWordLike[]): string {
  const groups = plan.groups.filter(group => group.start >= span.start - 0.02 && group.start < span.end - 0.02);
  if (groups.length > 0) return groups.flatMap(group => group.words).join(' ');
  const inside = wordsInWindow(words, span.start - 0.05, span.end);
  if (inside.length > 0) return inside.map(word => word.text).join(' ');
  const before = [...words].reverse().find(word => word.start < span.start);
  return before?.text ?? '';
}

/** Longest stretch of [0, durationSec] that no media interval covers. */
export function longestGap(media: readonly TimeRange[], durationSec: number): number {
  const sorted = [...media].filter(range => range.end > range.start).sort((a, b) => a.start - b.start);
  let cursor = 0;
  let worst = 0;
  for (const range of sorted) {
    if (range.start > cursor) worst = Math.max(worst, range.start - cursor);
    cursor = Math.max(cursor, range.end);
  }
  return round(Math.max(worst, durationSec - cursor));
}

/** Union length of the intervals clipped to [0, durationSec]. */
export function unionSeconds(ranges: readonly TimeRange[], durationSec: number): number {
  const sorted = ranges.map(range => ({start: Math.max(0, range.start), end: Math.min(durationSec, range.end)})).filter(range => range.end > range.start).sort((a, b) => a.start - b.start);
  let total = 0;
  let cursor = 0;
  for (const range of sorted) {
    const start = Math.max(range.start, cursor);
    if (range.end > start) total += range.end - start;
    cursor = Math.max(cursor, range.end);
  }
  return total;
}

/** Split a time-contiguous segment of N shots into chunks of 2-6 (never a lone shot; a segment of one shot is split in two by the caller). */
export function chunkSizes(count: number, max: number = FACELESS_MAX_RUN_ITEMS): number[] {
  if (count <= 0) return [];
  if (count <= max) return [count];
  const parts = Math.ceil(count / max);
  const base = Math.floor(count / parts);
  const extra = count % parts;
  return Array.from({length: parts}, (_, index) => base + (index < extra ? 1 : 0));
}

type Slot = TimeRange & {spoken: string; context: string};

export async function planFacelessDocLane(input: PlanFacelessDocInput): Promise<FacelessDocLane> {
  const duration = input.durationSec;
  const blocked = [...(input.blockedRanges ?? [])];
  const emptyStats = (overrides: Partial<FacelessDocStats> = {}): FacelessDocStats => ({durationSec: duration, shotCount: 0, meanShotSec: 0, photoCoverage: 0, mediaCoverage: 0, maxGapSec: duration, lookups: 0, misses: 0, reused: 0, fallbackShots: 0, framedShots: 0, runs: 0, motionSpeeds: {slow: 0, normal: 0, fast: 0}, nounLocked: 0, nounLockRejected: 0, nounLockMisses: 0, ...overrides});
  if (!Number.isFinite(duration) || duration < 2 || input.plan.shots.length === 0) {
    return {runs: [], shots: [], unfilled: [], stats: emptyStats(), warnings: ['polish_pace:faceless_coverage:0.0']};
  }

  // 1) the slots: the cut plan's shots minus the spans another full-screen beat owns; a lone slot is split in two so every run holds >= 2 stills
  let slots: Slot[] = facelessSlots(input.plan.shots, blocked, duration).map(range => ({
    ...range,
    spoken: spokenInSpan(range, input.plan, input.words),
    context: wordsInWindow(input.words, range.start - 1.2, range.end + 1.2).map(word => word.text).join(' '),
  }));
  const segments: Slot[][] = [];
  for (const slot of slots) {
    const last = segments[segments.length - 1];
    if (last && Math.abs(last[last.length - 1]!.end - slot.start) < 0.011) last.push(slot);
    else segments.push([slot]);
  }
  slots = [];
  for (const segment of segments) {
    if (segment.length === 1) {
      const only = segment[0]!;
      const mid = round((only.start + only.end) / 2);
      segment.splice(0, 1, {...only, end: mid}, {...only, start: mid});
    }
    slots.push(...segment);
  }

  // 2) resolve ONE literal still per slot, in order (unique photos while lookups last, re-use after)
  const maxLookups = input.maxLookups ?? FACELESS_MAX_LOOKUPS;
  const excludeKeys = new Set<string>();
  const shots: FacelessShot[] = [];
  const unfilled: TimeRange[] = [];
  let lookups = 0;
  let misses = 0;
  let reused = 0;
  let fallbackCursor = 0;
  let nounLocked = 0;
  let nounLockRejected = 0;
  let nounLockMisses = 0;
  const useNounLock = input.nounLock !== false;
  /** slots that missed before any photo existed: they show the first photo that does arrive (a longer hold on it, never a gap) */
  const pending: Slot[] = [];
  /** how often each query has been asked: the least-used scene is tried first, so a repeated claim ("money") rotates through its scenes; the resolver's exclude set keeps every photo unique */
  const uses = new Map<string, number>();
  const leastUsed = (queries: readonly string[]) => [...queries].sort((a, b) => (uses.get(a) ?? 0) - (uses.get(b) ?? 0));
  for (const slot of slots) {
    // literal: a visible scene of the words spoken in THIS shot; else the scene of the words around it; else neutral documentary b-roll
    // WP37: noun-lock first. The head noun / number of THIS shot's words ("six billion" -> dollar bills, never a dinner table) leads the queries, a scene query that drifts into a banned domain is dropped, and a
    // scene-less shot may still lock on the noun of the words around it. The profile also judges every candidate photo (alt / tags / slug), and neutral fallbacks stay clear of the banned domain.
    const ownProfile: NounLockProfile | null = useNounLock ? buildNounLockProfile(slot.spoken, {context: slot.context}) : null;
    const neighbourProfile: NounLockProfile | null = useNounLock && !ownProfile?.locked ? buildNounLockProfile(slot.context) : null;
    const profile = ownProfile?.locked ? ownProfile : neighbourProfile?.locked ? neighbourProfile : ownProfile;
    const locked = Boolean(profile?.locked);
    if (locked) nounLocked += 1;
    const claimedBase = editorialStillQueries(slot.spoken, {sceneRulesOnly: true});
    const claimed = leastUsed(ownProfile ? nounLockQueries(ownProfile, claimedBase) : claimedBase);
    const neighbourBase = editorialStillQueries(slot.context, {sceneRulesOnly: true}).filter(query => !claimed.includes(query));
    const neighbours = leastUsed(neighbourProfile?.locked ? nounLockQueries(neighbourProfile, neighbourBase) : ownProfile ? nounLockQueries(ownProfile, neighbourBase) : neighbourBase).filter(query => !claimed.includes(query));
    const fallbackPool = profile ? nounLockFallbacks(profile, EDITORIAL_FALLBACK_SCENES) : EDITORIAL_FALLBACK_SCENES;
    const fallbacks = Array.from({length: EDITORIAL_FALLBACK_SCENES.length}, (_, step) => EDITORIAL_FALLBACK_SCENES[(fallbackCursor + step) % EDITORIAL_FALLBACK_SCENES.length]!).filter(query => fallbackPool.includes(query));
    const attempts = [
      ...claimed.slice(0, 2).map(query => ({query, fallbackScene: false, profile: ownProfile})),
      ...neighbours.slice(0, 1).map(query => ({query, fallbackScene: false, profile: neighbourProfile?.locked ? neighbourProfile : ownProfile})),
      ...fallbacks.slice(0, 2).map(query => ({query, fallbackScene: true, profile})),
    ];
    let shot: FacelessShot | null = null;
    for (const attempt of attempts) {
      if (lookups >= maxLookups) break;
      const outcome = await resolveNounLocked({
        resolver: input.resolver,
        query: attempt.query,
        excludeKeys,
        profile: attempt.profile,
        bannedOnly: attempt.fallbackScene,
        canLookup: () => lookups < maxLookups,
      });
      lookups += outcome.lookups;
      nounLockRejected += outcome.rejected;
      const photo = outcome.photo;
      if (!photo || !isPhotoUrl(photo.assetUrl)) continue;
      const key = `${photo.provider}:${photo.providerId}`;
      if (excludeKeys.has(key)) continue;
      excludeKeys.add(key);
      uses.set(attempt.query, (uses.get(attempt.query) ?? 0) + 1);
      if (attempt.fallbackScene) fallbackCursor = (EDITORIAL_FALLBACK_SCENES.indexOf(attempt.query) + 1) % EDITORIAL_FALLBACK_SCENES.length;
      shot = {start: slot.start, end: slot.end, src: photo.assetUrl, spoken: slot.spoken, query: attempt.query, provider: photo.provider, providerId: photo.providerId, fallbackScene: attempt.fallbackScene, reused: false, framed: false};
      break;
    }
    if (locked && (!shot || shot.fallbackScene)) nounLockMisses += 1;
    if (!shot) {
      misses += 1;
      // never a gap while a photo exists: show an earlier one again (not within the cooldown, not the neighbour)
      const recent = new Set(shots.slice(-FACELESS_REUSE_COOLDOWN).map(item => item.src));
      const pool = shots.filter(item => !recent.has(item.src));
      const pick = pool.length > 0 ? pool[(shots.length * 7) % pool.length]! : shots.length > 0 ? shots[shots.length - 1]! : null;
      if (pick) {
        reused += 1;
        shot = {...pick, start: slot.start, end: slot.end, spoken: slot.spoken, reused: true, framed: false};
      } else {
        pending.push(slot);
        continue;
      }
    }
    if (pending.length > 0 && !shot.reused) {
      for (const lead of pending.splice(0)) {
        reused += 1;
        shots.push({...shot, start: lead.start, end: lead.end, spoken: lead.spoken, reused: true, framed: false});
      }
    }
    shots.push(shot);
  }
  for (const lead of pending) unfilled.push({start: lead.start, end: lead.end}); // no photo at all: a reported gap, not a fabricated still

  // 3) framing: ~15 % of the shots are framed cards (never < 0.6 s, never the last still of a run so the fly-out has a next shot), the rest full-bleed push-in
  const framedShare = Math.min(0.4, Math.max(0, input.framedShare ?? FACELESS_FRAMED_SHARE));
  const runShots: FacelessShot[][] = [];
  {
    let current: FacelessShot[] = [];
    const flush = () => {
      if (current.length === 0) return;
      let from = 0;
      for (const size of chunkSizes(current.length)) {
        runShots.push(current.slice(from, from + size));
        from += size;
      }
      current = [];
    };
    for (const shot of shots) {
      const last = current[current.length - 1];
      if (last && Math.abs(last.end - shot.start) > 0.011) flush();
      current.push(shot);
    }
    flush();
  }
  // the library contract wants 2-6 stills a run: a lone still (a miss split a segment) cannot be published, so its time is a gap the warnings report
  for (let index = runShots.length - 1; index >= 0; index -= 1) {
    if (runShots[index]!.length >= FACELESS_MIN_RUN_ITEMS) continue;
    for (const lone of runShots[index]!) {
      unfilled.push({start: lone.start, end: lone.end});
      shots.splice(shots.indexOf(lone), 1);
    }
    runShots.splice(index, 1);
  }
  const spacing = Math.max(2, Math.round(1 / Math.max(framedShare, 0.01)));
  let sinceFramed = spacing - 2; // the first framed card lands after the opening beats, not on the very first cut
  for (const run of runShots) {
    run.forEach((shot, index) => {
      if (framedShare <= 0) return;
      sinceFramed += 1;
      const eligible = index > 0 && index < run.length - 1 && shot.end - shot.start >= FACELESS_FRAMED_MIN_SHOT_SEC && !run[index - 1]!.framed;
      if (eligible && sinceFramed >= spacing) {
        shot.framed = true;
        sinceFramed = 0;
      }
    });
  }
  // WP39: full-bleed stills get a push-in speed from their context (framed cards have no Ken Burns)
  for (const shot of shots) {
    if (shot.framed) delete shot.motionSpeed;
    else shot.motionSpeed = facelessMotionSpeed(shot, {holds: input.plan.holds, chapterCards: input.plan.chapterCards, fallback: input.defaultMotionSpeed});
  }
  // recipes: framed cards rotate the editorial entrances; full-bleed stills own their push-in
  let runIndex = 0;
  for (const run of runShots) {
    run.forEach((shot, index) => {
      if (shot.framed) shot.recipeId = editorialRecipeAt(runIndex, index);
    });
    runIndex += 1;
  }

  const runs: ImageRunPlan[] = runShots.map((run, index) => {
    const plan: ImageRunPlan = {
      start: round(run[0]!.start),
      end: round(run[run.length - 1]!.end),
      mode: 'sequence',
      items: run.map(shot => ({src: shot.src, label: shot.query, ...(shot.recipeId ? {recipeId: shot.recipeId} : {}), ...(shot.motionSpeed ? {motionSpeed: shot.motionSpeed} : {})})),
      slotIds: run.map((_, itemIndex) => `faceless_still_${index + 1}_${itemIndex + 1}`),
      cutAts: [],
      fit: 'cover',
      backdrop: EDITORIAL_BACKDROP,
      holdsSec: run.map(shot => round(shot.end - shot.start)),
      framedItems: run.map(shot => shot.framed),
    };
    plan.cutAts = runCutTimes(plan);
    return plan;
  });

  // 4) measure
  const photoRanges = shots.map(shot => ({start: shot.start, end: shot.end}));
  const photoSec = unionSeconds(photoRanges, duration);
  const mediaSec = unionSeconds([...photoRanges, ...blocked], duration);
  const stats: FacelessDocStats = {
    durationSec: round(duration),
    shotCount: shots.length,
    meanShotSec: shots.length > 0 ? round(photoSec / shots.length) : 0,
    photoCoverage: round(photoSec / duration),
    mediaCoverage: round(mediaSec / duration),
    maxGapSec: longestGap([...photoRanges, ...blocked], duration),
    lookups,
    misses,
    reused,
    fallbackShots: shots.filter(shot => shot.fallbackScene).length,
    framedShots: shots.filter(shot => shot.framed).length,
    runs: runs.length,
    motionSpeeds: {
      slow: shots.filter(shot => shot.motionSpeed === 'slow').length,
      normal: shots.filter(shot => shot.motionSpeed === 'normal').length,
      fast: shots.filter(shot => shot.motionSpeed === 'fast').length,
    },
    nounLocked,
    nounLockRejected,
    nounLockMisses,
  };
  const warnings = [`polish_pace:faceless_coverage:${(stats.mediaCoverage * 100).toFixed(1)}`, `polish_assets:faceless_shots:${stats.shotCount}`];
  if (stats.mediaCoverage < FACELESS_COVERAGE_TARGET) warnings.push(`polish_pace:faceless_coverage_low:${(stats.mediaCoverage * 100).toFixed(1)}`);
  if (stats.maxGapSec > FACELESS_MAX_GAP_SEC) warnings.push(`polish_pace:faceless_gap:${stats.maxGapSec.toFixed(2)}`);
  if (misses > 0) warnings.push(`polish_assets:faceless_misses:${misses}`);
  if (reused > 0) warnings.push(`polish_assets:faceless_reused:${reused}`);
  if (stats.framedShots > 0) warnings.push(`polish_assets:faceless_framed:${stats.framedShots}`);
  warnings.push(`polish_pace:faceless_motion:slow=${stats.motionSpeeds.slow},normal=${stats.motionSpeeds.normal},fast=${stats.motionSpeeds.fast}`);
  warnings.push(...nounLockWarnings({locked: nounLocked, rejected: nounLockRejected, misses: nounLockMisses}));
  return {runs, shots, unfilled, stats, warnings};
}

/** True when a run came from this lane (slot ids `faceless_still_*`). */
export const isFacelessRun = (run: Pick<ImageRunPlan, 'slotIds'>): boolean => run.slotIds.length > 0 && run.slotIds.every(id => id.startsWith('faceless_still_'));

