import {describe, expect, it} from 'vitest';

import {
  describeOccupancyForDirector,
  legalSlots,
  occupancyFromSpeaker,
  overlapArea,
  parseSpeakerJson,
  slotRectForAnchor,
} from './occupancy.ts';
import {
  applyGeometricPatches,
  findLayoutIssues,
  parseVisionPatches,
} from './layoutCritique.ts';
import {composeBeautifulLayout} from './slotCompositor.ts';
import type {CaptionDirection, MotionGraphic, VisualOverlay} from '../../types/blueprint.ts';

describe('occupancy', () => {
  it('parses a speaker box from Gemini JSON', () => {
    const box = parseSpeakerJson('```json\n{"x":0.2,"y":0.15,"w":0.5,"h":0.7}\n```');
    expect(box).toEqual({x: 0.2, y: 0.15, w: 0.5, h: 0.7});
  });

  it('puts graphics on the emptier side of the speaker', () => {
    const leftHeavy = occupancyFromSpeaker({x: 0.05, y: 0.2, w: 0.45, h: 0.6}, 'vision');
    expect(leftHeavy.preferredSide).toBe('right');
    expect(leftHeavy.graphicAnchor).toBe('top_right');
  });

  it('lists accent slots that miss a center speaker', () => {
    const occupancy = occupancyFromSpeaker({x: 0.22, y: 0.18, w: 0.56, h: 0.62}, 'vision');
    const accent = legalSlots(occupancy).filter(slot => slot.size === 'accent');
    expect(accent.length).toBeGreaterThan(0);
    for (const slot of accent) {
      expect(overlapArea(slot.rect, occupancy.speaker)).toBeLessThan(0.04);
    }
    const brief = describeOccupancyForDirector(occupancy);
    expect(brief).toMatch(/LEGAL_SLOTS/);
    expect(brief).not.toMatch(/video-call/i);
    expect(brief).toMatch(/empty canvas/i);
  });
});

