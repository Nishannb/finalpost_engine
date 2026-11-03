/**
 * WP30: EDITORIAL STILL MONTAGE. The Metromedia-class open stays alive by RUNNING real photos with slight motion (push-in, tilt, drift) and a media swap every ~1.2-2.5 s, not by karaoke chrome, flat color worlds
 * or web steppers. This planner turns uncovered polish windows (the first ~22 s first, then a few mid claim beats) into `ImageRunPlan`s (`mode: 'sequence'`) of 3-6 stock photos that SHOW what is being said.
 *
 * PURE + ASYNC-INJECTED: no env, no logger, no network. The photo resolver is injected (production: `findPhotoAsset` from `stockSearch.ts`, i.e. Pexels / Pixabay; tests: a fake). The output is the same `ImageRunPlan` the
 * labeled-asset path produces, so it is published by `publishImageRuns` and the WP16 transition density anchors on the run boundaries unchanged.
 *
 * Craft rules (editref.md):
 *  - queries are 2-4 word VISIBLE scenes ("hands scrolling phone"), never abstract words ("success") and never emoji / affect icons ("love", "heart"); a claim with no visible scene falls back to neutral editorial b-roll
 *  - every item names its own recipe: `still_push_in` / `card_tilt_in` / `orbit_drift`, rotated so neighbours differ; each still holds 1.2-2.5 s
 *  - WP29: a solid / flat-fill URL is never scheduled; only https photo URLs are accepted
 *  - soft caps: at most 2 open runs + 2 mid runs, and a bounded share of the video, so the edit is not wallpapered
 */
import {isLiteralEmojiQuery, wordsInWindow, contentTokens, type CaptionWordLike} from './klipyContextQuery.ts';
import {runCutTimes, type ImageRunPlan, type TimeRange} from './labeledAssetPlacement.ts';
import {hasNonLatinScript} from './englishSearch.ts';
import {isSolidFixtureUrl} from './solidStill.ts';
import {isGenericStockWord} from './visualQuery.ts';
import {buildNounLockProfile, nounLockFallbacks, nounLockQueries, nounLockWarnings, resolveNounLocked, type NounLockProfile, type StockCandidateMeta} from './nounLock.ts';

/** What the injected resolver returns (a subset of `StockAsset`). WP37: optional `alt` / `tags` / `title` / `pageUrl` let the noun-lock judge whether the photo depicts the spoken noun. */
export type EditorialPhoto = {assetUrl: string; provider: string; providerId: number} & Omit<StockCandidateMeta, 'assetUrl'>;
export type EditorialPhotoResolver = (query: string, options: {excludeKeys: Set<string>}) => Promise<EditorialPhoto | null>;

export const EDITORIAL_RECIPES = ['still_push_in', 'card_tilt_in', 'orbit_drift'] as const;
/** WP32: editorial runs own the frame, so the photo is the world (blurred self-bleed behind the framed still), not a framed card on a dim veil over the talking head. */
export const EDITORIAL_BACKDROP = 'blur_self' as const;
export const EDITORIAL_HOLD_MIN_SEC = 1.2;
export const EDITORIAL_HOLD_MAX_SEC = 2.5;
export const EDITORIAL_HOLD_TARGET_SEC = 1.8;
export const EDITORIAL_MIN_ITEMS = 3;
export const EDITORIAL_MAX_ITEMS = 6;
/** The open: the window polish prioritises. */
export const EDITORIAL_OPEN_SEC = 22;
export const EDITORIAL_MAX_OPEN_RUNS = 2;
export const EDITORIAL_MAX_MID_RUNS = 2;
/** Minimum spacing between two mid runs (seconds). */
export const EDITORIAL_MID_SPACING_SEC = 14;
/** Talking-head breathing room kept between two runs / a run and a blocked beat. */
export const EDITORIAL_GAP_SEC = 1.2;
/** A run never exceeds this long. */
export const EDITORIAL_MAX_RUN_SEC = 9;
/** The open counts as "filled" (no editorial open runs) once other beats own at least this share of it. */
export const EDITORIAL_OPEN_FILLED_FRAC = 0.7;
/** Hard cap on provider lookups per edit (each lookup may hit one or two libraries). */
export const EDITORIAL_MAX_LOOKUPS = 28;

