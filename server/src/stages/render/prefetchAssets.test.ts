import {describe, expect, it} from 'vitest';

import {
  collectBlueprintMediaUrls,
  rewriteBlueprintMediaUrls,
} from './prefetchAssets.ts';
import type {TimelineBlueprint} from '../../types/blueprint.ts';

function blueprint(overrides: Partial<TimelineBlueprint> = {}): TimelineBlueprint {
  return {
    blueprintId: 'bp_test',
    createdAt: '2026-09-14T00:00:00.000Z',
    videoUrl: 'https://cdn.example/talking.mp4',
    languageCode: 'en',
    detectedLanguage: 'en',
    fps: 30,
    width: 1080,
    height: 1920,
    sourceDurationSec: 10,
    outputDurationSec: 10,
    words: [],
    captionWords: [],
    transcript: '',
    trimExclusions: [],
    keepSegments: [],
    zoomTriggers: [],
    brollClips: [
      {
        start: 2,
        end: 4,
        keyword: 'travel',
        assetUrl: 'https://videos.pexels.com/a.mp4',
        provider: 'pexels',
        providerId: 1,
        width: 1080,
        height: 1920,
        credit: 'A',
        creditUrl: 'https://pexels.com',
      },
    ],
    hookTitle: 'Go now',
    hookSubtitle: '',
    hookDurationSec: 3,
    hookStyle: 'impact',
    hookAnchor: 'top_right',
    speakerCutout: {
      available: true,
      keyColor: '#E8E4DC',
      similarity: 0.14,
      blend: 0.06,
      videoUrl: 'https://cdn.example/cutout.webm',
      speaker: {x: 0.2, y: 0.2, w: 0.6, h: 0.65},
    },
    visualOverlays: [
      {
        start: 1,
        end: 3,
        layout: 'split',
        mediaKind: 'video',
        anchor: 'top',
        keyword: 'city',
        overlayText: '',
        assetUrl: 'https://videos.pexels.com/b.mp4',
        provider: 'pexels',
        providerId: 2,
        width: 1080,
        height: 1920,
        credit: 'B',
        creditUrl: 'https://pexels.com',
        accentColor: '#FFFFFF',
        textStyle: 'bar',
      },
      {
        start: 4,
        end: 6,
        layout: 'lockup',
        mediaKind: 'text',
        anchor: 'top',
        keyword: 'follow',
        overlayText: 'FOLLOW',
        assetUrl: '',
        provider: 'generated',
        providerId: 0,
        width: 0,
        height: 0,
        credit: '',
        creditUrl: '',
        accentColor: '#FFFFFF',
        textStyle: 'bar',
      },
    ],
    transitions: [
      {
        at: 4,
        duration: 0.4,
        keyword: 'light leak',
        assetUrl: 'https://videos.pexels.com/wipe.mp4',
        blend: 'screen',
        provider: 'pexels',
        providerId: 3,
        width: 1080,
        height: 1920,
        credit: 'C',
        creditUrl: 'https://pexels.com',
      },
    ],
    motionGraphics: [],
    mediaContainers: [],
    frameInsets: [],
    semanticEmphasis: [],
    captionDirection: {
      position: 'bottom',
      bottomFrac: 0.18,
      textColor: '#fff',
      highlightColor: '#ff0',
      boxColor: null,
      template: 'classic',
    },
    colorGradeLut: '',
    suggestedLutIds: [],
    preferredLutId: '',
    stats: {
      wordCount: 0,
      sentenceCount: 0,
      silenceCutCount: 0,
      silenceRemovedSec: 0,
      zoomTriggerCount: 0,
      brollClipCount: 1,
      visualOverlayCount: 2,
      splitCount: 1,
      transitionCount: 1,
      motionGraphicCount: 0,
      mediaContainerCount: 0,
      semanticEmphasisCount: 0,
      hasHookTitle: true,
      timings: {},
      estimatedCostUsd: 0,
      warnings: [],
    },
    ...overrides,
  };
}

describe('prefetch rewrite', () => {
  it('collects talking-head, b-roll, overlay, and transition urls', () => {
    expect(collectBlueprintMediaUrls(blueprint())).toEqual([
      'https://cdn.example/talking.mp4',
      'https://cdn.example/cutout.webm',
      'https://videos.pexels.com/a.mp4',
      'https://videos.pexels.com/b.mp4',
      'https://videos.pexels.com/wipe.mp4',
    ]);
  });

  it('drops failed media overlays but keeps text lockups', () => {
    const rewritten = rewriteBlueprintMediaUrls(
      blueprint(),
      new Map([
        ['https://cdn.example/talking.mp4', '/prefetch/job/talk.mp4'],
        ['https://videos.pexels.com/a.mp4', ''],
        ['https://videos.pexels.com/b.mp4', ''],
        ['https://videos.pexels.com/wipe.mp4', '/prefetch/job/wipe.mp4'],
      ]),
    );
    expect(rewritten.videoUrl).toBe('/prefetch/job/talk.mp4');
    expect(rewritten.brollClips).toEqual([]);
    expect(rewritten.visualOverlays.map(overlay => overlay.layout)).toEqual(['lockup']);
    expect(rewritten.transitions).toHaveLength(1);
    expect(rewritten.stats.splitCount).toBe(0);
  });
});
