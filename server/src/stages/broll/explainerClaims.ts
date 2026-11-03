/**
 * WP41: CLAIM -> VISUAL planner for Explainer Skill B (`explainer-grammar.yaml` `broll_rules`: "show visual within 0.5s of spoken number/name/claim"). PURE: words + the WP40 pacing segments in, a list of
 * claims, the b-roll beats that cover the uncovered ones, the per-claim coverage and the layout track (what the captions use for their y) out. No env, no I/O, no model, no randomness.
 *
 *   claims    money / numbers / percents / magnitudes ($1.4 trillion, 2024, 40%, a million) and proper names (Stripe, Elon Musk, AI); sentence-start words only count as a name when the next word is also one
 *   visual    a segment on layout B (b-roll top), C (diagram) or D (cutaway), or a scheduled BEAT, that is on screen no later than `CLAIM_VISUAL_MAX_DELAY_SEC` (0.5 s) after the claim is spoken
 *   beat      a claim spoken over a plain talking head (layout A) gets a short article / screenshot beat: layout B (the screenshot on top, the speaker below) from `claim - 0.15 s`, 2.6 s long, never
 *             overlapping another beat, never leaving its talking-head segment. The key phrase of the beat gets the lime L->R wipe (`highlight`)
 */
import type {ExplainerLayoutId, ExplainerSegment, ExplainerWord} from './explainerPacing.ts';
import {editorialStillQueries} from './editorialStillMontage.ts';
import {buildNounLockProfile, nounLockQueries, type NounLockProfile} from './nounLock.ts';

/** Grammar: a visual within 0.5 s of the spoken number / name / claim. */
export const CLAIM_VISUAL_MAX_DELAY_SEC = 0.5;
/** A scheduled beat appears this long BEFORE the claim's first word (the eye needs the image as the word lands). */
/** WP49: claim plate / layout-B visual leads the spoken claim (was 0.15; bumped so VO and visual land together). */
export const CLAIM_BEAT_LEAD_SEC = 0.35;
export const CLAIM_BEAT_SEC = 2.6;
/** Shorter than this a beat reads as a flash (b-roll segs are 2-4 s in the grammar): the claim is reported unmet instead. */
export const CLAIM_BEAT_MIN_SEC = 1.5;
/** Layouts that already carry a visual (everything but the plain talking head). */
export const VISUAL_LAYOUTS: readonly ExplainerLayoutId[] = ['explainer_b', 'explainer_c', 'explainer_d'];

export type ClaimKind = 'money' | 'percent' | 'number' | 'name';
export type Claim = {kind: ClaimKind; text: string; start: number; end: number; firstWord: number; lastWord: number};

