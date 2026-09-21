/**
 * Stage C.1 — visual direction: hook title, B-roll cutaways, image composites.
 *
 * Gemini never sees the pixels. It reads the transcript and returns a creative
 * brief (hook copy + timed moments). Stock lookup and timeline mapping happen
 * after this so a malformed JSON reply cannot brick the rest of the pipeline.
 */

import {env} from '../../config/env.ts';
import {dumpDirectorTrace} from '../../lib/directorDump.ts';
import {EngineError} from '../../lib/errors.ts';
import {requestJson} from '../../lib/http.ts';
import {stageLogger} from '../../lib/logger.ts';
import type {
  CaptionAnimation,
  CaptionDirection,
  CaptionPosition,
  CaptionTemplateId,
  FocusRegion,
  FrameInset,
  HookStyle,
  OverlayTextStyle,
  OverlayTreatment,
  VisualAnchor,
  VisualMediaKind,
  VisualOverlayLayout,
} from '../../types/blueprint.ts';
import {CAPTION_ANIMATIONS, CAPTION_TEMPLATES, HOOK_STYLES, OVERLAY_TREATMENTS} from '../../types/blueprint.ts';
import {
  coerceLutId,
  formatLutsForDirectorPrompt,
  lutCatalogIds,
  LUT_RANK_LIMIT,
  parseSuggestedLutIds,
  shortlistLutsForDirector,
} from '../color/lutCatalog.ts';
import {describeOccupancyForDirector, type Occupancy} from '../layout/occupancy.ts';
import {
  describeCutoutForDirector,
  type SpeakerCutout,
} from '../layout/speakerCutout.ts';
import {
  formatCaptionGuideForDirector,
  type CaptionStyleGuide,
} from '../../types/captionStyleGuide.ts';
import {ensureEnglishSearchQuery} from './englishSearch.ts';
import {listBeatsFromTranscript} from './listBeats.ts';
import {allowedEditsPromptBlock} from '../../lib/editToolkits.ts';
import {
  applySubjectToQuery,
  inferStockSubject,
  keyPhrasesFromTranscript,
  sanitizeVisualQuery,
  stockFriendlyQueries,
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
  'card',
  'lockup',
  'chip',
  'banner',
  'split',
  'stat',
  'cutout',
  'bubble',
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

const SYSTEM_INSTRUCTION = `You are both VIDEO EDITOR and MOTION DESIGNER for a vertical talking-head short.

Video editor: pace, B-roll, zooms, splits, when to cut away from the speaker.
Motion designer: layout and assets should MOVE at a medium pace so the edit is never a still stamp. Motion is encouraged; speed is not. A still dump on the speaker is a failed edit. An empty canvas with a tiny speaker tile is also a failed edit.

CONTENT ≠ DESIGN. Do not copy a previous video's look. Do not invent a named "effect". Treat the list below as a toolbox of primitives — pick the ones THIS transcript, THESE assets, and THIS occupancy map actually need. Never require a primitive just because it exists.

Placement (non-negotiable):
- FRAME_OCCUPANCY gives speaker_box + LEGAL_SLOTS. Graphics, cards, titles, counters, emphasis NEVER cover the speaker.
- Pick an occupancy LEGAL_SLOT anchor for every overlay. Full-width bars across the face are illegal. Opening titles live in a small corner slot, never over the head.
- CAPTION_BAND y>=0.76 is reserved. Do not park cards, titles, or a shrunk speaker tile there.
- media_containers are OPTIONAL. pip_corner is legal ONLY when timed hero cards or graphics fill the leftover canvas. If the leftover would be empty color, keep the talking-head full-bleed.
- Split screens are allowed; they must animate in and out.

Edit toolbox (use whatever this video needs — no quota, no required combo):
- delivery_shaping is an audio/pacing pre-flight, not a visual moment. If enabled it has already run: word times below are on the shaped timeline. Never compensate for it. It preserves voice identity and remains separate from B-roll, depth_overlay, and inset_reveal.
- cutaway: full-frame related video while they talk about that thing.
- split: animated half/half. Related half can be a video clip, a still, or a slideshow when related images exist. After slide-in finishes, HOLD at least ~4s (longer if speech is longer) then slide off. Video clips play only after enter hits 100%, and slide off only after the clip ends.
- cutout: IF SPEAKER_CUTOUT is available — B-roll/canvas fills the frame, creator stands in front as a keyed cut-out. Best for messages, orders, products, screens.
- depth_overlay: IF SPEAKER_CUTOUT / subject mask is available — speaker STAYS on screen. A product image, screenshot, logo, chart, or short clip sits BEHIND them in the upper half (soft bottom fade, slides in from top or bottom). This is NOT B-roll. B-roll/cutaway replaces the speaker; depth_overlay keeps the face. Prefer when the asset is relevant, the speaker is centered, and the moment is a reference/emphasis. Do not use if no mask, framing is too tight, the asset is low-res or text-heavy, or the segment already has cutaway/split/cutout. Hold 1.5–6s, ≥4s between uses, alternate direction. Output these in depth_overlays, not moments.
- inset_reveal: the WHOLE talking-head shrinks into a rounded card over a colored background, captions sit below, then it restores to full frame. Audio never cuts. NOT B-roll (that replaces the speaker) and NOT depth_overlay (speaker stays full-frame with an asset behind). Prefer for section changes, a key statistic or quotable phrase, a list/step, a pacing reset, or caption-first moments. variant motion_graphic when there is a concrete stat/keyword/list item (graphic template_id stat_callout or keyword_title). variant simple for a quiet beat. Do not use in the first 3s or last 2s, mid-sentence, when the face is the story, or during cutaway/split/cutout/depth_overlay. Hold 2–8s, ≥6s between uses, about 1 per 20s, max 30% of runtime. Snap to sentence boundaries. Prefer one theme color. Output these in inset_reveals, not moments.
- bubble: chat/order-style message cards that float in legal slots (not on the face).
- media_card / scroll / suspense / focus / float / wipe / slideshow: photo or screenshot treatments. Slideshow cycles related stills as a card overlay or on a split half.
- lockup / quote-style stack / chip: spoken slogans in a legal slot.
- container_transform / pip_corner: only when leftover canvas has real assets.
- frame_inset: sometimes shrink the whole frame with a smooth motion so a thick black/white/color margin shows; director picks how far; restore with the same motion.
- count_up / type_reveal / punch_zoom: only when speech needs them. Zoom-in can stay snappy; zoom-off eases out smoothly.
- focus_region: documents/screenshots only.

HOLD TIME is speech time: a graphic or B-roll starts when the related words start and leaves when that spoken burst ends. Do not invent a fixed 2s/4s clock. A one-word aside is short; a 6-second explanation stays up for those 6 seconds.

Return ONE JSON object:
{
  "topic": string,
  "visual_world": ["2-4 word Pexels scene", "short variant", "short variant", "short variant"],
  "hook_title": string,
  "hook_style": "impact" | "boxed" | "minimal" | "bar" | "stack" | "outline" | "rail" | "poster" | "underline" | "duo",
  "caption": {
    "template": "karaoke" | "pop" | "beast" | "grape" | "hustle" | "gaming-stream" | "basic" | "moving-pill" | "kinetic-slam" | "weight-shift" | "editorial-emphasis" | "soft-ai" | "classic" | "box" | "minimal" | "clean" | "subtitle",
    "position": "bottom" | "lower_third" | "center" | "top",
    "text_color": "#RRGGBB",
    "highlight_color": "#RRGGBB",
    "box": boolean,
    "box_color": "#RRGGBB" or "",
    "font_scale": number,
    "animation": "highlight" | "karaoke" | "scale" | "bounce" | "box" | "pop" | "type"
  },
  "preferred_lut": string,
  "suggested_luts": ["catalog name, rank 1", "rank 2", "... up to 10"],
  "zooms": [{"timestamp": number, "duration": number}],
  "moments": [
    {
      "timestamp": number,
      "search_keyword": "2-4 word Pexels scene",
      "queries": ["shortest searchable query", "close variant", "close variant"],
      "why": string,
      "media": "video" | "image" | "text",
      "layout": "cutaway" | "split" | "lockup" | "card" | "pip" | "cutout" | "bubble",
      "treatment": "card" | "scroll" | "suspense" | "focus" | "stack" | "float" | "wipe" | "slideshow",
      "anchor": "top" | "top_left" | "top_right" | "bottom" | "bottom_left" | "bottom_right",
      "visual_weight": "accent" | "hero",
      "overlay_text": string,
      "text_style": "outline" | "bar" | "chip" | "poster" | "stack",
      "accent_color": "#RRGGBB",
      "user_broll_id": "ub_1" | "",
      "stagger_index": number,
      "glow": boolean,
      "focus_region": {"x":0-1,"y":0-1,"w":0-1,"h":0-1,"label": string} or null
    }
  ],
  "depth_overlays": [
    {
      "asset_id": "ub_1",
      "start": number,
      "end": number,
      "direction": "up" | "down",
      "opacity": 0.75,
      "duration": 0.4,
      "reason": "why this asset belongs behind the speaker now"
    }
  ],
  "inset_reveals": [
    {
      "start": number,
      "end": number,
      "variant": "simple" | "motion_graphic",
      "background": {"type": "solid" | "gradient" | "loop" | "template", "value": "#111827"},
      "graphic": {"template_id": "stat_callout" | "keyword_title", "text": "spoken stat or keyword"},
      "captions": true,
      "reason": "why this shrink-to-card beat belongs here"
    }
  ],
  "motion_graphics": [
    {
      "start": number,
      "end": number,
      "text": string,
      "role": "primary" | "secondary" | "accent",
      "shape": "none" | "underline" | "pill" | "bar" | "block" | "outline_box" | "bubble",
      "accent_color": "#RRGGBB",
      "text_color": "#RRGGBB",
      "anchor": "top" | "top_left" | "top_right" | "center" | "bottom" | "bottom_left" | "bottom_right",
      "entrance": "spring_up" | "slide_left" | "slide_right" | "scale_pop" | "fade_blur" | "type_stagger" | "mask_wipe" | "highlight_type" | "slide_from_edge",
      "exit": "fade" | "spring_out" | "slide_away",
      "font_scale": number,
      "italic": boolean
    }
  ],
  "media_containers": [
    {
      "start": number,
      "end": number,
      "mode": "inset" | "card" | "rounded_window" | "pip_corner",
      "pip_anchor": "top_left" | "top_right" | "bottom_left" | "bottom_right",
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
      "treatment": "scale" | "color" | "pop" | "underline" | "count" | "type_reveal",
      "accent_color": "#RRGGBB",
      "anchor": "top_left" | "top_right" | "bottom_left" | "bottom_right",
      "count_from": number,
      "count_to": number,
      "count_suffix": string
    }
  ]
}

Meaning:
- Analyze THIS video, then pick primitives from the toolbox. Skip tools that do not serve this transcript UNLESS they appear in REQUIRED_EDIT_STYLES.
- If REQUIRED_EDIT_STYLES is present, you MUST place each listed toolkit at least once. You still choose the spoken moment. Do not skip a required toolkit and do not substitute a different one. Never add split unless split is required.
- hook_title, zoom, and counter are always on even if they are not listed. Place 2–4 zooms and a count-up on the first spoken number (20s, 40s, million, 50B).
- hook_title is REQUIRED (3–6 spoken words). Place it in a LEGAL_SLOT corner, timed to the TIMESTAMPED_WORDS of that phrase only. Never leave an intro name card up over a later sentence.
- moments: cutaways/splits/cutout backgrounds are VIDEO. Stills = card or bubble in a LEGAL_SLOT.
- search_keyword and queries MUST be stock-library friendly: 2–4 English words naming a visible scene (e.g. "woman airport terminal"). Never write cinematic 8–12 word briefs. Give 2–3 query variants, shortest first.
- Time every moment and graphic to TIMESTAMPED_WORDS. overlay_text must appear only while those words are spoken.
- motion_graphics: use often on claims, lists, numbers, and the CTA. Vary entrance+shape. Keep type animated. Never center.
- media_containers: optional. Never pip_corner onto an empty canvas.
- semantic_emphasis: speech-timed. For huge spoken numbers (50B, 90k, 1.2 million) use treatment=count: start ~70% of the target (50B starts at 35), tick fast, then a small scale punch. Never invent the target.
- caption: DESIGN color, size, and placement for THIS video. If CAPTION_TEMPLATE is locked, set caption.template to that value exactly. Otherwise choose a kinetic look. Pick textColor and highlightColor that contrast the talking-head AND any inset plate — never white-on-white, never teal/cyan on a pale wall.

Hard rules:
- There is no house style and no maximum count.
- cutout only when SPEAKER_CUTOUT is available AND the leftover canvas has a real background.
- USER assets as cards/focus/scroll. The same user clip may be reused for cutaway and depth_overlay at different times.
- If CAPTION_TEMPLATE is locked, honor it over CREATOR_CAPTION_STYLE. Otherwise if CREATOR_CAPTION_STYLE is present, honor it.
- Color grade from AVAILABLE_LUTS (the burn may ignore LUTs in local/dev).
- zooms: 2–4, never first 3.5s, never during cutaway/split/pip/cutout.
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
  treatment?: OverlayTreatment;
  glow?: boolean;
  staggerIndex?: number;
  focusRegion?: FocusRegion | null;
  visualWeight?: 'accent' | 'hero';
  /** Stock-library queries, 2–4 words, most searchable first. */
  queries?: string[];
};

export type DirectedZoom = {
  timestamp: number;
  durationSec: number;
};

export type DirectedDepthOverlay = {
  start: number;
  end: number;
  assetId: string;
  direction: 'up' | 'down';
  opacity?: number;
  duration?: number;
  reason: string;
  searchKeyword?: string;
  queries?: string[];
  userBrollId?: string | null;
  exit?: boolean;
  fit?: 'fit' | 'fill';
};

export type DirectedInsetReveal = {
  start: number;
  end: number;
  variant: 'simple' | 'motion_graphic';
  background: {type: 'solid' | 'gradient' | 'loop' | 'template'; value: string};
  graphic?: {templateId: string; text?: string; data?: Record<string, string | number>};
  captions: boolean;
  reason: string;
  insetScale?: number;
  easing?: string;
  shadow?: boolean;
};

export type VisualDirection = {
  hookTitle: string;
  hookSubtitle: string;
  hookStyle: HookStyle;
  hookStartSec?: number;
  hookEndSec?: number;
  topic: string;
  visualQueries: string[];
  caption: CaptionDirection;
  /** Ranked LUT ids from the on-disk catalog (max 3). */
  suggestedLutIds: string[];
  /** Best single LUT id to apply (may be empty = natural). */
  preferredLutId: string;
  zooms: DirectedZoom[];
  moments: DirectedMoment[];
  depthOverlays: DirectedDepthOverlay[];
  insetReveals: DirectedInsetReveal[];
  motionGraphics: MotionGraphic[];
  mediaContainers: MediaContainerMoment[];
  frameInsets: FrameInset[];
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
  occupancy?: Occupancy;
  speakerCutout?: SpeakerCutout;
  captionStyleGuide?: CaptionStyleGuide | null;
  words?: Array<{text: string; start: number; end: number}>;
  requestedEdits?: string[] | null;
  captionTemplate?: CaptionTemplateId | null;
  userBrollAssets?: Array<{
    id: string;
    description: string;
    durationSec: number;
    kind?: string;
    regions?: Array<{label?: string; x: number; y: number; w: number; h: number}>;
  }>;
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
        occupancy: input.occupancy,
        speakerCutout: input.speakerCutout,
        captionStyleGuide: input.captionStyleGuide,
        words: input.words,
        requestedEdits: input.requestedEdits,
        captionTemplate: input.captionTemplate,
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
        depthOverlays: directed.depthOverlays ?? [],
        insetReveals: directed.insetReveals ?? [],
        motionGraphics:
          directed.motionGraphics.length > 0
            ? directed.motionGraphics
            : fallback.motionGraphics,
        mediaContainers:
          directed.mediaContainers.length > 0
            ? directed.mediaContainers
            : fallback.mediaContainers,
        frameInsets:
          directed.frameInsets.length > 0 ? directed.frameInsets : fallback.frameInsets,
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
  occupancy?: Occupancy;
  speakerCutout?: SpeakerCutout;
  captionStyleGuide?: CaptionStyleGuide | null;
  words?: Array<{text: string; start: number; end: number}>;
  requestedEdits?: string[] | null;
  captionTemplate?: CaptionTemplateId | null;
  userBrollAssets?: Array<{
    id: string;
    description: string;
    durationSec: number;
    kind?: string;
    regions?: Array<{label?: string; x: number; y: number; w: number; h: number}>;
  }>;
}): Promise<Omit<VisualDirection, 'source'>> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(input.model)}:generateContent`;

  const lutEntries = shortlistLutsForDirector();
  const lutPrompt = formatLutsForDirectorPrompt(lutEntries);
  const userBrollBlock =
    input.userBrollAssets && input.userBrollAssets.length > 0
      ? `USER_ASSETS (place these as designed cards or cutaways; set user_broll_id; each id once):\n` +
        input.userBrollAssets
          .map(asset => {
            const kind = asset.kind || 'clip';
            const regions = (asset.regions ?? [])
              .slice(0, 4)
              .map(
                region =>
                  `${region.label || 'region'} @ ${region.x.toFixed(2)},${region.y.toFixed(2)},${region.w.toFixed(2)},${region.h.toFixed(2)}`,
              )
              .join('; ');
            return (
              `- ${asset.id} [${kind}] ${asset.description}` +
              (asset.durationSec > 0.5 ? ` (~${asset.durationSec.toFixed(1)}s)` : '') +
              (regions ? `\n    text_regions: ${regions}` : '')
            );
          })
          .join('\n') +
        `\nDocuments → layout=card treatment=focus with focus_region matching spoken words.\n` +
        `Tall clips/images → treatment=scroll. Photos → treatment=card with glow.\n`
      : '';
  const occupancyBlock = input.occupancy
    ? `${describeOccupancyForDirector(input.occupancy)}\n` +
      (input.speakerCutout ? `${describeCutoutForDirector(input.speakerCutout)}\n\n` : '\n')
    : input.speakerCutout
      ? `${describeCutoutForDirector(input.speakerCutout)}\n\n`
      : '';
  const captionGuideBlock = input.captionStyleGuide
    ? `${formatCaptionGuideForDirector(input.captionStyleGuide)}\n\n`
    : '';
  const timedWords = (input.words ?? [])
    .slice(0, 400)
    .map(
      (word, index) =>
        `${index} [${word.start.toFixed(2)}-${word.end.toFixed(2)}] ${word.text}`,
    )
    .join('\n');
  const requiredEdits = input.requestedEdits?.length
    ? `${allowedEditsPromptBlock(new Set(input.requestedEdits))}\n`
    : '';
  const captionLock = input.captionTemplate
    ? `CAPTION_TEMPLATE is locked to ${input.captionTemplate}. Set caption.template to ${input.captionTemplate}. Do not pick another kinetic look.\n`
    : '';
  const prompt =
    `Clip duration: ${input.sourceDurationSec.toFixed(1)} seconds.\n` +
    `Propose up to ${Math.max(input.momentCount, listBeatsFromTranscript(input.transcript).length + 3)} moments.\n` +
    `Analyze this talking-head and choose a unique subset of primitives — do not apply every tool, and do not copy a previous edit format.\n` +
    `Time every graphic and B-roll to the TIMESTAMPED_WORDS it illustrates. No guessed clocks.\n` +
    `Place every graphic in a LEGAL_SLOT from FRAME_OCCUPANCY. Never cover the speaker or the caption band.\n` +
    `All search_keyword, queries, and visual_world MUST be 2–4 English words naming a visible Pexels scene.\n` +
    `Match the overall TOPIC — never a single random noun. Include video cutaways for list items only if they help the viewer see the point.\n` +
    `Pick a hook_style that fits THIS video. Use motion primitives only when they serve this transcript.\n` +
    `Add motion_graphics when a claim should stay on screen long enough to read. media_containers only if the leftover canvas will hold real assets or a title.\n` +
    `Design caption.template + caption.animation for THIS video. Default to clean/minimal/subtitle/karaoke. Never default to a shiny spoken-word border.\n` +
    requiredEdits +
    captionLock +
    occupancyBlock +
    captionGuideBlock +
    userBrollBlock +
    (timedWords
      ? `TIMESTAMPED_WORDS (use these start/end times; overlay_text must match the words on screen):\n${timedWords}\n\n`
      : '') +
    `AVAILABLE_LUTS (rank up to ${LUT_RANK_LIMIT} suggested_luts from these names only; Neutral is shown separately — do not invent ids):\n${lutPrompt}\n\n` +
    `Transcript:\n${input.transcript.slice(0, 12_000)}`;

  const started = Date.now();
  const body = await requestJson<GeminiResponse>(url, {
    method: 'POST',
    label: 'Gemini visual director',
    failureCode: 'broll_failed',
    timeoutMs: 45_000,
    retries: 1,
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      systemInstruction: {parts: [{text: SYSTEM_INSTRUCTION}]},
      contents: [{role: 'user', parts: [{text: prompt}]}],
      generationConfig: {
        temperature: 0.45,
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
                font_scale: {type: 'NUMBER'},
                animation: {type: 'STRING'},
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
                  queries: {type: 'ARRAY', items: {type: 'STRING'}},
                  why: {type: 'STRING'},
                  media: {type: 'STRING'},
                  layout: {type: 'STRING'},
                  anchor: {type: 'STRING'},
                  overlay_text: {type: 'STRING'},
                  text_style: {type: 'STRING'},
                  accent_color: {type: 'STRING'},
                  user_broll_id: {type: 'STRING'},
                  treatment: {type: 'STRING'},
                  stagger_index: {type: 'NUMBER'},
                  glow: {type: 'BOOLEAN'},
                  visual_weight: {type: 'STRING'},
                  focus_region: {
                    type: 'OBJECT',
                    properties: {
                      x: {type: 'NUMBER'},
                      y: {type: 'NUMBER'},
                      w: {type: 'NUMBER'},
                      h: {type: 'NUMBER'},
                      label: {type: 'STRING'},
                    },
                  },
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
                  pip_anchor: {type: 'STRING'},
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
                  anchor: {type: 'STRING'},
                  count_from: {type: 'NUMBER'},
                  count_to: {type: 'NUMBER'},
                  count_suffix: {type: 'STRING'},
                },
                required: ['start', 'end', 'text'],
              },
            },
            depth_overlays: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  asset_id: {type: 'STRING'},
                  start: {type: 'NUMBER'},
                  end: {type: 'NUMBER'},
                  direction: {type: 'STRING'},
                  opacity: {type: 'NUMBER'},
                  duration: {type: 'NUMBER'},
                  reason: {type: 'STRING'},
                  search_keyword: {type: 'STRING'},
                  user_broll_id: {type: 'STRING'},
                  exit: {type: 'BOOLEAN'},
                  fit: {type: 'STRING'},
                },
                required: ['start', 'end'],
              },
            },
            inset_reveals: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  start: {type: 'NUMBER'},
                  end: {type: 'NUMBER'},
                  variant: {type: 'STRING'},
                  captions: {type: 'BOOLEAN'},
                  reason: {type: 'STRING'},
                  inset_scale: {type: 'NUMBER'},
                  background: {
                    type: 'OBJECT',
                    properties: {
                      type: {type: 'STRING'},
                      value: {type: 'STRING'},
                    },
                  },
                  graphic: {
                    type: 'OBJECT',
                    properties: {
                      template_id: {type: 'STRING'},
                      text: {type: 'STRING'},
                    },
                  },
                },
                required: ['start', 'end'],
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
  dumpDirectorTrace('01-gemini-director', {
    model: input.model,
    requestedEdits: input.requestedEdits ?? null,
    captionTemplate: input.captionTemplate ?? null,
    sourceDurationSec: input.sourceDurationSec,
    systemInstruction: SYSTEM_INSTRUCTION,
    userPrompt: prompt,
    rawResponse: text,
    parsed: {
      topic: parsed.topic,
      hookTitle: parsed.hookTitle,
      hookStyle: parsed.hookStyle,
      caption: parsed.caption,
      zooms: parsed.zooms,
      moments: parsed.moments,
      depthOverlays: parsed.depthOverlays,
      insetReveals: parsed.insetReveals,
      motionGraphics: parsed.motionGraphics,
      mediaContainers: parsed.mediaContainers,
      semanticEmphasis: parsed.semanticEmphasis,
      visualQueries: parsed.visualQueries,
      preferredLutId: parsed.preferredLutId,
      suggestedLutIds: parsed.suggestedLutIds,
    },
    usage: body.usageMetadata ?? {},
  });
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
    const layoutRaw = coerceLayout(item.layout, item.media ?? item.mediaKind);
    const layout =
      layoutRaw === 'sticker' || layoutRaw === 'pip'
        ? 'card'
        : layoutRaw;
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
    const media = coerceMedia(item.media ?? item.mediaKind, layout);
    const treatment = coerceTreatment(
      item.treatment,
      layout,
      media,
    );
    moments.push({
      timestamp,
      searchKeyword:
        layout === 'lockup' || layout === 'chip' || layout === 'banner'
          ? scene || ensureEnglishSearchQuery(keyword) || keyword.slice(0, 60)
          : scene.slice(0, 60),
      media,
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
      treatment,
      glow: item.glow !== false,
      staggerIndex: Math.max(0, Math.round(Number(item.stagger_index ?? item.staggerIndex ?? 0) || 0)),
      focusRegion: parseFocusRegion(item.focus_region ?? item.focusRegion),
      visualWeight:
        String(item.visual_weight ?? item.visualWeight ?? '').toLowerCase() === 'hero'
          ? 'hero'
          : 'accent',
      queries: parseMomentQueries(item, keyword, transcript),
    });
  }

  const visualQueries = parseVisualWorld(
    record.visual_world ?? record.visualWorld,
    transcript,
  );
  const availableLuts = lutCatalogIds();
  let suggestedLutIds = parseSuggestedLutIds(
    record.suggested_luts ?? record.suggestedLuts,
    availableLuts,
    LUT_RANK_LIMIT,
  );
  let preferredLutId = coerceLutId(
    record.preferred_lut ?? record.preferredLut,
    availableLuts,
  );
  if (!preferredLutId && suggestedLutIds[0]) {
    preferredLutId = suggestedLutIds[0];
  }
  if (preferredLutId && !suggestedLutIds.includes(preferredLutId)) {
    suggestedLutIds = [preferredLutId, ...suggestedLutIds].slice(0, LUT_RANK_LIMIT);
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
    depthOverlays: parseDirectedDepthOverlays(record, durationSec),
    insetReveals: parseDirectedInsetReveals(record, durationSec),
    ...parseMotionPlanFromDirector(record, durationSec, transcript),
  };
}

