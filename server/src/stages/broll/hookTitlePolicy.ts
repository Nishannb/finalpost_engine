/**
 * PROPOSED hook-title resolution policy — NOT WIRED INTO THE PIPELINE.
 *
 * Production still calls `oneLineHook(...)` (which turns every empty input into "WATCH THIS"). This module exists so the
 * alternatives can be specified and tested deterministically before any decision is made; nothing imports it except its test.
 * See remotion/out/phase17-audit/HOOK_TITLE_IMPLEMENTATION_PROPOSAL.md.
 */
import {cleanHookTitle, oneLineHook} from './geminiDirector.ts';

export type HookTitlePolicy =
  /** Today's behaviour: any missing/empty title becomes "WATCH THIS". */
  | 'placeholder'
  /** Proposed A: no title means NO hook element (empty string all the way to the renderer). */
  | 'none'
  /** Proposed B: no title means a snippet taken from the transcript. */
  | 'transcript_fallback';

export type ResolvedHook = {
  /** '' means: do not create a hook element. */
  title: string;
  /** Where the text came from, for the ledger: the Director, the transcript snippet, the placeholder, or nothing. */
  origin: 'director' | 'transcript' | 'placeholder' | 'none';
};

const text = (raw: unknown): string => (typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '');

export function resolveHookTitle(raw: unknown, policy: HookTitlePolicy, transcript = ''): ResolvedHook {
  // A title that cleans to nothing (e.g. "!!!") is absent, exactly like an empty one.
  const given = cleanHookTitle(text(raw));
  if (given) {
    // A present title goes through the same clean-up as today (sanitising, ≤6 words, ≤42 chars).
    return {title: given, origin: 'director'};
  }
  switch (policy) {
    case 'placeholder':
      return {title: oneLineHook(''), origin: 'placeholder'};
    case 'none':
      return {title: '', origin: 'none'};
    case 'transcript_fallback': {
      const sentence = (transcript.split(/[.!?]/)[0] ?? '').trim();
      return sentence ? {title: oneLineHook(sentence), origin: 'transcript'} : {title: '', origin: 'none'};
    }
  }
}
