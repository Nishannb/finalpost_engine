/**
 * Stage C.1 — visual direction: hook title, B-roll cutaways, image composites.
 *
 * Gemini never sees the pixels. It reads the transcript and returns a creative
 * brief (hook copy + timed moments). Stock lookup and timeline mapping happen
 * after this so a malformed JSON reply cannot brick the rest of the pipeline.
 */

import {env} from '../../config/env.ts';
import {EngineError} from '../../lib/errors.ts';
import {requestJson} from '../../lib/http.ts';
import {stageLogger} from '../../lib/logger.ts';
import type {
  CaptionDirection,
  CaptionPosition,
  CaptionTemplateId,
  HookStyle,
  OverlayTextStyle,
  VisualAnchor,
  VisualMediaKind,
  VisualOverlayLayout,
} from '../../types/blueprint.ts';
import {CAPTION_TEMPLATES, HOOK_STYLES} from '../../types/blueprint.ts';
import {
  coerceLutId,
  formatLutsForDirectorPrompt,
  parseSuggestedLutIds,
  shortlistLutsForDirector,
} from '../color/lutCatalog.ts';
import {listAvailableLuts} from '../color/luts.ts';
import {ensureEnglishSearchQuery} from './englishSearch.ts';
import {listBeatsFromTranscript} from './listBeats.ts';
import {
  applySubjectToQuery,
  inferStockSubject,
  keyPhrasesFromTranscript,
  sanitizeVisualQuery,
  themeQueriesFromTranscript,
} from './visualQuery.ts';
import {
  fallbackMotionPlan,
  parseMotionPlanFromDirector,
} from './motionGraphicsPlan.ts';
import type {
  MediaContainerMoment,
  MotionGraphic,
  SemanticEmphasis,
} from '../../types/blueprint.ts';

const log = stageLogger('stage-c-director');

/** Flash pricing (per 1M tokens) — a 5-minute transcript is ~1k tokens. */
const GEMINI_USD_PER_M_INPUT = 0.075;
const GEMINI_USD_PER_M_OUTPUT = 0.3;

const LAYOUTS: VisualOverlayLayout[] = [
  'cutaway',
  'composite',
  'pip',
  'sticker',
  'lockup',
  'chip',
  'banner',
  'split',
  'stat',
];

const ANCHORS: VisualAnchor[] = [
  'top',
  'top_left',
  'top_right',
  'bottom',
  'bottom_left',
  'bottom_right',
];

const MEDIA_KINDS: VisualMediaKind[] = ['video', 'image', 'text'];

const SYSTEM_INSTRUCTION = `You are the Creative Director + Motion Designer for a vertical talking-head short.

Your job is NOT to pick templates. Your job is to invent an engaging, motion-graphics-forward edit using reusable VISUAL MECHANISMS.

Core principle: CONTENT ≠ DESIGN.
Do not invent primitives around specific words like "wedding" or "£90k".
Invent mechanisms: oversized semantic emphasis, graphic-backed typography, media container transforms, staggered reveals, canvas reveals.

Creativity rules (critical):
- Treat this as a DESIGN SPACE. Vary compositions every video. Surprise the viewer.
- Prefer MOTION GRAPHICS on top of B-roll/zooms/captions you already know.
- Think in visual states: full-bleed → transform → inset/card/editorial → back.
- When the speaker makes a strong claim, number, or keyword — give it visual weight with motion type.
- Stylish titles should ENTER the frame (spring, slide, stagger, scale-pop) — not just appear.
- You may combine mechanisms freely. There is no single "correct" look.
- Restraint still matters: do not stack everything at once. Pace the graphics.

Return ONE JSON object:
{
  "topic": string,
  "visual_world": [string, string, string, string],
  "hook_title": string,
  "hook_style": "impact" | "boxed" | "minimal" | "bar" | "stack" | "outline" | "rail" | "poster" | "underline" | "duo",
  "caption": {
    "template": "hormozi" | "mrbeast" | "karaoke" | "classic" | "box" | "bounce" | "minimal",
    "position": "bottom" | "lower_third" | "center" | "top",
    "text_color": "#RRGGBB",
    "highlight_color": "#RRGGBB",
    "box": boolean,
    "box_color": "#RRGGBB" or ""
  },
  "preferred_lut": string,
  "suggested_luts": [string, string, string],
  "zooms": [{"timestamp": number, "duration": number}],
  "moments": [
    {
      "timestamp": number,
      "search_keyword": string,
      "why": string,
      "media": "video" | "text",
      "layout": "cutaway" | "lockup" | "chip" | "banner" | "split",
      "anchor": "top" | "top_left" | "top_right" | "bottom" | "bottom_left" | "bottom_right",
      "overlay_text": string,
      "text_style": "outline" | "bar" | "chip" | "poster" | "stack",
      "accent_color": "#RRGGBB",
      "user_broll_id": "ub_1" | ""
    }
  ],
  "motion_graphics": [
    {
      "start": number,
      "end": number,
      "text": string,
      "role": "primary" | "secondary" | "accent",
      "shape": "none" | "underline" | "pill" | "bar" | "block" | "outline_box",
      "accent_color": "#RRGGBB",
      "text_color": "#RRGGBB",
      "anchor": "top" | "top_left" | "top_right" | "center" | "bottom" | "bottom_left" | "bottom_right",
      "entrance": "spring_up" | "slide_left" | "slide_right" | "scale_pop" | "fade_blur" | "type_stagger" | "mask_wipe",
      "exit": "fade" | "spring_out" | "slide_away",
      "font_scale": number,
      "italic": boolean
    }
  ],
  "media_containers": [
    {
      "start": number,
      "end": number,
      "mode": "inset" | "card" | "rounded_window",
      "canvas_color": "#RRGGBB",
      "corner_radius": number,
      "scale": number,
      "transition_sec": number,
      "canvas_title": string,
      "canvas_title_color": "#RRGGBB"
    }
  ],
  "semantic_emphasis": [
    {
      "start": number,
      "end": number,
      "text": string,
      "weight": "primary" | "secondary",
      "treatment": "scale" | "color" | "highlight_shape" | "pop" | "underline",
      "accent_color": "#RRGGBB"
    }
  ]
}

Meaning:
- topic / visual_world / hook_*: same as before (English scene queries; unique hook).
- moments: B-roll cutaways / splits / lockups (stock or user B-roll).
- motion_graphics: stylish motion titles/callouts. Prefer 2–4. Vary entrance+shape every video.
  Text should be short (2–6 words) pulled from the spoken idea — not a full sentence.
- media_containers: animate full-bleed talking-head into inset/card while canvas reveals.
  Use 0–2 times. Great after a hook or before a big claim. canvas_title optional.
- semantic_emphasis: speech-timed punch on numbers/claims/keywords (1–4). Keep text SHORT.

Layouts for moments (video only for motion):
- cutaway: FULL-SCREEN related VIDEO 2.2–2.8s.
- split: related VIDEO half + speaker half ~2.4s. media=video ALWAYS.
- lockup stack: side slogan card, never over the face.
- Do NOT use composite, pip, sticker, or media=image.

Hard rules:
- At least TWO cutaway video moments.
- Exactly one split when duration > 20s (unless list beats need more cutaways).
- 1–2 stack lockups for spoken slogans.
- At least TWO motion_graphics when duration > 12s (vary entrance+shape).
- At least ONE media_container when duration > 18s.
- At least ONE semantic_emphasis when a number/claim exists; else one keyword punch.
- No motion_graphic / container / emphasis in first 3.2s (hook owns the open).
- Avoid overlapping two primary motion_graphics; keep ≥1.2s gap between heavy beats.
- Captions: vary template+position+box every video (same rules as before).
- Color grade: preferred_lut + suggested_luts from AVAILABLE_LUTS.
- zooms: 2–4, never in first 3.5s, never during cutaway/split.
- USER_BROLL: prefer matching ids on cutaway/split when provided.
- Output JSON only.`;