/** Sort only. Style injection was removed so the director stays free. */
export function enforceRequiredLayouts(
  moments: DirectedMoment[],
  _durationSec?: number,
  _transcript?: string,
  _visualQueries?: string[],
): DirectedMoment[] {
  return [...moments].sort((a, b) => a.timestamp - b.timestamp);
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
  const layouts = fallbackLayoutKit(input.transcript);
  const quote = quotedPhrase(input.transcript);
  const phrases = keyPhrasesFromTranscript(input.transcript);
  const count = Math.max(3, Math.min(input.momentCount, Math.max(stock.length, 4)));
  const gap = Math.max(8, (span - 10) / Math.max(1, count));

  const moments: DirectedMoment[] = Array.from({length: count}, (_, index) => {
    const layout = layouts[index % layouts.length]!;
    const media: VisualMediaKind =
      layout === 'cutaway' || layout === 'split' || layout === 'cutout'
        ? 'video'
        : layout === 'lockup' || layout === 'chip' || layout === 'banner' || layout === 'bubble'
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
      textStyle:
        layout === 'lockup' ? 'stack' : layout === 'bubble' ? 'bubble' : 'bar',
      accentColor: '#F7F1E1',
    };
  });

  const zooms: DirectedZoom[] = [
    {timestamp: Math.min(span * 0.28, span - 3), durationSec: 2.6},
    {timestamp: Math.min(span * 0.62, span - 3), durationSec: 2.6},
  ].filter(zoom => zoom.timestamp >= 4);

  return {
    hookTitle,
    hookSubtitle: '',
    hookStyle: coerceHookStyle(undefined, input.transcript, hookTitle),
    topic: hookTitle,
    visualQueries: stock,
    caption: defaultCaptionDirection(input.transcript),
    suggestedLutIds: defaultSuggestedLuts(input.transcript, lutCatalogIds()),
    preferredLutId: defaultSuggestedLuts(input.transcript, lutCatalogIds())[0] || '',
    zooms,
    moments,
    depthOverlays: [],
    insetReveals: [],
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
  if (value === 'person_cutout' || value === 'keyed' || value === 'cut_out') {
    return 'cutout';
  }
  if (value === 'chat' || value === 'message' || value === 'imessage') {
    return 'bubble';
  }
  if (value === 'stat' || value === 'title' || value === 'headline') {
    return 'lockup';
  }
  if (value === 'card' || value === 'photo_card' || value === 'image_card') {
    return 'card';
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
  if (layout === 'cutaway' || layout === 'split' || layout === 'cutout' || layout === 'composite') {
    return 'video';
  }
  if (layout === 'lockup' || layout === 'chip' || layout === 'banner' || layout === 'stat' || layout === 'bubble') {
    return 'text';
  }
  if (layout === 'card' || layout === 'pip' || layout === 'sticker') {
    return 'image';
  }
  return 'image';
}

function coerceTreatment(
  raw: unknown,
  layout: VisualOverlayLayout,
  media: VisualMediaKind,
): OverlayTreatment {
  const value = String(raw ?? '').trim().toLowerCase();
  if ((OVERLAY_TREATMENTS as readonly string[]).includes(value)) {
    return value as OverlayTreatment;
  }
  if (layout === 'card' || layout === 'pip' || layout === 'sticker' || media === 'image') {
    return 'card';
  }
  return 'card';
}

function parseFocusRegion(raw: unknown): FocusRegion | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const x = Number(record.x);
  const y = Number(record.y);
  const w = Number(record.w ?? record.width);
  const h = Number(record.h ?? record.height);
  if (![x, y, w, h].every(Number.isFinite)) {
    return null;
  }
  return {
    x: clamp01(x),
    y: clamp01(y),
    w: Math.min(1, Math.max(0.08, w)),
    h: Math.min(1, Math.max(0.05, h)),
    label: String(record.label ?? '').trim().slice(0, 80) || undefined,
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
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
  const preset = captionPreset(template);
  return {
    position: 'bottom',
    bottomFrac: 0.16,
    textColor: preset.textColor,
    highlightColor: preset.highlightColor,
    boxColor: preset.boxColor,
    template,
    animation: preset.animation,
    fontScale: 1,
  };
}

/** Karaoke word + gold shine box. Used by the captions-only mobile pipeline. */
export function shineCaptionDirection(): CaptionDirection {
  return {
    position: 'bottom',
    bottomFrac: 0.16,
    textColor: '#FFFFFF',
    highlightColor: '#F5B942',
    boxColor: null,
    template: 'karaoke',
    animation: 'highlight',
    fontScale: 1,
    uppercase: false,
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
  const requestedAnimation = coerceCaptionAnimation(record.animation);
  const shineRequested = requestedAnimation === 'highlight';
  const boxExplicitFalse = record.box === false;
  const boxExplicitTrue = record.box === true;
  const boxColorRaw = String(record.box_color ?? record.boxColor ?? '').trim();
  const boxRequested =
    !boxExplicitFalse &&
    !shineRequested &&
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
  const loud = template === 'mrbeast' || template === 'bounce';
  const animation =
    shineRequested && !loud
      ? captionPreset(template).animation
      : requestedAnimation ?? captionPreset(template).animation;
  const fontScaleRaw = Number(record.font_scale ?? record.fontScale);
  const fontScale = Number.isFinite(fontScaleRaw)
    ? Math.min(1.5, Math.max(0.7, fontScaleRaw))
    : fallback.fontScale ?? 1;
  return {
    position,
    bottomFrac: bottomFracFor(position),
    textColor: boxColor ? ensureContrast(textColor, boxColor) : textColor,
    highlightColor,
    boxColor:
      template === 'box' || template === 'subtitle'
        ? boxColor || '#111111'
        : boxColor,
    template,
    animation,
    fontScale,
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

function parseMomentQueries(
  item: Record<string, unknown>,
  keyword: string,
  transcript: string,
): string[] {
  const extras = Array.isArray(item.queries)
    ? item.queries.map(value => String(value ?? '')).filter(Boolean)
    : [];
  return stockFriendlyQueries(keyword, inferStockSubject(transcript), extras);
}

function parseVisualWorld(raw: unknown, transcript: string): string[] {
  const rows = Array.isArray(raw) ? raw : [];
  const subject = inferStockSubject(transcript);
  const cleaned = rows
    .map(value =>
      applySubjectToQuery(
        ensureEnglishSearchQuery(String(value ?? '')) ||
          sanitizeVisualQuery(String(value ?? '')),
        subject,
      ),
    )
    .filter(value => value.split(/\s+/).length >= 2);
  if (cleaned.length >= 2) {
    return stockFriendlyQueries(cleaned[0]!, subject, cleaned.slice(1));
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

function parseDirectedDepthOverlays(
  record: Record<string, unknown>,
  durationSec: number,
): DirectedDepthOverlay[] {
  const rows = Array.isArray(record.depth_overlays)
    ? record.depth_overlays
    : Array.isArray(record.depthOverlays)
      ? record.depthOverlays
      : [];
  const out: DirectedDepthOverlay[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') {
      continue;
    }
    const item = row as Record<string, unknown>;
    const start = Number(item.start ?? item.timestamp);
    const explicitEnd = Number(item.end);
    const holdRaw = Number(item.hold ?? item.hold_sec);
    const end = Number.isFinite(explicitEnd)
      ? explicitEnd
      : start + (Number.isFinite(holdRaw) ? holdRaw : 2.4);
    const assetId = String(item.asset_id ?? item.assetId ?? item.user_broll_id ?? item.userBrollId ?? '').trim();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      continue;
    }
    if (start < 0 || start > durationSec) {
      continue;
    }
    out.push({
      start,
      end: Math.min(durationSec, end),
      assetId,
      direction: String(item.direction ?? '').toLowerCase() === 'up' ? 'up' : 'down',
      opacity: Number.isFinite(Number(item.opacity)) ? Number(item.opacity) : undefined,
      duration: Number.isFinite(Number(item.duration)) ? Number(item.duration) : undefined,
      reason: String(item.reason ?? item.why ?? item.intent ?? ''),
      searchKeyword: String(item.search_keyword ?? item.searchKeyword ?? ''),
      queries: Array.isArray(item.queries) ? item.queries.map(value => String(value)) : undefined,
      userBrollId: assetId || null,
      exit: item.exit === true,
      fit: String(item.fit ?? '') === 'fit' ? 'fit' : 'fill',
    });
  }
  return out;
}

function parseDirectedInsetReveals(
  record: Record<string, unknown>,
  durationSec: number,
): DirectedInsetReveal[] {
  const rows = Array.isArray(record.inset_reveals)
    ? record.inset_reveals
    : Array.isArray(record.insetReveals)
      ? record.insetReveals
      : [];
  const out: DirectedInsetReveal[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') {
      continue;
    }
    const item = row as Record<string, unknown>;
    const start = Number(item.start ?? item.timestamp);
    const explicitEnd = Number(item.end);
    const holdRaw = Number(item.hold ?? item.hold_sec);
    const end = Number.isFinite(explicitEnd)
      ? explicitEnd
      : start + (Number.isFinite(holdRaw) ? holdRaw : 3.2);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      continue;
    }
    if (start < 0 || start > durationSec) {
      continue;
    }
    const backgroundRaw =
      item.background && typeof item.background === 'object'
        ? (item.background as Record<string, unknown>)
        : {};
    const graphicRaw =
      item.graphic && typeof item.graphic === 'object'
        ? (item.graphic as Record<string, unknown>)
        : {};
    const variant =
      String(item.variant ?? '').toLowerCase() === 'motion_graphic'
        ? 'motion_graphic'
        : 'simple';
    const bgType = String(backgroundRaw.type ?? item.background_type ?? 'solid')
      .toLowerCase();
    out.push({
      start,
      end: Math.min(durationSec, end),
      variant,
      background: {
        type:
          bgType === 'gradient' || bgType === 'loop' || bgType === 'template'
            ? bgType
            : 'solid',
        value: String(backgroundRaw.value ?? item.background_value ?? '#111827'),
      },
      graphic:
        variant === 'motion_graphic'
          ? {
              templateId: String(
                graphicRaw.template_id ?? graphicRaw.templateId ?? 'keyword_title',
              ),
              text: String(graphicRaw.text ?? item.text ?? ''),
            }
          : undefined,
      captions: item.captions !== false,
      reason: String(item.reason ?? item.why ?? item.intent ?? ''),
      insetScale: Number.isFinite(Number(item.inset_scale ?? item.insetScale))
        ? Number(item.inset_scale ?? item.insetScale)
        : undefined,
      easing: String(item.easing ?? '') || undefined,
      shadow: item.shadow !== false,
    });
  }
  return out;
}

function coerceCaptionAnimation(raw: unknown): CaptionAnimation | undefined {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  return (CAPTION_ANIMATIONS as readonly string[]).includes(value)
    ? (value as CaptionAnimation)
    : undefined;
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
  if (value === 'outline' || value === 'bar' || value === 'chip' || value === 'poster' || value === 'stack' || value === 'bubble') {
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
  if (layout === 'bubble') {
    return 'bubble';
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

function fallbackLayoutKit(transcript: string): VisualOverlayLayout[] {
  let hash = 0;
  for (let i = 0; i < transcript.length; i += 1) {
    hash = (hash * 31 + transcript.charCodeAt(i)) >>> 0;
  }
  const kits: VisualOverlayLayout[][] = [
    ['cutaway', 'bubble', 'lockup', 'chip'],
    ['split', 'card', 'lockup', 'cutaway'],
    ['cutout', 'bubble', 'lockup', 'card'],
    ['card', 'lockup', 'cutaway', 'chip'],
    ['cutaway', 'split', 'bubble', 'lockup'],
    ['lockup', 'cutout', 'card', 'chip'],
  ];
  return kits[hash % kits.length]!;
}

function pickCaptionTemplate(transcript: string): CaptionTemplateId {
  const text = transcript.toLowerCase();
  if (
    /\b(story|when i|i remember|soft|gentle|quiet|honest|vulnerable)\b/.test(
      text,
    )
  ) {
    return 'weight-shift';
  }
  if (/[!]{2,}|\byo\b|\bwow\b|\binsane\b|\bcrazy\b|\bhype\b/.test(text)) {
    return 'beast';
  }
  if (
    /\b(first|second|third|step|tips?|how to|lesson|learn|because)\b/.test(text)
  ) {
    return 'karaoke';
  }
  if (/\b(premium|luxury|elegant|calm|brand)\b/.test(text)) {
    return 'grape';
  }
  if (/\b(energy|exciting|lets go|let['']s go|fire)\b/.test(text)) {
    return 'hustle';
  }
  if (/\b(buy|sale|offer|comment|link|shop|dm)\b/.test(text)) {
    return 'pop';
  }
  // Rotate fallback so back-to-back videos don't clone one look.
  const bucket = Math.abs(text.length) % 7;
  const rotation: CaptionTemplateId[] = [
    'karaoke',
    'basic',
    'beast',
    'pop',
    'grape',
    'gaming-stream',
    'editorial-emphasis',
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
    if (prefer.length >= LUT_RANK_LIMIT) {
      break;
    }
    pushIf(id);
  }
  return prefer.slice(0, LUT_RANK_LIMIT);
}

function captionPreset(template: CaptionTemplateId): {
  textColor: string;
  highlightColor: string;
  boxColor: string | null;
  animation: CaptionAnimation;
} {
  if (template === 'beast' || template === 'mrbeast') {
    return {textColor: '#FFFF00', highlightColor: '#FF6600', boxColor: null, animation: 'scale'};
  }
  if (template === 'box' || template === 'grape') {
    return {
      textColor: '#FFFFFF',
      highlightColor: '#FFFFFF',
      boxColor: template === 'grape' ? '#6D28D9' : '#111111',
      animation: 'box',
    };
  }
  if (template === 'bounce' || template === 'hustle' || template === 'pop' || template === 'poppin') {
    return {textColor: '#FFFFFF', highlightColor: '#00FF88', boxColor: null, animation: 'bounce'};
  }
  if (template === 'karaoke') {
    return {textColor: '#111111', highlightColor: '#F5B942', boxColor: null, animation: 'karaoke'};
  }
  if (template === 'minimal' || template === 'weight-shift' || template === 'basic') {
    return {textColor: '#FFFFFF', highlightColor: '#F5F5F5', boxColor: null, animation: 'scale'};
  }
  if (template === 'hormozi' || template === 'gaming-stream') {
    return {textColor: '#FFFFFF', highlightColor: '#00E5FF', boxColor: null, animation: 'scale'};
  }
  if (template === 'subtitle' || template === 'soft-ai' || template === 'moving-pill') {
    return {textColor: '#F8FAFC', highlightColor: '#F8FAFC', boxColor: '#111111', animation: 'box'};
  }
  if (template === 'editorial-emphasis') {
    return {textColor: '#FFFFFF', highlightColor: '#FACC15', boxColor: null, animation: 'highlight'};
  }
  if (template === 'clean') {
    return {textColor: '#FFFFFF', highlightColor: '#FFFFFF', boxColor: null, animation: 'scale'};
  }
  return {textColor: '#FFFFFF', highlightColor: '#FFFFFF', boxColor: null, animation: 'scale'};
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
