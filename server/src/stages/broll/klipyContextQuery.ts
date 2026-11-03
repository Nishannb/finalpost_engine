/**
 * WP15: CONTEXTUAL KLIPY QUERIES. Pure: no I/O, no env.
 * Builds search phrases from what the speaker is saying in a window (claim / emotion / entity),
 * not a single bare stock keyword. The planner picks one query per beat and searches GIF or sticker.
 */

export type KlipyKind = 'gif' | 'sticker';

export type KlipyContextBeat = {
  /** Output-time window the overlay should cover. */
  start: number;
  end: number;
  /** Primary search string for KLIPY (phrase, not a lone filler word). */
  query: string;
  kind: KlipyKind;
  /** Why this beat exists (for credits / debug). */
  reason: string;
  /** Spoken span that grounded the query. */
  spoken: string;
  /** Layout preference on the talking head. */
  layout: 'sticker' | 'pip';
  anchor: 'top_right' | 'top_left' | 'bottom_right' | 'bottom_left';
};

export type CaptionWordLike = {text: string; start: number; end: number};

/** Emotion / reaction cues → sticker-friendly search (reaction vernacular). */
const REACTION: Array<{re: RegExp; query: string}> = [
  {re: /\b(free|zero cost|no cost)\b/i, query: 'free celebration'},
  {re: /\b(money|cash|revenue|profit|\$|dollars?|income|paid)\b/i, query: 'money raining'},
  {re: /\b(grow|growth|scale|exploding|blow(?:ing)? up)\b/i, query: 'rocket launch'},
  {re: /\b(win|won|winner|crush(?:ing)?|dominate)\b/i, query: 'winner celebration'},
  {re: /\b(amazing|awesome|fire|lit)\b/i, query: 'mind blown'}, // WP29: `love` is no longer a reaction cue (it never meant "mind blown", and its literal twin is a heart)
  {re: /\b(wait|hold on|pause)\b/i, query: 'wait a minute'},
  {re: /\b(no|never|stop|wrong)\b/i, query: 'nope shake'},
  {re: /\b(yes|exactly|right|agree)\b/i, query: 'yes nodding'},
  {re: /\b(think|idea|brain|figure)\b/i, query: 'thinking face'},
  {re: /\b(laugh|funny|joke|lol)\b/i, query: 'laughing hard'},
  {re: /\b(shock|wow|insane|crazy)\b/i, query: 'shocked reaction'},
  {re: /\b(sad|fail|lost|broken)\b/i, query: 'sad reaction'},
];

/**
 * WP29: ABSTRACT AFFECT words. "we loved it" is not a picture of a heart. These never become a literal emoji / reaction search: they are stripped from claim phrases, and a query that still contains a literal
 * emoji word is refused (`klipy:miss` beats a nonsense sticker). The ref illustrates a claim with editorial media; KLIPY is optional garnish.
 */
export const ABSTRACT_AFFECT = /\b(lov(?:e|ed|es|ing|er|ers)|hearts?|likes?|liked|likes|adore[ds]?|adoring|enjoy(?:s|ed|ing)?|passion(?:ate)?|care[sd]?|caring|fond|favou?rite[s]?)\b/i;
/** A query that is a literal emoji / affect icon. Refused unless a reaction rule says it is an explicit, high-confidence reaction (no current rule does). */
export const LITERAL_EMOJI_QUERY = /\b(hearts?|love[ds]?|loving|kiss(?:es|ing)?|hugs?|emoji|smiley|thumbs?[\s-]*up|clap(?:ping)?|red\s+heart)\b/i;

export function isLiteralEmojiQuery(query: string): boolean {
  return LITERAL_EMOJI_QUERY.test(query) || ABSTRACT_AFFECT.test(query);
}

/** Hard cap on KLIPY beats per edit (WP29: stickers are garnish, not the edit). */
export const KLIPY_MAX_BEATS = 3;

const STOP = new Set(
  'a an the and or but if so to of in on at for with from by is are was were be been being it this that these those i you we they he she my your our their me him her us them just like really very also then than as into about over after before when while what who which how why not no yes do does did doing done can could will would should may might must have has had having get got getting go going went come coming make made making see saw want need say said saids'.split(
    ' ',
  ),
);

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));
const round = (value: number) => Math.round(value * 1000) / 1000;

/** Words whose start falls in [start, end). */
export function wordsInWindow(words: readonly CaptionWordLike[], start: number, end: number): CaptionWordLike[] {
  return words.filter(word => word.start >= start && word.start < end);
}

