/**
 * Phase 5.27B: the Subject Stage editorial EVALUATION (pure: no I/O, no env, no network). Isolated evaluation code; production modules are only CALLED, never changed.
 *
 * It keeps four things apart that the Phase 5.27A audit found mixed together:
 *   1. the Director's PROPOSALS (what was asked for), scored editorially against a human-approved spec (R1-R6);
 *   2. the VALIDATOR (stageDirection.ts): a safety gate whose accept / reject is RECORDED, never used as the editorial score;
 *   3. the COMPILER (compileDirection): which accepted cards became spans, and which it dropped SILENTLY (re-derived here and cross-checked against its real output);
 *   4. the DESIGN step and the RENDER: which compiled cards were drawn, restrained (with the design's own reason), and actually visible in the rendered frames.
 *
 * Verdicts are TOTAL: every criterion is PASS | FAIL | PENDING_HUMAN (with the reason), and the overall result is PASS | FAIL | INCOMPLETE | BLOCKED, decided by evaluating the
 * decision table with every pending criterion resolved both ways (equal results = that result; different = INCOMPLETE). Nothing is left unclassified.
 */
import {compileDirection, validateSubjectStageDirection, type CatalogAsset, type TranscriptWord, type ValidatedDirection} from '../../stages/subjectStage/stageDirection.ts';

// ------------------------------------------------------------------------------------------------ spec (machine-readable, human-approvable)
export type Range = [number, number];
/** one editorial decision the human must approve: `draft` is the assistant's proposal (from the draft ground truth), `approved` stays null until the human sets it */
export type Decision<T> = {id: string; question: string; draft: T; approved: T | null};
export type SpecChapter = {id: string; words: Range; strongTitles: Range[]; weakTitles: Range[]};
export type SpecQuote = {id: string; words: Range; strength: 'strong' | 'acceptable'};
export type EvaluationSpec = {
  label: string;
  groundTruth: {path: string; sha256: string};
  durationSec: number;
  chapters: SpecChapter[];
  quotes: SpecQuote[];
  /** spans that must never be highlighted (title or quote) */
  filler: Array<{words: Range; why: string}>;
  /** generic praise: a title made of these (plus stop words) is generic */
  genericWords: string[];
  numberWords: string[];
  cutaways: {conditional: Array<{asset: string; window: Range}>};
  decisions: {
    /** D1: C1 policy */
    c1Policy: Decision<'omit' | 'treatment_allowed' | 'treatment_required'>;
    /** D4 / D8: per chapter, may a title be shown? */
    titlePolicy: Decision<Record<string, 'forbidden' | 'optional'>>;
    /** D11: quote pairs that may not both be shown */
    exclusiveQuotePairs: Decision<Array<[string, string]>>;
    /** D17: a chapter title and a quote that may not both be shown */
    exclusiveTitleQuote: Decision<Array<{chapter: string; quote: string}>>;
    /** D20 / D21: at least one of these quotes must be PROPOSED (validator acceptance not required) */
    requiredQuoteAnyOf: Decision<string[]>;
    /** D25 */
    maxTitles: Decision<number>;
    maxQuotes: Decision<number>;
    /** D23: is the conditional cutaway (cash still over the bonus line) acceptable? */
    conditionalCutawayAcceptable: Decision<boolean>;
    /** D26 / D27: the rubric itself */
    rubricApproved: Decision<boolean>;
  };
};
export type DecisionMode = 'draft' | 'approved_only';
type Resolved<T> = {value: T; pending: false} | {value: null; pending: true; id: string};
function decide<T>(d: Decision<T>, mode: DecisionMode): Resolved<T> {
  if (d.approved !== null) return {value: d.approved, pending: false};
  if (mode === 'draft') return {value: d.draft, pending: false};
  return {value: null, pending: true, id: d.id};
}

