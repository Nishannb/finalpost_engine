/**
 * SUBJECT STAGE visual foundation (Phase 5.24): the editorial design layer that turns a planned span into a DESIGNED treatment. Pure: no model, no network, no I/O, no env.
 *
 *   look        one palette per video, derived from the footage's plate colour / brightness (a ground, an ink, a paper, ONE accent from a curated editorial set), contrast-checked
 *   S1  "Set"   a chapter environment + a 1-3 word chapter headline that is a STRONG spoken term (or an explicit editorial decision); wide framing replaces the room (behind the person),
 *               tight framing keeps the room (graded) with a front chapter tab; no meaningful headline or no safe space = restrained (the original footage)
 *   S2  "Source card"  an editorial quote card: a meaningful spoken clause (a quoted passage, reported speech, or a short complete clause), placed against the MEASURED subject geometry,
 *               behind the shoulder only when the matte and the 0.55 alpha-area rule allow it, else in front below the face; word highlight only with reliable word timing, else static
 *   cutaways    Subject Stage owns full-screen B-roll: a candidate is adopted only into a neutral span, with explicit start / end / enter / exit
 *
 * Coordinates: composition fractions (0..1 of the output frame), the SAME system the Kinetic V2 scene uses (speaker box mapped through the cover crop by `sourceBoxToComposition`,
 * face keep-out = the top 42 % of the box, the Shorts safe rect). Nothing here moves the person. Safety constants are imported, never redefined: FORCE_FRONT_ALPHA_AREA (0.55, unchanged),
 * HERO_OCC_MAX_TARGET (0.22, the most a headline may overlap the subject box).
 */
import {SHORTS_SAFE} from '../broll/heroSweep.ts';
import {FORCE_FRONT_ALPHA_AREA, HERO_OCC_MAX_TARGET} from '../kinetic/guardrails.ts';
import {contentTokens, deriveKeywords, startsWithTopicMarker} from './stageIntent.ts';
import type {StageId} from './stageMotion.ts';
import type {AlphaGrid} from '../kinetic/scene.ts';
import {freeRects, spanOcclusion, spanProtection, touchesProtected, type SpanProtection} from './stageProtection.ts';

export type Rect = {x: number; y: number; w: number; h: number};
export type StagePlate = {luminance: number; color: string};
export type StageGeometry = {
  /** composition px (the output frame) */
  width: number;
  height: number;
  /** measured subject box in composition fractions (null = no measured box: no subject-aware placement is possible) */
  subjectBox: Rect | null;
  /** the face / head keep-out (top 42 % of the box) */
  faceKeepOut: Rect | null;
  /** fraction of the frame covered by the person matte (null = not measured: treated as NOT eligible for behind placement) */
  alphaAreaFrac: number | null;
};
export type TimedWord = {text: string; start: number; end: number};
/** An explicit editorial decision for a span (a hand-authored CONTROLLED test plan today, a Director later). Text must be an exact spoken fragment of the span, else it is rejected. */
export type EditorialHint = {start: number; end: number; headline?: string; quote?: string; attribution?: string};