export type DirectedMoment = {
  timestamp: number;
  searchKeyword: string;
  media: VisualMediaKind;
  layout: VisualOverlayLayout;
  anchor: VisualAnchor;
  overlayText: string;
  textStyle: OverlayTextStyle;
  accentColor: string;
  /** When set, prefer this creator-uploaded B-roll over stock. */
  userBrollId?: string | null;
};

export type DirectedZoom = {
  timestamp: number;
  durationSec: number;
};

export type VisualDirection = {
  hookTitle: string;
  hookSubtitle: string;
  hookStyle: HookStyle;
  topic: string;
  visualQueries: string[];
  caption: CaptionDirection;
  /** Ranked LUT ids from the on-disk catalog (max 3). */
  suggestedLutIds: string[];
  /** Best single LUT id to apply (may be empty = natural). */
  preferredLutId: string;
  zooms: DirectedZoom[];
  moments: DirectedMoment[];
  motionGraphics: MotionGraphic[];
  mediaContainers: MediaContainerMoment[];
  semanticEmphasis: SemanticEmphasis[];
  estimatedCostUsd: number;
  source: 'gemini' | 'fallback';
};

export function directorConfigured(): boolean {
  return Boolean(env.GEMINI_API_KEY);
}

type GeminiResponse = {
  candidates?: Array<{
    content?: {parts?: Array<{text?: string}>};
    finishReason?: string;
  }>;
  usageMetadata?: {promptTokenCount?: number; candidatesTokenCount?: number};
};

export async function planVisualDirection(input: {
  transcript: string;
  sourceDurationSec: number;
  momentCount: number;
  userBrollAssets?: Array<{id: string; description: string; durationSec: number}>;
}): Promise<VisualDirection> {
  const momentCount = Math.max(1, Math.min(8, Math.round(input.momentCount)));
  const fallback = fallbackVisualDirection({
    transcript: input.transcript,
    sourceDurationSec: input.sourceDurationSec,
    momentCount,
  });

  if (!directorConfigured()) {
    return fallback;
  }

  const preferred = env.GEMINI_MODEL || 'gemini-3.6-flash';
  const models = [
    ...new Set([preferred, 'gemini-3.6-flash', 'gemini-3.7-flash']),
  ];

  let lastError: unknown;
  for (const model of models) {
    try {
      const directed = await callGemini({
        transcript: input.transcript,
        sourceDurationSec: input.sourceDurationSec,
        momentCount,
        model,
        userBrollAssets: input.userBrollAssets,
      });
      if (directed.moments.length === 0 && !directed.hookTitle) {
        throw new EngineError('broll_failed', 'Director returned an empty brief');
      }
      return {
        ...directed,
        hookTitle: oneLineHook(directed.hookTitle || fallback.hookTitle),
        hookSubtitle: '',
        hookStyle: directed.hookStyle || fallback.hookStyle,
        topic: directed.topic || fallback.topic,
        visualQueries:
          directed.visualQueries.length > 0 ? directed.visualQueries : fallback.visualQueries,
        caption: directed.caption,
        suggestedLutIds:
          directed.suggestedLutIds.length > 0
            ? directed.suggestedLutIds
            : fallback.suggestedLutIds,
        preferredLutId: directed.preferredLutId || fallback.preferredLutId,
        zooms: directed.zooms.length > 0 ? directed.zooms : fallback.zooms,
        moments:
          directed.moments.length > 0 ? directed.moments : fallback.moments,
        motionGraphics:
          directed.motionGraphics.length > 0
            ? directed.motionGraphics
            : fallback.motionGraphics,
        mediaContainers:
          directed.mediaContainers.length > 0
            ? directed.mediaContainers
            : fallback.mediaContainers,
        semanticEmphasis:
          directed.semanticEmphasis.length > 0
            ? directed.semanticEmphasis
            : fallback.semanticEmphasis,
        source: 'gemini',
      };
    } catch (error) {
      lastError = error;
      log.warn({model, error}, 'gemini model failed; trying fallback');
    }
  }

  log.warn({error: lastError}, 'all gemini models failed; using keyword fallback');
  return fallback;
}

