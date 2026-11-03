/**
 * WP2B: legibility of the shipped short-form edit. Pure (types, `lib/contrast.ts`, `lib/provenance.ts` and the contrast-adjust helper in colorRoles.ts only: no logger,
 * `.env`, SDK or network), so every rule is unit-testable with synthetic data. Applied ONLY by the `mvp` product profile (analyzeVideo.ts); the legacy path never calls it.
 *
 * Rows of the launch bar (PHASE36J rubric rows 1 and 3):
 *  - hook: the title stays inside the top safe area, above the caption band and above the speaker's head/cap region. Size is reduced to a readable floor first;
 *    only then are words dropped FROM THE END. The hook is never moved in time (this module has no time input at all).
 *  - captions: never a single word at a time, never smaller than the template size, never centered or at the top over the face; text vs its box reaches 4.5:1.
 *  - on-screen text: text on an accent plate (pill / bar / block / bubble, highlight_shape) reaches 4.5:1 against the plate.
 *  - motion-graphic / emphasis text whose words are not in the transcript is removed (WP2C: Director or fallback; these types have no paraphrase marker). The hook title (WP4R) is grounded the same way before it is fitted: the "WATCH THIS" placeholder or a title with an unspoken word is cleared to '' with no fit and the warning legibility:ungrounded_hook_cleared (applyLegibility only; the legacy path never calls it, and the placeholder policy and the art-directed opening are untouched).
 * What is NOT measured here: the footage behind text that has no plate of its own. That needs pixels; it is reported as an open limit, not claimed.
 */
import {contrastRatio} from '../../lib/contrast.ts';
import {carryProvenance, carryProvenanceUnlessChanged} from '../../lib/provenance.ts';
import type {CaptionDirection, HookFit, LegibilitySpec, MotionGraphic, SemanticEmphasis} from '../../types/blueprint.ts';
import {adjustForContrast} from '../openingPlan/colorRoles.ts';
import {isGroundedInTranscript, phraseRelevantToWindow} from './groundedText.ts';

export type {HookFit, LegibilitySpec};
// The grounding matcher lives in groundedText.ts (shared with the offline scorer); re-exported so existing imports keep working.
export {isGroundedInTranscript, phraseRelevantToWindow};

export const TARGET_CONTRAST = 4.5;

// ---- hook -------------------------------------------------------------------------------------------------------------------------------------------------------
export const HOOK = {
  topFrac: 0.06, // matches safeAreaFor: platform UI occupies the top 6%
  noBandTopFrac: 0.05,
  widthFrac: 0.88,
  textWidthFrac: 0.78, // inside the plate padding
  charWidthEm: 0.62, // conservative average advance of an upper-case display face
  lineHeight: 1.12,
  padYFrac: 0.012,
  sizeMaxFrac: 0.075, // of canvas width
  sizeFloorFrac: 0.045, // 48 px on a 1080-wide canvas: readable on a phone
  sizeStepFrac: 0.003,
  maxLines: 2,
  /** Where the head/cap region is assumed to start when no measured speaker box exists. */
  defaultClearBottomFrac: 0.22,
  marginFrac: 0.01,
  inkColor: '#FFFFFF',
  accentColor: '#FFE14A',
  plateColor: '#0B0B0F',
} as const;

function wrapLines(words: readonly string[], maxChars: number): {lines: number; overflowWord: boolean} {
  let lines = 1;
  let used = 0;
  let overflowWord = false;
  for (const word of words) {
    if (word.length > maxChars) overflowWord = true;
    const need = used === 0 ? word.length : used + 1 + word.length;
    if (used !== 0 && need > maxChars) {
      lines += 1;
      used = word.length;
    } else {
      used = need;
    }
  }
  return {lines, overflowWord};
}

const sizes = (): number[] => {
  const out: number[] = [];
  for (let size = HOOK.sizeMaxFrac; size >= HOOK.sizeFloorFrac - 1e-9; size -= HOOK.sizeStepFrac) out.push(Math.max(HOOK.sizeFloorFrac, Math.round(size * 10_000) / 10_000));
  if (out[out.length - 1] !== HOOK.sizeFloorFrac) out.push(HOOK.sizeFloorFrac);
  return out;
};

