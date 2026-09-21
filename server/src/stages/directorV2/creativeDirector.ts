import {
  CAPTION_ANIMATIONS,
  CAPTION_POSITIONS,
  CAPTION_TEMPLATES,
  HOOK_STYLES,
  OVERLAY_TREATMENTS,
  VISUAL_ANCHORS,
  VISUAL_OVERLAY_LAYOUTS,
  type AudioDesign,
  type CaptionDirection,
  type HookStyle,
} from '../../types/blueprint.ts';
import {formatLutsForDirectorPrompt, lutCatalogEntries, lutCatalogIds, LUT_RANK_LIMIT, parseSuggestedLutIds, coerceLutId} from '../color/lutCatalog.ts';
import {legalSlots} from '../layout/occupancy.ts';
import {defaultCaptionDirection} from '../broll/geminiDirector.ts';
import {inferStockSubject, stockFriendlyQueries} from '../broll/visualQuery.ts';
import {speakerVisibleRanges} from '../../lib/depthOverlay.ts';
import {allowedEditsPromptBlock, isKindAllowed} from '../../lib/editToolkits.ts';
import {insetGraphicTemplatesForDirector} from '../../lib/insetReveal.ts';
import {callDirectorModel, frameParts} from './geminiClient.ts';
import {
  fillTemplate,
  loadPromptFile,
  rendererCapabilitiesText,
  STAGE2_PROMPT_VERSION,
} from './promptLoader.ts';
import {
  formatFrameLabels,
  formatOccupancySlices,
  formatWordIdTranscript,
} from './perception.ts';
import {ELEMENT_KINDS, STAGE2_RESPONSE_SCHEMA} from './schemas.ts';
import type {
  CreativeElement,
  CreativePlan,
  EditThesis,
  ElementParams,
  PerceptionPack,
  StoryAnalysis,
} from './types.ts';

export async function designEdit(
  pack: PerceptionPack,
  story: StoryAnalysis,
  forceSpeakerCutout = false,
  requestedEdits: Set<string> | null = null,
): Promise<CreativePlan> {
  const frames = await frameParts(pack.storyboard.map(frame => frame.path));
  const system = loadPromptFile(STAGE2_PROMPT_VERSION);
  const user = fillStage2User(pack, story, '', forceSpeakerCutout, requestedEdits);
  const result = await callDirectorModel({
    system,
    label: 'Director v2 creative director',
    responseSchema: STAGE2_RESPONSE_SCHEMA,
    temperature: 0.8,
    thinkingBudget: 8_192,
    timeoutMs: 180_000,
    parts: [...frames, {text: user}],
  });
  return parseCreativePlan(result.json, result.estimatedCostUsd, pack, story, {
    promptVersion: STAGE2_PROMPT_VERSION,
    inputHash: result.inputHash,
  });
}

export async function repairEdit(
  pack: PerceptionPack,
  previous: CreativePlan,
  story: StoryAnalysis,
  violations: Array<{code: string; elementId?: string; reason: string}>,
): Promise<CreativePlan> {
  const frames = await frameParts(pack.storyboard.map(frame => frame.path));
  const system = loadPromptFile(STAGE2_PROMPT_VERSION);
  const repairBlock =
    'REPAIR BLOCK — targeted fixes only. Keep the thesis. Change only the listed elements.\n' +
    violations.map(item => `- ${item.code} ${item.elementId ?? ''} ${item.reason}`).join('\n');
  const user = fillStage2User(
    pack,
    story,
    repairBlock,
    false,
    pack.requestedEdits ? new Set(pack.requestedEdits) : null,
  );
  const result = await callDirectorModel({
    system,
    label: 'Director v2 repair',
    responseSchema: STAGE2_RESPONSE_SCHEMA,
    temperature: 0.4,
    thinkingBudget: 4_096,
    timeoutMs: 120_000,
    parts: [
      ...frames,
      {
        text: `${user}\n\nPREVIOUS_PLAN:\n${JSON.stringify(previous.raw ?? previous).slice(0, 18_000)}`,
      },
    ],
  });
  return parseCreativePlan(result.json, result.estimatedCostUsd, pack, story, {
    promptVersion: STAGE2_PROMPT_VERSION,
    inputHash: result.inputHash,
  });
}

