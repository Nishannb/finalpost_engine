import {describe, expect, it} from 'vitest';

import {renderSpecSchema, type RenderSpec} from '../schema.ts';
import {toKineticWords, normToken} from '../transcript.ts';
import {splitKineticSpecForBroll} from '../brollCaptionSplit.ts';
import {analyzeBeats, findStat, parseNumberToken} from './beats.ts';
import {composeKinetic, splitForCoverage, takesFor} from './composeKinetic.ts';
import {deterministicDirection, mergeDirector, resolveDirection} from './direction.ts';
import {measureVariety, sameness} from './metrics.ts';
import {verifyComposed} from './verify.ts';
import {BACKED_PAIRS} from './compositions.ts';
import {isPartId, projectedRowGap, rowGapPx, rowsOf, slantViolations, spaceRows} from './slant.ts';
import {directorMatchCut} from '../matchCut.ts';
import {runKineticEngineStage} from '../../../pipeline/kineticEngineStage.ts';

/** a transcript with timings: ~0.3 s per word, a pause after every sentence */
function talk(text: string, wordSec = 0.3, pauseSec = 0.45): Array<{text: string; start: number; end: number}> {
  const out: Array<{text: string; start: number; end: number}> = [];
  let t = 0.2;
  for (const w of text.split(/\s+/).filter(Boolean)) {
    out.push({text: w, start: t, end: t + wordSec * 0.9});
    t += wordSec + (/[.!?]$/.test(w) ? pauseSec : /,$/.test(w) ? 0.15 : 0);
  }
  return out;
}

const SCRIPT = 'Most creators go from 0 to 10k followers in one year. Here are three simple steps. First, post every single day. Second, reply to every comment. And third, collaborate with bigger creators. ' +
  "It's not about luck. It's about consistency. Why do most people quit after one week? Because they want fast results and they never wait. The secret is patience. Follow for more tips like this.";
const CALM = 'Have you ever noticed how quiet moments speak the loudest in your relationships? When you resist the urge to fill every pause, you invite true presence. That is where real connection begins. ' +
  'Think back to a moment of shared silence with someone you love. It felt safe. It felt honest. Silence is not empty. It is full of attention, and attention is the deepest form of love.';
const BOX = {x: 0.15, y: 0.3, w: 0.7, h: 0.7};
const input = (words: ReturnType<typeof talk>) => ({captionWords: words, fps: 30, width: 1080, height: 1920, durationSec: words[words.length - 1]!.end + 0.5, speaker: {box: BOX, source: 'vision' as const, srcW: 1080, srcH: 1920}, director: null, plate: {luminance: 0.3, color: '#33404f'}});

describe('Kinetic Composer: beats (P2)', () => {
  const words = toKineticWords(talk(SCRIPT), 30);
  const beats = analyzeBeats(words, 30);
  const text = (b: (typeof beats)[number]) => words.slice(b.wordRange[0], b.wordRange[1] + 1).map(w => w.text).join(' ');
  it('numbers with units / ranges are stats, small bare counts are not', () => {
    expect(parseNumberToken('30k')).toMatchObject({value: 30, suffix: 'K'});
    expect(parseNumberToken('$5,000')).toMatchObject({value: 5000, prefix: '$'});
    expect(parseNumberToken('50%')).toMatchObject({value: 50, suffix: '%'});
    const stat = beats.find(b => b.type === 'stat');
    expect(stat?.stat).toMatchObject({from: 0, to: 10, suffix: 'K'});
    const w2 = toKineticWords(talk('three simple steps'), 30);
    expect(findStat(w2, 0, 2)).toBeNull();
  });
  it('finds the list items, the parallel contrast, the question and the call to action', () => {
    const lists = beats.filter(b => b.type === 'list').map(b => b.listMarker!.ordinal);
    expect(lists).toEqual([1, 2, 3]);
    const contrast = beats.find(b => b.type === 'contrast' && text(b).includes('consistency'));
    expect(contrast?.contrast).toBeDefined();
    expect(words[contrast!.contrast!.a]!.text).toMatch(/luck/);
    expect(beats.some(b => b.type === 'question')).toBe(true);
    expect(beats[beats.length - 1]!.type).toBe('cta');
    expect(beats[0]!.hook).toBe(true);
  });
  it('reduced takes keep the words that carry the beat', () => {
    const stat = beats.find(b => b.type === 'stat')!;
    const takes = takesFor(stat, words);
    expect(takes[0]).toBeUndefined();
    for (const t of takes.slice(1)) for (const i of stat.stat!.wordIdx) expect(t).toContain(i);
  });
});

