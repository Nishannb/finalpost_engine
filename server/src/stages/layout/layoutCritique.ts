/**
 * Cheap layout QA: geometric checks always, optional Vision patch on the
 * occupancy still. Patches rewrite the blueprint; the video still burns once.
 */

import {promises as fs} from 'node:fs';

import {env} from '../../config/env.ts';
import {requestJson} from '../../lib/http.ts';
import {stageLogger} from '../../lib/logger.ts';
import type {
  CaptionDirection,
  MediaContainerMoment,
  MotionGraphic,
  SemanticEmphasis,
  VisualAnchor,
  VisualOverlay,
} from '../../types/blueprint.ts';
import {
  CAPTION_BAND,
  hookRectForAnchor,
  legalHookAnchor,
  legalSlots,
  overlapArea,
  rectsOverlap,
  slotRectForAnchor,
  type Occupancy,
} from './occupancy.ts';
import {pipHasCanvasFill} from './slotCompositor.ts';

const log = stageLogger('layout-critique');

export type LayoutIssueKind =
  | 'empty_pip'
  | 'pip_covers_captions'
  | 'hook_covers_speaker'
  | 'graphic_covers_speaker'
  | 'emphasis_covers_speaker'
  | 'card_covers_captions';

export type LayoutIssue = {
  kind: LayoutIssueKind;
  at: number;
  detail: string;
  index?: number;
};

export type LayoutPlan = {
  hookAnchor: VisualAnchor;
  hookDurationSec: number;
  caption: CaptionDirection;
  motionGraphics: MotionGraphic[];
  overlays: VisualOverlay[];
  mediaContainers: MediaContainerMoment[];
  semanticEmphasis: SemanticEmphasis[];
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {parts?: Array<{text?: string}>};
  }>;
  usageMetadata?: {promptTokenCount?: number; candidatesTokenCount?: number};
};

const GEMINI_USD_PER_M_INPUT = 0.075;
const GEMINI_USD_PER_M_OUTPUT = 0.3;

export function findLayoutIssues(
  occupancy: Occupancy,
  plan: LayoutPlan,
): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  const paddedSpeaker = inflate(occupancy.speaker, 0.03);

  const hookRect = hookRectForAnchor(plan.hookAnchor);
  if (overlapArea(hookRect, paddedSpeaker) > 0.02) {
    issues.push({
      kind: 'hook_covers_speaker',
      at: 0,
      detail: `hook ${plan.hookAnchor} overlaps speaker`,
    });
  }

  plan.mediaContainers.forEach((container, index) => {
    if (container.mode !== 'pip_corner') {
      return;
    }
    if (!pipHasCanvasFill(container, plan.overlays, plan.motionGraphics)) {
      issues.push({
        kind: 'empty_pip',
        at: container.start,
        detail: 'pip_corner has no canvas fill',
        index,
      });
    }
    const pipRect = pipRectForAnchor(container.pipAnchor || 'bottom_right');
    if (rectsOverlap(pipRect, CAPTION_BAND, 0.01)) {
      issues.push({
        kind: 'pip_covers_captions',
        at: container.start,
        detail: `pip ${container.pipAnchor || 'bottom_right'} sits on captions`,
        index,
      });
    }
  });

  plan.motionGraphics.forEach((graphic, index) => {
    const rect = slotRectForAnchor(graphic.anchor);
    if (overlapArea(rect, paddedSpeaker) > 0.03) {
      issues.push({
        kind: 'graphic_covers_speaker',
        at: graphic.start,
        detail: `graphic "${graphic.text}" on ${graphic.anchor}`,
        index,
      });
    }
  });

  plan.semanticEmphasis.forEach((item, index) => {
    const rect = slotRectForAnchor(item.anchor || 'top_right');
    if (overlapArea(rect, paddedSpeaker) > 0.03) {
      issues.push({
        kind: 'emphasis_covers_speaker',
        at: item.start,
        detail: `emphasis "${item.text}" on ${item.anchor}`,
        index,
      });
    }
  });

  plan.overlays.forEach((overlay, index) => {
    if (
      overlay.layout === 'cutaway' ||
      overlay.layout === 'split' ||
      overlay.layout === 'composite'
    ) {
      return;
    }
    const rect = slotRectForAnchor(overlay.anchor);
    if (rectsOverlap(rect, CAPTION_BAND, 0.01)) {
      issues.push({
        kind: 'card_covers_captions',
        at: overlay.start,
        detail: `${overlay.layout} on ${overlay.anchor} hits caption band`,
        index,
      });
    }
  });

  return issues;
}

