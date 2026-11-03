/**
 * WP55 KINETIC_TYPE_STORYTELLING (pure: no LLM, no env, no IO). Selection layer for the ten overlay templates clip_45..54 (toolkit `kinetic_text`). It turns transcript MEANING into candidates: which sentence, which exact
 * spoken words, which template, and why. `planCraftTemplateBeats` owns placement (caps, blocked ranges, gaps, allowlist) and the binder re-verifies every string against the spoken words, so nothing here can ship copy that
 * was not said (or provided as brand data).
 *
 * Meaning -> template:
 *   a spoken quantity            -> type_impact_number          a strong claim / key concept   -> type_environmental_hero
 *   a short memorable statement  -> type_staggered_phrase       a contrast / two-part message  -> type_split_color_headline
 *   one important word           -> type_kinetic_word_pop       a concluding argument          -> type_stacked_statement
 *   followers / engagement       -> type_floating_social_proof  (ONLY with creator assets or a spoken figure)
 *   a brand introduction         -> type_logo_reveal            (ONLY with a logo / brand name)
 *   a final invitation           -> type_kinetic_cta            a pointed / superlative word   -> type_illustrated_emphasis
 *   a concept being named / a from-X-to-Y contrast -> type_text_match_cut (full-frame; one keyword pinned in a highlight box while the layout hard-cuts)
 */
import type {MotionTemplateId, MotionTemplateIntent, MotionTemplateWord} from './motionTemplateCatalog.ts';
import {spokenNumbers} from './visualBackend/sceneSpec.ts';

export type KineticSentence = {text: string; start: number; end: number; words: readonly MotionTemplateWord[]};

export type KineticCandidate = {
  templateId: MotionTemplateId;
  intent: MotionTemplateIntent;
  /** Seconds of the first spoken word of the on-screen text. */
  at: number;
  /** Seconds at which the on-screen text finishes being spoken. */
  spokenEnd: number;
  hint: Record<string, unknown>;
  /** 0..1, higher wins when the sparse budget is spent. */
  score: number;
  /** Human-readable reason (logged as a planner warning, asserted in tests). */
  reason: string;
  /** The exact words shown (for the caption-duplication rule). */
  shown: string;
};

export type KineticContext = {
  durationSec: number;
  logoSrc?: string;
  brandName?: string;
  socialImageUrls?: readonly string[];
  /** Subject bounding box (fractions) when the perception stage provides one. */
  subjectBox?: {x: number; y: number; w: number; h: number};
  /** A person matte exists for this source (real occlusion possible). */
  hasMatte?: boolean;
  /** Phase D: kinetic-led planning WITH a usable matte. The hero is boosted and may fire on a strong short phrase (not only an impact keyword). Never set for the sparse planner or without a matte: scoring is then unchanged. */
  preferMatte?: boolean;
  /** The LIVE DIRECTOR chose this template for this exact phrase: the semantic cue gates (claim word, contrast marker, closing stretch ...) are waived, the structural + grounding + asset gates are NOT. */
  directed?: boolean;
};

/** Director-facing template names -> catalog ids (the single mapping the schema enum, the compiler and the planner share). */
export const KINETIC_TYPE_TEMPLATES = {
  type_environmental_hero: 'clip_45_type_environmental_hero',
  type_impact_number: 'clip_46_type_impact_number',
  type_staggered_phrase: 'clip_47_type_staggered_phrase',
  type_split_color_headline: 'clip_48_type_split_color_headline',
  type_kinetic_word_pop: 'clip_49_type_kinetic_word_pop',
  type_stacked_statement: 'clip_50_type_stacked_statement',
  type_floating_social_proof: 'clip_51_type_floating_social_proof',
  type_logo_reveal: 'clip_52_type_logo_reveal',
  type_kinetic_cta: 'clip_53_type_kinetic_cta',
  type_illustrated_emphasis: 'clip_54_type_illustrated_emphasis',
  type_text_match_cut: 'clip_55_type_text_match_cut',
} as const satisfies Record<string, MotionTemplateId>;
export type KineticTypeName = keyof typeof KINETIC_TYPE_TEMPLATES;
export const KINETIC_TYPE_NAMES = Object.keys(KINETIC_TYPE_TEMPLATES) as KineticTypeName[];
export const KINETIC_TYPE_MARKS = ['underline', 'circle', 'arrow', 'burst', 'bracket'] as const;

export const KINETIC_MAX_BEATS_PER_SEC = 1 / 7;

/** Total kinetic-type beats an edit of this length may carry (>= 1 from 8 s up, then one per ~7 s, never more than 5). */
export function kineticBeatBudget(durationSec: number): number {
  if (!(durationSec >= 8)) return 0;
  return Math.min(5, Math.max(1, Math.floor(durationSec * KINETIC_MAX_BEATS_PER_SEC)));
}

