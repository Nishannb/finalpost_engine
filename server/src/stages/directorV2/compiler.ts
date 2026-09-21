/**
 * Stage 4 — resolve word ranges, validate, map to the existing VisualDirection.
 */

import type {
  FrameInset,
  MediaContainerMoment,
  MotionEntrance,
  MotionExit,
  MotionGraphic,
  MotionShape,
  SemanticEmphasis,
  DirectorRunReport,
} from '../../types/blueprint.ts';
import {
  MEDIA_CONTAINER_MODES,
  MOTION_ANCHORS,
  MOTION_ENTRANCES,
  MOTION_EXITS,
  MOTION_SHAPES,
} from '../../types/blueprint.ts';
import type {DirectedMoment, DirectedZoom, DirectedDepthOverlay, DirectedInsetReveal, VisualDirection} from '../broll/geminiDirector.ts';
import {isHugeSpokenNumber} from '../broll/fastCounter.ts';
import {parseSpokenMagnitude} from '../broll/fastCounter.ts';
import {
  auditPlanVsShipped,
  fromCreativePlan,
  mediaContextFromPack,
  sanityCheck,
  schedule,
  shippedFromScheduled,
  validate,
  type AssemblerReport,
} from '../../lib/assembler/index.ts';
import {dumpDirectorTrace} from '../../lib/directorDump.ts';
import {defaultDepthOverlayParams} from '../../lib/depthOverlay.ts';
import {defaultInsetRevealParams} from '../../lib/insetReveal.ts';
import {repairEdit} from './creativeDirector.ts';
import type {CompiledElement, CreativeElement, CreativePlan, PerceptionPack, StoryAnalysis} from './types.ts';
import {stageLogger} from '../../lib/logger.ts';

const log = stageLogger('director-v2-compiler');