export function applyGeometricPatches(
  occupancy: Occupancy,
  plan: LayoutPlan,
): LayoutPlan {
  const hookAnchor = legalHookAnchor(occupancy);
  const safeGraphic = occupancy.graphicAnchor;
  const topAnchor: VisualAnchor =
    occupancy.preferredSide === 'right' ? 'top_right' : 'top_left';
  const pipSlots = legalSlots(occupancy).filter(slot => slot.kind === 'pip');

  const mediaContainers = plan.mediaContainers.flatMap(container => {
    if (container.mode !== 'pip_corner') {
      return [container];
    }
    if (!pipHasCanvasFill(container, plan.overlays, plan.motionGraphics)) {
      return [];
    }
    const current = pipRectForAnchor(container.pipAnchor || 'bottom_right');
    if (!rectsOverlap(current, CAPTION_BAND, 0.01) && pipSlots.some(slot => slot.anchor === container.pipAnchor)) {
      return [container];
    }
    const safer = pipSlots.find(slot => !rectsOverlap(slot.rect, CAPTION_BAND));
    if (!safer) {
      return [];
    }
    return [{...container, pipAnchor: safer.anchor}];
  });

  return {
    ...plan,
    hookAnchor,
    mediaContainers,
    motionGraphics: plan.motionGraphics.map(graphic => {
      const rect = slotRectForAnchor(graphic.anchor);
      if (overlapArea(rect, occupancy.speaker) <= 0.03 && graphic.anchor !== 'center') {
        return graphic;
      }
      return {...graphic, anchor: safeGraphic};
    }),
    semanticEmphasis: plan.semanticEmphasis.map(item => {
      const rect = slotRectForAnchor(item.anchor || 'top_right');
      if (overlapArea(rect, occupancy.speaker) <= 0.03) {
        return item;
      }
      return {...item, anchor: toVisual(safeGraphic)};
    }),
    overlays: plan.overlays.map(overlay => {
      if (
        overlay.layout === 'cutaway' ||
        overlay.layout === 'split' ||
        overlay.layout === 'composite'
      ) {
        return overlay;
      }
      const rect = slotRectForAnchor(overlay.anchor);
      if (!rectsOverlap(rect, CAPTION_BAND, 0.01)) {
        return overlay;
      }
      return {...overlay, anchor: topAnchor};
    }),
  };
}

export async function critiqueAndPatchLayout(input: {
  stillPath: string;
  occupancy: Occupancy;
  plan: LayoutPlan;
}): Promise<{
  plan: LayoutPlan;
  issues: LayoutIssue[];
  source: 'geometric' | 'geometric+vision';
  estimatedCostUsd: number;
}> {
  const geometric = applyGeometricPatches(input.occupancy, input.plan);
  const remaining = findLayoutIssues(input.occupancy, geometric);
  const vision = await critiqueLayoutWithVision({
    stillPath: input.stillPath,
    occupancy: input.occupancy,
    plan: geometric,
    issues: remaining,
  });
  if (!vision) {
    return {
      plan: geometric,
      issues: remaining,
      source: 'geometric',
      estimatedCostUsd: 0,
    };
  }
  const merged = applyVisionPatches(geometric, vision.patches);
  const enforced = applyGeometricPatches(input.occupancy, merged);
  return {
    plan: enforced,
    issues: findLayoutIssues(input.occupancy, enforced),
    source: 'geometric+vision',
    estimatedCostUsd: vision.estimatedCostUsd,
  };
}

export type VisionLayoutPatches = {
  drop_container_indexes?: number[];
  hook_anchor?: VisualAnchor;
  overlay_anchors?: Array<{index: number; anchor: VisualAnchor}>;
  graphic_anchors?: Array<{index: number; anchor: VisualAnchor}>;
  emphasis_anchors?: Array<{index: number; anchor: VisualAnchor}>;
  notes?: string;
};

export function applyVisionPatches(
  plan: LayoutPlan,
  patches: VisionLayoutPatches,
): LayoutPlan {
  const drop = new Set(
    (patches.drop_container_indexes ?? []).filter(
      index => Number.isInteger(index) && index >= 0,
    ),
  );
  const overlayByIndex = new Map(
    (patches.overlay_anchors ?? []).map(row => [row.index, row.anchor]),
  );
  const graphicByIndex = new Map(
    (patches.graphic_anchors ?? []).map(row => [row.index, row.anchor]),
  );
  const emphasisByIndex = new Map(
    (patches.emphasis_anchors ?? []).map(row => [row.index, row.anchor]),
  );
  return {
    ...plan,
    hookAnchor: coerceVisualAnchor(patches.hook_anchor) || plan.hookAnchor,
    mediaContainers: plan.mediaContainers.filter((_, index) => !drop.has(index)),
    overlays: plan.overlays.map((overlay, index) => {
      const anchor = coerceVisualAnchor(overlayByIndex.get(index));
      return anchor ? {...overlay, anchor} : overlay;
    }),
    motionGraphics: plan.motionGraphics.map((graphic, index) => {
      const anchor = coerceMotionAnchor(graphicByIndex.get(index));
      return anchor ? {...graphic, anchor} : graphic;
    }),
    semanticEmphasis: plan.semanticEmphasis.map((item, index) => {
      const anchor = coerceVisualAnchor(emphasisByIndex.get(index));
      return anchor ? {...item, anchor} : item;
    }),
  };
}

