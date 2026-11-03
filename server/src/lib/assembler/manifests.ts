import {
  DEPTH_OVERLAY_MAX_DURATION_SEC,
  DEPTH_OVERLAY_MAX_SHARE,
  DEPTH_OVERLAY_MIN_DURATION_SEC,
  DEPTH_OVERLAY_MIN_GAP_SEC,
} from '../depthOverlay.ts';
import {
  INSET_REVEAL_HOOK_GUARD_SEC,
  INSET_REVEAL_MAX_DURATION_SEC,
  INSET_REVEAL_MAX_SHARE,
  INSET_REVEAL_MIN_DURATION_SEC,
  INSET_REVEAL_MIN_GAP_SEC,
  INSET_REVEAL_TAIL_GUARD_SEC,
} from '../insetReveal.ts';
import type {ToolKind, ToolLayer} from './types.ts';

export type ToolManifest = {
  kind: ToolKind;
  layer: ToolLayer;
  requires: {
    speakerMask?: boolean;
    safeRegion?: boolean;
    userAsset?: boolean;
    stockAsset?: boolean;
  };
  replacesTalkingHead: boolean;
  minDurationSec?: number;
  maxDurationSec?: number;
  conflictsWith: ToolKind[];
  maxPerVideo?: number;
  maxCoverage?: number;
  minGapSec?: number;
  hookGuardSec?: number;
  tailGuardSec?: number;
};