export function fillStage2User(
  pack: PerceptionPack,
  story: StoryAnalysis,
  repairBlock = '',
  forceSpeakerCutout = false,
  requestedEdits: Set<string> | null = null,
): string {
  const template = loadPromptFile('stage2_creative_director.user.v1');
  const cutout = pack.speakerCutoutAvailable
    ? `available. ${pack.speakerCutoutNote || 'Key/crop the speaker over B-roll.'}`
    : 'not available. Do not emit kind=cutout.';
  const assets = pack.userAssets.length
    ? pack.userAssets
        .map(asset => {
          const size =
            asset.width && asset.height ? `${asset.width}x${asset.height}` : 'unknown-res';
          const tags = asset.tags?.length ? ` tags=${asset.tags.join(',')}` : '';
          return `${asset.id} (${asset.kind || 'media'} ${asset.durationSec.toFixed(1)}s ${size}${tags}) ${asset.description}`;
        })
        .join('\n')
    : 'none';
  const mask = pack.speakerCutoutAvailable
    ? 'available. You MAY emit kind=depth_overlay when an asset is relevant and the speaker is visible.'
    : 'not available. Do NOT emit kind=depth_overlay.';
  const visible = speakerVisibleRanges(pack.occupancySlices);
  const visibleText = visible.length
    ? visible.map(range => `${range.start.toFixed(2)}–${range.end.toFixed(2)}s`).join(', ')
    : 'unknown (treat as visible unless occupancy says the speaker is cropped/tiny)';
  return fillTemplate(template, {
    OUTPUT_DURATION_SEC: pack.outputDurationSec.toFixed(1),
    LANGUAGE: pack.language || 'en',
    STAGE1_JSON: JSON.stringify(story.raw ?? story, null, 2).slice(0, 20_000),
    'CREATOR_PROFILE_OR_"none. Design freely."':
      pack.creatorProfile.trim() || 'none. Design freely.',
    WORD_ID_TRANSCRIPT: formatWordIdTranscript(pack),
    'FRAME_LABELS + IMAGES': formatFrameLabels(pack),
    OCCUPANCY_SLICES: formatOccupancySlices(pack),
    'available | not available, plus keying info': forceSpeakerCutout
      ? `${cutout} FORCE_SPEAKER_CUTOUT: include at least one cutout.`
      : cutout,
    SUBJECT_MASK: forceSpeakerCutout ? `${mask} FORCE: mask treated as available.` : mask,
    SPEAKER_VISIBLE_RANGES: visibleText,
    ASSET_LIST_WITH_DESCRIPTIONS_AND_TEXT_REGIONS: assets,
    LUT_LIST: formatLutsForDirectorPrompt(lutCatalogEntries()),
    LIST_OF_SUPPORTED_KINDS_AND_PARAMS_GENERATED_FROM_CODE: rendererCapabilitiesText(),
    INSET_REVEAL_GRAPHIC_TEMPLATES: insetGraphicTemplatesForDirector(),
    THEME_COLORS: pack.themeColors?.length
      ? pack.themeColors.join(', ')
      : 'none — pick one restrained background and reuse it',
    ALLOWED_EDIT_STYLES: allowedEditsPromptBlock(requestedEdits),
    REPAIR_BLOCK_IF_ANY: repairBlock,
  });
}