// ------------------------------------------------------------------------------------------------ ground-truth approval (enforceable)
export type GroundTruthApproval = {approved: boolean; reasons: string[]};
/** live evaluations require the human sign-off fields; an offline demo may run on the draft but every result is stamped unapproved */
export function groundTruthApproval(gt: {reviewedBy?: unknown; reviewedAt?: unknown}, authoredAt = '2026-11-10'): GroundTruthApproval {
  const reasons: string[] = [];
  if (typeof gt.reviewedBy !== 'string' || gt.reviewedBy.trim().length < 2) reasons.push('reviewedBy_missing');
  const at = typeof gt.reviewedAt === 'string' ? Date.parse(gt.reviewedAt) : Number.NaN;
  if (!Number.isFinite(at)) reasons.push('reviewedAt_missing_or_invalid');
  else if (at < Date.parse(authoredAt)) reasons.push('reviewedAt_before_authoring');
  return {approved: reasons.length === 0, reasons};
}
export class LiveEvaluationBlocked extends Error {}
/** throws unless a LIVE run is allowed: approved ground truth, an approved rubric, and the spec bound to the exact ground-truth bytes */
export function assertLiveEvaluationAllowed(input: {gt: {reviewedBy?: unknown; reviewedAt?: unknown}; gtSha256: string; spec: EvaluationSpec}): void {
  const a = groundTruthApproval(input.gt);
  const problems = [...a.reasons];
  if (input.spec.groundTruth.sha256 !== input.gtSha256) problems.push('spec_not_bound_to_this_ground_truth');
  if (input.spec.decisions.rubricApproved.approved !== true) problems.push('rubric_not_approved');
  if (problems.length) throw new LiveEvaluationBlocked(`live evaluation blocked: ${problems.join(', ')}`);
}

// ------------------------------------------------------------------------------------------------ the card ledger
export type CardKind = 'title' | 'quote' | 'cutaway' | 'chapter_omission' | 'quote_omission';
export type CompilerOutcome =
  | {state: 'compiled'; stage: 'S1' | 'S2'; start: number; end: number; adjustments: string[]}
  | {state: 'suppressed'; reason: 'title_window_below_1_4s' | 'quote_overlaps_earlier_card' | 'unexplained'; detail: string}
  | {state: 'passed_through'}
  | {state: 'not_applicable'};
export type DesignOutcome = {state: 'drawn'; design: string} | {state: 'restrained'; reason: string} | {state: 'not_run'} | {state: 'not_applicable'};
export type RenderOutcome = {state: 'visible' | 'not_visible'; psnrDb: number | null; atSec: number} | {state: 'not_rendered'} | {state: 'not_applicable'};
export type LedgerEntry = {
  kind: CardKind;
  id: string;
  words: Range | null;
  text: string;
  proposed: {start: number | null; end: number | null; pastVideoEnd: boolean};
  validator: {state: 'accepted' | 'rejected' | 'omission_recorded'; code?: string};
  compiler: CompilerOutcome;
  design: DesignOutcome;
  render: RenderOutcome;
};
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const textOf = (w: readonly TranscriptWord[], r: Range) => w.slice(r[0], r[1] + 1).map(x => x.text).join(' ');
const inRange = (w: readonly TranscriptWord[], r: unknown): r is Range => Array.isArray(r) && r.length === 2 && Number.isInteger(r[0]) && Number.isInteger(r[1]) && r[0] >= 0 && r[0] <= r[1] && r[1] < w.length;
type RawItem = {id?: unknown; wordRange?: unknown; evidenceRange?: unknown; treatment?: unknown; title?: {wordRange?: unknown}; asset?: unknown; start?: unknown; end?: unknown};

export type StageSpanEvidence = {start: number; end: number; stage: string; design?: {kind: string; reason?: string; mode?: string; layer?: string}};
export type RenderProbe = {atSec: number; psnrDb: number | null; visible: boolean};

/**
 * Compiler outcomes. Since Phase 5.27C the compiler reports its own decision for every accepted title and quote (`compileDirection(...).outcomes`); Phase 5.27D made this harness use those
 * outcomes instead of re-deriving the old rules (the scheduling rules changed). The cross-check stays: a `compiled` outcome without a matching editorial hint, or a `suppressed` one with
 * a hint, is reported as `unexplained`, never hidden.
 */