describe('Kinetic Composer: edit direction (P6)', () => {
  it('tone and toolkit follow the words, and two videos never share the same seed / mix', () => {
    const a = toKineticWords(talk(SCRIPT), 30), b = toKineticWords(talk(CALM), 30);
    const da = deterministicDirection(a, analyzeBeats(a, 30)), db = deterministicDirection(b, analyzeBeats(b, 30));
    expect(db.tone).toBe('calm');
    expect(da.toolkit).toEqual(expect.arrayContaining(['counterStat', 'listItem', 'contrastSplit', 'questionCard', 'ctaCard']));
    expect(da.seed).not.toBe(db.seed);
  });
  it('a Director reply is clamped to known names; a failing Director falls back to the deterministic direction', async () => {
    const w = toKineticWords(talk(SCRIPT), 30);
    const beats = analyzeBeats(w, 30);
    const base = deterministicDirection(w, beats);
    const merged = mergeDirector({tone: 'hype', toolkit: ['giantWord', 'fireworks', 'takeover', 'wordSwap'], beats: [{id: 'b1', composition: 'giantWord'}, {id: 'nope', composition: 'x'}, {id: 'b2', type: 'nonsense'}]}, base, beats);
    expect(merged.source).toBe('director');
    expect(merged.toolkit).not.toContain('fireworks');
    expect(merged.beatTags).toEqual({b1: {composition: 'giantWord'}});
    const failed = await resolveDirection(w, beats, async () => { throw new Error('boom'); });
    expect(failed.source).toBe('deterministic');
    expect(failed.reason).toMatch(/director_failed/);
    const garbage = await resolveDirection(w, beats, async () => 'not json');
    expect(garbage.source).toBe('deterministic');
  });
});

describe('Kinetic Composer: compose (P3-P8)', () => {
  it('produces a verified, varied edit: many compositions, no back-to-back repeats, words only from the transcript', async () => {
    const r = await composeKinetic(input(talk(SCRIPT)));
    expect(r.report.failure).toBeUndefined();
    expect(r.spec).not.toBeNull();
    const spec = r.spec!;
    expect(verifyComposed(spec, r.debug!.scene, [{id: 'shot-0', startFrame: 0, endFrame: spec.durationInFrames}])).toEqual([]);
    // one treatment per beat (a backed word lives in a second `.b` event, a slanted treatment's extra rows in `.rN` events of the same beat)
    const designed = spec.events.filter(e => e.composition && e.composition !== 'captionLane' && !isPartId(e.id)).sort((a, b) => a.inFrame - b.inFrame);
    const kinds = new Set(designed.map(e => e.composition));
    expect(kinds.size).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < designed.length; i += 1) if (designed[i]!.composition !== 'listItem') expect(designed[i]!.composition).not.toBe(designed[i - 1]!.composition);
    // the content-bound compositions were used where the content is
    expect(r.report.beats.find(b => b.type === 'stat')?.composition).toBe('counterStat');
    expect(r.report.beats.filter(b => b.type === 'list').every(b => b.composition === 'listItem')).toBe(true);
    // fidelity: every drawn line is a spoken token
    const tokens = new Set(r.debug!.words.map(w => normToken(w.text)));
    for (const e of spec.events) for (const l of e.lines) expect(tokens.has(normToken(l.text))).toBe(true);
    // counters show the spoken number
    const counter = spec.scene?.find(el => el.kind === 'counter');
    expect(counter).toMatchObject({kind: 'counter', from: 0, to: 10, suffix: 'K'});
    // the metrics are logged with the edit
    expect(r.report.metrics!.varietyScore).toBeGreaterThanOrEqual(55);
    expect(r.report.metrics!.maxShare).toBeLessThanOrEqual(0.4);
  });
  it('is deterministic, and a different talk gives a different edit', async () => {
    const a1 = await composeKinetic(input(talk(SCRIPT)));
    const a2 = await composeKinetic(input(talk(SCRIPT)));
    expect(JSON.stringify(a1.spec)).toBe(JSON.stringify(a2.spec));
    const b = await composeKinetic(input(talk(CALM)));
    expect(b.spec).not.toBeNull();
    expect(b.report.direction.tone).toBe('calm');
    expect(sameness(a1.spec!, b.spec!)).toBeLessThan(0.95);
  });
  it('beat punch-ins are returned with the spec and the type clears the zoomed face', async () => {
    const r = await composeKinetic(input(talk(SCRIPT)));
    expect(r.zoomTriggers.length).toBe(r.report.zooms.total);
    for (const z of r.zoomTriggers) { expect(z.scale).toBeGreaterThan(1); expect(z.scale).toBeLessThanOrEqual(1.3); expect(z.end).toBeGreaterThan(z.start); }
  });
  it('fails explicitly on bad input (the caller keeps the V2 engine)', async () => {
    expect((await composeKinetic({...input(talk(SCRIPT)), captionWords: []})).report.failure).toBe('no_words');
    expect((await composeKinetic({...input(talk(SCRIPT)), fps: 0})).report.failure).toBe('invalid_geometry_or_duration');
  });
});

