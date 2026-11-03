/**
 * WP33: VO-DRIVEN CUT GRAMMAR (Metromedia ASL). The reference edit (editref.md section 0 / metromedia-grammar.yaml) is driven by the voice-over word timestamps: a NEW clip on every 1-3 word caption group,
 * a mean shot length of ~0.85 s (100-120 shots in 90 s), a 1.5-2.5 s hold ONLY on a headline / money shot / CTA, hard cuts by default (~85 %), and a white chapter card every 15-25 s.
 * This module is the PLANNER for that grammar. PURE: timed words in, cut times + caption groups + holds + chapter cards out. No env, no I/O, no model, no randomness (the chapter jitter is a fixed sequence).
 *
 * Numbers (documented, tested):
 *  - groups: 1-3 words (never more than `VO_GROUP_HARD_MAX_WORDS` = 4, and only to rescue a sub-0.3 s shot). A group closes at punctuation, at a >= 0.25 s pause, at 3 words, or after a content word once
 *    ~0.5 s of speech has built up. A 3-word group that would end on a function word ("the", "of", "and") hands that word to the next group, so the cut lands on a content word.
 *  - cuts: one at each group start (the first group needs one only when speech starts after 0.3 s).
 *  - shot length is clamped to [0.3, 2.5] s; a hold window (headline / money / CTA) lifts the cut inside it for 1.5-2.5 s; a longer silence is split by plain hard cuts (counted in `polish_pace:vo_cuts_split`).
 *  - chapter cards: every 15-25 s (the gaps cycle 17, 19, 16, 22, 18, 20, 15, 24 s: ~18 s on average, deterministic jitter), 0.7-1.0 s long, short connective text taken VERBATIM from the words around the
 *    slot (a year token, "and then" / "but then" style connectives, else a sentence start), never over a hold. The card's own edges are cuts and no cut falls inside it.
 *  - `hardCutShareTarget` 0.85: the share of transitions that should be plain hard cuts (the transition picker biases to it; whips / flashes stay accents).
 */

export type VoWord = {text: string; start: number; end: number};
export type VoWindow = {start: number; end: number};

export type VoCutFlags = {
  headlineWindows?: readonly VoWindow[];
  moneyWindows?: readonly VoWindow[];
  ctaWindows?: readonly VoWindow[];
};

export type VoGroup = {start: number; end: number; words: string[]; /** index of the group's first / last word in the INPUT word array */ firstWord: number; lastWord: number};
export type VoHold = {start: number; end: number; reason: 'headline' | 'money' | 'cta'};
export type VoChapterCard = {at: number; duration: number; text: string; /** index (input array) of the word the card sits on */ wordIndex: number};
export type VoShot = {start: number; end: number; kind: 'group' | 'hold' | 'card' | 'split'};

export type VoCutPlan = {
  cuts: number[];
  groups: VoGroup[];
  holds: VoHold[];
  chapterCards: VoChapterCard[];
  /** The shots between the cuts ([0 .. cut1), [cut1 .. cut2), ... [cutN .. duration)). */
  shots: VoShot[];
  stats: {shotCount: number; meanShotSec: number; hardCutShareTarget: number};
  warnings: string[];
};

export const VO_TARGET_ASL_SEC = 0.85;
export const VO_MIN_SHOT_SEC = 0.3;
export const VO_MAX_SHOT_SEC = 2.5;
export const VO_HOLD_MIN_SEC = 1.5;
export const VO_HOLD_MAX_SEC = 2.5;
export const VO_GROUP_MAX_WORDS = 3;
export const VO_GROUP_HARD_MAX_WORDS = 4;
export const VO_HARD_CUT_SHARE_TARGET = 0.85;
export const VO_CHAPTER_MIN_GAP_SEC = 15;
export const VO_CHAPTER_MAX_GAP_SEC = 25;
export const VO_CHAPTER_MIN_SEC = 0.7;
export const VO_CHAPTER_MAX_SEC = 1.0;
/** The chapter-card gaps, cycled (mean ~18 s, all inside 15-25 s). A fixed sequence stands in for random jitter so the plan is deterministic. */
export const VO_CHAPTER_GAPS_SEC: readonly number[] = [17, 19, 16, 22, 18, 20, 15, 24];
/** The mean shot length is "on target" within this band (0.85 s +- 20 %). */
export const VO_ASL_BAND_SEC = {min: 0.68, max: 1.02} as const;
/** Speech of about this length (after a content word) closes a group. */
const GROUP_CLOSE_SEC = 0.5;
const GROUP_PAUSE_SEC = 0.25;
const EDGE_EPS = 1e-6;