export async function compileCreativePlan(input: {
  pack: PerceptionPack;
  plan: CreativePlan;
  story?: StoryAnalysis;
  forceSpeakerCutout?: boolean;
  noRepair?: boolean;
}): Promise<{
  direction: VisualDirection;
  report: DirectorRunReport;
  plan: CreativePlan;
  assembler: AssemblerReport;
}> {
  let plan = input.plan;
  const ctx = mediaContextFromPack(input.pack);
  const draftPlan = fromCreativePlan(plan, input.pack);
  let current = fromCreativePlan(plan, input.pack);
  let assembled = validate(current, ctx);
  let passes = 1;
  const firstRefusals = assembled.refusals;
  const firstRefusalCount = firstRefusals.length;

  if (assembled.refusals.length > 0 && !input.noRepair && input.story) {
    log.info({refusals: assembled.refusals.length}, 'repairing creative plan once');
    plan = await repairEdit(
      input.pack,
      plan,
      input.story,
      assembled.refusals.map(item => ({
        code: item.code,
        elementId: item.elementId,
        reason: item.message,
      })),
    );
    current = fromCreativePlan(plan, input.pack);
    assembled = validate(current, ctx);
    passes = 2;
  }

  const repairUnresolved = assembled.refusals.length;
  const repairResolved = Math.max(0, firstRefusalCount - repairUnresolved);
  const scheduled = schedule(assembled.plan, ctx);
  const originalById = new Map(plan.elements.map(element => [element.id, element]));
  const compiled: CompiledElement[] = scheduled.elements.flatMap(element => {
    const source = (element.source as CreativeElement | undefined) ?? originalById.get(element.id);
    if (!source) {
      return [];
    }
    return [{...source, start: element.resolved.start, end: element.resolved.end}];
  });
  const hook = scheduled.elements.find(element => element.kind === 'hook_title');
  const direction = toVisualDirection(plan, compiled, input.pack);
  if (hook) {
    direction.hookStartSec = hook.resolved.start;
    direction.hookEndSec = hook.resolved.end;
  }
  const sanity = sanityCheck(assembled.plan, ctx);
  const decisionLog = [
    ...assembled.log,
    {
      stage: 'repair',
      code: repairUnresolved === 0 ? 'repair_resolved' : 'repair_unresolved',
      detail: `resolved=${repairResolved} unresolved=${repairUnresolved}`,
    },
  ];
  if (draftPlan.coldOpen || assembled.plan.coldOpen || plan.coldOpen?.use) {
    const range = assembled.plan.coldOpen ?? draftPlan.coldOpen;
    decisionLog.push({
      stage: 'schedule',
      code: 'cold_open_not_applied',
      detail: range
        ? `${range.startWord}–${range.endWord} is recorded and not reordered.`
        : 'Director requested a cold open; the engine does not reorder the talking-head.',
    });
  }
  const diff = auditPlanVsShipped({
    plan: draftPlan,
    shipped: shippedFromScheduled(scheduled),
    scheduled,
    refusals: assembled.refusals,
    log: decisionLog,
  });
  const assembler: AssemblerReport = {
    draftPlan,
    plan: assembled.plan,
    scheduled: scheduled.elements,
    refusals: assembled.refusals,
    log: decisionLog,
    diff,
    sanity,
    repairResolved,
    repairUnresolved,
  };
  if (input.forceSpeakerCutout) {
    assembler.log.push({
      stage: 'validate',
      code: 'override:flag_over_director',
      detail: '--cutout is logged and not filled (cutout is not in the frozen set).',
    });
  }
  dumpDirectorTrace('v2-assembler', {
    draftElements: draftPlan.elements.map(element => ({
      id: element.id,
      kind: element.kind,
      startWord: element.anchor.startWord,
      endWord: element.anchor.endWord,
    })),
    refusalsSentToRepair: firstRefusals,
    repairedPlanElements: plan.elements.map(element => ({
      id: element.id,
      kind: element.kind,
      startWordId: element.wordRange.startWordId,
      endWordId: element.wordRange.endWordId,
      userBrollId: element.userBrollId,
    })),
    repairResolved,
    repairUnresolved,
    remainingRefusals: assembler.refusals,
    discardedAssets: assembled.plan.discardedAssets,
    scheduled: scheduled.elements.map(element => ({
      id: element.id,
      kind: element.kind,
      start: element.resolved.start,
      end: element.resolved.end,
    })),
    diff: assembler.diff,
  });
  const drops = assembled.refusals.map(item => `drop:${item.elementId}:${item.code}`);
  const violations = assembled.refusals.map(item => ({
    code: item.code,
    elementId: item.elementId,
    reason: item.message,
  }));
  for (const item of violations) {
    log.info(item, 'assembler refusal');
  }

  return {
    direction,
    plan,
    assembler,
    report: {
      source: 'director_v2',
      passes,
      violations,
      coercions: [],
      drops,
      assembler,
      perStageCostUsd: {creative: plan.estimatedCostUsd},
      perStageLatencyMs: {},
      promptVersions: {
        story: input.story?.promptVersion ?? '',
        creative: plan.promptVersion,
      },
      inputHashes: {
        story: input.story?.inputHash ?? '',
        creative: plan.inputHash,
      },
      stages: {
        ...(input.story
          ? {
              story: {
                promptVersion: input.story.promptVersion,
                inputHash: input.story.inputHash,
                output: input.story.raw,
                costUsd: input.story.estimatedCostUsd,
                latencyMs: 0,
              },
            }
          : {}),
        creative: {
          promptVersion: plan.promptVersion,
          output: plan.raw,
          inputHash: plan.inputHash,
          costUsd: plan.estimatedCostUsd,
          latencyMs: 0,
        },
      },
    },
  };
}



