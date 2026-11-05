/**
 * WP34: word-by-word ACCUMULATE captions (Metromedia grammar). Offline: no render, no network, no model.
 *   1. mode wiring: the direction field, the schema, the renderer branch (KineticCaptions + DynamicCaptionRenderer), the polish switch, the env flag, locked / non-polish paths unchanged
 *   2. max 4 words per line; lines are the WP33 caption groups
 *   3. hard clear on the cut: no line straddles a cut, every line clears on the first cut after it starts
 *   4. blur-fade word entrance: 4 frames, blur 12 -> 0, opacity 0 -> 1, scale never overshoots
 *   5. size ~7 % of the frame height, y band 42-50 %, sentence case (caps only for figures / the CTA keyword)
 *   6. no pill: no plate, stroke or colour highlight in the renderer; the direction clears box / glow
 *   7. the offline proof
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {captionDirectionSchema} from '../../../../remotion/src/blueprintSchema.ts';
import {
  ACCUMULATE,
  ACCUMULATE_MODE,
  accumulateCenterYFrac,
  accumulateDisplayWords,
  accumulateFitFontPx,
  accumulateFontPx,
  accumulateMaxWords,
  accumulateRevealedCount,
  accumulateWordState,
  activeAccumulateLineAt,
  groupAccumulateLines,
} from '../../../../remotion/src/lib/accumulateCaptions.ts';
import {env} from '../../config/env.ts';
import {
  ACCUMULATE_CAPTION_MODE,
  ACCUMULATE_CENTER_Y_FRAC,
  ACCUMULATE_MAX_WORDS,
  ACCUMULATE_SIZE_PCT_FRAME_H,
  ACCUMULATE_Y_BAND,
  accumulateCapsWords,
  accumulateCutTimes,
  polishAccumulateCaptions,
} from '../../lib/polishAccumulateCaptions.ts';
import {polishBareCaption} from '../../lib/polishBareCaption.ts';
import type {CaptionDirection} from '../../types/blueprint.ts';
import {shineCaptionDirection} from './geminiDirector.ts';
import {ctaWindowsOf, moneyWindowsOf, planVoCutGrammar, type VoWord} from './voCutGrammar.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const fixture = JSON.parse(read('./fixtures/wp33-vo-words.json')) as {durationSec: number; words: VoWord[]};
const plan = planVoCutGrammar({
  words: fixture.words,
  durationSec: fixture.durationSec,
  flags: {moneyWindows: moneyWindowsOf(fixture.words), ctaWindows: ctaWindowsOf(fixture.words, fixture.durationSec)},
});
const cutTimes = accumulateCutTimes(plan);
const lines = groupAccumulateLines(fixture.words, {cutTimes});
const FPS = 30;

describe('WP34 1) mode wiring', () => {
  it('the direction field and the schema carry the accumulate mode, the cut times and the grammar numbers', () => {
    const parsed = captionDirectionSchema.parse({position: 'center', bottomFrac: 0.2, mode: ACCUMULATE_MODE, cutTimes: [0.86, 1.76], maxWords: 4, sizePctFrameH: 7, centerYFrac: 0.46, capsWords: ['follow']});
    expect(parsed).toMatchObject({mode: 'word_by_word_accumulate', cutTimes: [0.86, 1.76], maxWords: 4, sizePctFrameH: 7, centerYFrac: 0.46, capsWords: ['follow']});
    expect(() => captionDirectionSchema.parse({position: 'center', bottomFrac: 0.2, mode: 'replace'})).toThrow();
    expect(() => captionDirectionSchema.parse({position: 'center', bottomFrac: 0.2, centerYFrac: 0.7})).toThrow(); // outside the 42-50 % band
    expect(() => captionDirectionSchema.parse({position: 'bottom', bottomFrac: 0.2})).not.toThrow(); // absent mode = unchanged
  });
  it('the server and the renderer share one mode name', () => {
    expect(ACCUMULATE_CAPTION_MODE).toBe(ACCUMULATE_MODE);
    expect(ACCUMULATE_MODE).toBe('word_by_word_accumulate');
  });
  it('polishAccumulateCaptions writes the grammar onto the bare polish direction and the result still parses', () => {
    const bare = polishBareCaption(shineCaptionDirection(), {lookId: 'ink_white', templateLocked: false}).caption;
    const {caption, warnings} = polishAccumulateCaptions(bare, {plan, words: fixture.words, durationSec: fixture.durationSec});
    expect(caption).toMatchObject({mode: ACCUMULATE_MODE, maxWords: 4, sizePctFrameH: 7, centerYFrac: ACCUMULATE_CENTER_Y_FRAC, boxColor: null, glow: false, uppercase: false, fontScale: 1});
    expect(caption.cutTimes).toEqual(cutTimes);
    expect(warnings).toEqual([`polish_accumulate:word_by_word_accumulate:${cutTimes.length}`]);
    expect(() => captionDirectionSchema.parse(caption)).not.toThrow();
    // idempotent
    expect(polishAccumulateCaptions(caption, {plan, words: fixture.words, durationSec: fixture.durationSec}).caption).toEqual(caption);
  });
  it('no cuts -> the direction is returned untouched (nothing to clear on)', () => {
    const bare = shineCaptionDirection();
    const result = polishAccumulateCaptions(bare, {plan: {cuts: [], groups: []}, words: [], durationSec: 10});
    expect(result.caption).toBe(bare);
    expect(result.warnings).toEqual(['polish_accumulate:no_cuts_skipped']);
  });
  it('the renderer branches on the mode and leaves every other direction on the template captions', () => {
    const kinetic = read('../../../../remotion/src/components/KineticCaptions.tsx');
    expect(kinetic).toContain("props.direction?.mode === ACCUMULATE_MODE");
    expect(kinetic).toContain('<AccumulateCaptions');
    expect(kinetic).toContain('<TemplateKineticCaptions {...props} />');
    const dynamic = read('../../../../remotion/src/captions/DynamicCaptionRenderer.tsx');
    expect(dynamic).toContain('direction?.mode === ACCUMULATE_MODE');
    // the accumulate branch comes before the package-theme / utility branches (it owns the whole caption layer)
    expect(dynamic.indexOf('direction?.mode === ACCUMULATE_MODE')).toBeLessThan(dynamic.indexOf('if (isPackageCaptionThemeId(selectedTemplate))'));
  });
  it('env: POLISH_ACCUMULATE_CAPTIONS defaults on and is documented', () => {
    expect(read('../../config/env.ts')).toContain('POLISH_ACCUMULATE_CAPTIONS: bool(true)');
    expect(read('../../../../.env.example')).toContain('POLISH_ACCUMULATE_CAPTIONS=1');
    expect(env.POLISH_ACCUMULATE_CAPTIONS).toBe(true);
  });
  it('analyze applies it once: polish + flag + the VO cut plan, never over a CaptionKit preset / caption style guide / caller template, after the bare type', () => {
    const analyze = read('../../pipeline/analyzeVideo.ts');
    expect(analyze.split('\n').filter(line => line.includes('polishAccumulateCaptions(')).length).toBe(1);
    expect(analyze).toMatch(/if \(polishPath && flags\.accumulateCaptions && voGrammar && !\(input\.captionPreset \|\| ''\)\.trim\(\) && !captionGuide && !input\.captionTemplate\)/);
    expect(analyze.indexOf('const voGrammar')).toBeLessThan(analyze.indexOf('polishAccumulateCaptions('));
    expect(analyze.indexOf('polishBareCaption(broll.caption')).toBeLessThan(analyze.indexOf('polishAccumulateCaptions('));
  });
  it('the polish module is pure (no env, I/O, model, randomness)', () => {
    const code = stripComments(read('../../lib/polishAccumulateCaptions.ts'));
    for (const needle of ['process.env', 'fetch(', 'readFileSync', 'logger', 'anthropic', 'Math.random', 'Date.now']) expect(code, needle).not.toContain(needle);
  });
  it('the renderer lib is dependency-free (the server, the renderer and the proof all import it)', () => {
    expect(stripComments(read('../../../../remotion/src/lib/accumulateCaptions.ts'))).not.toMatch(/^import /m);
  });
});

describe('WP34 2) max words and the WP33 groups', () => {
  it('no line is longer than 4 words, whatever cap is asked for', () => {
    for (const cap of [1, 2, 3, 4, 5, 9, undefined]) {
      const grouped = groupAccumulateLines(fixture.words, {maxWords: cap, cutTimes});
      expect(Math.max(...grouped.map(line => line.words.length)), `cap ${cap}`).toBeLessThanOrEqual(4);
    }
    expect(accumulateMaxWords(9)).toBe(4);
    expect(accumulateMaxWords(0)).toBe(1);
    expect(accumulateMaxWords(undefined)).toBe(ACCUMULATE.maxWordsPerLine);
    expect(ACCUMULATE_MAX_WORDS).toBe(ACCUMULATE.maxWordsPerLine);
  });
  it('without cuts, a long run of words splits at the cap (4) and every spoken word appears once, in order', () => {
    const words = Array.from({length: 11}, (_, i) => ({text: `w${i}`, start: i * 0.2, end: i * 0.2 + 0.15}));
    const grouped = groupAccumulateLines(words, {});
    expect(grouped.map(line => line.words.length)).toEqual([4, 4, 3]);
    expect(grouped.flatMap(line => line.words.map(word => word.text))).toEqual(words.map(word => word.text));
  });
  it('driven by the WP33 cut plan the lines ARE the caption groups (1-3 words, same words, same onsets); a group is split only where a real cut falls inside it', () => {
    // every line is a contiguous run of ONE group, and the lines of a group, joined, are that group's words in order
    const byGroup = plan.groups.map(group => lines.filter(line => line.start >= group.start - 0.002 && line.start <= group.end + 0.002));
    byGroup.forEach((own, index) => {
      expect(own.flatMap(line => line.words.map(word => word.text)), `group ${index}`).toEqual(plan.groups[index]!.words);
      expect(own[0]!.start).toBeCloseTo(plan.groups[index]!.start, 3);
      // a split group has a cut inside it (here: the chapter card's end edge), an unsplit one has none
      own.slice(1).forEach((later, k) => expect(cutTimes.some(cut => cut > own[k]!.start + 0.002 && cut <= later.start + 0.003), `group ${index} split off a cut`).toBe(true));
    });
    expect(lines.flatMap(line => line.words.map(word => word.text))).toEqual(fixture.words.map(word => word.text));
    expect(lines.length - plan.groups.length).toBeLessThanOrEqual(2); // only the chapter-card edge splits one group in the fixture
    for (const line of lines) expect(line.words.length).toBeLessThanOrEqual(3);
  });
  it('a long pause or a sentence change starts a new line even with no cut', () => {
    const words = [
      {text: 'one', start: 0, end: 0.2, sentenceIndex: 0},
      {text: 'two', start: 0.25, end: 0.45, sentenceIndex: 0},
      {text: 'three', start: 0.5, end: 0.7, sentenceIndex: 1},
      {text: 'four', start: 1.6, end: 1.8, sentenceIndex: 1},
    ];
    expect(groupAccumulateLines(words, {}).map(line => line.words.map(word => word.text))).toEqual([['one', 'two'], ['three'], ['four']]);
  });
});

describe('WP34 3) accumulate build + hard clear on the cut', () => {
  it('the build: each word joins the line at its own onset, earlier words stay', () => {
    const line = lines.find(item => item.words.length === 3)!;
    expect(line).toBeTruthy();
    const onsets = line.words.map(word => word.start);
    expect(accumulateRevealedCount(line, onsets[0]! - 0.01)).toBe(0);
    expect(accumulateRevealedCount(line, onsets[0]!)).toBe(1);
    expect(accumulateRevealedCount(line, onsets[1]!)).toBe(2);
    expect(accumulateRevealedCount(line, onsets[2]!)).toBe(3);
    expect(accumulateRevealedCount(line, line.clearAt - 0.001)).toBe(3);
  });
  it('no line straddles a cut: a cut never falls between a line\'s first and last word onsets', () => {
    for (const line of lines) {
      const first = line.words[0]!.start;
      const last = line.words[line.words.length - 1]!.start;
      for (const cut of cutTimes) expect(cut > first + 0.002 && cut <= last + 0.002, `${line.words.map(w => w.text).join(' ')} vs cut ${cut}`).toBe(false);
    }
  });
  it('every line is cleared by the first cut after it starts, and before the next line begins (hard clear, no overlap)', () => {
    lines.forEach((line, index) => {
      const firstCut = cutTimes.find(cut => cut > line.start + 0.002);
      if (firstCut !== undefined) expect(line.clearAt, `line ${index}`).toBeLessThanOrEqual(firstCut + 1e-9);
      const next = lines[index + 1];
      if (next) expect(line.clearAt).toBeLessThanOrEqual(next.start + 1e-9);
      expect(line.clearAt).toBeGreaterThan(line.start);
    });
  });
  it('at the cut frame the old line is gone: the frame before shows it, the cut frame shows none of it', () => {
    let checked = 0;
    for (const cut of cutTimes) {
      const frame = Math.round(cut * FPS);
      const before = lines.find(line => frame - 1 >= Math.round(line.start * FPS) && frame - 1 < Math.round(line.clearAt * FPS));
      const at = lines.find(line => frame >= Math.round(line.start * FPS) && frame < Math.round(line.clearAt * FPS));
      if (before && at) {
        expect(at, `cut ${cut}`).not.toBe(before);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });
  it('between lines nothing is drawn (hard clear), and after the last word the line holds only briefly', () => {
    const line = lines[0]!;
    expect(activeAccumulateLineAt(lines, line.start)).toBe(line);
    expect(activeAccumulateLineAt(lines, line.clearAt)).not.toBe(line);
    const lastEnd = line.words[line.words.length - 1]!.end;
    expect(line.clearAt - lastEnd).toBeLessThanOrEqual(ACCUMULATE.holdAfterSec + 1e-9);
    expect(activeAccumulateLineAt(lines, -1)).toBeNull();
  });
  it('a line followed by silence over a cut clears on that cut', () => {
    const words = [{text: 'hello', start: 0, end: 0.3}, {text: 'there', start: 0.32, end: 0.6}, {text: 'again', start: 3, end: 3.3}];
    const grouped = groupAccumulateLines(words, {cutTimes: [0.9]});
    expect(grouped[0]!.clearAt).toBeCloseTo(0.85, 2); // end 0.6 + hold 0.25 comes first
    const tight = groupAccumulateLines(words, {cutTimes: [0.7]});
    expect(tight[0]!.clearAt).toBeCloseTo(0.7, 3);
  });
  it('the cut list is the plan\'s cuts plus every group start, sorted and unique', () => {
    expect([...cutTimes]).toEqual([...cutTimes].sort((a, b) => a - b));
    expect(new Set(cutTimes).size).toBe(cutTimes.length);
    for (const cut of plan.cuts) expect(cutTimes).toContain(Math.round(cut * 1000) / 1000);
    for (const group of plan.groups) if (group.start > 0) expect(cutTimes).toContain(Math.round(group.start * 1000) / 1000);
  });
});

describe('WP34 4) blur-fade word entrance', () => {
  it('4 frames: blur 12 -> 0 px, opacity 0 -> 1', () => {
    expect(ACCUMULATE.wordInFrames).toBe(4);
    expect(ACCUMULATE.blurFromPx).toBe(12);
    expect(accumulateWordState(0)).toMatchObject({opacity: 0, blurPx: 12});
    const mid = accumulateWordState(2);
    expect(mid.opacity).toBeCloseTo(0.5, 5);
    expect(mid.blurPx).toBeCloseTo(6, 5);
    expect(accumulateWordState(4)).toMatchObject({opacity: 1, blurPx: 0, scale: 1});
    expect(accumulateWordState(40)).toMatchObject({opacity: 1, blurPx: 0, scale: 1});
  });
  it('hidden before the onset', () => {
    expect(accumulateWordState(-1).opacity).toBe(0);
    expect(accumulateWordState(-10).blurPx).toBe(12);
  });
  it('monotonic: blur only falls, opacity only rises, scale rises to 1 and never overshoots (no bounce)', () => {
    let previous = accumulateWordState(0);
    for (let frame = 1; frame <= 30; frame += 1) {
      const state = accumulateWordState(frame);
      expect(state.blurPx).toBeLessThanOrEqual(previous.blurPx);
      expect(state.opacity).toBeGreaterThanOrEqual(previous.opacity);
      expect(state.scale).toBeGreaterThanOrEqual(previous.scale);
      expect(state.scale).toBeLessThanOrEqual(1);
      expect(state.opacity).toBeLessThanOrEqual(1);
      previous = state;
    }
    expect(accumulateWordState(0).scale).toBeCloseTo(0.96, 5);
  });
  it('the renderer drives opacity / blur / scale from that state (no spring)', () => {
    const code = stripComments(read('../../../../remotion/src/components/AccumulateCaptions.tsx'));
    expect(code).toContain('accumulateWordState(frame - Math.round(word.start * fps))');
    expect(code).toContain('opacity: state.opacity');
    expect(code).toContain('blur(${state.blurPx}px)');
    expect(code).toContain('scale(${state.scale})');
    expect(code).not.toMatch(/spring\(/);
  });
});

describe('WP34 5) size, position, case', () => {
  it('font size is ~7 % of the composition height', () => {
    expect(ACCUMULATE.sizePctFrameH).toBe(7);
    expect(ACCUMULATE_SIZE_PCT_FRAME_H).toBe(7);
    expect(accumulateFontPx(608)).toBe(43); // the reference's 1080x608
    expect(accumulateFontPx(1920)).toBe(134); // 9:16
    expect(accumulateFontPx(1080)).toBe(76);
    expect(accumulateFontPx(1920, 7) / 1920).toBeCloseTo(0.07, 2);
    // far from the WP32 chest-band bump (1.4 x a ~93 px template = ~130 px on a 1080 wide canvas is similar in px but a different rule: this one follows the HEIGHT)
    expect(accumulateFontPx(1000, 99)).toBe(990); // an explicit value is honoured by the helper; the schema caps it at 12
    expect(() => captionDirectionSchema.parse({position: 'center', bottomFrac: 0.2, sizePctFrameH: 40})).toThrow();
  });
  it('the vertical centre is always inside y 42-50 %', () => {
    expect(accumulateCenterYFrac(undefined)).toBe(0.46);
    expect(accumulateCenterYFrac(0.1)).toBe(0.42);
    expect(accumulateCenterYFrac(0.9)).toBe(0.5);
    expect(accumulateCenterYFrac(0.44)).toBe(0.44);
    expect(ACCUMULATE_Y_BAND).toEqual({min: 0.42, max: 0.5});
    expect(ACCUMULATE_CENTER_Y_FRAC).toBeGreaterThanOrEqual(0.42);
    expect(ACCUMULATE_CENTER_Y_FRAC).toBeLessThanOrEqual(0.5);
    const code = stripComments(read('../../../../remotion/src/components/AccumulateCaptions.tsx'));
    expect(code).toContain('top: height * accumulateCenterYFrac(direction?.centerYFrac)');
    expect(code).toContain("left: '50%'");
    expect(code).toContain("transform: 'translate(-50%, -50%)'");
  });
  it('sentence case: words keep their spelling and lose trailing punctuation; only figures, their unit and the flagged CTA keyword are caps', () => {
    expect(accumulateDisplayWords([{text: 'This'}, {text: 'founder'}, {text: 'got'}, {text: 'fired.'}])).toEqual(['This', 'founder', 'got', 'fired']);
    expect(accumulateDisplayWords([{text: 'raised'}, {text: '$6'}, {text: 'billion,'}])).toEqual(['raised', '$6', 'BILLION']);
    expect(accumulateDisplayWords([{text: 'six'}, {text: 'billion'}])).toEqual(['six', 'billion']); // spelled-out numbers are words, not figures
    expect(accumulateDisplayWords([{text: 'In'}, {text: '2008,'}])).toEqual(['In', '2008']);
    expect(accumulateDisplayWords([{text: 'Follow'}, {text: 'for'}, {text: 'more'}], ['follow'])).toEqual(['FOLLOW', 'for', 'more']);
    expect(accumulateDisplayWords([{text: 'billion'}, {text: 'dollars'}])).toEqual(['billion', 'dollars']); // a unit with no figure before it stays sentence case
  });
  it('the CTA keyword (follow / subscribe, closing words only) is the one flagged caps word', () => {
    expect(accumulateCapsWords(fixture.words, fixture.durationSec)).toEqual(['follow']);
    expect(accumulateCapsWords(fixture.words.slice(0, 20), fixture.durationSec)).toEqual([]);
  });
  it('a word wider than the container shrinks the type (never below 60 %), a short word keeps the full 7 %', () => {
    expect(accumulateFitFontPx(134, 7, 950)).toBe(134);
    const fitted = accumulateFitFontPx(134, 13, 950);
    expect(fitted).toBeLessThan(134);
    expect(fitted).toBeGreaterThanOrEqual(Math.round(134 * 0.6));
    expect(accumulateFitFontPx(134, 40, 950)).toBe(Math.round(134 * 0.6));
  });
});

describe('WP34 6) no pill, no highlight', () => {
  const code = stripComments(read('../../../../remotion/src/components/AccumulateCaptions.tsx'));
  it('the renderer draws white type with a soft shadow only: no plate, border, stroke, glow or colour highlight', () => {
    for (const needle of ['backgroundColor', 'borderRadius', 'border:', 'WebkitTextStroke', 'boxShadow', 'highlightColor', 'strokeColor', 'activeStyle', 'glow']) expect(code, needle).not.toContain(needle);
    expect(code).toContain('color: ACCUMULATE.color');
    expect(ACCUMULATE.color).toBe('#FFFFFF');
    expect(ACCUMULATE.shadowBlurPx).toBe(8);
    expect(ACCUMULATE.shadowOpacity).toBe(0.35);
    expect(code).toContain('rgba(0,0,0,${ACCUMULATE.shadowOpacity})');
  });
  it('the polish direction clears the box colour, the glow and the uppercase flag, whatever the input carried', () => {
    const pill: CaptionDirection = {...shineCaptionDirection(), boxColor: 'rgba(0,0,0,0.72)', glow: true, uppercase: true, animation: 'highlight'};
    const {caption} = polishAccumulateCaptions(pill, {plan, words: fixture.words, durationSec: fixture.durationSec});
    expect(caption.boxColor).toBeNull();
    expect(caption.glow).toBe(false);
    expect(caption.uppercase).toBe(false);
  });
});

describe('WP34 7) the offline proof', () => {
  it('plans from the REAL planner and draws with the PRODUCTION AccumulateCaptions component on hard cuts', () => {
    const script = read('../../../../remotion/scripts/wp34-preview.mjs');
    const entry = read('../../../../remotion/scripts/wp34/entry.tsx');
    expect(script).toContain('voCutGrammar.ts');
    expect(script).toContain('polishAccumulateCaptions.ts');
    expect(script).toContain('wp33-vo-words.json');
    expect(script).toContain('wp34-accumulate-captions.mp4');
    expect(script).toContain('wp34-reveal-strip.jpg');
    expect(script).toContain('wp34-contact-sheet.jpg');
    expect(entry).toContain("import {AccumulateCaptions} from '../../src/components/AccumulateCaptions';");
    expect(entry).toContain('wp34-plan.json');
    expect(entry).not.toMatch(/TransitionTrack|whip|flash_white|SmashPunch/);
    expect(read('../../../../remotion/package.json')).toContain('"preview:wp34": "node scripts/wp34-preview.mjs"');
  });
});