const round = (value: number) => Math.round(value * 1000) / 1000;
const cleanToken = (text: string) => text.replace(/^[^\p{L}\p{N}$%]+|[^\p{L}\p{N}$%]+$/gu, '');
const norm = (text: string) => cleanToken(text).toLowerCase();
const endsClause = (text: string) => /[.,;:!?\u2026\u2014\u2013]["')\u201d\u2019]*$/.test(text);
const endsSentence = (text: string) => /[.!?\u2026]["')\u201d\u2019]*$/.test(text);

/** Words a cut should not land on. Object pronouns (it / him / them / me / us) are left out on purpose: "called him" is a natural place to cut. */
const FUNCTION_WORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'nor', 'so', 'yet', 'if', 'as', 'than', 'then', 'to', 'of', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'into', 'onto', 'over', 'about', 'up', 'out', 'off', 'per',
  'is', 'are', 'was', 'were', 'be', 'been', 'am', 'its', 'that', 'this', 'these', 'those', 'i', 'we', 'you', 'he', 'she', 'they', 'her', 'my', 'our', 'your', 'his', 'their',
  'had', 'has', 'have', 'did', 'do', 'does', 'will', 'would', 'can', 'could', 'should', 'not', 'just', 'when', 'while', 'who', 'which',
]);
export const isFunctionWord = (text: string): boolean => FUNCTION_WORDS.has(norm(text));

type Prepared = VoWord & {index: number};

function prepare(words: readonly VoWord[], durationSec: number): Prepared[] {
  return words
    .map((word, index) => ({text: String(word.text ?? '').trim(), start: Number(word.start), end: Number(word.end), index}))
    .filter(word => word.text !== '' && Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start && word.start < durationSec)
    .sort((a, b) => a.start - b.start || a.index - b.index)
    .map(word => ({...word, end: Math.min(word.end, durationSec)}));
}

/** Spoken words -> caption groups of 1-3 words, closing on a content word where it can. */
function groupWords(words: readonly Prepared[]): VoGroup[] {
  const groups: VoGroup[] = [];
  let i = 0;
  while (i < words.length) {
    let j = i;
    let reason: 'end' | 'clause' | 'size' | 'dur' = 'end';
    for (; ; j += 1) {
      const word = words[j]!;
      const next = words[j + 1];
      const size = j - i + 1;
      const spanned = word.end - words[i]!.start;
      const function_ = isFunctionWord(word.text);
      if (!next) { reason = 'end'; break; }
      if (endsClause(word.text) || next.start - word.end >= GROUP_PAUSE_SEC) { reason = 'clause'; break; }
      if (size >= VO_GROUP_MAX_WORDS) { reason = 'size'; break; }
      if (!function_ && size >= 2 && spanned >= GROUP_CLOSE_SEC) { reason = 'dur'; break; }
      if (!function_ && size === 1 && spanned >= VO_TARGET_ASL_SEC) { reason = 'dur'; break; }
    }
    // never leave a cut dangling on a function word: a size-capped group that ends on one gives it to the next group
    if (reason === 'size' && j > i && isFunctionWord(words[j]!.text)) j -= 1;
    const slice = words.slice(i, j + 1);
    groups.push({start: round(slice[0]!.start), end: round(slice[slice.length - 1]!.end), words: slice.map(word => word.text), firstWord: slice[0]!.index, lastWord: slice[slice.length - 1]!.index});
    i = j + 1;
  }
  return groups;
}

type Cut = {at: number; locked: boolean};