export function fitHookTitle(input: {
  title: string;
  canvasWidth: number;
  canvasHeight: number;
  /** Measured top of the speaker box (normalised), if any. */
  speakerTopFrac?: number;
  speakerSource?: 'vision' | 'fallback';
}): {title: string; fit: HookFit | null; warnings: string[]} {
  const words = input.title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return {title: '', fit: null, warnings: []};
  const aspect = input.canvasWidth / input.canvasHeight;
  const measured = input.speakerSource === 'vision' && typeof input.speakerTopFrac === 'number' && Number.isFinite(input.speakerTopFrac);
  const clearBottom = measured ? Math.min(HOOK.defaultClearBottomFrac + 0.1, (input.speakerTopFrac as number) - HOOK.marginFrac) : HOOK.defaultClearBottomFrac - HOOK.marginFrac;
  const available = clearBottom - HOOK.topFrac;
  const heightOf = (size: number, lines: number) => lines * size * aspect * HOOK.lineHeight + 2 * HOOK.padYFrac;
  const plate = {inkColor: HOOK.inkColor, accentColor: HOOK.accentColor, plateColor: HOOK.plateColor};

  const attempt = (count: number, limit: number | null): HookFit | null => {
    const subset = words.slice(0, count);
    for (const size of sizes()) {
      const maxChars = Math.floor(HOOK.textWidthFrac / (size * HOOK.charWidthEm));
      const {lines, overflowWord} = wrapLines(subset, maxChars);
      if (lines > HOOK.maxLines || overflowWord) continue;
      const heightFrac = heightOf(size, lines);
      if (limit !== null && heightFrac > limit) continue;
      return {sizeFrac: size, widthFrac: HOOK.widthFrac, topFrac: limit === null ? HOOK.noBandTopFrac : HOOK.topFrac, heightFrac, lines, ...plate, clearBand: limit !== null, shortened: count < words.length};
    }
    return null;
  };

  for (let count = words.length; count >= 1; count -= 1) {
    const fit = attempt(count, available);
    if (fit) {
      return {title: words.slice(0, count).join(' '), fit, warnings: count < words.length ? [`hook_shortened:${words.length - count}`] : []};
    }
  }
  // No band above the head region holds even one floor-size line. Keep the safe top, still never more than two lines at the floor, and say so.
  for (let count = words.length; count >= 1; count -= 1) {
    const fit = attempt(count, null);
    if (fit) return {title: words.slice(0, count).join(' '), fit, warnings: ['hook_no_clear_band', ...(count < words.length ? [`hook_shortened:${words.length - count}`] : [])]};
  }
  // A single word wider than the safe width even at the floor: leave the text as given at the floor size (never invent or cut letters) and report it.
  const size = HOOK.sizeFloorFrac;
  return {title: input.title.trim(), fit: {sizeFrac: size, widthFrac: HOOK.widthFrac, topFrac: HOOK.noBandTopFrac, heightFrac: heightOf(size, 1), lines: 1, ...plate, clearBand: false, shortened: false}, warnings: ['hook_no_clear_band', 'hook_word_wider_than_safe_width']};
}

// ---- captions ---------------------------------------------------------------------------------------------------------------------------------------------------
export const ONE_WORD_CAPTION_TEMPLATES: ReadonlySet<string> = new Set(['simple-one-word', 'simple-one-word-theme', 'kinetic-slam']);
export const CAPTION = {
  minFontScale: 1,
  maxFontScale: 1.4,
  minBottomFrac: 0.14,
  maxBottomFrac: 0.3,
  replacementTemplate: 'classic',
  splitBoxColor: 'rgba(11,11,15,0.82)',
  splitTextColor: '#FFFFFF',
  splitPlateColor: '#0B0B0F',
  /** The translucent plate (82% of #0B0B0F) over pure-white footage: the lightest background the split captions can ever sit on. */
  splitPlateWorstCase: '#373737',
  splitHighlightFallback: '#FFE14A',
} as const;
const HEX6 = /^#[0-9a-fA-F]{6}$/;