const round = (value: number) => Math.round(value * 1000) / 1000;

/** Words that name a feeling / idea, not a thing the camera can see. They never form a query on their own. */
const ABSTRACT_WORDS = new Set(
  'success successful succeed happy happiness joy sad motivation motivated motivational inspire inspired inspiration inspiring dream dreams dreaming mindset growth hustle journey goal goals vibe vibes energy amazing awesome incredible powerful best better great good bad real truth secret secrets simple easy hard important thing things stuff something everything anything nothing people someone anyone everyone idea ideas thumb thumbs smile smiles smiley emoji emojis kiss hug hugs clap claps clapping heart hearts love loved'.split(
    ' ',
  ),
);

/** A visible scene for a claim. First matching rule wins; the scene is already 2-4 words. */
const SCENE_RULES: ReadonlyArray<{re: RegExp; scenes: readonly string[]}> = [
  {re: /\b(money|revenue|cash|profit|dollars?|income|salary|paid|price|billion|million|fund(?:ing|ed)?|invest(?:or|ors|ment|ed)?)\b/i, scenes: ['counting cash hands', 'stock market screen', 'bank notes table']},
  {re: /\b(startup|company|business|founder|ceo|entrepreneur|brand|launch(?:ed)?)\b/i, scenes: ['startup office team', 'founder laptop desk', 'office window skyline']},
  {re: /\b(phone|app|apps|social|instagram|tiktok|scroll(?:ing)?|notification|feed|post|posts)\b/i, scenes: ['hands scrolling phone', 'phone screen night', 'person texting street']},
  {re: /\b(laptop|code|coding|software|website|computer|screen|ai|tech|data)\b/i, scenes: ['typing laptop desk', 'code monitor dark', 'server room lights']},
  {re: /\b(team|meeting|hire[ds]?|hiring|employees?|staff|coworkers?|colleagues?)\b/i, scenes: ['team meeting table', 'office whiteboard discussion', 'coworkers laptop table']},
  {re: /\b(write|wrote|writing|email|emails|newsletter|article|news|headline|press|story|book)\b/i, scenes: ['newspaper headline closeup', 'writing notebook desk', 'typewriter paper closeup']},
  {re: /\b(city|street|downtown|traffic|crowd|commute)\b/i, scenes: ['city street crowd', 'crosswalk rush hour', 'subway platform commuters']},
  {re: /\b(travel|trip|flight|airport|plane|passport|abroad)\b/i, scenes: ['airport terminal walking', 'passport stamps closeup', 'airplane window clouds']},
  {re: /\b(food|coffee|cafe|restaurant|cook(?:ing)?|kitchen|eat|dinner|lunch)\b/i, scenes: ['coffee pour cafe', 'busy restaurant kitchen', 'chef plating food']},
  {re: /\b(gym|workout|fitness|run(?:ning)?|train(?:ing)?|exercise|sport|sports)\b/i, scenes: ['gym weight training', 'sunrise outdoor running', 'athlete tying shoes']},
  {re: /\b(school|student|students|learn(?:ing)?|class|teacher|study|college|university)\b/i, scenes: ['students classroom desks', 'library books shelves', 'lecture hall audience']},
  {re: /\b(stage|speech|speaker|audience|conference|podcast|interview|mic)\b/i, scenes: ['speaker stage lights', 'podcast microphone studio', 'conference audience applause']},
  {re: /\b(fail(?:ed|ure)?|lost|broke|broken|crash(?:ed)?|fired|layoff|layoffs|collapse[ds]?)\b/i, scenes: ['empty office desk', 'cardboard box desk', 'rain window night']},
  {re: /\b(win|won|winning|champion|trophy|record|celebrat(?:e|ed|ion))\b/i, scenes: ['team celebrating office', 'sunrise city rooftop', 'crowd cheering stadium']},
  {re: /\b(home|house|family|kids?|parents?|mother|father)\b/i, scenes: ['family dinner table', 'kitchen morning light', 'living room window']},
  // WP36: documentary nouns the faceless lane needs (appended last, so every earlier rule keeps its priority)
  {re: /\b(markets?|stocks?|shares?|trading|traders?)\b/i, scenes: ['stock market screen', 'trading floor traders', 'financial charts monitor']},
  {re: /\b(cheer(?:ed|ing|s)?|applaud(?:ed|ing)?|genius|praise[ds]?|celebrated)\b/i, scenes: ['crowd cheering stadium', 'conference audience applause']},
  {re: /\b(headlines?|newspapers?|press|reporters?|media)\b/i, scenes: ['newspaper headline closeup', 'press conference reporters']},
  {re: /\b(numbers?|figures?|charts?|graphs?)\b/i, scenes: ['financial charts monitor', 'spreadsheet numbers closeup']},
  {re: /\b(desk|office|cubicle|workplace)\b/i, scenes: ['empty office desk', 'office window skyline']},
  {re: /\b(years?|decades?|ago|later|19\d\d|20\d\d)\b/i, scenes: ['wall clock closeup', 'old photographs table']},
  {re: /\b(morning|sunrise|dawn|cold|winter|night|rain)\b/i, scenes: ['rain window night', 'coffee shop window']},
];