/** @deprecated Prefer planVisualDirection — kept for older call sites. */
export async function planBRollMoments(input: {
  transcript: string;
  sourceDurationSec: number;
  momentCount: number;
}): Promise<{moments: Array<{timestamp: number; searchKeyword: string}>; estimatedCostUsd: number}> {
  const directed = await planVisualDirection(input);
  return {
    moments: directed.moments.map(moment => ({
      timestamp: moment.timestamp,
      searchKeyword: moment.searchKeyword,
    })),
    estimatedCostUsd: directed.estimatedCostUsd,
  };
}

async function callGemini(input: {
  transcript: string;
  sourceDurationSec: number;
  momentCount: number;
  model: string;
  userBrollAssets?: Array<{id: string; description: string; durationSec: number}>;
}): Promise<Omit<VisualDirection, 'source'>> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(input.model)}:generateContent` +
    `?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;

  const lutEntries = shortlistLutsForDirector();
  const lutPrompt = formatLutsForDirectorPrompt(lutEntries);
  const userBrollBlock =
    input.userBrollAssets && input.userBrollAssets.length > 0
      ? `USER_BROLL (prefer these; set user_broll_id on matching cutaway/split moments; each id once):\n` +
        input.userBrollAssets
          .map(
            asset =>
              `- ${asset.id}: ${asset.description} (~${asset.durationSec.toFixed(1)}s)`,
          )
          .join('\n') +
        '\n'
      : '';
  const prompt =
    `Clip duration: ${input.sourceDurationSec.toFixed(1)} seconds.\n` +
    `Propose up to ${Math.max(input.momentCount, listBeatsFromTranscript(input.transcript).length + 3)} moments.\n` +
    `All search_keyword and visual_world queries MUST be English scene phrases for Pexels.\n` +
    `Match the overall TOPIC — never a single random noun. Include video cutaways/splits for each list item if they list things.\n` +
    `Pick a hook_style that fits THIS video (vary it). Include one video split and 1–2 stack phrase cards.\n` +
    `Add motion_graphics (stylish entrances), media_containers (full→inset canvas), and semantic_emphasis (punch numbers/claims). Vary every video — be creative.\n` +
    `Pick caption.template + caption.position + caption.box for THIS video (vary all three — do not always use hormozi/bottom/box).\n` +
    `Prefer box=false unless template is box or the background would wash out outlined type.\n` +
    userBrollBlock +
    `AVAILABLE_LUTS (choose preferred_lut + suggested_luts ONLY from these ids):\n${lutPrompt}\n\n` +
    `Transcript:\n${input.transcript.slice(0, 12_000)}`;

  const started = Date.now();
  const body = await requestJson<GeminiResponse>(url, {
    method: 'POST',
    label: 'Gemini visual director',
    failureCode: 'broll_failed',
    timeoutMs: 45_000,
    retries: 1,
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      systemInstruction: {parts: [{text: SYSTEM_INSTRUCTION}]},
      contents: [{role: 'user', parts: [{text: prompt}]}],
      generationConfig: {
        temperature: 0.45,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            topic: {type: 'STRING'},
            visual_world: {type: 'ARRAY', items: {type: 'STRING'}},
            hook_title: {type: 'STRING'},
            hook_style: {type: 'STRING'},
            caption: {
              type: 'OBJECT',
              properties: {
                template: {type: 'STRING'},
                position: {type: 'STRING'},
                text_color: {type: 'STRING'},
                highlight_color: {type: 'STRING'},
                box: {type: 'BOOLEAN'},
                box_color: {type: 'STRING'},
              },
              required: ['template', 'position', 'box'],
            },
            preferred_lut: {type: 'STRING'},
            suggested_luts: {type: 'ARRAY', items: {type: 'STRING'}},
            zooms: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  timestamp: {type: 'NUMBER'},
                  duration: {type: 'NUMBER'},
                },
              },
            },
            moments: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  timestamp: {type: 'NUMBER'},
                  search_keyword: {type: 'STRING'},
                  why: {type: 'STRING'},
                  media: {type: 'STRING'},
                  layout: {type: 'STRING'},
                  anchor: {type: 'STRING'},
                  overlay_text: {type: 'STRING'},
                  text_style: {type: 'STRING'},
                  accent_color: {type: 'STRING'},
                  user_broll_id: {type: 'STRING'},
                },
                required: ['timestamp', 'search_keyword', 'media', 'layout'],
              },
            },
            motion_graphics: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  start: {type: 'NUMBER'},
                  end: {type: 'NUMBER'},
                  text: {type: 'STRING'},
                  role: {type: 'STRING'},
                  shape: {type: 'STRING'},
                  accent_color: {type: 'STRING'},
                  text_color: {type: 'STRING'},
                  anchor: {type: 'STRING'},
                  entrance: {type: 'STRING'},
                  exit: {type: 'STRING'},
                  font_scale: {type: 'NUMBER'},
                  italic: {type: 'BOOLEAN'},
                },
                required: ['start', 'end', 'text'],
              },
            },
            media_containers: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  start: {type: 'NUMBER'},
                  end: {type: 'NUMBER'},
                  mode: {type: 'STRING'},
                  canvas_color: {type: 'STRING'},
                  corner_radius: {type: 'NUMBER'},
                  scale: {type: 'NUMBER'},
                  transition_sec: {type: 'NUMBER'},
                  canvas_title: {type: 'STRING'},
                  canvas_title_color: {type: 'STRING'},
                },
                required: ['start', 'end'],
              },
            },
            semantic_emphasis: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  start: {type: 'NUMBER'},
                  end: {type: 'NUMBER'},
                  text: {type: 'STRING'},
                  weight: {type: 'STRING'},
                  treatment: {type: 'STRING'},
                  accent_color: {type: 'STRING'},
                },
                required: ['start', 'end', 'text'],
              },
            },
          },
          required: ['hook_title', 'moments', 'topic', 'caption'],
        },
      },
    }),
  });

  const text = body.candidates?.[0]?.content?.parts
    ?.map(part => part.text ?? '')
    .join('')
    .trim();

  if (!text) {
    throw new EngineError('broll_failed', 'Visual director returned no content');
  }

  const parsed = parseVisualDirectorJson(text, input.sourceDurationSec, input.transcript);
  if (parsed.moments.length === 0 && !parsed.hookTitle) {
    log.warn({preview: text.slice(0, 400), model: input.model}, 'director json unusable');
    throw new EngineError('broll_failed', 'Visual director returned malformed JSON');
  }

  const usage = body.usageMetadata ?? {};
  const estimatedCostUsd =
    ((usage.promptTokenCount ?? 0) / 1_000_000) * GEMINI_USD_PER_M_INPUT +
    ((usage.candidatesTokenCount ?? 0) / 1_000_000) * GEMINI_USD_PER_M_OUTPUT;

  log.info(
    {
      ms: Date.now() - started,
      moments: parsed.moments.length,
      motionGraphics: parsed.motionGraphics.length,
      mediaContainers: parsed.mediaContainers.length,
      semanticEmphasis: parsed.semanticEmphasis.length,
      hook: parsed.hookTitle,
      topic: parsed.topic,
      zooms: parsed.zooms.length,
      caption: {
        template: parsed.caption.template,
        position: parsed.caption.position,
        box: parsed.caption.boxColor != null,
        bottomFrac: parsed.caption.bottomFrac,
      },
      model: input.model,
      usage,
    },
    'visual direction planned',
  );

  return {
    ...parsed,
    estimatedCostUsd,
  };
}