export const TOOL_MANIFESTS: Record<ToolKind, ToolManifest> = {
  karaoke_caption: {
    kind: 'karaoke_caption',
    layer: 'caption',
    requires: {},
    replacesTalkingHead: false,
    conflictsWith: [],
    maxCoverage: 1,
  },
  hook_title: {
    kind: 'hook_title',
    layer: 'graphic_overlay',
    requires: {},
    replacesTalkingHead: false,
    minDurationSec: 0.8,
    maxDurationSec: 4.2,
    conflictsWith: [],
    maxPerVideo: 1,
  },
  zoom: {
    kind: 'zoom',
    layer: 'base',
    requires: {},
    replacesTalkingHead: false,
    minDurationSec: 1.2,
    maxDurationSec: 3.2,
    conflictsWith: ['cutaway', 'depth_overlay', 'transition'],
    maxCoverage: 0.25,
  },
  cutaway: {
    kind: 'cutaway',
    layer: 'base',
    requires: {},
    replacesTalkingHead: true,
    minDurationSec: 1.5,
    maxDurationSec: 6,
    conflictsWith: ['zoom', 'depth_overlay', 'transition'],
    maxCoverage: 0.4,
  },
  inset_reveal: {
    kind: 'inset_reveal',
    layer: 'video_overlay',
    requires: {},
    replacesTalkingHead: false,
    minDurationSec: INSET_REVEAL_MIN_DURATION_SEC,
    maxDurationSec: INSET_REVEAL_MAX_DURATION_SEC,
    conflictsWith: [],
    maxCoverage: INSET_REVEAL_MAX_SHARE,
    minGapSec: INSET_REVEAL_MIN_GAP_SEC,
    hookGuardSec: INSET_REVEAL_HOOK_GUARD_SEC,
    tailGuardSec: INSET_REVEAL_TAIL_GUARD_SEC,
  },
  motion_graphic: {
    kind: 'motion_graphic',
    layer: 'graphic_overlay',
    requires: {},
    replacesTalkingHead: false,
    minDurationSec: 1.2,
    maxDurationSec: 6,
    conflictsWith: [],
    maxCoverage: 0.35,
  },
  lower_third: {
    kind: 'lower_third',
    layer: 'graphic_overlay',
    requires: {},
    replacesTalkingHead: false,
    minDurationSec: 1.5,
    maxDurationSec: 5,
    conflictsWith: [],
    maxPerVideo: 2,
  },
  callout_highlight: {
    kind: 'callout_highlight',
    layer: 'graphic_overlay',
    requires: {},
    replacesTalkingHead: false,
    minDurationSec: 0.6,
    maxDurationSec: 3,
    conflictsWith: [],
    maxCoverage: 0.2,
  },
  transition: {
    kind: 'transition',
    layer: 'base',
    requires: {},
    replacesTalkingHead: false,
    minDurationSec: 0.2,
    maxDurationSec: 0.8,
    conflictsWith: ['zoom', 'cutaway'],
  },
  // Split screen: the planner's own minimum hold is 3.8 s (resolveMoment) and its related-media requirement is enforced there.
  split: {
    kind: 'split',
    layer: 'base',
    requires: {},
    replacesTalkingHead: false,
    minDurationSec: 3.8,
    maxDurationSec: 12,
    conflictsWith: ['cutaway', 'zoom', 'depth_overlay', 'inset_reveal', 'frame_inset', 'media_container', 'slideshow', 'cutout', 'transition'],
    maxCoverage: 0.5,
  },
  // Matched layouts. Hold windows mirror resolveMoment (slideshow min hold 3.6 s, cutout/card >= 1.6 s).
  slideshow: {
    kind: 'slideshow',
    layer: 'base',
    requires: {},
    replacesTalkingHead: false,
    minDurationSec: 3.6,
    maxDurationSec: 12,
    conflictsWith: ['cutaway', 'zoom', 'depth_overlay', 'inset_reveal', 'frame_inset', 'media_container', 'split', 'transition'],
    maxCoverage: 0.5,
  },
  // CutoutStage draws the keyed speaker video; without a real speaker-mask alpha video it would be a plain picture.
  cutout: {
    kind: 'cutout',
    layer: 'base',
    requires: {speakerMask: true},
    replacesTalkingHead: false,
    minDurationSec: 1.6,
    maxDurationSec: 8,
    conflictsWith: ['cutaway', 'zoom', 'depth_overlay', 'inset_reveal', 'frame_inset', 'media_container', 'split', 'slideshow', 'transition'],
    maxCoverage: 0.4,
  },
  // Overlays drawn above the picture. Their screen-space collisions are decided by the shared geometry validator (editConflicts).
  card: {kind: 'card', layer: 'graphic_overlay', requires: {}, replacesTalkingHead: false, minDurationSec: 1.6, maxDurationSec: 8, conflictsWith: [], maxCoverage: 0.35},
  bubble: {kind: 'bubble', layer: 'graphic_overlay', requires: {}, replacesTalkingHead: false, minDurationSec: 1.4, maxDurationSec: 7, conflictsWith: [], maxCoverage: 0.3},
  lockup: {kind: 'lockup', layer: 'graphic_overlay', requires: {}, replacesTalkingHead: false, minDurationSec: 1.4, maxDurationSec: 7, conflictsWith: [], maxCoverage: 0.35},
  kinetic_text: {kind: 'kinetic_text', layer: 'graphic_overlay', requires: {}, replacesTalkingHead: false, minDurationSec: 1, maxDurationSec: 8, conflictsWith: [], maxCoverage: 0.4},
  counter: {kind: 'counter', layer: 'graphic_overlay', requires: {}, replacesTalkingHead: false, minDurationSec: 0.8, maxDurationSec: 6, conflictsWith: [], maxCoverage: 0.25},
  emphasis: {kind: 'emphasis', layer: 'graphic_overlay', requires: {}, replacesTalkingHead: false, minDurationSec: 0.8, maxDurationSec: 6, conflictsWith: [], maxCoverage: 0.25},
  // Whole-picture treatments the planner already remaps (brollPlanner remapFrameInsets / remapMediaContainers):
  // frame inset needs >= 3.2 s and is capped at 2 per video, media container needs >= 2.4 s and is capped at 3.
  frame_inset: {
    kind: 'frame_inset',
    layer: 'base',
    requires: {},
    replacesTalkingHead: false,
    minDurationSec: 3.2,
    maxDurationSec: 10,
    conflictsWith: ['cutaway', 'zoom', 'depth_overlay', 'inset_reveal', 'media_container', 'split', 'slideshow', 'cutout'],
    maxPerVideo: 2,
    maxCoverage: 0.4,
  },
  media_container: {
    kind: 'media_container',
    layer: 'base',
    requires: {},
    replacesTalkingHead: false,
    minDurationSec: 2.4,
    maxDurationSec: 12,
    conflictsWith: ['cutaway', 'zoom', 'depth_overlay', 'inset_reveal', 'frame_inset', 'split', 'slideshow', 'cutout'],
    maxPerVideo: 3,
    maxCoverage: 0.5,
  },
  depth_overlay: {
    kind: 'depth_overlay',
    layer: 'video_overlay',
    requires: {speakerMask: true},
    replacesTalkingHead: false,
    minDurationSec: DEPTH_OVERLAY_MIN_DURATION_SEC,
    maxDurationSec: DEPTH_OVERLAY_MAX_DURATION_SEC,
    conflictsWith: ['zoom', 'cutaway'],
    maxCoverage: DEPTH_OVERLAY_MAX_SHARE,
    minGapSec: DEPTH_OVERLAY_MIN_GAP_SEC,
  },
};

export const LAYER_Z: Record<ToolLayer, number> = {
  base: 0,
  video_overlay: 10,
  graphic_overlay: 20,
  caption: 30,
  audio: 40,
};