export function legibleCaption(caption: CaptionDirection): {caption: CaptionDirection; changes: string[]} {
  const changes: string[] = [];
  const next: CaptionDirection = {...caption};
  if (next.template && ONE_WORD_CAPTION_TEMPLATES.has(next.template)) {
    next.template = CAPTION.replacementTemplate;
    changes.push('caption_template_not_one_word');
  }
  // An absent fontScale means "the template's own size" and stays absent (setting it would change how package themes size themselves).
  if (typeof next.fontScale === 'number') {
    const scale = Math.min(CAPTION.maxFontScale, Math.max(CAPTION.minFontScale, next.fontScale));
    if (scale !== next.fontScale) {
      next.fontScale = scale;
      changes.push('caption_font_scale');
    }
  }
  if (next.position !== 'bottom') {
    next.position = 'bottom';
    changes.push('caption_position_off_face');
  }
  const bottomFrac = Math.min(CAPTION.maxBottomFrac, Math.max(CAPTION.minBottomFrac, Number.isFinite(next.bottomFrac) ? next.bottomFrac : CAPTION.minBottomFrac));
  if (bottomFrac !== next.bottomFrac) {
    next.bottomFrac = bottomFrac;
    changes.push('caption_bottom_frac');
  }
  if (next.boxColor && HEX6.test(next.boxColor) && HEX6.test(next.textColor) && contrastRatio(next.textColor, next.boxColor) < TARGET_CONTRAST) {
    next.textColor = adjustForContrast(next.textColor, next.boxColor, TARGET_CONTRAST) ?? (contrastRatio('#FFFFFF', next.boxColor) >= contrastRatio('#111111', next.boxColor) ? '#FFFFFF' : '#111111');
    changes.push('caption_text_vs_box');
  }
  return {caption: next, changes};
}

/** The split-caption colours written into the blueprint. Text is white; the highlight is raised to >= 4.5:1 against the worst-case plate. */
export function captionSplitSpec(caption: Pick<CaptionDirection, 'highlightColor'>): LegibilitySpec['captions'] {
  const wanted = HEX6.test(caption.highlightColor) ? caption.highlightColor : CAPTION.splitHighlightFallback;
  const highlight = contrastRatio(wanted, CAPTION.splitPlateWorstCase) >= TARGET_CONTRAST ? wanted : adjustForContrast(wanted, CAPTION.splitPlateWorstCase, TARGET_CONTRAST) ?? CAPTION.splitHighlightFallback;
  return {
    avoidSplitFace: true,
    splitBoxColor: CAPTION.splitBoxColor,
    splitTextColor: CAPTION.splitTextColor,
    splitHighlightColor: highlight,
    splitPlateColor: CAPTION.splitPlateColor,
  };
}

/** WP3U: frames the split caption placement is held before/after a B-roll split. */
export const CAPTION_SPLIT_HOLD_FRAMES = 6;

/** WP3U: the hold for a blueprint at `fps`. A missing or unusable fps is NOT guessed: no hold is written (the renderer then keeps the instant switch) and the caller records `caption_hold_skipped`. */
export function captionSplitHold(fps: unknown): {frames: number} | {skipped: 'caption_hold_skipped'} {
  return typeof fps === 'number' && Number.isFinite(fps) && fps > 0 ? {frames: CAPTION_SPLIT_HOLD_FRAMES} : {skipped: 'caption_hold_skipped'};
}

// ---- on-screen text on a plate ------------------------------------------------------------------------------------------------------------------------------------
const PLATE_SHAPES: ReadonlySet<string> = new Set(['pill', 'bar', 'block', 'bubble']);

function readableOn(plate: string, text: string): string {
  if (!HEX6.test(plate) || !HEX6.test(text) || contrastRatio(text, plate) >= TARGET_CONTRAST) return text;
  return adjustForContrast(text, plate, TARGET_CONTRAST) ?? (contrastRatio('#FFFFFF', plate) >= contrastRatio('#0B0B0F', plate) ? '#FFFFFF' : '#0B0B0F');
}

