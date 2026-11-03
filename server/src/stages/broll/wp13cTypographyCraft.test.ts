/**
 * WP13C: caption + plate typography craft. Look-driven caption TYPE contract (stroke / fill / marker bar, no glow), plate title hierarchy, Quartz-style highlight on the article plate, and bolder illustrated chips.
 * Offline: no render, no network.
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {captionDirectionSchema} from '../../../../remotion/src/blueprintSchema.ts';
import {plateContrast, platePalette} from '../../../../remotion/src/motion/palette.ts';
import {SHORT_FORM_LOOK_IDS, SHORT_FORM_LOOKS} from '../../../../remotion/src/motion/looks.ts';
import {LOOK_CAPTION_TYPE} from '../../lib/shortFormLook.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const comp = (name: string) => read(`../../../../remotion/src/motion/compositions/${name}.tsx`);

describe('WP13C 1) caption type contract by look', () => {
  it.each(SHORT_FORM_LOOK_IDS.map(id => [id] as const))('%s: heavy dark stroke, no coloured glow, readable fill', id => {
    const type = LOOK_CAPTION_TYPE[id];
    expect(type.glow).toBe(false);
    expect(type.strokeWidthEm).toBeGreaterThanOrEqual(0.06);
    expect(type.strokeWidthEm).toBeLessThanOrEqual(0.1);
    // white (or warm white) on the dark stroke is the edge the viewer reads: independent of the face midtone behind it
    expect(plateContrast(type.textColor, type.strokeColor)).toBeGreaterThanOrEqual(15);
    expect(plateContrast(type.highlightColor, type.strokeColor)).toBeGreaterThanOrEqual(7);
  });
  it('dark looks (ink_white, night_amber, clean_mono): the active word is plain ink fill (Metromedia-clean), the same as the line, not a neon fill; the look ink is the fill', () => {
    for (const id of ['ink_white', 'night_amber', 'clean_mono'] as const) {
      const type = LOOK_CAPTION_TYPE[id];
      expect(type.activeStyle).toBe('fill');
      expect(type.highlightColor).toBe(type.textColor);
      expect(type.textColor).toBe(SHORT_FORM_LOOKS[id].ink === '#FFFFFF' ? '#FFFFFF' : SHORT_FORM_LOOKS[id].ink);
      expect(type.activeInk).toBeUndefined();
    }
  });
  it('paper_lime: white words with a dark stroke; the active word is near-black ink on the lime marker bar (>= 4.5:1, in fact >= 7:1)', () => {
    const type = LOOK_CAPTION_TYPE.paper_lime;
    expect(type.activeStyle).toBe('marker');
    expect(type.highlightColor).toBe(SHORT_FORM_LOOKS.paper_lime.marker);
    expect(plateContrast(type.activeInk!, type.highlightColor)).toBeGreaterThanOrEqual(7);
    expect(plateContrast(type.textColor, type.strokeColor)).toBeGreaterThanOrEqual(15);
  });
  it('no look uses a neon fill: no contract colour is karaoke blue-green', async () => {
    const {isKaraokeCyan} = await import('../../../../remotion/src/motion/palette.ts');
    for (const id of SHORT_FORM_LOOK_IDS) for (const color of [LOOK_CAPTION_TYPE[id].textColor, LOOK_CAPTION_TYPE[id].highlightColor, LOOK_CAPTION_TYPE[id].strokeColor]) expect(isKaraokeCyan(color), `${id} ${color}`).toBe(false);
  });
  it('the blueprint caption direction accepts the contract (and rejects an unknown activeStyle)', () => {
    const base = {position: 'bottom' as const, bottomFrac: 0.2};
    const type = LOOK_CAPTION_TYPE.paper_lime;
    expect(captionDirectionSchema.parse({...base, textColor: type.textColor, highlightColor: type.highlightColor, strokeColor: type.strokeColor, strokeWidthEm: type.strokeWidthEm, glow: type.glow, activeStyle: type.activeStyle, activeInk: type.activeInk})).toMatchObject({activeStyle: 'marker'});
    expect(() => captionDirectionSchema.parse({...base, activeStyle: 'neon'})).toThrow();
    expect(read('../../types/blueprint.ts')).toContain("activeStyle?: 'fill' | 'marker'");
  });
  it('the renderer: a typed caption replaces the glowing-pill (`highlight`) and neon karaoke fill with stroke + soft shadow; the marker mode paints ink on a bar; the default path is untouched', () => {
    const source = read('../../../../remotion/src/components/KineticCaptions.tsx');
    expect(source).toContain("template.animation === 'highlight' && !typed");
    expect(source).toContain("template.animation === 'karaoke' && !typed");
    expect(source).toContain('textStyle.color = onBar ? typed.activeInk : color;');
    expect(source).toContain('WebkitTextStroke = `${typed.strokeWidth}px ${typed.strokeColor}`');
    expect(source).toContain("typed?.activeStyle === 'marker' && isActive");
    expect(source).toContain('const typed: TypedCaption | undefined = direction?.activeStyle');
    // the template glow only returns when explicitly asked for
    expect(source).toContain("typed.glow ? `, 0 0 ${fontSize * 0.22}px");
  });
  it('wiring: analyzeVideo applies the contract on a polish explain edit with no caller template and warns look:caption_type:<id>', () => {
    const analyze = read('../../pipeline/analyzeVideo.ts');
    expect(analyze).toContain('const type = LOOK_CAPTION_TYPE[lookId];');
    for (const field of ['strokeColor: type.strokeColor', 'strokeWidthEm: type.strokeWidthEm', 'glow: type.glow', 'activeStyle: type.activeStyle']) expect(analyze).toContain(field);
    expect(analyze).toContain('`look:caption_type:${lookId}`');
    expect(analyze).toMatch(/polishPath && motion && !input\.captionTemplate/);
  });
});

describe('WP13C 2) plate title hierarchy', () => {
  it('hero titles (OpenPlate, StampTitle, FullscreenStatement, VsClaim) are weight 900 with slightly tight tracking, in the display face', () => {
    for (const [name, pattern] of [
      ['OpenPlate', /<KineticText text=\{title\}[^>]*weight=\{900\}[^>]*letterSpacing=\{-0\.01\}/],
      ['StampTitle', /<KineticText text=\{title\}[^>]*weight=\{900\}[^>]*letterSpacing=\{-0\.01\}/],
      ['FullscreenStatement', /<KineticText text=\{statement\}[^>]*weight=\{900\}[^>]*letterSpacing=\{-0\.01\}/],
      ['VsClaim', /<FitText text=\{side\.text\}[^>]*weight=\{900\}[^>]*letterSpacing=\{-0\.01\}/],
    ] as const) {
      const source = comp(name);
      expect(source, name).toMatch(pattern);
      expect(source.match(/<(?:KineticText|FitText) text=\{(?:title|statement|side\.text)\}[^>]*/)![0], name).not.toContain('font="body"');
    }
  });
  it('primary words never use a muted grey: VsClaim\'s weaker side is ink on paper, and no hero title takes mutedInk / paperMuted', () => {
    const vs = comp('VsClaim');
    expect(vs).toContain('{text: left, color: palette.paperInk');
    expect(vs).not.toContain('paperMuted');
    for (const name of ['OpenPlate', 'StampTitle', 'FullscreenStatement', 'VsClaim']) {
      const titleLine = comp(name).match(/<(?:KineticText|FitText) text=\{(?:title|statement|side\.text)\}[^>]*/)![0];
      expect(titleLine, name).not.toMatch(/mutedInk|paperMuted/);
    }
  });
  it('contrast pins: ink on ground and paper ink on paper in every look are strong enough for 900-weight display type', () => {
    for (const id of SHORT_FORM_LOOK_IDS) {
      const look = SHORT_FORM_LOOKS[id];
      expect(plateContrast(look.ink, look.ground), id).toBeGreaterThanOrEqual(7);
      expect(plateContrast(look.paperInk, look.paper), id).toBeGreaterThanOrEqual(7);
    }
  });
});