describe('composeBeautifulLayout', () => {
  const caption: CaptionDirection = {
    position: 'center',
    bottomFrac: 0.42,
    textColor: '#FFFFFF',
    highlightColor: '#FFFF00',
    boxColor: null,
    template: 'hormozi',
  };

  const occupancy = occupancyFromSpeaker({x: 0.2, y: 0.18, w: 0.55, h: 0.65}, 'vision');

  it('keeps director caption placement and remaps face-covering motion', () => {
    const graphic: MotionGraphic = {
      start: 4,
      end: 6,
      text: 'DEEP BONDS',
      role: 'primary',
      shape: 'bar',
      accentColor: '#FACC15',
      textColor: '#FFFFFF',
      anchor: 'center',
      entrance: 'spring_up',
      exit: 'fade',
      fontScale: 1.4,
    };
    const overlay: VisualOverlay = {
      start: 8,
      end: 10,
      layout: 'banner',
      mediaKind: 'text',
      anchor: 'top',
      keyword: 'bonds',
      overlayText: 'DEEP EMOTIONAL BONDS',
      assetUrl: '',
      provider: 'generated',
      providerId: 1,
      width: 0,
      height: 0,
      credit: '',
      creditUrl: '',
      accentColor: '#E8C872',
      textStyle: 'bar',
    };

    const composed = composeBeautifulLayout({
      occupancy,
      hookStyle: 'boxed',
      caption,
      motionGraphics: [graphic],
      overlays: [overlay],
      semanticEmphasis: [
        {
          start: 5,
          end: 7,
          text: 'real connection',
          weight: 'primary',
          treatment: 'highlight_shape',
          accentColor: '#FACC15',
        },
      ],
    });

    expect(composed.caption.position).toBe('center');
    expect(composed.caption.bottomFrac).toBeGreaterThanOrEqual(0.38);
    expect(composed.caption.template).toBe('hormozi');
    expect(composed.hookStyle).toBe('boxed');
    expect(composed.motionGraphics[0]?.anchor).not.toBe('center');
    expect(
      (composed.motionGraphics[0]?.end ?? 0) - (composed.motionGraphics[0]?.start ?? 0),
    ).toBeGreaterThanOrEqual(0.9);
    expect(composed.overlays[0]?.layout).toBe('lockup');
    expect(composed.overlays[0]?.textStyle).toBe('stack');
    expect(['top_left', 'top_right', 'bottom_left', 'bottom_right']).toContain(
      composed.motionGraphics[0]?.anchor,
    );
    expect(overlapArea(slotRectForAnchor(composed.motionGraphics[0]!.anchor), occupancy.speaker))
      .toBeLessThan(0.04);
    expect(composed.semanticEmphasis[0]?.anchor).not.toBe('top');
    expect(composed.semanticEmphasis[0]?.treatment).toBe('type_reveal');
  });

  it('drops an empty pip canvas instead of shrinking onto white', () => {
    const composed = composeBeautifulLayout({
      occupancy,
      hookStyle: 'rail',
      caption,
      motionGraphics: [],
      overlays: [],
      mediaContainers: [
        {
          start: 8,
          end: 14,
          mode: 'pip_corner',
          canvasColor: '#FFFFFF',
          cornerRadius: 28,
          scale: 0.28,
          transitionSec: 0.7,
          pipAnchor: 'bottom_right',
        },
      ],
    });
    expect(composed.mediaContainers).toEqual([]);
  });

  it('keeps pip_corner when a timed card fills the leftover canvas', () => {
    const overlay: VisualOverlay = {
      start: 8,
      end: 13,
      layout: 'card',
      mediaKind: 'image',
      anchor: 'top_left',
      keyword: 'screenshot',
      overlayText: '',
      assetUrl: 'https://example.com/shot.jpg',
      provider: 'user',
      providerId: 1,
      width: 1080,
      height: 1920,
      credit: '',
      creditUrl: '',
      accentColor: '#FDE68A',
      textStyle: 'outline',
    };
    const composed = composeBeautifulLayout({
      occupancy,
      hookStyle: 'rail',
      caption,
      motionGraphics: [],
      overlays: [overlay],
      mediaContainers: [
        {
          start: 8,
          end: 14,
          mode: 'pip_corner',
          canvasColor: '#111418',
          cornerRadius: 28,
          scale: 0.28,
          transitionSec: 1,
          pipAnchor: 'bottom_right',
        },
      ],
    });
    expect(composed.mediaContainers).toHaveLength(1);
    expect(composed.mediaContainers[0]?.mode).toBe('pip_corner');
    expect(composed.mediaContainers[0]?.transitionSec).toBeGreaterThanOrEqual(0.85);
  });

  it('keeps designed media cards instead of flattening them into lockups', () => {
    const overlay: VisualOverlay = {
      start: 6,
      end: 9,
      layout: 'card',
      mediaKind: 'image',
      anchor: 'top',
      keyword: 'screenshot',
      overlayText: '',
      assetUrl: 'https://example.com/shot.jpg',
      provider: 'user',
      providerId: 1,
      width: 1080,
      height: 1920,
      credit: '',
      creditUrl: '',
      accentColor: '#FDE68A',
      textStyle: 'outline',
      treatment: 'focus',
      glow: true,
      focusRegion: {x: 0.1, y: 0.3, w: 0.8, h: 0.12, label: 'rapid dissolution'},
    };
    const composed = composeBeautifulLayout({
      occupancy,
      hookStyle: 'rail',
      caption,
      motionGraphics: [],
      overlays: [overlay],
    });
    expect(composed.overlays[0]?.layout).toBe('card');
    expect(composed.overlays[0]?.treatment).toBe('focus');
    expect(composed.overlays[0]?.anchor).not.toBe('top');
  });
});

describe('layout critique patches', () => {
  const occupancy = occupancyFromSpeaker({x: 0.2, y: 0.18, w: 0.55, h: 0.65}, 'vision');
  const caption: CaptionDirection = {
    position: 'bottom',
    bottomFrac: 0.16,
    textColor: '#FFFFFF',
    highlightColor: '#FFE14A',
    boxColor: null,
    template: 'classic',
  };

  it('flags and drops an empty pip, and moves a face-covering hook', () => {
    const plan = {
      hookAnchor: 'top' as const,
      hookDurationSec: 3,
      caption,
      motionGraphics: [] as MotionGraphic[],
      overlays: [] as VisualOverlay[],
      mediaContainers: [
        {
          start: 8,
          end: 14,
          mode: 'pip_corner' as const,
          canvasColor: '#FFFFFF',
          cornerRadius: 28,
          scale: 0.28,
          transitionSec: 1,
          pipAnchor: 'bottom_right' as const,
        },
      ],
      semanticEmphasis: [],
    };
    const issues = findLayoutIssues(occupancy, plan);
    expect(issues.some(issue => issue.kind === 'empty_pip')).toBe(true);
    const patched = applyGeometricPatches(occupancy, plan);
    expect(patched.mediaContainers).toEqual([]);
    expect(['top_left', 'top_right']).toContain(patched.hookAnchor);
  });

  it('parses vision patches without requiring a named look', () => {
    const parsed = parseVisionPatches(
      '```json\n{"drop_container_indexes":[0],"hook_anchor":"top_left","notes":"pip empty"}\n```',
    );
    expect(parsed?.drop_container_indexes).toEqual([0]);
    expect(parsed?.hook_anchor).toBe('top_left');
  });
});