export function parseVisionPatches(raw: string | undefined): VisionLayoutPatches | null {
  if (!raw) {
    return null;
  }
  const json = raw.replace(/```json|```/g, '').trim();
  const match = json.match(/\{[\s\S]*\}/);
  if (!match) {
    return null;
  }
  try {
    return JSON.parse(match[0]) as VisionLayoutPatches;
  } catch {
    return null;
  }
}

async function critiqueLayoutWithVision(input: {
  stillPath: string;
  occupancy: Occupancy;
  plan: LayoutPlan;
  issues: LayoutIssue[];
}): Promise<{patches: VisionLayoutPatches; estimatedCostUsd: number} | null> {
  if (!env.GEMINI_API_KEY) {
    return null;
  }
  try {
    const jpeg = await fs.readFile(input.stillPath);
    const model = env.GEMINI_MODEL || 'gemini-3.6-flash';
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/` +
      `${encodeURIComponent(model)}:generateContent` +
      `?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;
    const summary = {
      speaker: input.occupancy.speaker,
      caption_band: CAPTION_BAND,
      hook_anchor: input.plan.hookAnchor,
      containers: input.plan.mediaContainers.map((container, index) => ({
        index,
        mode: container.mode,
        start: container.start,
        end: container.end,
        pip_anchor: container.pipAnchor,
        canvas_title: container.canvasTitle || '',
      })),
      overlays: input.plan.overlays.map((overlay, index) => ({
        index,
        layout: overlay.layout,
        anchor: overlay.anchor,
        start: overlay.start,
        has_asset: Boolean(overlay.assetUrl),
      })),
      graphics: input.plan.motionGraphics.map((graphic, index) => ({
        index,
        text: graphic.text,
        anchor: graphic.anchor,
        start: graphic.start,
      })),
      geometric_issues: input.issues,
    };
    const body = await requestJson<GeminiResponse>(url, {
      method: 'POST',
      label: 'Gemini layout critique',
      failureCode: 'broll_failed',
      timeoutMs: 20_000,
      retries: 0,
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: 'image/jpeg',
                  data: jpeg.toString('base64'),
                },
              },
              {
                text:
                  'Vertical talking-head frame plus a planned overlay layout (normalized 0-1).\n' +
                  'Find collisions with the person or the caption band, empty pip canvases, and oversized titles.\n' +
                  'Return ONLY JSON patches. Do not invent a look or copy an example style.\n' +
                  '{"drop_container_indexes":[],"hook_anchor":"top_left|top_right","overlay_anchors":[{"index":0,"anchor":"top_right"}],"graphic_anchors":[],"emphasis_anchors":[],"notes":""}\n' +
                  `PLAN:\n${JSON.stringify(summary)}`,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 400,
        },
      }),
    });
    const text = body.candidates?.[0]?.content?.parts
      ?.map(part => part.text ?? '')
      .join(' ')
      .trim();
    const patches = parseVisionPatches(text);
    if (!patches) {
      return null;
    }
    const inTok = body.usageMetadata?.promptTokenCount ?? 800;
    const outTok = body.usageMetadata?.candidatesTokenCount ?? 120;
    const estimatedCostUsd =
      (inTok / 1_000_000) * GEMINI_USD_PER_M_INPUT +
      (outTok / 1_000_000) * GEMINI_USD_PER_M_OUTPUT;
    return {patches, estimatedCostUsd};
  } catch (error) {
    log.warn({error}, 'layout vision critique skipped');
    return null;
  }
}

function pipRectForAnchor(anchor: VisualAnchor) {
  if (anchor === 'top_left') {
    return {x: 0.04, y: 0.08, w: 0.28, h: 0.24};
  }
  if (anchor === 'top_right' || anchor === 'top') {
    return {x: 0.68, y: 0.08, w: 0.28, h: 0.24};
  }
  if (anchor === 'bottom_left') {
    return {x: 0.04, y: 0.46, w: 0.28, h: 0.24};
  }
  return {x: 0.68, y: 0.46, w: 0.28, h: 0.24};
}

function inflate(
  rect: {x: number; y: number; w: number; h: number},
  pad: number,
) {
  return {
    x: rect.x - pad,
    y: rect.y - pad,
    w: rect.w + pad * 2,
    h: rect.h + pad * 2,
  };
}

function toVisual(anchor: Occupancy['graphicAnchor']): VisualAnchor {
  if (anchor === 'center' || anchor === 'top') {
    return 'top_right';
  }
  if (anchor === 'bottom') {
    return 'bottom_right';
  }
  return anchor;
}

const VISUAL: VisualAnchor[] = [
  'top',
  'top_left',
  'top_right',
  'bottom',
  'bottom_left',
  'bottom_right',
];

function coerceVisualAnchor(raw: unknown): VisualAnchor | undefined {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  return (VISUAL as string[]).includes(value) ? (value as VisualAnchor) : undefined;
}

function coerceMotionAnchor(raw: unknown): MotionGraphic['anchor'] | undefined {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (value === 'center') {
    return 'center';
  }
  return coerceVisualAnchor(value);
}