/** A hold covers [start, end]: no cut falls strictly inside it. */
function planHolds(groups: readonly VoGroup[], flags: VoCutFlags, durationSec: number): VoHold[] {
  const requested: Array<VoWindow & {reason: VoHold['reason']}> = [
    ...(flags.moneyWindows ?? []).map(window => ({...window, reason: 'money' as const})),
    ...(flags.headlineWindows ?? []).map(window => ({...window, reason: 'headline' as const})),
    ...(flags.ctaWindows ?? []).map(window => ({...window, reason: 'cta' as const})),
  ]
    .filter(window => Number.isFinite(window.start) && Number.isFinite(window.end) && window.end > window.start)
    .sort((a, b) => a.start - b.start || (a.reason === 'money' ? -1 : 1));
  const holds: VoHold[] = [];
  for (const window of requested) {
    const group = groups.find(item => item.end > window.start + EDGE_EPS && item.start < window.end - EDGE_EPS);
    if (!group) continue;
    if (holds.some(hold => group.start < hold.end + EDGE_EPS && group.start >= hold.start - EDGE_EPS)) continue;
    const wanted = Math.min(VO_HOLD_MAX_SEC, Math.max(VO_HOLD_MIN_SEC, window.end - group.start));
    let end = group.start + wanted;
    // land the hold's end on the next caption-group start when one sits inside the allowed length
    const snap = groups.find(item => item.start >= group.start + VO_HOLD_MIN_SEC - EDGE_EPS && item.start <= group.start + VO_HOLD_MAX_SEC + EDGE_EPS && item.start >= end - 0.35);
    if (snap) end = snap.start;
    end = Math.min(end, durationSec);
    if (durationSec - end < VO_MIN_SHOT_SEC) end = durationSec; // never leave a sliver of a shot after the hold
    if (end - group.start > VO_HOLD_MAX_SEC + EDGE_EPS) end = group.start + VO_HOLD_MAX_SEC;
    if (holds.some(hold => group.start < hold.end && end > hold.start)) continue;
    holds.push({start: round(group.start), end: round(end), reason: window.reason});
  }
  return holds.sort((a, b) => a.start - b.start);
}

const YEAR = /^(1[5-9]\d\d|20\d\d)$/;
const CONNECTIVES: ReadonlySet<string> = new Set(['then', 'but', 'suddenly', 'until', 'however', 'later', 'meanwhile', 'after', 'now', 'soon', 'yet', 'so', 'eventually']);
const cardTextFor = (words: readonly Prepared[], from: number): {text: string; lastWord: number} | null => {
  const picked: Prepared[] = [];
  for (let k = from; k < words.length && picked.length < 3; k += 1) {
    picked.push(words[k]!);
    if (endsClause(words[k]!.text)) break;
  }
  while (picked.length > 1 && isFunctionWord(picked[picked.length - 1]!.text)) picked.pop();
  const text = picked.map(word => cleanToken(word.text)).filter(Boolean).join(' ');
  if (!/[\p{L}\p{N}]/u.test(text)) return null;
  return {text, lastWord: picked.length - 1 + from};
};

/** Chapter cards: one slot every 15-25 s (the gaps cycle), snapped to a caption-group start, clear of the holds. Text is spoken words verbatim. */
function planChapterCards(words: readonly Prepared[], groups: readonly VoGroup[], holds: readonly VoHold[], durationSec: number): {cards: VoChapterCard[]; unplaced: number} {
  const cards: VoChapterCard[] = [];
  const byIndex = new Map(words.map((word, position) => [word.index, position]));
  let previous = 0;
  let unplaced = 0;
  for (let slot = 0; slot < 8; slot += 1) {
    const gap = VO_CHAPTER_GAPS_SEC[slot % VO_CHAPTER_GAPS_SEC.length]!;
    const target = previous + gap;
    const low = previous + VO_CHAPTER_MIN_GAP_SEC;
    const high = Math.min(previous + VO_CHAPTER_MAX_GAP_SEC, durationSec - VO_CHAPTER_MAX_SEC - 0.3);
    if (low > high) break;
    let best: {score: number; card: VoChapterCard} | null = null;
    for (const group of groups) {
      if (group.start < low - EDGE_EPS || group.start > high + EDGE_EPS) continue;
      const position = byIndex.get(group.firstWord);
      if (position === undefined) continue;
      const text = cardTextFor(words, position);
      if (!text) continue;
      const lastWord = words[text.lastWord]!;
      const duration = round(Math.min(VO_CHAPTER_MAX_SEC, Math.max(VO_CHAPTER_MIN_SEC, lastWord.end - group.start + 0.25)));
      const end = group.start + duration;
      if (holds.some(hold => group.start < hold.end + 0.1 && end > hold.start - 0.1)) continue;
      const first = norm(words[position]!.text);
      const second = norm(words[position + 1]?.text ?? '');
      const tokens = words.slice(position, text.lastWord + 1).map(word => norm(word.text));
      let score = 0;
      if (tokens.some(token => YEAR.test(token))) score += 3;
      if (CONNECTIVES.has(first) || (first === 'and' && second === 'then')) score += 2;
      if (position === 0 || endsSentence(words[position - 1]!.text)) score += 1;
      score -= Math.abs(group.start - target) * 0.15;
      if (!best || score > best.score) best = {score, card: {at: round(group.start), duration, text: text.text, wordIndex: group.firstWord}};
    }
    if (!best) {
      unplaced += 1;
      break;
    }
    cards.push(best.card);
    previous = best.card.at;
  }
  return {cards, unplaced};
}

