/**
 * WP9D: EXPLAIN-PLATE GAPS. After the library plates (seeds + plate anchors) are placed, some ~8 s engagement windows can still have no cover that leaves the face (variety exhausted, no candidate fit,
 * an anchor refused). Each such window is a GAP carrying a grounded 2-5 word spoken phrase, and may be offered to the Claude motion generator as a custom plate. PURE: no env, no logger, no I/O, no model call.
 * Nothing here knows a clip, a niche, a content type or a mood: only windows, covers and spoken words.
 */
import {engagementWindows} from './engagementCadence.ts';
import {spokenPhraseIn} from './polishDensityFill.ts';
import {recipeForComposition} from '../../lib/motionRecipes.ts';
import {plateShapeAt, type PlateStyle} from '../motionDirector/transcriptLibrarySeed.ts';

export const MAX_CLAUDE_PLATES = 3;
const PLATE_SEC = 3.5;

export type ExplainPlateGap = {windowIndex: number; startSec: number; endSec: number; spokenPhrase: string; phraseStartSec: number};

/** Windows no cover starts in, each with the best spoken phrase of that window (a window with no usable phrase is not a gap: there is nothing grounded to draw). */
export function detectExplainPlateGaps(input: {durationSec: number; words: ReadonlyArray<{text: string; start: number; end: number}>; coverStarts: readonly number[]; notBeforeSec?: number}): ExplainPlateGap[] {
  const gaps: ExplainPlateGap[] = [];
  for (const window of engagementWindows(input.durationSec)) {
    if (input.coverStarts.some(time => time >= window.start && time < window.end)) continue;
    const phrase = spokenPhraseIn(input.words, window.start, window.end, input.notBeforeSec ?? 0);
    if (phrase) gaps.push({windowIndex: window.index, startSec: window.start, endSec: window.end, spokenPhrase: phrase.text, phraseStartSec: phrase.start});
  }
  return gaps;
}

/** The raw brief shape `assembleDirectedGraphics` takes (same as a seed / Director brief). */
export type ClaudePlateBrief = {
  id: string;
  anchorWordIndex: number;
  durationSeconds: number;
  reason: string;
  goal: string;
  visualDescription: string;
  placement: 'split_screen' | 'full_screen';
  graphicSide?: 'top';
  contentJson: string;
};

const STYLE_WORDS: Record<PlateStyle, string> = {
  VsClaim: 'a two-sided before-vs-after style callout',
  StatHighlight: 'a big-number stat card',
  ProcessSteps: 'a step-by-step process diagram',
  BeforeAfter: 'a before and after comparison card',
  ChartExplainer: 'a labelled bar chart',
  StampTitle: 'a section stamp title card',
  TweetCard: 'a social-post style card',
  OpenPlate: 'a curved-headline plate',
  WikiCallout: 'an encyclopedia article callout',
  NewspaperCallout: 'a newspaper clipping callout',
  headline: 'a headline card',
};

/**
 * Briefs for at most `limit` gaps (never above MAX_CLAUDE_PLATES), earliest first. WP9F: the content is a typed, library-shaped object chosen from the sentence around the gap phrase (contrast -> {left, right},
 * number -> {value, label}, ordered cues -> {steps}, before / after -> {before, after}, labelled numbers -> {data}; otherwise {headline}); every string is a verbatim spoken run, so a brief that fits a library
 * composition is delivered from the library and only a miss reaches the generator. `visualDescription` names the style that matches the shape. Placement alternates split_screen (graphic on top, speaker
 * below) and full_screen.
 */
export function buildClaudePlateBriefs(gaps: readonly ExplainPlateGap[], words: ReadonlyArray<{text: string; start: number; end: number}>, limit: number): ClaudePlateBrief[] {
  const briefs: ClaudePlateBrief[] = [];
  for (const gap of gaps) {
    if (briefs.length >= Math.min(limit, MAX_CLAUDE_PLATES)) break;
    let index = -1;
    for (let i = 0; i < words.length && words[i]!.start <= gap.phraseStartSec + 0.05; i += 1) index = i;
    if (index < 0) continue;
    const split = briefs.length % 2 === 0;
    const shape = plateShapeAt(words, gap.phraseStartSec);
    const style: PlateStyle = shape?.composition && shape.composition in STYLE_WORDS ? (shape.composition as PlateStyle) : 'headline';
    const baseContent = shape?.content ?? {headline: gap.spokenPhrase};
    // WP14B: a suggested motion recipe from the beat intent of the shape (evidence -> split_mask_reveal ...): a library host runs it, a Claude-authored graphic is told to use it.
    const recipeId = shape ? recipeForComposition(shape.composition, briefs.length) : undefined; // WP14C: later briefs rotate through the intent's variety pool
    const content = recipeId ? {...baseContent, recipeId} : baseContent;
    briefs.push({
      id: `claude-plate-${gap.windowIndex + 1}`,
      anchorWordIndex: index,
      durationSeconds: PLATE_SEC,
      reason: 'explain plate: no library cover in this window',
      goal: `Make the line "${gap.spokenPhrase}" visible as a designed explain plate.`,
      visualDescription: `${STYLE_WORDS[style]} for: ${gap.spokenPhrase}. Use the given content exactly; the only text allowed on it is those words.`,
      placement: split ? 'split_screen' : 'full_screen',
      ...(split ? {graphicSide: 'top' as const} : {}),
      contentJson: JSON.stringify(content),
    });
  }
  return briefs;
}