export function legibleOnScreenText(input: {motionGraphics: readonly MotionGraphic[]; semanticEmphasis: readonly SemanticEmphasis[]}): {
  motionGraphics: MotionGraphic[];
  semanticEmphasis: SemanticEmphasis[];
  recolored: number;
} {
  let recolored = 0;
  const motionGraphics = input.motionGraphics.map(graphic => {
    if (!PLATE_SHAPES.has(graphic.shape)) return graphic;
    const textColor = readableOn(graphic.accentColor, graphic.textColor);
    if (textColor === graphic.textColor) return graphic;
    recolored += 1;
    return carryProvenanceUnlessChanged(graphic, {...graphic, textColor});
  });
  const semanticEmphasis = input.semanticEmphasis.map(item => {
    if (item.treatment !== 'highlight_shape') return item;
    const current = item.textColor || '#FFFFFF';
    const textColor = readableOn(item.accentColor, current);
    if (textColor === current) return item;
    recolored += 1;
    return carryProvenanceUnlessChanged(item, {...item, textColor});
  });
  return {motionGraphics, semanticEmphasis, recolored};
}

// ---- on-screen text that the transcript does not contain ------------------------------------------------------------------------------------------------
export const PLACEHOLDER_TEXT = 'WATCH THIS';
/**
 * `mvp` profile: on-screen text (motion graphics, semantic emphasis) must be words the speaker said. These two types carry NO paraphrase marker (the opening plan has
 * `wording_source`; they do not), so absence of the words from the transcript means drop, whether the Director or a fallback wrote it. The placeholder constant is always
 * dropped. A paraphrase is never invented here. Spoken numbers written as words ("five million") do not match digits ("5 million") and are dropped too (a stated limit).
 */
export function dropUngroundedText<T extends {text: string}>(items: readonly T[], transcript: string): {kept: T[]; dropped: T[]} {
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const item of items) {
    if (item.text.trim().toUpperCase() === PLACEHOLDER_TEXT || !isGroundedInTranscript(item.text, transcript)) dropped.push(item);
    else kept.push(item);
  }
  return {kept, dropped};
}

// ---- WP3S: the other viewer-visible words (generated-graphic copy, text overlays, behind-subject text) ---------------------------------------------------------------
/**
 * Same rule as the motion graphics and emphasis above, extended to the three remaining places words reach the screen. The matcher is `isGroundedInTranscript` (groundedText.ts); the
 * hook title is not filtered. The fields read mirror the offline scorer's row 6 (a test makes the writer and the scorer agree on a grid of cases).
 */
const NOT_WORDS = /^(?:https?:|data:|blob:|file:|staticFile:|\/\/)|^#[0-9a-f]{3,8}$/i;

function contentStrings(node: unknown, out: string[], depth = 0): void {
  if (depth > 8) return;
  if (typeof node === 'string') {
    if (node.trim() !== '' && !NOT_WORDS.test(node.trim())) out.push(node);
  } else if (Array.isArray(node)) {
    node.forEach(item => contentStrings(item, out, depth + 1));
  } else if (node && typeof node === 'object') {
    // WP11A: `icon` / `icons` hold Lucide icon names (a drawn symbol, not words on screen).
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) if (key !== 'icon' && key !== 'icons' && key !== 'recipeId') contentStrings(value, out, depth + 1);
  }
}

/** True when every string in the graphic's `props.content` (the exact copy the designer shows) is made of spoken words. A graphic with no text is grounded. */
export function generatedGraphicIsGrounded(graphic: {props?: Record<string, unknown>}, transcript: string): boolean {
  const strings: string[] = [];
  contentStrings(graphic.props?.content, strings);
  return strings.every(text => isGroundedInTranscript(text, transcript));
}

/** Drops a generated graphic whose copy has a word the speaker did not say. Kept graphics are the same objects, in order, with their times untouched. */
export function dropUngroundedGeneratedGraphics<T extends {props?: Record<string, unknown>}>(graphics: readonly T[], transcript: string): {kept: T[]; dropped: T[]} {
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const graphic of graphics) (generatedGraphicIsGrounded(graphic, transcript) ? kept : dropped).push(graphic);
  return {kept, dropped};
}