/** The one entry point. `words` are output-time spoken words; `durationSec` is the output duration. */
export function planVoCutGrammar(input: {words: readonly VoWord[]; durationSec: number; flags?: VoCutFlags}): VoCutPlan {
  const durationSec = Number.isFinite(input.durationSec) ? input.durationSec : 0;
  const empty = (): VoCutPlan => ({
    cuts: [],
    groups: [],
    holds: [],
    chapterCards: [],
    shots: durationSec > 0 ? [{start: 0, end: round(durationSec), kind: 'group'}] : [],
    stats: {shotCount: durationSec > 0 ? 1 : 0, meanShotSec: round(Math.max(0, durationSec)), hardCutShareTarget: VO_HARD_CUT_SHARE_TARGET},
    warnings: ['polish_pace:vo_cuts:0'],
  });
  if (durationSec < 2) return empty();
  const words = prepare(input.words, durationSec);
  if (words.length < 3) return empty();

  const groups = groupWords(words);
  const holds = planHolds(groups, input.flags ?? {}, durationSec);
  const {cards, unplaced} = planChapterCards(words, groups, holds, durationSec);

  // 1) a cut at every caption-group start (speech that begins at once needs none)
  const cuts = new Map<number, Cut>();
  const put = (at: number, locked: boolean) => {
    const time = round(at);
    if (time <= EDGE_EPS || time >= durationSec - EDGE_EPS) return;
    const existing = cuts.get(time);
    cuts.set(time, {at: time, locked: locked || Boolean(existing?.locked)});
  };
  groups.forEach((group, index) => {
    if (index > 0 || group.start >= VO_MIN_SHOT_SEC) put(group.start, false);
  });
  // 2) holds and chapter cards each own their span: their edges are locked cuts and nothing cuts inside them
  const owned: Array<{start: number; end: number}> = [...holds, ...cards.map(card => ({start: card.at, end: round(card.at + card.duration)}))];
  for (const span of owned) {
    for (const key of [...cuts.keys()]) if (key > span.start + EDGE_EPS && key < span.end - EDGE_EPS) cuts.delete(key);
    put(span.start, true);
    put(span.end, true);
  }
  // 3) minimum shot length: an unlocked cut that would leave a shot under 0.3 s is dropped (a locked one displaces an unlocked neighbour)
  const sorted = [...cuts.values()].sort((a, b) => a.at - b.at);
  const kept: Cut[] = [];
  for (const cut of sorted) {
    const previous = kept[kept.length - 1];
    const gap = cut.at - (previous?.at ?? 0);
    if (gap >= VO_MIN_SHOT_SEC - EDGE_EPS) {
      kept.push(cut);
    } else if (cut.locked) {
      if (previous && !previous.locked) kept.pop();
      kept.push(cut);
    }
  }
  while (kept.length > 0 && durationSec - kept[kept.length - 1]!.at < VO_MIN_SHOT_SEC - EDGE_EPS && !kept[kept.length - 1]!.locked) kept.pop();

  // 4) maximum shot length: a longer silence is split by plain hard cuts
  const boundaries = [0, ...kept.map(cut => cut.at), round(durationSec)];
  const final: number[] = [];
  const splitCuts = new Set<number>();
  for (let index = 1; index < boundaries.length; index += 1) {
    const from = boundaries[index - 1]!;
    const to = boundaries[index]!;
    const pieces = Math.ceil((to - from) / VO_MAX_SHOT_SEC - EDGE_EPS);
    for (let piece = 1; piece < pieces; piece += 1) {
      const at = round(from + ((to - from) * piece) / pieces);
      final.push(at);
      splitCuts.add(at);
    }
    if (index < boundaries.length - 1) final.push(to);
  }
  final.sort((a, b) => a - b);

  const holdStarts = new Set(holds.map(hold => round(hold.start)));
  const cardStarts = new Set(cards.map(card => round(card.at)));
  const edges = [0, ...final, round(durationSec)];
  const shots: VoShot[] = edges.slice(1).map((end, index) => {
    const start = edges[index]!;
    const kind: VoShot['kind'] = cardStarts.has(start) ? 'card' : holdStarts.has(start) ? 'hold' : splitCuts.has(start) ? 'split' : 'group';
    return {start, end, kind};
  });
  const mean = round(durationSec / shots.length);

  const warnings = [`polish_pace:vo_cuts:${final.length}`, `polish_pace:mean_asl:${mean.toFixed(2)}`];
  if (mean < VO_ASL_BAND_SEC.min || mean > VO_ASL_BAND_SEC.max) warnings.push(`polish_pace:vo_asl_off_target:${mean.toFixed(2)}`);
  if (splitCuts.size > 0) warnings.push(`polish_pace:vo_cuts_split:${splitCuts.size}`);
  if (holds.length > 0) warnings.push(`polish_pace:vo_holds:${holds.length}`);
  if (cards.length > 0) warnings.push(`polish_pace:vo_chapter_cards:${cards.length}`);
  if (unplaced > 0) warnings.push(`polish_pace:vo_chapter_unplaced:${unplaced}`);

  return {
    cuts: final,
    groups,
    holds,
    chapterCards: cards,
    shots,
    stats: {shotCount: shots.length, meanShotSec: mean, hardCutShareTarget: VO_HARD_CUT_SHARE_TARGET},
    warnings,
  };
}