export function parseVisualDirectorJson(
  raw: string,
  durationSec: number,
  transcript = '',
): Omit<VisualDirection, 'estimatedCostUsd' | 'source'> {
  const parsed = extractJson(raw);
  const record =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray(record.moments)
      ? record.moments
      : [];

  const hookTitle = oneLineHook(
    String(record.hook_title ?? record.hookTitle ?? ''),
  );

  const moments: DirectedMoment[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') {
      continue;
    }
    const item = row as Record<string, unknown>;
    const timestamp = Number(item.timestamp ?? item.time ?? item.start);
    const keyword = String(
      item.search_keyword ?? item.searchKeyword ?? item.keyword ?? '',
    )
      .trim()
      .slice(0, 60);
    if (!keyword || !Number.isFinite(timestamp)) {
      continue;
    }
    if (timestamp < 0 || timestamp > durationSec) {
      continue;
    }
    const layout = coerceLayout(item.layout, item.media ?? item.mediaKind);
    const scene = applySubjectToQuery(
      ensureEnglishSearchQuery(keyword) || sanitizeVisualQuery(keyword),
      inferStockSubject(transcript),
    );
    if (
      (layout === 'cutaway' || layout === 'split') &&
      (!scene || scene.split(/\s+/).length < 2)
    ) {
      continue;
    }
    // Drop photo-led layouts — they look random on talking-head shorts.
    if (
      layout === 'composite' ||
      layout === 'pip' ||
      layout === 'sticker' ||
      coerceMedia(item.media ?? item.mediaKind, layout) === 'image'
    ) {
      continue;
    }
    moments.push({
      timestamp,
      searchKeyword:
        layout === 'lockup' || layout === 'chip' || layout === 'banner'
          ? scene || ensureEnglishSearchQuery(keyword) || keyword.slice(0, 60)
          : scene.slice(0, 60),
      media: coerceMedia(item.media ?? item.mediaKind, layout),
      layout,
      anchor:
        layout === 'lockup'
          ? coerceAnchor(item.anchor ?? 'top_left', layout, moments.length)
          : coerceAnchor(item.anchor ?? item.placement, layout, moments.length),
      overlayText: factualOverlayText(
        String(item.overlay_text ?? item.overlayText ?? item.text ?? ''),
        transcript,
      ),
      textStyle:
        layout === 'lockup'
          ? 'stack'
          : coerceTextStyle(item.text_style ?? item.textStyle, layout),
      accentColor: sanitizeOverlayAccent(
        String(item.accent_color ?? item.accentColor ?? ''),
      ),
      userBrollId: coerceUserBrollId(
        item.user_broll_id ?? item.userBrollId,
      ),
    });
  }

  const visualQueries = parseVisualWorld(
    record.visual_world ?? record.visualWorld,
    transcript,
  );
  const availableLuts = listAvailableLuts();
  let suggestedLutIds = parseSuggestedLutIds(
    record.suggested_luts ?? record.suggestedLuts,
    availableLuts,
    3,
  );
  let preferredLutId = coerceLutId(
    record.preferred_lut ?? record.preferredLut,
    availableLuts,
  );
  if (!preferredLutId && suggestedLutIds[0]) {
    preferredLutId = suggestedLutIds[0];
  }
  if (preferredLutId && !suggestedLutIds.includes(preferredLutId)) {
    suggestedLutIds = [preferredLutId, ...suggestedLutIds].slice(0, 3);
  }
  if (suggestedLutIds.length === 0 && availableLuts.length > 0) {
    suggestedLutIds = defaultSuggestedLuts(transcript, availableLuts);
    preferredLutId = suggestedLutIds[0] || '';
  }
  return {
    hookTitle,
    hookSubtitle: '',
    hookStyle: coerceHookStyle(
      record.hook_style ?? record.hookStyle,
      transcript,
      hookTitle,
    ),
    topic: String(record.topic ?? '').trim().slice(0, 160),
    visualQueries,
    caption: parseCaptionDirection(record.caption ?? record.captionDirection, transcript),
    suggestedLutIds,
    preferredLutId,
    zooms: parseDirectedZooms(record.zooms, durationSec),
    moments: enforceRequiredLayouts(
      moments,
      durationSec,
      transcript,
      visualQueries,
    ),
    ...parseMotionPlanFromDirector(record, durationSec, transcript),
  };
}

