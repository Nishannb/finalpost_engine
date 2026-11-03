/**
 * WP7C: golden "messy one-take" fixtures: synthetic word timelines (no audio, no video) that model what a creator really records in one go. Each fixture states what the cut stack must do
 * and what the KEPT transcript must look like. The same stack the cuts profile runs in `analyzeVideo` Stage B is applied by `messyOneTake.test.ts`:
 *   autoTrimSilence (silence + hesitation fillers) + nonSpeechExclusions + transcriptRetakeExclusions (takes, restarts, in-place swaps).
 *
 * KEEP RULE the fixtures document (the module's own rule, not a new one): of several takes of one line, the LAST is kept unless an earlier one is at least 1.35x longer (and 3+ tokens longer);
 * inside one utterance the later restatement is kept and the abandoned attempt cut; of two adjacent alternative verbs the later is kept; hesitation sounds are cut, "like" / "you know" never.
 */
import type {WordToken} from '../../types/blueprint.ts';

type Part = {say: string} | {gap: number} | {filler: string};

const WORD_SEC = 0.28;
const WORD_GAP_SEC = 0.06;
const FILLER_SEC = 0.3;

/** Build a timeline: `say` words are `WORD_SEC` long with `WORD_GAP_SEC` between them; `gap` adds silence; `filler` is a sound placed right where the cursor is (glued when no gap is around it). */
export function buildTimeline(parts: readonly Part[], startSec = 0.2): {words: WordToken[]; durationSec: number} {
  const words: WordToken[] = [];
  let cursor = startSec;
  for (const part of parts) {
    if ('gap' in part) {
      cursor += part.gap;
    } else if ('filler' in part) {
      words.push({text: part.filler, start: cursor, end: cursor + FILLER_SEC});
      cursor += FILLER_SEC;
    } else {
      for (const text of part.say.split(/\s+/)) {
        words.push({text, start: cursor, end: cursor + WORD_SEC});
        cursor += WORD_SEC + WORD_GAP_SEC;
      }
      cursor -= WORD_GAP_SEC;
    }
  }
  return {words, durationSec: cursor + 0.1};
}

export type MessyFixture = {
  id: string;
  title: string;
  words: WordToken[];
  durationSec: number;
  /** Normalized phrases that must NOT survive in the kept transcript (the mash / the duplicate opening / the abandoned attempt). */
  mustNotKeep: string[];
  /** Normalized phrases that MUST survive (the restatement and the unique content). */
  mustKeep: string[];
  /** Phrases that must occur exactly once in the kept transcript. */
  exactlyOnce: string[];
  /** At least this many cut operations of the named kind. */
  expect: {droppedTakes?: number; restarts?: number; fillerCuts?: number; minRemovedFrac: number};
};

const BEATS = {
  map: 'first we map the user journey on one simple page',
  cut: 'then we cut every step that does not help the first win',
  test: 'after that we test it with five real customers this week',
  ship: 'finally we ship the smallest version and measure what changed',
};

const retakes = buildTimeline([
  {say: 'so today i want to show you how our team builds fast onboarding flows'},
  {gap: 1.2},
  {say: 'so today i want to show you how our team designs quick onboarding screens'},
  {gap: 1.0},
  {say: 'so today i want to show you how our team designs quick onboarding flows for new users'},
  {gap: 0.8},
  {say: BEATS.map},
  {gap: 0.8},
  {say: BEATS.cut},
  {gap: 0.8},
  {say: BEATS.test},
  {gap: 0.8},
  {say: BEATS.ship},
]);

const uncut = buildTimeline([
  {say: 'what we learned is that small teams move fast what we learned is that small teams ship faster than big ones'},
  {gap: 0.7},
  {say: 'this is exactly how figma revolutionized redefined collaboration in design for design'},
  {gap: 0.7},
  {say: BEATS.map},
  {gap: 0.7},
  {say: BEATS.cut},
  {gap: 0.7},
  {say: BEATS.test},
]);

const fillers = buildTimeline([
  {say: 'so when i started building the product'},
  {filler: 'um'},
  {say: 'i honestly had no plan'},
  {gap: 0.2},
  {filler: 'uh'},
  {gap: 0.2},
  {say: 'for the first month'},
  {filler: 'hmm,'},
  {say: 'we just shipped small changes every day'},
  {filler: '(um...)'},
  {say: 'and you know like users noticed'},
  {gap: 0.2},
  {filler: 'uhm'},
  {gap: 0.2},
  {say: 'the product got better'},
  {filler: 'mhm.'},
  {gap: 0.2},
  {filler: 'ahh'},
  {gap: 0.2},
  {say: 'week after week'},
  {filler: 'erm'},
  {say: 'until the feedback was loud'},
]);

export const MESSY_ONE_TAKE_FIXTURES: MessyFixture[] = [
  {
    id: 'multi-take-retakes',
    title: 'three takes of the opening line (verb and noun swapped, pauses between), then four unique beats',
    ...retakes,
    mustNotKeep: ['builds fast onboarding flows', 'designs quick onboarding screens'],
    mustKeep: ['designs quick onboarding flows for new users', BEATS.map, BEATS.cut, BEATS.test, BEATS.ship],
    exactlyOnce: ['so today i want to show you how our team'],
    expect: {droppedTakes: 2, minRemovedFrac: 0.2},
  },
  {
    id: 'uncut-shaped-restart-and-swap',
    title: 'a false start inside one breath, then the observed revolutionized/redefined in-place swap, then unique beats',
    ...uncut,
    mustNotKeep: ['revolutionized', 'move fast what we learned'],
    mustKeep: ['redefined collaboration in design for design', 'ship faster than big ones', BEATS.map, BEATS.cut, BEATS.test],
    exactlyOnce: ['what we learned is that small teams'],
    expect: {restarts: 2, minRemovedFrac: 0.1},
  },
  {
    id: 'heavy-fillers',
    title: 'eight hesitation sounds, glued and isolated, wrapped and plain, among real speech that includes "like" and "you know"',
    ...fillers,
    mustNotKeep: [],
    mustKeep: ['and you know like users noticed', 'so when i started building the product', 'until the feedback was loud', 'week after week'],
    exactlyOnce: [],
    expect: {fillerCuts: 8, minRemovedFrac: 0.1},
  },
];