export function compilerOutcomes(v: ValidatedDirection, durationSec: number): {titles: Map<string, CompilerOutcome>; quotes: Map<string, CompilerOutcome>; compiled: ReturnType<typeof compileDirection>} {
  const compiled = compileDirection(v, durationSec);
  const titles = new Map<string, CompilerOutcome>(), quotes = new Map<string, CompilerOutcome>();
  for (const o of compiled.outcomes) {
    const hint = compiled.editorial.find(h => (o.kind === 'title' ? h.headline === o.text : h.quote === o.text));
    const map = o.kind === 'title' ? titles : quotes;
    if (o.state === 'compiled' && hint) map.set(o.id, {state: 'compiled', stage: o.kind === 'title' ? 'S1' : 'S2', start: hint.start, end: hint.end, adjustments: o.adjustments});
    else if (o.state === 'suppressed' && !hint) map.set(o.id, {state: 'suppressed', reason: o.reason === 'overlaps_earlier_card' ? 'quote_overlaps_earlier_card' : 'title_window_below_1_4s', detail: `${o.detail ?? ''}${o.prioritized ? ` [prioritized: ${o.prioritized}]` : ''}`});
    else map.set(o.id, {state: 'suppressed', reason: 'unexplained', detail: `compiler outcome ${o.state} disagrees with its editorial hints`});
  }
  return {titles, quotes, compiled};
}

/** the full ledger: every PROPOSED item, through validator -> compiler -> design -> render */
export function buildLedger(input: {
  direction: unknown; words: readonly TranscriptWord[]; durationSec: number; assets: readonly CatalogAsset[];
  stageSpans?: readonly StageSpanEvidence[]; renderProbes?: ReadonlyMap<string, RenderProbe>;
}): {ledger: LedgerEntry[]; validated: ValidatedDirection; compiled: ReturnType<typeof compileDirection>} {
  const {words, durationSec} = input;
  const validated = validateSubjectStageDirection(input.direction, words, {assets: input.assets, durationSec});
  const {titles, quotes, compiled} = compilerOutcomes(validated, durationSec);
  const d = (input.direction ?? {}) as {chapters?: RawItem[]; quotes?: RawItem[]; cutaways?: RawItem[]};
  const rejectedCode = (kind: string, id: string) => validated.rejected.find(r => r.kind === kind && r.id === id)?.code;
  const timesOf = (r: Range | null) => (r ? {start: words[r[0]]!.start, end: words[r[1]]!.end, pastVideoEnd: words[r[1]]!.end > durationSec + 1e-6} : {start: null, end: null, pastVideoEnd: false});
  const designFor = (o: CompilerOutcome): DesignOutcome => {
    if (o.state !== 'compiled') return {state: 'not_applicable'};
    if (!input.stageSpans) return {state: 'not_run'};
    const span = input.stageSpans.find(s => Math.abs(s.start - o.start) < 2e-3 && s.stage === o.stage);
    if (!span?.design) return {state: 'restrained', reason: 'no_design_on_span'};
    return span.design.kind === 'restrained' ? {state: 'restrained', reason: span.design.reason ?? 'restrained'} : {state: 'drawn', design: [span.design.kind, span.design.mode ?? span.design.layer].filter(Boolean).join(':')};
  };
  const renderFor = (key: string, o: CompilerOutcome): RenderOutcome => {
    if (o.state !== 'compiled') return {state: 'not_applicable'};
    const p = input.renderProbes?.get(key);
    return p ? {state: p.visible ? 'visible' : 'not_visible', psnrDb: p.psnrDb, atSec: p.atSec} : {state: 'not_rendered'};
  };
  const ledger: LedgerEntry[] = [];
  for (const c of d.chapters ?? []) {
    const id = String(c.id ?? '?');
    const chRange = inRange(words, c.wordRange) ? c.wordRange : null;
    const chCode = rejectedCode('chapter', id);
    if (c.treatment === 'omit') {
      const recorded = validated.omissions.some(o => o.kind === 'chapter' && o.id === id);
      ledger.push({kind: 'chapter_omission', id, words: chRange, text: chRange ? textOf(words, chRange) : '', proposed: timesOf(chRange), validator: recorded ? {state: 'omission_recorded'} : {state: 'rejected', code: chCode ?? 'unknown'}, compiler: {state: 'not_applicable'}, design: {state: 'not_applicable'}, render: {state: 'not_applicable'}});
      continue;
    }
    const t = inRange(words, c.title?.wordRange) ? (c.title!.wordRange as Range) : null;
    const code = chCode ?? rejectedCode('title', id);
    const o: CompilerOutcome = code ? {state: 'not_applicable'} : titles.get(id) ?? {state: 'not_applicable'};
    ledger.push({kind: 'title', id, words: t, text: t ? textOf(words, t) : '', proposed: timesOf(chRange), validator: code ? {state: 'rejected', code} : {state: 'accepted'}, compiler: o, design: designFor(o), render: renderFor(`title:${id}`, o)});
  }
  for (const q of d.quotes ?? []) {
    const id = String(q.id ?? '?');
    const r = inRange(words, q.wordRange) ? q.wordRange : null;
    if (q.treatment === 'omit') {
      ledger.push({kind: 'quote_omission', id, words: r, text: r ? textOf(words, r) : '', proposed: timesOf(r), validator: validated.omissions.some(o => o.kind === 'quote' && o.id === id) ? {state: 'omission_recorded'} : {state: 'rejected', code: rejectedCode('quote', id) ?? 'unknown'}, compiler: {state: 'not_applicable'}, design: {state: 'not_applicable'}, render: {state: 'not_applicable'}});
      continue;
    }
    const code = rejectedCode('quote', id);
    const o: CompilerOutcome = code ? {state: 'not_applicable'} : quotes.get(id) ?? {state: 'not_applicable'};
    ledger.push({kind: 'quote', id, words: r, text: r ? textOf(words, r) : '', proposed: timesOf(r), validator: code ? {state: 'rejected', code} : {state: 'accepted'}, compiler: o, design: designFor(o), render: renderFor(`quote:${id}`, o)});
  }
  for (const k of d.cutaways ?? []) {
    const id = String(k.id ?? '?');
    const code = rejectedCode('cutaway', id);
    const start = typeof k.start === 'number' ? k.start : null, end = typeof k.end === 'number' ? k.end : null;
    ledger.push({kind: 'cutaway', id, words: inRange(words, k.evidenceRange) ? k.evidenceRange : null, text: String(k.asset ?? ''), proposed: {start, end, pastVideoEnd: end !== null && end > durationSec + 1e-6}, validator: code ? {state: 'rejected', code} : {state: 'accepted'}, compiler: code ? {state: 'not_applicable'} : {state: 'passed_through'}, design: {state: 'not_applicable'}, render: {state: 'not_applicable'}});
  }
  return {ledger, validated, compiled};
}