export function parseCreativePlan(
  raw: unknown,
  estimatedCostUsd: number,
  pack: PerceptionPack,
  story?: StoryAnalysis,
  meta: {promptVersion: string; inputHash: string} = {
    promptVersion: STAGE2_PROMPT_VERSION,
    inputHash: '',
  },
): CreativePlan {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const ids = new Set(pack.words.map(word => word.id));
  const occupancy = pack.occupancySlices[0]?.occupancy;
  const slots = occupancy ? legalSlots(occupancy) : [];
  const subject = inferStockSubject(pack.transcript);
  const elements: CreativeElement[] = [];
  const rows = Array.isArray(record.elements) ? record.elements : [];
  for (const [index, row] of rows.entries()) {
    if (!row || typeof row !== 'object') {
      continue;
    }
    const item = row as Record<string, unknown>;
    const startWordId = String(item.start_word_id ?? item.startWordId ?? '');
    const endWordId = String(item.end_word_id ?? item.endWordId ?? '');
    if (!ids.has(startWordId) || !ids.has(endWordId)) {
      continue;
    }
    const kind = coerceEnum(item.kind, ELEMENT_KINDS);
    if (!kind) {
      continue;
    }
    if (!isKindAllowed(kind, pack.requestedEdits ? new Set(pack.requestedEdits) : null)) {
      continue;
    }
    const asset = item.asset && typeof item.asset === 'object'
      ? (item.asset as Record<string, unknown>)
      : {};
    const queries = stockFriendlyQueries(
      Array.isArray(asset.queries) ? String(asset.queries[0] ?? '') : '',
      subject,
      [
        ...(Array.isArray(asset.queries) ? asset.queries.slice(1).map(value => String(value)) : []),
        String(item.search_keyword ?? ''),
      ].filter(Boolean),
    );
    const text = String(item.text ?? item.overlay_text ?? '');
    const slotId = String(item.slot_id ?? '');
    const slot = slots.find(entry => entry.id === slotId);
    const params = parseParams(item.params);
    elements.push({
      id: String(item.id ?? `e${index + 1}`),
      beatId: String(item.beat_id ?? item.beatId ?? ''),
      intent: String(item.intent ?? ''),
      kind,
      wordRange: {
        startWordId,
        endWordId,
        preRollMs: Number(item.pre_roll_ms ?? 0) || 0,
        postRollMs: Number(item.post_roll_ms ?? 0) || 0,
      },
      slotId: slotId || undefined,
      zIndex: Number(item.z_index ?? 0) || undefined,
      enter: String(item.enter ?? ''),
      exit: String(item.exit ?? ''),
      easing: String(item.easing ?? ''),
      searchKeyword: queries[0] || String(item.search_keyword ?? ''),
      overlayText: text,
      layout: layoutForKind(kind, coerceEnum(item.layout, VISUAL_OVERLAY_LAYOUTS)),
      treatment: params.treatment ?? coerceEnum(item.treatment, OVERLAY_TREATMENTS),
      anchor: slot?.anchor ?? coerceEnum(item.anchor, VISUAL_ANCHORS),
      userBrollId: String(asset.user_asset_id ?? item.user_broll_id ?? '') || undefined,
      accentColor: String(item.accent_color ?? ''),
      textColor: String(item.text_color ?? ''),
      text,
      queries,
      params,
    });
  }

  const captionRaw = record.caption_style && typeof record.caption_style === 'object'
    ? (record.caption_style as Record<string, unknown>)
    : {};
  const fallback = defaultCaptionDirection(pack.transcript);
  const caption: CaptionDirection = {
    ...fallback,
    template: coerceEnum(captionRaw.template, CAPTION_TEMPLATES) ?? fallback.template,
    position: coerceEnum(captionRaw.position, CAPTION_POSITIONS) ?? fallback.position,
    textColor: String(captionRaw.text_color ?? fallback.textColor),
    highlightColor: String(captionRaw.highlight_color ?? fallback.highlightColor),
    boxColor: String(captionRaw.box_color ?? fallback.boxColor ?? '') || fallback.boxColor,
    animation: coerceEnum(captionRaw.animation, CAPTION_ANIMATIONS) ?? fallback.animation,
    fontScale: Number(captionRaw.font_scale ?? fallback.fontScale ?? 1) || 1,
    uppercase: captionRaw.uppercase === true,
  };

  const thesis = parseThesis(record.edit_thesis);
  const hookElement = elements.find(element => element.kind === 'hook_title');
  const hookTitle = calmHookCopy(
    hookElement?.text ||
      hookElement?.overlayText ||
      '',
  );

  const lutRaw = record.lut && typeof record.lut === 'object'
    ? (record.lut as Record<string, unknown>)
    : {};
  const ctaRaw = record.cta && typeof record.cta === 'object'
    ? (record.cta as Record<string, unknown>)
    : null;
  const coldRaw = record.cold_open && typeof record.cold_open === 'object'
    ? (record.cold_open as Record<string, unknown>)
    : {};
  const sound = parseSound(record.sound);
  const review = record.self_review && typeof record.self_review === 'object'
    ? (record.self_review as Record<string, unknown>)
    : {};

  return {
    editThesis: [thesis.look, thesis.rhythm, thesis.motionLanguage, thesis.colorStory, thesis.why]
      .filter(Boolean)
      .join(' '),
    editThesisParts: thesis,
    hookTitle,
    hookStyle: calmHookStyle(coerceEnum(hookElement?.params?.shape, HOOK_STYLES) ?? 'stack'),
    caption,
    preferredLutId: coerceLutId(lutRaw.preferred_id ?? lutRaw.preferredLutId, lutCatalogIds()),
    suggestedLutIds: parseSuggestedLutIds(
      lutRaw.suggested_ids ?? lutRaw.suggestedLutIds,
      lutCatalogIds(),
      LUT_RANK_LIMIT,
    ),
    elements,
    cta: ctaRaw && ids.has(String(ctaRaw.start_word_id ?? ''))
      ? {
          wordRange: {
            startWordId: String(ctaRaw.start_word_id),
            endWordId: String(ctaRaw.end_word_id ?? ctaRaw.start_word_id),
          },
          keyword: String(ctaRaw.keyword ?? 'comment'),
          onScreenPrompt: String(ctaRaw.on_screen_prompt_element_id ?? ctaRaw.on_screen_prompt ?? ''),
          dmReplyDraft: String(ctaRaw.dm_reply_draft ?? '').slice(0, 300),
          followUpDraft: String(ctaRaw.follow_up_draft ?? ''),
          suggested: ctaRaw.suggested === true,
          spokenLine: String(ctaRaw.suggested_spoken_line ?? ''),
        }
      : undefined,
    sound,
    coldOpen: {
      use: coldRaw.use === true,
      sourceStartWordId: String(coldRaw.source_start_word_id ?? ''),
      sourceEndWordId: String(coldRaw.source_end_word_id ?? ''),
      howItReturns: String(coldRaw.how_it_returns ?? ''),
    },
    selfReview: {
      strongestChoice: String(review.strongest_choice ?? ''),
      riskiestChoice: String(review.riskiest_choice ?? ''),
      whatIWouldCut: Array.isArray(review.what_i_would_cut_if_too_busy)
        ? review.what_i_would_cut_if_too_busy.map(value => String(value))
        : [],
    },
    estimatedCostUsd,
    promptVersion: meta.promptVersion,
    inputHash: meta.inputHash,
    raw,
  };
}