function toVisualDirection(
  plan: CreativePlan,
  elements: CompiledElement[],
  pack: PerceptionPack,
): VisualDirection {
  const moments: DirectedMoment[] = [];
  const zooms: DirectedZoom[] = [];
  const motionGraphics: MotionGraphic[] = [];
  const mediaContainers: MediaContainerMoment[] = [];
  const frameInsets: FrameInset[] = [];
  const semanticEmphasis: SemanticEmphasis[] = [];
  const depthOverlays: DirectedDepthOverlay[] = [];
  const insetReveals: DirectedInsetReveal[] = [];

  for (const element of elements) {
    if (element.kind === 'hook_title') {
      continue;
    }
    if (element.kind === 'zoom') {
      zooms.push({
        timestamp: element.start,
        durationSec: Math.max(0, element.end - element.start),
      });
      continue;
    }
    if (element.kind === 'kinetic_text' || element.kind === 'lockup') {
      if ((element.text || element.overlayText || '').trim()) {
        motionGraphics.push(toMotionGraphic(element));
      }
      if (element.kind === 'lockup') {
        moments.push(toMoment(element, 'text'));
      }
      continue;
    }
    if (element.kind === 'emphasis' || element.kind === 'counter') {
      semanticEmphasis.push(toEmphasis(element));
      continue;
    }
    if (element.kind === 'media_container') {
      mediaContainers.push(toContainer(element));
      continue;
    }
    if (element.kind === 'frame_inset') {
      frameInsets.push(toFrameInset(element));
      continue;
    }
    if (element.kind === 'depth_overlay') {
      depthOverlays.push(toDepthOverlay(element));
      continue;
    }
    if (element.kind === 'inset_reveal') {
      insetReveals.push(toInsetReveal(element, pack));
      continue;
    }
    if (element.kind === 'transition') {
      continue;
    }
    moments.push(
      toMoment(
        element,
        element.kind === 'cutaway' || element.kind === 'split' || element.kind === 'cutout'
          ? 'video'
          : element.kind === 'bubble'
            ? 'text'
            : 'image',
      ),
    );
  }

  const rawQueries = elements.flatMap(element =>
    element.queries && element.queries.length > 0
      ? element.queries
      : element.searchKeyword
        ? [element.searchKeyword]
        : [],
  );

  return {
    hookTitle: plan.hookTitle,
    hookSubtitle: '',
    hookStyle: plan.hookStyle,
    topic: plan.editThesis.slice(0, 160),
    visualQueries: rawQueries.slice(0, 6),
    caption: plan.caption,
    suggestedLutIds: plan.suggestedLutIds,
    preferredLutId: plan.preferredLutId,
    zooms,
    moments,
    motionGraphics,
    mediaContainers,
    frameInsets,
    depthOverlays,
    insetReveals,
    semanticEmphasis,
    estimatedCostUsd: plan.estimatedCostUsd,
    source: 'gemini',
  };
}

function toMoment(
  element: CompiledElement,
  media: DirectedMoment['media'],
): DirectedMoment {
  return {
    timestamp: element.start,
    searchKeyword: element.searchKeyword || element.overlayText || 'related scene',
    media,
    layout:
      element.layout && element.layout !== 'stat' && element.layout !== 'pip'
        ? element.layout
        : element.kind === 'cutout'
          ? 'cutout'
          : element.kind === 'bubble'
            ? 'bubble'
            : element.kind === 'split'
              ? 'split'
              : element.kind === 'cutaway'
                ? 'cutaway'
                : element.kind === 'card' || element.kind === 'slideshow'
                  ? 'card'
                  : 'lockup',
    anchor: element.anchor || 'top_right',
    overlayText: element.overlayText || element.text || '',
    textStyle: element.kind === 'bubble' ? 'bubble' : element.kind === 'lockup' ? 'stack' : 'outline',
    accentColor: element.accentColor || '#FFFFFF',
    userBrollId: element.userBrollId,
    treatment:
      element.kind === 'slideshow'
        ? 'slideshow'
        : element.treatment ?? element.params?.treatment,
    visualWeight: element.kind === 'cutout' || element.kind === 'split' ? 'hero' : 'accent',
    queries: (element.queries ?? []).slice(0, 6),
  };
}

const MOTION_GRAPHIC_DEFAULTS = {
  role: 'primary' as const,
  entrance: 'fade_blur' as MotionEntrance,
  exit: 'fade' as MotionExit,
  shape: 'none' as MotionShape,
  anchor: 'top' as MotionGraphic['anchor'],
  accentColor: '#F4E8C1',
  textColor: '#FFFFFF',
  fontScale: 1,
};

function toMotionGraphic(element: CompiledElement): MotionGraphic {
  const text = (element.text || element.overlayText || '').trim();
  const entrance = (MOTION_ENTRANCES as readonly string[]).includes(element.enter || '')
    ? (element.enter as MotionEntrance)
    : MOTION_GRAPHIC_DEFAULTS.entrance;
  const exit = (MOTION_EXITS as readonly string[]).includes(element.exit || '')
    ? (element.exit as MotionExit)
    : MOTION_GRAPHIC_DEFAULTS.exit;
  const shape = (MOTION_SHAPES as readonly string[]).includes(element.params?.shape || '')
    ? (element.params!.shape as MotionShape)
    : MOTION_GRAPHIC_DEFAULTS.shape;
  const anchor = (MOTION_ANCHORS as readonly string[]).includes(element.anchor || '')
    ? element.anchor
    : MOTION_GRAPHIC_DEFAULTS.anchor;
  return {
    start: element.start,
    end: element.end,
    text,
    role: MOTION_GRAPHIC_DEFAULTS.role,
    shape,
    accentColor: element.accentColor || MOTION_GRAPHIC_DEFAULTS.accentColor,
    textColor: element.textColor || MOTION_GRAPHIC_DEFAULTS.textColor,
    anchor: anchor as MotionGraphic['anchor'],
    entrance,
    exit,
    fontScale: element.params?.fontScale ?? MOTION_GRAPHIC_DEFAULTS.fontScale,
    italic: element.params?.italic,
  };
}