/** Neutral editorial b-roll used only when a claim has no visible scene. Documentary, desaturated, no abstract concept. */
export const EDITORIAL_FALLBACK_SCENES: readonly string[] = [
  'city street crowd',
  'typing laptop desk',
  'office window skyline',
  'hands writing notebook',
  'newspaper headline closeup',
  'subway platform commuters',
  'coffee shop window',
  'conference audience applause',
];

const EMOJI = /[\p{Extended_Pictographic}\u200d\ufe0f]/u;
const MAX_QUERY_WORDS = 4;
const QUERY_FILLER = new Set(['a', 'an', 'and', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);

/**
 * Final gate for a search query: 2-4 lowercase latin words, a visible scene, never an emoji / affect icon / abstract concept.
 * Returns '' when the query cannot be made safe (the caller then tries the next candidate).
 */
export function finalizeEditorialQuery(raw: string): string {
  if (!raw || EMOJI.test(raw) || hasNonLatinScript(raw)) return '';
  if (isLiteralEmojiQuery(raw)) return '';
  const words = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word && !QUERY_FILLER.has(word))
    .slice(0, MAX_QUERY_WORDS);
  if (words.length < 2) return '';
  if (words.some(word => ABSTRACT_WORDS.has(word) || isLiteralEmojiQuery(word))) return '';
  return words.join(' ');
}

/**
 * Ordered candidate queries for a spoken span: scene rules first (a visible picture of the claim), then up to three concrete content words. Empty when the span has nothing visible; the caller falls back to neutral
 * editorial scenes. Pure.
 */
export function editorialStillQueries(spoken: string, options: {sceneRulesOnly?: boolean} = {}): string[] {
  const text = spoken.replace(/\s+/g, ' ').trim();
  if (text.length < 4 || hasNonLatinScript(text)) return [];
  const out: string[] = [];
  const push = (raw: string) => {
    const query = finalizeEditorialQuery(raw);
    if (query && !out.includes(query)) out.push(query);
  };
  for (const rule of SCENE_RULES) {
    if (rule.re.test(text)) for (const scene of rule.scenes) push(scene);
  }
  if (options.sceneRulesOnly) return out; // WP36: the faceless lane takes only a VISIBLE scene (a rule hit); an adjective or an abstract noun is not a picture ("tiny" -> a hummingbird)
  const concrete = contentTokens(text).filter(token => !isLiteralEmojiQuery(token) && !ABSTRACT_WORDS.has(token) && !isGenericStockWord(token) && token.length >= 4 && !/\d/.test(token) && /^[a-z]+$/.test(token));
  if (concrete.length >= 2) push(concrete.slice(0, 3).join(' '));
  else if (concrete.length === 1) push(`${concrete[0]} documentary photo`);
  return out;
}