// ------------------------------------------------------------------------------------------------ scoring (R1-R6) on the PROPOSALS
export type CriterionId = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6';
export type CriterionResult = {id: CriterionId; outcome: 'PASS' | 'FAIL' | 'PENDING_HUMAN'; reasons: string[]; mechanical: boolean};
export type Verdict = 'PASS' | 'FAIL' | 'INCOMPLETE' | 'BLOCKED';
export const RUBRIC_TEXT: Record<CriterionId, string> = {
  R1: 'Chapter titles relevant and useful',
  R2: 'Meaningful quote selection',
  R3: 'Omissions editorially justified',
  R4: 'Timing and transcript alignment',
  R5: 'No filler or generic decisions',
  R6: 'No unsupported cutaways',
};
const overlap = (a: Range, b: Range) => Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]) + 1);
const jaccard = (a: Range, b: Range) => { const i = overlap(a, b); return i / (a[1] - a[0] + 1 + b[1] - b[0] + 1 - i); };
const same = (a: Range, b: Range) => a[0] === b[0] && a[1] === b[1];
/** the spec chapter a word range belongs to: the one it overlaps most (ties: the earlier) */
export function specChapterOf(spec: EvaluationSpec, r: Range): SpecChapter | null {
  let best: SpecChapter | null = null, bestN = 0;
  for (const c of spec.chapters) { const n = overlap(c.words, r); if (n > bestN) { best = c; bestN = n; } }
  return best;
}
/** the spec quote a proposed quote is (word-set Jaccard >= 0.8), else null */
export function specQuoteOf(spec: EvaluationSpec, r: Range): SpecQuote | null {
  let best: SpecQuote | null = null, bestJ = 0;
  for (const q of spec.quotes) { const j = jaccard(q.words, r); if (j > bestJ) { best = q; bestJ = j; } }
  return best && bestJ >= 0.8 ? best : null;
}
/** a proposal is filler when at least half of its words lie in a filler span */
export const isFiller = (spec: EvaluationSpec, r: Range) => spec.filler.some(f => overlap(f.words, r) * 2 >= r[1] - r[0] + 1);
const tokens = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}']+/u).filter(Boolean);
const STOP_TITLE = new Set(['a', 'an', 'the', 'of', 'for', 'and', 'to', 'in', 'on', 'my', 'your', 'these', 'this', 'that', 'is', 'so', 'some', 'more']);
/** generic = only generic-praise / stop words; bare number = only number words / digits (plus stop words). Applies to TITLES only (a quote such as "nine hashtags split into three sections" is a statement, not a bare number). */
export function titleIsGeneric(spec: EvaluationSpec, text: string): 'generic' | 'bare_number' | null {
  const t = tokens(text).filter(x => !STOP_TITLE.has(x));
  if (t.length === 0) return 'generic';
  if (t.every(x => spec.numberWords.includes(x) || /^\d+$/.test(x))) return 'bare_number';
  if (t.some(x => spec.genericWords.includes(x))) return 'generic';
  return null;
}