function toEmphasis(element: CompiledElement): SemanticEmphasis {
  const text = (element.text || element.overlayText || '').trim();
  const magnitude = parseSpokenMagnitude(text);
  const huge = Boolean(magnitude && isHugeSpokenNumber(magnitude));
  return {
    start: element.start,
    end: element.end,
    text,
    weight: 'primary',
    treatment: element.kind === 'counter' || huge ? 'count' : 'pop',
    accentColor: element.accentColor || '#F4E8C1',
    anchor: element.anchor,
    countFrom: element.params?.countFrom ?? magnitude?.countFrom,
    countTo: element.params?.countTo ?? magnitude?.countTo,
    countSuffix: element.params?.countSuffix ?? magnitude?.suffix,
  };
}

function toContainer(element: CompiledElement): MediaContainerMoment {
  const mode = (MEDIA_CONTAINER_MODES as readonly string[]).includes(
    element.params?.containerMode || '',
  )
    ? (element.params!.containerMode as MediaContainerMoment['mode'])
    : 'card';
  return {
    start: element.start,
    end: element.end,
    mode,
    canvasColor: element.params?.canvasColor || '#111111',
    cornerRadius: element.params?.cornerRadius ?? 28,
    scale: 0.72,
    transitionSec: 0.85,
    canvasTitle: element.text || element.overlayText,
  };
}

function toFrameInset(element: CompiledElement): FrameInset {
  const scaleRaw = Number(element.params?.scale);
  const scale = Number.isFinite(scaleRaw) ? Math.min(0.94, Math.max(0.7, scaleRaw)) : 0.86;
  const color =
    (element.params?.marginColor || element.params?.canvasColor || element.accentColor || '#000000').trim() ||
    '#000000';
  const transition = Number(element.params?.transitionSec);
  return {
    start: element.start,
    end: element.end,
    scale,
    marginColor: /^#([0-9a-f]{6})$/i.test(color) ? color : '#000000',
    cornerRadius: element.params?.cornerRadius ?? 18,
    transitionSec: Number.isFinite(transition) && transition > 0.4 ? transition : 0.9,
  };
}


function toDepthOverlay(element: CompiledElement): DirectedDepthOverlay {
  const params = defaultDepthOverlayParams({
    direction: element.params?.direction,
    opacity: element.params?.opacity,
    duration: element.params?.duration,
    exit: element.params?.exit,
    fit: element.params?.fit,
    feather: element.params?.feather,
  });
  return {
    start: element.start,
    end: element.end,
    assetId: element.userBrollId || '',
    direction: params.animation.direction,
    opacity: params.opacity,
    duration: params.animation.duration,
    reason: element.intent || '',
    searchKeyword: element.searchKeyword,
    queries: element.queries,
    userBrollId: element.userBrollId,
    exit: params.animation.exit,
    fit: params.region.fit,
  };
}


function toInsetReveal(element: CompiledElement, pack: PerceptionPack): DirectedInsetReveal {
  const params = defaultInsetRevealParams({
    variant: element.params?.variant,
    insetScale: element.params?.insetScale ?? element.params?.scale,
    backgroundType: element.params?.backgroundType as
      | 'solid'
      | 'gradient'
      | 'loop'
      | 'template'
      | undefined,
    backgroundValue:
      element.params?.backgroundValue ||
      element.params?.canvasColor ||
      element.accentColor ||
      pack.themeColors?.[0],
    graphicTemplateId: element.params?.graphicTemplateId,
    graphicText: element.params?.graphicText || element.text || element.overlayText,
    enterOffset: element.params?.enterOffset,
    exitOffset: element.params?.exitOffset,
    captionsEnabled: element.params?.captionsEnabled,
    easing: element.easing === 'spring' ? 'spring' : 'easeInOutCubic',
    shadow: element.params?.shadow,
    themeColor: pack.themeColors?.[0],
  });
  return {
    start: element.start,
    end: element.end,
    variant: params.variant,
    background: params.background,
    graphic: params.graphic
      ? {
          templateId: params.graphic.templateId,
          text: params.graphic.text,
          data: params.graphic.data,
        }
      : undefined,
    captions: params.captions.enabled,
    reason: element.intent || '',
    insetScale: params.insetScale,
    easing: params.easing,
    shadow: params.shadow,
  };
}
