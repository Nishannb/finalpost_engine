import {describe, expect, it} from 'vitest';

import {EditLedger} from '../lib/editLedger.ts';
import {stampProvenance} from '../lib/provenance.ts';
import {parseContentProfile} from '../stages/contentProfile/contentProfile.ts';
import type {CaptionDirection, DesignTokens, MotionGraphic} from '../types/blueprint.ts';
import {finalizeEdits, type FinalizeInput} from '../pipeline/finalizeEdits.ts';

const profile = parseContentProfile({content_type: 'relationship_emotional', structure: 'narrative', pacing: 'slow', graphics_density: 'sparse', visual_mood: 'warm_intimate', tone: 'tender', rationale: 'r'});
const directorDesign = stampProvenance(
  {enabled: true as const, contentType: 'other' as const, displayFont: 'space_grotesk' as const, motionPreset: 'documentary' as const, cornerRadius: 16, density: 'balanced' as const, primaryColor: '#00E5FF', secondaryColor: '#FF3B8B', inkColor: '#FFFFFF', surfaceColor: '#0B1B2B'},
  {primaryColor: 'director', secondaryColor: 'director', inkColor: 'director', surfaceColor: 'director'},
) as DesignTokens;
const kinetic: MotionGraphic = {start: 13.4, end: 16.4, text: 'Hook is key', role: 'primary', shape: 'underline', accentColor: '#C084FC', textColor: '#FFFFFF', anchor: 'top_left', entrance: 'scale_pop', exit: 'fade', fontScale: 1, italic: false};
const captionWith = (over: Partial<CaptionDirection> = {}): CaptionDirection => ({position: 'bottom', bottomFrac: 0.2, textColor: '#FFFFFF', highlightColor: '#F3E8FF', boxColor: null, template: 'karaoke', ...over} as CaptionDirection);

const input = (over: Partial<FinalizeInput> = {}): FinalizeInput => ({
  ledger: new EditLedger(), contentProfile: null, footageLuminance: 0.02, // dark footage: a bright accent WOULD be adopted as the highlight if the palette were allowed to restyle captions
  captionLocked: false, durationSec: 40,
  hook: {text: 'Never do these', start: 0, end: 3, anchor: 'top_left'}, caption: captionWith(), brollClips: [], visualOverlays: [], insetReveals: [], frameInsets: [], mediaContainers: [],
  motionGraphics: [kinetic], semanticEmphasis: [], depthOverlays: [], transitions: [], zoomTriggers: [], generatedGraphics: [],
  speaker: {box: {x: 0.18, y: 0.3, w: 0.64, h: 0.6}, source: 'fallback'}, speakerCutout: {available: false}, ...over,
});

describe('a Director colour palette never restyles the captions', () => {
  it('explicitly selected template: template and every caption style field are untouched, while the edits DO adopt the palette', () => {
    const caption = captionWith({template: 'karaoke', highlightColor: '#F3E8FF', textColor: '#FFFFFF'});
    const out = finalizeEdits(input({caption, directorDesign}));
    expect(out.caption).toEqual(caption);
    expect(out.caption).toBe(caption);
    expect(out.motionGraphics[0]!.accentColor).toBe('#00E5FF');
  });

  it('null or absent template: still untouched', () => {
    for (const template of [undefined, null]) {
      const caption = captionWith({template: template as never});
      const out = finalizeEdits(input({caption, directorDesign}));
      expect(out.caption).toBe(caption);
      expect(out.caption.template).toBe(template);
    }
  });

  it('with a content profile present as well, the Director palette still leaves the captions alone', () => {
    const caption = captionWith();
    const out = finalizeEdits(input({caption, contentProfile: profile, directorDesign}));
    expect(out.design!.primaryColor).toBe('#00E5FF');
    expect(out.caption).toBe(caption);
  });

  it('a palette whose accent would be adopted as the highlight (high contrast against the footage) is still not adopted', () => {
    const caption = captionWith({highlightColor: '#123456'});
    const out = finalizeEdits(input({caption, directorDesign: {...directorDesign, primaryColor: '#FFFF00'} as DesignTokens, footageLuminance: 0.02}));
    expect(out.caption.highlightColor).toBe('#123456');
  });

  it('already-locked captions (style guide) stay locked', () => {
    const caption = captionWith();
    expect(finalizeEdits(input({caption, captionLocked: true, directorDesign})).caption).toBe(caption);
  });

  it('pinned, unchanged behaviour: the content-profile design WITHOUT a Director palette keeps adopting its highlight (not part of this fix)', () => {
    const out = finalizeEdits(input({caption: captionWith({highlightColor: '#F3E8FF'}), contentProfile: profile, footageLuminance: 0.04}));
    expect(out.caption.highlightColor).toBe(out.design!.primaryColor);
  });
});