export type HumanJudgement = {criterion: CriterionId; item: string; outcome: 'PASS' | 'FAIL'; by: string; note: string};

export function scoreProposals(input: {spec: EvaluationSpec; ledger: readonly LedgerEntry[]; words: readonly TranscriptWord[]; mode: DecisionMode; directionParsed: boolean; human?: readonly HumanJudgement[]}): CriterionResult[] {
  const {spec, ledger, mode} = input;
  const human = (c: CriterionId, item: string) => input.human?.find(h => h.criterion === c && h.item === item);
  const titles = ledger.filter(e => e.kind === 'title' && e.words);
  const quotes = ledger.filter(e => e.kind === 'quote' && e.words);
  const cutaways = ledger.filter(e => e.kind === 'cutaway');
  const out: CriterionResult[] = [];
  const res = (id: CriterionId, fails: string[], pend: string[], passNote: string, mechanical: boolean): CriterionResult =>
    ({id, outcome: fails.length ? 'FAIL' : pend.length ? 'PENDING_HUMAN' : 'PASS', reasons: fails.length ? fails : pend.length ? pend : [passNote], mechanical});

  // R1 titles (proposed titles, scored whether or not the gate accepted them)
  {
    const fails: string[] = [], pend: string[] = [];
    const policy = decide(spec.decisions.titlePolicy, mode), max = decide(spec.decisions.maxTitles, mode);
    if (max.pending) pend.push(`decision ${max.id} undecided (max titles)`);
    else if (titles.length > max.value) fails.push(`${titles.length} titles proposed > max ${max.value} (3 or more is a FAIL; the old 'exactly 3' gap is closed)`);
    for (const t of titles) {
      const ch = specChapterOf(spec, t.words!);
      if (!ch) { fails.push(`title ${t.id} "${t.text}" lies in no chapter`); continue; }
      if (policy.pending) pend.push(`decision ${policy.id} undecided (title policy for ${ch.id})`);
      else if (policy.value[ch.id] === 'forbidden') { fails.push(`title ${t.id} "${t.text}" on ${ch.id}, where titles are forbidden`); continue; }
      if (ch.strongTitles.some(s => same(s, t.words!))) continue;
      if (ch.weakTitles.some(s => overlap(s, t.words!) > 0) || isFiller(spec, t.words!)) { fails.push(`title ${t.id} "${t.text}" is a listed weak / filler title for ${ch.id}`); continue; }
      const h = human('R1', t.id);
      if (h) { if (h.outcome === 'FAIL') fails.push(`title ${t.id} "${t.text}": human judged not useful (${h.note})`); continue; }
      pend.push(`title ${t.id} "${t.text}" (${ch.id}) is not on the strong or weak list: needs a human judgement`);
    }
    out.push(res('R1', fails, pend, `${titles.length} title(s), all strong / approved`, false));
  }
  // R2 quotes (proposals count: Q4 stays a valid choice although the validator rejects it)
  {
    const fails: string[] = [], pend: string[] = [];
    const req = decide(spec.decisions.requiredQuoteAnyOf, mode), max = decide(spec.decisions.maxQuotes, mode), pairs = decide(spec.decisions.exclusiveQuotePairs, mode);
    const matched = quotes.map(q => ({q, s: specQuoteOf(spec, q.words!)}));
    const ids = new Set(matched.filter(m => m.s).map(m => m.s!.id));
    if (req.pending) pend.push(`decision ${req.id} undecided (required quotes)`);
    else if (!req.value.some(id => ids.has(id))) fails.push(`none of ${req.value.join(' / ')} proposed (proposed: ${[...ids].join(', ') || 'none'})`);
    if (max.pending) pend.push(`decision ${max.id} undecided (max quotes)`);
    else if (quotes.length > max.value) fails.push(`${quotes.length} quotes proposed > max ${max.value}`);
    if (pairs.pending) pend.push(`decision ${pairs.id} undecided (exclusive quote pairs)`);
    else for (const [a, b] of pairs.value) if (ids.has(a) && ids.has(b)) fails.push(`${a} and ${b} both proposed (not both)`);
    for (const m of matched) {
      if (m.s || isFiller(spec, m.q.words!)) continue; // filler quotes are R5
      const h = human('R2', m.q.id);
      if (h) { if (h.outcome === 'FAIL') fails.push(`quote ${m.q.id}: human judged not meaningful (${h.note})`); continue; }
      pend.push(`quote ${m.q.id} "${m.q.text}" matches no labelled quote: needs a human judgement`);
    }
    out.push(res('R2', fails, pend, `proposed ${[...ids].join(', ')}`, false));
  }
  // R3 omissions (C6 always; C1 by decision D1; a chapter is TREATED when a proposed title lies in it or a proposed quote overlaps it)
  {
    const fails: string[] = [], pend: string[] = [];
    // a chapter is treated when a proposed title or quote lies (mostly) in it
    const treated = (ch: SpecChapter) => [...titles, ...quotes].some(e => specChapterOf(spec, e.words!)?.id === ch.id);
    const c6 = spec.chapters.find(c => c.id === 'C6'), c1 = spec.chapters.find(c => c.id === 'C1');
    if (c6 && treated(c6)) fails.push('C6 (call to action) received a treatment');
    const p = decide(spec.decisions.c1Policy, mode);
    if (c1) {
      if (p.pending) pend.push(`decision ${p.id} undecided (C1 policy)`);
      else if (p.value === 'omit' && treated(c1)) fails.push('C1 (demo hook) treated; policy is omit');
      else if (p.value === 'treatment_required' && !treated(c1)) fails.push('C1 not treated; policy requires a treatment');
    }
    const xs = decide(spec.decisions.exclusiveTitleQuote, mode);
    if (xs.pending) pend.push(`decision ${xs.id} undecided (title-or-quote chapters)`);
    else for (const x of xs.value) {
      const hasTitle = titles.some(t => specChapterOf(spec, t.words!)?.id === x.chapter);
      const sq = spec.quotes.find(q => q.id === x.quote);
      if (hasTitle && sq && quotes.some(q => specQuoteOf(spec, q.words!)?.id === sq.id)) fails.push(`${x.chapter} title and ${x.quote} both proposed (title or quote, not both)`);
    }
    out.push(res('R3', fails, pend, 'C1 / C6 handled per policy; no title-and-quote doubling', true));
  }
  // R4 timing + alignment: mechanical, from the validator codes and the video boundary
  {
    const fails: string[] = [];
    if (!input.directionParsed) fails.push('direction does not parse as subject_stage_direction.v1');
    const alignment = new Set(['bad_range', 'text_mismatch', 'timing_mismatch', 'bad_timing', 'asset_not_available', 'overlapping_chapter', 'overlapping_quote', 'overlapping_cutaway', 'title_outside_chapter', 'schema']);
    for (const e of ledger) if (e.validator.state === 'rejected' && alignment.has(e.validator.code ?? '')) fails.push(`${e.kind} ${e.id}: ${e.validator.code}`);
    for (const e of ledger) if ((e.kind === 'title' || e.kind === 'quote') && e.proposed.start !== null && e.proposed.start >= spec.durationSec) fails.push(`${e.kind} ${e.id} starts at ${e.proposed.start} s, at or after the video end ${spec.durationSec} s`);
    for (const e of ledger) if (e.kind === 'cutaway' && e.proposed.end !== null && e.proposed.end > spec.durationSec + 1e-6) fails.push(`cutaway ${e.id} ends at ${e.proposed.end} s, past the video end`);
    // NOT failures: chapter ranges / treatments whose last word ends past the video (word 154 ends 41.96 s > 41.708 s): the compiler clamps every span (recorded in the ledger)
    out.push(res('R4', fails, [], 'indices, echoes and times valid; nothing starts past the video end (items ending on word 154 are clamped, not failed)', true));
  }
  // R5 filler + generic (titles and quotes)
  {
    const fails: string[] = [];
    for (const e of [...titles, ...quotes]) if (isFiller(spec, e.words!)) fails.push(`${e.kind} ${e.id} "${e.text}" is filler`);
    for (const t of titles) { const g = titleIsGeneric(spec, t.text); if (g) fails.push(`title ${t.id} "${t.text}" is ${g}`); }
    out.push(res('R5', fails, [], 'no filler or generic titles / quotes', true));
  }
  // R6 cutaways (zero is the default expected result)
  {
    const fails: string[] = [], pend: string[] = [];
    const ok = decide(spec.decisions.conditionalCutawayAcceptable, mode);
    for (const k of cutaways) {
      const cond = spec.cutaways.conditional.find(c => c.asset === k.text && k.words && overlap(c.window, k.words) > 0);
      if (!cond) { fails.push(`cutaway ${k.id} (${k.text}) is not supported by the speech`); continue; }
      if (ok.pending) pend.push(`decision ${ok.id} undecided (conditional cutaway ${k.text})`);
      else if (!ok.value) fails.push(`cutaway ${k.id} (${k.text}): the conditional cutaway is not acceptable`);
      else { const h = human('R6', k.id); if (!h) pend.push(`cutaway ${k.id}: its "why" must be judged honest by a human`); else if (h.outcome === 'FAIL') fails.push(`cutaway ${k.id}: ${h.note}`); }
    }
    out.push(res('R6', fails, pend, cutaways.length ? 'conditional cutaway accepted' : 'no cutaways (the default expected result)', false));
  }
  return out;
}