/** Money shots from the speech: a currency sign or a number followed by million / billion / thousand / percent, with the number and the unit noun ("six billion dollars"). */
export function moneyWindowsOf(words: readonly VoWord[]): VoWindow[] {
  const UNIT = /^(thousand|million|billion|trillion|k|m|bn|percent|grand)$/;
  const NOUN = /^(dollars?|bucks|euros?|pounds?|users|customers)$/;
  const NUMBER = /^(\$?\d[\d,.]*[kmb]?|\$|one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|a|half)$/;
  const windows: VoWindow[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const token = norm(words[index]!.text);
    const currency = /^\$\d/.test(cleanToken(words[index]!.text)) || /^\d[\d,.]*(%|k|m|bn)$/.test(token);
    if (!currency && !UNIT.test(token)) continue;
    let from = index;
    if (UNIT.test(token) && index > 0 && NUMBER.test(norm(words[index - 1]!.text))) from = index - 1;
    let to = index;
    if (UNIT.test(token) && index + 1 < words.length && NOUN.test(norm(words[index + 1]!.text))) to = index + 1;
    const start = words[from]!.start;
    const end = words[to]!.end;
    const last = windows[windows.length - 1];
    if (last && start < last.end + 0.2) last.end = Math.max(last.end, end);
    else windows.push({start, end});
  }
  return windows;
}

/** The call to action: the closing words that ask for a follow / subscribe / comment / link (only within the last 6 s). */
export function ctaWindowsOf(words: readonly VoWord[], durationSec: number): VoWindow[] {
  const CTA = /^(follow|subscribe|comment|share|link|download|join|sign|like)$/;
  const index = words.findIndex(word => word.start >= durationSec - 6 && CTA.test(norm(word.text)));
  if (index < 0) return [];
  return [{start: words[index]!.start, end: words[words.length - 1]!.end}];
}
