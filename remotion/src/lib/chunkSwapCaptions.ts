/**
 * WP41: CHUNK-SWAP CAPTIONS (Skill B, Explainer; `explainer-grammar.yaml` `captions`). PURE math, no React, no imports: the renderer (`ChunkSwapCaptions`), the server (`polishExplainerCaptions`)
 * and the offline tests read the same numbers. NOT Skill A: no accumulate, no karaoke fill, no blur-fade.
 *
 *   mode: chunk_swap      the VO is cut into chunks of 1-3 words; ONE chunk is on screen; the next chunk REPLACES it on its first word (hard swap, nothing builds up, nothing is filled)
 *   words per chunk: 1-3  clause / sentence ends and pauses end a chunk; a run of n words is split evenly (4 -> 2+2, 5 -> 3+2) so a chunk is never a lone orphan word
 *   look: white fill + THICK black stroke + soft shadow, heavy geometric sans (Poppins ExtraBold), lowercase (acronyms, figures and `I` keep their case)
 *   y: by the active layout: B (split seam) 50 %, A / C / D 75 % of the frame height (`yTrack` carries one entry per layout span)
 */

export const CHUNK_SWAP_MODE = 'chunk_swap' as const;

export const CHUNK_SWAP = {
  minWords: 1,
  maxWords: 3,
  /** Font size as a percent of the COMPOSITION height (heavy + readable; 5.6 % keeps 2-3 short words on one line at 9:16). */
  sizePctFrameH: 5.6,
  fontWeight: 800,
  color: '#FFFFFF',
  strokeColor: '#000000',
  /** `-webkit-text-stroke` is centred on the outline and `paint-order: stroke fill` hides the inner half, so the VISIBLE black edge is half of this (0.22 em -> 0.11 em outside the glyph: thick). */
  strokeWidthEm: 0.22,
  shadowBlurPx: 14,
  shadowOpacity: 0.45,
  /** Default y (fraction of the frame height) when no yTrack entry covers the time: the A / C / D value. */
  yFracDefault: 0.75,
  /** A pause longer than this ends a chunk even without punctuation. */
  maxGapSec: 0.35,
  /** How long the last word of a chunk stays after it is spoken when no next chunk comes first. */
  holdAfterSec: 0.3,
  /** A 3-frame, non-overshooting scale-up on the swap (the swap itself is a hard replace: opacity is 1 from the first frame). */
  popFrames: 3,
  popScaleFrom: 0.92,
  maxWidthFrac: 0.9,
  /** Average advance of a heavy Latin glyph in em (deliberately wide) for the fit guard. */
  glyphEm: 0.66,
  minFitScale: 0.62,
} as const;

export type ChunkWord = {text: string; start: number; end: number};
export type CaptionChunk = {
  words: ChunkWord[];
  /** Onset of the first word: the chunk swaps IN here. */
  start: number;
  /** The chunk swaps OUT here (exclusive): the next chunk's start, a layout cut, or `holdAfterSec` after its last word. */
  clearAt: number;
};
export type YTrackEntry = {start: number; end: number; yFrac: number};

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const round3 = (value: number) => Math.round(value * 1000) / 1000;

