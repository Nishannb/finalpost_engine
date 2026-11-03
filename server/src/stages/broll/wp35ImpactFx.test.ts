/**
 * WP35: Metromedia impact FX + framed-card fly-out. Offline: no render, no network, no model.
 *   1. frame math: flash 1-2 f, sat pop 2-4 f, punch-in 1.10 over 6-8 f (no overshoot), B&W hard flip, layers per frame
 *   2. planner (polishImpactFx): flash on the hook + a major reveal, sat pop on a name, punch on money holds, B&W <= 15 % and never over money / chapter cards, spacing caps
 *   3. card: white 4-6 px border, fly-out 12 deg + 3D tilt + slide bottom-right + motion blur over 6 frames, off-frame on the last frame
 *   4. wiring: schema, blueprint type, ShortVideo layers, ImageRun props, editorial runs framed, registry, publish, env, analyze gate
 *   5. the offline proof
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {impactFxSchema, timelineBlueprintSchema} from '../../../../remotion/src/blueprintSchema.ts';
import {
  CARD_BORDER_COLOR,
  CARD_BORDER_PX,
  CARD_EXIT_FRAMES,
  CARD_EXIT_ROTATE_DEG,
  CARD_AT_REST,
  cardBorderPx,
  cardExitAt,
  cardExitTransform,
  cardSequenceFrames,
} from '../../../../remotion/src/lib/cardFlyOut.ts';
import {
  BW_SHARE_TARGET,
  FLASH_FRAMES,
  PUNCH_RAMP_FRAMES,
  PUNCH_SCALE,
  SAT_POP_FRAMES,
  bwAmountAt,
  bwShare,
  flashLayerAt,
  impactLayersAt,
  popAmount,
  punchScaleAt,
  punchScaleForEvents,
  satPopLayerAt,
} from '../../../../remotion/src/lib/impactFx.ts';
import {env} from '../../config/env.ts';
import {
  IMPACT_BW_SHARE_TARGET,
  IMPACT_FLASH_FRAMES,
  IMPACT_FLASH_MIN_GAP_SEC,
  IMPACT_PUNCH_RAMP_FRAMES,
  IMPACT_PUNCH_SCALE,
  IMPACT_SAT_MIN_GAP_SEC,
  IMPACT_SAT_POP_FRAMES,
  impactFxIsEmpty,
  nameRevealTimes,
  planBwSpans,
  planImpactFx,
} from '../../lib/polishImpactFx.ts';
import {resolveLibraryGraphic} from '../motionDirector/libraryRegistry.ts';
import {ctaWindowsOf, moneyWindowsOf, planVoCutGrammar, type VoWord} from './voCutGrammar.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const fixture = JSON.parse(read('./fixtures/wp35-vo-words.json')) as {durationSec: number; words: VoWord[]};
const plan = planVoCutGrammar({words: fixture.words, durationSec: fixture.durationSec, flags: {moneyWindows: moneyWindowsOf(fixture.words), ctaWindows: ctaWindowsOf(fixture.words, fixture.durationSec)}});
const result = planImpactFx({words: fixture.words, plan, durationSec: fixture.durationSec});
const FPS = 30;

describe('WP35 1) impact frame math', () => {
  it('the grammar numbers: flash 1-2 f, sat pop 2-4 f, punch 6-8 f to 1.10, B&W share 15 %', () => {
    expect(FLASH_FRAMES).toEqual({min: 1, max: 2});
    expect(SAT_POP_FRAMES).toEqual({min: 2, max: 4});
    expect(PUNCH_RAMP_FRAMES).toEqual({min: 6, max: 8});
    expect(PUNCH_SCALE).toBe(1.1);
    expect(BW_SHARE_TARGET).toBe(0.15);
    // the server planner mirrors them
    expect(IMPACT_FLASH_FRAMES).toBeGreaterThanOrEqual(FLASH_FRAMES.min);
    expect(IMPACT_FLASH_FRAMES).toBeLessThanOrEqual(FLASH_FRAMES.max);
    expect(IMPACT_SAT_POP_FRAMES).toBeGreaterThanOrEqual(SAT_POP_FRAMES.min);
    expect(IMPACT_SAT_POP_FRAMES).toBeLessThanOrEqual(SAT_POP_FRAMES.max);
    expect(IMPACT_PUNCH_RAMP_FRAMES).toBeGreaterThanOrEqual(PUNCH_RAMP_FRAMES.min);
    expect(IMPACT_PUNCH_RAMP_FRAMES).toBeLessThanOrEqual(PUNCH_RAMP_FRAMES.max);
    expect(IMPACT_PUNCH_SCALE).toBe(PUNCH_SCALE);
    expect(IMPACT_BW_SHARE_TARGET).toBe(BW_SHARE_TARGET);
  });

  it('a pop is full on its first frame and decays; nothing outside its frames', () => {
    expect([0, 1, 2, 3].map(frame => popAmount(frame, 3))).toEqual([1, 0.667, 0.333, 0]);
    expect([0, 1].map(frame => popAmount(frame, 2))).toEqual([1, 0.5]);
    expect(popAmount(0, 1)).toBe(1);
    expect(popAmount(-1, 2)).toBe(0);
  });

  it('flash: a heavy white wash + brightness blow-out on the first frame; at most 2 frames', () => {
    const first = flashLayerAt(0, 2)!;
    expect(first.whiteOpacity).toBeGreaterThanOrEqual(0.85);
    expect(first.brightness).toBeGreaterThanOrEqual(2);
    expect(flashLayerAt(1, 2)!.whiteOpacity).toBeLessThan(first.whiteOpacity);
    expect(flashLayerAt(2, 2)).toBeNull();
    expect(flashLayerAt(-1, 2)).toBeNull();
  });

  it('saturation pop: saturate > 1.5 on the first frame, decaying to the neutral grade; 0 after its frames', () => {
    const frames = [0, 1, 2].map(frame => satPopLayerAt(frame, 3)!);
    expect(frames[0]!.saturate).toBeGreaterThanOrEqual(1.8);
    expect(frames[0]!.saturate).toBeGreaterThan(frames[1]!.saturate);
    expect(frames[1]!.saturate).toBeGreaterThan(frames[2]!.saturate);
    expect(frames[2]!.saturate).toBeGreaterThan(1);
    expect(frames[0]!.glowOpacity).toBeGreaterThan(0);
    expect(satPopLayerAt(3, 3)).toBeNull();
  });

  it('punch-in: 1 -> 1.10 over the ramp, monotonic, never above 1.10, held to the end of the window, 1 outside it', () => {
    const scales = Array.from({length: 30}, (_, frame) => punchScaleAt(frame, 30, 7));
    expect(scales[0]).toBe(1);
    for (let index = 1; index < scales.length; index += 1) expect(scales[index]).toBeGreaterThanOrEqual(scales[index - 1]!);
    expect(Math.max(...scales)).toBe(1.1);
    expect(scales[7]).toBe(1.1);
    expect(scales[29]).toBe(1.1);
    expect(punchScaleAt(30, 30, 7)).toBe(1);
    expect(punchScaleAt(-1, 30, 7)).toBe(1);
    expect(punchScaleAt(10, 30, 7, 1.5)).toBe(1.1); // a stray scale can never exceed the grammar's 1.10
  });

  it('punchScaleForEvents resolves the event window at the composition fps', () => {
    const events = [{startSec: 5.46, endSec: 7.03, rampFrames: 7, scale: 1.1}];
    expect(punchScaleForEvents(events, 163, FPS)).toBe(1);
    expect(punchScaleForEvents(events, 164, FPS)).toBe(1);
    expect(punchScaleForEvents(events, 164 + 3, FPS)).toBeGreaterThan(1.05);
    expect(punchScaleForEvents(events, 164 + 20, FPS)).toBe(1.1);
    expect(punchScaleForEvents(events, 211, FPS)).toBe(1);
    expect(punchScaleForEvents(undefined, 100, FPS)).toBe(1);
  });

  it('B&W is a hard flip (the cut is the transition), not a ramp', () => {
    const spans = [{startSec: 2, endSec: 3}];
    expect(bwAmountAt(spans, 1.999)).toBe(0);
    expect(bwAmountAt(spans, 2)).toBe(1);
    expect(bwAmountAt(spans, 2.999)).toBe(1);
    expect(bwAmountAt(spans, 3)).toBe(0);
    expect(bwShare([{startSec: 0, endSec: 1}, {startSec: 0.5, endSec: 2}], 20)).toBe(0.1);
  });

  it('impactLayersAt: nothing without fx; the right layer on the right frame', () => {
    const fx = {flashes: [{startSec: 1, frames: 2, reason: 'hook_word' as const}], satPops: [{startSec: 2, frames: 3}], punchIns: [], bwSpans: [{startSec: 3, endSec: 4}]};
    expect(impactLayersAt(undefined, 30, FPS)).toEqual({flash: null, satPop: null, bw: false});
    expect(impactLayersAt(fx, 29, FPS).flash).toBeNull();
    expect(impactLayersAt(fx, 30, FPS).flash).not.toBeNull();
    expect(impactLayersAt(fx, 31, FPS).flash).not.toBeNull();
    expect(impactLayersAt(fx, 32, FPS).flash).toBeNull();
    expect(impactLayersAt(fx, 60, FPS).satPop).not.toBeNull();
    expect(impactLayersAt(fx, 63, FPS).satPop).toBeNull();
    expect(impactLayersAt(fx, 90, FPS).bw).toBe(true);
    expect(impactLayersAt(fx, 120, FPS).bw).toBe(false);
  });
});

describe('WP35 2) planner on the faceless fixture', () => {
  it('plans a hook flash and a major-reveal flash, both on a cut frame', () => {
    const [hook, reveal] = result.fx.flashes;
    expect(hook).toMatchObject({reason: 'hook_word', frames: IMPACT_FLASH_FRAMES});
    expect(hook!.startSec).toBe(plan.groups[0]!.start);
    expect(reveal).toMatchObject({reason: 'major_reveal'});
    expect(plan.holds.some(hold => hold.reason === 'money' && hold.start === reveal!.startSec)).toBe(true);
    for (const flash of result.fx.flashes) expect(flash.frames).toBeLessThanOrEqual(2);
  });

  it('flashes are spaced (>= 3 s) and capped at one per 6 s', () => {
    const times = result.fx.flashes.map(flash => flash.startSec);
    for (let index = 1; index < times.length; index += 1) expect(times[index]! - times[index - 1]!).toBeGreaterThanOrEqual(IMPACT_FLASH_MIN_GAP_SEC);
    expect(times.length).toBeLessThanOrEqual(Math.ceil(fixture.durationSec / 6));
  });

  it('a saturation pop lands on the spoken name, never on a sentence start, clear of a flash', () => {
    expect(nameRevealTimes(fixture.words)).toEqual([1.78]); // "Alex" (the run start); "In", "Investors", "Everyone", "But", "He", "Follow" start sentences
    expect(result.fx.satPops).toEqual([{startSec: 1.78, frames: 3}]);
    for (const pop of result.fx.satPops) for (const flash of result.fx.flashes) expect(Math.abs(pop.startSec - flash.startSec)).toBeGreaterThanOrEqual(0.4);
    const names = nameRevealTimes([
      {text: 'Then', start: 0, end: 0.3},
      {text: 'Steve', start: 0.4, end: 0.7},
      {text: 'Jobs', start: 0.75, end: 1},
      {text: 'met', start: 1.1, end: 1.3},
      {text: 'Wozniak.', start: 1.4, end: 1.8},
      {text: 'In', start: 1.9, end: 2},
      {text: 'March', start: 2.1, end: 2.4},
    ]);
    expect(names).toEqual([0.4, 1.4]); // a run counts once; the sentence start "In" and the month "March" are not names
    expect(IMPACT_SAT_MIN_GAP_SEC).toBeGreaterThanOrEqual(2.5);
  });

  it('the money hold is punched in (1.10 over 7 frames) for exactly the hold, and that is the only punch', () => {
    const money = plan.holds.filter(hold => hold.reason === 'money');
    expect(result.fx.punchIns).toEqual(money.map(hold => ({startSec: hold.start, endSec: hold.end, rampFrames: 7, scale: 1.1})));
    expect(money.length).toBeGreaterThan(0);
  });

  it('B&W is denser than the old 1-per-20 s grade (<= 2 beats) yet never over 15 %, a money hold or a chapter card', () => {
    const spans = result.fx.bwSpans;
    expect(spans.length).toBeGreaterThanOrEqual(2);
    expect(bwShare(spans, fixture.durationSec)).toBeLessThanOrEqual(0.15 + 1e-6);
    expect(bwShare(spans, fixture.durationSec)).toBeGreaterThan(0.08);
    for (const span of spans) {
      for (const hold of plan.holds.filter(item => item.reason === 'money')) expect(span.startSec < hold.end && span.endSec > hold.start).toBe(false);
      for (const card of plan.chapterCards) expect(span.startSec < card.at + card.duration && span.endSec > card.at).toBe(false);
      expect(span.endSec - span.startSec).toBeGreaterThanOrEqual(0.7);
    }
    // sorted, non-overlapping, on shot edges
    const edges = new Set(plan.shots.flatMap(shot => [shot.start, shot.end]));
    spans.forEach((span, index) => {
      if (index > 0) expect(span.startSec).toBeGreaterThanOrEqual(spans[index - 1]!.endSec);
      expect(edges.has(span.startSec)).toBe(true);
    });
  });

  it('strong emotional words (collapsed / cold / fired) are taken before a bare year token', () => {
    const emotional = ['cold', 'collapsed'].map(text => fixture.words.find(word => word.text.toLowerCase().startsWith(text))!);
    for (const word of emotional) expect(result.fx.bwSpans.some(span => word.start >= span.startSec && word.start < span.endSec)).toBe(true);
    const tight = planBwSpans(fixture.words, plan, 5); // a 5 s budget (0.75 s) fits no 0.8 s span: nothing is taken
    expect(bwShare(tight, 5)).toBeLessThanOrEqual(0.15 + 1e-6);
  });

  it('is deterministic, reports warnings, and an unusable input draws nothing', () => {
    expect(planImpactFx({words: fixture.words, plan, durationSec: fixture.durationSec})).toEqual(result);
    expect(result.warnings).toEqual([`polish_impact:flash:${result.fx.flashes.length}`, `polish_impact:sat_pop:${result.fx.satPops.length}`, `polish_impact:punch_in:${result.fx.punchIns.length}`, expect.stringMatching(/^polish_impact:bw:\d+:0\.\d\d$/)]);
    const empty = planImpactFx({words: [], plan: {...plan, groups: []}, durationSec: 1});
    expect(impactFxIsEmpty(empty.fx)).toBe(true);
    expect(impactFxIsEmpty(result.fx)).toBe(false);
  });

  it('the fx validates against the blueprint schema', () => {
    expect(() => impactFxSchema.parse(result.fx)).not.toThrow();
    expect(() => impactFxSchema.parse({...result.fx, flashes: [{startSec: 1, frames: 5, reason: 'hook_word'}]})).toThrow();
    expect(() => impactFxSchema.parse({...result.fx, punchIns: [{startSec: 1, endSec: 2, rampFrames: 7, scale: 1.4}]})).toThrow();
  });
});

describe('WP35 3) framed card: border + fly-out', () => {
  it('border: white, 4-6 px (5 default), absent unless asked', () => {
    expect(CARD_BORDER_COLOR).toBe('#FFFFFF');
    expect(CARD_BORDER_PX).toBe(5);
    expect([undefined, 0, -3].map(cardBorderPx)).toEqual([0, 0, 0]);
    expect([2, 5, 9].map(cardBorderPx)).toEqual([4, 5, 6]);
  });

  it('the exit is 6 frames: at rest before it, moving from its first frame, fully off the frame on the last', () => {
    expect(CARD_EXIT_FRAMES).toBe(6);
    expect(cardExitAt(-1)).toEqual(CARD_AT_REST);
    const states = Array.from({length: CARD_EXIT_FRAMES}, (_, frame) => cardExitAt(frame));
    expect(states[0]!.progress).toBeGreaterThan(0);
    for (let index = 1; index < states.length; index += 1) {
      expect(states[index]!.slideXFrac).toBeGreaterThan(states[index - 1]!.slideXFrac);
      expect(states[index]!.slideYFrac).toBeGreaterThan(states[index - 1]!.slideYFrac);
    }
    const last = states[states.length - 1]!;
    expect(last.progress).toBe(1);
    expect(last.slideXFrac).toBeGreaterThanOrEqual(1.2); // travelled more than the frame width: gone
    expect(last.slideYFrac).toBeGreaterThanOrEqual(0.7);
  });

  it('slides to the BOTTOM-RIGHT, rotates 12 deg and tilts in 3D', () => {
    const last = cardExitAt(CARD_EXIT_FRAMES - 1);
    expect(last.slideXFrac).toBeGreaterThan(0);
    expect(last.slideYFrac).toBeGreaterThan(0);
    expect(CARD_EXIT_ROTATE_DEG).toBe(12);
    expect(last.rotateZDeg).toBe(12);
    expect(Math.abs(last.rotateYDeg)).toBeGreaterThan(10);
    expect(Math.abs(last.rotateXDeg)).toBeGreaterThan(3);
    const css = cardExitTransform(cardExitAt(3), 1080, 1920);
    expect(css).toMatch(/^perspective\(\d+px\) translate\(\d+px, \d+px\) rotateZ\([\d.]+deg\) rotateY\(-?[\d.]+deg\) rotateX\([\d.]+deg\)/);
    expect(cardExitTransform(CARD_AT_REST, 1080, 1920)).toBe('none');
  });

  it('has motion blur that peaks mid-throw and a horizontal stretch', () => {
    const blurs = Array.from({length: CARD_EXIT_FRAMES}, (_, frame) => cardExitAt(frame).blurPx);
    expect(Math.max(...blurs)).toBeGreaterThanOrEqual(10);
    expect(blurs[0]).toBeGreaterThan(0);
    expect(Math.max(...blurs.slice(1, -1))).toBeGreaterThanOrEqual(blurs[0]!);
    expect(cardExitAt(3).stretchX).toBeGreaterThan(1);
    expect(cardExitAt(-1).blurPx).toBe(0);
  });

  it('a still keeps its hold and lends the exit frames to the next still; the last still has none', () => {
    expect(cardSequenceFrames(40, 0, 4, 'fly_out')).toEqual({frames: 46, exitFrames: 6});
    expect(cardSequenceFrames(40, 2, 4, 'fly_out')).toEqual({frames: 46, exitFrames: 6});
    expect(cardSequenceFrames(40, 3, 4, 'fly_out')).toEqual({frames: 40, exitFrames: 0});
    expect(cardSequenceFrames(40, 0, 4, undefined)).toEqual({frames: 40, exitFrames: 0});
  });
});

describe('WP35 4) wiring', () => {
  const imageRun = read('../../../../remotion/src/motion/compositions/ImageRun.tsx');
  const track = read('../../../../remotion/src/components/ImpactFxTrack.tsx');

  it('ImageRun takes borderPx + exit, draws a white solid border only when asked, and the exit sits above the next still', () => {
    expect(imageRun).toContain('borderPx?: number;');
    expect(imageRun).toContain('exit?: CardExit;');
    expect(imageRun).toContain('border: `${borderPx}px solid ${CARD_BORDER_COLOR}`');
    expect(imageRun).toContain("boxSizing: 'border-box'");
    expect(imageRun).toContain('cardExitTransform(state, width, height)');
    expect(imageRun).toContain('zIndex: 2');
    expect(imageRun).toContain('cardSequenceFrames(slotAt.hold, index, shown.length, exit, exitFrames)');
    // without the props the old look is unchanged
    expect(imageRun).toContain('...(borderPx > 0 ? {border:');
    expect(imageRun).toContain("fit = 'contain', borderPx, exit, holdsSec, framedItems}) => {"); // WP36 added the per-still props
  });

  it('ShortVideo wraps the footage in ImpactPunch (inside SmashPunch) and paints ImpactFxTrack under the captions', () => {
    const short = read('../../../../remotion/src/ShortVideo.tsx');
    expect(short).toMatch(/<SmashPunch[^>]*>\s*<ImpactPunch fx=\{blueprint\.impactFx\} enabled=\{style\.brollEnabled\}>/);
    expect(short).toContain('{style.brollEnabled && blueprint.impactFx ? <ImpactFxTrack fx={blueprint.impactFx} /> : null}');
    expect(short.indexOf('<TransitionTrack')).toBeLessThan(short.indexOf('<ImpactFxTrack'));
    expect(short.indexOf('<ImpactFxTrack')).toBeLessThan(short.indexOf('<DynamicCaptionRenderer'));
  });

  it('the track is plain fills + backdrop-filter (no asset, no network) and the punch never scales past 1.10', () => {
    const code = stripComments(track);
    expect(code).toContain('backdropFilter');
    expect(code).not.toMatch(/OffthreadVideo|<Img|fetch\(|staticFile|delayRender/);
    expect(code).toContain('punchScaleForEvents');
  });

  it('blueprint: the schema parses impactFx (optional) and the server blueprint type carries it', () => {
    expect(timelineBlueprintSchema.shape.impactFx.safeParse(undefined).success).toBe(true);
    expect(read('../../types/blueprint.ts')).toContain('impactFx?: {');
  });

  it('editorial runs are framed; labeled runs stay plain; the registry maps framed -> borderPx 5 + exit fly_out', () => {
    expect(read('./editorialStillMontage.ts')).toMatch(/backdrop: EDITORIAL_BACKDROP,\s*framed: true,/);
    expect(read('./labeledAssetPlacement.ts')).not.toMatch(/framed:\s*true,/);
    expect(read('./imageRunPublish.ts')).toContain('...(run.framed ? {framed: true} : {})');
    const items = [{src: 'https://example.com/a.jpg'}, {src: 'https://example.com/b.jpg'}, {src: 'https://example.com/c.jpg'}];
    const brief = (content: Record<string, unknown>) => ({goal: 'show photos', visualDescription: 'stills', placement: 'full_screen' as const, content});
    const framed = resolveLibraryGraphic(brief({imageRun: items, framed: true, fit: 'cover', backdrop: 'blur_self'}));
    expect(framed?.compositionId).toBe('ImageRun');
    expect(framed?.props).toMatchObject({borderPx: 5, exit: 'fly_out', fit: 'cover', backdrop: 'blur_self'});
    const plain = resolveLibraryGraphic(brief({imageRun: items}));
    expect(plain?.props).not.toHaveProperty('borderPx');
    expect(plain?.props).not.toHaveProperty('exit');
    const junk = resolveLibraryGraphic(brief({imageRun: items, framed: 'yes'}));
    expect(junk?.props).not.toHaveProperty('borderPx');
  });

  it('env flag default on; analyze plans it on polish with the VO plan only, writes impactFx, never for other profiles', () => {
    expect(env.POLISH_IMPACT_FX).toBe(true);
    expect(read('../../../../.env.example')).toContain('POLISH_IMPACT_FX');
    const analyze = read('../../pipeline/analyzeVideo.ts');
    expect(analyze).toContain('const impactFx = polishPath && env.POLISH_IMPACT_FX && voGrammar ? planImpactFx(');
    expect(analyze).toContain('...(impactFx && !impactFxIsEmpty(impactFx.fx) ? {impactFx: impactFx.fx} : {}),');
  });

  it('the planner is pure: no env, I/O, randomness or clock', () => {
    const code = stripComments(read('../../lib/polishImpactFx.ts'));
    expect(code).not.toMatch(/process\.env|config\/env|node:fs|fetch\(|Math\.random|Date\.now|new Date/);
  });
});

describe('WP35 5) the offline proof', () => {
  it('npm run preview:wp35 renders the production components from the real planners', () => {
    expect(read('../../../../remotion/package.json')).toContain('"preview:wp35": "node scripts/wp35-preview.mjs"');
    const script = read('../../../../remotion/scripts/wp35-preview.mjs');
    for (const needle of ['voCutGrammar.ts', 'polishAccumulateCaptions.ts', 'polishImpactFx.ts', 'wp35-vo-words.json', 'wp35-impact-fx.mp4', 'wp35-contact-strip.jpg', 'wp35-flyout-strip.jpg']) expect(script, needle).toContain(needle);
    const entry = read('../../../../remotion/scripts/wp35/entry.tsx');
    for (const needle of ['ImpactFxTrack', 'ImpactPunch', 'AccumulateCaptions', "exit: 'fly_out' as const", 'borderPx: CARD_BORDER_PX']) expect(entry, needle).toContain(needle);
    expect(entry).not.toMatch(/TransitionTrack|SmashPunch/);
  });
});
