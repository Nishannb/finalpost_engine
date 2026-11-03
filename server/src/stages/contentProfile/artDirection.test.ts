import {describe, expect, it} from 'vitest';

import {timelineBlueprintSchema} from '../../../../remotion/src/blueprintSchema.ts';
import type {CaptionDirection, MotionGraphic, SemanticEmphasis} from '../../types/blueprint.ts';
import {artDirectionLines, designFromProfile, harmonizeEdits, readableOn} from './artDirection.ts';
import {contrastRatio, hexLuminance, parseContentProfile, profileBlockForVisualDirector, VISUAL_MOODS} from './contentProfile.ts';

const profile = (over: Record<string, unknown> = {}) =>
  parseContentProfile({content_type: 'relationship_emotional', structure: 'narrative', pacing: 'slow', graphics_density: 'sparse', visual_mood: 'warm_intimate', tone: 'tender', rationale: 'r', ...over});

const kinetic = (over: Partial<MotionGraphic> = {}): MotionGraphic => ({
  start: 10, end: 13, text: 'Embrace the pause', role: 'primary', shape: 'pill', accentColor: '#C084FC', textColor: '#FFFFFF',
  anchor: 'top_left', entrance: 'scale_pop', exit: 'fade', fontScale: 1, ...over,
});
const emphasis = (over: Partial<SemanticEmphasis> = {}): SemanticEmphasis => ({
  start: 10, end: 12, text: 'True presence', weight: 'primary', treatment: 'color', accentColor: '#FACC15', anchor: 'top_right', ...over,
});
const caption = (over: Partial<CaptionDirection> = {}): CaptionDirection => ({
  position: 'bottom', bottomFrac: 0.2, textColor: '#FFFFFF', highlightColor: '#F3E8FF', boxColor: null, template: 'karaoke', ...over,
});
const base = (design = designFromProfile(profile()), over: Record<string, unknown> = {}) => ({
  design, footageLuminance: 0.3, motionGraphics: [kinetic()], semanticEmphasis: [emphasis()], frameInsets: [], mediaContainers: [], caption: caption(), captionLocked: false, ...over,
});

describe('design from the content profile', () => {
  it('keeps plates dark, ink light and every accent readable, for every mood', () => {
    for (const mood of VISUAL_MOODS) {
      const design = designFromProfile(profile({visual_mood: mood}));
      expect(contrastRatio(design.inkColor, design.surfaceColor)).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(design.primaryColor, design.surfaceColor)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(design.secondaryColor, design.surfaceColor)).toBeGreaterThanOrEqual(3);
      expect(design.enabled).toBe(true);
    }
  });

  it('follows pacing and structure rather than a genre template', () => {
    expect(designFromProfile(profile({pacing: 'slow'})).motionPreset).toBe('editorial');
    expect(designFromProfile(profile({pacing: 'fast'})).motionPreset).toBe('kinetic');
    expect(designFromProfile(profile({content_type: 'educational_tips', structure: 'enumerated', pacing: 'medium'})).motionPreset).toBe('modular');
    // Same genre, different feel: a fast, funny relationship story is not restrained.
    expect(designFromProfile(profile({pacing: 'fast', graphics_density: 'sparse'})).motionPreset).toBe('kinetic');
    expect(designFromProfile(profile({content_type: 'relationship_emotional'})).contentType).toBe('story');
  });

  it('gives different moods different palettes and tells the Director about them', () => {
    expect(designFromProfile(profile({visual_mood: 'warm_intimate'})).surfaceColor).not.toBe(designFromProfile(profile({visual_mood: 'tech_sharp'})).surfaceColor);
    const block = profileBlockForVisualDirector(profile(), artDirectionLines(profile()));
    expect(block).toContain('art direction (warm intimate)');
    expect(block).toContain('accent_color');
    expect(profileBlockForVisualDirector(profile())).not.toContain('art direction');
  });
});

describe('renderer compatibility', () => {
  it('produces a design the Remotion blueprint schema accepts, for every mood and content type', () => {
    const types = ['relationship_emotional', 'personal_story', 'motivational', 'educational_tips', 'tutorial', 'sales_pitch', 'opinion', 'announcement', 'testimonial', 'comedy', 'other'];
    for (const mood of VISUAL_MOODS) {
      for (const type of types) {
        const design = designFromProfile(profile({visual_mood: mood, content_type: type}));
        expect(timelineBlueprintSchema.shape.northStarDesign.parse(design)).toEqual(design);
      }
    }
  });
});