export type EditorialStillItem = {src: string; label: string; recipeId: string; provider: string; providerId: number; query: string; fallbackScene: boolean};

export type EditorialStillMontage = {
  runs: ImageRunPlan[];
  items: EditorialStillItem[];
  stills: number;
  lookups: number;
  /** Items the resolver could not fill (their runs are dropped when they fall below 3 stills). */
  misses: number;
  /** Share of the open already owned by other full-frame beats (0-1). */
  openFilledFrac: number;
  /** Items whose query is neutral editorial b-roll, not a scene from the spoken claim. */
  fallbackItems: number;
  /** WP37: items whose spoken words named a noun to lock (money, markets, a count of people, ...). */
  nounLocked: number;
  /** WP37: candidate photos the relevance judge refused (food for a money line, a photo about nothing the noun names, ...). */
  nounLockRejected: number;
  /** WP37: locked items that ended on neutral b-roll or stayed empty instead of a photo of the noun. */
  nounLockMisses: number;
  warnings: string[];
};

export const editorialWarnings = (montage: Pick<EditorialStillMontage, 'stills' | 'runs' | 'misses'> & Partial<Pick<EditorialStillMontage, 'nounLocked' | 'nounLockRejected' | 'nounLockMisses'>>): string[] => [
  ...(montage.stills > 0 ? [`polish_assets:editorial_stills:${montage.stills}`] : []),
  ...(montage.runs.length > 0 ? [`polish_assets:editorial_runs:${montage.runs.length}`] : []),
  ...(montage.misses > 0 ? [`polish_assets:editorial_misses:${montage.misses}`] : []),
  ...nounLockWarnings({locked: montage.nounLocked ?? 0, rejected: montage.nounLockRejected ?? 0, misses: montage.nounLockMisses ?? 0}),
];

/** Free intervals of [from, to] after removing the (padded) blocked ranges. */
export function freeIntervals(from: number, to: number, blocked: readonly TimeRange[], pad = EDITORIAL_GAP_SEC): TimeRange[] {
  const sorted = blocked
    .filter(range => range.end > from && range.start < to)
    .map(range => ({start: range.start - pad, end: range.end + pad}))
    .sort((a, b) => a.start - b.start);
  const out: TimeRange[] = [];
  let cursor = from;
  for (const range of sorted) {
    if (range.start > cursor) out.push({start: cursor, end: Math.min(to, range.start)});
    cursor = Math.max(cursor, range.end);
  }
  if (cursor < to) out.push({start: cursor, end: to});
  return out.filter(range => range.end - range.start > 0.01).map(range => ({start: round(Math.max(from, range.start)), end: round(range.end)}));
}

/** Share of [from, to] covered by the blocked ranges (unpadded). */
export function coveredFraction(from: number, to: number, blocked: readonly TimeRange[]): number {
  const length = to - from;
  if (length <= 0) return 0;
  const clipped = blocked
    .map(range => ({start: Math.max(from, range.start), end: Math.min(to, range.end)}))
    .filter(range => range.end > range.start)
    .sort((a, b) => a.start - b.start);
  let covered = 0;
  let cursor = from;
  for (const range of clipped) {
    const start = Math.max(range.start, cursor);
    if (range.end > start) covered += range.end - start;
    cursor = Math.max(cursor, range.end);
  }
  return Math.min(1, covered / length);
}

