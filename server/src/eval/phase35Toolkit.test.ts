import {describe, expect, it} from 'vitest';

import {layoutCurvedText} from '../../../remotion/src/motion/curvedText';
import {decideTextBehindSubject, regionClipPath, revealClipPath} from '../../../remotion/src/motion/masks';
import * as Motion from '../../../remotion/src/motion';

// A fixed-width measurer: 0.6 em per character. Deterministic, so the geometry assertions do not depend on a browser font.
const measure = (text: string, size: number) => text.length * size * 0.6;
const base = {width: 1000, height: 600, measure, margin: 24};

describe('layoutCurvedText', () => {
  it('keeps an arc inside the box margins and shrinks long text instead of clipping', () => {
    const short = layoutCurvedText({...base, text: 'HOOK', curvature: 0.5, fontSize: 90});
    expect(short.clipped).toBe(false);
    expect(short.shrunk).toBe(false);
    const long = layoutCurvedText({...base, text: 'THIS IS A MUCH LONGER HEADLINE THAN FITS', curvature: 0.5, fontSize: 120});
    expect(long.shrunk).toBe(true);
    expect(long.clipped).toBe(false);
    for (const l of [short, long]) {
      expect(l.bbox.x).toBeGreaterThanOrEqual(23.5);
      expect(l.bbox.y).toBeGreaterThanOrEqual(23.5);
      expect(l.bbox.x + l.bbox.width).toBeLessThanOrEqual(1000 - 23.5);
      expect(l.bbox.y + l.bbox.height).toBeLessThanOrEqual(600 - 23.5);
      expect(l.textLength).toBeLessThanOrEqual(l.pathLength * 0.98);
    }
  });

  it('arch curves up and bowl curves down (sweep flag), and 0 is a straight line', () => {
    expect(layoutCurvedText({...base, text: 'ARCH', curvature: 0.6}).pathD).toMatch(/ A .* 0 0 1 /);
    expect(layoutCurvedText({...base, text: 'BOWL', curvature: -0.6}).pathD).toMatch(/ A .* 0 0 0 /);
    expect(layoutCurvedText({...base, text: 'LINE', curvature: 0}).pathD).toMatch(/ L /);
  });

  it('flags text that cannot be made legible rather than hiding it', () => {
    const tiny = layoutCurvedText({...base, width: 200, height: 120, text: 'AN EXTREMELY LONG LINE OF TEXT FOR A TINY BOX', curvature: 0.5, minFontSize: 28});
    expect(tiny.legible).toBe(false);
  });

  it('accounts for rotation in the bounds', () => {
    const flat = layoutCurvedText({...base, text: 'ROTATE ME', curvature: 0.3, fontSize: 80});
    const turned = layoutCurvedText({...base, text: 'ROTATE ME', curvature: 0.3, fontSize: 80, rotationDeg: 12});
    expect(turned.bbox.height).toBeGreaterThan(flat.bbox.height);
    expect(turned.clipped).toBe(false);
  });

  it('draws a full ring, outside for clockwise and inside for counter-clockwise', () => {
    const outside = layoutCurvedText({...base, text: 'RING TEXT', shape: 'circle', direction: 'clockwise', fontSize: 60});
    const inside = layoutCurvedText({...base, text: 'RING TEXT', shape: 'circle', direction: 'counterclockwise', fontSize: 60});
    expect(outside.pathD).toMatch(/A .* 1 1 /);
    expect(inside.pathD).toMatch(/A .* 1 0 /);
    expect(outside.clipped).toBe(false);
    expect(inside.clipped).toBe(false);
  });

  it('follows custom points (smooth curve) and ignores a path with fewer than two points', () => {
    const wave = layoutCurvedText({...base, text: 'WAVE', shape: 'path', points: [{x: 60, y: 300}, {x: 300, y: 200}, {x: 600, y: 400}, {x: 940, y: 300}], fontSize: 60});
    expect(wave.pathD.startsWith('M 60 300 C')).toBe(true);
    expect(wave.pathLength).toBeGreaterThan(880);
    const fallback = layoutCurvedText({...base, text: 'WAVE', shape: 'path', points: [{x: 1, y: 1}], fontSize: 60});
    expect(fallback.pathD).toContain('M 24 300');
  });

  it('a path with a bend tighter than the glyphs, and a bowl or inside ring too small for them, is flagged not legible', () => {
    const zigzag = layoutCurvedText({...base, text: 'WAVE', shape: 'path', points: [{x: 30, y: 280}, {x: 110, y: 120}, {x: 190, y: 280}, {x: 270, y: 120}, {x: 350, y: 280}], fontSize: 60, minFontSize: 56});
    expect(zigzag.legible).toBe(false);
    const gentle = layoutCurvedText({...base, text: 'WAVE', shape: 'path', points: [{x: 60, y: 300}, {x: 300, y: 240}, {x: 600, y: 360}, {x: 940, y: 300}], fontSize: 60});
    expect(gentle.legible).toBe(true);
    const smallBowl = layoutCurvedText({...base, width: 300, height: 300, text: 'ABC', curvature: -1, fontSize: 200, minFontSize: 180});
    expect(smallBowl.legible).toBe(false);
  });

  it('alignment sets the text-path offset and anchor', () => {
    expect(layoutCurvedText({...base, text: 'A', align: 'start'})).toMatchObject({startOffset: 0, textAnchor: 'start'});
    expect(layoutCurvedText({...base, text: 'A', align: 'end'})).toMatchObject({startOffset: 1, textAnchor: 'end'});
    expect(layoutCurvedText({...base, text: 'A'})).toMatchObject({startOffset: 0.5, textAnchor: 'middle'});
  });
});