/** Behind-subject text is not placed when it states a word the speaker did not say (no layered fallback can be built after the fact: it would show the same words and needs a Claude call). */
export function dropUngroundedBehindSubject<T extends {text: string}>(entries: readonly T[], transcript: string): {kept: T[]; dropped: T[]} {
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const entry of entries) (isGroundedInTranscript(entry.text, transcript) ? kept : dropped).push(entry);
  return {kept, dropped};
}

/** The overlay layouts that draw words (VisualOverlayTrack: the phrase stack for lockup and stat, the banner, the bubble, the chip). The others draw media only. */
export const TEXT_OVERLAY_LAYOUTS: ReadonlySet<string> = new Set(['lockup', 'stat', 'banner', 'bubble', 'chip']);

type OverlayLike = {layout?: string; overlayText?: string; keyword?: string; assetUrl?: string; slides?: readonly unknown[]; start?: number; end?: number};
type TimedWord = {text: string; start: number; end: number};

/**
 * Overlay words. A text layout draws `overlayText || keyword`; if those words are not all spoken the text is removed (both fields, so the renderer cannot fall back to the keyword): the
 * overlay is dropped when nothing but that text is left (no `assetUrl`, no slides), and kept without its words when it carries media. A media layout never draws words, so it always
 * stays; only an ungrounded `overlayText` is cleared. An overlay with no words, or with spoken words, is the same object. Times are never touched.
 * WP56: when `captionWords` is provided, drawn text must also be relevant to the overlay's time window (±0.5s), not only the full transcript.
 */
export function groundOverlayText<O extends OverlayLike>(
  overlays: readonly O[],
  transcript: string,
  captionWords?: readonly TimedWord[],
): {overlays: O[]; dropped: O[]; cleared: O[]; contextMismatched?: O[]} {
  const out: O[] = [];
  const dropped: O[] = [];
  const cleared: O[] = [];
  const contextMismatched: O[] = [];
  const windowText = (start: number, end: number) => {
    if (!captionWords?.length) return transcript;
    const pad = 0.5;
    // Empty window → empty string (WP56: do NOT fall back to the full transcript — that would accept off-section slogans).
    return captionWords
      .filter(w => w.end > start - pad && w.start < end + pad)
      .map(w => w.text)
      .join(' ');
  };
  const acceptDrawn = (drawn: string, overlay: OverlayLike): boolean => {
    if (!drawn.trim()) return true;
    if (!isGroundedInTranscript(drawn, transcript)) return false;
    if (!captionWords?.length) return true;
    const start = typeof overlay.start === 'number' ? overlay.start : 0;
    const end = typeof overlay.end === 'number' ? overlay.end : start + 4;
    return phraseRelevantToWindow(drawn, windowText(start, end));
  };
  for (const overlay of overlays) {
    const layout = String(overlay.layout);
    if (TEXT_OVERLAY_LAYOUTS.has(layout)) {
      const drawn = overlay.overlayText ? overlay.overlayText : overlay.keyword ?? '';
      if (typeof drawn !== 'string' || drawn.trim() === '' || acceptDrawn(drawn, overlay)) {
        out.push(overlay);
      } else if (isGroundedInTranscript(String(drawn), transcript) && captionWords?.length) {
        // WP56: spoken somewhere else in the video but not in this section window
        if (overlay.assetUrl || (overlay.slides?.length ?? 0) > 0) {
          const rebuilt = carryProvenance(overlay, {...overlay, overlayText: '', keyword: ''});
          out.push(rebuilt);
          cleared.push(rebuilt);
          contextMismatched.push(rebuilt);
        } else {
          dropped.push(overlay);
          contextMismatched.push(overlay);
        }
      } else if (overlay.assetUrl || (overlay.slides?.length ?? 0) > 0) {
        const rebuilt = carryProvenance(overlay, {...overlay, overlayText: '', keyword: ''});
        out.push(rebuilt);
        cleared.push(rebuilt);
      } else {
        dropped.push(overlay);
      }
    } else if (typeof overlay.overlayText === 'string' && overlay.overlayText.trim() !== '' && !acceptDrawn(overlay.overlayText, overlay)) {
      const rebuilt = carryProvenance(overlay, {...overlay, overlayText: ''});
      out.push(rebuilt);
      cleared.push(rebuilt);
      if (isGroundedInTranscript(overlay.overlayText, transcript) && captionWords?.length) contextMismatched.push(rebuilt);
    } else {
      out.push(overlay);
    }
  }
  return {overlays: out, dropped, cleared, ...(contextMismatched.length ? {contextMismatched} : {})};
}