/** Item count and hold for a window of `length` seconds. Holds stay inside 1.2-2.5 s; 3-`maxItems` items. null when the window is too short for three stills. */
export function runShape(length: number, maxItems: number = EDITORIAL_MAX_ITEMS, maxRunSec: number = EDITORIAL_MAX_RUN_SEC): {count: number; hold: number} | null {
  if (length < EDITORIAL_MIN_ITEMS * EDITORIAL_HOLD_MIN_SEC) return null;
  const capped = Math.min(length, Math.max(EDITORIAL_MIN_ITEMS * EDITORIAL_HOLD_MIN_SEC, maxRunSec)); // WP38: maxRunSec (default 9) lets talking-head polish keep each run short
  const count = Math.max(EDITORIAL_MIN_ITEMS, Math.min(maxItems, EDITORIAL_MAX_ITEMS, Math.floor(capped / EDITORIAL_HOLD_TARGET_SEC)));
  const hold = Math.max(EDITORIAL_HOLD_MIN_SEC, Math.min(EDITORIAL_HOLD_MAX_SEC, capped / count));
  if (count * hold > length + 1e-6) return null;
  return {count, hold: round(hold)};
}

/** Recipe for item `index` of a run: rotates the three editorial recipes, offset per run so neighbours differ across runs too. */
export const editorialRecipeAt = (runIndex: number, itemIndex: number): string => EDITORIAL_RECIPES[(runIndex + itemIndex) % EDITORIAL_RECIPES.length]!;

export const isPhotoUrl = (url: string): boolean => /^https:\/\//i.test(url) && !/\.(mp4|mov|webm|m4v|gif)(\?|#|$)/i.test(url) && !isSolidFixtureUrl(url);

type PlannedWindow = {start: number; count: number; hold: number; phase: 'open' | 'mid'};

export type PlanEditorialInput = {
  words: readonly CaptionWordLike[];
  outputDurationSec: number;
  /** Full-frame beats (cutaways, split / full graphics, media containers, labeled image runs). Montage never overlaps them. */
  blockedRanges?: readonly TimeRange[];
  resolver: EditorialPhotoResolver;
  openSec?: number;
  maxOpenRuns?: number;
  maxMidRuns?: number;
  maxLookups?: number;
  /** WP38: tighter caps for classic talking-head polish (the face stays primary). Absent = the WP30 caps, exactly as before. */
  maxOpenItems?: number;
  maxMidItems?: number;
  /** WP38: longest single run in seconds (WP30 default 9). */
  maxRunSec?: number;
  /** WP38: hard ceiling on the total still seconds of the montage (WP30 default: max(0.7 x open, 30 % of the runtime)). */
  maxTotalSec?: number;
  /** WP37: noun-lock the queries and judge the candidates (default on; a line with no noun to lock is untouched). */
  nounLock?: boolean;
};

/** Sentence-start times (a word after a pause) at or after `from`: the claim beats mid runs anchor on. */
function claimAnchors(words: readonly CaptionWordLike[], from: number): number[] {
  const out: number[] = [];
  words.forEach((word, index) => {
    if (word.start < from) return;
    const previous = words[index - 1];
    if (!previous || word.start - previous.end >= 0.45) out.push(round(word.start));
  });
  return out;
}