describe('masks', () => {
  it('reveal clip-paths start hidden, end with no clip, and are monotonic', () => {
    for (const kind of Motion.MASK_REVEAL_KINDS) {
      expect(revealClipPath(kind, 1, 800, 400)).toBe('inset(0% 0% 0% 0%)');
      expect(revealClipPath(kind, 0, 800, 400)).not.toBe('inset(0% 0% 0% 0%)');
    }
    expect(revealClipPath('wipe-right', 0.25, 800, 400)).toBe('inset(0% 75% 0% 0%)');
    expect(revealClipPath('iris', 0.5, 300, 400)).toBe('circle(125px at 50% 50%)');
  });

  it('region clip-paths cover each shape', () => {
    const r = {x: 10, y: 20, width: 200, height: 100};
    expect(regionClipPath({...r, shape: 'rect'})).toContain('polygon(');
    expect(regionClipPath({...r, shape: 'circle'})).toContain('circle(50px');
    expect(regionClipPath({...r, shape: 'capsule'})).toContain('round 50px');
    expect(regionClipPath({...r, shape: 'rounded', radius: 12})).toContain('round 12px');
  });

  it('subject-aware text is allowed only with a usable matte and a clear face', () => {
    expect(decideTextBehindSubject({maskAvailable: true, matteUsable: true})).toEqual({mode: 'behind_subject', basis: 'alpha_video'});
    expect(decideTextBehindSubject({maskAvailable: false, matteUsable: false})).toMatchObject({mode: 'fallback', reason: 'no_foreground_matte'});
    expect(decideTextBehindSubject({maskAvailable: true, matteUsable: false})).toMatchObject({reason: 'matte_unusable'});
    expect(decideTextBehindSubject({maskAvailable: true, matteUsable: true, textOverlapsFace: true})).toMatchObject({reason: 'text_would_cover_face'});
  });

  it('the new primitives are exported to generated graphics', () => {
    for (const name of ['CurvedText', 'MaskReveal', 'ClipWindow', 'LayeredText', 'layoutCurvedText', 'regionClipPath', 'revealClipPath']) {
      expect(typeof (Motion as Record<string, unknown>)[name]).toBe('function');
    }
  });
});

import {assembleDirectedGraphics} from '../stages/motionDirector/motionDirector';
import {buildGenerationPrompt} from '../motionWorker/prompt';
import {DEFAULT_CANVAS} from '../motionWorker/brief';
import {MASK_REVEAL_KINDS, decideTextTreatment, textTreatmentSchema, visibleFractionBehindSubject} from '../stages/textTreatment/textTreatment';