// ---- WP4G: canvas titles and inset graphic text ---------------------------------------------------------------------------------------------------------------------
type ContainerLike = {canvasTitle?: string};

/**
 * A media container draws `canvasTitle` as written. A title with a word the speaker did not say is cleared (the container, its times and its colours are untouched; the title colour
 * stays). An empty title, or one whose words were all spoken, is the same object. Nothing is dropped, so there is no ledger entry.
 */
export function groundCanvasTitles<C extends ContainerLike>(containers: readonly C[], transcript: string): {containers: C[]; cleared: C[]} {
  const out: C[] = [];
  const cleared: C[] = [];
  for (const container of containers) {
    const title = container.canvasTitle;
    if (typeof title === 'string' && title.trim() !== '' && !isGroundedInTranscript(title, transcript)) {
      const rebuilt = carryProvenance(container, {...container, canvasTitle: ''});
      out.push(rebuilt);
      cleared.push(rebuilt);
    } else {
      out.push(container);
    }
  }
  return {containers: out, cleared};
}

type InsetLike = {params?: {variant?: string; graphic?: {text?: string; data?: Record<string, string | number>}}};

/**
 * An inset reveal with the motion-graphic variant draws its graphic's `text`, and a stat callout also draws `data.label`. Each of those with a word the speaker did not say is cleared; the
 * reveal, its times, its template and every other `data` key are untouched. Spoken words and empty fields are left as they are (the same object when nothing changes). Nothing is dropped.
 */
export function groundInsetText<I extends InsetLike>(clips: readonly I[], transcript: string): {insetReveals: I[]; cleared: I[]} {
  const out: I[] = [];
  const cleared: I[] = [];
  const ungrounded = (value: unknown) => (typeof value === 'string' || typeof value === 'number') && String(value).trim() !== '' && !isGroundedInTranscript(String(value), transcript);
  for (const clip of clips) {
    const graphic = clip.params?.graphic;
    if (!graphic || clip.params?.variant !== 'motion_graphic') {
      out.push(clip);
      continue;
    }
    const clearText = ungrounded(graphic.text);
    const clearLabel = ungrounded(graphic.data?.label);
    if (!clearText && !clearLabel) {
      out.push(clip);
      continue;
    }
    const nextGraphic = {
      ...graphic,
      ...(clearText ? {text: ''} : {}),
      ...(clearLabel ? {data: {...graphic.data, label: ''}} : {}),
    };
    const rebuilt = carryProvenance(clip, {...clip, params: {...clip.params, graphic: nextGraphic}} as I);
    out.push(rebuilt);
    cleared.push(rebuilt);
  }
  return {insetReveals: out, cleared};
}

// ---- WP4W: no opening and no hook title ---------------------------------------------------------------------------------------------------------------------------
/** The warning recorded when an mvp edit ends with neither an art-directed opening nor a hook title, so the first seconds show no title. */
export const NO_OPENING_HOOK_WARNING = 'legibility:no_opening_hook';

/**
 * WP4X: is an opening on screen at the start? True for an opening treatment spec OR an opening delivered as behind-subject text (`resolveOpening` returns the entry instead of a spec), since
 * either puts words on screen. Pure.
 */
export function openingIsPresent(openingSpec: unknown, openingBehindSubject: unknown): boolean {
  return Boolean(openingSpec) || Boolean(openingBehindSubject);
}