export async function planEditorialStillMontage(input: PlanEditorialInput): Promise<EditorialStillMontage> {
  const duration = input.outputDurationSec;
  const blocked = [...(input.blockedRanges ?? [])];
  const openEnd = Math.min(duration, input.openSec ?? EDITORIAL_OPEN_SEC);
  const empty = (openFilledFrac: number): EditorialStillMontage => ({runs: [], items: [], stills: 0, lookups: 0, misses: 0, openFilledFrac, fallbackItems: 0, nounLocked: 0, nounLockRejected: 0, nounLockMisses: 0, warnings: []});
  if (!Number.isFinite(duration) || duration < EDITORIAL_MIN_ITEMS * EDITORIAL_HOLD_MIN_SEC + 1) return empty(0);

  const openFilledFrac = round(coveredFraction(0, openEnd, blocked));
  const windows: PlannedWindow[] = [];
  const taken: TimeRange[] = [];
  const maxTotalSec = input.maxTotalSec !== undefined ? Math.max(0, input.maxTotalSec) : Math.max(openEnd * 0.7, duration * 0.3);
  let totalSec = 0;
  const claim = (window: PlannedWindow) => {
    const range = {start: window.start, end: round(window.start + window.count * window.hold)};
    windows.push(window);
    taken.push(range);
    totalSec += range.end - range.start;
  };
  const free = (from: number, to: number) => freeIntervals(from, to, [...blocked, ...taken]);

  // OPEN: fill the open's uncovered stretches first, unless other beats already own most of it.
  if (openFilledFrac < EDITORIAL_OPEN_FILLED_FRAC) {
    const maxOpen = input.maxOpenRuns ?? EDITORIAL_MAX_OPEN_RUNS;
    for (let guard = 0; guard < 8 && windows.filter(w => w.phase === 'open').length < maxOpen; guard += 1) {
      const interval = free(0, openEnd).find(range => runShape(range.end - range.start) !== null);
      if (!interval) break;
      const shape = runShape(Math.min(interval.end - interval.start, maxTotalSec - totalSec), input.maxOpenItems, input.maxRunSec);
      if (!shape) break;
      claim({start: interval.start, ...shape, phase: 'open'});
    }
  }

  // MID: a few claim beats after the open, spaced out, shorter runs (3-4 stills).
  const maxMid = input.maxMidRuns ?? EDITORIAL_MAX_MID_RUNS;
  const midStarts: number[] = [];
  for (const anchor of claimAnchors(input.words, openEnd + 2)) {
    if (midStarts.length >= maxMid) break;
    if (midStarts.some(existing => Math.abs(existing - anchor) < EDITORIAL_MID_SPACING_SEC)) continue;
    if (windows.some(window => window.phase === 'open' && anchor - (window.start + window.count * window.hold) < EDITORIAL_MID_SPACING_SEC / 2 && anchor >= window.start)) continue;
    const interval = free(anchor, Math.min(duration, anchor + EDITORIAL_MAX_RUN_SEC)).find(range => range.start - anchor <= 2 && runShape(range.end - range.start, input.maxMidItems ?? 4, input.maxRunSec) !== null);
    if (!interval) continue;
    const shape = runShape(Math.min(interval.end - interval.start, maxTotalSec - totalSec), input.maxMidItems ?? 4, input.maxRunSec);
    if (!shape) continue;
    claim({start: interval.start, ...shape, phase: 'mid'});
    midStarts.push(anchor);
  }
  windows.sort((a, b) => a.start - b.start);

  // RESOLVE: sequential so the exclude set keeps every still unique, bounded by the lookup cap.
  const maxLookups = input.maxLookups ?? EDITORIAL_MAX_LOOKUPS;
  const excludeKeys = new Set<string>();
  const usedQueries = new Set<string>();
  const runs: ImageRunPlan[] = [];
  const allItems: EditorialStillItem[] = [];
  let lookups = 0;
  let misses = 0;
  let fallbackCursor = 0;
  let nounLocked = 0;
  let nounLockRejected = 0;
  let nounLockMisses = 0;
  const useNounLock = input.nounLock !== false;

  for (const window of windows) {
    const runIndex = runs.length;
    const items: EditorialStillItem[] = [];
    const runStart = window.start;
    for (let index = 0; index < window.count; index += 1) {
      const itemStart = runStart + index * window.hold;
      const spoken = wordsInWindow(input.words, itemStart - 0.4, itemStart + window.hold + 0.4).map(word => word.text).join(' ');
      // WP37: lock the head noun / number of the spoken words: noun-locked queries first, drifting scene queries dropped, neutral fallbacks kept clear of the banned domain
      const profile: NounLockProfile | null = useNounLock ? buildNounLockProfile(spoken) : null;
      const locked = Boolean(profile?.locked);
      if (locked) nounLocked += 1;
      const claimedBase = editorialStillQueries(spoken);
      const claimed = (profile ? nounLockQueries(profile, claimedBase) : claimedBase).filter(query => !usedQueries.has(query));
      const fallbackPool = profile ? nounLockFallbacks(profile, EDITORIAL_FALLBACK_SCENES) : EDITORIAL_FALLBACK_SCENES;
      const fallbacks = Array.from({length: EDITORIAL_FALLBACK_SCENES.length}, (_, step) => EDITORIAL_FALLBACK_SCENES[(fallbackCursor + step) % EDITORIAL_FALLBACK_SCENES.length]!).filter(query => fallbackPool.includes(query) && !usedQueries.has(query));
      const attempts = [...claimed.slice(0, 2).map(query => ({query, fallbackScene: false})), ...fallbacks.slice(0, 2).map(query => ({query, fallbackScene: true}))];
      let resolved: EditorialStillItem | null = null;
      for (const attempt of attempts) {
        if (lookups >= maxLookups) break;
        const outcome = await resolveNounLocked({
          resolver: input.resolver,
          query: attempt.query,
          excludeKeys,
          profile,
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
        usedQueries.add(attempt.query);
        if (attempt.fallbackScene) fallbackCursor = (EDITORIAL_FALLBACK_SCENES.indexOf(attempt.query) + 1) % EDITORIAL_FALLBACK_SCENES.length;
        resolved = {src: photo.assetUrl, label: attempt.query, recipeId: editorialRecipeAt(runIndex, index), provider: photo.provider, providerId: photo.providerId, query: attempt.query, fallbackScene: attempt.fallbackScene};
        break;
      }
      if (resolved) items.push(resolved);
      else misses += 1;
      if (locked && (!resolved || resolved.fallbackScene)) nounLockMisses += 1;
    }
    if (items.length < EDITORIAL_MIN_ITEMS) continue; // a run below three stills is a slideshow, not a montage
    // re-pack the recipes so a dropped item never leaves two neighbours with the same entrance
    const packed = items.map((item, index) => ({...item, recipeId: editorialRecipeAt(runIndex, index)}));
    const end = round(runStart + packed.length * window.hold);
    const run: ImageRunPlan = {
      start: round(runStart),
      end: Math.min(round(duration), end),
      mode: 'sequence',
      items: packed.map(item => ({src: item.src, label: item.label, recipeId: item.recipeId})),
      slotIds: packed.map((_, index) => `editorial_still_${runIndex + 1}_${index + 1}`),
      cutAts: [],
      fit: 'cover',
      backdrop: EDITORIAL_BACKDROP,
      framed: true,
    };
    run.cutAts = runCutTimes(run);
    runs.push(run);
    allItems.push(...packed);
  }

  const result: EditorialStillMontage = {runs, items: allItems, stills: allItems.length, lookups, misses, openFilledFrac, fallbackItems: allItems.filter(item => item.fallbackScene).length, nounLocked, nounLockRejected, nounLockMisses, warnings: []};
  result.warnings = editorialWarnings(result);
  return result;
}

/** True when the run plan came from this planner (the slot ids are `editorial_still_*`). */
export const isEditorialRun = (run: Pick<ImageRunPlan, 'slotIds'>): boolean => run.slotIds.every(id => id.startsWith('editorial_still_'));

/** Output-time ranges the runs occupy (for blocked-range bookkeeping and WP16 anchors). */
export const editorialRunRanges = (runs: readonly Pick<ImageRunPlan, 'start' | 'end'>[]): TimeRange[] => runs.map(run => ({start: run.start, end: run.end}));
