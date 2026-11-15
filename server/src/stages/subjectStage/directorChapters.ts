/**
 * Phase 5.29C: the Director's Subject Stage field (chapters with titles, quote cards) and its adapter onto the Phase 5.25 decision contract (stageDirection.ts).
 *
 * The Director v2 story analyst already reads the transcript as word ids (`w<index>` over the CAPTION words, perception.ts) and already segments it into beats, but beats carry no
 * headline. When the Subject Stage owns the run, the story analyst is ALSO asked for this field (opt-in; absent = the request is byte-for-byte unchanged). The answer is passed
 * through untouched and converted here into `subject_stage_direction.v1` (source `director`): word ids become caption-word indices, nothing else is invented or repaired. Every rule
 * (ranges, ordering, overlap, title evidence, quote completeness, duplicate ids, timing) is enforced by validateSubjectStageDirection, which rejects with an explicit code.
 * Pure: no model, no network, no env.
 */
import type {SubjectStageDirection} from './stageDirection.ts';

const string = {type: 'STRING'};
/**
 * Gemini responseSchema for the `subject_stage` property (snake_case, word ids like the rest of the story analyst's answer). Not required: the Director may omit it.
 * Phase 5.29E (after the first real answer omitted every `title_end_word_id`): a chapter's title is ONE nested object with BOTH word ids required, or explicitly `null`
 * ("no title"). The old flat `title_start_word_id` / `title_end_word_id` fields are no longer requested (the adapter still reads them, unchanged, for recorded answers).
 */
export const SUBJECT_STAGE_DIRECTOR_SCHEMA = {
  type: 'OBJECT',
  properties: {
    chapters: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: string,
          start_word_id: string,
          end_word_id: string,
          treatment: {type: 'STRING', enum: ['set', 'omit']},
          title: {
            type: 'OBJECT',
            nullable: true,
            properties: {start_word_id: string, end_word_id: string, why: string},
            required: ['start_word_id', 'end_word_id', 'why'],
          },
          omit_reason: string,
        },
        required: ['id', 'start_word_id', 'end_word_id', 'treatment', 'title'],
      },
    },
    quotes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {id: string, start_word_id: string, end_word_id: string, why: string},
        required: ['id', 'start_word_id', 'end_word_id', 'why'],
      },
    },
  },
  required: ['chapters', 'quotes'],
} as const;

/**
 * The instruction appended to the story analyst's request when the field is asked for. It restates the validator's rules (stageDirection.ts DIRECTION_RULES) with examples;
 * it relaxes none. Phase 5.29E: title ids are a required pair (or title null); quotes are whole sentences of 4-16 words, with valid and invalid examples; no quota.
 */
export const SUBJECT_STAGE_DIRECTOR_DIRECTIVE = `SUBJECT_STAGE (fill "subject_stage"; use only word ids that appear in WORD_ID_TRANSCRIPT, never text or clock times):

CHAPTERS: the talk's 2-6 main sections, in order, non-overlapping, each [start_word_id, end_word_id] covering whole sentences.
- treatment "set" = the chapter opens with a title card. Then "title" MUST be an object with BOTH ids and a reason:
  {"start_word_id": "wA", "end_word_id": "wB", "why": "..."}
  wA..wB = 1-3 CONSECUTIVE words spoken INSIDE this chapter that name its topic (preferably in its first sentence, or a topic word the chapter repeats). For a one-word title, start_word_id and end_word_id are the SAME id. Never omit end_word_id.
- treatment "omit" = no title card: "title" MUST be null and omit_reason says why (an intro, a call to action, no clear topic word).
- Never write a title the speaker did not say; never use ids outside the chapter.

QUOTES: 0-4 quote cards. Return an empty list when no sentence qualifies; never add a quote just to fill the list.
Each quote is exactly ONE complete spoken sentence, copied by its word ids:
- start_word_id = the FIRST word of that sentence (the word right after the previous sentence's final punctuation, or the first word of the talk);
- end_word_id = the word that carries that sentence's final punctuation (. ! ?);
- 4-16 words INCLUSIVE: count end - start + 1 before answering; a sentence of 17+ words cannot be a quote;
- one contiguous range only: never join separate regions, never paraphrase, never stop inside the sentence;
- a meaningful claim, not filler, a transition or a call to action; why = why it matters (8+ characters).
Examples (word ids are illustrative):
  valid:   w40..w47 "Pricing decides which small shops survive this year." (starts the sentence, ends at ".", 8 words)
  invalid: w12..w28 a 17-word sentence (too long: 17 > 16)
  invalid: w91..w99 "is because it shows low resistance from your audience." (starts mid-sentence)
  invalid: w40..w44 "Pricing decides which small shops" (stops before the sentence ends)

ids: short and unique (c1, c2, ... and q1, q2, ...). An empty list is a valid answer.`;