// ------------------------------------------------------------------------------------------------ the look (visual system tokens)
export type StageLook = {
  tone: 'light' | 'dark';
  /** set ground (centre) and its edge (vignette) */
  ground: string;
  groundEdge: string;
  /** headline ink on the ground */
  ink: string;
  /** secondary ink (kicker, rules) */
  inkSoft: string;
  /** ONE accent per video */
  accent: string;
  /** card surface + its ink */
  paper: string;
  paperInk: string;
  /** typography roles (font keys of the renderer's kinetic font set): display = S1 chapter headline, serif = S2 quotation, text = labels / attribution */
  fonts: {display: 'anton' | 'archivoBlack'; serif: 'playfair'; text: 'inter'};
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r4 = (n: number) => Math.round(n * 10000) / 10000;
function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h * 60, s, l];
}
export function hsl(h: number, s: number, l: number): string {
  const S = clamp(s, 0, 1), L = clamp(l, 0, 1);
  const c = (1 - Math.abs(2 * L - 1)) * S, hp = (((h % 360) + 360) % 360) / 60, x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = L - c / 2;
  const hex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${hex(r1)}${hex(g1)}${hex(b1)}`.toUpperCase();
}
export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex) ?? [0, 0, 0];
  const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a), lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** Curated editorial accents (no brand colours): the one farthest in hue from the plate that keeps >= 3:1 on the ground wins. */
export const EDITORIAL_ACCENTS = ['#D2462F', '#2F5BD2', '#E2A21B', '#1B8A86', '#8A3A7C'] as const;
export const LOOK_CONTRAST = {inkOnGround: 4.5, accentOnGround: 3, paperInk: 7} as const;

export function deriveLook(plate: StagePlate | null | undefined): StageLook {
  const rgb = (plate && hexToRgb(plate.color)) || [138, 133, 128];
  const [h, s] = rgbToHsl(rgb);
  const tone: StageLook['tone'] = (plate?.luminance ?? 0.3) >= 0.3 ? 'light' : 'dark';
  const sat = clamp(s * 0.7, 0.06, 0.26);
  let ground = tone === 'light' ? hsl(h, sat, 0.9) : hsl(h, sat, 0.13);
  const groundEdge = tone === 'light' ? hsl(h, sat + 0.04, 0.8) : hsl(h, sat, 0.07);
  let inkL = tone === 'light' ? 0.11 : 0.94;
  let ink = hsl(h, 0.2, inkL);
  for (let i = 0; i < 10 && contrastRatio(ink, ground) < LOOK_CONTRAST.inkOnGround; i += 1) {
    inkL = tone === 'light' ? inkL - 0.02 : inkL + 0.01;
    ink = hsl(h, 0.2, inkL);
  }
  if (contrastRatio(ink, ground) < LOOK_CONTRAST.inkOnGround) ground = tone === 'light' ? '#F2F0EC' : '#141414';
  const inkSoft = hsl(h, 0.12, tone === 'light' ? 0.35 : 0.72);
  const hueDist = (hex: string) => { const [ah] = rgbToHsl(hexToRgb(hex)!); const d = Math.abs(ah - h) % 360; return Math.min(d, 360 - d); };
  const accents = [...EDITORIAL_ACCENTS].filter(a => contrastRatio(a, ground) >= LOOK_CONTRAST.accentOnGround).sort((a, b) => hueDist(b) - hueDist(a));
  const accent = accents[0] ?? (tone === 'light' ? '#2F5BD2' : '#E2A21B');
  const paper = hsl(h, 0.16, 0.955);
  const paperInk = hsl(h, 0.22, 0.09);
  return {tone, ground, groundEdge, ink, inkSoft, accent, paper, paperInk, fonts: {display: 'anton', serif: 'playfair', text: 'inter'}};
}

// ------------------------------------------------------------------------------------------------ text selection (spoken words only)
const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}%$]+/gu, '');
const wordsOf = (t: string) => t.split(/\s+/).filter(Boolean);
/** a candidate is an exact (case-insensitive, punctuation-insensitive) run of the spoken words */
export function isSpokenFragment(fragment: string, spoken: string): boolean {
  const f = wordsOf(fragment).map(norm).filter(Boolean);
  const s = wordsOf(spoken).map(norm).filter(Boolean);
  if (f.length === 0) return false;
  for (let i = 0; i + f.length <= s.length; i += 1) if (f.every((w, k) => s[i + k] === w)) return true;
  return false;
}

/**
 * S1 chapter headline. Only a STRONG spoken term qualifies: a number with its unit, an acronym, a quoted term, or the term after "called / known as / means" (deriveKeywords score 3),
 * at most 3 words. Capitalised words, the longest word and lead words are WEAK and never become a chapter title. Null = no meaningful headline (the span stays restrained).
 */
export function chapterHeadline(sentences: ReadonlyArray<{start: number; end: number; text: string}>): string | null {
  for (const s of sentences) {
    for (const k of deriveKeywords(s)) {
      if (k.score < 3) continue;
      const n = wordsOf(k.text).length;
      if (n < 1 || n > 3 || k.text.length < 2 || k.text.length > 24) continue;
      if (/^\d{1}$/.test(k.text.trim())) continue; // a lone digit is not a chapter
      return k.text.trim();
    }
  }
  return null;
}

/** reported speech needs an explicit introducer ("said that ...", "wrote: ...", "told us, ..."): "I posted every day" is not a citation */
const REPORTED = /\b(?:said|says|wrote|writes|stated|states|announced|reported|told (?:me|us|them))(?:\s+that|\s*[,:])\s+(.+)$/i;
const QUOTED = /["“]([^"”]{8,})["”]/;
const clauseWords = (t: string) => wordsOf(t).length;
/**
 * S2 quotation: a meaningful spoken clause, never a whole paragraph. In order: a quoted passage; reported speech (the clause after "said that ..."); the densest complete sentence of the
 * unit (4-14 words, >= 2 content words). Null = nothing quotable (the span stays restrained).
 */
export function chooseQuote(sentences: ReadonlyArray<{text: string}>): string | null {
  for (const s of sentences) {
    const q = QUOTED.exec(s.text);
    if (q && clauseWords(q[1]!) >= 3 && clauseWords(q[1]!) <= 18) return q[1]!.trim();
  }
  for (const s of sentences) {
    const m = REPORTED.exec(s.text);
    if (m) {
      const clause = m[1]!.split(/(?<=[.!?])\s/)[0]!.trim();
      if (clauseWords(clause) >= 4 && clauseWords(clause) <= 16) return clause;
    }
  }
  // a complete spoken sentence of 4-14 words: the DENSEST in content (content words / words), then the one with more content; filler ("But here's the thing.") loses
  // a sentence opening with a discourse marker ("But here's the thing.", "So ...") is a transition, not a statement worth quoting
  const complete = sentences.map(s => s.text.trim()).filter(t => /[.!?]["”]?$/.test(t) && clauseWords(t) >= 4 && clauseWords(t) <= 14 && !startsWithTopicMarker(t));
  const density = (t: string) => contentTokens(t).length / clauseWords(t);
  const best = [...complete].sort((a, b) => density(b) - density(a) || contentTokens(b).length - contentTokens(a).length)[0];
  return best && contentTokens(best).length >= 2 ? best : null;
}

/** The timed spoken words of `fragment` inside [start, end] (consecutive, in order), or null when the timing is not reliable (any word missing): the quote is then static. */
export function timedFragment(fragment: string, words: readonly TimedWord[], start: number, end: number): TimedWord[] | null {
  const f = wordsOf(fragment).map(norm).filter(Boolean);
  const pool = words.filter(w => w.start >= start - 0.25 && w.end <= end + 0.25 && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end >= w.start);
  for (let i = 0; i + f.length <= pool.length; i += 1) {
    if (f.every((t, k) => norm(pool[i + k]!.text) === t)) return pool.slice(i, i + f.length).map((w, k) => ({text: wordsOf(fragment)[k]!, start: r4(w.start), end: r4(w.end)}));
  }
  return null;
}

// ------------------------------------------------------------------------------------------------ geometry
export const safeRectFrac = (): Rect => ({x: SHORTS_SAFE.leftFrac, y: SHORTS_SAFE.topFrac, w: 1 - SHORTS_SAFE.leftFrac - SHORTS_SAFE.rightFrac, h: 1 - SHORTS_SAFE.topFrac - SHORTS_SAFE.bottomFrac});
export const intersectArea = (a: Rect, b: Rect): number => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
/** containment with a tolerance for the 4-decimal rounding of every emitted rect (1e-4 of the frame < 0.2 px) */
const inside = (a: Rect, b: Rect, eps = 2e-4) => a.x >= b.x - eps && a.y >= b.y - eps && a.x + a.w <= b.x + b.w + eps && a.y + a.h <= b.y + b.h + eps;
/** behind placement: a measured matte at or under the UNCHANGED 0.55 alpha-area rule, and a measured box */
export const behindEligible = (g: StageGeometry): boolean => g.subjectBox !== null && g.alphaAreaFrac !== null && g.alphaAreaFrac <= FORCE_FRONT_ALPHA_AREA;

/** Type metrics (em fractions) the layout uses to size text conservatively; the renderer fits with the same numbers. */
export const TYPE_METRICS = {display: {charW: 0.5, lineH: 0.98}, serif: {charW: 0.5, lineH: 1.24}, text: {charW: 0.58, lineH: 1.2}} as const;
/** Readability floors / ceilings as fractions of the frame HEIGHT. */
export const TYPE_SCALE = {setHeadlineMax: 0.15, setHeadlineMin: 0.055, tabHeadlineMax: 0.06, tabHeadlineMin: 0.036, quoteMax: 0.036, quoteMin: 0.024, kicker: 0.016, attribution: 0.017} as const;
const GAP = 0.018;

/** every way to set the words on one or two lines (each option = its lines as word lists) */
function splitBalanced(words: string[]): string[][][] {
  if (words.length <= 1) return [[words]];
  const options: string[][][] = [[words]];
  for (let k = 1; k < words.length; k += 1) options.push([words.slice(0, k), words.slice(k)]);
  return options;
}
/** Largest display size (fraction of H) at which `text` fits `region`, with its line split. */
function fitDisplay(text: string, region: Rect, geo: StageGeometry, maxH: number, minH: number): {lines: string[]; size: number; w: number; h: number} | null {
  const aspect = geo.width / geo.height;
  let best: {lines: string[]; size: number; w: number; h: number} | null = null;
  for (const split of splitBalanced(wordsOf(text.toUpperCase()))) {
    const lines = split.map(l => l.join(' '));
    const longest = Math.max(...lines.map(l => l.length));
    // width in frame-width fractions: chars * charW * size(H) / aspect
    const byWidth = (region.w * aspect) / (longest * TYPE_METRICS.display.charW);
    const byHeight = region.h / (lines.length * TYPE_METRICS.display.lineH);
    const size = Math.min(maxH, byWidth, byHeight);
    if (size < minH) continue;
    if (!best || size > best.size) best = {lines, size, w: (longest * TYPE_METRICS.display.charW * size) / aspect, h: lines.length * TYPE_METRICS.display.lineH * size};
  }
  return best;
}
function wrap(text: string, charsPerLine: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const w of wordsOf(text)) {
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= charsPerLine) cur += ` ${w}`;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

// ------------------------------------------------------------------------------------------------ treatments
/**
 * Phase 5.25: what a designed element needs, for the dependency audit and the degraded render. `matteAtRender`: the element only renders correctly with the person cutout drawn over it
 * (room replacement, a behind headline, a card tucked behind the head, the room grade). Placement inputs (box, face, matte grid) are needed at DESIGN time only.
 */
export type ElementRequires = {speakerBox: boolean; faceRegion: boolean; matteGrid: boolean; matteAtRender: boolean; matteCoverage: boolean; plate: boolean; occlusion: boolean};
export type SetDesign = {
  kind: 'set';
  /** set = the room is replaced by the look's ground (wide framing + a reliable matte, behind the person); graded = the room stays, lightly graded, with a front chapter tab in free space */
  mode: 'set' | 'graded';
  room: 'replaced' | 'graded';
  headline: {text: string; lines: string[]; sizeFrac: number; rect: Rect; layer: 'behind' | 'front'; align: 'left' | 'center' | 'right'};
  /** chrome only: the chapter index ("01") */
  kicker: string;
  /** the treatment needs the person matte at render time (room replacement / grade / behind headline) */
  dependsOnMatte: boolean;
  headlineSource: 'editorial' | 'strong_keyword';
  placementBasis: SpanProtection['basis'];
  requires: ElementRequires;
};
export type SourceCardDesign = {
  kind: 'source_card';
  layer: 'behind' | 'front';
  card: Rect;
  /** where the words sit inside the card: never on a protected cell (the person over the span) */
  textRect: Rect;
  quote: string;
  lines: string[];
  sizeFrac: number;
  attribution?: string;
  /** per-word timing for the spoken highlight; absent = static quote (no reliable timing) */
  words?: TimedWord[];
  side: 'left' | 'right' | 'above' | 'below';
  tiltDeg: number;
  dependsOnMatte: boolean;
  quoteSource: 'editorial' | 'quoted' | 'reported' | 'clause' | 'director' | 'contract_fixture' | 'deterministic';
  placementBasis: SpanProtection['basis'];
  requires: ElementRequires;
};
export type RestrainedDesign = {kind: 'restrained'; reason: string};
export type SpanDesign = SetDesign | SourceCardDesign | RestrainedDesign;

const KICKER_BAND = TYPE_SCALE.kicker * 2.6;
const nearSubject = (r: Rect, box: Rect) => Math.hypot(r.x + r.w / 2 - (box.x + box.w / 2), r.y + r.h / 2 - box.y);

/**
 * S1 Set. Placement searches the span's FREE space (no protected cell: the person over the span, the face keep-out), never "below the face" by assumption.
 *   set     wide framing (area <= 0.55, unchanged) AND a reliable matte for the whole span: the room is replaced, the headline is set on the ground in the largest free region at or above
 *           the readability floor (it never overlaps the person, so it is always readable)
 *   graded  otherwise: the room stays (lightly graded under the person), a compact front tab in free space (often beside the head); none = restrained
 */
export function designSet(input: {headline: string | null; headlineSource: SetDesign['headlineSource']; index: number; geo: StageGeometry; protection?: SpanProtection}): SetDesign | RestrainedDesign {
  const {geo} = input;
  if (!input.headline) return {kind: 'restrained', reason: 'no_meaningful_headline'};
  if (!geo.subjectBox || !geo.faceKeepOut) return {kind: 'restrained', reason: 'no_subject_geometry'};
  const prot = input.protection ?? spanProtection({grid: null, fps: 30, start: 0, end: 1, subjectBox: geo.subjectBox, faceKeepOut: geo.faceKeepOut});
  const safe = safeRectFrac();
  const kicker = String(Math.max(1, input.index)).padStart(2, '0');
  const box = geo.subjectBox;
  const setMode = behindEligible(geo) && prot.reliable;
  const maxH = setMode ? TYPE_SCALE.setHeadlineMax : TYPE_SCALE.tabHeadlineMax;
  const minH = setMode ? TYPE_SCALE.setHeadlineMin : TYPE_SCALE.tabHeadlineMin;
  type Best = {fit: NonNullable<ReturnType<typeof fitDisplay>>; r: Rect; rect: Rect; align: SetDesign['headline']['align']};
  let best: Best | null = null;
  for (const free of freeRects(prot, safe)) {
    // a tab needs its padding inside the free region too; the kicker sits above the headline
    const pad = setMode ? 0 : 0.012;
    const r = {x: free.x + pad, y: free.y + KICKER_BAND + pad, w: free.w - 2 * pad, h: free.h - KICKER_BAND - 2 * pad};
    if (r.w <= 0 || r.h <= 0) continue;
    const fit = fitDisplay(input.headline, r, geo, maxH, minH);
    if (!fit) continue;
    const rightOf = r.x >= box.x + box.w / 2;
    const above = r.y + r.h <= box.y + 1e-6;
    const align: SetDesign['headline']['align'] = above ? 'center' : rightOf ? 'left' : 'right';
    const x = align === 'center' ? clamp(box.x + box.w / 2 - fit.w / 2, r.x, r.x + r.w - fit.w) : align === 'left' ? r.x : r.x + r.w - fit.w;
    const y = above ? r.y + r.h - fit.h : r.y;
    const rect = {x: r4(x), y: r4(y), w: r4(fit.w), h: r4(fit.h)};
    if (!best || fit.size > best.fit.size + 1e-6 || (Math.abs(fit.size - best.fit.size) <= 1e-6 && nearSubject(rect, box) < nearSubject(best.rect, box))) best = {fit, r, rect, align};
  }
  if (!best) return {kind: 'restrained', reason: setMode ? 'no_free_space_for_headline' : prot.basis === 'speaker_box' ? 'no_free_space_for_tab:speaker_box_protection' : 'no_free_space_for_tab'};
  const occ = spanOcclusion(prot, best.rect);
  if (touchesProtected(prot, best.rect) || intersectArea(best.rect, geo.faceKeepOut) > 0 || (occ && occ.max > 0)) return {kind: 'restrained', reason: 'headline_collides_with_speaker'};
  const requires: ElementRequires = {speakerBox: true, faceRegion: true, matteGrid: prot.basis === 'matte_grid', matteAtRender: setMode, matteCoverage: setMode, plate: setMode, occlusion: setMode};
  return {
    kind: 'set', mode: setMode ? 'set' : 'graded', room: setMode ? 'replaced' : 'graded',
    headline: {text: input.headline, lines: best.fit.lines, sizeFrac: r4(best.fit.size), rect: best.rect, layer: setMode ? 'behind' : 'front', align: best.align},
    kicker, dependsOnMatte: setMode, headlineSource: input.headlineSource, placementBasis: prot.basis, requires,
  };
}

/** The largest quote size (fraction of H) that fits a card of width `cardW` within height `maxH`, or null. */
function fitQuote(quote: string, cardW: number, maxH: number, attrH: number, aspect: number): {size: number; lines: string[]; cardH: number; padX: number; glyph: number; textH: number} | null {
  for (let size = TYPE_SCALE.quoteMax; size >= TYPE_SCALE.quoteMin - 1e-9; size -= 0.002) {
    const padX = cardW * 0.1;
    const innerW = cardW - 2 * padX;
    const charsPerLine = Math.floor((innerW * aspect) / (TYPE_METRICS.serif.charW * size));
    if (charsPerLine < 12) continue;
    const lines = wrap(quote, charsPerLine);
    if (lines.length > 5) continue;
    const glyph = size * 1.15;
    const textH = lines.length * TYPE_METRICS.serif.lineH * size;
    const cardH = size * 1.3 + glyph + textH + attrH + size * 1.1;
    if (cardH <= maxH + 1e-9) return {size, lines, cardH, padX, glyph, textH};
  }
  return null;
}

/**
 * S2 Source card. The card goes into the span's FREE space (never on the person, her hands or her gestures over the span). With a reliable matte and wide framing it may tuck behind the
 * person's head / shoulder (its words still entirely in free space: always readable); otherwise it is an independent front card in free space; no free space = restrained.
 */
export function designSourceCard(input: {quote: string | null; quoteSource: SourceCardDesign['quoteSource']; attribution?: string; words: TimedWord[] | null; geo: StageGeometry; protection?: SpanProtection}): SourceCardDesign | RestrainedDesign {
  const {geo} = input;
  if (!input.quote) return {kind: 'restrained', reason: 'no_meaningful_quote'};
  if (!geo.subjectBox || !geo.faceKeepOut) return {kind: 'restrained', reason: 'no_subject_geometry'};
  const prot = input.protection ?? spanProtection({grid: null, fps: 30, start: 0, end: 1, subjectBox: geo.subjectBox, faceKeepOut: geo.faceKeepOut});
  const safe = safeRectFrac();
  const box = geo.subjectBox, face = geo.faceKeepOut;
  const aspect = geo.width / geo.height;
  const tuckAllowed = behindEligible(geo) && prot.reliable;
  const attrH = input.attribution ? TYPE_SCALE.attribution * 1.8 : 0;
  type Cand = {card: Rect; textRect: Rect; layer: 'behind' | 'front'; size: number; lines: string[]};
  let best: Cand | null = null;
  for (const free of freeRects(prot, safe)) {
    if (free.w < 0.42 - 1e-9) continue;
    const cardW = Math.min(free.w, 0.86);
    const fit = fitQuote(input.quote, cardW, free.h, attrH, aspect);
    if (!fit) continue;
    const x = clamp(box.x + box.w / 2 - cardW / 2, free.x, free.x + free.w - cardW);
    // sit the card at the edge of the free region nearest the person; tuck its bottom behind her head when allowed and she is right below it
    const above = free.y + free.h <= face.y + 0.02;
    let y = above ? free.y + free.h - fit.cardH : free.y;
    let layer: 'behind' | 'front' = 'front';
    let cardH = fit.cardH;
    if (tuckAllowed && above) {
      const tuck = Math.min(0.06 * fit.cardH, safe.y + safe.h - (y + cardH));
      const tucked = {x, y: y + tuck, w: cardW, h: cardH};
      if (tuck > 0 && touchesProtected(prot, tucked)) { y += tuck; layer = 'behind'; }
    }
    const card = {x: r4(x), y: r4(y), w: r4(cardW), h: r4(cardH)};
    const textRect = {x: r4(card.x + fit.padX), y: r4(card.y + fit.size * 1.3 + fit.glyph), w: r4(cardW - 2 * fit.padX), h: r4(fit.textH + attrH)};
    // safety: the words never on a protected cell; a front card never on one at all; never on the face; inside the safe rect
    if (touchesProtected(prot, textRect)) continue;
    if (layer === 'front' && touchesProtected(prot, card)) continue;
    if (intersectArea(card, face) > 0 && layer === 'front') continue;
    if (!inside(card, safe)) continue;
    const cand = {card, textRect, layer, size: fit.size, lines: fit.lines};
    if (!best || cand.size > best.size + 1e-6 || (Math.abs(cand.size - best.size) <= 1e-6 && cand.layer === 'behind' && best.layer === 'front')) best = cand;
  }
  if (!best) return {kind: 'restrained', reason: prot.basis === 'speaker_box' ? 'no_free_space_for_card:speaker_box_protection' : 'no_free_space_for_card'};
  const c = best.card;
  const side: SourceCardDesign['side'] = c.y + c.h <= face.y + 0.07 ? 'above' : c.y >= face.y + face.h ? 'below' : c.x + c.w / 2 < box.x + box.w / 2 ? 'left' : 'right';
  const behind = best.layer === 'behind';
  return {
    kind: 'source_card', layer: best.layer, card: c, textRect: best.textRect, quote: input.quote, lines: best.lines, sizeFrac: r4(best.size), ...(input.attribution ? {attribution: input.attribution} : {}),
    ...(input.words ? {words: input.words} : {}), side, tiltDeg: side === 'left' ? 1 : side === 'right' ? -1 : 0, dependsOnMatte: behind, quoteSource: input.quoteSource,
    placementBasis: prot.basis, requires: {speakerBox: true, faceRegion: true, matteGrid: prot.basis === 'matte_grid', matteAtRender: behind, matteCoverage: behind, plate: false, occlusion: behind},
  };
}

// ------------------------------------------------------------------------------------------------ the whole stage
/** `ref` (Phase 5.27D.1): the accepted item the span shows, from compileDirection; when present the text is resolved by that identity (a deferred title starts after its chapter does) */
export type DesignSpanInput = {start: number; end: number; stage: StageId; ref?: {kind: 'title' | 'quote'; id: string; index: number}};
export type StageDesignResult = {look: StageLook; designs: Array<SpanDesign | null>; warnings: string[]};
/** validated editorial text (stageDirection.ts): chapter titles and quotes with their times; `source` records where they came from */
export type EditorialText = {titles: Array<{start: number; end: number; text: string; ref?: {id: string; index: number}}>; quotes: Array<{start: number; end: number; text: string; attribution?: string; ref?: {id: string; index: number}; /** Phase 5.29D-PRE: a per-quote source (built-in fallback quotes inside a Director run) */ source?: SourceCardDesign['quoteSource']}>; source: SourceCardDesign['quoteSource']};

/**
 * Design every S1 / S2 span (other stages keep their Phase 3 rendering: `null`). Phase 5.25: the design NEVER derives editorial meaning itself. Text comes only from an explicit editorial
 * hint (validated as spoken) or from validated editorial text (stageDirection.ts: a Director, a labelled contract fixture, or the deterministic quote proposer); no text = restrained.
 * Placement uses each span's protection (the person over the span from the matte grid, or the conservative box basis).
 */
export function designSubjectStage(input: {
  spans: readonly DesignSpanInput[];
  sentences: ReadonlyArray<{start: number; end: number; text: string}>;
  words?: readonly TimedWord[];
  geo: StageGeometry;
  plate?: StagePlate | null;
  editorial?: readonly EditorialHint[];
  text?: EditorialText;
  /** the person matte grid in composition space (compositionMatte); absent = box-based protection */
  grid?: AlphaGrid | null;
  fps?: number;
}): StageDesignResult {
  const look = deriveLook(input.plate);
  const warnings: string[] = [];
  const fps = input.fps ?? 30;
  let chapter = 0;
  const designs = input.spans.map((span, i): SpanDesign | null => {
    if (span.stage !== 'S1' && span.stage !== 'S2') return null;
    const inSpan = input.sentences.filter(s => s.start < span.end && s.end > span.start);
    const spokenText = inSpan.map(s => s.text).join(' ');
    const hint = (input.editorial ?? []).find(h => Math.abs(h.start - span.start) < 0.05 && Math.abs(h.end - span.end) < 0.05);
    const valid = (t: string | undefined, what: string): string | undefined => {
      if (!t) return undefined;
      if (isSpokenFragment(t, spokenText)) return t.trim();
      warnings.push(`subject_stage:design:editorial_rejected:${what}:${i}:not_spoken`);
      return undefined;
    };
    const protection = spanProtection({grid: input.grid ?? null, fps, start: span.start, end: span.end, subjectBox: input.geo.subjectBox, faceKeepOut: input.geo.faceKeepOut});
    if (input.grid && !protection.reliable) warnings.push(`subject_stage:design:matte_unreliable:${i}:${protection.reason}:${protection.samples}/${protection.expected}`);
    let design: SpanDesign;
    if (span.stage === 'S1') {
      // Phase 5.27D.1: a compiled span names its chapter, so its title is found by identity (a deferred title is shown after its chapter's opening quote, not at the chapter start);
      // spans without a ref (planner spans, older callers) keep the time lookup unchanged
      const titleRef = span.ref?.kind === 'title' ? span.ref : null;
      const title = valid(hint?.headline, 'headline') ?? (titleRef ? input.text?.titles.find(t => t.ref?.index === titleRef.index && t.ref.id === titleRef.id) : input.text?.titles.find(t => t.start >= span.start - 0.05 && t.start < span.end))?.text;
      chapter += 1;
      design = designSet({headline: title ?? null, headlineSource: 'editorial', index: chapter, geo: input.geo, protection});
      if (design.kind === 'restrained') chapter -= 1;
    } else {
      const edited = valid(hint?.quote, 'quote');
      const quoteRef = span.ref?.kind === 'quote' ? span.ref : null;
      const fromText = edited ? undefined : quoteRef ? input.text?.quotes.find(q => q.ref?.index === quoteRef.index && q.ref.id === quoteRef.id) : input.text?.quotes.find(q => q.start >= span.start - 0.25 && q.end <= span.end + 0.25);
      const quote = edited ?? fromText?.text ?? null;
      const attribution = valid(hint?.attribution, 'attribution') ?? fromText?.attribution;
      const words = quote && input.words ? timedFragment(quote, input.words, span.start, span.end) : null;
      design = designSourceCard({quote, quoteSource: edited ? 'editorial' : fromText?.source ?? input.text?.source ?? 'editorial', ...(attribution ? {attribution} : {}), words, geo: input.geo, protection});
      if (design.kind === 'source_card' && !design.words) warnings.push(`subject_stage:design:s2_static_quote:${i}`);
    }
    warnings.push(design.kind === 'restrained' ? `subject_stage:design:${span.stage.toLowerCase()}_restrained:${i}:${design.reason}` : `subject_stage:design:${span.stage.toLowerCase()}:${i}:${design.kind === 'set' ? design.mode : design.layer}:${design.placementBasis}`);
    return design;
  });
  return {look, designs, warnings};
}

// ------------------------------------------------------------------------------------------------ cutaways (Subject Stage owns full-screen B-roll)
/** `keyword` = the B-roll's own search term / tags; `validated` = an explicit request already validated by the editorial contract (stageDirection.ts: asset tags spoken in its evidence) */
export type CutawayCandidate = {start: number; end: number; assetUrl: string; mediaKind: 'video' | 'image'; credit?: string; keyword?: string; validated?: boolean};
export type StageCutaway = {start: number; end: number; assetUrl: string; mediaKind: 'video' | 'image'; enter: 'hard_cut' | 'dip'; exit: 'hard_cut' | 'dip'; credit?: string};
export const CUTAWAY_RULES = {minSec: 1, maxSec: 3.5, edgeSec: 0.3, minGapSec: 6, evidenceSlackSec: 1.5} as const;
const stemTok = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '').replace(/(ies)$/, 'y').replace(/s$/, '');
/** Phase 5.25: the candidate's own keyword must be SPOKEN within its window (+-1.5 s): the tokens it shares with the speech, or [] (not relevant). */
export function cutawayRelevance(keyword: string | undefined, words: readonly TimedWord[], start: number, end: number): string[] {
  if (!keyword) return [];
  const spoken = new Set(contentTokens(words.filter(w => w.end >= start - CUTAWAY_RULES.evidenceSlackSec && w.start <= end + CUTAWAY_RULES.evidenceSlackSec).map(w => w.text).join(' ')).map(stemTok));
  return [...new Set(contentTokens(keyword).map(stemTok).filter(t => spoken.has(t)))];
}

/**
 * Adopt full-screen cutaways into the stage plan. A candidate is adopted only when it lies entirely inside a NEUTRAL span (S4, or a span whose design is restrained), clear of its edges,
 * 1-3.5 s long and >= 6 s from the previous cutaway. Everything not adopted is NOT drawn (the caller drops it): unrequested B-roll never covers the subject.
 */
export function adoptCutaways(spans: ReadonlyArray<DesignSpanInput & {design?: SpanDesign | null}>, candidates: readonly CutawayCandidate[], words?: readonly TimedWord[]): {cutaways: StageCutaway[]; rejected: Array<{start: number; reason: string}>} {
  const cutaways: StageCutaway[] = [];
  const rejected: Array<{start: number; reason: string}> = [];
  for (const c of [...candidates].sort((a, b) => a.start - b.start)) {
    const len = c.end - c.start;
    if (!c.assetUrl || !(len >= CUTAWAY_RULES.minSec && len <= CUTAWAY_RULES.maxSec)) { rejected.push({start: c.start, reason: 'duration_or_asset'}); continue; }
    // Phase 5.25: relevance. An explicit validated request passes; any other candidate needs its own keyword spoken around its window (no keyword = no evidence = not adopted)
    if (words && !c.validated && cutawayRelevance(c.keyword, words, c.start, c.end).length === 0) { rejected.push({start: c.start, reason: c.keyword ? 'not_relevant' : 'no_evidence'}); continue; }
    const host = spans.find(s => c.start >= s.start + CUTAWAY_RULES.edgeSec - 1e-9 && c.end <= s.end - CUTAWAY_RULES.edgeSec + 1e-9);
    const neutral = host && (host.stage === 'S4' || host.design?.kind === 'restrained');
    if (!neutral) { rejected.push({start: c.start, reason: 'not_inside_a_neutral_span'}); continue; }
    const last = cutaways[cutaways.length - 1];
    if (last && c.start - last.end < CUTAWAY_RULES.minGapSec) { rejected.push({start: c.start, reason: 'too_close'}); continue; }
    cutaways.push({start: r4(c.start), end: r4(c.end), assetUrl: c.assetUrl, mediaKind: c.mediaKind, enter: 'hard_cut', exit: 'hard_cut', ...(c.credit ? {credit: c.credit} : {})});
  }
  return {cutaways, rejected};
}