/**
 * WP5C: the opening's behind-subject entry, but only if it is still among the texts that survived the shared validator (`finalized.behindSubjectTexts`), else undefined. Matches by reference;
 * if the validator rebuilt the entry, by the same start together with the same text, or with a non-empty text that is part of the original (a shortened entry still puts words on screen).
 * Nothing is invented. Pure.
 */
export function survivingOpeningBehindSubject<E extends {start: number; text: string}>(entry: E | null | undefined, finalTexts: readonly E[]): E | undefined {
  if (!entry) return undefined;
  const match = finalTexts.find(
    candidate => candidate === entry || (Object.is(candidate.start, entry.start) && (candidate.text === entry.text || (candidate.text.trim() !== '' && entry.text.includes(candidate.text)))),
  );
  return match ? entry : undefined;
}

/**
 * `legibility:no_opening_hook` when there is no opening treatment AND the hook title (trimmed) is empty, else null. It names a state, nothing more: it invents no title and changes neither the
 * opening decision nor the clearing rules of `applyLegibility`.
 */
export function absentOpeningHookWarning(openingPresent: boolean, hookTitle: string): string | null {
  return !openingPresent && (typeof hookTitle !== 'string' || hookTitle.trim() === '') ? NO_OPENING_HOOK_WARNING : null;
}

// ---- the blueprint field ------------------------------------------------------------------------------------------------------------------------------------------
/** Before the shared conflict validator: hook fit, caption rules, and removal of on-screen text the speaker did not say (the caller records each removal in the ledger). */
export function applyLegibility(input: {
  hookTitle: string;
  canvasWidth: number;
  canvasHeight: number;
  speakerTopFrac?: number;
  speakerSource?: 'vision' | 'fallback';
  caption: CaptionDirection;
  motionGraphics: readonly MotionGraphic[];
  semanticEmphasis: readonly SemanticEmphasis[];
  transcript: string;
}): {
  hookTitle: string;
  caption: CaptionDirection;
  motionGraphics: MotionGraphic[];
  semanticEmphasis: SemanticEmphasis[];
  droppedText: Array<MotionGraphic | SemanticEmphasis>;
  legibility: LegibilitySpec;
  warnings: string[];
} {
  const warnings: string[] = [];
  // WP4R: the hook title is held to the same rule as the other on-screen words BEFORE it is fitted. The placeholder "WATCH THIS" (case-insensitive) and a title with a word the speaker did not
  // say are cleared to '' with no fit; nothing is invented or pulled from the transcript. An empty title stays empty (no warning); a spoken, non-placeholder title is fitted as before.
  const trimmedHook = input.hookTitle.trim();
  const hookCleared = trimmedHook !== '' && (trimmedHook.toUpperCase() === PLACEHOLDER_TEXT || !isGroundedInTranscript(trimmedHook, input.transcript));
  const hook = hookCleared
    ? {title: '', fit: null, warnings: ['legibility:ungrounded_hook_cleared']}
    : fitHookTitle({title: input.hookTitle, canvasWidth: input.canvasWidth, canvasHeight: input.canvasHeight, speakerTopFrac: input.speakerTopFrac, speakerSource: input.speakerSource});
  warnings.push(...hook.warnings);
  const caption = legibleCaption(input.caption);
  warnings.push(...caption.changes.map(change => `legibility:${change}`));

  const graphics = dropUngroundedText(input.motionGraphics, input.transcript);
  const emphasis = dropUngroundedText(input.semanticEmphasis, input.transcript);
  const droppedText = [...graphics.dropped, ...emphasis.dropped];
  if (droppedText.length > 0) warnings.push(`legibility:ungrounded_text_dropped:${droppedText.length}`);

  return {
    hookTitle: hook.title,
    caption: caption.caption,
    motionGraphics: graphics.kept,
    semanticEmphasis: emphasis.kept,
    droppedText,
    legibility: {version: 1, ...(hook.fit ? {hook: hook.fit} : {}), captions: captionSplitSpec(caption.caption)},
    warnings,
  };
}