/** Director often "skips clutter". We still owe a split, list beats, and phrase cards. */
export function enforceRequiredLayouts(
  moments: DirectedMoment[],
  durationSec: number,
  transcript: string,
  visualQueries: string[],
): DirectedMoment[] {
  const out = [...moments].sort((a, b) => a.timestamp - b.timestamp);
  const subject = inferStockSubject(transcript);
  const stock =
    visualQueries.find(query => query.split(/\s+/).length >= 2) ||
    applySubjectToQuery('person finishing checklist notebook', subject) ||
    'person finishing checklist notebook';

  const listBeats = listBeatsFromTranscript(transcript, 5);
  if (listBeats.length >= 2) {
    const span = Math.max(8, durationSec - 8);
    const step = span / (listBeats.length + 1);
    for (const [index, beat] of listBeats.entries()) {
      const preferred = 4.5 + step * (index + 1);
      const at = openMomentTime(out, durationSec, preferred, 4);
      if (at == null) {
        continue;
      }
      const alreadyCovered = out.some(
        moment =>
          (moment.layout === 'cutaway' || moment.layout === 'split') &&
          Math.abs(moment.timestamp - at) < 3.5,
      );
      if (alreadyCovered) {
        continue;
      }
      out.push({
        timestamp: at,
        searchKeyword: beat.searchKeyword || stock,
        media: 'video',
        layout: index === 0 && durationSec > 20 ? 'split' : 'cutaway',
        anchor: 'top',
        overlayText: beat.label.slice(0, 42),
        textStyle: 'outline',
        accentColor: '#FFFFFF',
      });
    }
  }

  if (durationSec > 20 && !out.some(moment => moment.layout === 'split')) {
    const at = openMomentTime(out, durationSec, durationSec * 0.4);
    if (at != null) {
      out.push({
        timestamp: at,
        searchKeyword: stock,
        media: 'video',
        layout: 'split',
        anchor: 'top',
        overlayText: '',
        textStyle: 'outline',
        accentColor: '#FFFFFF',
      });
    }
  }

  if (!out.some(moment => moment.layout === 'lockup' && moment.textStyle === 'stack')) {
    const phrases = keyPhrasesFromTranscript(transcript, 2);
    for (const [index, phrase] of phrases.entries()) {
      const at = openMomentTime(
        out,
        durationSec,
        durationSec * (index === 0 ? 0.32 : 0.62),
      );
      if (at == null) {
        break;
      }
      out.push({
        timestamp: at,
        searchKeyword: 'phrase',
        media: 'text',
        layout: 'lockup',
        anchor: index % 2 === 0 ? 'top_left' : 'top_right',
        overlayText: phrase,
        textStyle: 'stack',
        accentColor: '#F7F1E1',
      });
    }
  }

  return out.sort((a, b) => a.timestamp - b.timestamp);
}

function openMomentTime(
  moments: DirectedMoment[],
  durationSec: number,
  preferred: number,
  minGap = 5,
): number | null {
  const candidates = [
    preferred,
    durationSec * 0.22,
    durationSec * 0.55,
    durationSec * 0.7,
    durationSec * 0.84,
  ];
  for (const raw of candidates) {
    const at = Math.max(4.2, Math.min(durationSec - 3.4, raw));
    if (moments.every(moment => Math.abs(moment.timestamp - at) >= minGap)) {
      return at;
    }
  }
  return null;
}

export function fallbackVisualDirection(input: {
  transcript: string;
  sourceDurationSec: number;
  momentCount: number;
}): VisualDirection {
  const hookTitle = oneLineHook(hookFromTranscript(input.transcript));
  const visualQueries = themeQueriesFromTranscript(input.transcript, 5);
  const stock =
    visualQueries.length > 0
      ? visualQueries
      : ['cinematic city street', 'golden hour portrait', 'hands writing notebook'];
  const span = Math.max(8, input.sourceDurationSec);
  const layouts: VisualOverlayLayout[] = ['cutaway', 'split', 'cutaway', 'lockup'];
  const quote = quotedPhrase(input.transcript);
  const phrases = keyPhrasesFromTranscript(input.transcript);
  const count = Math.max(3, Math.min(input.momentCount, Math.max(stock.length, 4)));
  const gap = Math.max(8, (span - 10) / Math.max(1, count));

  const moments: DirectedMoment[] = Array.from({length: count}, (_, index) => {
    const layout = layouts[index % layouts.length]!;
    const media: VisualMediaKind =
      layout === 'cutaway' || layout === 'split'
        ? 'video'
        : layout === 'lockup' || layout === 'chip' || layout === 'banner'
          ? 'text'
          : 'image';
    return {
      timestamp: Math.min(span - 1, 5 + index * gap),
      searchKeyword: stock[index % stock.length]!,
      media,
      layout,
      anchor: coerceAnchor('', layout, index),
      overlayText:
        layout === 'lockup'
          ? phrases[0] || quote
          : layout === 'sticker' || layout === 'pip' || layout === 'cutaway' || layout === 'split'
            ? ''
            : quote,
      textStyle: layout === 'lockup' ? 'stack' : 'bar',
      accentColor: '#F7F1E1',
    };
  });

  const zooms: DirectedZoom[] = [
    {timestamp: Math.min(span * 0.28, span - 3), durationSec: 1.6},
    {timestamp: Math.min(span * 0.62, span - 3), durationSec: 1.6},
  ].filter(zoom => zoom.timestamp >= 4);

  return {
    hookTitle,
    hookSubtitle: '',
    hookStyle: coerceHookStyle(undefined, input.transcript, hookTitle),
    topic: hookTitle,
    visualQueries: stock,
    caption: defaultCaptionDirection(input.transcript),
    suggestedLutIds: defaultSuggestedLuts(input.transcript, listAvailableLuts()),
    preferredLutId: defaultSuggestedLuts(input.transcript, listAvailableLuts())[0] || '',
    zooms,
    moments,
    ...fallbackMotionPlan({
      transcript: input.transcript,
      durationSec: span,
      hookTitle,
    }),
    estimatedCostUsd: 0,
    source: 'fallback',
  };
}

