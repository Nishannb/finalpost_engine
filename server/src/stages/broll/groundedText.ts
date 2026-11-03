/**
 * The one matcher for "is this on-screen text something the speaker said": every word of the text must occur in the transcript, ignoring case, accents, punctuation, a trailing plural
 * `s` or possessive `'s`, and the currency/percent signs `$ % € £` (so "$5M" matches a spoken "5M"). Nothing semantic: no synonyms, no spoken-number words, no paraphrase. Pure
 * (no imports). Used by the mvp legibility writer (stages/broll/legibility.ts, which drops ungrounded graphic text) and by the offline scorer's row 6; there is deliberately no second copy.
 */
/**
 * WP9C: a section marker is chrome around spoken words, `01 — <spoken words>`. Its ordinal (zero-padded 01-09 then an em / en dash, at the very start) is a layout label, not a claim the speaker made, so it is
 * ignored; every word after it must still be spoken. A hyphen, a bare number, a mid-text ordinal or `00` is NOT covered.
 */
const SECTION_ORDINAL = /^\s*0[1-9]\s*[\u2014\u2013]\s*/;
const tokens = (text: string) => text.replace(SECTION_ORDINAL, '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}$%€£]+/gu, ' ').split(' ').filter(Boolean);

/** Light normalisation so "emotions" matches "emotion" and "$5M" matches "5m": trailing possessive/plural s, currency/percent signs. */
const stem = (token: string): string => {
  const bare = token.replace(/[$%€£]/g, '').replace(/'s$/, '');
  return bare.length > 3 && bare.endsWith('s') && !bare.endsWith('ss') ? bare.slice(0, -1) : bare;
};

/** The words of `text` (as written, lower-cased) that the transcript does not contain, in order. Empty when the text is grounded. */
export function ungroundedWords(text: string, transcript: string): string[] {
  const spoken = new Set(tokens(transcript).map(stem));
  // WP9F: a lone currency / percent sign (a stat's `suffix: '%'`) carries no word to check; the number and the unit word are checked on their own.
  return tokens(text).filter(token => stem(token) !== '' && !spoken.has(stem(token)));
}

/** True when every word of `text` appears in the transcript. Empty text is grounded (nothing to show). */
export function isGroundedInTranscript(text: string, transcript: string): boolean {
  return ungroundedWords(text, transcript).length === 0;
}

/**
 * WP56: overlay / plate copy must match the SECTION WINDOW it lands in — not merely appear somewhere in the full transcript.
 * Every content token of `text` must appear in `windowTranscript` (words spoken in the beat window). Empty text is relevant.
 */
export function phraseRelevantToWindow(text: string, windowTranscript: string): boolean {
  if (!text.trim()) return true;
  return ungroundedWords(text, windowTranscript).length === 0;
}
