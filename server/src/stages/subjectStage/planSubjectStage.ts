/**
 * SUBJECT STAGE planner (Phase 3, PURE): transcript cues -> the `subjectStage` blueprint payload (stage spans + accents + enter transitions).
 * No model, no network, no env, no I/O. Deterministic: the same input always gives the same plan.
 *
 * Pipeline: sentences -> cut units on sentence boundaries (3-7 s, never < 1.4 s, a long sentence is split) -> intent per unit (stageIntent.ts) -> same-stage neighbours merged (<= 7 s) -> a stage per unit
 * under the hard rules (never the same stage twice, at most 2 asset-heavy stages in a row then S4, S5 at most once and only for an official / final unit, capped) with the share targets as SOFT pull ->
 * enter transitions (hard_cut; a topic jump into S1 / S3 flashes; into S5 slides up) -> assets (user hints first, else native generated from the spoken words) -> S4 accents from spoken keywords.
 * Nothing on screen is invented: every quote / row / accent line is an exact substring of the transcript.
 *
 * `validateSubjectStagePlan` re-checks every hard rule on any plan (the tests run it on every fixture; analyze can run it before emitting).
 */
import type {TimelineBlueprint} from '../../types/blueprint.ts';
import {INTENT_STAGES, classifyIntent, deriveKeywords, firstContentWord, startsWithTopicMarker, throttleKeywordHits, tokenOverlap, contentTokens, verdictKeyword, type KeywordHit, type SubjectStageIntent, INTENT_PRIORITY} from './stageIntent.ts';
import {s5LengthOk, S2_PLACEMENT_DEFAULT, S5_MAX_DURATION_SEC, SLIDE_UP_FRONT_MIN_HOLD_SEC, SLIDE_UP_FRONT_SEC} from './stageMotion.ts';
import {SUBJECT_STAGE_BG, SUBJECT_STAGE_PLANNER, SUBJECT_STAGE_RHYTHM, SUBJECT_STAGE_SHARES, SUBJECT_STAGE_STYLE_ID, type StageId} from './subjectStageConfig.ts';

export type SubjectStageBlueprint = NonNullable<TimelineBlueprint['subjectStage']>;
export type PlannedSpan = SubjectStageBlueprint['spans'][number];
export type PlannedAccent = SubjectStageBlueprint['accents'][number];

export type StageSentence = {start: number; end: number; text: string};
export type StageKeywordInput = {at: number; text: string};
/** Optional asset hint (stub for the asset phase): a user / editorial asset the planner may hand to an asset-heavy stage. Without hints every asset-heavy stage gets a native generated one. */
export type StageAssetHint = {kind: 'image' | 'video' | 'native'; url?: string; stage?: 'S1' | 'S2' | 'S3' | 'S5'; nativeKind?: 'plate' | 'quote_card' | 'result_page'; text?: string; lines?: string[]};
export type PlanSubjectStageInput = {sentences: readonly StageSentence[]; keywords?: readonly StageKeywordInput[]; durationSec: number; assets?: readonly StageAssetHint[]; /** output seconds of known topic breaks */ topicBreaks?: readonly number[]};

export type PlanUnitDebug = {start: number; end: number; intent: SubjectStageIntent | null; intentScore: number; desired: StageId[]; stage: StageId; overridden: boolean; text: string};
export type SubjectStagePlan = {
  spans: PlannedSpan[];
  accents: PlannedAccent[];
  warnings: string[];
  /** share of the runtime per stage (0..1) */
  shares: Record<StageId, number>;
  debug: {units: PlanUnitDebug[]};
};

const HEAVY: ReadonlySet<StageId> = new Set<StageId>(['S1', 'S2', 'S3', 'S5']);
const TIE_ORDER: readonly StageId[] = ['S4', 'S1', 'S2', 'S3', 'S5'];
const FILL_CANDIDATES: readonly StageId[] = ['S4', 'S1', 'S2', 'S3'];
const r3 = (n: number): number => Math.round(n * 1000) / 1000;
const P = SUBJECT_STAGE_PLANNER;

type Unit = {start: number; end: number; first: number; last: number; text: string; noMerge: boolean};
type Draft = {stage: StageId; start: number; end: number; unit: number | null};