const CLAUSE_END = /[.!?;:,]["')\]]*$/;

/** Font size in px: `pct` % (default 5.6) of the composition HEIGHT. */
export function chunkFontPx(frameHeight: number, pct: number = CHUNK_SWAP.sizePctFrameH): number {
  return Math.round(Math.max(0, frameHeight) * (Number.isFinite(pct) ? pct : CHUNK_SWAP.sizePctFrameH) / 100);
}

/** Most words a chunk shows: the direction's own cap, always inside the grammar's 1-3. */
export function chunkMaxWords(requested?: number): number {
  return clamp(Math.floor(Number.isFinite(requested) ? (requested as number) : CHUNK_SWAP.maxWords), CHUNK_SWAP.minWords, CHUNK_SWAP.maxWords);
}

/** Split `count` words into `ceil(count / max)` near-equal chunk sizes (never a lone orphan when count > 1): 4 -> [2, 2], 5 -> [3, 2], 7 -> [3, 2, 2]. */
export function balancedChunkSizes(count: number, max: number = CHUNK_SWAP.maxWords): number[] {
  if (count <= 0) return [];
  const parts = Math.ceil(count / max);
  const base = Math.floor(count / parts);
  const extra = count % parts;
  return Array.from({length: parts}, (_, index) => base + (index < extra ? 1 : 0));
}

/**
 * Cut the spoken words into swap chunks. A "run" ends at a clause / sentence end, a pause > `maxGapSec` or a cut time (a layout cut: a chunk never straddles one); each run is then split evenly
 * into 1-3 word chunks. A chunk is on screen from its first word to the next chunk's first word (a hard swap), else `holdAfterSec` after its last word, never past the first cut after it started.
 */
export function groupChunks(words: readonly ChunkWord[], options: {maxWords?: number; cutTimes?: readonly number[]} = {}): CaptionChunk[] {
  const max = chunkMaxWords(options.maxWords);
  const cuts = [...(options.cutTimes ?? [])].filter(Number.isFinite).sort((a, b) => a - b);
  const usable = words.filter(word => word.text.trim().length > 0 && Number.isFinite(word.start) && Number.isFinite(word.end));
  const runs: ChunkWord[][] = [];
  let run: ChunkWord[] = [];
  for (let index = 0; index < usable.length; index += 1) {
    const word = usable[index]!;
    const next = usable[index + 1];
    run.push(word);
    const clauseEnd = CLAUSE_END.test(word.text.trim());
    const pause = next ? next.start - word.end > CHUNK_SWAP.maxGapSec : true;
    const cutBetween = next ? cuts.some(cut => cut > word.start + 0.002 && cut <= next.start + 0.003) : false;
    if (!next || clauseEnd || pause || cutBetween) {
      runs.push(run);
      run = [];
    }
  }
  const chunks: CaptionChunk[] = [];
  for (const members of runs) {
    let at = 0;
    for (const size of balancedChunkSizes(members.length, max)) {
      const slice = members.slice(at, at + size);
      at += size;
      chunks.push({words: slice, start: slice[0]!.start, clearAt: slice[slice.length - 1]!.end + CHUNK_SWAP.holdAfterSec});
    }
  }
  chunks.forEach((chunk, index) => {
    const next = chunks[index + 1];
    let clearAt = chunk.clearAt;
    if (next && next.start <= clearAt + 1e-6) clearAt = next.start; // a hard swap: the next chunk replaces this one on its first word
    const firstCut = cuts.find(cut => cut > chunk.start + 0.002);
    if (firstCut !== undefined && firstCut < clearAt) clearAt = firstCut;
    chunk.clearAt = round3(clearAt);
  });
  return chunks;
}

/** The chunk on screen at `timeSec` (start <= t < clearAt), else null. At most one chunk is ever visible (a swap, not an accumulation). */
export function activeChunkAt(chunks: readonly CaptionChunk[], timeSec: number): CaptionChunk | null {
  return chunks.find(chunk => timeSec >= chunk.start - 1e-9 && timeSec < chunk.clearAt - 1e-9) ?? null;
}

/**
 * Display text: lowercase, sentence punctuation dropped; keeps the case of `I`, acronyms (AI, USA) and anything with a digit or a currency sign ($1.4, 2024).
 * `capsWords` (normalised, e.g. a CTA keyword) are upper-cased.
 */
export function chunkDisplayText(words: readonly {text: string}[], capsWords: readonly string[] = []): string {
  const caps = new Set(capsWords.map(word => word.toLowerCase()));
  return words
    .map(({text}) => {
      const bare = text.trim().replace(/^["'(\[]+|[.,!?;:"')\]]+$/g, '');
      const key = bare.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
      if (caps.has(key)) return bare.toUpperCase();
      if (/^i$/i.test(bare)) return 'I';
      if (/[\d$€£%]/.test(bare) || (bare.length >= 2 && bare === bare.toUpperCase() && /\p{L}/u.test(bare))) return bare;
      return bare.toLowerCase();
    })
    .filter(Boolean)
    .join(' ');
}

/** Largest font size (px) at which `text` still fits `containerPx` on ONE line, never below `minFitScale` of the base (past that the renderer wraps). */
export function chunkFitFontPx(basePx: number, text: string, containerPx: number): number {
  const chars = Math.max(1, text.length);
  const fit = containerPx / (chars * CHUNK_SWAP.glyphEm);
  return Math.round(Math.max(basePx * CHUNK_SWAP.minFitScale, Math.min(basePx, fit)));
}

/** The swap pop for a chunk: `frame` = frames since its first word. Opacity is always 1 (hard swap); only a short scale-up, never an overshoot. */
export function chunkPopState(frame: number, frames: number = CHUNK_SWAP.popFrames): {opacity: number; scale: number} {
  if (frame >= frames) return {opacity: 1, scale: 1};
  const t = clamp(frame / Math.max(1, frames), 0, 1);
  return {opacity: 1, scale: CHUNK_SWAP.popScaleFrom + (1 - CHUNK_SWAP.popScaleFrom) * t};
}

/** Caption centre y (fraction of the frame height) at `timeSec`: the yTrack entry that covers it, else the A / C / D default (75 %). */
export function chunkYFracAt(track: readonly YTrackEntry[] | undefined, timeSec: number): number {
  const hit = (track ?? []).find(entry => timeSec >= entry.start - 1e-9 && timeSec < entry.end - 1e-9);
  return clamp(hit ? hit.yFrac : CHUNK_SWAP.yFracDefault, 0.05, 0.95);
}