/** Contentful tokens from a spoken span (drops fillers / stopwords). */
export function contentTokens(spoken: string): string[] {
  return spoken
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s$]/gu, ' ')
    .split(/\s+/)
    .map(token => token.trim())
    .filter(token => token.length >= 3 && !STOP.has(token));
}

/**
 * Turn a spoken window into a KLIPY query. Prefer reaction mapping when the span carries emotion;
 * otherwise a short noun-ish phrase from content tokens (2–4 words). Falls back to content-type cue.
 */
export function contextualKlipyQuery(spoken: string, contentType?: string): {query: string; kind: KlipyKind; reason: string} | null {
  const trimmed = spoken.replace(/\s+/g, ' ').trim();
  if (trimmed.length < 8) return null;
  for (const rule of REACTION) {
    if (rule.re.test(trimmed)) {
      return {query: rule.query, kind: 'sticker', reason: `reaction:${rule.query}`};
    }
  }
  // WP29: an affect span ("we loved it", "my heart ...") with no explicit reaction cue above is a MISS: the literal picture of the feeling is a sticker the claim does not need.
  if (ABSTRACT_AFFECT.test(trimmed)) return null;
  // WP29: abstract affect words ("loved", "heart") are dropped before the phrase is built; a lone leftover token is NOT searched as "<token> reaction" (that literal token -> sticker path made hearts for "loved").
  const tokens = contentTokens(trimmed).filter(token => !ABSTRACT_AFFECT.test(token));
  if (tokens.length >= 2) {
    const phrase = tokens.slice(0, 4).join(' ');
    if (isLiteralEmojiQuery(phrase)) return null;
    return {query: phrase, kind: tokens.some(t => /logo|brand|app|company|google|meta|apple|amazon|openai|figma/i.test(t)) ? 'sticker' : 'gif', reason: 'claim_phrase'};
  }
  if (tokens.length === 1 || ABSTRACT_AFFECT.test(trimmed)) return null;
  if (contentType === 'sales_pitch') return {query: 'sales success', kind: 'gif', reason: 'content_type:sales'};
  if (contentType === 'motivational' || contentType === 'opinion') return {query: 'motivation fire', kind: 'sticker', reason: 'content_type:energy'};
  return null;
}

/**
 * Propose KLIPY beats across the output timeline from caption words + optional content type.
 * One beat per `windowSec` (default 10s), skipped when the window has too little speech or no contextual query.
 * Caps at `maxBeats`. Does not fetch media.
 */
export function proposeKlipyBeats(input: {
  words: readonly CaptionWordLike[];
  outputDurationSec: number;
  contentType?: string;
  windowSec?: number;
  maxBeats?: number;
  holdSec?: number;
}): KlipyContextBeat[] {
  const windowSec = input.windowSec ?? 10;
  const maxBeats = Math.min(KLIPY_MAX_BEATS, input.maxBeats ?? KLIPY_MAX_BEATS);
  const holdSec = input.holdSec ?? 2.4;
  if (!(input.outputDurationSec > windowSec) || input.words.length === 0) return [];

  const beats: KlipyContextBeat[] = [];
  const windows = Math.floor(input.outputDurationSec / windowSec);
  const anchors: Array<KlipyContextBeat['anchor']> = ['top_right', 'top_left', 'bottom_right', 'bottom_left'];

  for (let index = 0; index < windows && beats.length < maxBeats; index++) {
    const start = index * windowSec;
    const end = Math.min(input.outputDurationSec, start + windowSec);
    // Prefer the densest half of the window (where the claim lands).
    const mid = (start + end) / 2;
    const spanWords = wordsInWindow(input.words, mid - 2.5, mid + 3.5);
    const fallbackWords = wordsInWindow(input.words, start, end);
    const chosen = spanWords.length >= 3 ? spanWords : fallbackWords;
    if (chosen.length < 3) continue;
    const spoken = chosen.map(word => word.text).join(' ');
    const mapped = contextualKlipyQuery(spoken, input.contentType);
    if (!mapped || isLiteralEmojiQuery(mapped.query)) continue;
    const at = clamp(chosen[0]!.start, start, Math.max(start, end - holdSec));
    beats.push({
      start: round(at),
      end: round(Math.min(end, at + holdSec)),
      query: mapped.query,
      kind: mapped.kind,
      reason: mapped.reason,
      spoken: spoken.slice(0, 160),
      layout: mapped.kind === 'sticker' ? 'sticker' : 'pip',
      anchor: anchors[beats.length % anchors.length]!,
    });
  }
  return beats;
}
