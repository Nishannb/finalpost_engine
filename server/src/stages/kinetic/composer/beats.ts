/**
 * P2 Beat analysis: transcript words -> beats (phrases with a meaning). Deterministic, pure, no model: the Director may refine the tags, but the composer must vary without it.
 *
 * A beat is a short reading unit (0.6..3.4 s, <= 7 words) with a type (stat / list / contrast / question / cta / warning / claim / definition / story / hook / plain), an intensity
 * and its key words. Types bind content to compositions (a number becomes a counter, opposing words become a split, a question becomes a card): that is where variety between
 * videos comes from, because two talks never say the same things in the same order.
 */
import {normToken} from '../transcript.ts';
import type {KineticWord} from '../schema.ts';
import type {Beat, BeatType, StatInfo} from './types.ts';

/** wider than the playbook's FUNCTION_WORDS: words that never carry a beat */
export const STOP_WORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'i', 'me', 'my', 'mine', 'to', 'of', 'and', 'or', 'you', 'your', 'yours', 'we', 'our', 'us', 'it', 'its', "it's", 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'for', 'in', 'on', 'at', 'by',
  'that', 'this', 'these', 'those', 'like', 'just', 'so', 'but', 'if', 'then', 'than', 'with', 'from', 'as', 'do', 'does', 'did', "don't", 'have', 'has', 'had', 'they', 'them', 'their', 'there', "they're", 'he',
  'she', 'his', 'her', 'him', 'what', 'which', 'who', 'when', 'where', 'why', 'how', 'all', 'can', 'will', 'would', 'could', 'should', 'about', 'into', 'out', 'up', 'down', 'over', 'also', 'very', 'really',
  'not', 'no', 'yes', 'get', 'got', 'going', 'gonna', 'want', 'one', 'some', 'any', 'more', 'most', 'much', 'many', "that's", "i'm", "you're", "we're", 'am', 'let', "let's", 'because', 'too', 'even', 'way',
  'thing', 'things', 'here', 'now', 'well', 'okay', 'ok', 'um', 'uh', 'yeah', 'oh', 'know', 'think', 'make', 'see', 'say', 'said', 'go', 'come', 'take', 'put', 'every', 'each', 'other', 'another', 'again',
]);

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000, million: 1e6, billion: 1e9,
};
const ORDINALS: Record<string, number> = {first: 1, firstly: 1, second: 2, secondly: 2, third: 3, thirdly: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, finally: 9, lastly: 9, last: 9, bonus: 10};
const ANTONYMS: ReadonlyArray<[string, string]> = [
  ['free', 'paid'], ['before', 'after'], ['old', 'new'], ['cheap', 'expensive'], ['small', 'big'], ['easy', 'hard'], ['slow', 'fast'], ['lose', 'win'], ['problem', 'solution'], ['start', 'finish'],
  ['wrong', 'right'], ['start', 'complete'], ['begin', 'finish'], ['less', 'more'], ['bad', 'good'], ['weak', 'strong'], ['poor', 'rich'], ['fear', 'confidence'], ['potential', 'follow'], ['talk', 'action'], ['quiet', 'loud'], ['silence', 'talk'],
];
const INTENSIFIERS = /^(secret|biggest|best|worst|only|most|never|always|everything|nothing|exclusive|simple|easier|easiest|better|massive|insane|crazy|huge|important|real|true|truth|literally|guaranteed|proven|fastest|viral)$/;
const CTA_WORDS = /^(follow|subscribe|comment|share|save|link|bio|dm|check|join|click|download|register|grab)$/;
const WARNING_WORDS = /^(never|don't|dont|stop|avoid|mistake|mistakes|wrong|worst|quit|careful|warning)$/;
const CONTRAST_MARKERS = /^(but|instead|however|versus|vs|rather|although|yet|whereas)$/;
const QUESTION_LEAD = /^(have|do|does|did|are|is|can|could|would|why|what|how|when|where|who|ever|isn't|aren't|don't)$/;
const DEFINITION = /\b(is called|means|is when|that's what|this is what|is the)\b/;
const STORY = /\b(i was|when i|i remember|last year|one day|i used to|years ago|i started|my first)\b/;

const endsSentence = (t: string) => /[.!?…]["')\]]*$/.test(t);
const endsComma = (t: string) => /[,;:]["')\]]*$/.test(t);
export const isContent = (t: string): boolean => { const n = normToken(t); return n.length >= 3 && !STOP_WORDS.has(n) && !/^\d+$/.test(n); };

/** A spoken number token: "30k", "$5,000", "50%", "1.5m", "3", "three", "hundred". null = not a number. */
export function parseNumberToken(raw: string): {value: number; decimals: number; prefix: string; suffix: string} | null {
  const t = raw.trim().replace(/[.,!?;:]+$/, '');
  const m = /^(\$|€|£)?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(k|m|b|%|x|\+)?$/i.exec(t);
  if (m) {
    const num = Number(m[2]!.replace(/,/g, ''));
    if (!Number.isFinite(num)) return null;
    const unit = (m[3] ?? '').toLowerCase();
    const decimals = m[2]!.includes('.') ? Math.min(2, m[2]!.split('.')[1]!.length) : 0;
    return {value: num, decimals, prefix: m[1] ?? '', suffix: unit === 'k' ? 'K' : unit === 'm' ? 'M' : unit === 'b' ? 'B' : unit === '%' ? '%' : unit === 'x' ? 'X' : unit === '+' ? '+' : ''};
  }
  const n = normToken(t);
  if (n in NUMBER_WORDS) return {value: NUMBER_WORDS[n]!, decimals: 0, prefix: '', suffix: ''};
  return null;
}

/** The stat of a phrase: a number with a unit / currency / magnitude, or a "from X to Y" range. Small bare counts ("three steps") are not stats. */
export function findStat(words: readonly KineticWord[], a: number, b: number): StatInfo | null {
  const nums: Array<{idx: number; v: NonNullable<ReturnType<typeof parseNumberToken>>}> = [];
  for (let i = a; i <= b; i += 1) { const v = parseNumberToken(words[i]!.text); if (v) nums.push({idx: i, v}); }
  if (nums.length === 0) return null;
  const unitWord = (i: number): {prefix?: string; suffix?: string} | null => {
    const n = normToken(words[i]?.text ?? '');
    if (n === 'percent' || n === 'percentage') return {suffix: '%'};
    if (n === 'dollars' || n === 'bucks') return {prefix: '$'};
    if (n === 'k' || n === 'thousand') return {suffix: 'K'};
    if (n === 'million') return {suffix: 'M'};
    if (n === 'billion') return {suffix: 'B'};
    if (n === 'x' || n === 'times') return {suffix: 'X'};
    return null;
  };
  // "from 0 to 30k": a range
  const lower = words.slice(a, b + 1).map(w => normToken(w.text));
  if (nums.length >= 2) {
    const [p, q] = [nums[0]!, nums[nums.length - 1]!];
    const between = lower.slice(p.idx - a + 1, q.idx - a);
    if (between.includes('to') && q.v.value > p.v.value) {
      const u = unitWord(q.idx + 1);
      const suffix = q.v.suffix || u?.suffix || '';
      const prefix = q.v.prefix || p.v.prefix || u?.prefix || '';
      return {from: p.v.value, to: q.v.value, decimals: q.v.decimals, prefix, suffix, wordIdx: [...range(p.idx, q.idx), ...(u ? [q.idx + 1] : [])]};
    }
  }
  const best = [...nums].sort((x, y) => y.v.value - x.v.value)[0]!;
  const u = unitWord(best.idx + 1);
  const suffix = best.v.suffix || u?.suffix || '';
  const prefix = best.v.prefix || u?.prefix || '';
  // magnitude words that follow a small number ("3 million") are already a unit
  if (!suffix && !prefix && best.v.value < 10) return null;
  if (!suffix && !prefix && best.v.value >= 1900 && best.v.value <= 2100) return null; // a year
  return {from: 0, to: best.v.value, decimals: best.v.decimals, prefix, suffix, wordIdx: [best.idx, ...(u ? [best.idx + 1] : [])]};
}

function range(a: number, b: number): number[] { const out: number[] = []; for (let i = a; i <= b; i += 1) out.push(i); return out; }

/** Topic words: content tokens the speaker repeats (they make better heroes than one-off words). */
export function topicScores(words: readonly KineticWord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const w of words) { if (!isContent(w.text)) continue; const n = normToken(w.text); counts.set(n, (counts.get(n) ?? 0) + 1); }
  const max = Math.max(1, ...counts.values());
  const out = new Map<string, number>();
  for (const [k, v] of counts) out.set(k, v > 1 ? v / max : 0);
  return out;
}

/** Rank a word as a hero candidate. */
export function heroScore(w: KineticWord, topics: Map<string, number>): number {
  const n = normToken(w.text);
  if (!isContent(w.text) && !parseNumberToken(w.text)) return -1;
  let s = w.emphasisScore;
  s += Math.min(0.18, Math.max(0, n.length - 4) * 0.03);
  if (/^[A-Z]/.test(w.text.trim())) s += 0.03;
  if (INTENSIFIERS.test(n)) s += 0.22;
  if (parseNumberToken(w.text)) s += 0.25;
  s += 0.2 * (topics.get(n) ?? 0);
  if (/ing$|ly$/.test(n)) s -= 0.06;
  return s;
}

/** Split words into reading units. */
export function segmentPhrases(words: readonly KineticWord[], fps: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const pause = Math.round(0.35 * fps);
  const maxFrames = Math.round(3.4 * fps);
  let start = 0;
  const isMarkerAt = (i: number) => {
    const n = normToken(words[i]!.text);
    if (n in ORDINALS && n !== 'last' && (endsComma(words[i]!.text) || i === 0 || endsSentence(words[i - 1]!.text) || n === 'bonus')) return true;
    if (n === 'number' && words[i + 1] && parseNumberToken(words[i + 1]!.text)) return true;
    if (n === 'step' && words[i + 1] && parseNumberToken(words[i + 1]!.text)) return true;
    return false;
  };
  const SOFT = 6, HARD = 9;
  const goodEnd = (i: number): boolean => {
    const w = words[i]!, n1 = words[i + 1], n2 = words[i + 2];
    if (!isContent(w.text)) return false;
    if (n1 && parseNumberToken(n1.text)) return false;
    if (n1 && normToken(n1.text) === 'to' && n2 && parseNumberToken(n2.text)) return false;
    return true;
  };
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i]!;
    const len = i - start + 1;
    const next = words[i + 1];
    if (!next) { out.push([start, i]); break; }
    const gap = next.startFrame - w.endFrame;
    const span = w.endFrame - words[start]!.startFrame;
    const nn = normToken(next.text);
    const breakHere =
      endsSentence(w.text) ||
      gap >= pause ||
      (endsComma(w.text) && len >= 3) ||
      len >= HARD ||
      span >= maxFrames ||
      (len >= SOFT && goodEnd(i) && STOP_WORDS.has(nn)) ||
      (isMarkerAt(i + 1) && len >= 1) ||
      (CONTRAST_MARKERS.test(nn) && len >= 3) ||
      ((nn === 'because' || nn === 'so' || nn === 'and' || nn === 'where' || nn === 'which') && len >= 4);
    if (breakHere) { out.push([start, i]); start = i + 1; }
  }
  // merge orphans (one short word): forward within the sentence, else backward when the previous phrase does not end a sentence
  const merged: Array<[number, number]> = [];
  for (let k = 0; k < out.length; k += 1) {
    const [a, b] = out[k]!;
    const short = b - a === 0 && words[b]!.endFrame - words[a]!.startFrame < Math.round(0.45 * fps) && !isMarkerAt(a);
    const prev = merged[merged.length - 1];
    if (short && prev && !endsSentence(words[prev[1]]!.text) && prev[1] - prev[0] < HARD) { merged[merged.length - 1] = [prev[0], b]; continue; }
    if (short && k + 1 < out.length && !endsSentence(words[b]!.text) && out[k + 1]![1] - out[k + 1]![0] < HARD) { out[k + 1] = [a, out[k + 1]![1]]; continue; }
    merged.push([a, b]);
  }
  return merged;
}

const NEGATIONS: ReadonlySet<string> = new Set(['not', "don't", 'dont', "doesn't", "isn't", "aren't", 'never', 'no', "didn't", "won't", "can't"]);
const stem = (t: string) => t.replace(/(ing|es|s|ed)$/, '');
/** "You don't have a potential problem. You have a follow through problem." / "It's not about talent. It's about execution.": a negated line answered by its positive twin. */
function parallelNegation(words: readonly KineticWord[], prev: Beat, a: number, b: number, topics: Map<string, number>): {a: number; b: number} | null {
  const prevIdx = range(prev.wordRange[0], prev.wordRange[1]);
  const prevToks = prevIdx.map(i => normToken(words[i]!.text));
  if (!prevToks.some(t => NEGATIONS.has(t))) return null;
  const curIdx = range(a, b);
  const curToks = curIdx.map(i => normToken(words[i]!.text));
  if (curToks.some(t => NEGATIONS.has(t))) return null;
  const plain = prevToks.filter(t => !NEGATIONS.has(t));
  const pair = curToks.slice(0, 2).join(' ');
  const sharesLead = curToks.length >= 2 && plain.some((t, k) => `${t} ${plain[k + 1] ?? ''}` === pair);
  const firstContent = curToks.find(t => t.length >= 3 && !STOP_WORDS.has(t));
  const sharesVerb = Boolean(firstContent && plain.some(t => stem(t) === stem(firstContent)));
  if (!sharesLead && !sharesVerb) return null;
  const shared = new Set(plain.map(stem));
  const pick = (idx: number[]) => idx.filter(i => isContent(words[i]!.text)).sort((x, y) => heroScore(words[y]!, topics) - heroScore(words[x]!, topics))[0];
  const curOnly = curIdx.filter(i => !shared.has(stem(normToken(words[i]!.text))));
  const pa = pick(prevIdx.filter(i => !curToks.map(stem).includes(stem(normToken(words[i]!.text)))));
  const pb = pick(curOnly);
  return pa !== undefined && pb !== undefined ? {a: pa, b: pb} : null;
}

const BASE_INTENSITY: Record<BeatType, number> = {hook: 0.9, stat: 0.85, warning: 0.78, contrast: 0.75, cta: 0.7, question: 0.65, list: 0.62, claim: 0.58, definition: 0.5, story: 0.4, plain: 0.3};

export function analyzeBeats(words: readonly KineticWord[], fps: number): Beat[] {
  if (words.length === 0) return [];
  const phrases = segmentPhrases(words, fps);
  const topics = topicScores(words);
  const total = words[words.length - 1]!.endFrame;
  let sentence = 0;
  const beats: Beat[] = [];
  const sentenceAt: number[] = [];
  for (let i = 0; i < words.length; i += 1) { sentenceAt.push(sentence); if (endsSentence(words[i]!.text)) sentence += 1; }
  phrases.forEach(([a, b], k) => {
    const ws = words.slice(a, b + 1);
    const toks = ws.map(w => normToken(w.text));
    const text = toks.join(' ');
    const last = ws[ws.length - 1]!;
    const startFrame = ws[0]!.startFrame, endFrame = last.endFrame;
    const ranked = range(a, b).filter(i => heroScore(words[i]!, topics) >= 0).sort((x, y) => heroScore(words[y]!, topics) - heroScore(words[x]!, topics) || x - y);
    let type: BeatType = 'plain';
    const beat: Beat = {id: `b${k}`, idx: k, wordRange: [a, b], startFrame, endFrame, type, intensity: 0, keyIdx: ranked.slice(0, 3), hook: startFrame < Math.round(3.5 * fps), sentenceIndex: sentenceAt[a]!, endsSentence: endsSentence(last.text)};
    // list marker
    const lead = toks[0] === 'and' || toks[0] === 'so' || toks[0] === 'a' ? 1 : 0;
    const t0 = toks[lead] ?? '';
    if ((t0 in ORDINALS && t0 !== 'last') || ((t0 === 'number' || t0 === 'step') && toks[lead + 1] && parseNumberToken(toks[lead + 1]!))) {
      const ordinal = t0 in ORDINALS ? ORDINALS[t0]! : parseNumberToken(toks[lead + 1]!)!.value;
      beat.listMarker = {wordIdx: t0 in ORDINALS ? [a + lead] : [a + lead, a + lead + 1], ordinal};
      type = 'list';
    }
    const stat = findStat(words, a, b);
    const markerPos = toks.findIndex(t => CONTRAST_MARKERS.test(t));
    const prev = beats[beats.length - 1];
    const antonym = (() => {
      if (!prev) return null;
      const prevToks = new Map<string, number>();
      for (let i = prev.wordRange[0]; i <= prev.wordRange[1]; i += 1) prevToks.set(normToken(words[i]!.text), i);
      const prev2 = beats[beats.length - 2];
      if (prev2) for (let i = prev2.wordRange[0]; i <= prev2.wordRange[1]; i += 1) if (!prevToks.has(normToken(words[i]!.text))) prevToks.set(normToken(words[i]!.text), i);
      for (const [x, y] of ANTONYMS) {
        for (const [p, q] of [[x, y], [y, x]] as const) {
          const bi = toks.indexOf(q);
          if (bi >= 0 && prevToks.has(p) && !toks.includes(p)) return {a: prevToks.get(p)!, b: a + bi};
        }
      }
      return null;
    })();
    if (type !== 'list') {
      if (stat) { type = 'stat'; beat.stat = stat; }
      else if (/\?["')\]]*$/.test(last.text) || (QUESTION_LEAD.test(t0) && toks.slice(0, 3).includes('you') && endsSentence(last.text) && !/\.$/.test(last.text))) type = 'question';
      else if (markerPos >= 1 && markerPos < toks.length - 1) {
        const before = range(a, a + markerPos - 1).filter(i => isContent(words[i]!.text)).sort((x, y) => heroScore(words[y]!, topics) - heroScore(words[x]!, topics));
        const after = range(a + markerPos + 1, b).filter(i => isContent(words[i]!.text)).sort((x, y) => heroScore(words[y]!, topics) - heroScore(words[x]!, topics));
        if (before[0] !== undefined && after[0] !== undefined) { type = 'contrast'; beat.contrast = {a: before[0], b: after[0]}; }
      }
      if (type === 'plain' && antonym) { type = 'contrast'; beat.contrast = antonym; }
      if (type === 'plain' && prev) {
        const par = parallelNegation(words, prev, a, b, topics);
        if (par) { type = 'contrast'; beat.contrast = par; }
      }
      if (type === 'plain' && markerPos === 0 && prev && prev.keyIdx[0] !== undefined && ranked[0] !== undefined) { type = 'contrast'; beat.contrast = {a: prev.keyIdx[0], b: ranked[0]}; }
      if (type === 'plain' && startFrame > total * 0.72 && toks.some(t => CTA_WORDS.test(t))) type = 'cta';
      if (type === 'plain' && toks.some(t => WARNING_WORDS.test(t))) type = 'warning';
      if (type === 'plain' && DEFINITION.test(text)) type = 'definition';
      if (type === 'plain' && STORY.test(text)) type = 'story';
      if (type === 'plain' && (toks.some(t => INTENSIFIERS.test(t)) || ws.some(w => w.emphasisScore >= 0.65) || /!$/.test(last.text))) type = 'claim';
      if (type === 'plain' && beat.hook) type = 'hook';
    }
    beat.type = type;
    if (type === 'stat' && stat) beat.keyIdx = [...new Set([stat.wordIdx[stat.wordIdx.length - 1]!, ...beat.keyIdx])].slice(0, 3);
    if (type === 'contrast' && beat.contrast) beat.keyIdx = [...new Set([beat.contrast.b, ...beat.keyIdx])].slice(0, 3);
    if (type === 'list' && beat.listMarker) beat.keyIdx = beat.keyIdx.filter(i => !beat.listMarker!.wordIdx.includes(i));
    const maxEmph = Math.max(...ws.map(w => w.emphasisScore));
    beat.intensity = Math.min(1, BASE_INTENSITY[type] + 0.15 * maxEmph + (/!$/.test(last.text) ? 0.08 : 0) + (beat.hook ? 0.08 : 0));
    beats.push(beat);
  });
  return beats;
}

/** a short human-readable summary (reports, tests) */
export const beatLine = (b: Beat, words: readonly KineticWord[]): string => `${b.id} ${b.type}${b.hook ? '+hook' : ''} ${b.intensity.toFixed(2)} "${words.slice(b.wordRange[0], b.wordRange[1] + 1).map(w => w.text).join(' ')}" key=${b.keyIdx.map(i => words[i]?.text).join('/')}`;