describe('WP13C 3) article plate highlight (Quartz)', () => {
  it('WikiCallout / TweetCard highlighted words are dark ink on a solid marker bar, not coloured text; the passage is the body face', () => {
    for (const name of ['WikiCallout', 'TweetCard']) {
      const source = comp(name);
      expect(source, name).toContain('highlightStyle="marker"');
      expect(source, name).toContain('highlightColor={palette.marker}');
      expect(source, name).toContain('highlightInk={palette.markerInk}');
      expect(source, name).toContain('highlightOpacity={1}');
      expect(source, name).not.toContain('highlightStyle="color"');
    }
    expect(comp('WikiCallout')).toMatch(/<KineticText text=\{text\}[^>]*font="body"/);
    const lime = platePalette({primary: '#2F5BEA', secondary: '#12A594', background: '#F6F3EE', surface: '#FFFFFF', text: '#1B1B1F', mutedText: '#6B6B76', accent: '#E4572E', look: 'auto'});
    expect(plateContrast(lime.markerInk, lime.marker)).toBeGreaterThanOrEqual(7);
    expect(plateContrast(lime.paperInk, lime.paper)).toBeGreaterThanOrEqual(7);
  });
});

describe('WP13C 4) illustrated TopicPills are short-form chips, not website UI', () => {
  it('paper chip, look ink, marker border, a bigger icon and bold label', () => {
    const pills = comp('TopicPills');
    for (const needle of ['color={palette.paper}', 'textColor={palette.paperInk}', 'borderColor={palette.marker}', 'iconScale={0.62}', 'iconColor={palette.paperInk}', 'weight={800}']) expect(pills).toContain(needle);
    expect(pills).not.toMatch(/#[0-9a-fA-F]{3,6}\b|cyan|teal|theme\.accent/i);
    const badge = read('../../../../remotion/src/motion/components/Indicators.tsx');
    expect(badge).toContain('iconScale = 0.5');
    expect(badge).toContain('weight = 700');
    expect(badge).toContain('height * (0.84 + (icon ? iconScale + 0.18 : 0))'); // the natural width follows the icon size, so the chip still fits its text
    expect(badge).toContain('fontWeight: availableWeight(theme.fontBody, weight)');
  });
  it('Badge defaults are unchanged for every other caller (icon 0.5, weight 700, text-coloured icon)', () => {
    const badge = read('../../../../remotion/src/motion/components/Indicators.tsx');
    expect(badge).toContain('iconColor ?? textColor ?? theme.accent');
  });
});