const round3 = (value: number) => Math.round(value * 1000) / 1000;
const strip = (text: string) => text.trim().replace(/^["'(\[]+|["')\]]+$/g, '');
const bare = (text: string) => strip(text).replace(/[.,!?;:]+$/g, '');
const endsSentence = (text: string) => /[.!?]["')\]]*$/.test(text.trim());
const endsClause = (text: string) => /[.!?;:,]["')\]]*$/.test(text.trim());

const MAGNITUDE = /^(hundred|thousand|million|billion|trillion|k|m|bn)$/i;
const SMALL_NUMBER_WORD = /^(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)$/i;
const NOT_A_NAME = new Set(['i', "i'm", "i'll", "i've", "i'd", 'a', 'the', 'and', 'but', 'so', 'if', 'it', 'we', 'you', 'they', 'he', 'she', 'this', 'that']);
const isCapitalised = (word: string) => /^[\p{Lu}]/u.test(word) && !NOT_A_NAME.has(word.toLowerCase());
const isAcronym = (word: string) => word.length >= 2 && word.length <= 6 && word === word.toUpperCase() && /^\p{Lu}+$/u.test(word);

/** Find the spoken numbers / amounts / percents / proper names (in order, non-overlapping). `names` are always claims (case-insensitive), e.g. entities from the brief. */
export function detectClaims(words: readonly ExplainerWord[], options: {names?: readonly string[]} = {}): Claim[] {
  const known = new Set((options.names ?? []).map(name => name.toLowerCase()));
  const claims: Claim[] = [];
  const used = new Set<number>();
  const push = (kind: ClaimKind, first: number, last: number) => {
    for (let index = first; index <= last; index += 1) used.add(index);
    claims.push({
      kind,
      text: words
        .slice(first, last + 1)
        .map(word => bare(word.text))
        .join(' '),
      start: round3(words[first]!.start),
      end: round3(words[last]!.end),
      firstWord: first,
      lastWord: last,
    });
  };
  for (let index = 0; index < words.length; index += 1) {
    if (used.has(index)) continue;
    const token = bare(words[index]!.text);
    const next = words[index + 1] ? bare(words[index + 1]!.text) : '';
    const prevEnds = index === 0 || endsSentence(words[index - 1]!.text);
    // money: $1.4 / €20 / £5, with an optional magnitude word ($1.4 trillion, $20 k)
    if (/^[$€£]\s?\d/.test(token)) {
      push('money', index, MAGNITUDE.test(next) && !endsClause(words[index]!.text) ? index + 1 : index);
      continue;
    }
    // percent: 40% / 40 percent
    if (/^\d[\d.,]*%$/.test(token)) {
      push('percent', index, index);
      continue;
    }
    if (/^\d[\d.,]*$/.test(token) && /^percent$/i.test(next)) {
      push('percent', index, index + 1);
      continue;
    }
    // digits: 2024, 10x, 3.5 (+ a magnitude word)
    if (/\d/.test(token)) {
      push('number', index, MAGNITUDE.test(next) && !endsClause(words[index]!.text) ? index + 1 : index);
      continue;
    }
    // spelled magnitudes: "a million", "twenty thousand" (a magnitude word alone is a claim; one small number word before it is absorbed)
    if (MAGNITUDE.test(token) && token.length > 2) {
      const prev = index > 0 && !used.has(index - 1) && !endsClause(words[index - 1]!.text) ? bare(words[index - 1]!.text) : '';
      const first = SMALL_NUMBER_WORD.test(prev) ? index - 1 : index;
      push('number', first, index);
      continue;
    }
    // proper names: capitalised words mid-sentence (consecutive ones merge unless a comma / period separates them), a sentence-start word only when the next word is capitalised too, all-caps acronyms
    const nextWord = words[index + 1];
    const nextCap = nextWord ? isCapitalised(bare(nextWord.text)) && !endsSentence(words[index]!.text) : false;
    const knownHit = known.has(token.toLowerCase());
    const proper = knownHit || isAcronym(token) || (isCapitalised(token) && /\p{L}/u.test(token) && (!prevEnds || nextCap));
    if (proper) {
      let last = index;
      while (last + 1 < words.length && !endsClause(words[last]!.text) && isCapitalised(bare(words[last + 1]!.text)) && !used.has(last + 1) && !/\d/.test(words[last + 1]!.text)) last += 1;
      push('name', index, last);
    }
  }
  return claims;
}

export type ClaimBeat = {
  start: number;
  end: number;
  /** The layout the beat shows: B (the article / screenshot on top, the speaker stays below). */
  layout: 'explainer_b';
  kind: 'article_highlight';
  /** The claim that scheduled it. */
  claim: Claim;
  /** The phrase that gets the lime wipe: the strongest claim (a number beats a name) spoken inside the beat. */
  highlight: {phrase: string; start: number; end: number; kind: ClaimKind};
};

export type ClaimCoverage = {
  claim: Claim;
  /** `segment` = a B / C / D segment already covers it; `beat` = a scheduled beat; `unmet` = nothing could be placed in time. */
  by: 'segment' | 'beat' | 'unmet';
  layout: ExplainerLayoutId | null;
  /** Seconds between the claim's first word and the visual's first frame (<= 0 when the visual was already on screen). */
  delaySec: number | null;
};

export type LayoutSpan = {start: number; end: number; layout: ExplainerLayoutId};

export type ClaimVisualPlan = {
  claims: Claim[];
  beats: ClaimBeat[];
  coverage: ClaimCoverage[];
  /** The layout on screen over time (WP40 segments with every beat carved out of its talking-head segment as layout B): tiles [0, duration]. Captions read their y from it. */
  layoutTrack: LayoutSpan[];
  stats: {claims: number; coveredBySegment: number; coveredByBeat: number; unmet: number; maxDelaySec: number};
  warnings: string[];
};

const strength: Record<ClaimKind, number> = {money: 4, percent: 3, number: 2, name: 1};

/** Is a visual on screen no later than `maxDelay` after `claim.start`? Returns the covering span + delay. */
function coveringVisual(claim: Claim, spans: readonly {start: number; end: number; layout: ExplainerLayoutId}[], maxDelay: number): {layout: ExplainerLayoutId; delaySec: number} | null {
  let best: {layout: ExplainerLayoutId; delaySec: number} | null = null;
  for (const span of spans) {
    if (!VISUAL_LAYOUTS.includes(span.layout)) continue;
    if (span.start > claim.start + maxDelay + 1e-9) continue; // appears too late
    if (span.end <= claim.start + 1e-9) continue; // already gone
    const delaySec = round3(span.start - claim.start);
    if (!best || delaySec < best.delaySec) best = {layout: span.layout, delaySec};
  }
  return best;
}

/** Rebuild the tiling layout track: the segments, with every beat carved out of its (talking-head) segment as layout B. */
export function layoutTrackOf(segments: readonly ExplainerSegment[], beats: readonly ClaimBeat[]): LayoutSpan[] {
  const track: LayoutSpan[] = [];
  for (const segment of segments) {
    let cursor = segment.start;
    const inside = beats.filter(beat => beat.start < segment.end - 1e-9 && beat.end > segment.start + 1e-9).sort((a, b) => a.start - b.start);
    for (const beat of inside) {
      const from = Math.max(segment.start, beat.start);
      const to = Math.min(segment.end, beat.end);
      if (from > cursor + 1e-9) track.push({start: round3(cursor), end: round3(from), layout: segment.layout});
      track.push({start: round3(from), end: round3(to), layout: beat.layout});
      cursor = to;
    }
    if (segment.end > cursor + 1e-9) track.push({start: round3(cursor), end: round3(segment.end), layout: segment.layout});
  }
  // merge neighbours that ended up on the same layout (an adjacent B segment + a beat)
  return track.reduce<LayoutSpan[]>((out, span) => {
    const last = out[out.length - 1];
    if (last && last.layout === span.layout && Math.abs(last.end - span.start) < 1e-6) last.end = span.end;
    else out.push({...span});
    return out;
  }, []);
}

/**
 * Plan a visual for every spoken claim. A claim is covered when a B / C / D segment (or an earlier beat) is on screen within 0.5 s of it; a claim over a plain talking head (A) gets a beat. Beats stay
 * inside their talking-head segment, never overlap, and start at `claim - 0.15 s`, so the delay is always <= 0. A claim that cannot be placed in time is reported (`polish_claim:unmet:<n>`), not hidden.
 */
export function planClaimVisuals(input: {segments: readonly ExplainerSegment[]; words: readonly ExplainerWord[]; names?: readonly string[]}): ClaimVisualPlan {
  const claims = detectClaims(input.words, {names: input.names});
  const beats: ClaimBeat[] = [];
  const coverage: ClaimCoverage[] = [];

  for (const claim of claims) {
    const bySegment = coveringVisual(claim, input.segments, CLAIM_VISUAL_MAX_DELAY_SEC);
    if (bySegment) {
      coverage.push({claim, by: 'segment', layout: bySegment.layout, delaySec: bySegment.delaySec});
      continue;
    }
    const byBeat = coveringVisual(claim, beats, CLAIM_VISUAL_MAX_DELAY_SEC);
    if (byBeat) {
      coverage.push({claim, by: 'beat', layout: byBeat.layout, delaySec: byBeat.delaySec});
      continue;
    }
    // a plain talking head is on screen: schedule a beat inside that segment
    const segment = input.segments.find(item => item.start <= claim.start + 1e-9 && item.end > claim.start);
    if (!segment || segment.layout !== 'explainer_a') {
      coverage.push({claim, by: 'unmet', layout: null, delaySec: null});
      continue;
    }
    const prevEnd = beats.reduce((acc, beat) => (beat.end > acc && beat.start < segment.end ? beat.end : acc), segment.start);
    let start = Math.max(segment.start, prevEnd, claim.start - CLAIM_BEAT_LEAD_SEC);
    // WP49: keep the spoken claim inside the beat even when the lead pulls start earlier (end must cover claim.end).
    let end = Math.min(segment.end, Math.max(start + CLAIM_BEAT_SEC, claim.end + 0.12));
    if (end - start < CLAIM_BEAT_MIN_SEC) {
      // the claim sits near the end of its segment: pull the start earlier (never before the segment / the previous beat) to keep the beat long enough, as long as the claim is still inside it
      start = Math.max(segment.start, prevEnd, end - CLAIM_BEAT_MIN_SEC);
    }
    const delay = round3(start - claim.start);
    if (end - start < CLAIM_BEAT_MIN_SEC - 1e-9 || start > claim.start + CLAIM_VISUAL_MAX_DELAY_SEC || end <= claim.start) {
      coverage.push({claim, by: 'unmet', layout: null, delaySec: null});
      continue;
    }
    // the beat's highlight = the strongest claim spoken inside it (a number / amount beats a name), preferring the one that scheduled it on a tie
    const inside = claims.filter(item => item.start >= start - 1e-9 && item.start < end - 0.3);
    const top = inside.reduce((best, item) => (strength[item.kind] > strength[best.kind] ? item : best), claim);
    // WP49: if a stronger later claim becomes the lime phrase, keep it inside the beat window (lead can pull start earlier and otherwise clip the amount).
    end = Math.min(segment.end, Math.max(end, top.end + 0.12));
    beats.push({
      start: round3(start),
      end: round3(end),
      layout: 'explainer_b',
      kind: 'article_highlight',
      claim,
      highlight: {phrase: top.text, start: top.start, end: top.end, kind: top.kind},
    });
    coverage.push({claim, by: 'beat', layout: 'explainer_b', delaySec: delay});
  }

  const delays = coverage.filter(item => item.delaySec !== null).map(item => Math.max(0, item.delaySec!));
  const stats = {
    claims: claims.length,
    coveredBySegment: coverage.filter(item => item.by === 'segment').length,
    coveredByBeat: coverage.filter(item => item.by === 'beat').length,
    unmet: coverage.filter(item => item.by === 'unmet').length,
    maxDelaySec: round3(delays.length ? Math.max(...delays) : 0),
  };
  const warnings = [`polish_claim:visuals:${stats.claims}:${beats.length}`];
  if (stats.unmet > 0) warnings.push(`polish_claim:unmet:${stats.unmet}`);
  return {claims, beats, coverage, layoutTrack: layoutTrackOf(input.segments, beats), stats, warnings};
}

/** Seconds of speech either side of a claim that name its noun ("raised six billion dollars": the claim is "six billion", the noun is in the words around it). */
export const CLAIM_QUERY_WINDOW_SEC = 1.0;

export type ClaimQuery = {
  claim: Claim;
  /** The words around the claim the queries are literal to. */
  spoken: string;
  /** Noun-locked 2-4 word stock queries, head noun first (empty when the speech names nothing visible). */
  queries: string[];
  /** The noun the picture must show (null when nothing locked). */
  headNoun: string | null;
  /** The profile that also judges the candidate photos (`judgeCandidate`). */
  profile: NounLockProfile;
};

/**
 * WP37: the stock queries for each spoken claim, so a number / amount / name beat shows the NOUN ("six billion" -> dollar bills / trading floor, never a food table; "server room" stays tech). PURE. Production mounting of
 * the claim beats is later (WP41), so this plans + reports; the resolver loop that consumes these queries is the same `resolveNounLocked` the faceless lane and the editorial montage use.
 */
export function claimBeatQueries(plan: Pick<ClaimVisualPlan, 'claims'>, words: readonly ExplainerWord[]): {items: ClaimQuery[]; warnings: string[]} {
  const items = plan.claims.map(claim => {
    const spoken = words
      .filter(word => word.end > claim.start - CLAIM_QUERY_WINDOW_SEC && word.start < claim.end + CLAIM_QUERY_WINDOW_SEC)
      .map(word => word.text)
      .join(' ');
    const profile = buildNounLockProfile(spoken);
    return {claim, spoken, queries: nounLockQueries(profile, editorialStillQueries(spoken, {sceneRulesOnly: true})), headNoun: profile.headNoun, profile};
  });
  const locked = items.filter(item => item.profile.locked).length;
  return {items, warnings: items.length > 0 ? [`polish_claim:noun_lock:${locked}:${items.length}`] : []};
}