export function extractJson(raw: string): unknown {
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/u, '');
  const attempts = [
    text,
    text.replace(/,\s*([}\]])/g, '$1'),
  ];
  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    attempts.push(objectMatch[0], objectMatch[0].replace(/,\s*([}\]])/g, '$1'));
  }
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    attempts.push(arrayMatch[0], arrayMatch[0].replace(/,\s*([}\]])/g, '$1'));
  }
  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch {
      // keep trying looser extracts
    }
  }
  throw new EngineError('broll_failed', 'Visual director returned malformed JSON');
}

function coerceLayout(raw: unknown, media: unknown): VisualOverlayLayout {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === 'background') {
    return 'composite';
  }
  if (value === 'stat' || value === 'title' || value === 'headline') {
    return 'lockup';
  }
  if ((LAYOUTS as string[]).includes(value)) {
    return value as VisualOverlayLayout;
  }
  const kind = String(media ?? '').trim().toLowerCase();
  if (kind === 'video') {
    return 'cutaway';
  }
  if (kind === 'text') {
    return 'lockup';
  }
  return 'sticker';
}

function coerceMedia(raw: unknown, layout: VisualOverlayLayout): VisualMediaKind {
  const value = String(raw ?? '').trim().toLowerCase();
  if ((MEDIA_KINDS as string[]).includes(value)) {
    return value as VisualMediaKind;
  }
  if (value === 'photo' || value === 'picture') {
    return 'image';
  }
  if (layout === 'cutaway' || layout === 'split') {
    return 'video';
  }
  if (layout === 'lockup' || layout === 'chip' || layout === 'banner' || layout === 'stat') {
    return 'text';
  }
  return 'image';
}

function coerceAnchor(
  raw: unknown,
  layout: VisualOverlayLayout,
  index: number,
): VisualAnchor {
  const value = String(raw ?? '').trim().toLowerCase().replace('-', '_');
  if ((ANCHORS as string[]).includes(value)) {
    return value as VisualAnchor;
  }
  if (layout === 'lockup') {
    return index % 2 === 0 ? 'top_left' : 'top_right';
  }
  if (layout === 'banner') {
    return index % 2 === 0 ? 'top' : 'bottom';
  }
  if (layout === 'chip') {
    return 'bottom';
  }
  if (layout === 'split' || layout === 'composite') {
    return 'top';
  }
  const corners: VisualAnchor[] = ['top_right', 'top_left', 'bottom_right', 'bottom_left'];
  return corners[index % corners.length]!;
}

export function oneLineHook(value: string): string {
  const cleaned = sanitizeTitle(value, 42);
  return cleaned.split(/\s+/).filter(Boolean).slice(0, 6).join(' ') || 'WATCH THIS';
}

export function factualOverlayText(raw: string, transcript: string): string {
  const text = sanitizeTitle(raw, 48);
  if (!text) {
    return '';
  }
  if (!overlayTextIsFactual(text, transcript)) {
    return quotedPhrase(transcript);
  }
  return text;
}

export function overlayTextIsFactual(text: string, transcript: string): boolean {
  if (!transcript.trim()) {
    return true;
  }
  const hay = transcript.toLowerCase();
  if (/\d+\s*[kmbx]\+?/i.test(text)) {
    const token = text
      .match(/\d+\s*[kmbx]\+?/i)?.[0]
      ?.toLowerCase()
      .replace(/\s/g, '');
    if (token && !hay.replace(/\s/g, '').includes(token)) {
      return false;
    }
  }
  const nums = text.match(/\d{2,}|\d+\s?%/g) ?? [];
  for (const num of nums) {
    if (!hay.includes(num.toLowerCase().replace(/\s/g, ''))) {
      return false;
    }
  }
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2);
  if (words.length === 0) {
    return true;
  }
  const hits = words.filter(word => hay.includes(word)).length;
  return hits >= Math.ceil(words.length * 0.5);
}

export function quotedPhrase(transcript: string, maxWords = 5): string {
  const sentence = (transcript.split(/[.!?]/).find(part => part.trim().length > 8) ?? transcript)
    .trim()
    .replace(/^[^a-zA-Z]+/, '');
  return oneLineHook(sentence.split(/\s+/).slice(0, maxWords).join(' '));
}

export function defaultCaptionDirection(transcript = ''): CaptionDirection {
  const template = pickCaptionTemplate(transcript);
  const position = pickCaptionPosition(transcript);
  const preset = captionPreset(template);
  return {
    position,
    bottomFrac: bottomFracFor(position),
    textColor: preset.textColor,
    highlightColor: preset.highlightColor,
    boxColor: preset.boxColor,
    template,
  };
}

