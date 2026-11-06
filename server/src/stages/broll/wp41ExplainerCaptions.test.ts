/**
 * WP41: Explainer Skill B captions + lime highlight + claim -> visual (offline; no render, no network, no model).
 *   1. chunk-swap math: 1-3 word chunks REPLACE each other (not accumulate), balanced, never straddle a cut, thick black stroke look, y by layout
 *   2. mode wiring: schema / direction field / renderer branches; Skill A (accumulate) default and strings untouched
 *   3. polishExplainerCaptions: yTrack by layout (B 50 %, A / C / D 75 %), idempotent, replaces the accumulate-only fields
 *   4. claims: numbers / amounts / percents / names are found; every claim gets a visual within 0.5 s (a B / C / D segment or a beat) or is reported unmet
 *   5. lime highlight: #BFFF00, L -> R wipe, rest dims to 0.28
 *   6. analyze wiring (behind the explainer flag only) + the offline proof
 */
import {existsSync, readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {captionDirectionSchema} from '../../../../remotion/src/blueprintSchema.ts';
import {ACCUMULATE_MODE} from '../../../../remotion/src/lib/accumulateCaptions.ts';
import {
  CHUNK_SWAP,
  CHUNK_SWAP_MODE,
  activeChunkAt,
  balancedChunkSizes,
  chunkDisplayText,
  chunkFitFontPx,
  chunkFontPx,
  chunkMaxWords,
  chunkPopState,
  chunkYFracAt,
  groupChunks,
} from '../../../../remotion/src/lib/chunkSwapCaptions.ts';
import {EXPLAINER_CAPTION_Y_PCT, EXPLAINER_LIME} from '../../../../remotion/src/lib/explainerLayouts.ts';
import {
  LIME_HIGHLIGHT,
  LIME_HIGHLIGHT_COLOR,
  limeBarRect,
  limeDimOpacity,
  limeRectFractions,
  limeWipeDoneFrame,
  limeWipeProgress,
} from '../../../../remotion/src/lib/limeHighlight.ts';
import {env} from '../../config/env.ts';
import {
  CHUNK_SWAP_CAPTION_MODE,
  CHUNK_SWAP_MAX_WORDS,
  CHUNK_SWAP_SIZE_PCT_FRAME_H,
  CHUNK_SWAP_STROKE_EM,
  EXPLAINER_CAPTION_Y_FRAC,
  polishExplainerCaptions,
} from '../../lib/polishExplainerCaptions.ts';
import type {CaptionDirection} from '../../types/blueprint.ts';
import {
  CLAIM_BEAT_LEAD_SEC,
  CLAIM_BEAT_MIN_SEC,
  CLAIM_VISUAL_MAX_DELAY_SEC,
  VISUAL_LAYOUTS,
  detectClaims,
  layoutTrackOf,
  planClaimVisuals,
} from './explainerClaims.ts';
import {planExplainerPacing, type ExplainerWord} from './explainerPacing.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const fixture = JSON.parse(read('./fixtures/wp41-vo-words.json')) as {durationSec: number; words: ExplainerWord[]};
const pacing = planExplainerPacing({durationSec: fixture.durationSec, words: fixture.words});
const claimPlan = planClaimVisuals({segments: pacing.segments, words: fixture.words});
const w = (text: string, start: number, end = start + 0.3): ExplainerWord => ({text, start, end});
const baseCaption = (): CaptionDirection => ({position: 'center', bottomFrac: 0.2});

describe('WP41 1) chunk-swap math', () => {
  const trackCuts = claimPlan.layoutTrack.slice(1).map(span => span.start);
  const chunks = groupChunks(fixture.words, {cutTimes: trackCuts});

  it('every chunk is 1-3 words and the whole VO is covered in order, once', () => {
    expect(chunks.length).toBeGreaterThan(10);
    for (const chunk of chunks) {
      expect(chunk.words.length).toBeGreaterThanOrEqual(1);
      expect(chunk.words.length).toBeLessThanOrEqual(3);
    }
    expect(chunks.flatMap(chunk => chunk.words.map(word => word.text))).toEqual(fixture.words.map(word => word.text));
  });

  it('is a SWAP, not an accumulate: one chunk at a time, the next replaces the previous on its first word', () => {
    chunks.forEach((chunk, index) => {
      if (index > 0) expect(chunks[index - 1]!.clearAt).toBeLessThanOrEqual(chunk.start + 1e-6); // never two chunks on screen
      expect(chunk.clearAt).toBeGreaterThan(chunk.start);
    });
    // a swap: when the next chunk follows right after, the old one clears exactly on its first word (no leftover words build up)
    chunks.slice(0, -1).forEach((chunk, index) => {
      const next = chunks[index + 1]!;
      const cutBetween = trackCuts.some(cut => cut > chunk.start + 0.002 && cut <= next.start + 0.003); // or a layout cut clears it a touch earlier
      if (next.start - chunk.words.at(-1)!.end < CHUNK_SWAP.holdAfterSec && !cutBetween) expect(chunk.clearAt).toBeCloseTo(next.start, 3);
    });
    for (const chunk of chunks) {
      // at the swap only the chunk's OWN words are on screen: nothing from earlier chunks is carried
      expect(activeChunkAt(chunks, chunk.start + 0.01)).toBe(chunk);
    }
    expect(activeChunkAt(chunks, 0)).toBeNull();
    expect(activeChunkAt(chunks, fixture.durationSec + 1)).toBeNull();
  });

  it('splits a run evenly: 4 -> 2+2, 5 -> 3+2, 7 -> 3+2+2 (no lone orphan word)', () => {
    expect(balancedChunkSizes(1)).toEqual([1]);
    expect(balancedChunkSizes(3)).toEqual([3]);
    expect(balancedChunkSizes(4)).toEqual([2, 2]);
    expect(balancedChunkSizes(5)).toEqual([3, 2]);
    expect(balancedChunkSizes(7)).toEqual([3, 2, 2]);
    expect(balancedChunkSizes(0)).toEqual([]);
    const four = groupChunks([w('one', 0), w('two', 0.4), w('three', 0.8), w('four', 1.2)]);
    expect(four.map(chunk => chunk.words.length)).toEqual([2, 2]);
  });

  it('clause ends and pauses end a chunk; a layout cut is never straddled', () => {
    const clause = groupChunks([w('hello', 0), w('there,', 0.4), w('my', 0.8), w('friend', 1.2)]);
    expect(clause.map(chunk => chunk.words.map(word => word.text))).toEqual([['hello', 'there,'], ['my', 'friend']]);
    const paused = groupChunks([w('keep', 0), w('going', 0.4), w('now', 1.5), w('please', 1.9)]);
    expect(paused.map(chunk => chunk.words.length)).toEqual([2, 2]);
    const cut = groupChunks([w('a', 0), w('b', 0.4), w('c', 0.8)], {cutTimes: [0.7]});
    expect(cut.map(chunk => chunk.words.map(word => word.text))).toEqual([['a', 'b'], ['c']]);
    for (const c of trackCuts) for (const chunk of chunks) expect(c > chunk.start + 0.002 && c < chunk.clearAt - 0.002, `chunk ${chunk.words[0]!.text} straddles cut ${c}`).toBe(false);
  });

  it('the cap is the grammar 1-3 (a bigger request is clamped, a smaller one honoured)', () => {
    expect(chunkMaxWords(undefined)).toBe(3);
    expect(chunkMaxWords(9)).toBe(3);
    expect(chunkMaxWords(2)).toBe(2);
    expect(chunkMaxWords(0)).toBe(1);
    expect(groupChunks(fixture.words, {maxWords: 2}).every(chunk => chunk.words.length <= 2)).toBe(true);
  });

  it('display text: lowercase, punctuation off; keeps I, acronyms, figures and currency; caps words upper-cased', () => {
    expect(chunkDisplayText([{text: 'Most'}, {text: 'people'}, {text: 'think'}])).toBe('most people think');
    expect(chunkDisplayText([{text: 'AI'}, {text: 'agents'}])).toBe('AI agents');
    expect(chunkDisplayText([{text: 'magic.'}])).toBe('magic');
    expect(chunkDisplayText([{text: '$1.4'}, {text: 'trillion.'}])).toBe('$1.4 trillion');
    expect(chunkDisplayText([{text: '40%'}, {text: 'of'}])).toBe('40% of');
    expect(chunkDisplayText([{text: "I'm"}, {text: 'I'}])).toBe("i'm I");
    expect(chunkDisplayText([{text: 'Follow'}, {text: 'now'}], ['follow'])).toBe('FOLLOW now');
  });

  it('the look: white fill, a THICK black stroke, soft shadow, heavy sans; the swap pop is 3 frames and never overshoots', () => {
    expect(CHUNK_SWAP.color).toBe('#FFFFFF');
    expect(CHUNK_SWAP.strokeColor).toBe('#000000');
    expect(CHUNK_SWAP.strokeWidthEm).toBeGreaterThanOrEqual(0.18); // thick (the accumulate captions have no stroke at all)
    expect(CHUNK_SWAP.fontWeight).toBeGreaterThanOrEqual(800);
    expect(CHUNK_SWAP.shadowOpacity).toBeGreaterThan(0);
    expect(chunkFontPx(1920)).toBe(Math.round(1920 * 0.056));
    expect(chunkFontPx(1280)).toBe(72);
    for (let frame = -2; frame <= 8; frame += 1) {
      const pop = chunkPopState(frame);
      expect(pop.opacity).toBe(1); // a hard swap: visible from the first frame
      expect(pop.scale).toBeLessThanOrEqual(1);
      expect(pop.scale).toBeGreaterThanOrEqual(CHUNK_SWAP.popScaleFrom - 1e-9);
    }
    expect(chunkPopState(CHUNK_SWAP.popFrames)).toEqual({opacity: 1, scale: 1});
    expect(chunkFitFontPx(100, 'ab', 900)).toBe(100);
    expect(chunkFitFontPx(100, 'x'.repeat(40), 900)).toBe(62); // floor: past it the renderer wraps
  });

  it('y by layout: B (the seam) 50 %, A / C / D 75 %; the default is the A / C / D value', () => {
    expect(EXPLAINER_CAPTION_Y_PCT).toEqual({explainer_a: 75, explainer_b: 50, explainer_c: 75, explainer_d: 75});
    expect(CHUNK_SWAP.yFracDefault).toBe(0.75);
    const track = [
      {start: 0, end: 3, yFrac: 0.5},
      {start: 3, end: 6, yFrac: 0.75},
    ];
    expect(chunkYFracAt(track, 1)).toBe(0.5);
    expect(chunkYFracAt(track, 3)).toBe(0.75);
    expect(chunkYFracAt(track, 99)).toBe(0.75);
    expect(chunkYFracAt(undefined, 1)).toBe(0.75);
  });

  it('the renderer lib is dependency-free (the server, the renderer and the proof all import it)', () => {
    const code = stripComments(read('../../../../remotion/src/lib/chunkSwapCaptions.ts'));
    expect(code).not.toMatch(/^import /m);
    expect(code).not.toMatch(/Math\.random|Date\.now|process\.env/);
  });
});

describe('WP41 2) mode wiring (and Skill A untouched)', () => {
  it('the schema carries chunk_swap + yTrack; accumulate still parses; unknown modes and bad y still throw', () => {
    const parsed = captionDirectionSchema.parse({position: 'center', bottomFrac: 0.2, mode: CHUNK_SWAP_MODE, maxWords: 3, sizePctFrameH: 5.6, cutTimes: [3.5], yTrack: [{start: 0, end: 3.5, yFrac: 0.5}, {start: 3.5, end: 9, yFrac: 0.75}]});
    expect(parsed).toMatchObject({mode: 'chunk_swap', yTrack: [{yFrac: 0.5}, {yFrac: 0.75}]});
    expect(() => captionDirectionSchema.parse({position: 'center', bottomFrac: 0.2, mode: ACCUMULATE_MODE, cutTimes: [1], centerYFrac: 0.46})).not.toThrow();
    expect(() => captionDirectionSchema.parse({position: 'center', bottomFrac: 0.2, mode: 'replace'})).toThrow();
    expect(() => captionDirectionSchema.parse({position: 'center', bottomFrac: 0.2, centerYFrac: 0.75})).toThrow(); // the accumulate band is unchanged
    expect(() => captionDirectionSchema.parse({position: 'center', bottomFrac: 0.2, yTrack: [{start: 0, end: 1, yFrac: 2}]})).toThrow();
    expect(() => captionDirectionSchema.parse({position: 'bottom', bottomFrac: 0.2})).not.toThrow(); // absent mode = unchanged
  });

  it('the server and the renderer share one mode name; the server direction type carries it', () => {
    expect(CHUNK_SWAP_CAPTION_MODE).toBe(CHUNK_SWAP_MODE);
    expect(CHUNK_SWAP_MODE).toBe('chunk_swap');
    expect(CHUNK_SWAP_MAX_WORDS).toBe(CHUNK_SWAP.maxWords);
    expect(CHUNK_SWAP_SIZE_PCT_FRAME_H).toBe(CHUNK_SWAP.sizePctFrameH);
    expect(CHUNK_SWAP_STROKE_EM).toBe(CHUNK_SWAP.strokeWidthEm);
    const types = read('../../types/blueprint.ts');
    expect(types).toContain("mode?: 'word_by_word_accumulate' | 'chunk_swap';");
    expect(types).toContain('yTrack?: Array<{start: number; end: number; yFrac: number}>;');
  });

  it('renderer branches: chunk_swap first, the accumulate branch and the template fallback exactly as WP34 pinned them', () => {
    const kinetic = read('../../../../remotion/src/components/KineticCaptions.tsx');
    expect(kinetic).toContain('props.direction?.mode === CHUNK_SWAP_MODE');
    expect(kinetic).toContain('<ChunkSwapCaptions');
    expect(kinetic).toContain('props.direction?.mode === ACCUMULATE_MODE');
    expect(kinetic).toContain('<AccumulateCaptions');
    expect(kinetic).toContain('<TemplateKineticCaptions {...props} />');
    expect(kinetic.indexOf('CHUNK_SWAP_MODE')).toBeLessThan(kinetic.indexOf('props.direction?.mode === ACCUMULATE_MODE'));
    const dynamic = read('../../../../remotion/src/captions/DynamicCaptionRenderer.tsx');
    expect(dynamic).toContain('direction?.mode === ACCUMULATE_MODE');
    expect(dynamic).toContain('direction?.mode === CHUNK_SWAP_MODE');
    expect(dynamic.indexOf('direction?.mode === CHUNK_SWAP_MODE')).toBeLessThan(dynamic.indexOf('if (isPackageCaptionThemeId(selectedTemplate))'));
  });

  it('the component paints the thick black stroke OUTSIDE the glyph + soft shadow and swaps (no accumulate, no blur-fade, no karaoke)', () => {
    const code = stripComments(read('../../../../remotion/src/components/ChunkSwapCaptions.tsx'));
    expect(code).toContain('WebkitTextStroke');
    expect(code).toContain("paintOrder: 'stroke fill'");
    expect(code).toContain('textShadow');
    expect(code).toContain('CHUNK_SWAP.strokeColor');
    expect(code).toContain('chunkYFracAt(direction?.yTrack, chunk.start)');
    expect(code).not.toMatch(/blur\(|accumulate|karaoke|highlightColor/i);
    // one chunk drawn per frame
    expect(code).toContain('chunks.find(');
  });

  it('Skill A defaults are unchanged: accumulate stays the polish default, the explainer flag stays off', () => {
    expect(env.POLISH_ACCUMULATE_CAPTIONS).toBe(true);
    expect(env.POLISH_EXPLAINER_SKILL).toBe(false);
    expect(env.POLISH_FACELESS_DOC).toBe(false);
    expect(ACCUMULATE_MODE).toBe('word_by_word_accumulate');
    const accumulate = stripComments(read('../../lib/polishAccumulateCaptions.ts'));
    expect(accumulate).not.toMatch(/chunk_swap|yTrack/);
  });
});

describe('WP41 3) polishExplainerCaptions', () => {
  const track = claimPlan.layoutTrack;
  const {caption, warnings} = polishExplainerCaptions({...baseCaption(), centerYFrac: 0.46, capsWords: ['follow'], mode: 'word_by_word_accumulate', cutTimes: [1, 2]}, {layoutTrack: track});

  it('writes chunk_swap with the thick-stroke look and drops the accumulate-only fields', () => {
    expect(caption).toMatchObject({mode: 'chunk_swap', maxWords: 3, sizePctFrameH: 5.6, textColor: '#FFFFFF', strokeColor: '#000000', strokeWidthEm: 0.22, boxColor: null, glow: false, uppercase: false, fontScale: 1});
    expect(caption.centerYFrac).toBeUndefined();
    expect(caption.capsWords).toBeUndefined();
    expect(warnings).toEqual([`polish_explainer_captions:chunk_swap:${track.length}`]);
    expect(() => captionDirectionSchema.parse(caption)).not.toThrow();
  });

  it('yTrack follows the layout track: B 0.50 (the seam), A / C / D 0.75; cutTimes are the layout changes', () => {
    expect(caption.yTrack).toHaveLength(track.length);
    caption.yTrack!.forEach((entry, index) => {
      expect(entry.start).toBeCloseTo(track[index]!.start, 3);
      expect(entry.end).toBeCloseTo(track[index]!.end, 3);
      expect(entry.yFrac).toBe(track[index]!.layout === 'explainer_b' ? 0.5 : 0.75);
    });
    expect(new Set(caption.yTrack!.map(entry => entry.yFrac))).toEqual(new Set([0.5, 0.75]));
    expect(caption.cutTimes).toEqual(track.slice(1).map(span => Math.round(span.start * 1000) / 1000));
  });

  it('the server y table equals the renderer y table (one set of numbers)', () => {
    for (const [layout, pct] of Object.entries(EXPLAINER_CAPTION_Y_PCT)) expect(EXPLAINER_CAPTION_Y_FRAC[layout as keyof typeof EXPLAINER_CAPTION_Y_FRAC]).toBeCloseTo(pct / 100, 6);
    const yaml = read('../../../../remotion/out/phase36-readiness/explainer-grammar.yaml');
    expect(yaml).toMatch(/y_pct: \{B: 50, A: 75, C: 75, D: 75\}/);
    expect(yaml).toMatch(/words_per_chunk: \[1, 3\]/);
    expect(yaml).toMatch(/color: "#BFFF00"/);
    expect(yaml).toMatch(/dim_rest_to: 0\.28/);
  });

  it('is idempotent; an empty track returns the input untouched', () => {
    expect(polishExplainerCaptions(caption, {layoutTrack: track}).caption).toEqual(caption);
    const bare = baseCaption();
    const result = polishExplainerCaptions(bare, {layoutTrack: []});
    expect(result.caption).toBe(bare);
    expect(result.warnings).toEqual(['polish_explainer_captions:no_layout_skipped']);
  });

  it('is pure (no env, I/O, model, randomness)', () => {
    const code = stripComments(read('../../lib/polishExplainerCaptions.ts'));
    for (const needle of ['process.env', 'fetch(', 'readFileSync', 'logger', 'anthropic', 'Math.random', 'Date.now']) expect(code, needle).not.toContain(needle);
  });
});

describe('WP41 4) claims -> visual within 0.5 s', () => {
  it('detects amounts, percents, numbers and proper names (and not sentence-start filler)', () => {
    const claims = detectClaims(fixture.words);
    expect(claims.map(claim => [claim.kind, claim.text])).toEqual([
      ['name', 'AI'],
      ['name', 'Stripe'],
      ['money', '$1.4 trillion'],
      ['name', 'Stripe'],
      ['name', 'Notion'],
      ['name', 'Linear'],
      ['percent', '40%'],
    ]);
    const money = claims.find(claim => claim.kind === 'money')!;
    expect(money.end).toBeGreaterThan(money.start);
    expect(detectClaims([w('Most', 0), w('people', 0.4), w('think', 0.8)])).toEqual([]);
    expect(detectClaims([w('They', 0), w('are', 0.4), w('not.', 0.8)])).toEqual([]);
  });

  it('numbers: digits, spelled magnitudes, percent words; names: merged, comma-split, known names', () => {
    expect(detectClaims([w('in', 0), w('2024', 0.4), w('sales', 0.8)]).map(claim => [claim.kind, claim.text])).toEqual([['number', '2024']]);
    expect(detectClaims([w('it', 0), w('made', 0.4), w('a', 0.8), w('million', 1.2)]).map(claim => [claim.kind, claim.text])).toEqual([['number', 'a million']]);
    expect(detectClaims([w('up', 0), w('40', 0.4), w('percent', 0.8)]).map(claim => [claim.kind, claim.text])).toEqual([['percent', '40 percent']]);
    expect(detectClaims([w('said', 0), w('Elon', 0.4), w('Musk', 0.8), w('today', 1.2)]).map(claim => claim.text)).toEqual(['Elon Musk']);
    expect(detectClaims([w('Apple,', 3), w('Google', 3.4), w('now', 3.8)]).map(claim => claim.text)).toEqual(['Apple', 'Google']);
    expect(detectClaims([w('we', 0), w('use', 0.4), w('notion', 0.8)], {names: ['Notion']}).map(claim => claim.text)).toEqual(['notion']);
  });

  it('EVERY claim has a visual within 0.5 s (a B / C / D segment already up, or a beat), none unmet', () => {
    expect(claimPlan.stats.claims).toBe(7);
    expect(claimPlan.stats.unmet).toBe(0);
    expect(claimPlan.stats.maxDelaySec).toBeLessThanOrEqual(CLAIM_VISUAL_MAX_DELAY_SEC);
    expect(claimPlan.coverage).toHaveLength(7);
    for (const row of claimPlan.coverage) {
      expect(row.by).not.toBe('unmet');
      expect(row.delaySec!).toBeLessThanOrEqual(CLAIM_VISUAL_MAX_DELAY_SEC + 1e-9);
      // re-derive it from the layout track: the layout on screen 0.5 s after the claim (or at it) is a visual one
      const spanAtHalfSecond = claimPlan.layoutTrack.find(span => span.start <= row.claim.start + CLAIM_VISUAL_MAX_DELAY_SEC + 1e-9 && span.end > row.claim.start + 1e-9 && VISUAL_LAYOUTS.includes(span.layout));
      expect(spanAtHalfSecond, `${row.claim.text} @ ${row.claim.start}`).toBeDefined();
    }
    expect(claimPlan.warnings).toEqual([`polish_claim:visuals:7:${claimPlan.beats.length}`]);
  });

  it('a number spoken over a plain talking head gets a layout-B beat from claim - CLAIM_BEAT_LEAD_SEC, with the amount as the lime phrase', () => {
    expect(claimPlan.beats).toHaveLength(1);
    const beat = claimPlan.beats[0]!;
    expect(beat.layout).toBe('explainer_b');
    expect(beat.kind).toBe('article_highlight');
    expect(beat.start).toBeLessThanOrEqual(beat.claim.start);
    expect(beat.claim.start - beat.start).toBeLessThanOrEqual(CLAIM_BEAT_LEAD_SEC + 1e-6);
    expect(beat.end - beat.start).toBeGreaterThanOrEqual(CLAIM_BEAT_MIN_SEC);
    expect(beat.highlight).toMatchObject({phrase: '$1.4 trillion', kind: 'money'});
    expect(beat.highlight.start).toBeGreaterThanOrEqual(beat.start);
    expect(beat.highlight.end).toBeLessThanOrEqual(beat.end + 0.1);
    // it stays inside one talking-head segment
    const home = pacing.segments.find(segment => segment.start <= beat.start + 1e-6 && segment.end >= beat.end - 1e-6);
    expect(home?.layout).toBe('explainer_a');
  });

  it('claims already under a B / C / D segment need no beat; the names in the C diagram are covered by the C segment', () => {
    const names = claimPlan.coverage.filter(row => row.claim.start >= 9.7 && row.claim.start < 13);
    expect(names.length).toBeGreaterThanOrEqual(3);
    for (const row of names) expect(row.by).toBe('segment');
    expect(claimPlan.coverage.find(row => row.claim.kind === 'percent')!.layout).toBe('explainer_d');
  });

  it('the layout track tiles [0, duration] with hard cuts, keeps the WP40 segments and carves every beat out as layout B', () => {
    const track = claimPlan.layoutTrack;
    expect(track[0]!.start).toBe(0);
    expect(track.at(-1)!.end).toBeCloseTo(fixture.durationSec, 2);
    track.forEach((span, index) => {
      if (index > 0) expect(span.start).toBeCloseTo(track[index - 1]!.end, 6);
      expect(span.end).toBeGreaterThan(span.start);
    });
    for (const segment of pacing.segments) {
      if (segment.layout === 'explainer_a') continue;
      expect(track.some(span => span.layout === segment.layout && Math.abs(span.start - segment.start) < 1e-3)).toBe(true); // B / C / D segments survive
    }
    const beat = claimPlan.beats[0]!;
    expect(track.some(span => span.layout === 'explainer_b' && Math.abs(span.start - beat.start) < 1e-3 && Math.abs(span.end - beat.end) < 1e-3)).toBe(true);
    expect(layoutTrackOf(pacing.segments, [])).toHaveLength(pacing.segments.length);
  });

  it('does not change the WP40 segments (beats are overlays, the pacing bounds still hold)', () => {
    const again = planExplainerPacing({durationSec: fixture.durationSec, words: fixture.words});
    expect(again.segments).toEqual(pacing.segments);
    expect(again.stats.medianSec).toBeGreaterThanOrEqual(3.4);
    expect(again.stats.medianSec).toBeLessThanOrEqual(4.2);
  });

  it('beats never overlap and never leave their segment; a claim that cannot be placed is reported, not hidden', () => {
    // numbers every ~2 s over a long talking head: beats chain without overlapping; leftovers are reported unmet
    const words: ExplainerWord[] = [];
    for (let index = 0; index < 40; index += 1) words.push(w(index % 2 === 0 ? '$5' : 'later', 1 + index * 1.1, 1.3 + index * 1.1));
    const segments = pacing.segments.filter(segment => segment.layout === 'explainer_a').slice(0, 1).map(segment => ({...segment, start: 0, end: 30}));
    const dense = planClaimVisuals({segments, words});
    dense.beats.forEach((beat, index) => {
      expect(beat.start).toBeGreaterThanOrEqual(0);
      expect(beat.end).toBeLessThanOrEqual(30 + 1e-6);
      if (index > 0) expect(beat.start).toBeGreaterThanOrEqual(dense.beats[index - 1]!.end - 1e-6);
    });
    for (const row of dense.coverage) {
      if (row.by === 'unmet') expect(dense.warnings.some(item => item.startsWith('polish_claim:unmet:'))).toBe(true);
      else expect(row.delaySec!).toBeLessThanOrEqual(CLAIM_VISUAL_MAX_DELAY_SEC + 1e-9);
    }
    expect(dense.stats.coveredByBeat + dense.stats.coveredBySegment + dense.stats.unmet).toBe(dense.stats.claims);
    // no claims -> no beats, the layout track is just the segments
    const none = planClaimVisuals({segments: pacing.segments, words: [w('hello', 1), w('there', 1.4)]});
    expect(none.beats).toEqual([]);
    expect(none.layoutTrack).toHaveLength(pacing.segments.length);
    expect(none.warnings).toEqual(['polish_claim:visuals:0:0']);
  });

  it('is deterministic and pure (no env, I/O, model, randomness)', () => {
    expect(planClaimVisuals({segments: pacing.segments, words: fixture.words})).toEqual(claimPlan);
    const code = stripComments(read('./explainerClaims.ts'));
    expect(code).not.toMatch(/from 'node:|process\.env|fetch\(|Math\.random|Date\.now|import .*config\/env/);
  });
});

describe('WP41 5) lime highlight', () => {
  it('is #BFFF00, the same lime as the layouts, with the rest dimmed to 0.28', () => {
    expect(LIME_HIGHLIGHT_COLOR).toBe('#BFFF00');
    expect(LIME_HIGHLIGHT.color).toBe(EXPLAINER_LIME);
    expect(LIME_HIGHLIGHT.dimTo).toBe(0.28);
    expect(limeDimOpacity(-3)).toBe(1);
    expect(limeDimOpacity(0)).toBe(1);
    expect(limeDimOpacity(LIME_HIGHLIGHT.dimFrames)).toBeCloseTo(0.28, 6);
    expect(limeDimOpacity(99)).toBeCloseTo(0.28, 6);
    let last = 1;
    for (let frame = 0; frame <= LIME_HIGHLIGHT.dimFrames; frame += 1) {
      const value = limeDimOpacity(frame);
      expect(value).toBeLessThanOrEqual(last + 1e-9); // monotone dim
      last = value;
    }
  });

  it('wipes LEFT -> RIGHT: progress is monotone 0 -> 1, the delay lets the dim land first', () => {
    expect(limeWipeProgress(0)).toBe(0);
    expect(limeWipeProgress(LIME_HIGHLIGHT.wipeDelayFrames)).toBe(0);
    expect(limeWipeProgress(limeWipeDoneFrame())).toBeCloseTo(1, 6);
    expect(limeWipeProgress(limeWipeDoneFrame() + 30)).toBe(1);
    let last = 0;
    for (let frame = 0; frame <= limeWipeDoneFrame(); frame += 1) {
      const value = limeWipeProgress(frame);
      expect(value).toBeGreaterThanOrEqual(last - 1e-9);
      last = value;
    }
  });

  it('a phrase that wraps is ONE sweep over its line rects in reading order, widths as weights', () => {
    const rects = [
      {x: 0.6, y: 0.4, w: 0.3, h: 0.04},
      {x: 0.05, y: 0.45, w: 0.1, h: 0.04},
    ];
    expect(limeRectFractions(rects, 0)).toEqual([0, 0]);
    expect(limeRectFractions(rects, 1)).toEqual([1, 1]);
    const half = limeRectFractions(rects, 0.5);
    expect(half[0]).toBeCloseTo(0.5 / 0.75, 6); // the long first line takes 75 % of the sweep
    expect(half[1]).toBe(0);
    const late = limeRectFractions(rects, 0.9);
    expect(late[0]).toBe(1); // a line is full before the next starts
    expect(late[1]).toBeGreaterThan(0);
    expect(limeRectFractions([{x: 0.1, y: 0.1, w: 0.4, h: 0.05}], 0.3)).toEqual([0.3]);
    expect(limeRectFractions([], 0.5)).toEqual([]);
  });

  it('the bar is the phrase box plus a little breathing room, clamped into the plate', () => {
    const bar = limeBarRect({x: 0.3, y: 0.4, w: 0.2, h: 0.05});
    expect(bar.x).toBeLessThan(0.3);
    expect(bar.w).toBeGreaterThan(0.2);
    expect(bar.h).toBeGreaterThan(0.05);
    const edge = limeBarRect({x: 0, y: 0, w: 1, h: 1});
    expect(edge.x).toBe(0);
    expect(edge.x + edge.w).toBeLessThanOrEqual(1 + 1e-9);
    expect(edge.y + edge.h).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('the component dims the rest, wipes a lime bar and shows the plate at full strength inside it (multiply onto lime)', () => {
    const code = stripComments(read('../../../../remotion/src/components/LimeHighlightWipe.tsx'));
    expect(code).toContain('limeDimOpacity(frame)');
    expect(code).toContain('limeRectFractions(rects, limeWipeProgress(frame))');
    expect(code).toContain('LIME_HIGHLIGHT.color');
    expect(code).toContain("mixBlendMode: 'multiply'");
    expect(code).toContain("overflow: 'hidden'");
    const lib = stripComments(read('../../../../remotion/src/lib/limeHighlight.ts'));
    expect(lib).not.toMatch(/^import /m);
  });
});

describe('WP41 6) analyze wiring + offline proof', () => {
  const analyze = stripComments(read('../../pipeline/analyzeVideo.ts'));
  it('the explainer block plans claim visuals + chunk-swap captions ONLY when the skill resolves to explainer, after the accumulate step', () => {
    const block = analyze.slice(analyze.indexOf("if (polishSkill.skill === 'explainer') {"));
    const end = block.indexOf('if (facelessDoc && voGrammar && motion)');
    const explainer = block.slice(0, end);
    expect(explainer).toContain('planClaimVisuals({segments: pacing.segments, words: captionWords})');
    expect(explainer).toContain('polishExplainerCaptions(broll.caption, {layoutTrack: claimPlan.layoutTrack})');
    expect(explainer).toMatch(/if \(!\(input\.captionPreset \|\| ''\)\.trim\(\) && !captionGuide && !input\.captionTemplate\)/);
    expect(analyze.split('\n').filter(line => line.includes('polishExplainerCaptions(')).length).toBeGreaterThanOrEqual(1);
    expect(analyze.indexOf('polishAccumulateCaptions(')).toBeLessThan(analyze.indexOf('polishExplainerCaptions('));
  });

  it('Skill A path unchanged: the exact accumulate gate, the faceless gate and the single lane call', () => {
    expect(analyze).toMatch(/if \(polishPath && flags\.accumulateCaptions && voGrammar && !\(input\.captionPreset \|\| ''\)\.trim\(\) && !captionGuide && !input\.captionTemplate\)/);
    expect(analyze).toContain('const facelessDoc = Boolean(polishPath && flags.facelessDoc && voGrammar && motion && stockConfigured());');
    expect(analyze.match(/planFacelessDocLane\(/g)).toHaveLength(1);
    expect(analyze.split('\n').filter(line => line.includes('polishAccumulateCaptions(')).length).toBe(1);
    // faceless wins over explainer / newsroom in resolvePolishSkill
    expect(analyze).toContain('resolvePolishSkill({');
    expect(analyze).toContain('flags.newsroomMg');
  });

  const root = '../../../../remotion/';
  it('has the entry, the script and the npm script; the proof never writes Skill A or WP40 files', () => {
    const entry = read(`${root}scripts/wp41/entry.tsx`);
    for (const needle of ['ChunkSwapCaptions', 'LimeHighlightWipe', 'ExplainerLayoutFrame', 'EXPLAINER_CHIP_STAGGER_SEC', 'wp41-plan.json']) expect(entry).toContain(needle);
    const script = read(`${root}scripts/wp41-preview.mjs`);
    for (const needle of ['planClaimVisuals', 'polishExplainerCaptions', 'wp41-explainer-captions.mp4', 'wp41-lime-wipe-strip.jpg']) expect(script).toContain(needle);
    expect(script).not.toMatch(/wp36-faceless-doc\.mp4|wp36-plan\.json|wp40-explainer-layouts\.mp4|wp40-plan\.json/);
    expect(JSON.parse(read(`${root}package.json`)).scripts['preview:wp41']).toBe('node scripts/wp41-preview.mjs');
    expect(JSON.parse(read(`${root}package.json`)).scripts['preview:wp40']).toBe('node scripts/wp40-preview.mjs');
  });

  const measuredPath = new URL(`${root}out/phase36-readiness/wp41-measured.json`, import.meta.url);
  it.skipIf(!existsSync(measuredPath))('the measured MP4: chunk swap, caption y by layout, lime L->R wipe + dim, every claim within 0.5 s, every cut', () => {
    const measured = JSON.parse(readFileSync(measuredPath, 'utf8'));
    expect(measured.video.durationSec).toBeGreaterThanOrEqual(20);
    expect(measured.video.durationSec).toBeLessThanOrEqual(30);
    expect(measured.captions.mode).toBe('chunk_swap');
    expect(measured.captions.wordsPerChunk.max).toBeLessThanOrEqual(3);
    expect(measured.captions.wordsPerChunk.min).toBeGreaterThanOrEqual(1);
    expect(measured.captions.maxOverlapSec).toBeLessThanOrEqual(0);
    expect(measured.checks).toEqual({
      allFourLayouts: true,
      chunksOneToThreeWords: true,
      oneChunkAtATime: true,
      captionYByLayout: true,
      captionYBothValues: true,
      limeAppears: true,
      limeWipesLeftToRight: true,
      restDims: true,
      claimToVisualWithinHalfSecond: true,
      cutsOnFile: true,
    });
    expect(measured.lime.dimRatio).toBeGreaterThanOrEqual(0.15);
    expect(measured.lime.dimRatio).toBeLessThanOrEqual(0.42);
    for (const row of measured.captions.yBySample) expect(row.ok).toBe(true);
    expect(measured.claimVisual.stats.maxDelaySec).toBeLessThanOrEqual(0.5);
    expect(measured.cutsVerifiedOnFile).toBe(measured.cutsPlanned);
  });
});
