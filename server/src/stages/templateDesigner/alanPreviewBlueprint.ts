/**
 * Black-screen caption demo for a reverse-engineered EditSpec.
 *
 * Alan speaks a fixed intro so the creator reviews the *style*, not the
 * reference video's own words.
 */

import {randomUUID} from 'node:crypto';

import type {
  CaptionWord,
  TimelineBlueprint,
  WordToken,
  ZoomTrigger,
} from '../../types/blueprint.ts';
import type {EditSpec} from '../../types/editSpec.ts';
import {editSpecRenderHints, editSpecToCaptionDirection} from './applyEditSpec.ts';

export const ALAN_BLACK_VIDEO_SRC = 'staticFile:black-audio.mp4';
export const ALAN_PREVIEW_DURATION_SEC = 6.96;
export const ALAN_CAPTION_SCRIPT =
  'Hi I am Alan the Designer, I was reverse engineer this template, Let me know if it looks good.';

const ALAN_WORDS: CaptionWord[] = [
  {text: 'Hi', start: 0.38, end: 0.62, sentenceIndex: 0},
  {text: 'I', start: 0.62, end: 0.78, sentenceIndex: 0},
  {text: 'am', start: 0.78, end: 0.98, sentenceIndex: 0},
  {text: 'Alan', start: 0.98, end: 1.38, sentenceIndex: 0},
  {text: 'the', start: 1.38, end: 1.56, sentenceIndex: 0},
  {text: 'Designer', start: 1.56, end: 2.18, sentenceIndex: 0},
  {text: 'I', start: 2.36, end: 2.52, sentenceIndex: 1},
  {text: 'was', start: 2.52, end: 2.74, sentenceIndex: 1},
  {text: 'reverse', start: 2.74, end: 3.22, sentenceIndex: 1},
  {text: 'engineer', start: 3.22, end: 3.78, sentenceIndex: 1},
  {text: 'this', start: 3.78, end: 4.02, sentenceIndex: 1},
  {text: 'template', start: 4.02, end: 4.62, sentenceIndex: 1},
  {text: 'Let', start: 4.82, end: 5.04, sentenceIndex: 2},
  {text: 'me', start: 5.04, end: 5.2, sentenceIndex: 2},
  {text: 'know', start: 5.2, end: 5.48, sentenceIndex: 2},
  {text: 'if', start: 5.48, end: 5.64, sentenceIndex: 2},
  {text: 'it', start: 5.64, end: 5.8, sentenceIndex: 2},
  {text: 'looks', start: 5.8, end: 6.1, sentenceIndex: 2},
  {text: 'good', start: 6.1, end: 6.55, sentenceIndex: 2},
];

export function alanCaptionWords(): CaptionWord[] {
  return ALAN_WORDS.map(word => ({...word}));
}

export function buildAlanPreviewBlueprint(input: {
  spec: EditSpec;
  designJobId: string;
}): TimelineBlueprint {
  const duration = ALAN_PREVIEW_DURATION_SEC;
  const captionWords = alanCaptionWords();
  const words: WordToken[] = captionWords.map(({text, start, end}) => ({
    text,
    start,
    end,
  }));
  const zoomTriggers = alanEmphasisZooms(input.spec, captionWords, duration);
  const now = new Date().toISOString();
  const id = `bp_alan_${input.designJobId.replace(/[^a-z0-9]/gi, '').slice(0, 16)}_${randomUUID().slice(0, 6)}`;

  return {
    blueprintId: id,
    createdAt: now,
    videoUrl: ALAN_BLACK_VIDEO_SRC,
    languageCode: 'en',
    detectedLanguage: 'en',
    fps: 24,
    width: 1080,
    height: 1920,
    sourceDurationSec: duration,
    outputDurationSec: duration,
    words,
    captionWords,
    transcript: ALAN_CAPTION_SCRIPT,
    trimExclusions: [],
    keepSegments: [{sourceStart: 0, sourceEnd: duration, outputStart: 0}],
    zoomTriggers,
    brollClips: [],
    depthOverlays: [],
    insetReveals: [],
    hookTitle: '',
    hookSubtitle: '',
    hookDurationSec: 0,
    hookStartSec: 0,
    hookStyle: 'minimal',
    hookAnchor: 'top_right',
    visualOverlays: [],
    transitions: [],
    motionGraphics: [],
    mediaContainers: [],
    frameInsets: [],
    semanticEmphasis: [],
    captionDirection: editSpecToCaptionDirection(input.spec),
    colorGradeLut: '',
    suggestedLutIds: [],
    preferredLutId: '',
    stats: {
      wordCount: captionWords.length,
      sentenceCount: 3,
      silenceCutCount: 0,
      silenceRemovedSec: 0,
      zoomTriggerCount: zoomTriggers.length,
      brollClipCount: 0,
      depthOverlayCount: 0,
      insetRevealCount: 0,
      visualOverlayCount: 0,
      splitCount: 0,
      transitionCount: 0,
      motionGraphicCount: 0,
      mediaContainerCount: 0,
      frameInsetCount: 0,
      semanticEmphasisCount: 0,
      hasHookTitle: false,
      timings: {},
      estimatedCostUsd: 0,
      warnings: [],
    },
  };
}

export function alanPreviewRenderStyle(spec: EditSpec) {
  const hints = editSpecRenderHints(spec);
  return {
    captionTemplate: hints.captionTemplate,
    layoutStyle: 'fullscreen' as const,
    captionBottomFrac: hints.captionBottomFrac,
    captionCenterXFrac: hints.captionCenterXFrac,
    brollEnabled: false,
    zoomEnabled: hints.zoomEnabled,
    trimEnabled: false,
    colorGradeLut: '',
  };
}

function alanEmphasisZooms(
  spec: EditSpec,
  words: CaptionWord[],
  duration: number,
): ZoomTrigger[] {
  if (!spec.camera.emphasisZoom.enabled) {
    return [];
  }
  const hit =
    words.find(word => /designer/i.test(word.text)) ??
    words.find(word => /template/i.test(word.text));
  if (!hit) {
    return [];
  }
  const hold = Math.min(1.2, Math.max(0.22, spec.camera.emphasisZoom.durationMs / 1000));
  return [
    {
      start: hit.start,
      end: Math.min(duration, hit.start + hold),
      scale: spec.camera.emphasisZoom.scale,
      sentenceIndex: hit.sentenceIndex,
    },
  ];
}