function parseCaptionDirection(raw: unknown, transcript = ''): CaptionDirection {
  const fallback = defaultCaptionDirection(transcript);
  if (!raw || typeof raw !== 'object') {
    return fallback;
  }
  const record = raw as Record<string, unknown>;
  const template = coerceCaptionTemplate(record.template) ?? fallback.template;
  const position = coerceCaptionPosition(record.position) ?? fallback.position;
  const boxExplicitFalse = record.box === false;
  const boxExplicitTrue = record.box === true;
  const boxColorRaw = String(record.box_color ?? record.boxColor ?? '').trim();
  const boxRequested =
    !boxExplicitFalse &&
    (boxExplicitTrue ||
      Boolean(boxColorRaw) ||
      template === 'box');
  const boxColor = boxRequested
    ? sanitizeHex(boxColorRaw || '#111111', '#111111')
    : null;
  const textColor = sanitizeHex(
    String(record.text_color ?? record.textColor ?? ''),
    boxColor ? contrastingText(boxColor) : fallback.textColor,
  );
  const highlightColor = sanitizeHex(
    String(record.highlight_color ?? record.highlightColor ?? ''),
    boxColor ? textColor : fallback.highlightColor,
  );
  return {
    position,
    bottomFrac: bottomFracFor(position),
    textColor: boxColor ? ensureContrast(textColor, boxColor) : textColor,
    highlightColor,
    boxColor,
    template,
  };
}

function coerceCaptionPosition(raw: unknown): CaptionPosition | null {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === 'center' || value === 'middle') {
    return 'center';
  }
  if (value === 'lower_third' || value === 'lower-third' || value === 'mid') {
    return 'lower_third';
  }
  if (value === 'top' || value === 'upper' || value === 'upper_third') {
    return 'top';
  }
  if (value === 'bottom') {
    return 'bottom';
  }
  return null;
}

export function bottomFracFor(position: CaptionPosition): number {
  if (position === 'center') {
    return 0.42;
  }
  if (position === 'lower_third') {
    return 0.3;
  }
  if (position === 'top') {
    // Kept for blueprint consumers that only read bottomFrac; Remotion uses position.
    return 0.78;
  }
  return 0.2;
}

function pickCaptionPosition(transcript: string): CaptionPosition {
  const text = transcript.toLowerCase();
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  // Weighted so most edits sit low, but center/top still appear.
  const weighted: CaptionPosition[] = [
    'bottom',
    'bottom',
    'lower_third',
    'lower_third',
    'center',
    'top',
  ];
  return weighted[hash % weighted.length]!;
}

function parseVisualWorld(raw: unknown, transcript: string): string[] {
  const rows = Array.isArray(raw) ? raw : [];
  const cleaned = rows
    .map(value =>
      applySubjectToQuery(
        ensureEnglishSearchQuery(String(value ?? '')) ||
          sanitizeVisualQuery(String(value ?? '')),
        inferStockSubject(transcript),
      ),
    )
    .filter(value => value.split(/\s+/).length >= 2);
  if (cleaned.length >= 2) {
    return [...new Set(cleaned)].slice(0, 6);
  }
  return themeQueriesFromTranscript(transcript, 4);
}

