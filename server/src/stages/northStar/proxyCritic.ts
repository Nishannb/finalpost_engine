import {stageLogger} from '../../lib/logger.ts';
import type {
  MotionGraphic,
  SemanticEmphasis,
  VisualAnchor,
  VisualOverlay,
} from '../../types/blueprint.ts';
import type {PerceptionPack} from '../directorV2/types.ts';
import {callDirectorModel, frameParts} from '../directorV2/geminiClient.ts';

const log = stageLogger('north-star-critic');

const ANCHORS = [
  'top',
  'top_left',
  'top_right',
  'bottom',
  'bottom_left',
  'bottom_right',
] as const;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    drop_overlay_indexes: {type: 'ARRAY', items: {type: 'INTEGER'}},
    drop_graphic_indexes: {type: 'ARRAY', items: {type: 'INTEGER'}},
    drop_emphasis_indexes: {type: 'ARRAY', items: {type: 'INTEGER'}},
    overlay_anchors: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {index: {type: 'INTEGER'}, anchor: {type: 'STRING'}},
        required: ['index', 'anchor'],
      },
    },
    graphic_anchors: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {index: {type: 'INTEGER'}, anchor: {type: 'STRING'}},
        required: ['index', 'anchor'],
      },
    },
    notes: {type: 'STRING'},
  },
  required: [
    'drop_overlay_indexes',
    'drop_graphic_indexes',
    'drop_emphasis_indexes',
    'overlay_anchors',
    'graphic_anchors',
    'notes',
  ],
};

export async function critiqueNorthStarProxy(input: {
  pack?: PerceptionPack;
  overlays: VisualOverlay[];
  motionGraphics: MotionGraphic[];
  semanticEmphasis: SemanticEmphasis[];
}): Promise<{
  overlays: VisualOverlay[];
  motionGraphics: MotionGraphic[];
  semanticEmphasis: SemanticEmphasis[];
  estimatedCostUsd: number;
  notes: string;
}> {
  if (!input.pack || input.pack.storyboard.length === 0) {
    return {...input, estimatedCostUsd: 0, notes: 'critic:no_storyboard'};
  }
  try {
    const frames = await frameParts(
      input.pack.storyboard.map(frame => frame.path),
      6,
    );
    const plan = {
      overlays: input.overlays.map((item, index) => ({
        index,
        start: item.start,
        end: item.end,
        layout: item.layout,
        anchor: item.anchor,
        text: item.overlayText,
        visual_weight: item.visualWeight,
      })),
      graphics: input.motionGraphics.map((item, index) => ({
        index,
        start: item.start,
        end: item.end,
        anchor: item.anchor,
        text: item.text,
        role: item.role,
        shape: item.shape,
        text_color: item.textColor,
        accent_color: item.accentColor,
      })),
      emphasis: input.semanticEmphasis.map((item, index) => ({
        index,
        start: item.start,
        end: item.end,
        anchor: item.anchor,
        text: item.text,
        weight: item.weight,
      })),
    };
    const result = await callDirectorModel({
      system:
        'You are the final quality-control motion designer for a vertical talking-head edit. The attached source frames are labeled over time and the JSON lists planned elements. Patch only obvious failures: type over face/hair/eyes, two heroes at once, overlong text in a corner, or decorative clutter. Prefer dropping a weak element. Do not add elements, rewrite copy, or create a new style. JSON only.',
      label: 'North-star proxy composite critic',
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0,
      thinkingBudget: 0,
      timeoutMs: 60_000,
      parts: [
        ...frames,
        {
          text:
            'Treat each planned element as if composited over the source frame at its start/end time. ' +
            'Bottom 24% is captions. Keep emotional face moments clean. ' +
            `PLAN:\n${JSON.stringify(plan)}`,
        },
      ],
    });
    const raw =
      result.json && typeof result.json === 'object'
        ? (result.json as Record<string, unknown>)
        : {};
    const dropOverlay = indexes(raw.drop_overlay_indexes, input.overlays.length);
    const dropGraphic = indexes(raw.drop_graphic_indexes, input.motionGraphics.length);
    const dropEmphasis = indexes(
      raw.drop_emphasis_indexes,
      input.semanticEmphasis.length,
    );
    const overlayAnchors = anchorPatches(raw.overlay_anchors);
    const graphicAnchors = anchorPatches(raw.graphic_anchors);

    return {
      overlays: input.overlays
        .map((item, index) => {
          const anchor = overlayAnchors.get(index);
          return {item: anchor ? {...item, anchor} : item, index};
        })
        .filter(row => !dropOverlay.has(row.index))
        .map(row => row.item),
      motionGraphics: input.motionGraphics
        .map((item, index) => {
          const anchor = graphicAnchors.get(index);
          return {item: anchor ? {...item, anchor} : item, index};
        })
        .filter(row => !dropGraphic.has(row.index))
        .map(row => row.item),
      semanticEmphasis: input.semanticEmphasis.filter(
        (_, index) => !dropEmphasis.has(index),
      ),
      estimatedCostUsd: result.estimatedCostUsd,
      notes: String(raw.notes ?? ''),
    };
  } catch (error) {
    log.warn({error}, 'proxy critic failed; deterministic laws remain active');
    return {...input, estimatedCostUsd: 0, notes: 'critic:failed'};
  }
}

function indexes(raw: unknown, length: number): Set<number> {
  if (!Array.isArray(raw)) {
    return new Set();
  }
  return new Set(
    raw
      .map(value => Math.round(Number(value)))
      .filter(value => Number.isInteger(value) && value >= 0 && value < length),
  );
}

function anchorPatches(raw: unknown): Map<number, VisualAnchor> {
  const out = new Map<number, VisualAnchor>();
  if (!Array.isArray(raw)) {
    return out;
  }
  for (const row of raw) {
    if (!row || typeof row !== 'object') {
      continue;
    }
    const record = row as Record<string, unknown>;
    const index = Math.round(Number(record.index));
    const anchor = String(record.anchor ?? '') as VisualAnchor;
    if (Number.isInteger(index) && (ANCHORS as readonly string[]).includes(anchor)) {
      out.set(index, anchor);
    }
  }
  return out;
}