/** the decision table, applied to definite outcomes */
function table(c: Record<CriterionId, 'PASS' | 'FAIL'>): 'PASS' | 'FAIL' {
  if (c.R4 === 'FAIL') return 'FAIL';
  if (c.R2 === 'FAIL' || c.R3 === 'FAIL' || c.R6 === 'FAIL') return 'FAIL';
  return [c.R1, c.R5].filter(x => x === 'FAIL').length >= 2 ? 'FAIL' : 'PASS';
}
/** total verdict: BLOCKED (live without approval) | PASS | FAIL | INCOMPLETE (the pending criteria could change the result) */
export function overallVerdict(results: readonly CriterionResult[], opts: {live: boolean; approval: GroundTruthApproval}): {verdict: Verdict; best: 'PASS' | 'FAIL'; worst: 'PASS' | 'FAIL'; pending: CriterionId[]} {
  const pending = results.filter(r => r.outcome === 'PENDING_HUMAN').map(r => r.id);
  const asIf = (p: 'PASS' | 'FAIL') => Object.fromEntries(results.map(r => [r.id, r.outcome === 'PENDING_HUMAN' ? p : r.outcome])) as Record<CriterionId, 'PASS' | 'FAIL'>;
  const best = table(asIf('PASS')), worst = table(asIf('FAIL'));
  if (opts.live && !opts.approval.approved) return {verdict: 'BLOCKED', best, worst, pending};
  return {verdict: best === worst ? best : 'INCOMPLETE', best, worst, pending};
}