function parseThesis(raw: unknown): EditThesis {
  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    return {
      look: String(record.look ?? ''),
      rhythm: String(record.rhythm ?? ''),
      motionLanguage: String(record.motion_language ?? record.motionLanguage ?? ''),
      colorStory: String(record.color_story ?? record.colorStory ?? ''),
      why: String(record.why ?? ''),
    };
  }
  const text = String(raw ?? '');
  return {look: text, rhythm: '', motionLanguage: '', colorStory: '', why: ''};
}

function parseParams(raw: unknown): ElementParams {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const item = raw as Record<string, unknown>;
  return {
    treatment: coerceEnum(item.treatment, OVERLAY_TREATMENTS),
    shape: String(item.shape ?? '') || undefined,
    fontScale: Number(item.font_scale ?? 0) || undefined,
    italic: item.italic === true,
    countFrom: Number.isFinite(Number(item.count_from)) ? Number(item.count_from) : undefined,
    countTo: Number.isFinite(Number(item.count_to)) ? Number(item.count_to) : undefined,
    countSuffix: String(item.count_suffix ?? '') || undefined,
    zoomScale: Number(item.zoom_scale ?? 0) || undefined,
    containerMode: String(item.container_mode ?? '') || undefined,
    canvasColor: String(item.canvas_color ?? '') || undefined,
    marginColor: String(item.margin_color ?? '') || undefined,
    cornerRadius: Number(item.corner_radius ?? 0) || undefined,
    transitionStyle: String(item.transition_style ?? '') || undefined,
    transitionSec: Number(item.transition_sec ?? 0) || undefined,
    scale: Number(item.scale ?? 0) || undefined,
    speakerSide: item.speaker_side === 'bottom' ? 'bottom' : item.speaker_side === 'top' ? 'top' : undefined,
    glow: item.glow === true,
    direction: item.direction === 'up' ? 'up' : item.direction === 'down' ? 'down' : undefined,
    opacity: Number.isFinite(Number(item.opacity)) ? Number(item.opacity) : undefined,
    duration: Number.isFinite(Number(item.duration)) ? Number(item.duration) : undefined,
    exit: item.exit === true,
    fit: item.fit === 'fit' ? 'fit' : item.fit === 'fill' ? 'fill' : undefined,
    feather: Number.isFinite(Number(item.feather)) ? Number(item.feather) : undefined,
    variant:
      item.variant === 'motion_graphic'
        ? 'motion_graphic'
        : item.variant === 'simple'
          ? 'simple'
          : undefined,
    insetScale: Number.isFinite(Number(item.inset_scale ?? item.insetScale))
      ? Number(item.inset_scale ?? item.insetScale)
      : undefined,
    backgroundType: String(item.background_type ?? item.backgroundType ?? '') || undefined,
    backgroundValue: String(item.background_value ?? item.backgroundValue ?? '') || undefined,
    graphicTemplateId: String(item.graphic_template_id ?? item.graphicTemplateId ?? '') || undefined,
    graphicText: String(item.graphic_text ?? item.graphicText ?? '') || undefined,
    enterOffset: Number.isFinite(Number(item.enter_offset ?? item.enterOffset))
      ? Number(item.enter_offset ?? item.enterOffset)
      : undefined,
    exitOffset: Number.isFinite(Number(item.exit_offset ?? item.exitOffset))
      ? Number(item.exit_offset ?? item.exitOffset)
      : undefined,
    captionsEnabled:
      item.captions === false || item.captionsEnabled === false ? false : item.captions === true || item.captionsEnabled === true ? true : undefined,
    shadow: item.shadow === false ? false : item.shadow === true ? true : undefined,
  };
}