describe('text treatment requests', () => {
  const words = Array.from({length: 40}, (_, i) => ({text: `w${i}`, start: i * 0.5, end: i * 0.5 + 0.4}));
  const input = {words, outputDurationSec: 20, occupied: [], maxGraphics: 3};
  const raw = (textTreatment: unknown) => ({graphics: [{id: 'badge', anchorWordIndex: 4, durationSeconds: 3, reason: 'r', goal: 'g', visualDescription: 'v', placement: 'full_screen', contentJson: '{"title":"BONUS"}', textTreatment}]});

  it('the server and the toolkit agree on the reveal kinds', async () => {
    const Motion = await import('../../../remotion/src/motion');
    expect([...MASK_REVEAL_KINDS]).toEqual([...Motion.MASK_REVEAL_KINDS]);
  });

  it('a curved request survives assembly (nulls from the model stripped) and reaches the Claude prompt as a required instruction', () => {
    const result = assembleDirectedGraphics(raw({kind: 'curved', text: 'BONUS', curve: {shape: 'arc', curvature: 0.5, direction: 'clockwise', align: 'center', rotationDeg: -6}, reveal: null, centerY: null, widthFrac: null}), input);
    expect(result.refusals).toEqual([]);
    const brief = result.graphics[0]!.brief;
    expect(brief.textTreatment).toMatchObject({kind: 'curved', text: 'BONUS', curve: {curvature: 0.5, rotationDeg: -6}});
    const prompt = buildGenerationPrompt(brief, DEFAULT_CANVAS);
    expect(prompt).toContain('TEXT TREATMENT (required)');
    expect(prompt).toContain('<CurvedText shape="arc" curvature={0.5}');
  });

  it('a request without a treatment leaves the prompt exactly as before', () => {
    const brief = assembleDirectedGraphics(raw(null), input).graphics[0]!.brief;
    expect(brief.textTreatment).toBeUndefined();
    expect(buildGenerationPrompt(brief, DEFAULT_CANVAS)).not.toContain('TEXT TREATMENT');
  });

  it('invalid treatments are refused with the reason, never repaired silently', () => {
    expect(assembleDirectedGraphics(raw({kind: 'curved', text: 'X'}), input).refusals[0]!.reason).toContain('curve');
    expect(assembleDirectedGraphics(raw({kind: 'mask_reveal', text: 'X'}), input).refusals[0]!.reason).toContain('reveal');
    expect(assembleDirectedGraphics(raw({kind: 'layered', text: 'A'.repeat(41)}), input).refusals).toHaveLength(1);
    expect(textTreatmentSchema.safeParse({kind: 'spin', text: 'X'}).success).toBe(false);
  });

  it('behind_subject is honoured only with a usable matte and a mostly visible text; otherwise it is downgraded and says so', () => {
    const t = textTreatmentSchema.parse({kind: 'behind_subject', text: 'FOCUS', centerY: 0.3, widthFrac: 0.9});
    const ctx = {start: 1, end: 4, reason: 'r', behindColors: {color: '#FFFFFF', strokeColor: '#000000'}};
    const none = decideTextTreatment(t, {...ctx, matteUsable: false});
    expect(none).toMatchObject({route: 'toolkit', downgradedFrom: 'behind_subject'});
    expect(none.note).toContain('not depth-aware');
    expect(none.route === 'toolkit' && none.treatment.kind).toBe('layered');
    const yes = decideTextTreatment(t, {...ctx, matteUsable: true, speakerBox: {x: 0.3, y: 0.5, w: 0.4, h: 0.5}});
    expect(yes.route).toBe('behind_subject_track');
    const noColours = decideTextTreatment(t, {...ctx, matteUsable: true, behindColors: null, speakerBox: {x: 0.3, y: 0.5, w: 0.4, h: 0.5}});
    expect(noColours).toMatchObject({route: 'toolkit', downgradedFrom: 'behind_subject'});
    expect(noColours.note).toContain('no_safe_text_colour');
    expect(yes.route === 'behind_subject_track' && yes.entry).toMatchObject({color: '#FFFFFF', strokeColor: '#000000'});
    const hidden = decideTextTreatment(t, {...ctx, matteUsable: true, speakerBox: {x: 0.02, y: 0.1, w: 0.96, h: 0.5}});
    expect(hidden).toMatchObject({route: 'toolkit', downgradedFrom: 'behind_subject'});
    expect(visibleFractionBehindSubject({centerY: 0.3, widthFrac: 0.9, heightFrac: 0.2}, {x: 0.3, y: 0.5, w: 0.4, h: 0.5})).toBe(1);
    expect(non_behind(decideTextTreatment(textTreatmentSchema.parse({kind: 'layered', text: 'X'}), {...ctx, matteUsable: true}))).toBe('toolkit');
  });
});

const non_behind = (d: {route: string}) => d.route;