const STOP = new Set(
  'a an the and or but if then so to of in on at for from with without by as is are was were be been being it its this that these those i you he she we they me him her us them my your his our their what which who how when where why not no yes just really very into over under again about also than too can could would should will may might must do does did have has had get got go going gets here there'.split(/\s+/),
);
const IMPACT = /^(never|always|nothing|everything|only|stop|biggest|real|truth|secret|changed|best|worst|free|simple|wrong|different|attention|growth|results?|trust|freedom|success|impossible|bigger|better|massive|huge|powerful|story|brand|leads?|viral|win|win(?:ning)?|proof|guaranteed)$/i;
const CONTRAST = /^(not|instead|rather|versus|vs|but|without|less|more)$/i;
const CTA_CUE = /\b(dm me|message me|text me|call me|book a call|follow me|follow|subscribe|link in (?:my )?bio|comment|click|tap|visit|reach out|contact me|sign up|get started|learn more|send me)\b/i;
const BRAND_INTRO = /\b(i'?m|i am|we'?re|we are|this is|welcome to|introducing|meet|my name is|my company|my brand|at)\b/i;
const CONCLUDE = /\b(so|that'?s why|which means|bottom line|in the end|because|therefore|remember|what matters|the point|that'?s how)\b/i;
const SOCIAL_CUE = /\b(followers?|likes?|views?|comments?|shares?|saves?|engagement|audience|viral|reach|impressions?|subscribers?)\b/i;
const POINTING = /^(here|below|link|watch|look)$/i;
const SUPERLATIVE = /^(best|only|most|first|number|biggest|worst|top)$/i;
const SIZE = /^(huge|massive|double|triple|10x|twice|explode[sd]?|skyrocket(?:ed)?)$/i;
const KEYMARK = /^(key|important|must|rule|focus|priority|matters?|essential)$/i;
const BRACKET = /^(between|inside|within|frame[sd]?|around)$/i;
const UNIT = /^(seconds?|minutes?|hours?|days?|weeks?|months?|years?|percent|people|clients|customers|users|followers|views|likes|videos|leads|listings|homes|dollars)$/i;
const SCALE: Record<string, string> = {thousand: 'K', k: 'K', million: 'M', m: 'M', billion: 'B'};