function parseSound(raw: unknown): AudioDesign | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const music = record.music && typeof record.music === 'object'
    ? (record.music as Record<string, unknown>)
    : {};
  const sfx = Array.isArray(record.sfx) ? record.sfx : [];
  return {
    musicMood: String(music.mood ?? ''),
    ducking: Number(music.duck_under_speech_db ?? 0) < 0,
    sfx: sfx.flatMap(row => {
      if (!row || typeof row !== 'object') {
        return [];
      }
      const item = row as Record<string, unknown>;
      return [{
        atWordId: String(item.at_word_id ?? ''),
        kind: String(item.type ?? 'none'),
        intent: String(item.intent ?? ''),
      }];
    }),
  };
}

function layoutForKind(
  kind: CreativeElement['kind'],
  explicit?: CreativeElement['layout'],
): CreativeElement['layout'] {
  if (explicit) {
    return explicit;
  }
  if (kind === 'frame_inset') {
    return 'lockup';
  }
  if (kind === 'inset_reveal' || kind === 'depth_overlay') {
    return 'lockup';
  }
  if (kind === 'slideshow') {
    if (explicit === 'split' || explicit === 'card' || explicit === 'pip') {
      return explicit;
    }
    return 'card';
  }
  if (kind === 'cutaway' || kind === 'split' || kind === 'cutout' || kind === 'card' || kind === 'bubble' || kind === 'lockup') {
    return kind;
  }
  return 'lockup';
}

export function calmHookCopy(raw: string): string {
  const cleaned = raw.replace(/\s+/g, ' ').replace(/[!?]{2,}/g, '!').trim();
  if (!cleaned) {
    return '';
  }
  const toned = cleaned.replace(/\b([A-Z]{4,})\b/g, word => word.charAt(0) + word.slice(1).toLowerCase());
  if (toned.length <= 52) {
    return toned;
  }
  return `${toned.slice(0, 49).trim()}…`;
}

export function calmHookStyle(style: HookStyle): HookStyle {
  return (HOOK_STYLES as readonly string[]).includes(style) ? style : 'stack';
}

function coerceEnum<T extends string>(raw: unknown, allowed: readonly T[]): T | undefined {
  const value = String(raw ?? '').trim();
  return (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}