/** `w12` -> 12; anything else -> null (the item then fails the contract's schema and is rejected with its reason). */
export function wordIndexOf(id: unknown): number | null {
  const m = typeof id === 'string' ? /^w(\d{1,6})$/.exec(id.trim()) : null;
  return m ? Number(m[1]) : null;
}
const rangeOf = (start: unknown, end: unknown): [number, number] | [unknown, unknown] => {
  const a = wordIndexOf(start), b = wordIndexOf(end);
  return a !== null && b !== null ? [a, b] : [start ?? null, end ?? null];
};
const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/**
 * The Director's `subject_stage` answer -> the decision contract. `undefined` / `null` = the Director gave none: no direction (the stage keeps its deterministic quotes, exactly as
 * before). Any other value becomes a `director` direction: a malformed envelope (not an object, chapters / quotes not lists) is kept as-is so the validator rejects the WHOLE direction
 * with kind `direction` (reported, nothing drawn from it); a malformed item is converted as far as it can be and rejected by the validator with its own code.
 */
export function subjectStageDirectionFromDirector(raw: unknown): SubjectStageDirection | {version: 'subject_stage_direction.v1'; source: 'director'; chapters: unknown; quotes: unknown} | undefined {
  if (raw === undefined || raw === null) return undefined;
  const r = rec(raw);
  const base = {version: 'subject_stage_direction.v1' as const, source: 'director' as const};
  if (!r) return {...base, chapters: raw, quotes: []};
  const chapters = Array.isArray(r.chapters)
    ? r.chapters.map(item => {
        const c = rec(item);
        if (!c) return item;
        // Phase 5.29E: `title` (object with both ids, or null) is the requested form; the 5.29C flat fields are still read for recorded answers. Either way a missing id stays
        // missing (null in the range) and the contract rejects the chapter (`invalid_item`); nothing is inferred.
        const nested = 'title' in c ? (c.title === null ? null : rec(c.title) ?? {start_word_id: undefined, end_word_id: undefined, why: undefined}) : undefined;
        const flat = c.title_start_word_id !== undefined || c.title_end_word_id !== undefined;
        const title = nested !== undefined
          ? (nested === null ? null : {wordRange: rangeOf(nested.start_word_id, nested.end_word_id), why: typeof nested.why === 'string' ? nested.why : ''})
          : flat ? {wordRange: rangeOf(c.title_start_word_id, c.title_end_word_id), why: typeof c.title_why === 'string' ? c.title_why : ''} : null;
        return {
          id: c.id,
          wordRange: rangeOf(c.start_word_id, c.end_word_id),
          treatment: c.treatment,
          ...(title ? {title} : {}),
          ...(typeof c.omit_reason === 'string' ? {omitReason: c.omit_reason} : {}),
        };
      })
    : (r.chapters ?? []);
  const quotes = Array.isArray(r.quotes)
    ? r.quotes.map(item => {
        const q = rec(item);
        return q ? {id: q.id, wordRange: rangeOf(q.start_word_id, q.end_word_id), treatment: 'source_card', why: q.why} : item;
      })
    : (r.quotes ?? []);
  return {...base, chapters, quotes} as never;
}
