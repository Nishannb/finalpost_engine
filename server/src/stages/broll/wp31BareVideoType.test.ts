/**
 * WP31: polish captions are bare video type, not glossy pills. Offline: no render, no network, no model.
 *   1. the pill taxonomy matches what the renderer actually draws as a plate
 *   2. polishBareCaption: the shine-karaoke default, plate templates, box colours and Director-picked pills all land on bare stroked type; non-pill explicit templates survive; idempotent
 *   3. wiring: analyzeVideo applies it on every polish edit (not only explain edits without creator B-roll), behind env.POLISH_BARE_CAPTIONS, and never on non-polish profiles
 *   4. renderer pins (the typed path replaces the shine plate) and FlashCard (the black plate vocabulary) still intact
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {captionDirectionSchema} from '../../../../remotion/src/blueprintSchema.ts';
import {CAPTION_TEMPLATES as REMOTION_CAPTION_TEMPLATES} from '../../../../remotion/src/styles/captionTemplates.ts';
import {isGlossyPillCaption, PILL_CHROME_TEMPLATES, POLISH_BARE_TEMPLATE, polishBareCaption} from '../../lib/polishBareCaption.ts';
import {LOOK_CAPTION_TYPE, type ShortFormLookId} from '../../lib/shortFormLook.ts';
import {CAPTION_TEMPLATES, type CaptionDirection} from '../../types/blueprint.ts';
import {shineCaptionDirection} from './geminiDirector.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const LOOKS: ShortFormLookId[] = ['paper_lime', 'ink_white', 'night_amber', 'clean_mono'];
const base = (over: Partial<CaptionDirection> = {}): CaptionDirection => ({...shineCaptionDirection(), ...over});

describe('WP31 1) pill taxonomy', () => {
  it('every plate-style template really draws a plate (own fill / box animation / dedicated pill renderer / package pill theme)', () => {
    for (const id of PILL_CHROME_TEMPLATES) {
      expect((CAPTION_TEMPLATES as readonly string[]).includes(id), id).toBe(true);
      const template = REMOTION_CAPTION_TEMPLATES[id];
      const drawsPlate = Boolean(template.backgroundColor) || template.animation === 'box' || id === 'moving-pill';
      expect(drawsPlate, id).toBe(true);
    }
  });
  it('no template outside the set has its own fill (so nothing else can paint a plate through `backgroundColor`)', () => {
    for (const template of Object.values(REMOTION_CAPTION_TEMPLATES)) {
      if (PILL_CHROME_TEMPLATES.has(template.id)) continue;
      expect(template.backgroundColor, template.id).toBeNull();
    }
  });
  it('the bare template itself is a plain stroked template: no fill, no box animation', () => {
    const bare = REMOTION_CAPTION_TEMPLATES[POLISH_BARE_TEMPLATE];
    expect(bare.backgroundColor).toBeNull();
    expect(bare.animation).not.toBe('box');
    expect(PILL_CHROME_TEMPLATES.has(POLISH_BARE_TEMPLATE)).toBe(false);
  });
  it('the legacy default (karaoke + highlight, the WP28 pill) is detected as glossy', () => {
    expect(isGlossyPillCaption(shineCaptionDirection())).toBe(true);
  });
});

describe('WP31 2) polishBareCaption', () => {
  it.each(LOOKS.map(id => [id] as const))('%s: the shine-karaoke default becomes bare stroked type (no highlight plate, no box, no glow, look contract applied)', id => {
    const {caption, warnings} = polishBareCaption(shineCaptionDirection(), {lookId: id, templateLocked: false});
    const type = LOOK_CAPTION_TYPE[id];
    expect(isGlossyPillCaption(caption)).toBe(false);
    expect(caption.animation).not.toBe('highlight');
    expect(caption.boxColor).toBeNull();
    expect(caption.glow).toBe(false);
    expect(caption).toMatchObject({template: 'karaoke', textColor: type.textColor, highlightColor: type.highlightColor, strokeColor: type.strokeColor, strokeWidthEm: type.strokeWidthEm, activeStyle: type.activeStyle});
    expect(warnings).toContain(`polish_caption_bare:${id}`);
    expect(warnings).toContain(`look:caption_type:${id}`);
    expect(() => captionDirectionSchema.parse(caption)).not.toThrow();
  });
  it('dark looks: the active word is the same plain ink as the line (no neon, no plate); only paper_lime keeps its dark-ink-on-lime highlighter', () => {
    for (const id of ['ink_white', 'night_amber', 'clean_mono'] as const) {
      const {caption} = polishBareCaption(shineCaptionDirection(), {lookId: id, templateLocked: false});
      expect(caption.activeStyle).toBe('fill');
      expect(caption.highlightColor).toBe(caption.textColor);
    }
  });
  it.each([...PILL_CHROME_TEMPLATES].map(id => [id] as const))('Director / caller picked plate template %s is replaced by bare karaoke type, even when the caller locked it', id => {
    for (const templateLocked of [false, true]) {
      const {caption, warnings} = polishBareCaption(base({template: id, animation: 'box', boxColor: 'rgba(0,0,0,0.72)'}), {lookId: 'clean_mono', templateLocked});
      expect(PILL_CHROME_TEMPLATES.has(caption.template)).toBe(false);
      expect(caption.template).toBe(POLISH_BARE_TEMPLATE);
      expect(caption.boxColor).toBeNull();
      expect(isGlossyPillCaption(caption)).toBe(false);
      expect(warnings).toContain(`polish_caption_pill_replaced:${id}`);
    }
  });
  it('a box colour on a non-plate template is cleared (KineticCaptions would wrap the line in a rounded plate)', () => {
    const {caption} = polishBareCaption(base({template: 'hormozi', animation: 'scale', boxColor: 'rgba(8,8,12,0.9)'}), {lookId: 'ink_white', templateLocked: true});
    expect(caption.boxColor).toBeNull();
    expect(caption.template).toBe('hormozi');
  });
  it('an explicit non-pill template is kept as the caller chose it (no type override when it never drew a plate)', () => {
    const hormozi = base({template: 'hormozi', animation: 'scale', boxColor: null, textColor: '#FFFFFF', highlightColor: '#00FFFF'});
    const result = polishBareCaption(hormozi, {lookId: 'ink_white', templateLocked: true});
    expect(result.caption).toBe(hormozi);
    expect(result.warnings).toEqual([]);
  });
  it('an explicit template that would draw the shine plate (highlight animation / gaming-stream) gets the bare type contract, template kept', () => {
    const gaming = polishBareCaption(base({template: 'gaming-stream', animation: undefined}), {lookId: 'night_amber', templateLocked: true});
    expect(gaming.caption.template).toBe('gaming-stream');
    expect(gaming.caption.activeStyle).toBe('fill');
    const highlight = polishBareCaption(base({template: 'classic', animation: 'highlight'}), {lookId: 'night_amber', templateLocked: true});
    expect(highlight.caption.animation).toBe('scale');
    expect(isGlossyPillCaption(highlight.caption)).toBe(false);
  });
  it('is idempotent: running it again changes nothing', () => {
    const once = polishBareCaption(shineCaptionDirection(), {lookId: 'ink_white', templateLocked: false});
    const twice = polishBareCaption(once.caption, {lookId: 'ink_white', templateLocked: false});
    expect(twice.caption).toBe(once.caption);
    expect(twice.warnings).toEqual([]);
  });
  it('after the WP13C block already applied the contract, only a plate template / box colour is touched', () => {
    const typed = base({...LOOK_CAPTION_TYPE.ink_white, template: 'moving-pill', boxColor: null});
    const {caption} = polishBareCaption(typed, {lookId: 'ink_white', templateLocked: false});
    expect(caption.template).toBe(POLISH_BARE_TEMPLATE);
    expect(caption.strokeColor).toBe(LOOK_CAPTION_TYPE.ink_white.strokeColor);
  });
  it('does not mutate its input', () => {
    const input = shineCaptionDirection();
    const snapshot = JSON.stringify(input);
    polishBareCaption(input, {lookId: 'ink_white', templateLocked: false});
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('WP31 3) wiring', () => {
  const analyze = read('../../pipeline/analyzeVideo.ts');
  it('analyzeVideo applies polishBareCaption on polish only, behind the env switch, skipping CaptionKit presets and designed style guides', () => {
    expect(analyze).toContain("import {polishBareCaption} from '../lib/polishBareCaption.ts';");
    expect(analyze).toMatch(/if \(polishPath && env\.POLISH_BARE_CAPTIONS && !\(input\.captionPreset \|\| ''\)\.trim\(\) && !captionGuide\)/);
    expect(analyze).toContain('polishBareCaption(broll.caption,');
  });
  it('the switch is NOT gated on motion graphics, creator B-roll or a missing caller template (the WP28 hole)', () => {
    const block = analyze.slice(analyze.indexOf('WP31: the one switch'), analyze.indexOf('WP13B: grade-flip face beats'));
    expect(block).toContain('polishPath && env.POLISH_BARE_CAPTIONS');
    expect(block).not.toMatch(/userBrollUrls/);
    expect(block).not.toMatch(/&& motion\b/);
  });
  it('it runs after the Director / template recipe / layout lock and before the blueprint is written', () => {
    const at = analyze.indexOf('polishBareCaption(broll.caption,');
    expect(at).toBeGreaterThan(analyze.indexOf('broll.caption = finalized.caption;'));
    expect(at).toBeLessThan(analyze.indexOf('captionDirection: broll.caption,'));
  });
  it('env: POLISH_BARE_CAPTIONS defaults on', () => {
    expect(read('../../config/env.ts')).toContain('POLISH_BARE_CAPTIONS: bool(true)');
  });
  it('the old behaviour is untouched off polish: the helper is only referenced from the polish branch', () => {
    const uses = analyze.split('\n').filter(line => line.includes('polishBareCaption('));
    expect(uses).toHaveLength(1);
    expect(analyze).toContain('const polishPath = input.editProfile ===');
  });
});

describe('WP31 4) renderer + FlashCard regressions', () => {
  const captions = read('../../../../remotion/src/components/KineticCaptions.tsx');
  it('KineticCaptions: shine plate only when untyped; the typed path has stroke + soft shadow, no plate, no sheen', () => {
    expect(captions).toContain("template.animation === 'highlight' && !typed");
    const typedBranch = captions.slice(captions.indexOf('} else if (typed) {'), captions.indexOf('} else {\n    textStyle.color = color;'));
    expect(typedBranch).toContain('WebkitTextStroke');
    expect(typedBranch).not.toMatch(/linear-gradient|mixBlendMode|backgroundColor/);
    expect(captions).toContain("typed.glow ? `, 0 0 ${fontSize * 0.22}px");
  });
  it('FlashCard is unchanged: solid black / white ground, heavy 900 display type, slammed by a recipe, 4 words max', () => {
    const flash = read('../../../../remotion/src/motion/compositions/FlashCard.tsx');
    expect(flash).toContain("black: {fill: '#000000', ink: '#FFFFFF'}");
    expect(flash).toContain('weight={900}');
    expect(flash).toContain('FLASH_CARD_MAX_WORDS = 4');
    expect(flash).not.toMatch(/borderRadius|boxShadow/);
  });
});
