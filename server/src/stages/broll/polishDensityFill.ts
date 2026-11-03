/**
 * WP8P: POLISH DENSITY FILL. Gate 4 passed but the edit was thin (3 zooms + 1 overlay + 1 library graphic in 38 s) because the Director omitted most of the lean toolkits and
 * `ensureRequestedEditStyles` (stages/broll/ensureRequestedEdits.ts) deliberately never fills. This is the polish-only counterpart: a bounded, deterministic fill FROM THE SPEAKER'S OWN WORDS.
 * PURE: no env, no logger, no I/O, no model call. The planner calls it for the polish profile only (`editLooks` on, a non-minimal look); cuts / mvp / legacy never reach it.
 *
 * COPY RULE (the grounding rule stays): every text this helper writes is a run of 2-5 consecutive spoken words of ONE sentence, taken verbatim (case kept, edge punctuation trimmed). Nothing is
 * paraphrased, joined from two places, translated or completed, so the legibility grounding pass keeps it.
 *
 * What it fills (a kind is filled only when the look allows it AND the caller requested it; `requested: null` = every toolkit):
 *   kinetic_text / lockup / card / emphasis   up to `beatTarget(duration) - existing beats` text beats, each at least `MIN_BEAT_GAP_SEC` from any other beat, rotating through the eligible kinds
 *   zoom                                      up to the zoom floor `zoomFloor(duration)` (one per 10 s, at least 2 from 20 s)
 * `beatTarget` is the number of DESIGNED beats (kinetic text, lockup, card, emphasis, containers, insets, depth overlays; not zooms, not the hook, not library seeds): one per `SEC_PER_BEAT` (9 s) of output,
 * so a 36 s clip gets 4 designed beats + 4 zooms (the zoom floor) + the hook + up to 4 library seeds, about one change every 4-6 s. Designed-graphic kinds (the look's `graphicKinds`) never exceed the look's `maxGraphics` counting what the Director already placed.
 * A text beat keeps `MIN_BEAT_GAP_SEC` (3.5 s) from every other DESIGNED beat (not from zooms) and starts after the hook has left.
 * Cards go in as text-only chip moments (no stock search), lockups as text-only lockup moments.
 * The result never moves or removes a Director item and never touches the hook.
 */
import type {DirectedMoment, DirectedZoom, VisualDirection} from './geminiDirector.ts';
import type {MotionGraphic, SemanticEmphasis, WordToken} from '../../types/blueprint.ts';
import type {EditLook} from '../directorV2/editLooks.ts';
import {FALLBACK_LOOK_ID} from '../directorV2/editLooks.ts';
import {kindForMomentLayout} from './lookDirection.ts';
import {strongBeatTimes, uncoveredEngagementWindows} from './engagementCadence.ts';
import {planEngagementBeats} from './engagementMixer.ts';
import {planPacing} from './pacing.ts';
import type {PlateAnchor} from '../motionDirector/transcriptLibrarySeed.ts';

export const SEC_PER_BEAT = 9;
export const SEC_PER_ZOOM = 10;
export const MIN_BEAT_GAP_SEC = 3.5;
export const MIN_ZOOM_GAP_SEC = 5;
export const MAX_FILL_BEATS = 8;
export const FILL_TEXT_DURATION_SEC = 2.6;
export const FILL_ZOOM_DURATION_SEC = 2.4;
const SENTENCE_GAP_SEC = 0.8;
const MAX_PHRASE_WORDS = 5;
const MIN_PHRASE_WORDS = 2;
const EDGE = 0.4; // no fill starts in the first / ends in the last 0.4 s

/** The text beats a clip of this length should carry (one per ~7 s, at least 2 from 12 s). */
export function beatTarget(outputDurationSec: number): number {
  if (!Number.isFinite(outputDurationSec) || outputDurationSec < 12) return 0;
  return Math.max(2, Math.min(MAX_FILL_BEATS + 3, Math.floor(outputDurationSec / SEC_PER_BEAT)));
}

/** The zoom floor: ceil(duration / 10), at least 2 from 20 s, none under 8 s. */
export function zoomFloor(outputDurationSec: number): number {
  if (!Number.isFinite(outputDurationSec) || outputDurationSec < 8) return 0;
  const floor = Math.ceil(outputDurationSec / SEC_PER_ZOOM);
  return outputDurationSec >= 20 ? Math.max(2, floor) : floor;
}