const emptyShares = (): Record<StageId, number> => ({S1: 0, S2: 0, S3: 0, S4: 0, S5: 0});

// ------------------------------------------------------------------------------------------------ text helpers (exact substrings only)
function cutAtWord(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.5 ? cut.slice(0, at) : cut).replace(/[\s,;:]+$/, '')}…`;
}
/** The quoted passage when the sentence has one, else the sentence itself (both are spoken words). */
function spokenQuote(text: string): string {
  const q = /["“]([^"”]{12,})["”]/.exec(text);
  return cutAtWord(q ? q[1]! : text, P.quoteMaxChars);
}
/** S1 plate copy: the headline of the unit's first spoken sentence and, when there is one, a subline from the second (exact fragments, cut at a word). */
function plateCopy(sentences: readonly StageSentence[]): {text: string; lines?: string[]} {
  let first = sentences[0]?.text ?? '';
  let second = sentences[1]?.text;
  if (second && first.length < 15) {
    first = second; // a one-word opener ("Yes.") is no headline: the next sentence is
    second = sentences[2]?.text;
  }
  return {text: cutAtWord(first, P.plateHeadlineMax), ...(second ? {lines: [cutAtWord(second, P.plateSublineMax)]} : {})};
}
/** Result-page rows: the spoken phrases of the unit (split at commas / "and" / "or"), each an exact fragment. */
function spokenRows(sentences: readonly StageSentence[]): string[] {
  const rows: string[] = [];
  for (const s of sentences) {
    for (const part of s.text.split(/[,;:—–]|\s(?:and|or)\s/i)) {
      const t = part.replace(/[.!?"“”]+/g, '').trim();
      if (t.length >= 8) rows.push(cutAtWord(t, 60));
    }
  }
  return [...new Set(rows)].slice(0, P.s3MaxRows);
}

// ------------------------------------------------------------------------------------------------ units (cuts on sentence boundaries)
function buildUnits(sentences: readonly StageSentence[], durationSec: number, warnings: string[]): Unit[] {
  // sentence i owns [b_i, b_{i+1}): the first from 0, the last to the end, silence between sentences is absorbed: the stage tiles the runtime and cuts only at sentence starts
  const bounds = sentences.map((s, i) => (i === 0 ? 0 : s.start));
  bounds.push(durationSec);
  type Piece = {start: number; end: number; idx: number; split: boolean};
  const pieces: Piece[] = [];
  sentences.forEach((_, i) => {
    const a = bounds[i]!;
    const b = bounds[i + 1]!;
    const len = b - a;
    if (len > P.preferredMaxSec + 1e-9) {
      const n = Math.ceil(len / P.preferredMaxSec);
      warnings.push(`subject_stage:long_sentence_split:${i}:${n}`);
      for (let k = 0; k < n; k += 1) pieces.push({start: r3(a + (len * k) / n), end: r3(a + (len * (k + 1)) / n), idx: i, split: true});
    } else pieces.push({start: a, end: b, idx: i, split: false});
  });
  const units: Unit[] = [];
  let cur: Unit | undefined;
  for (const piece of pieces) {
    const next: Unit = {start: piece.start, end: piece.end, first: piece.idx, last: piece.idx, text: sentences[piece.idx]!.text, noMerge: piece.split};
    if (!cur) {
      cur = next;
      continue;
    }
    const curLen = cur.end - cur.start;
    const pieceLen = piece.end - piece.start;
    const mergeable = !cur.noMerge && !next.noMerge;
    // grow a short unit toward the preferred minimum while it stays within the preferred maximum; a unit under the hard minimum is always grown
    if (mergeable && ((curLen < P.preferredMinSec && curLen + pieceLen <= P.preferredMaxSec + 1e-9) || curLen < P.minStageSec)) {
      cur = {...cur, end: piece.end, last: piece.idx, text: `${cur.text} ${next.text}`};
    } else {
      units.push(cur);
      cur = next;
    }
  }
  if (cur) units.push(cur);
  // a tail under the hard minimum folds into its neighbour (even a split piece: a sliver is never a stage)
  while (units.length > 1 && units[units.length - 1]!.end - units[units.length - 1]!.start < P.minStageSec) {
    const tail = units.pop()!;
    const prev = units[units.length - 1]!;
    units[units.length - 1] = {...prev, end: tail.end, last: tail.last, text: `${prev.text} ${tail.text}`};
  }
  return units;
}

// ------------------------------------------------------------------------------------------------ planner
export function planSubjectStage(input: PlanSubjectStageInput): SubjectStagePlan {
  const warnings: string[] = [];
  const D = input.durationSec;
  const empty = (reason: string): SubjectStagePlan => ({spans: [], accents: [], warnings: [...warnings, `subject_stage:skipped:${reason}`], shares: emptyShares(), debug: {units: []}});
  if (!(D >= P.minVideoSec)) return empty('too_short');
  const sentences = [...input.sentences]
    .map(s => ({start: Math.max(0, s.start), end: Math.min(D, s.end), text: s.text.replace(/\s+/g, ' ').trim()}))
    .filter(s => s.text && s.end > s.start && s.start < D)
    .sort((a, b) => a.start - b.start);
  if (sentences.length === 0) return empty('no_speech');

  // 1. cut units + intent
  let units = buildUnits(sentences, D, warnings);
  type UnitInfo = {intent: SubjectStageIntent | null; score: number; desired: StageId[]};
  const infoOf = (u: Unit): UnitInfo => {
    const totals: Partial<Record<SubjectStageIntent, number>> = {};
    for (let i = u.first; i <= u.last; i += 1) {
      const r = classifyIntent(sentences[i]!.text);
      for (const [k, v] of Object.entries(r.scores) as Array<[SubjectStageIntent, number]>) totals[k] = (totals[k] ?? 0) + v;
    }
    let best: SubjectStageIntent | null = null;
    let bestScore = 0;
    for (const intent of INTENT_PRIORITY) {
      const v = totals[intent] ?? 0;
      if (v >= 2 && v > bestScore + 1e-9) {
        best = intent;
        bestScore = v;
      }
    }
    return {intent: best, score: bestScore, desired: best ? [...INTENT_STAGES[best]] : []};
  };
  let infos = units.map(infoOf);

  // 2. merge adjacent units that want the same primary stage when they fit one stage
  for (let i = 0; i + 1 < units.length; ) {
    const a = units[i]!;
    const b = units[i + 1]!;
    const sameWant = infos[i]!.desired[0] !== undefined && infos[i]!.desired[0] === infos[i + 1]!.desired[0];
    if (sameWant && !a.noMerge && !b.noMerge && b.end - a.start <= P.preferredMaxSec + 1e-9) {
      units[i] = {...a, end: b.end, last: b.last, text: `${a.text} ${b.text}`};
      units.splice(i + 1, 1);
      infos = units.map(infoOf);
    } else i += 1;
  }

  // 3. a stage per unit. A dynamic program over the units picks the sequence with the lowest intent mismatch under the HARD rules (never the same stage twice; at most 2 asset-heavy in a row, then S4).
  // The share targets are a SOFT pull: per-second biases (raised on over-target stages, re-solved a few times) steer which units pay for a forced S4 and which fill units go where.
  const lenOf = (i: number) => units[i]!.end - units[i]!.start;
  const intentCost = (i: number, c: StageId): number => {
    const desired = infos[i]!.desired;
    if (desired.length === 0) return 0;
    if (desired[0] === c) return 0;
    return desired.includes(c) ? 5 : 12;
  };
  const solve = (bias: Record<StageId, number>): StageId[] => {
    type Cell = {cost: number; path: StageId[]};
    let layer = new Map<string, Cell>([['-|0', {cost: 0, path: []}]]);
    for (let i = 0; i < units.length; i += 1) {
      const next = new Map<string, Cell>();
      for (const [key, cell] of layer) {
        const [pv, rs] = key.split('|') as [string, string];
        const run = Number(rs);
        for (const c of FILL_CANDIDATES) {
          if (c === pv || (HEAVY.has(c) && run >= SUBJECT_STAGE_RHYTHM.maxHeavyInARow)) continue;
          if (i === 0 && c === 'S4') continue; // the behind layer is contentful from the first frame: the opening stage is never a bare S4
          let cost = cell.cost + intentCost(i, c) + bias[c] * lenOf(i);
          if (c === 'S3' && lenOf(i) < 3.5) cost += 3; // a scroll needs a few seconds
          const nk = `${c}|${HEAVY.has(c) ? run + 1 : 0}`;
          const existing = next.get(nk);
          if (!existing || cost < existing.cost - 1e-9) next.set(nk, {cost, path: [...cell.path, c]});
        }
      }
      layer = next;
    }
    let best: Cell | undefined;
    for (const cell of layer.values()) if (!best || cell.cost < best.cost - 1e-9) best = cell;
    return best?.path ?? units.map(() => 'S4' as StageId);
  };
  const shareOf = (seq: readonly StageId[]): Record<StageId, number> => {
    const sh = emptyShares();
    seq.forEach((c, i) => {
      sh[c] += lenOf(i) / D;
    });
    return sh;
  };
  const deviation = (sh: Record<StageId, number>): number => Math.max(...FILL_CANDIDATES.map(c => Math.abs(sh[c] - SUBJECT_STAGE_SHARES[c])));
  // pick the best of the re-solved sequences by (intent mismatch + a pull toward the share targets): a deviation is only worth a mismatch when it buys a lot of share
  const mismatch = (seq: readonly StageId[]): number => seq.reduce((sum, c, i) => sum + intentCost(i, c), 0);
  const objective = (seq: readonly StageId[]): number => mismatch(seq) + 40 * deviation(shareOf(seq));
  const bias = emptyShares();
  let chosen: StageId[] = solve(bias);
  let bestObjective = objective(chosen);
  for (let iter = 0; iter < 10; iter += 1) {
    const sh = shareOf(solve(bias));
    for (const c of FILL_CANDIDATES) bias[c] += 12 * (sh[c] - SUBJECT_STAGE_SHARES[c]);
    const seq = solve(bias);
    const value = objective(seq);
    if (value < bestObjective - 1e-9) {
      bestObjective = value;
      chosen = seq;
    }
  }
  const overridden = chosen.map((c, i) => infos[i]!.desired.length > 0 && !infos[i]!.desired.includes(c));
  chosen.forEach((c, i) => {
    if (overridden[i]) warnings.push(`subject_stage:intent_overridden:${i}:${infos[i]!.intent}:${c}`);
  });
  void TIE_ORDER;

  // 4. S5: at most once, only an official / final unit that is long enough, late enough and not too long to cap. It replaces an asset-heavy stage (heavy -> heavy keeps the run rule) and is unique, so it can never equal a neighbour
  let s5Unit = -1;
  let s5Score = -1;
  units.forEach((u, i) => {
    const info = infos[i]!;
    if (info.intent !== 'official_or_final' || !(chosen[i] === 'S1' || chosen[i] === 'S2' || chosen[i] === 'S3') || u.start < P.s5EarliestSec) return;
    const len = u.end - u.start;
    if (!s5LengthOk(Math.min(len, S5_MAX_DURATION_SEC))) return;
    const rem = len - Math.min(len, S5_MAX_DURATION_SEC);
    if (rem > 1e-9 && rem < P.minStageSec && len - P.minStageSec < SLIDE_UP_FRONT_SEC + SLIDE_UP_FRONT_MIN_HOLD_SEC) return;
    if (info.score >= s5Score) {
      s5Unit = i;
      s5Score = info.score;
    }
  });

  // 5. drafts (the S5 stage is cut to its cap; the remainder becomes S4 or joins an S4 neighbour)
  const drafts: Draft[] = [];
  units.forEach((u, i) => {
    if (i !== s5Unit) {
      drafts.push({stage: chosen[i]!, start: u.start, end: u.end, unit: i});
      return;
    }
    const len = u.end - u.start;
    let s5Len = Math.min(len, S5_MAX_DURATION_SEC);
    if (len - s5Len > 1e-9 && len - s5Len < P.minStageSec) s5Len = len - P.minStageSec;
    drafts.push({stage: 'S5', start: u.start, end: r3(u.start + s5Len), unit: i});
    if (len - s5Len > 1e-9) drafts.push({stage: 'S4', start: r3(u.start + s5Len), end: u.end, unit: null});
  });
  // an S4 remainder next to an S4 unit is one S4 stage (never the same stage twice)
  for (let i = 0; i + 1 < drafts.length; ) {
    if (drafts[i]!.stage === drafts[i + 1]!.stage) {
      drafts[i] = {...drafts[i]!, end: drafts[i + 1]!.end, unit: drafts[i]!.unit ?? drafts[i + 1]!.unit};
      drafts.splice(i + 1, 1);
    } else i += 1;
  }
  // the run rule is local, so merging can only shorten runs; but a lone short S4 from the cap remainder cannot appear (>= minStageSec by construction)

  // 6. transitions
  const topicBreaks = input.topicBreaks ?? [];
  const isTopicJump = (draft: Draft): boolean => {
    if (draft.unit === null) return false;
    const u = units[draft.unit]!;
    if (topicBreaks.some(t => Math.abs(t - draft.start) <= 0.6)) return true;
    const first = sentences[u.first]!;
    const before = u.first > 0 ? sentences[u.first - 1]! : undefined;
    if (before && first.start - before.end >= 1.2) return true;
    if (startsWithTopicMarker(first.text)) return true;
    const prevUnit = draft.unit > 0 ? units[draft.unit - 1] : undefined;
    if (prevUnit) {
      const a = contentTokens(prevUnit.text);
      const b = contentTokens(u.text);
      if (a.length >= 8 && b.length >= 8 && tokenOverlap(prevUnit.text, u.text) === 0) return true;
    }
    return false;
  };
  let lastFlashAt = -Infinity;
  const spans: PlannedSpan[] = [];
  const assetPool = [...(input.assets ?? [])];
  const takeAsset = (stage: 'S1' | 'S2' | 'S3' | 'S5'): StageAssetHint | undefined => {
    const idx = assetPool.findIndex(a => (a.stage ? a.stage === stage : true));
    return idx >= 0 ? assetPool.splice(idx, 1)[0] : undefined;
  };
  drafts.forEach((draft, i) => {
    const u = draft.unit !== null ? units[draft.unit] : undefined;
    const stageSentences = u ? sentences.slice(u.first, u.last + 1) : sentences.filter(s => s.start < draft.end && s.end > draft.start);
    let enter: PlannedSpan['enter'] = 'hard_cut';
    if (i > 0) {
      if (draft.stage === 'S5') enter = 'slide_up_front';
      else if ((draft.stage === 'S1' || draft.stage === 'S3') && isTopicJump(draft) && draft.start - lastFlashAt >= P.flashMinGapSec) enter = 'flash_cut';
    }
    if (enter === 'flash_cut') lastFlashAt = draft.start;
    const base = {start: draft.start, end: draft.end, stage: draft.stage, enter} as const;
    const hint = draft.stage === 'S4' ? undefined : takeAsset(draft.stage);
    const hinted = hint ? {...(hint.url ? {url: hint.url} : {}), kind: hint.kind, ...(hint.nativeKind ? {nativeKind: hint.nativeKind} : {}), ...(hint.text ? {text: hint.text} : {}), ...(hint.lines ? {lines: hint.lines} : {})} : undefined;
    if (draft.stage === 'S1') spans.push({...base, asset: hinted ?? {kind: 'native', nativeKind: 'plate', ...plateCopy(stageSentences)}, motion: {kind: 'none'}});
    else if (draft.stage === 'S2') spans.push({...base, asset: hinted ?? {kind: 'native', nativeKind: 'quote_card', text: spokenQuote(stageSentences[0]?.text ?? '')}, motion: {kind: 'slow_push', scalePct: 5}, placement: {...S2_PLACEMENT_DEFAULT}});
    else if (draft.stage === 'S3') {
      let rows: string[] | undefined;
      if (!hinted) {
        // the unit's own spoken phrases first; a short page borrows the phrases of the NEXT, then the PREVIOUS sentences (still spoken words, nothing invented)
        rows = spokenRows(stageSentences);
        const lo = u ? u.first : sentences.findIndex(x => x === stageSentences[0]);
        const hi = u ? u.last : lo + stageSentences.length - 1;
        for (let step = 1; rows.length < P.s3MinRows && step <= 6; step += 1) {
          const extra = [sentences[hi + step], sentences[lo - step]].filter((x): x is StageSentence => Boolean(x));
          rows = [...new Set([...rows, ...spokenRows(extra)])].slice(0, P.s3MaxRows);
        }
      }
      if (rows && rows.length < P.s3MinRows) warnings.push(`subject_stage:s3_short_page:${i}:${rows.length}`);
      if (rows && rows.length === 0) rows = [cutAtWord(stageSentences[0]?.text ?? '', 60)].filter(Boolean); // a page always has a row
      spans.push({...base, asset: hinted ?? {kind: 'native', nativeKind: 'result_page', lines: rows}, opacity: 0.5, wash: 'warm', motion: {kind: 'auto_scroll', pctPerSec: 18}});
    } else if (draft.stage === 'S5') spans.push({...base, asset: hinted ?? {kind: 'native', nativeKind: 'quote_card', text: spokenQuote(stageSentences[0]?.text ?? '')}, motion: {kind: 'slide_up_front'}});
    else spans.push({...base, motion: {kind: 'none'}});
  });

  // 7. S4 accents from spoken keywords (<= 1 hit per second across the whole video). An S4 is NEVER bare: its accent opens with the stage and lives to its end, so the behind layer is never visually empty
  // for more than 0.5 s. >= 2 hits build ONE text_stack (lines appended at their keyword, >= 1 s apart, the first line shown from the stage start); a single hit is one chip held for the whole stage.
  const accents: PlannedAccent[] = [];
  const provided = input.keywords ? [...input.keywords].map(k => ({at: k.at, text: k.text.trim(), score: 2})).filter(k => k.text) : undefined;
  let lastHit = -Infinity;
  let kindToggle = 0;
  spans.forEach((span, i) => {
    if (span.stage !== 'S4') return;
    const draft = drafts[i]!;
    const info = draft.unit !== null ? infos[draft.unit]! : undefined;
    const inSpan = sentences.filter(s => s.start < span.end && s.end > span.start);
    const L = span.end - span.start;
    let candidates: KeywordHit[];
    if (info?.intent === 'confirmation_or_verdict') {
      const verdicts = inSpan.map(verdictKeyword).filter((v): v is KeywordHit => Boolean(v));
      candidates = verdicts.slice(0, 1);
    } else if (provided) candidates = provided.filter(k => k.at >= span.start && k.at < span.end);
    else candidates = inSpan.flatMap(s => deriveKeywords(s)).filter(k => k.at >= span.start && k.at < span.end);
    const throttled = throttleKeywordHits(candidates.filter(k => k.at >= span.start && k.at <= span.end - 0.8 && k.at - lastHit >= 1 - 1e-9), 1);
    const seen = new Set<string>();
    let unique = throttled.filter(h => (seen.has(h.text.toLowerCase()) ? false : (seen.add(h.text.toLowerCase()), true)));
    if (unique.length === 0) {
      // nothing keyword-like in this stage: the first spoken content word (or, failing that, the sentence's opening words) so the stage still opens with a spoken accent
      warnings.push(`subject_stage:s4_no_keywords:${i}`);
      const sentence = inSpan[0];
      const word = sentence ? (sentence.text.match(/[\p{L}\p{N}][\p{L}\p{N}'-]{2,}/gu) ?? []).sort((x, y) => y.length - x.length)[0] : undefined;
      const text = word ?? (sentence ? cutAtWord(sentence.text, 30) : '');
      if (!text) return;
      unique = [{at: span.start, text, score: 0}];
    }
    // a stage whose first keyword comes late opens on the first content word it SPEAKS (so no accent shows its term seconds before it is said); the keyword(s) follow as stack lines
    const lead = inSpan[0] ? firstContentWord(inSpan[0].text) : undefined;
    if (unique[0]!.at - span.start > P.accentAnticipationWarnSec && lead && !unique.some(h => h.text.toLowerCase() === lead.toLowerCase())) unique = [{at: span.start, text: lead, score: 0}, ...unique];
    // line start times (relative to the stage): the first line opens the stage; later lines wait for their keyword and for the 1 s cadence
    const lines: Array<{text: string; rel: number}> = [];
    for (const hit of unique.slice(0, P.stackMaxLines)) {
      const rel = lines.length === 0 ? 0 : Math.max(hit.at - span.start, lines[lines.length - 1]!.rel + 1);
      if (rel > L - 0.8 && lines.length > 0) break;
      lines.push({text: hit.text, rel: r3(rel)});
    }
    if (unique[0]!.at - span.start > P.accentAnticipationWarnSec) warnings.push(`subject_stage:accent_anticipated:${i}:${r3(unique[0]!.at - span.start)}s`);
    const end = r3(span.end - 0.1);
    if (lines.length >= 2) accents.push({start: r3(span.start), end, kind: 'text_stack', lines: lines.map(l => l.text), lineStarts: lines.map(l => l.rel), slot: 2});
    else {
      accents.push({start: r3(span.start), end, kind: kindToggle % 2 === 0 ? 'pop_in' : 'drop_in_tilt', lines: [lines[0]!.text], slot: 0});
      kindToggle += 1;
    }
    lastHit = span.start + lines[lines.length - 1]!.rel;
  });

  const shares = emptyShares();
  for (const span of spans) shares[span.stage] += (span.end - span.start) / D;
  for (const id of Object.keys(shares) as StageId[]) shares[id] = r3(shares[id]);
  const unitsDebug: PlanUnitDebug[] = units.map((u, i) => ({start: r3(u.start), end: r3(u.end), intent: infos[i]!.intent, intentScore: r3(infos[i]!.score), desired: infos[i]!.desired, stage: chosen[i]!, overridden: overridden[i]!, text: u.text}));
  const plan: SubjectStagePlan = {spans, accents, warnings, shares, debug: {units: unitsDebug}};
  for (const problem of validateSubjectStagePlan(plan, D)) warnings.push(`subject_stage:invariant:${problem}`);
  return plan;
}

/** The blueprint payload for analyze: the plan + the matte URL + the room treatment defaults. */
export function toSubjectStageBlueprint(plan: SubjectStagePlan, matteUrl: string): SubjectStageBlueprint {
  return {version: 1, styleId: SUBJECT_STAGE_STYLE_ID, matteUrl, bg: {blurPx: SUBJECT_STAGE_BG.default.blurPx, dimPct: SUBJECT_STAGE_BG.default.dimPct}, spans: plan.spans, accents: plan.accents};
}

/** Whether a span asset shows something: an uploaded image / video, a plate or quote card with text, a result page with rows. A contentless native plate is EMPTY. */
export function hasContent(asset: PlannedSpan['asset']): boolean {
  if (!asset) return false;
  if (asset.url) return true;
  if (asset.nativeKind === 'plate' || asset.nativeKind === 'quote_card') return Boolean(asset.text?.trim());
  if (asset.nativeKind === 'result_page') return (asset.lines ?? []).some(l => l.trim());
  return false;
}

/** Re-check every HARD rule of a plan. Returns the problems (empty = valid). Soft targets (shares, the 3-7 s preference) are not problems. */
export function validateSubjectStagePlan(plan: Pick<SubjectStagePlan, 'spans' | 'accents'>, durationSec: number): string[] {
  const problems: string[] = [];
  const {spans, accents} = plan;
  if (spans.length === 0) return accents.length > 0 ? ['accents_without_spans'] : problems;
  if (Math.abs(spans[0]!.start) > 1e-6) problems.push('does_not_start_at_zero');
  if (Math.abs(spans[spans.length - 1]!.end - durationSec) > 1e-6) problems.push('does_not_end_at_duration');
  let heavyRun = 0;
  let s5 = 0;
  let lastFlash = -Infinity;
  spans.forEach((span, i) => {
    const len = span.end - span.start;
    if (len < P.minStageSec - 1e-6) problems.push(`span_${i}_shorter_than_min:${r3(len)}`);
    if (i > 0) {
      if (Math.abs(spans[i - 1]!.end - span.start) > 1e-6) problems.push(`gap_before_span_${i}`);
      if (spans[i - 1]!.stage === span.stage) problems.push(`same_stage_twice:${i}:${span.stage}`);
    }
    heavyRun = HEAVY.has(span.stage) ? heavyRun + 1 : 0;
    if (heavyRun > SUBJECT_STAGE_RHYTHM.maxHeavyInARow) problems.push(`heavy_run_exceeded:${i}`);
    if (span.stage === 'S5') {
      s5 += 1;
      if (len > S5_MAX_DURATION_SEC + 1e-6) problems.push(`s5_over_cap:${r3(len)}`);
      if (!s5LengthOk(len)) problems.push(`s5_too_short:${r3(len)}`);
      if (span.enter !== 'slide_up_front') problems.push('s5_enter_not_slide_up_front');
    } else if (span.enter === 'slide_up_front') problems.push(`slide_up_front_on_${span.stage}`);
    if (span.enter === 'flash_cut') {
      if (span.stage !== 'S1' && span.stage !== 'S3') problems.push(`flash_cut_on_${span.stage}`);
      if (span.start - lastFlash < P.flashMinGapSec - 1e-6) problems.push(`flash_too_close:${i}`);
      lastFlash = span.start;
    }
    if (i === 0 && span.enter !== 'hard_cut') problems.push('first_span_not_hard_cut');
  });
  if (s5 > SUBJECT_STAGE_RHYTHM.maxS5PerVideo) problems.push(`s5_count:${s5}`);
  const hitTimes: number[] = [];
  accents.forEach((a, i) => {
    const host = spans.find(span => a.start >= span.start - 1e-6 && a.end <= span.end + 1e-6);
    if (!host || host.stage !== 'S4') problems.push(`accent_${i}_not_inside_an_S4_span`);
    if (a.end - a.start < P.accentMinSec - 1e-6) problems.push(`accent_${i}_too_short`);
    if (host && a.end - a.start > host.end - host.start + 1e-6) problems.push(`accent_${i}_longer_than_its_stage`);
    if (a.kind === 'text_stack') {
      if ((a.lines?.length ?? 0) > P.stackMaxLines) problems.push(`accent_${i}_too_many_lines`);
      (a.lineStarts ?? []).forEach(t => hitTimes.push(a.start + t));
    } else hitTimes.push(a.start);
    accents.forEach((b, j) => {
      if (j > i && a.start < b.end && b.start < a.end && a.slot === b.slot) problems.push(`accents_${i}_${j}_overlap_in_slot_${a.slot}`);
    });
  });
  // the behind layer is never visually empty for longer than 0.5 s (the opening and the end included)
  const visible: Array<[number, number]> = [];
  spans.forEach((span, i) => {
    if (span.stage === 'S4') return;
    if (span.stage === 'S1' && !hasContent(span.asset)) problems.push(`s1_without_text:${i}`);
    if (span.stage === 'S5' || hasContent(span.asset)) visible.push([span.start, span.end]);
  });
  for (const a of accents) visible.push([a.start, a.end]);
  visible.sort((x, y) => x[0] - y[0]);
  let covered = 0;
  const gaps: Array<[number, number]> = [];
  for (const [from, to] of visible) {
    if (from - covered > P.behindGapMaxSec + 1e-6) gaps.push([covered, from]);
    covered = Math.max(covered, to);
  }
  if (durationSec - covered > P.behindGapMaxSec + 1e-6) gaps.push([covered, durationSec]);
  for (const [from, to] of gaps) problems.push(`behind_gap:${r3(from)}-${r3(to)}`);
  if ((visible[0]?.[0] ?? Infinity) > P.behindGapMaxSec + 1e-6) problems.push('opening_latency');
  hitTimes.sort((x, y) => x - y);
  for (let i = 1; i < hitTimes.length; i += 1) if (hitTimes[i]! - hitTimes[i - 1]! < 1 - 1e-3) problems.push(`keyword_hits_closer_than_1s:${r3(hitTimes[i - 1]!)}`);
  return problems;
}