export function coerceHookStyle(
  raw: unknown,
  transcript: string,
  hookTitle: string,
): HookStyle {
  const value = String(raw ?? '').trim().toLowerCase();
  if ((HOOK_STYLES as readonly string[]).includes(value)) {
    return value as HookStyle;
  }
  const seed = `${hookTitle}|${transcript.slice(0, 80)}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  if (listBeatsFromTranscript(transcript).length >= 2) {
    return hash % 2 === 0 ? 'rail' : 'duo';
  }
  if (/!|\b(stop|never|must|fix)\b/i.test(`${hookTitle} ${transcript.slice(0, 120)}`)) {
    return hash % 2 === 0 ? 'impact' : 'poster';
  }
  return HOOK_STYLES[hash % HOOK_STYLES.length]!;
}

function parseDirectedZooms(raw: unknown, durationSec: number): DirectedZoom[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: DirectedZoom[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') {
      continue;
    }
    const item = row as Record<string, unknown>;
    const timestamp = Number(item.timestamp ?? item.time ?? item.start);
    const durationSecRaw = Number(item.duration ?? item.durationSec ?? 1.6);
    if (!Number.isFinite(timestamp) || timestamp < 3.5 || timestamp > durationSec - 0.8) {
      continue;
    }
    const previous = out.at(-1);
    if (previous && timestamp < previous.timestamp + 8) {
      continue;
    }
    out.push({
      timestamp,
      durationSec: Math.min(2.2, Math.max(1.2, Number.isFinite(durationSecRaw) ? durationSecRaw : 1.6)),
    });
    if (out.length >= 4) {
      break;
    }
  }
  return out;
}

function coerceCaptionTemplate(raw: unknown): CaptionTemplateId | null {
  const value = String(raw ?? '').trim().toLowerCase();
  if ((CAPTION_TEMPLATES as readonly string[]).includes(value)) {
    return value as CaptionTemplateId;
  }
  return null;
}

function coerceTextStyle(raw: unknown, layout: VisualOverlayLayout): OverlayTextStyle {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === 'outline' || value === 'bar' || value === 'chip' || value === 'poster' || value === 'stack') {
    if (value === 'poster' && (layout === 'lockup' || layout === 'banner')) {
      return 'stack';
    }
    return value;
  }
  if (layout === 'chip') {
    return 'chip';
  }
  if (layout === 'lockup') {
    return 'stack';
  }
  if (layout === 'banner') {
    return 'bar';
  }
  return 'outline';
}

function coerceUserBrollId(raw: unknown): string | null {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!value || value === 'null' || value === 'none' || value === '""') {
    return null;
  }
  const match = value.match(/^ub_(\d+)$/);
  return match ? `ub_${match[1]}` : null;
}

function sanitizeOverlayAccent(raw: string): string {
  const hex = sanitizeHex(raw, '#FFFFFF');
  const r = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const g = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const b = Number.parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Saturated mid blues/reds read as cheap fill over skin.
  if (sat > 0.45 && lum > 0.18 && lum < 0.72 && b >= r && b >= g) {
    return '#FFFFFF';
  }
  if (sat > 0.55 && lum > 0.18 && lum < 0.72 && r > 0.6 && g < 0.35) {
    return '#FFFFFF';
  }
  return hex;
}

function pickCaptionTemplate(transcript: string): CaptionTemplateId {
  const text = transcript.toLowerCase();
  if (
    /\b(story|when i|i remember|soft|gentle|quiet|honest|vulnerable)\b/.test(
      text,
    )
  ) {
    return 'minimal';
  }
  if (/[!]{2,}|\byo\b|\bwow\b|\binsane\b|\bcrazy\b|\bhype\b/.test(text)) {
    return 'mrbeast';
  }
  if (
    /\b(first|second|third|step|tips?|how to|lesson|learn|because)\b/.test(text)
  ) {
    return 'karaoke';
  }
  if (/\b(premium|luxury|elegant|calm|brand)\b/.test(text)) {
    return 'box';
  }
  if (/\b(energy|exciting|lets go|let['']s go|fire)\b/.test(text)) {
    return 'bounce';
  }
  if (/\b(buy|sale|offer|comment|link|shop|dm)\b/.test(text)) {
    return 'hormozi';
  }
  // Rotate fallback so back-to-back videos don't clone one look.
  const bucket = Math.abs(text.length) % 7;
  const rotation: CaptionTemplateId[] = [
    'classic',
    'hormozi',
    'bounce',
    'karaoke',
    'minimal',
    'mrbeast',
    'box',
  ];
  return rotation[bucket]!;
}

function defaultSuggestedLuts(transcript: string, available: string[]): string[] {
  if (available.length === 0) {
    return [];
  }
  const text = transcript.toLowerCase();
  const prefer: string[] = [];
  const pushIf = (id: string) => {
    if (available.includes(id) && !prefer.includes(id)) {
      prefer.push(id);
    }
  };
  if (/\b(night|dark|evening|tungsten|neon)\b/.test(text)) {
    pushIf('CineStill-800-T-V1.0--N125');
    pushIf('Cinematic_for_Flog');
  }
  if (/\b(warm|sun|summer|cozy|vintage|home)\b/.test(text)) {
    pushIf('Vintage_Warmth_1.C0427');
    pushIf('CELLULOID_01_FU_LOW');
  }
  if (/\b(clean|pro|business|brand|product)\b/.test(text)) {
    pushIf('Colorist_Factory_Severn_LUT');
    pushIf('TL_R709_V2');
  }
  pushIf('CELLULOID_01_FU_LOW');
  pushIf('Cinematic_for_Flog');
  pushIf('Colorist_Factory_Severn_LUT');
  for (const id of available) {
    if (prefer.length >= 3) {
      break;
    }
    pushIf(id);
  }
  return prefer.slice(0, 3);
}

function captionPreset(template: CaptionTemplateId): {
  textColor: string;
  highlightColor: string;
  boxColor: string | null;
} {
  if (template === 'mrbeast') {
    return {textColor: '#FFFF00', highlightColor: '#FF6600', boxColor: null};
  }
  if (template === 'box') {
    return {textColor: '#FFFFFF', highlightColor: '#FFFFFF', boxColor: '#111111'};
  }
  if (template === 'bounce') {
    return {textColor: '#FFFFFF', highlightColor: '#00FF88', boxColor: null};
  }
  if (template === 'karaoke') {
    return {textColor: '#FFFFFF', highlightColor: '#4DA3FF', boxColor: null};
  }
  if (template === 'minimal') {
    return {textColor: '#FFFFFF', highlightColor: '#F5F5F5', boxColor: null};
  }
  if (template === 'hormozi') {
    return {textColor: '#FFFFFF', highlightColor: '#00E5FF', boxColor: null};
  }
  return {textColor: '#FFFFFF', highlightColor: '#FFE14A', boxColor: null};
}

function sanitizeHex(value: string, fallback: string): string {
  const match = value.trim().match(/^#?([0-9a-fA-F]{6})$/);
  return match ? `#${match[1]!.toUpperCase()}` : fallback;
}

function luminance(hex: string): number {
  const raw = hex.replace('#', '');
  const r = Number.parseInt(raw.slice(0, 2), 16) / 255;
  const g = Number.parseInt(raw.slice(2, 4), 16) / 255;
  const b = Number.parseInt(raw.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastingText(boxHex: string): string {
  return luminance(boxHex) > 0.55 ? '#111111' : '#FFFFFF';
}

function ensureContrast(textHex: string, boxHex: string): string {
  const gap = Math.abs(luminance(textHex) - luminance(boxHex));
  return gap < 0.35 ? contrastingText(boxHex) : textHex;
}

function sanitizeTitle(value: string, max = 48): string {
  return value.replace(/\s+/g, ' ').replace(/[#"]/g, '').trim().slice(0, max);
}

const STOPWORDS = new Set([
  'about', 'after', 'because', 'before', 'being', 'could', 'doing', 'every',
  'from', 'going', 'have', 'just', 'like', 'really', 'should', 'their', 'there',
  'these', 'thing', 'this', 'those', 'today', 'using', 'very', 'want', 'what',
  'when', 'where', 'which', 'while', 'will', 'with', 'would', 'your', 'youre',
  'that', 'them', 'then', 'than', 'also', 'into', 'some', 'more', 'make',
]);

function hookFromTranscript(transcript: string): string {
  const sentence = (transcript.split(/[.!?]/)[0] ?? transcript).trim();
  return oneLineHook(sentence);
}

function keywordsFromTranscript(transcript: string, count: number): string[] {
  const words = transcript
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length >= 5 && !STOPWORDS.has(word));
  const freq = new Map<string, number>();
  for (const word of words) {
    freq.set(word, (freq.get(word) ?? 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .map(([word]) => word)
    .slice(0, count);
}