const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'so', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'is', 'are', 'was', 'were', 'be', 'it', 'its', 'this', 'that', 'i', 'you', 'we', 'they', 'he', 'she', 'my', 'your', 'our', 'their', 'from', 'by', 'as', 'into', 'about', 'than', 'then', 'if', 'when', 'um', 'uh', 'like', 'just', 'really', 'very']);
const clean = (value: string): string =>
  value
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'`“”‘’(\[{<*_\-–—.,;:!?…]+/, '')
    .replace(/[\s"'`“”‘’)\]}>*_\-–—.,;:!?…]+$/, '')
    .trim();
const letters = (value: string): number => (value.match(/\p{L}/gu) ?? []).length;
const isStop = (word: string): boolean => STOP.has(clean(word).toLowerCase());

type Sentence = {first: number; last: number; start: number; end: number};
type Phrase = {sentence: Sentence; text: string; start: number; end: number; score: number};

function sentencesOf(words: readonly WordToken[]): Sentence[] {
  const out: Sentence[] = [];
  let first = 0;
  for (let i = 0; i < words.length; i += 1) {
    const next = words[i + 1];
    const ends = /[.?!…]["')”’]*$/.test(words[i]!.text) || !next || next.start - words[i]!.end >= SENTENCE_GAP_SEC || i - first + 1 >= 28;
    if (ends) {
      out.push({first, last: i, start: words[first]!.start, end: words[i]!.end});
      first = i + 1;
    }
  }
  return out;
}

/** The best 2-5 word run of one sentence: no function word at either edge, as many long content words as possible, a digit or an emphatic word counts extra. */
function phraseOf(words: readonly WordToken[], sentence: Sentence): Phrase | null {
  let best: Phrase | null = null;
  for (let from = sentence.first; from <= sentence.last; from += 1) {
    if (isStop(words[from]!.text)) continue;
    for (let to = from + MIN_PHRASE_WORDS - 1; to <= Math.min(sentence.last, from + MAX_PHRASE_WORDS - 1); to += 1) {
      if (isStop(words[to]!.text)) continue;
      const run = words.slice(from, to + 1);
      const text = clean(run.map(word => word.text).join(' '));
      if (letters(text) < 6 || text.length > 38) continue;
      const content = run.filter(word => !isStop(word.text)).length;
      const long = run.filter(word => letters(clean(word.text)) >= 7).length;
      const digit = /\d/.test(text) ? 1.5 : 0;
      const emphatic = /\b(never|always|only|best|worst|every|nobody|everyone|biggest|stop|must)\b/i.test(text) ? 1 : 0;
      const score = content + long * 0.7 + digit + emphatic - Math.max(0, run.length - 4) * 0.4;
      if (!best || score > best.score) best = {sentence, text, start: run[0]!.start, end: run[run.length - 1]!.end, score};
    }
  }
  return best;
}

/**
 * WP9C: SECTION MARKERS. nj.subedi-style chrome: `01 — <spoken words>` at the start of 2-4 sections of the clip, not in every window. Sections are equal slices of the output; each marker sits on the sentence
 * start nearest its slice start (never inside the hook, never within `gap` of a time in `taken`), and its words are the best 2-5 word run of that sentence (verbatim, the WP8P phrase rule). The ordinal is
 * layout chrome (see groundedText.ts), the words are spoken. A clip under `SECTION_MIN_SEC` gets none. PURE.
 */
export const SECTION_MIN_SEC = 16;
export const SECTION_GAP_SEC = 1.5;
export type SectionMarker = {index: number; start: number; label: string; phrase: string};

export function sectionCount(outputDurationSec: number): number {
  if (!Number.isFinite(outputDurationSec) || outputDurationSec < SECTION_MIN_SEC) return 0;
  return Math.max(2, Math.min(4, Math.round(outputDurationSec / 10)));
}

const SPOKEN_ORDINAL = /^\s*(?:(?:number|step|rule|tip|part|lesson|reason|chapter)\s+(one|two|three|four|five|six|seven|eight|nine|[1-9])\b|(first|second|third|fourth|fifth)\b)/i;
const ORDINAL_NUMBER: Record<string, number> = {one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, first: 1, second: 2, third: 3, fourth: 4, fifth: 5};
/** WP11A: the number a sentence SPEAKS as an ordinal lead ("number two", "step 3", "first, ..."), or null. */
export function spokenOrdinalOf(text: string): number | null {
  const match = SPOKEN_ORDINAL.exec(text);
  const word = (match?.[1] ?? match?.[2])?.toLowerCase();
  return word ? ORDINAL_NUMBER[word] ?? Number(word) : null;
}

/**
 * `spokenOrdinalOnly` (WP11A, default on in the fill): a marker is placed only on a sentence that really leads with an ordinal ("number two ...", "first, ...") and carries THAT number; an invented `01 —` on a random
 * list fragment is never drawn. Off: the legacy equal-slice numbering (kept for the WP9C unit tests).
 */
export function planSectionMarkers(input: {words: readonly WordToken[]; outputDurationSec: number; hookEndSec: number; taken: readonly number[]; spokenOrdinalOnly?: boolean}): SectionMarker[] {
  const count = sectionCount(input.outputDurationSec);
  if (count === 0 || input.words.length < 6) return [];
  const sentences = sentencesOf(input.words);
  const lastStart = input.outputDurationSec - EDGE;
  const used: number[] = [...input.taken];
  const markers: SectionMarker[] = [];
  for (let slice = 0; slice < count; slice += 1) {
    const target = (slice * input.outputDurationSec) / count;
    const pick = sentences
      .map(sentence => ({sentence, phrase: phraseOf(input.words, sentence)}))
      .filter((item): item is {sentence: Sentence; phrase: Phrase} => item.phrase !== null && item.sentence.start >= Math.max(EDGE, input.hookEndSec) && item.sentence.start + FILL_TEXT_DURATION_SEC <= lastStart)
      .filter(item => !input.spokenOrdinalOnly || spokenOrdinalOf(input.words.slice(item.sentence.first, item.sentence.last + 1).map(word => word.text).join(' ')) !== null)
      .filter(item => used.every(time => Math.abs(time - item.sentence.start) >= SECTION_GAP_SEC) && markers.every(marker => marker.start < item.sentence.start))
      .sort((a, b) => Math.abs(a.sentence.start - target) - Math.abs(b.sentence.start - target))[0];
    if (!pick || Math.abs(pick.sentence.start - target) > input.outputDurationSec / count) continue;
    const start = Math.round(pick.sentence.start * 1000) / 1000;
    const spoken = input.spokenOrdinalOnly ? spokenOrdinalOf(input.words.slice(pick.sentence.first, pick.sentence.last + 1).map(word => word.text).join(' ')) : null;
    markers.push({index: markers.length + 1, start, label: `0${spoken ?? markers.length + 1} \u2014 ${pick.phrase.text}`, phrase: pick.phrase.text});
    used.push(start);
  }
  return markers;
}

/** WP9D: the best 2-5 word spoken run (verbatim) that STARTS inside [from, to) and after `notBefore`, or null. The text of an `explainPlateGaps` entry. */
export function spokenPhraseIn(words: readonly WordToken[], from: number, to: number, notBefore = 0): {text: string; start: number; end: number} | null {
  const best = sentencesOf(words)
    .map(sentence => phraseOf(words, sentence))
    .filter((phrase): phrase is Phrase => phrase !== null && phrase.start >= from && phrase.start < to && phrase.start >= Math.max(EDGE, notBefore))
    .sort((a, b) => b.score - a.score || a.start - b.start)[0];
  return best ? {text: best.text, start: best.start, end: best.end} : null;
}

export type FillKind = 'kinetic_text' | 'lockup' | 'card' | 'emphasis';
const FILL_KIND_ORDER: readonly FillKind[] = ['kinetic_text', 'emphasis', 'card', 'lockup'];
/** WP8W: with no usable matte the face carries no text-behind, so designed beats (cards, lockups) come before text pops on the face. */
const FILL_KIND_ORDER_NO_MATTE: readonly FillKind[] = ['card', 'lockup', 'emphasis', 'kinetic_text'];

const MOTION_DEFAULTS = {role: 'primary' as const, shape: 'none' as const, accentColor: '#F4E8C1', textColor: '#FFFFFF', anchor: 'top' as const, entrance: 'fade_blur' as const, exit: 'fade' as const, fontScale: 1};

export type PolishFillInput = {
  direction: VisualDirection;
  look: EditLook;
  /** Words on the same timeline the direction uses (output time). */
  words: readonly WordToken[];
  outputDurationSec: number;
  /** The requested toolkit ids; null = every toolkit. */
  requested: ReadonlySet<string> | null;
  /** WP8W: false = no usable speaker matte (designed beats first, then the engagement cadence fill). Absent / true: the original order. */
  matteUsable?: boolean;
  /** WP8X: start times (output s) of strong beats the direction does not hold yet, e.g. the library seeds the motion stage will place full screen. A window one of them starts in is not filled. */
  coveredBy?: readonly number[];
  /** WP8X: false = a cutaway cannot resolve (creator B-roll only and none supplied): the cadence cover falls back to a card / lockup instead of emitting a moment that would be dropped. Default true. */
  cutawayResolvable?: boolean;
  /** WP9A: the explain-plate path is on (polish, no creator B-roll): predicted library plates in `coveredBy` are the cutaway substitute; a window they miss is reported, never silently chip-only. */
  explainPlates?: boolean;
  /** WP9C: add `01 — …` section markers at 2-4 section starts (polish planner sets it; default off). */
  sectionMarkers?: boolean;
  /** WP11A: legacy invented equal-slice ordinals (tests only). Default: markers only on sentences that speak an ordinal. */
  allowUnspokenOrdinals?: boolean;
  /**
   * WP11B: legacy text chips on the explain path (tests of the chip machinery only). Default false: on the explain path every text beat the fill would add (kinetic text, emphasis, card, lockup,
   * section marker) is a spoken phrase of its own window, i.e. a clone of the karaoke captions, so it is NOT placed. A cadence cover that would have been a card / lockup becomes a full-screen quote
   * plate anchor instead (a designed plate; the captions are muted while it plays).
   */
  allowCaptionClones?: boolean;
  /** WP12C: pacing resets (framed window / procedural transition) in long face-and-karaoke stretches on the explain path. Default on; false = off. */
  pacing?: boolean;
};

export type PolishFillResult = {
  direction: VisualDirection;
  added: Record<string, number>;
  warnings: string[];
  /** WP9B: plates the motion stage must place (a split with no creator media is a library plate, not a footage moment). Empty unless `explainPlates`. */
  plateAnchors: PlateAnchor[];
};

/** Start times of the designed beats (what a new text beat must keep its distance from). Zooms are not here: a kinetic line landing during a punch-in is the point, not a clash. */
const designedTimes = (direction: VisualDirection): number[] => [
  ...direction.moments.map(moment => moment.timestamp),
  ...direction.motionGraphics.map(graphic => graphic.start),
  ...direction.semanticEmphasis.map(item => item.start),
  ...direction.mediaContainers.map(item => item.start),
  ...direction.depthOverlays.map(item => item.start),
  ...direction.frameInsets.map(item => item.start),
];

/** The hook owns the opening: a fill never starts before the hook has left (its own end, or 3.2 s after its start). */
const HOOK_FALLBACK_SEC = 3.2;
const hookEndSec = (direction: VisualDirection): number => (direction.hookTitle?.trim() ? direction.hookEndSec ?? (direction.hookStartSec ?? 0) + HOOK_FALLBACK_SEC : 0);

/** Designed beats already in the direction: everything but zooms, transitions and the hook. (Lockups from the polish fill are moments only, so moments + motionGraphics do not double-count.) */
export function designedBeatCount(direction: VisualDirection): number {
  return (
    direction.moments.length +
    direction.motionGraphics.length +
    direction.semanticEmphasis.length +
    direction.mediaContainers.length +
    direction.depthOverlays.length +
    direction.frameInsets.length
  );
}

/** Designed graphics the Director already placed, counted the way `applyEditLookToDirection` counts them (moments by layout, motion graphics as kinetic_text, ...). */
function graphicCount(direction: VisualDirection, look: EditLook): number {
  const graphic = new Set<string>(look.graphicKinds);
  let count = 0;
  for (const moment of direction.moments) if (graphic.has(kindForMomentLayout(moment.layout))) count += 1;
  if (graphic.has('kinetic_text')) count += direction.motionGraphics.length;
  if (graphic.has('media_container')) count += direction.mediaContainers.length;
  if (graphic.has('frame_inset')) count += direction.frameInsets.length;
  if (graphic.has('depth_overlay')) count += direction.depthOverlays.length;
  return count;
}

export function applyPolishDensityFill(input: PolishFillInput): PolishFillResult {
  const {look, words, outputDurationSec} = input;
  const none: PolishFillResult = {direction: input.direction, added: {}, warnings: [], plateAnchors: []};
  if (look.id === FALLBACK_LOOK_ID || words.length < 6 || outputDurationSec < 8) return none;
  const wants = (kind: string): boolean => look.allowedElementKinds.includes(kind as never) && (!input.requested || input.requested.has(kind));
  let direction = input.direction;
  const added: Record<string, number> = {};
  const mixerWarnings: string[] = [];
  const plateAnchors: PlateAnchor[] = [];
  const sentences = sentencesOf(words);
  const lastStart = outputDurationSec - EDGE;
  const noClones = Boolean(input.explainPlates) && !input.allowCaptionClones;
  let cloneSkipped = 0;

  // WP8W engagement cadence. WP8X: with no usable matte it runs BEFORE the text beats (a window gets its strong beat before weak text takes the phrases); with a usable matte it runs after them, as in WP8W. every ~SEC_PER_ENGAGE window with no STRONG beat gets one (cutaway when requested, else card, else lockup), from a phrase the speaker says in that window.
  // Weak beats (zoom, emphasis, kinetic text on the face) never cover a window. Bounded by the windows themselves; never moves or removes a Director item.
  const coverWindows = (): void => {
    // WP9A: the mixer picks the kind per window (rotating the look-allowed leave-the-face kinds; a card, then a lockup, only where none can be used).
    const plan = planEngagementBeats({
      durationSec: outputDurationSec,
      look,
      words,
      requested: input.requested,
      matteUsable: input.matteUsable,
      cutawayResolvable: input.cutawayResolvable,
      existingStrong: strongBeatTimes(direction),
      libraryCovers: input.coveredBy,
      graphicsUsed: graphicCount(direction, look),
      plateSplit: input.explainPlates,
    });
    const proposed = plan.beats.filter(beat => beat.source === 'proposed');
    const planned = new Map(proposed.map(beat => [beat.windowIndex, beat.kind]));
    const platesVia = new Set(proposed.filter(beat => beat.via === 'plate').map(beat => beat.windowIndex));
    if (input.explainPlates) mixerWarnings.push(...plan.warnings);
    if (planned.size > 0) {
      const strong = [...strongBeatTimes(direction), ...(input.coveredBy ?? [])];
      const weakAndStrong = designedTimes(direction);
      const hookEndNow = hookEndSec(direction);
      const moments: DirectedMoment[] = [...direction.moments];
      let coverAdded = 0;
      for (const window of uncoveredEngagementWindows(direction, outputDurationSec, input.coveredBy)) {
        const inWindow = sentences
          .map(sentence => phraseOf(words, sentence))
          .filter((phrase): phrase is Phrase => phrase !== null && phrase.start >= window.start && phrase.start < window.end && phrase.start >= Math.max(EDGE, hookEndNow) && phrase.start + FILL_TEXT_DURATION_SEC <= lastStart)
          .filter(phrase => strong.every(time => Math.abs(time - phrase.start) >= MIN_BEAT_GAP_SEC) && weakAndStrong.every(time => Math.abs(time - phrase.start) >= 1.5))
          .sort((a, b) => b.score - a.score || a.start - b.start);
        const phrase = inWindow[0];
        const kind = planned.get(window.index);
        if (!phrase || !kind) continue;
        // A cutaway / split is a designed GRAPHIC of the look: it never exceeds `maxGraphics` (counting what is already in the direction and what this step added); cards / lockups are not capped by it.
        if (platesVia.has(window.index)) {
          // WP9B: a split with no creator media is a library plate on the graphic side, asked of the motion stage with the speaker's own words.
          const startAt = Math.round(phrase.start * 1000) / 1000;
          plateAnchors.push({startSec: startAt, text: phrase.text, placement: 'split_screen'});
          strong.push(startAt);
          weakAndStrong.push(startAt);
          added.cadence_plate_split = (added.cadence_plate_split ?? 0) + 1;
          continue;
        }
        if (noClones && (kind === 'card' || kind === 'lockup')) {
          // WP11B: a text chip here would repeat the caption words; the window gets a full-screen quote plate (anchor) instead.
          const startAt = Math.round(phrase.start * 1000) / 1000;
          plateAnchors.push({startSec: startAt, text: phrase.text, placement: 'full_screen'});
          strong.push(startAt);
          weakAndStrong.push(startAt);
          added.cadence_plate_full = (added.cadence_plate_full ?? 0) + 1;
          cloneSkipped += 1;
          continue;
        }
        if (look.graphicKinds.includes(kind as never) && graphicCount({...direction, moments}, look) >= look.maxGraphics) continue;
        const start = Math.round(phrase.start * 1000) / 1000;
        const queries = phrase.text.split(' ').filter(word => !isStop(word) && letters(word) >= 4).slice(0, 3);
        moments.push(
          kind === 'cutaway' || kind === 'split'
            ? {timestamp: start, searchKeyword: queries.join(' ') || phrase.text, media: 'video', layout: kind, anchor: 'top_right', overlayText: '', textStyle: 'bar', accentColor: '#FFFFFF', visualWeight: 'accent', queries: queries.length > 0 ? [queries.join(' ')] : []}
            : {timestamp: start, searchKeyword: phrase.text, media: 'text', layout: kind === 'lockup' ? 'lockup' : 'chip', anchor: 'top_right', overlayText: phrase.text, textStyle: kind === 'lockup' ? 'stack' : 'bar', accentColor: '#FFFFFF', visualWeight: 'accent', queries: []},
        );
        strong.push(start);
        weakAndStrong.push(start);
        coverAdded += 1;
        added[`cadence_${kind}`] = (added[`cadence_${kind}`] ?? 0) + 1;
      }
      if (coverAdded > 0) direction = {...direction, moments};
    }
  };
  if (input.matteUsable === false) coverWindows();

  // 1. text beats
  const eligible = (input.matteUsable === false ? FILL_KIND_ORDER_NO_MATTE : FILL_KIND_ORDER).filter(kind => wants(kind));
  const target = beatTarget(outputDurationSec);
  // WP8X: a predicted library seed is a designed beat too: text beats keep their distance from it instead of stacking on it.
  const times = [...designedTimes(direction), ...(input.coveredBy ?? [])];
  const hookEnd = hookEndSec(direction);
  const missing = Math.max(0, target - designedBeatCount(direction));
  if (noClones && eligible.length > 0 && missing > 0) cloneSkipped += missing; // WP11B: every text beat is a caption clone on the explain path
  if (!noClones && eligible.length > 0 && missing > 0) {
    const graphicKinds = new Set<string>(look.graphicKinds);
    const roomForGraphics = () => Math.max(0, look.maxGraphics - graphicCount(direction, look));
    const phrases = sentences.map(sentence => phraseOf(words, sentence)).filter((phrase): phrase is Phrase => phrase !== null);
    const taken: number[] = [...times];
    const chosen: Array<{phrase: Phrase; kind: FillKind}> = [];
    let graphicsLeft = roomForGraphics();
    let rotate = 0;
    // Greedy, best phrase first, then placed in time order; a phrase needs its start well away from every other beat.
    for (const phrase of [...phrases].sort((a, b) => b.score - a.score || a.start - b.start)) {
      if (chosen.length >= missing) break;
      if (phrase.start < Math.max(EDGE, hookEnd) || phrase.start + FILL_TEXT_DURATION_SEC > lastStart) continue;
      if (taken.some(time => Math.abs(time - phrase.start) < MIN_BEAT_GAP_SEC)) continue;
      let kind: FillKind | undefined;
      for (let step = 0; step < eligible.length; step += 1) {
        const candidate = eligible[(rotate + step) % eligible.length]!;
        const isGraphic = graphicKinds.has(candidate);
        if (isGraphic && graphicsLeft <= 0) continue;
        kind = candidate;
        rotate = (rotate + step + 1) % eligible.length;
        if (isGraphic) graphicsLeft -= 1;
        break;
      }
      if (!kind) continue;
      taken.push(phrase.start);
      chosen.push({phrase, kind});
    }
    chosen.sort((a, b) => a.phrase.start - b.phrase.start);
    const motionGraphics: MotionGraphic[] = [...direction.motionGraphics];
    const moments: DirectedMoment[] = [...direction.moments];
    const semanticEmphasis: SemanticEmphasis[] = [...direction.semanticEmphasis];
    for (const {phrase, kind} of chosen) {
      const start = Math.round(phrase.start * 1000) / 1000;
      const end = Math.round(Math.min(start + FILL_TEXT_DURATION_SEC, lastStart) * 1000) / 1000;
      if (kind === 'kinetic_text') {
        motionGraphics.push({start, end, text: phrase.text, ...MOTION_DEFAULTS});
      } else if (kind === 'emphasis') {
        semanticEmphasis.push({start, end, text: phrase.text, weight: 'primary', treatment: 'pop', accentColor: MOTION_DEFAULTS.accentColor});
      } else {
        const lockup = kind === 'lockup';
        moments.push({
          timestamp: start,
          searchKeyword: phrase.text,
          media: 'text',
          layout: lockup ? 'lockup' : 'chip',
          anchor: 'top_right',
          overlayText: phrase.text,
          textStyle: lockup ? 'stack' : 'bar',
          accentColor: '#FFFFFF',
          visualWeight: 'accent',
          queries: [],
        });
      }
      added[kind] = (added[kind] ?? 0) + 1;
    }
    if (chosen.length > 0) direction = {...direction, motionGraphics, moments, semanticEmphasis};
  }

  if (input.matteUsable !== false) coverWindows();

  // WP9C: section markers last, so they never take a window an engagement cover needs; they keep SECTION_GAP_SEC from every other designed beat.
  if (input.sectionMarkers && noClones) cloneSkipped += 0; // WP11B: section markers are text chips too; a spoken ordinal is a StampTitle plate seed instead
  if (input.sectionMarkers && !noClones) {
    const kind = (['kinetic_text', 'lockup', 'card', 'emphasis'] as const).find(candidate => wants(candidate));
    if (kind) {
      const isGraphic = look.graphicKinds.includes(kind as never);
      const markers = planSectionMarkers({words, outputDurationSec, hookEndSec: hookEndSec(direction), spokenOrdinalOnly: !input.allowUnspokenOrdinals, taken: [...designedTimes(direction), ...strongBeatTimes(direction), ...(input.coveredBy ?? []), ...plateAnchors.map(anchor => anchor.startSec)]});
      const motionGraphics: MotionGraphic[] = [...direction.motionGraphics];
      const moments: DirectedMoment[] = [...direction.moments];
      const semanticEmphasis: SemanticEmphasis[] = [...direction.semanticEmphasis];
      let placed = 0;
      for (const marker of markers) {
        if (isGraphic && graphicCount({...direction, motionGraphics, moments}, look) >= look.maxGraphics) break;
        const end = Math.round(Math.min(marker.start + FILL_TEXT_DURATION_SEC, lastStart) * 1000) / 1000;
        if (kind === 'kinetic_text') motionGraphics.push({start: marker.start, end, text: marker.label, ...MOTION_DEFAULTS});
        else if (kind === 'emphasis') semanticEmphasis.push({start: marker.start, end, text: marker.label, weight: 'secondary', treatment: 'pop', accentColor: MOTION_DEFAULTS.accentColor});
        else moments.push({timestamp: marker.start, searchKeyword: marker.phrase, media: 'text', layout: kind === 'lockup' ? 'lockup' : 'chip', anchor: 'top_right', overlayText: marker.label, textStyle: kind === 'lockup' ? 'stack' : 'bar', accentColor: '#FFFFFF', visualWeight: 'accent', queries: []});
        placed += 1;
      }
      if (placed > 0) {
        direction = {...direction, motionGraphics, moments, semanticEmphasis};
        added.section_markers = placed;
      }
    }
  }

  // 2. zoom floor
  if (wants('zoom')) {
    const floor = zoomFloor(outputDurationSec);
    const need = Math.max(0, floor - direction.zooms.length);
    if (need > 0) {
      const starts = direction.zooms.map(zoom => zoom.timestamp);
      const zooms: DirectedZoom[] = [...direction.zooms];
      let addedZooms = 0;
      // Even spread: try the sentence starts nearest to equally spaced targets first.
      const slots = Array.from({length: need}, (_, index) => ((index + 1) * outputDurationSec) / (need + 1));
      const pool = sentences.filter(sentence => sentence.start >= 1 && sentence.start + FILL_ZOOM_DURATION_SEC <= lastStart);
      for (const slot of slots) {
        const pick = [...pool].sort((a, b) => Math.abs(a.start - slot) - Math.abs(b.start - slot)).find(sentence => starts.every(time => Math.abs(time - sentence.start) >= MIN_ZOOM_GAP_SEC));
        if (!pick) continue;
        starts.push(pick.start);
        zooms.push({timestamp: Math.round(pick.start * 1000) / 1000, durationSec: FILL_ZOOM_DURATION_SEC});
        addedZooms += 1;
      }
      if (addedZooms > 0) {
        zooms.sort((a, b) => a.timestamp - b.timestamp);
        direction = {...direction, zooms};
        added.zoom = addedZooms;
      }
    }
  }

  // WP12C: PACING. A long stretch with no leave-the-face beat gets a framed window (sharp window over a blurred copy of itself) or a procedural transition at a sentence start, never a caption-clone chip.
  if (input.explainPlates && input.pacing !== false) {
    const span = (start: number, length: number) => ({start, end: start + length});
    const beats = [
      ...strongBeatTimes(direction).map(start => span(start, 3)),
      ...(input.coveredBy ?? []).map(start => span(start, 3)),
      ...plateAnchors.map(anchor => span(anchor.startSec, 3)),
      ...direction.mediaContainers.map(item => ({start: item.start, end: item.end})),
      ...(direction.transitions ?? []).map(item => ({start: item.start, end: item.end})),
      ...(direction.gradeBeats ?? []).map(item => ({start: item.start, end: item.end})),
    ];
    const framedAllowed = look.allowedElementKinds.includes('media_container' as never) && graphicCount(direction, look) < look.maxGraphics;
    const plan = planPacing({
      durationSec: outputDurationSec,
      beats,
      sentenceStarts: sentences.map(sentence => sentence.start).filter(start => start >= Math.max(EDGE, hookEndSec(direction)) && start <= lastStart),
      framedAllowed,
      transitionAllowed: look.allowedElementKinds.includes('transition' as never),
      gradeAllowed: true,
    });
    if (plan.grades.length > 0) {
      direction = {...direction, gradeBeats: [...(direction.gradeBeats ?? []), ...plan.grades.map(item => ({start: item.start, end: item.end}))]};
      mixerWarnings.push(`polish_pace:grade_bw:${plan.grades.length}`);
    }
    if (plan.framed.length > 0) {
      const mediaContainers = [...direction.mediaContainers, ...plan.framed.map(item => ({start: item.start, end: item.end, mode: 'rounded_window' as const, canvasColor: '#0B0B0B', canvasStyle: 'blur_self' as const, cornerRadius: 36, scale: 0.72, transitionSec: 0.5}))];
      direction = {...direction, mediaContainers};
      mixerWarnings.push(`polish_pace:framed_window:${plan.framed.length}`);
    }
    if (plan.transitions.length > 0) {
      direction = {...direction, transitions: [...(direction.transitions ?? []), ...plan.transitions.map(item => ({start: item.start, end: item.end, style: item.style}))]};
      mixerWarnings.push(`polish_pace:transition:${plan.transitions.length}`);
    }
  }

  const warnings = Object.entries(added).map(([kind, count]) => `polish_density_fill:${kind}:${count}`);
  if (cloneSkipped > 0) warnings.push(`motion_graphic:caption_clone_skipped:density:${cloneSkipped}`);
  return {direction, added, warnings: [...warnings, ...mixerWarnings], plateAnchors};
}