describe('harmonizing the Director’s colours with the art direction', () => {
  it('replaces the Director’s accents by role, keeping hierarchy', () => {
    const design = designFromProfile(profile());
    const out = harmonizeEdits(base(design, {motionGraphics: [kinetic({role: 'primary'}), kinetic({role: 'secondary', shape: 'underline'})], semanticEmphasis: [emphasis({weight: 'secondary', treatment: 'scale'})]}));
    expect(out.motionGraphics.map(item => item.accentColor)).toEqual([design.primaryColor, design.secondaryColor]);
    expect(out.semanticEmphasis[0]!.accentColor).toBe(design.secondaryColor);
    expect(out.changed.motionGraphics).toBe(2);
  });

  it('keeps type readable on filled shapes, and never uses dark type directly over footage', () => {
    const design = designFromProfile(profile());
    const out = harmonizeEdits(base(design, {motionGraphics: [kinetic({shape: 'block', textColor: '#777777'})]}));
    expect(contrastRatio(out.motionGraphics[0]!.textColor, out.motionGraphics[0]!.accentColor)).toBeGreaterThanOrEqual(4.5);
    // The renderer shadows over-footage type with a dark glow, so even on bright footage it stays light.
    for (const footageLuminance of [0.04, 0.44, 0.85]) {
      const bare = harmonizeEdits(base(design, {footageLuminance, motionGraphics: [kinetic({shape: 'underline', textColor: '#FFFFFF'}), kinetic({shape: 'none', textColor: '#222222'})], semanticEmphasis: [emphasis({treatment: 'color'})]}));
      for (const color of [...bare.motionGraphics.map(item => item.textColor), bare.semanticEmphasis[0]!.textColor ?? bare.semanticEmphasis[0]!.accentColor]) {
        expect(hexLuminance(color)).toBeGreaterThanOrEqual(0.35);
      }
    }
    const dark = harmonizeEdits(base(design, {footageLuminance: 0.05, semanticEmphasis: [emphasis({treatment: 'color'})]}));
    expect((dark.semanticEmphasis[0]!.textColor ?? dark.semanticEmphasis[0]!.accentColor).toLowerCase()).toBe(design.primaryColor.toLowerCase());
  });

  it('recolours frame insets and containers, and respects a creator caption guide', () => {
    const design = designFromProfile(profile());
    const out = harmonizeEdits(
      base(design, {
        footageLuminance: 0.04,
        frameInsets: [{start: 5, end: 9, scale: 0.86, marginColor: '#000000'}],
        mediaContainers: [{start: 12, end: 16, mode: 'inset', canvasColor: '#FFFFFF', cornerRadius: 18, scale: 0.8, transitionSec: 0.6, canvasTitle: 'Pause'}],
      }),
    );
    expect(out.frameInsets[0]!.marginColor).toBe(design.surfaceColor);
    expect(out.mediaContainers[0]).toMatchObject({canvasColor: design.surfaceColor});
    expect(out.caption.highlightColor).toBe(design.primaryColor);
    const locked = harmonizeEdits(base(design, {footageLuminance: 0.04, captionLocked: true}));
    expect(locked.caption.highlightColor).toBe('#F3E8FF');
    expect(locked.changed.caption).toBe(false);
  });

  it('leaves the caption highlight alone when the accent would vanish on the footage', () => {
    const design = designFromProfile(profile());
    const out = harmonizeEdits(base(design, {footageLuminance: contrastLuminanceOf(design.primaryColor)}));
    expect(out.caption.highlightColor).toBe('#F3E8FF');
  });

  it('readableOn prefers a colour that already reads and otherwise picks white or black', () => {
    expect(readableOn('#101010', '#EEEEEE')).toBe('#EEEEEE');
    expect(readableOn('#101010', '#222222')).toBe('#FFFFFF');
    expect(readableOn('#F6F3EE', '#FFFFFF')).toBe('#111111');
  });
});

function contrastLuminanceOf(hex: string): number {
  // The footage luminance equal to the colour's own luminance gives contrast 1.
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