const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}'%$]+/gu, '');
const bare = (t: string) => t.replace(/^[\s,;:.\-–—"'(]+|[\s,;:.!?"')]+$/g, '').trim();
const phraseOf = (words: readonly MotionTemplateWord[]) => bare(words.map(w => w.text).join(' '));
const chars = (t: string) => Array.from(t).length;
const isContent = (w: string) => {
  const n = norm(w);
  return n.length >= 3 && !STOP.has(n) && !/^\d+$/.test(n);
};

/** Index of the strongest single word of a sentence slice (impact cue first, then the longest content word, ties -> later word); -1 when none qualifies (<= 14 chars). */
export function keyWordIndex(words: readonly MotionTemplateWord[]): number {
  let best = -1;
  let bestScore = 0;
  words.forEach((w, i) => {
    const n = norm(w.text);
    if (!isContent(w.text) || chars(n) > 14) return;
    const score = (IMPACT.test(n) ? 10 : 0) + Math.min(8, chars(n)) / 8 + i * 0.01;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}

type Qty = {value: number; prefix: string; suffix: string; label?: string; idx: number};

/** Quantities the speaker says in a sentence: digits ("10", "$2,000", "386 thousand", "50%") and number words ("ten seconds") — number WORDS only when a unit follows, so "one of the best" never becomes a stat. */
export function spokenQuantities(sentence: KineticSentence): Qty[] {
  const out: Qty[] = [];
  const w = sentence.words;
  w.forEach((word, i) => {
    const raw = bare(word.text);
    const next = w[i + 1] ? norm(w[i + 1]!.text) : '';
    const digit = /^(\$)?(\d[\d,]*(?:\.\d+)?)(%|k|m)?$/i.exec(raw);
    let value: number | null = null;
    let prefix = '';
    let suffix = '';
    if (digit) {
      value = Number(digit[2]!.replace(/,/g, ''));
      prefix = digit[1] ?? '';
      if (digit[3]) suffix = digit[3] === '%' ? '%' : digit[3].toUpperCase();
      if (!suffix && SCALE[next]) suffix = SCALE[next]!;
      if (!suffix && /^(percent|%)$/.test(next)) suffix = '%';
      if (/^dollars?$/.test(next)) prefix = '$';
      // bare 4-digit years are dates, not statistics
      if (!prefix && !suffix && Number.isInteger(value) && value >= 1900 && value <= 2100 && !UNIT.test(next)) value = null;
    } else {
      const spoken = spokenNumbers(raw);
      if (spoken.length === 1 && /^[a-z-]+$/i.test(raw) && UNIT.test(next)) value = spoken[0]!;
    }
    if (value === null || !Number.isFinite(value) || value <= 0 || chars(String(value)) > 9) return;
    const label = UNIT.test(next) && !/^(percent|dollars?)$/i.test(next) ? w[i + 1]!.text.replace(/[^\p{L}]+/gu, '') : undefined;
    out.push({value, prefix, suffix, ...(label ? {label} : {}), idx: i});
  });
  return out;
}

const share = (shown: string, sentence: string) => chars(shown) / Math.max(1, chars(sentence));


// ---------------------------------------------------------------------------- text match cut
export const MATCH_NAMING = /\b(what is|what'?s|called|the word|the idea of|the concept of|the power of|the rise of|the age of|the future of|means|meaning|defines?|defined|in other words|think of|is all about)\b/i;
const MATCH_SWAP_MARKERS = new Set(['vs', 'versus']);
const MATCH_WORD = /^\p{L}[\p{L}'’-]*$/u;
/** Longest keyword the highlight box carries (the style bible: noun or verb, under 12 characters). */
export const MATCH_CUT_KEYWORD_MAX = 12;
export const MATCH_CUT_KEYWORD_MIN = 4;
/** Words of spoken context kept before / after the keyword. */
export const MATCH_CONTEXT_BEFORE = 6;
export const MATCH_CONTEXT_AFTER = 7;

export type MatchCutVariantId = 'memo' | 'editorial' | 'newsprint';
const MATCH_VARIANTS: readonly MatchCutVariantId[] = ['memo', 'editorial', 'newsprint'];

/** Grammar from the beat's meaning: news / story -> newsprint (T3), brand / design -> editorial (T2), data / documents -> memo (T1); otherwise `seed` rotates. */
export function matchCutVariantOf(phrase: string, seed = 0): MatchCutVariantId {
  if (/\b(news|headline|reported|reports?|story|stories|press|media|journal|article|breaking|announced?)\b/i.test(phrase)) return 'newsprint';
  if (/\b(brand|design|style|fashion|creative|art|beautiful|bold|aesthetic|magazine|editorial|trend)\b/i.test(phrase)) return 'editorial';
  if (/\b(data|research|study|document|record|evidence|history|science|system|process|technology|machine|intelligence)\b/i.test(phrase)) return 'memo';
  return MATCH_VARIANTS[Math.abs(Math.floor(seed)) % MATCH_VARIANTS.length]!;
}

export const matchKeywordOk = (word: string) => MATCH_WORD.test(word) && chars(word) >= MATCH_CUT_KEYWORD_MIN && chars(word) <= MATCH_CUT_KEYWORD_MAX && isContent(word);

/**
 * The text-match-cut candidate for keyword index `ki` of `all` (and an optional swap keyword index `si`): the window of spoken context, the words before / after the keyword, the variant. Pure; everything shown is a
 * contiguous slice of the transcript so the binder's grounding check passes by construction.
 */
export function buildMatchCut(all: readonly MotionTemplateWord[], ki: number, si: number | undefined, reason: string, score: number, seed: number): KineticCandidate | null {
  const kw = all[ki];
  if (!kw) return null;
  const keyword = bare(kw.text);
  if (!matchKeywordOk(keyword)) return null;
  const swap = si !== undefined && all[si] ? bare(all[si]!.text) : undefined;
  if (swap !== undefined && (!matchKeywordOk(swap) || norm(swap) === norm(keyword))) return null;
  const hiIdx = Math.max(ki, si ?? ki);
  const from = Math.max(0, ki - MATCH_CONTEXT_BEFORE);
  const to = Math.min(all.length, hiIdx + 1 + MATCH_CONTEXT_AFTER);
  const window = all.slice(from, to);
  if (window.length < 5) return null;
  const before = phraseOf(all.slice(from, ki));
  const after = phraseOf(all.slice(ki + 1, to));
  const phrase = phraseOf(window);
  if (chars(phrase) > 150) return null;
  const last = all[hiIdx]!;
  return {
    templateId: 'clip_55_type_text_match_cut',
    intent: 'text_match_cut',
    at: kw.start,
    spokenEnd: last.end,
    hint: {keyword, ...(swap ? {swapKeyword: swap} : {}), phrase, ...(before ? {before} : {}), ...(after ? {after} : {}), variant: matchCutVariantOf(phrase, seed)},
    score,
    reason,
    shown: swap ? `${keyword} ${swap}` : keyword,
  };
}

/** A from-X-to-Y / X-vs-Y / X-instead-of-Y contrast between two single content words: [first, second] indices into `bareWords`. */
export function matchSwapPair(bareWords: readonly string[]): [number, number] | null {
  const n = (i: number) => (bareWords[i] ? norm(bareWords[i]!) : '');
  for (let i = 0; i < bareWords.length; i++) {
    if (n(i) === 'from') {
      const a = i + 1;
      for (let j = a + 1; j <= Math.min(bareWords.length - 2, a + 4); j++) if (n(j) === 'to' && matchKeywordOk(bareWords[a]!) && matchKeywordOk(bareWords[j + 1]!)) return [a, j + 1];
    }
    if (MATCH_SWAP_MARKERS.has(n(i)) && i > 0 && matchKeywordOk(bareWords[i - 1]!) && i + 1 < bareWords.length && matchKeywordOk(bareWords[i + 1]!)) return [i - 1, i + 1];
    if (n(i) === 'instead' && n(i + 1) === 'of' && i > 0 && matchKeywordOk(bareWords[i - 1]!) && matchKeywordOk(bareWords[i + 2] ?? '')) return [i - 1, i + 2];
  }
  return null;
}

/** All kinetic-type candidates of one sentence (not yet budgeted). */
export function kineticCandidatesOf(s: KineticSentence, ctx: KineticContext, allowed: ReadonlySet<string>): {candidates: KineticCandidate[]; warnings: string[]} {
  const out: KineticCandidate[] = [];
  const warnings: string[] = [];
  const f = ctx.durationSec > 0 ? s.start / ctx.durationSec : 0;
  const w = s.words;
  const bareWords = w.map(x => bare(x.text));
  const can = (id: MotionTemplateId) => allowed.has(id);
  const push = (c: KineticCandidate) => {
    if (can(c.templateId)) out.push(c);
  };

  // ---- type_kinetic_cta: a final invitation in the last stretch of the video
  const cta = CTA_CUE.exec(s.text);
  if (cta && (ctx.directed || f >= 0.55)) {
    const cueWords = cta[0].split(/\s+/).length;
    const cueAt = bareWords.findIndex((_, i) => norm(bareWords.slice(i, i + cueWords).join(' ')) === norm(cta[0]));
    if (cueAt >= 0) {
      const lead = bareWords.slice(Math.max(0, cueAt - 1), cueAt).filter(x => /^(just|now|simply|please)$/i.test(x));
      const leadN = lead.length;
      // the tag is the REST of the sentence only when it is short; a truncated tag ("for a free") would read as a mistake
      const tailAvail = bareWords.slice(cueAt + cueWords).filter(Boolean);
      const tail = tailAvail.length <= 3 && chars(tailAvail.join(' ')) <= 22 ? tailAvail : [];
      const key = bareWords.slice(cueAt, cueAt + cueWords).join(' ');
      const parts: Array<Record<string, unknown>> = [];
      if (leadN > 0) parts.push({text: lead.join(' '), size: 'sm', tone: 'ink'});
      parts.push({text: key, size: 'lg', tone: 'accent'});
      if (tail.length > 0 && parts.length < 3) parts.push({text: tail.join(' '), size: 'md', tone: 'ink'});
      if (parts.length >= 2 && chars(key) <= 14) {
        const first = cueAt - leadN;
        const used = w.slice(first, cueAt + cueWords + (parts.length === 3 || leadN === 0 ? tail.length : 0));
        push({templateId: 'clip_53_type_kinetic_cta', intent: 'kinetic_cta', at: w[first]!.start, spokenEnd: used[used.length - 1]!.end, hint: {parts}, score: 0.95, reason: `final invitation ("${cta[0]}") in the closing stretch`, shown: parts.map(p => p.text).join(' ')});
      }
    }
  }

  // ---- type_impact_number: a spoken statistic (never a price pair: the promo template owns those)
  const qty = spokenQuantities(s);
  if (qty.length > 0 && !/\b(was|from|used to be|originally|normally)\b[\s\S]*\b(now|today|only|just|to)\b/i.test(s.text)) {
    const seq = qty.length >= 2 && qty.length <= 3 && qty.every(q => q.suffix === qty[0]!.suffix && q.prefix === qty[0]!.prefix) && /\b(to|then|and|into)\b/i.test(s.text) ? qty : [qty[0]!];
    const first = seq[0]!;
    const last = seq[seq.length - 1]!;
    const label = seq.length === 1 ? first.label : undefined;
    push({
      templateId: 'clip_46_type_impact_number',
      intent: 'impact_number',
      at: w[first.idx]!.start,
      spokenEnd: w[Math.min(w.length - 1, last.idx + (label ? 1 : 0))]!.end,
      hint: {values: seq.map(q => String(q.value)), ...(first.prefix ? {prefix: first.prefix} : {}), ...(first.suffix ? {suffix: first.suffix} : {}), ...(label ? {label, labelPosition: 'below'} : {}), ...(seq.length === 1 && first.value >= 100 ? {countUp: true} : {})},
      score: 0.92,
      reason: `spoken statistic (${seq.map(q => `${q.prefix}${q.value}${q.suffix}`).join(' -> ')})`,
      shown: seq.map(q => `${q.prefix}${q.value}${q.suffix}`).join(' ') + (label ? ` ${label}` : ''),
    });
  }

  // ---- type_logo_reveal: brand introduction (gated on creator brand data)
  if ((ctx.directed || (f <= 0.5 && BRAND_INTRO.test(s.text))) && (ctx.logoSrc || ctx.brandName)) {
    const brand = (ctx.brandName ?? '').trim();
    const spokenBrand = brand ? ` ${s.text.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ')} `.includes(` ${brand.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').trim()} `) : false;
    if (spokenBrand || ctx.directed || /\b(introducing|welcome to|meet)\b/i.test(s.text)) push({templateId: 'clip_52_type_logo_reveal', intent: 'logo_title', at: s.start, spokenEnd: s.end, hint: {}, score: 0.93, reason: spokenBrand ? 'brand named aloud' : 'brand introduction cue', shown: brand});
  }

  // ---- type_floating_social_proof: followers / engagement, only from creator assets or a spoken figure
  if (SOCIAL_CUE.test(s.text)) {
    const stills = (ctx.socialImageUrls ?? []).filter(u => /^https:\/\/\S+$/i.test(u.trim()));
    const metricAfter = (x: Qty) => [w[x.idx + 1], w[x.idx + 2]].find(next => next && SOCIAL_CUE.test(next.text));
    const q = qty.find(x => x.label || metricAfter(x));
    const metric = q ? metricAfter(q)?.text.replace(/[^\p{L}]+/gu, '') : undefined;
    const figure = q ? `${q.value}${q.suffix}` : undefined;
    const icons = [/\blikes?\b/i.test(s.text) ? 'heart' : null, /\bcomments?\b/i.test(s.text) ? 'comment' : null, /\b(shares?|shared)\b/i.test(s.text) ? 'share' : null, /\bsaves?\b/i.test(s.text) ? 'bookmark' : null].filter((x): x is string => x !== null);
    if (stills.length > 0 || figure) {
      push({templateId: 'clip_51_type_floating_social_proof', intent: 'social_proof', at: s.start, spokenEnd: s.end, hint: {icons: icons.length > 0 ? icons : ['heart'], ...(figure ? {figure, ...(metric ? {figureLabel: metric} : q?.label ? {figureLabel: q.label} : {})} : {})}, score: 0.78, reason: stills.length > 0 ? 'social performance mentioned + creator-provided stills' : 'social performance mentioned + spoken figure', shown: figure ?? ''});
    } else warnings.push('kinetic_type:social_proof:gated:no_assets_or_figure');
  }

  const hasDigits = /\d/.test(s.text) || qty.length > 0;
  const k = keyWordIndex(w);
  const keyWord = k >= 0 ? bareWords[k]! : '';
  // directed: the Director already decided this phrase carries the claim
  const claim = k >= 0 && (IMPACT.test(norm(keyWord)) || Boolean(ctx.directed));

  // ---- type_environmental_hero: a strong claim / key concept (one oversized word, optional spoken lead-in)
  // Phase D (preferMatte only): behind-subject depth is the point of kinetic-led with a matte, so a strong SHORT phrase (2-6 words, no digits, a content key word of >= 4 letters) qualifies even without an impact keyword
  const matteClaim = Boolean(ctx.preferMatte) && !claim && k >= 0 && w.length >= 2 && w.length <= 6 && chars(keyWord) >= 4;
  if (!hasDigits && (claim || matteClaim) && w.length >= 2) {
    // the lead-in is the run of function words right before the key word ("and that" / "I can" / "is"), like a spoken set-up; never content words
    let leadFrom = k;
    while (leadFrom > 0 && k - leadFrom < 2 && STOP.has(norm(bareWords[leadFrom - 1]!))) leadFrom -= 1;
    const leadWords = bareWords.slice(leadFrom, k);
    const lead = leadWords.length > 0 && chars(leadWords.join(' ')) <= 20 ? leadWords.join(' ') : '';
    // no matte: the type may only go where the subject is NOT, so the subject must be measured (an invented default box would be a guess about where the face is)
    const headroom = ctx.subjectBox ? ctx.subjectBox.y - 0.08 : 0;
    if (!ctx.hasMatte && !ctx.subjectBox) warnings.push('kinetic_type:environmental:skipped:subject_unmeasured');
    else if (!ctx.hasMatte && headroom < 0.12) warnings.push('kinetic_type:environmental:skipped:no_matte_no_headroom');
    else {
      const first = lead ? k - leadWords.length : k;
      push({templateId: 'clip_45_type_environmental_hero', intent: 'environmental_hero', at: w[first]!.start, spokenEnd: w[k]!.end, hint: {text: keyWord, ...(lead ? {lead} : {}), ...(ctx.subjectBox ? {subjectBox: ctx.subjectBox} : {})}, score: (claim ? 0.9 : 0.8) + (ctx.hasMatte ? (ctx.preferMatte ? 0.08 : 0.03) : 0), reason: `${claim ? 'strong claim' : 'short key phrase'} ("${keyWord}")${ctx.hasMatte ? ' with a person matte' : ' (no matte: headroom layout)'}`, shown: [lead, keyWord].filter(Boolean).join(' ')});
    }
  }

  // ---- type_split_color_headline: contrast / two-part message
  const contrastAt = bareWords.findIndex(x => CONTRAST.test(x));
  const twoPart = ctx.directed || /^(i can|we can|you can|let me|here'?s|this is|it'?s)\b/i.test(s.text);
  if (!hasDigits && k > 0 && (contrastAt >= 0 || twoPart) && w.length >= 3 && w.length <= 12) {
    let keyFrom = k;
    if (k > 0 && isContent(bareWords[k - 1]!) && chars(`${bareWords[k - 1]} ${keyWord}`) <= 14 && !CONTRAST.test(bareWords[k - 1]!)) keyFrom = k - 1;
    let leadFrom = keyFrom;
    while (leadFrom > 0 && keyFrom - leadFrom < 3 && chars(bareWords.slice(leadFrom - 1, keyFrom).join(' ')) <= 24) leadFrom -= 1;
    if (leadFrom < keyFrom) {
      const leadText = bareWords.slice(leadFrom, keyFrom).join(' ');
      const keyText = bareWords.slice(keyFrom, k + 1).join(' ');
      push({templateId: 'clip_48_type_split_color_headline', intent: 'split_headline', at: w[leadFrom]!.start, spokenEnd: w[k]!.end, hint: {groups: [{text: leadText, size: 'sm', tone: 'accent'}, {text: keyText, size: 'lg', tone: 'accent2'}]}, score: 0.86, reason: contrastAt >= 0 ? `contrast ("${bareWords[contrastAt]}") -> small lead-in + contrast keyword` : 'two-part message -> small lead-in + contrast keyword', shown: `${leadText} ${keyText}`});
    }
  }

  // ---- type_stacked_statement: a concluding argument (lead / key / support hierarchy). The slices shrink until the stack no longer repeats most of the caption line.
  if (!hasDigits && k >= 0 && w.length >= 5 && w.length <= 14 && (ctx.directed || CONCLUDE.test(s.text) || (f >= 0.6 && claim))) {
    for (const [nLead, nSupport] of [[3, 3], [2, 2], [2, 1], [1, 1], [2, 0], [0, 2]] as const) {
      const leadFrom = Math.max(0, k - nLead);
      const supportTo = Math.min(w.length, k + 1 + nSupport);
      const leadText = bareWords.slice(leadFrom, k).join(' ');
      const supportText = bareWords.slice(k + 1, supportTo).join(' ');
      const rows: Array<Record<string, unknown>> = [];
      if (leadText && chars(leadText) <= 24) rows.push({text: leadText, role: 'lead'});
      rows.push({text: keyWord, role: 'key'});
      if (supportText && chars(supportText) <= 24) rows.push({text: supportText, role: 'support'});
      if (rows.length < 2) continue;
      const shown = rows.map(r => r.text).join(' ');
      if (duplicatesCaption(shown, s.text)) continue;
      const from = rows[0]!.role === 'lead' ? leadFrom : k;
      const to = rows[rows.length - 1]!.role === 'support' ? supportTo : k + 1;
      push({templateId: 'clip_50_type_stacked_statement', intent: 'stacked_statement', at: w[from]!.start, spokenEnd: w[to - 1]!.end, hint: {lines: rows}, score: 0.84, reason: 'concluding argument -> layered statement around one key word', shown});
      break;
    }
  }

  // ---- type_staggered_phrase: a short memorable statement
  const phraseWords = bareWords.filter(Boolean);
  if (!hasDigits && phraseWords.length >= 3 && phraseWords.length <= 7 && chars(phraseWords.join(' ')) <= 48 && (claim || ctx.directed || /[.!]$/.test(s.text.trim()))) {
    const ei = keyWordIndex(w);
    push({templateId: 'clip_47_type_staggered_phrase', intent: 'staggered_phrase', at: s.start, spokenEnd: s.end, hint: {text: phraseOf(w), ...(ei >= 0 ? {emphasisIndex: ei} : {})}, score: 0.82 + (claim ? 0.04 : 0), reason: 'short memorable statement -> directional word stagger on the speech rhythm', shown: phraseOf(w)});
  }

  // ---- type_illustrated_emphasis: a drawn accent that reinforces one pointed word
  const pointed = bareWords.findIndex(x => POINTING.test(x) || SUPERLATIVE.test(x) || SIZE.test(x) || KEYMARK.test(x) || BRACKET.test(x));
  if (pointed >= 0 && w.length >= 3) {
    const marker = bareWords[pointed]!;
    const mark = POINTING.test(marker) ? 'arrow' : SUPERLATIVE.test(marker) ? 'circle' : SIZE.test(marker) ? 'burst' : BRACKET.test(marker) ? 'bracket' : 'underline';
    // the word that carries the accent: the marker itself for size / key words, the next content word for pointing + superlatives
    const target = mark === 'arrow' ? (w.findIndex((x, i) => i > pointed && isContent(x.text)) >= 0 ? w.findIndex((x, i) => i > pointed && isContent(x.text)) : pointed) : pointed;
    const word = bareWords[target]!;
    if (chars(word) >= 3 && chars(word) <= 14 && target < w.length) push({templateId: 'clip_54_type_illustrated_emphasis', intent: 'illustrated_emphasis', at: w[Math.min(target, pointed)]!.start, spokenEnd: w[Math.max(target, pointed)]!.end, hint: {word, mark, ...(ctx.subjectBox ? {subjectBox: ctx.subjectBox} : {})}, score: 0.7, reason: `"${marker}" -> drawn ${mark} on "${word}"`, shown: word});
  }

  // ---- type_text_match_cut: a concept being NAMED ("what is X", "the power of X") or a from-X-to-Y contrast -> one keyword pinned in a highlight box while the layout hard-cuts around it
  if (w.length >= 5 && !hasDigits) {
    const seed = Math.floor(s.start);
    const swapPair = matchSwapPair(bareWords);
    if (swapPair) {
      const c = buildMatchCut(w, swapPair[0], swapPair[1], `contrast "${bareWords[swapPair[0]]}" -> "${bareWords[swapPair[1]]}" -> text match cut with a keyword swap`, 0.89, seed);
      if (c) push(c);
    } else {
      const naming = MATCH_NAMING.exec(s.text);
      if (naming || ctx.directed) {
        // the keyword is the first content word AFTER the naming cue, else the strongest word of the sentence
        let ki = -1;
        if (naming) {
          const cueEnd = naming.index + naming[0].length;
          let offset = 0;
          const starts = w.map(x => {
            const at = s.text.indexOf(x.text, offset);
            offset = at >= 0 ? at + x.text.length : offset;
            return at;
          });
          ki = w.findIndex((x, i) => starts[i]! >= cueEnd - 1 && matchKeywordOk(bare(x.text)));
        }
        if (ki < 0) ki = keyWordIndex(w);
        if (ki >= 0) {
          const c = buildMatchCut(w, ki, undefined, naming ? `concept named ("${naming[0]}") -> text match cut on "${bare(w[ki]!.text)}"` : `director-chosen text match cut on "${bare(w[ki]!.text)}"`, naming ? 0.87 : 0.7, seed);
          if (c) push(c);
        }
      }
    }
  }

  // ---- type_kinetic_word_pop: one important word, popped beside the presenter (never a second hero in the same sentence: the dedupe happens in the planner)
  if (!hasDigits && k >= 0 && (claim || w.length <= 4)) push({templateId: 'clip_49_type_kinetic_word_pop', intent: 'word_pop', at: w[k]!.start, spokenEnd: w[k]!.end, hint: {word: keyWord, anchor: Math.floor(s.start * 10) % 2 === 0 ? 'left' : 'right', ...(ctx.subjectBox ? {subjectBox: ctx.subjectBox} : {})}, score: 0.6 + (claim ? 0.05 : 0), reason: `important word ("${keyWord}") emphasised beside the presenter`, shown: keyWord});

  return {candidates: out, warnings};
}

/** Never put (nearly) a whole long caption line on screen a second time: > 5 spoken words may show at most 60 % of the sentence. */
export function duplicatesCaption(shown: string, sentenceText: string): boolean {
  const spokenWords = sentenceText.split(/\s+/).filter(Boolean).length;
  if (spokenWords <= 5) return false;
  return share(shown, sentenceText) > 0.6;
}

// ---------------------------------------------------------------------------- live Director candidates

export type DirectedKineticTypeInput = {
  /** Director-facing name (KINETIC_TYPE_NAMES). */
  template: string;
  /** The exact spoken phrase the Director chose (contiguous in the transcript). */
  text: string;
  /** Resolved window (output seconds) the Director anchored the element to (from its transcript word ids). */
  start: number;
  end: number;
  mark?: string;
  reason?: string;
};

/** The contiguous run of transcript words that spells `text`, searched only inside the Director's window (+/- 0.6 s); null when the Director's phrase is not actually there. */
export function locatePhrase(words: readonly MotionTemplateWord[], text: string, start: number, end: number): MotionTemplateWord[] | null {
  const want = text.split(/\s+/).map(norm).filter(Boolean);
  if (want.length === 0) return null;
  const inWindow = words.filter(w => w.end >= start - 0.6 && w.start <= end + 0.6);
  for (let i = 0; i + want.length <= inWindow.length; i++) {
    if (want.every((token, k) => norm(inWindow[i + k]!.text) === token)) return inWindow.slice(i, i + want.length);
  }
  return null;
}

/**
 * One Director-chosen kinetic-type element -> a planner candidate. The Director picks the template, the exact phrase and (through its word ids) the window; this function only checks that the phrase is really
 * spoken there and builds the template's structure from it with the SAME builders the deterministic selection uses (so nothing the binder would refuse is ever passed on). Semantic cue gates are waived
 * (`directed`), structure / grounding / asset gates are not. A rejection carries its reason (asserted in tests, logged as a planner warning).
 */
export function kineticCandidateFromDirector(
  d: DirectedKineticTypeInput,
  words: readonly MotionTemplateWord[],
  ctx: KineticContext,
  allowed: ReadonlySet<string>,
): {candidate?: KineticCandidate; sentence?: KineticSentence; rejected?: string} {
  const id = (KINETIC_TYPE_TEMPLATES as Record<string, MotionTemplateId>)[d.template];
  if (!id) return {rejected: 'unknown_template'};
  if (!allowed.has(id)) return {rejected: 'template_not_allowed'};
  const slice = locatePhrase(words, d.text, d.start, d.end);
  if (!slice) return {rejected: 'phrase_not_in_transcript_window'};
  const sentence: KineticSentence = {text: slice.map(w => w.text).join(' '), start: slice[0]!.start, end: slice[slice.length - 1]!.end, words: slice};
  const bareWords = slice.map(w => bare(w.text)).filter(Boolean);
  const shownOf = bareWords.join(' ');
  const finish = (candidate: KineticCandidate) => ({candidate: {...candidate, score: 1, reason: `director: ${d.reason?.slice(0, 80) || candidate.reason}`}, sentence});
  // short phrases are the whole point of these three: build them directly from what the Director picked
  // WP56: allow up to 5 spoken words for environmental hero (was hard-locked at 2).
  if (id === 'clip_45_type_environmental_hero' && bareWords.length >= 1 && bareWords.length <= 5 && bareWords.every(x => chars(x) <= 14) && chars(shownOf) <= 42) {
    const headroom = ctx.subjectBox ? ctx.subjectBox.y - 0.08 : 0;
    if (!ctx.hasMatte && !ctx.subjectBox) return {rejected: 'subject_unmeasured'};
    if (!ctx.hasMatte && headroom < 0.12) return {rejected: 'no_matte_no_headroom'};
    return finish({templateId: id, intent: 'environmental_hero', at: sentence.start, spokenEnd: sentence.end, hint: {text: shownOf, ...(ctx.subjectBox ? {subjectBox: ctx.subjectBox} : {})}, score: 1, reason: 'director-chosen environmental word', shown: shownOf});
  }
  if (id === 'clip_49_type_kinetic_word_pop' && bareWords.length === 1 && chars(bareWords[0]!) <= 18) {
    return finish({templateId: id, intent: 'word_pop', at: sentence.start, spokenEnd: sentence.end, hint: {word: bareWords[0], anchor: Math.floor(sentence.start * 10) % 2 === 0 ? 'left' : 'right', ...(ctx.subjectBox ? {subjectBox: ctx.subjectBox} : {})}, score: 1, reason: 'director-chosen word pop', shown: shownOf});
  }
  if (id === 'clip_54_type_illustrated_emphasis' && bareWords.length >= 1 && bareWords.length <= 5 && bareWords.every(x => chars(x) <= 14) && chars(shownOf) <= 42) {
    const mark = (KINETIC_TYPE_MARKS as readonly string[]).includes(d.mark ?? '') ? d.mark! : 'underline';
    return finish({templateId: id, intent: 'illustrated_emphasis', at: sentence.start, spokenEnd: sentence.end, hint: {word: shownOf, mark, ...(ctx.subjectBox ? {subjectBox: ctx.subjectBox} : {})}, score: 1, reason: `director-chosen ${mark}`, shown: shownOf});
  }
  if (id === 'clip_55_type_text_match_cut') {
    // the Director names the phrase; the keyword is the phrase itself when it is one word, else its strongest word. Context is read from the real transcript around it.
    const first = words.indexOf(slice[0]!);
    const inSlice = bareWords.length === 1 ? 0 : keyWordIndex(slice);
    if (first < 0 || inSlice < 0) return {rejected: 'no_keyword'};
    const built = buildMatchCut(words, first + inSlice, undefined, 'director-chosen text match cut', 1, Math.floor(sentence.start));
    return built ? finish(built) : {rejected: 'not_buildable_from_phrase'};
  }
  const {candidates} = kineticCandidatesOf(sentence, {...ctx, directed: true}, new Set<string>([id]));
  const built = candidates.find(c => c.templateId === id);
  if (!built) return {rejected: 'not_buildable_from_phrase'};
  return finish(built);
}