describe('Kinetic Composer: craft rules (backed text, contrast, motion)', () => {
  it('text on a chip / highlighter / bar / card never carries an outline or glow, and its backing is a curated pair', async () => {
    for (const script of [SCRIPT, CALM]) {
      const r = await composeKinetic({...input(talk(script)), identity: {presetId: 'x', font: 'anton', weight: null, upper: true, text: '#FFFFFF', accent: '#FF5A5F', accent2: '#FF4FA3', outline: {color: '#FF2E63', strokePxAt1920: 6}, shadowColor: null, limitations: [], mapping: {family: 'Anton', fontKey: 'anton', exact: true}}});
      const backed = r.spec!.events.filter(e => e.notes.some(n => n.startsWith('backed:')));
      expect(backed.length).toBeGreaterThan(0);
      for (const e of backed) { expect(e.shadow.strokePx).toBe(0); expect(e.shadow.glowPx).toBe(0); for (const l of e.lines) expect(l.glow).toBeNull(); }
      // a mid-tone accent (salmon #FF5A5F) is refused as a backing: chips / highlighters / bars use a curated pair
      for (const el of r.spec!.scene ?? []) if (el.kind === 'shape' && /-(chip|hl|bar\d)$/.test(el.id)) expect(Object.values(BACKED_PAIRS).map(p => p.bg)).toContain(el.color);
    }
  });
  it('backed words keep >= 0.3 x their size of margin inside the backing (vertical) and >= 0.22 x horizontally', async () => {
    const r = await composeKinetic(input(talk(SCRIPT)));
    const spec = r.spec!;
    let checked = 0;
    for (const e of spec.events.filter(x => x.id.endsWith('.b') || x.composition === 'calloutBar')) {
      if (e.rotateDeg) continue; // measured unrotated (the backing turns with its words)
      const beat = e.id.split('-')[0]!;
      const shapes = (spec.scene ?? []).filter(el => el.kind === 'shape' && el.id.startsWith(`${beat}-`) && /-(chip|hl|bar\d)$/.test(el.id));
      const k = e.keyframes[0]!;
      for (const l of e.lines) {
        const x0 = k.x - e.block.w / 2 + l.dx, y0 = k.y - e.block.h / 2 + l.dy;
        const box = shapes.find(el => el.kind === 'shape' && el.x <= x0 && el.x + el.w >= x0 + l.w && el.y <= y0 && el.y + el.h >= y0 + l.h);
        expect(box, `"${l.text}" sits inside its backing`).toBeDefined();
        if (box && box.kind === 'shape') {
          expect(y0 - box.y).toBeGreaterThanOrEqual(0.3 * l.fontPx - 1);
          expect(box.y + box.h - (y0 + l.h)).toBeGreaterThanOrEqual(0.3 * l.fontPx - 1);
          expect(Math.min(x0 - box.x, box.x + box.w - (x0 + l.w))).toBeGreaterThanOrEqual(0.22 * l.fontPx - 1);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
  it('a contrast beat never draws a strike line (no line shapes from contrastSplit)', async () => {
    for (const script of [SCRIPT, CALM]) {
      const r = await composeKinetic(input(talk(script)));
      const vsBeats = new Set(r.spec!.events.filter(e => e.composition === 'contrastSplit').map(e => e.id.split('-')[0]));
      expect(r.spec!.scene?.some(el => el.kind === 'shape' && (el.id.endsWith('-strike') || (el.shape === 'line' && vsBeats.has(el.id.split('-')[0])))) ?? false).toBe(false);
    }
  });
  it('no underlines anywhere, and the bars of a callout are one per row with one shared height', async () => {
    for (const script of [SCRIPT, CALM]) {
      const r = await composeKinetic(input(talk(script)));
      expect(r.spec!.scene?.some(el => el.kind === 'shape' && (el.shape === 'underline' || el.id.endsWith('-ul'))) ?? false).toBe(false);
      const bars = (r.spec!.scene ?? []).filter(el => el.kind === 'shape' && /-bar\d+$/.test(el.id)) as Array<{id: string; h: number; y: number}>;
      const byBeat = new Map<string, Array<{h: number; y: number}>>();
      for (const b of bars) byBeat.set(b.id.split('-')[0]!, [...(byBeat.get(b.id.split('-')[0]!) ?? []), b]);
      for (const bs of byBeat.values()) {
        expect(new Set(bs.map(b => Math.round(b.h))).size).toBe(1);
        // no two bars side by side on one row
        for (let i = 0; i < bs.length; i += 1) for (let j = i + 1; j < bs.length; j += 1) expect(Math.abs(bs[i]!.y - bs[j]!.y)).toBeGreaterThan(bs[i]!.h * 0.5);
      }
    }
  });
  it('a highlighter / chip draws on with its word, never as an empty box before the word arrives', async () => {
    let checked = 0;
    for (const script of [SCRIPT, CALM]) {
      const r = await composeKinetic(input(talk(script)));
      for (const el of r.spec!.scene ?? []) {
        if (el.kind !== 'shape' || !/-(hl|chip)$/.test(el.id)) continue;
        const ev = r.spec!.events.find(e => e.id === `${el.id.split('-')[0]}-${el.id.endsWith('-hl') ? 'mark' : 'list'}.b`)!;
        const wordIn = ev.inFrame + Math.min(...ev.lines.map(l => l.enterFrame));
        const drawStart = el.keys.find(k => (k as {progress?: number}).progress! > 0)?.frame ?? el.inFrame;
        expect(drawStart).toBeGreaterThanOrEqual(wordIn - 3);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
  it('words never print over each other: a line that replaces another enters only after it has left, and the verifier refuses an overlap', async () => {
    for (const script of [SCRIPT, CALM]) {
      const r = await composeKinetic(input(talk(script)));
      expect(r.spec).not.toBeNull();
      expect(r.report.violations.filter(v => v.rule === 'word-collision')).toEqual([]);
    }
    const r = await composeKinetic(input(talk(SCRIPT)));
    const spec = structuredClone(r.spec!);
    const e = spec.events.find(x => x.lines.length >= 2)!;
    // force two words onto the same spot for their whole life
    e.lines[1]!.dx = e.lines[0]!.dx; e.lines[1]!.dy = e.lines[0]!.dy;
    e.lines[1]!.wordKeyframes = e.lines[0]!.wordKeyframes;
    expect(verifyComposed(spec, r.debug!.scene, [{id: 'shot-0', startFrame: 0, endFrame: spec.durationInFrames}]).some(v => v.rule === 'word-collision')).toBe(true);
  });
  it('the edit visibly moves: >= 5 entries, >= 3 exits, side flips, angled type, the gate is reported', async () => {
    const r = await composeKinetic(input(talk(SCRIPT)));
    const m = r.report.motion!;
    expect(m.ok).toBe(true);
    expect(m.enterDistinct).toBeGreaterThanOrEqual(5);
    expect(m.exitDistinct).toBeGreaterThanOrEqual(3);
    expect(m.dirFlips).toBeGreaterThanOrEqual(2);
    expect(m.angled).toBeGreaterThanOrEqual(2);
    // the slant is a PERSPECTIVE turn (type recedes / comes out): rotateY both ways, a short perspective, and never an in-plane rotation
    const yaws = r.spec!.events.map(e => e.keyframes[0]!.rotateY);
    expect(yaws.some(y => y >= 12) && yaws.some(y => y <= -12)).toBe(true);
    expect(r.spec!.events.filter(e => Math.abs(e.keyframes[0]!.rotateY) >= 12).every(e => e.perspectivePx <= 1200)).toBe(true);
    expect(r.spec!.events.every(e => !e.rotateDeg)).toBe(true);
    // words enter from the left AND from the right
    const dirs = new Set(r.spec!.events.flatMap(e => e.notes.filter(n => n.startsWith('dir:'))));
    expect(dirs).toEqual(new Set(['dir:-1', 'dir:1']));
  });
  it('with a usable matte a high-impact word sits behind the speaker and the verifier accepts it; without one, everything is in front', async () => {
    // synthetic matte: head ellipse + torso inside the speaker box, 32 x 56 grid
    const cols = 32, rows = 56, bytes = new Uint8Array(cols * rows);
    for (let j = 0; j < rows; j += 1) for (let i = 0; i < cols; i += 1) {
      const x = (i + 0.5) / cols, y = (j + 0.5) / rows;
      const head = ((x - 0.5) / 0.11) ** 2 + ((y - 0.4) / 0.08) ** 2 <= 1;
      const torso = y >= 0.47 && x >= 0.22 && x <= 0.78;
      bytes[j * cols + i] = head || torso ? 255 : 0;
    }
    const grid = {cols, rows, samples: [{frame: 0, bits: Buffer.from(bytes).toString('base64')}]};
    const hype = 'This is the secret nobody tells you! Viral growth is easy. Stop posting random videos. Start posting with a plan. That is how you win big! Follow for more.';
    const r = await composeKinetic({...input(talk(hype)), matte: {grid, alphaAreaFrac: 0.42}});
    expect(r.spec).not.toBeNull();
    expect(r.spec!.noMatte).toBe(false);
    expect(r.report.motion!.behind).toBeGreaterThanOrEqual(1);
    expect(verifyComposed(r.spec!, r.debug!.scene, [{id: 'shot-0', startFrame: 0, endFrame: r.spec!.durationInFrames}])).toEqual([]);
    const front = await composeKinetic(input(talk(hype)));
    expect(front.spec!.events.every(e => e.layering === 'front')).toBe(true);
  });
});

describe('Kinetic Composer: one slant per frame', () => {
  it('events on screen together share one turn; a chip / highlighter beat is flat; every slanted event is a single row', async () => {
    for (const script of [SCRIPT, CALM]) {
      const r = await composeKinetic(input(talk(script)));
      expect(r.spec).not.toBeNull();
      const evs = r.spec!.events.filter(e => e.composition);
      expect(slantViolations(evs)).toEqual([]);
      for (const e of evs) {
        const yaw = e.keyframes[0]!.rotateY, pitch = e.keyframes[0]!.rotateX;
        if (yaw || pitch) expect(rowsOf(e.lines).length).toBe(1);
        // a beat with backed words (chip / highlighter) is flat: its plain words too
        const beat = e.id.split('-')[0];
        if (evs.some(x => x.id.split('-')[0] === beat && x.id.endsWith('.b'))) expect([yaw, pitch]).toEqual([0, 0]);
      }
      // the rows of one slanted treatment carry the same yaw / pitch
      const parts = evs.filter(e => /\.r\d+$/.test(e.id));
      for (const p of parts) { const main = evs.find(e => e.id === p.id.replace(/\.r\d+$/, ''))!; expect(p.keyframes[0]!.rotateY).toBe(main.keyframes[0]!.rotateY); expect(p.keyframes[0]!.rotateX).toBe(main.keyframes[0]!.rotateX); }
    }
  });
  it('the verifier refuses a multi-row block turned about one centre, and two slants on screen at once', async () => {
    const r = await composeKinetic(input(talk(SCRIPT)));
    const spec = structuredClone(r.spec!);
    const multi = spec.events.find(e => e.composition && e.composition !== 'captionLane' && rowsOf(e.lines).length >= 2)!;
    multi.keyframes = multi.keyframes.map(k => ({...k, rotateY: 30}));
    expect(slantViolations(spec.events).some(v => v.rule === 'slant-rows')).toBe(true);
    const a = {...spec.events.find(e => e.composition === 'captionLane')!};
    const b = {...a, id: `${a.id}.b`, keyframes: a.keyframes.map(k => ({...k, rotateY: -30}))};
    expect(slantViolations([a, b]).some(v => v.rule === 'slant-mixed')).toBe(true);
  });
});

describe('Kinetic Composer: AI-chosen colours (POLISH_KINETIC_AI_PALETTE)', () => {
  const colours = (spec: RenderSpec) => new Set(spec.events.flatMap(e => e.lines.flatMap(l => l.fill.colors.map(c => c.toUpperCase()))));
  it('the Director picks a curated palette for the footage; unknown names are ignored', () => {
    const w = toKineticWords(talk(SCRIPT), 30);
    const beats = analyzeBeats(w, 30);
    const base = deterministicDirection(w, beats);
    expect(mergeDirector({tone: 'business', palette: 'Electric'}, base, beats).palette).toBe('electric');
    expect(mergeDirector({tone: 'business', palette: 'neon-rainbow'}, base, beats).palette).toBeUndefined();
    expect(mergeDirector({tone: 'business', palette: 'preset'}, base, beats).palette).toBeUndefined();
  });
  it('on: the edit uses the chosen palette and the Director saw the footage colour; off: the preset colours exactly, whatever the Director says', async () => {
    const prompts: string[] = [];
    const director = async (p: {system: string; user: string}) => { prompts.push(p.user); return JSON.stringify({tone: 'business', palette: 'electric'}); };
    const on = await composeKinetic({...input(talk(SCRIPT)), director, aiPalette: true});
    expect(on.spec).not.toBeNull();
    expect(on.report.direction.palette).toBe('electric');
    expect(prompts[0]).toContain('#33404f');
    expect(prompts[0]).toContain('palette');
    const c = colours(on.spec!);
    expect(c.has('#3DE8FF')).toBe(true);
    expect(c.has('#FFD400')).toBe(false);
    prompts.length = 0;
    const off = await composeKinetic({...input(talk(SCRIPT)), director});
    expect(off.spec).not.toBeNull();
    expect(off.report.direction.palette).toBeUndefined();
    expect(prompts[0]).not.toContain('palette');
    expect(colours(off.spec!).has('#3DE8FF')).toBe(false);
  });
});

describe('Kinetic Composer: contracts', () => {
  it('a pre-composer spec parses exactly as before (no scene, no composition keys added)', async () => {
    const r = await composeKinetic(input(talk(SCRIPT)));
    const old = {...r.spec!, events: r.spec!.events.map(({composition: _c, rotateDeg: _r, ...e}) => e)} as Record<string, unknown>;
    delete old.scene;
    const parsed = renderSpecSchema.parse(old);
    expect('scene' in parsed).toBe(false);
    expect(parsed.events.every(e => !('composition' in e))).toBe(true);
    expect(parsed.events.every(e => !('rotateDeg' in e))).toBe(true);
  });
  it('B-roll windows drop the composer scene elements with the type', async () => {
    const r = await composeKinetic(input(talk(SCRIPT)));
    const spec = r.spec!;
    const el = spec.scene!.find(x => x.kind === 'shape' || x.kind === 'plate')!;
    const split = splitKineticSpecForBroll(spec, [{start: el.inFrame / 30, end: el.outFrame / 30}]);
    expect(split.spec.scene!.some(x => x.id === el.id)).toBe(false);
  });
  it('variety metrics rank a caption-only edit far below the composed edit', async () => {
    const r = await composeKinetic(input(talk(SCRIPT)));
    const captionOnly: RenderSpec = {...r.spec!, events: r.spec!.events.filter(e => e.composition === 'captionLane'), scene: []};
    expect(measureVariety(captionOnly).varietyScore).toBeLessThan(measureVariety(r.spec!).varietyScore - 25);
  });
});

describe('Kinetic Composer: pipeline stage (P9)', () => {
  const base = {
    captionWords: talk(SCRIPT), fps: 30, width: 1080, height: 1920, durationSec: talk(SCRIPT).at(-1)!.end + 0.5,
    speaker: {box: BOX, source: 'vision' as const}, sourceSize: {width: 1080, height: 1920}, zoomTriggers: [], zoomEnabled: true, allowThreeD: false, director: null,
  };
  it('composer on: the composer owns the edit and hands back its zooms', async () => {
    const out = await runKineticEngineStage({...base, composer: true});
    expect(out.spec).not.toBeNull();
    expect(out.composer?.zoomTriggers).toBeDefined();
    expect(out.warnings).toContain('kinetic_composer:on');
    expect(out.warnings.some(w => w.startsWith('kinetic_composer:variety:score='))).toBe(true);
  });
  it('composer off (default): the V2 engine exactly as before', async () => {
    const out = await runKineticEngineStage(base);
    expect(out.composer).toBeUndefined();
    expect(out.warnings.some(w => w.startsWith('kinetic_composer'))).toBe(false);
  });
});

describe('Kinetic Composer: 2026-11-25 fixes (aicut.mp4 review)', () => {
  it('every spoken word is shown: a designed beat that cannot draw its lead-in / tail hands those words to the caption lane', async () => {
    for (const text of [SCRIPT, CALM]) {
      const r = await composeKinetic(input(talk(text)));
      expect(r.report.failure).toBeUndefined();
      expect(r.report.coverage.voiced).toBe(0);
      expect(r.report.coverage.drawn).toBe(r.report.coverage.words);
    }
  });
  it('splitForCoverage cuts a lane range out of a beat and keeps the rest of the beat (its id and key word)', () => {
    const words = toKineticWords(talk('This person gave us a completely different way of looking at YouTube.'), 30);
    const beats = analyzeBeats(words, 30);
    const first = beats[0]!;
    const out = splitForCoverage(beats, [[first.wordRange[0], first.wordRange[0] + 2]], words);
    const lane = out.find(b => b.laneOnly)!;
    expect(lane.wordRange).toEqual([first.wordRange[0], first.wordRange[0] + 2]);
    const core = out.find(b => b.id === first.id)!;
    expect(core.wordRange[0]).toBe(first.wordRange[0] + 3);
    expect(core.laneOnly).toBeUndefined();
    // nothing lost, nothing doubled
    const covered = out.flatMap(b => Array.from({length: b.wordRange[1] - b.wordRange[0] + 1}, (_, k) => b.wordRange[0] + k));
    expect(covered).toEqual(words.map(w => w.idx));
  });
  it('slanted rows of different sizes keep a gap ON SCREEN after the turn (the "US A COMPLETELY / DIFFERENT" frame)', () => {
    // the two rows of the real edit: a 74 px row over a 167 px row, 10 px apart flat, yaw -28.8
    const kf = (x: number, y: number) => [{frame: 0, x, y, scale: 1, opacity: 1, rotateX: 0, rotateY: -28.8, blurPx: 0, z: 0}, {frame: 77, x, y: y - 4, scale: 1.045, opacity: 1, rotateX: 0, rotateY: -28.8, blurPx: 0, z: 0}];
    const ev = (id: string, w: number, h: number, persp: number, y: number) => ({id, composition: 'giantWord', presetResolved: 'type.words', inFrame: 0, outFrame: 77, perspectivePx: persp, block: {w, h}, lines: [{text: id, dx: 0, dy: 0, w, h}], keyframes: kf(511, y), notes: []}) as unknown as RenderSpec['events'][number];
    const upper = ev('b0-giant', 510.92, 74.1, 665, 1315.75), lower = ev('b0-giant.r1', 622.64, 166.84, 950, 1445.83);
    expect(projectedRowGap(upper, lower)).toBeLessThan(0); // they overlap once turned
    expect(slantViolations([upper, lower]).map(v => v.rule)).toContain('slant-row-gap');
    const [u, d] = spaceRows([upper, lower]);
    expect(projectedRowGap(u!, d!)).toBeGreaterThanOrEqual(rowGapPx(74.1, 166.84));
    expect(slantViolations([u!, d!])).toEqual([]);
    // the block stays centred where it was
    expect((u!.keyframes[0]!.y + d!.keyframes[0]!.y) / 2).toBeCloseTo((upper.keyframes[0]!.y + lower.keyframes[0]!.y) / 2, 0);
  });
  it('the Director may suggest text-behind beats and ONE match cut; unknown beats and invented keywords are dropped', () => {
    const words = toKineticWords(talk(SCRIPT), 30);
    const beats = analyzeBeats(words, 30);
    const base = deterministicDirection(words, beats);
    const ok = mergeDirector({tone: 'hype', behind: [beats[1]!.id, 'nope'], matchCut: {beat: beats[1]!.id, keyword: words[beats[1]!.wordRange[0]]!.text, moment: 'openingHook', why: 'topic'}}, base, beats, words, {behind: true, matchCut: true});
    expect(ok.behindBeats).toEqual([beats[1]!.id]);
    expect(ok.matchCut?.beatId).toBe(beats[1]!.id);
    const invented = mergeDirector({tone: 'hype', matchCut: {beat: beats[1]!.id, keyword: 'banana', moment: 'openingHook'}}, base, beats, words, {behind: true, matchCut: true});
    expect(invented.matchCut).toBeUndefined();
    // not offered = ignored
    const off = mergeDirector({tone: 'hype', behind: [beats[1]!.id], matchCut: {beat: beats[1]!.id, keyword: words[beats[1]!.wordRange[0]]!.text, moment: 'openingHook'}}, base, beats, words);
    expect(off.behindBeats).toBeUndefined();
    expect(off.matchCut).toBeUndefined();
  });
  it('a Director match cut is never forced: a "secret" setup on the last line (no reveal after it) is refused; with a reveal sentence after it, it is accepted', () => {
    const shots = (w: ReturnType<typeof toKineticWords>) => [{id: 'shot-0', startFrame: 0, endFrame: w[w.length - 1]!.endFrame + 30}];
    const last = toKineticWords(talk('He studied every video for years and learned what works. His biggest secret was never the money.'), 30);
    const lastIdx = last.findIndex(w => normToken(w.text) === 'secret');
    expect(directorMatchCut(last, shots(last), 30, {beatRange: [lastIdx - 2, last.length - 1], keyword: 'secret', moment: 'beforeReveal'}).event).toBeNull();
    const reveal = toKineticWords(talk('He studied every video for years and learned what works. Here is the real secret behind his growth. He tested every single thumbnail with real viewers first.'), 30);
    const k = reveal.findIndex(w => normToken(w.text) === 'secret');
    const got = directorMatchCut(reveal, shots(reveal), 30, {beatRange: [k - 4, k + 3], keyword: 'secret', moment: 'beforeReveal'});
    expect(got.event?.preset).toBe('type.matchCut');
    // a keyword that is not spoken in the beat is refused
    expect(directorMatchCut(reveal, shots(reveal), 30, {beatRange: [k - 4, k + 3], keyword: 'money', moment: 'beforeReveal'}).event).toBeNull();
  });
  it('the Director is asked ONCE per edit even when the composer re-solves (punch-ins, motion gate, coverage)', async () => {
    let calls = 0;
    const director = async () => { calls += 1; return JSON.stringify({tone: 'hype', toolkit: ['giantWord', 'wordSwap', 'heroStack', 'sideStack']}); };
    const r = await composeKinetic({...input(talk(SCRIPT)), director});
    expect(r.spec).not.toBeNull();
    expect(calls).toBe(1);
  });
});
