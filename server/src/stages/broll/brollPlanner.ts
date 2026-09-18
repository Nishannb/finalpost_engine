/**
 * Stage C — director + stock lookup into output-time clips and overlays.
 *
 * Fails soft: a Gemini outage or empty stock set degrades to keyword fallback
 * plus text graphics, never to a failed analysis. The talking-head burn still
 * ships with a hook title even when stock footage is missing.
 * Video assets come from Pexels and/or Pixabay (whichever keys are configured).
 */

import {env} from '../../config/env.ts';
import {isEngineError} from '../../lib/errors.ts';
import {stageLogger} from '../../lib/logger.ts';
import type {
  BRollClip,
  CaptionDirection,
  HookStyle,
  MediaContainerMoment,
  MotionGraphic,
  OverlayTextStyle,
  SemanticEmphasis,
  TransitionClip,
  VisualOverlay,
  WordToken,
} from '../../types/blueprint.ts';
import type {FramePalette} from '../../media/ffmpeg.ts';
import {clamp, round, type Timeline} from '../filters/timeline.ts';
import {
  defaultCaptionDirection,
  directorConfigured,
  fallbackVisualDirection,
  planVisualDirection,
  type DirectedMoment,
  type DirectedZoom,
} from './geminiDirector.ts';
import type {StockAsset} from './stockTypes.ts';
import {stockAssetKeyOf, stockConfigured, findBRollAsset} from './stockSearch.ts';
import {contrastCaptionWithFootage} from './captionContrast.ts';
import {applyEditorialGate} from './editorialGate.ts';
import {englishQueryVariants, ensureEnglishSearchQuery} from './englishSearch.ts';
import {listBeatsFromTranscript} from './listBeats.ts';
import {alignTimestampToSpeech} from './speechAlign.ts';
import {
  scoreUserBrollMatch,
  type UserBrollAsset,
} from './userBrollDescribe.ts';
import {
  applySubjectToQuery,
  genderedQueryVariants,
  inferStockSubject,
  keyPhrasesFromTranscript,
  themeQueriesFromTranscript,
} from './visualQuery.ts';

const log = stageLogger('stage-c-broll');

const MIN_GAP_SEC = 1.5;
const HOOK_GUARD_SEC = 3.5;

const TRANSITION_QUERIES = [
  'light leak overlay',
  'film burn',
  'ink splash',
  'smoke overlay',
  'fire overlay',
  'paper wipe',
  'glitch overlay',
];

export type VisualPlan = {
  hookTitle: string;
  hookSubtitle: string;
  hookStyle: HookStyle;
  hookDurationSec: number;
  caption: CaptionDirection;
  suggestedLutIds: string[];
  preferredLutId: string;
  clips: BRollClip[];
  overlays: VisualOverlay[];
  transitions: TransitionClip[];
  motionGraphics: MotionGraphic[];
  mediaContainers: MediaContainerMoment[];
  semanticEmphasis: SemanticEmphasis[];
  zooms: DirectedZoom[];
  warnings: string[];
  estimatedCostUsd: number;
};

export async function planBRoll(input: {
  transcript: string;
  sourceDurationSec: number;
  timeline: Timeline;
  palette?: FramePalette;
  words?: WordToken[];
  userBrollAssets?: UserBrollAsset[];
}): Promise<VisualPlan> {
  const warnings: string[] = [];
  const userBrollAssets = input.userBrollAssets ?? [];
  const hookDurationSec = Math.min(
    env.HOOK_DURATION_SEC,
    Math.max(1.2, input.timeline.outputDurationSec * 0.2),
  );

  if (!env.BROLL_ENABLED) {
    const fallback = fallbackVisualDirection({
      transcript: input.transcript,
      sourceDurationSec: input.sourceDurationSec,
      momentCount: 1,
    });
    return {
      hookTitle: fallback.hookTitle,
      hookSubtitle: '',
      hookStyle: fallback.hookStyle,
      hookDurationSec,
      caption: fallback.caption,
      suggestedLutIds: fallback.suggestedLutIds,
      preferredLutId: fallback.preferredLutId,
      clips: [],
      overlays: [],
      transitions: [],
      motionGraphics: fallback.motionGraphics,
      mediaContainers: fallback.mediaContainers,
      semanticEmphasis: fallback.semanticEmphasis,
      zooms: [],
      warnings: ['broll_disabled'],
      estimatedCostUsd: 0,
    };
  }

  let estimatedCostUsd = 0;
  let direction = fallbackVisualDirection({
    transcript: input.transcript,
    sourceDurationSec: input.sourceDurationSec,
    momentCount: env.BROLL_MOMENT_COUNT,
  });

  try {
    direction = await planVisualDirection({
      transcript: input.transcript,
      sourceDurationSec: input.sourceDurationSec,
      momentCount: env.BROLL_MOMENT_COUNT,
      userBrollAssets: userBrollAssets.map(asset => ({
        id: asset.id,
        description: asset.description,
        durationSec: asset.durationSec,
      })),
    });
    estimatedCostUsd += direction.estimatedCostUsd;
    if (direction.source === 'fallback') {
      warnings.push('director_fallback');
    }
  } catch (error) {
    const code = isEngineError(error) ? error.code : 'broll_failed';
    log.warn({error}, 'visual director failed; using keyword fallback');
    warnings.push(`director_${code}`);
  }

  // If director ignored uploads, greedily tag cutaways with best-matching assets.
  if (userBrollAssets.length > 0) {
    assignUserBrollToMoments(direction.moments, userBrollAssets);
  }

  const usedVideoKeys = new Set<string>();
  const usedPhotoKeys = new Set<string>();
  const usedUserIds = new Set<string>();
  const userBrollById = new Map(userBrollAssets.map(asset => [asset.id, asset]));
  const clips: BRollClip[] = [];
  const overlays: VisualOverlay[] = [];
  const subject = inferStockSubject(input.transcript);
  const visualQueries = (
    direction.visualQueries.length > 0
      ? direction.visualQueries
      : themeQueriesFromTranscript(input.transcript)
  ).map(query => applySubjectToQuery(query, subject));

  const words = input.words ?? [];
  const speechAligned = direction.moments.map(moment => ({
    ...moment,
    timestamp: alignTimestampToSpeech(
      moment.timestamp,
      moment.searchKeyword,
      words,
      moment.overlayText,
    ),
  }));

  let splitCount = 0;
  for (const moment of spacedMoments(speechAligned, input.sourceDurationSec)) {
    try {
      const placed = await resolveMoment(
        {
          ...moment,
          searchKeyword: applySubjectToQuery(moment.searchKeyword, subject),
        },
        {
          timeline: input.timeline,
          usedVideoKeys,
          usedPhotoKeys,
          usedUserIds,
          userBrollById,
          visualQueries,
          subject,
          splitCount,
        },
      );
      if (!placed) {
        warnings.push(`no_match:${moment.searchKeyword}`);
        continue;
      }
      if (placed.clip) {
        clips.push(placed.clip);
      }
      if (placed.overlay) {
        overlays.push(placed.overlay);
        if (placed.overlay.layout === 'split') {
          splitCount += 1;
        }
      }
    } catch (error) {
      log.warn({error, keyword: moment.searchKeyword}, 'asset lookup failed');
      warnings.push(`stock_failed:${moment.searchKeyword}`);
    }
  }

  // Place leftover creator clips into quiet gaps so uploads aren't wasted.
  placeLeftoverUserBroll({
    assets: userBrollAssets,
    usedUserIds,
    clips,
    timeline: input.timeline,
    sourceDurationSec: input.sourceDurationSec,
  });

  const keptOverlays = dropOverlappingOverlays(overlays, clips);
  const splitWindows = keptOverlays.filter(overlay => overlay.layout === 'split');
  const keptClips = dropOverlappingClips(clips).filter(
    clip =>
      !splitWindows.some(split => clip.start < split.end && clip.end > split.start),
  );
  if (keptClips.length < clips.length || keptOverlays.length < overlays.length) {
    warnings.push('overlapping_clips_dropped');
  }

  if (stockConfigured() && keptClips.length < 2) {
    const extras = await ensureCutaways({
      needed: 2 - keptClips.length,
      queries: visualQueries,
      timeline: input.timeline,
      usedVideoKeys,
      existingClips: keptClips,
      existingOverlays: keptOverlays,
      subject,
    });
    keptClips.push(...extras);
    if (extras.length > 0) {
      warnings.push('cutaways_backfilled');
    }
  }

  if (stockConfigured() && input.timeline.outputDurationSec > 16) {
    const staticExtras = await fillStaticTalkingHeadGaps({
      queries: visualQueries,
      timeline: input.timeline,
      usedVideoKeys,
      existingClips: keptClips,
      existingOverlays: keptOverlays,
      subject,
      maxTalkSec: 5.5,
    });
    keptClips.push(...staticExtras);
    if (staticExtras.length > 0) {
      warnings.push(`static_gaps_filled:${staticExtras.length}`);
    }
  }

  if (stockConfigured() && input.timeline.outputDurationSec > 18) {
    const hasSplit = keptOverlays.some(overlay => overlay.layout === 'split');
    if (!hasSplit) {
      const split = await ensureSplit({
        queries: visualQueries,
        timeline: input.timeline,
        usedVideoKeys,
        existingClips: keptClips,
        existingOverlays: keptOverlays,
        subject,
      });
      if (split) {
        keptOverlays.push(split);
        warnings.push('split_backfilled');
      }
    }
  }

  const phraseCount = keptOverlays.filter(
    overlay => overlay.layout === 'lockup' && overlay.textStyle === 'stack',
  ).length;
  if (phraseCount < 1) {
    const extras = phraseCardsFromTranscript(
      input.transcript,
      input.timeline,
      keptClips,
      keptOverlays,
    );
    keptOverlays.push(...extras);
    if (extras.length > 0) {
      warnings.push('phrase_cards_filled');
    }
  }

  const transitions = planTransitions({
    clips: keptClips,
    overlays: keptOverlays,
  });

  const gated = applyEditorialGate({
    clips: keptClips,
    overlays: keptOverlays,
    transitions,
    zooms: direction.zooms,
    outputDurationSec: input.timeline.outputDurationSec,
    listMode: listBeatsFromTranscript(input.transcript).length >= 2,
  });
  warnings.push(...gated.warnings);

  if (!stockConfigured()) {
    warnings.push('broll_not_configured');
  }
  if (!directorConfigured()) {
    warnings.push('director_not_configured');
  }

  return {
    hookTitle: direction.hookTitle,
    hookSubtitle: '',
    hookStyle: direction.hookStyle,
    hookDurationSec: round(hookDurationSec),
    caption: input.palette
      ? contrastCaptionWithFootage(
          direction.caption ?? defaultCaptionDirection(input.transcript),
          input.palette,
        )
      : direction.caption ?? defaultCaptionDirection(input.transcript),
    suggestedLutIds: direction.suggestedLutIds ?? [],
    preferredLutId: direction.preferredLutId ?? '',
    clips: gated.clips.sort((a, b) => a.start - b.start),
    overlays: gated.overlays,
    transitions: gated.transitions,
    motionGraphics: remapMotionGraphics(
      direction.motionGraphics ?? [],
      input.timeline,
    ),
    mediaContainers: remapMediaContainers(
      direction.mediaContainers ?? [],
      input.timeline,
    ),
    semanticEmphasis: remapSemanticEmphasis(
      direction.semanticEmphasis ?? [],
      input.timeline,
    ),
    zooms: gated.zooms,
    warnings,
    estimatedCostUsd,
  };
}

async function resolveMoment(
  moment: DirectedMoment,
  ctx: {
    timeline: Timeline;
    usedVideoKeys: Set<string>;
    usedPhotoKeys: Set<string>;
    usedUserIds: Set<string>;
    userBrollById: Map<string, UserBrollAsset>;
    visualQueries: string[];
    subject: ReturnType<typeof inferStockSubject>;
    splitCount: number;
  },
): Promise<{clip?: BRollClip; overlay?: VisualOverlay} | null> {
  const duration = durationFor(moment.layout);
  const start = ctx.timeline.mapSourceToOutputClamped(moment.timestamp);
  const end = clamp(start + duration, start, ctx.timeline.outputDurationSec);
  if (end - start < 0.7) {
    return null;
  }
  if (start < HOOK_GUARD_SEC && ctx.timeline.outputDurationSec > HOOK_GUARD_SEC + 2) {
    return null;
  }

  if (
    moment.layout === 'lockup' ||
    moment.layout === 'chip' ||
    moment.layout === 'banner' ||
    moment.layout === 'stat' ||
    moment.media === 'text'
  ) {
    return {
      overlay: textOverlay(moment, start, end),
    };
  }

  if (moment.layout === 'cutaway' || moment.layout === 'split') {
    const userAsset = pickUserBrollForMoment(moment, ctx);
    if (userAsset) {
      ctx.usedUserIds.add(userAsset.id);
      if (moment.layout === 'split') {
        return {
          overlay: toUserOverlay(
            moment,
            userAsset,
            start,
            Math.min(end, start + 2.6),
            'split',
            pickSpeakerSide(moment.searchKeyword, ctx.splitCount),
          ),
        };
      }
      return {
        clip: toUserClip(
          moment,
          userAsset,
          start,
          Math.min(end, start + Math.max(duration, 2.4)),
        ),
      };
    }

    if (!stockConfigured()) {
      return null;
    }

    const queries = momentQueries(moment.searchKeyword, ctx.subject);
    const video = await firstVideo(queries, {
      minDurationSec: Math.min(duration, 2.2),
      excludeKeys: ctx.usedVideoKeys,
    });
    if (!video) {
      return null;
    }
    if (moment.layout === 'split') {
      ctx.usedVideoKeys.add(stockAssetKeyOf(video));
      return {
        overlay: toOverlay(
          moment,
          video,
          start,
          Math.min(end, start + 2.6),
          'video',
          'split',
          pickSpeakerSide(moment.searchKeyword, ctx.splitCount),
        ),
      };
    }
    ctx.usedVideoKeys.add(stockAssetKeyOf(video));
    return {
      clip: toClip(moment, video, start, Math.min(end, start + Math.max(duration, 2.4))),
    };
  }

  // No photo stickers/composites — they read as random and fight the story.
  return null;
}

function pickUserBrollForMoment(
  moment: DirectedMoment,
  ctx: {
    usedUserIds: Set<string>;
    userBrollById: Map<string, UserBrollAsset>;
  },
): UserBrollAsset | null {
  if (moment.userBrollId) {
    const tagged = ctx.userBrollById.get(moment.userBrollId);
    if (tagged && !ctx.usedUserIds.has(tagged.id)) {
      return tagged;
    }
  }
  let best: UserBrollAsset | null = null;
  let bestScore = 0.34;
  for (const asset of ctx.userBrollById.values()) {
    if (ctx.usedUserIds.has(asset.id)) {
      continue;
    }
    const score = scoreUserBrollMatch(asset, moment.searchKeyword);
    if (score > bestScore) {
      bestScore = score;
      best = asset;
    }
  }
  return best;
}

function assignUserBrollToMoments(
  moments: DirectedMoment[],
  assets: UserBrollAsset[],
): void {
  const used = new Set(
    moments.map(m => m.userBrollId).filter((id): id is string => Boolean(id)),
  );
  for (const moment of moments) {
    if (moment.userBrollId || (moment.layout !== 'cutaway' && moment.layout !== 'split')) {
      continue;
    }
    let best: UserBrollAsset | null = null;
    let bestScore = 0.28;
    for (const asset of assets) {
      if (used.has(asset.id)) {
        continue;
      }
      const score = scoreUserBrollMatch(asset, moment.searchKeyword);
      if (score > bestScore) {
        bestScore = score;
        best = asset;
      }
    }
    if (best) {
      moment.userBrollId = best.id;
      used.add(best.id);
    }
  }
  // Assign remaining assets to untagged cutaways in order.
  const leftover = assets.filter(asset => !used.has(asset.id));
  let li = 0;
  for (const moment of moments) {
    if (li >= leftover.length) {
      break;
    }
    if (moment.userBrollId || moment.layout !== 'cutaway') {
      continue;
    }
    moment.userBrollId = leftover[li]!.id;
    li += 1;
  }
}

function placeLeftoverUserBroll(input: {
  assets: UserBrollAsset[];
  usedUserIds: Set<string>;
  clips: BRollClip[];
  timeline: Timeline;
  sourceDurationSec: number;
}): void {
  const leftovers = input.assets.filter(asset => !input.usedUserIds.has(asset.id));
  if (leftovers.length === 0) {
    return;
  }
  const occupied = input.clips.map(clip => ({start: clip.start, end: clip.end}));
  let cursor = HOOK_GUARD_SEC + 0.5;
  for (const asset of leftovers) {
    const duration = Math.min(2.6, Math.max(1.8, Math.min(asset.durationSec, 2.8)));
    let placed = false;
    while (cursor + duration < input.timeline.outputDurationSec - 0.8) {
      const start = cursor;
      const end = start + duration;
      const overlaps = occupied.some(
        win => start < win.end + 0.4 && end > win.start - 0.4,
      );
      if (!overlaps) {
        input.clips.push({
          start: round(start),
          end: round(end),
          keyword: asset.description.slice(0, 60) || asset.id,
          assetUrl: asset.url,
          provider: 'user',
          providerId: userProviderId(asset.id),
          width: asset.width,
          height: asset.height,
          credit: 'Creator B-roll',
          creditUrl: '',
        });
        occupied.push({start, end});
        input.usedUserIds.add(asset.id);
        cursor = end + MIN_GAP_SEC + 1.2;
        placed = true;
        break;
      }
      cursor += 1.1;
    }
    if (!placed) {
      log.debug({id: asset.id}, 'could not place leftover user broll');
    }
  }
}

function toUserClip(
  moment: DirectedMoment,
  asset: UserBrollAsset,
  start: number,
  end: number,
): BRollClip {
  return {
    start: round(start),
    end: round(end),
    keyword: moment.searchKeyword || asset.description.slice(0, 60),
    assetUrl: asset.url,
    provider: 'user',
    providerId: userProviderId(asset.id),
    width: asset.width,
    height: asset.height,
    credit: 'Creator B-roll',
    creditUrl: '',
  };
}

function toUserOverlay(
  moment: DirectedMoment,
  asset: UserBrollAsset,
  start: number,
  end: number,
  layout: VisualOverlay['layout'],
  speakerSide?: 'top' | 'bottom',
): VisualOverlay {
  return {
    start: round(start),
    end: round(end),
    layout,
    mediaKind: 'video',
    anchor: moment.anchor,
    keyword: moment.searchKeyword || asset.description.slice(0, 60),
    overlayText: moment.overlayText,
    assetUrl: asset.url,
    provider: 'user',
    providerId: userProviderId(asset.id),
    width: asset.width,
    height: asset.height,
    credit: 'Creator B-roll',
    creditUrl: '',
    accentColor: moment.accentColor || '#FFFFFF',
    textStyle: moment.textStyle || 'outline',
    speakerSide: layout === 'split' ? speakerSide ?? 'bottom' : undefined,
  };
}

function userProviderId(id: string): number {
  const match = id.match(/(\d+)/);
  return match ? Number(match[1]) : 1;
}

async function firstVideo(
  queries: string[],
  options: {minDurationSec: number; excludeKeys: Set<string>},
): Promise<StockAsset | null> {
  for (const query of queries) {
    const asset = await findBRollAsset(query, options);
    if (asset) {
      return asset;
    }
  }
  return null;
}

/** Only variants of THIS moment's scene — never unrelated visual_world fallbacks. */
function momentQueries(
  keyword: string,
  subject: ReturnType<typeof inferStockSubject>,
): string[] {
  const primary =
    ensureEnglishSearchQuery(keyword) ||
    applySubjectToQuery(keyword, subject);
  return [
    ...new Set([
      ...genderedQueryVariants(primary, subject),
      ...englishQueryVariants(primary),
    ]),
  ].filter(value => value.split(/\s+/).length >= 2);
}

function uniqueQueries(
  values: string[],
  subject: ReturnType<typeof inferStockSubject> = null,
): string[] {
  const expanded = values.flatMap(value => {
    const english = ensureEnglishSearchQuery(value) || value;
    return genderedQueryVariants(english, subject);
  });
  const pool = expanded.length > 0 ? expanded : values;
  return [...new Set(pool.map(value => value.trim()).filter(value => value.length >= 3))];
}

function durationFor(layout: DirectedMoment['layout']): number {
  if (layout === 'split') {
    return 2.8;
  }
  if (layout === 'cutaway' || layout === 'composite') {
    return Math.max(2.2, Math.min(2.6, env.BROLL_CLIP_DURATION_SEC));
  }
  if (layout === 'pip' || layout === 'sticker') {
    return 2.2;
  }
  return 2.2;
}

function toClip(
  moment: DirectedMoment,
  asset: StockAsset,
  start: number,
  end: number,
): BRollClip {
  return {
    start: round(start),
    end: round(end),
    keyword: moment.searchKeyword,
    assetUrl: asset.assetUrl,
    provider: asset.provider,
    providerId: asset.providerId,
    width: asset.width,
    height: asset.height,
    credit: asset.credit,
    creditUrl: asset.creditUrl,
  };
}

function toOverlay(
  moment: DirectedMoment,
  asset: StockAsset,
  start: number,
  end: number,
  mediaKind: VisualOverlay['mediaKind'],
  layout: VisualOverlay['layout'],
  speakerSide?: 'top' | 'bottom',
): VisualOverlay {
  return {
    start: round(start),
    end: round(end),
    layout,
    mediaKind,
    anchor: moment.anchor,
    keyword: moment.searchKeyword,
    overlayText: moment.overlayText,
    assetUrl: asset.assetUrl,
    provider: asset.provider,
    providerId: asset.providerId,
    width: asset.width,
    height: asset.height,
    credit: asset.credit,
    creditUrl: asset.creditUrl,
    accentColor: moment.accentColor || '#FFFFFF',
    textStyle: moment.textStyle || 'outline',
    speakerSide: layout === 'split' ? speakerSide ?? 'bottom' : undefined,
  };
}

function pickSpeakerSide(seed: string, splitIndex: number): 'top' | 'bottom' {
  let hash = splitIndex * 17;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash % 2 === 0 ? 'top' : 'bottom';
}

function textOverlay(
  moment: DirectedMoment,
  start: number,
  end: number,
): VisualOverlay {
  return {
    start: round(start),
    end: round(end),
    layout:
      moment.layout === 'chip' || moment.layout === 'banner' || moment.layout === 'lockup'
        ? moment.layout
        : 'lockup',
    mediaKind: 'text',
    anchor: moment.anchor,
    keyword: moment.searchKeyword,
    overlayText: moment.overlayText || moment.searchKeyword,
    assetUrl: '',
    provider: 'generated',
    providerId: 0,
    width: 0,
    height: 0,
    credit: '',
    creditUrl: '',
    accentColor: moment.accentColor || '#FFFFFF',
    textStyle: (moment.textStyle || 'bar') as OverlayTextStyle,
  };
}

function spacedMoments(
  moments: DirectedMoment[],
  durationSec: number,
): DirectedMoment[] {
  const sorted = [...moments].sort((a, b) => a.timestamp - b.timestamp);
  const out: DirectedMoment[] = [];
  for (const moment of sorted) {
    const timestamp = Math.max(HOOK_GUARD_SEC, Math.min(durationSec - 1, moment.timestamp));
    const previous = out.at(-1);
    const speechLocked = moment.layout === 'cutaway' || moment.layout === 'split';
    if (previous && timestamp < previous.timestamp + (speechLocked ? 2.6 : 5)) {
      if (speechLocked) {
        // Never nudge speech-aligned cutaways — that desyncs "swimming" from the swim shot.
        // Drop the earlier visual if this one is closer to a new spoken beat.
        if (
          (previous.layout === 'cutaway' || previous.layout === 'split') &&
          timestamp - previous.timestamp < 2.6
        ) {
          continue;
        }
        out.push({...moment, timestamp});
        continue;
      }
      const keep =
        moment.layout === 'lockup' && moment.textStyle === 'stack';
      const nudged = previous.timestamp + 5.2;
      if (!keep || nudged > durationSec - 2.8) {
        continue;
      }
      out.push({...moment, timestamp: nudged});
      continue;
    }
    out.push({...moment, timestamp});
  }
  return out;
}

function dropOverlappingClips(clips: BRollClip[]): BRollClip[] {
  const sorted = [...clips].sort((a, b) => a.start - b.start);
  const out: BRollClip[] = [];
  for (const clip of sorted) {
    const previous = out.at(-1);
    if (previous && clip.start < previous.end + MIN_GAP_SEC) {
      continue;
    }
    out.push(clip);
  }
  return out;
}

function dropOverlappingOverlays(
  overlays: VisualOverlay[],
  clips: BRollClip[],
): VisualOverlay[] {
  const sorted = [...overlays].sort((a, b) => {
    const rank = (layout: VisualOverlay['layout']) =>
      layout === 'split' ? 0 : layout === 'lockup' ? 1 : 2;
    const byRank = rank(a.layout) - rank(b.layout);
    return byRank !== 0 ? byRank : a.start - b.start;
  });
  const out: VisualOverlay[] = [];
  for (const overlay of sorted) {
    const hitsClip = clips.some(
      clip => overlay.start < clip.end && overlay.end > clip.start,
    );
    if (overlay.layout === 'split') {
      out.push(overlay);
      continue;
    }
    if (
      hitsClip &&
      overlay.layout !== 'pip' &&
      overlay.layout !== 'sticker' &&
      overlay.layout !== 'chip'
    ) {
      continue;
    }
    const hitsKept = out.some(
      previous => overlay.start < previous.end + MIN_GAP_SEC && overlay.end > previous.start - MIN_GAP_SEC,
    );
    if (hitsKept && overlay.layout !== 'pip' && overlay.layout !== 'sticker') {
      continue;
    }
    out.push(overlay);
  }
  return out.sort((a, b) => a.start - b.start);
}

function overlapsAny(
  start: number,
  end: number,
  clips: BRollClip[],
  overlays: VisualOverlay[],
): boolean {
  return (
    clips.some(clip => start < clip.end && end > clip.start) ||
    overlays.some(overlay => start < overlay.end && end > overlay.start)
  );
}

function planTransitions(input: {
  clips: BRollClip[];
  overlays: VisualOverlay[];
}): TransitionClip[] {
  const cuts = [
    ...input.clips.map(clip => clip.start),
    ...input.overlays
      .filter(
        overlay =>
          overlay.layout === 'split' ||
          overlay.layout === 'composite' ||
          overlay.layout === 'cutaway',
      )
      .map(overlay => overlay.start),
  ]
    .filter((at, index, all) => all.findIndex(other => Math.abs(other - at) < 0.4) === index)
    .sort((a, b) => a - b)
    .filter(at => at > 3.2);

  return cuts.slice(0, 6).map((at, index) => ({
    at: round(at),
    duration: 0.38,
    keyword: TRANSITION_QUERIES[index % TRANSITION_QUERIES.length]!,
    assetUrl: '',
    blend: index % 2 === 0 ? 'screen' : 'lighten',
    provider: 'generated',
    providerId: 0,
    width: 1080,
    height: 1920,
    credit: '',
    creditUrl: '',
  }));
}

async function ensureCutaways(input: {
  needed: number;
  queries: string[];
  timeline: Timeline;
  usedVideoKeys: Set<string>;
  existingClips: BRollClip[];
  existingOverlays: VisualOverlay[];
  subject: ReturnType<typeof inferStockSubject>;
}): Promise<BRollClip[]> {
  const extras: BRollClip[] = [];
  const output = input.timeline.outputDurationSec;
  const duration = Math.max(2.2, Math.min(2.6, env.BROLL_CLIP_DURATION_SEC));
  const slots = [output * 0.22, output * 0.48, output * 0.72]
    .map(start => Math.max(HOOK_GUARD_SEC + 0.4, start))
    .filter(start => start + duration < output - 0.4);

  for (const start of slots) {
    if (extras.length >= input.needed) {
      break;
    }
    if (overlapsAny(start, start + duration, [...input.existingClips, ...extras], input.existingOverlays)) {
      continue;
    }
    const video = await firstVideo(uniqueQueries(input.queries, input.subject), {
      minDurationSec: 2,
      excludeKeys: input.usedVideoKeys,
    });
    if (!video) {
      break;
    }
    input.usedVideoKeys.add(stockAssetKeyOf(video));
    extras.push(
      toClip(
        {
          timestamp: start,
          searchKeyword: input.queries[0] ?? 'cinematic travel',
          media: 'video',
          layout: 'cutaway',
          anchor: 'top',
          overlayText: '',
          textStyle: 'outline',
          accentColor: '#FFFFFF',
        },
        video,
        start,
        start + duration,
      ),
    );
  }
  return extras;
}

/**
 * Long unbroken talking-head stretches feel static. Drop a cutaway into each
 * gap longer than maxTalkSec between existing cutaways/splits.
 */
export function findStaticGapStarts(input: {
  outputDurationSec: number;
  clips: BRollClip[];
  overlays: VisualOverlay[];
  maxTalkSec: number;
  cutawayDurationSec: number;
}): number[] {
  const occupied = [
    ...input.clips.map(clip => ({start: clip.start, end: clip.end})),
    ...input.overlays
      .filter(overlay => overlay.layout === 'split' || overlay.layout === 'cutaway')
      .map(overlay => ({start: overlay.start, end: overlay.end})),
  ].sort((a, b) => a.start - b.start);

  const merged: Array<{start: number; end: number}> = [];
  for (const range of occupied) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end + 0.35) {
      previous.end = Math.max(previous.end, range.end);
      continue;
    }
    merged.push({...range});
  }

  const starts: number[] = [];
  let cursor = HOOK_GUARD_SEC;
  const endLimit = input.outputDurationSec - 0.5;
  const pushGap = (from: number, to: number) => {
    const gap = to - from;
    if (gap < input.maxTalkSec) {
      return;
    }
    const start = from + Math.max(0.8, (gap - input.cutawayDurationSec) / 2);
    if (
      start >= HOOK_GUARD_SEC + 0.2 &&
      start + input.cutawayDurationSec <= endLimit
    ) {
      starts.push(start);
    }
  };

  for (const range of merged) {
    pushGap(cursor, range.start);
    cursor = Math.max(cursor, range.end);
  }
  pushGap(cursor, endLimit);
  return starts.slice(0, 4);
}

async function fillStaticTalkingHeadGaps(input: {
  queries: string[];
  timeline: Timeline;
  usedVideoKeys: Set<string>;
  existingClips: BRollClip[];
  existingOverlays: VisualOverlay[];
  subject: ReturnType<typeof inferStockSubject>;
  maxTalkSec: number;
}): Promise<BRollClip[]> {
  const duration = Math.max(2.2, Math.min(2.6, env.BROLL_CLIP_DURATION_SEC));
  const slots = findStaticGapStarts({
    outputDurationSec: input.timeline.outputDurationSec,
    clips: input.existingClips,
    overlays: input.existingOverlays,
    maxTalkSec: input.maxTalkSec,
    cutawayDurationSec: duration,
  });
  const extras: BRollClip[] = [];
  for (const start of slots) {
    if (overlapsAny(start, start + duration, [...input.existingClips, ...extras], input.existingOverlays)) {
      continue;
    }
    const video = await firstVideo(uniqueQueries(input.queries, input.subject), {
      minDurationSec: 2,
      excludeKeys: input.usedVideoKeys,
    });
    if (!video) {
      break;
    }
    input.usedVideoKeys.add(stockAssetKeyOf(video));
    extras.push(
      toClip(
        {
          timestamp: start,
          searchKeyword: input.queries[extras.length % Math.max(1, input.queries.length)] ?? 'lifestyle broll',
          media: 'video',
          layout: 'cutaway',
          anchor: 'top',
          overlayText: '',
          textStyle: 'outline',
          accentColor: '#FFFFFF',
        },
        video,
        start,
        start + duration,
      ),
    );
  }
  return extras;
}

function findOpenSlot(
  duration: number,
  output: number,
  clips: BRollClip[],
  overlays: VisualOverlay[],
): number | null {
  const earliest = HOOK_GUARD_SEC + 0.6;
  const latest = output - duration - 0.5;
  if (latest <= earliest) {
    return null;
  }
  const preferred = [
    output * 0.38,
    output * 0.18,
    output * 0.55,
    output * 0.68,
    output * 0.82,
  ];
  for (const raw of preferred) {
    const start = Math.max(earliest, Math.min(latest, raw));
    if (!overlapsAny(start, start + duration, clips, overlays)) {
      return start;
    }
  }
  for (let start = earliest; start <= latest; start += 1.1) {
    if (!overlapsAny(start, start + duration, clips, overlays)) {
      return start;
    }
  }
  return null;
}

async function ensureSplit(input: {
  queries: string[];
  timeline: Timeline;
  usedVideoKeys: Set<string>;
  existingClips: BRollClip[];
  existingOverlays: VisualOverlay[];
  subject: ReturnType<typeof inferStockSubject>;
}): Promise<VisualOverlay | null> {
  const output = input.timeline.outputDurationSec;
  const duration = 2.5;
  const start = findOpenSlot(
    duration,
    output,
    input.existingClips,
    input.existingOverlays,
  );
  if (start == null) {
    return null;
  }
  const end = start + duration;
  const video = await firstVideo(uniqueQueries(input.queries, input.subject), {
    minDurationSec: 2,
    excludeKeys: input.usedVideoKeys,
  });
  if (!video) {
    return null;
  }
  input.usedVideoKeys.add(stockAssetKeyOf(video));
  return toOverlay(
    {
      timestamp: start,
      searchKeyword: input.queries[0] ?? 'woman walking airport',
      media: 'video',
      layout: 'split',
      anchor: 'top',
      overlayText: '',
      textStyle: 'outline',
      accentColor: '#FFFFFF',
    },
    video,
    start,
    end,
    'video',
    'split',
    pickSpeakerSide(input.queries[0] ?? 'split', input.existingOverlays.length),
  );
}

function phraseCardsFromTranscript(
  transcript: string,
  timeline: Timeline,
  clips: BRollClip[],
  overlays: VisualOverlay[],
): VisualOverlay[] {
  const phrases = keyPhrasesFromTranscript(transcript, 2);
  if (phrases.length === 0) {
    return [];
  }
  const output = timeline.outputDurationSec;
  const duration = 2.6;
  const extras: VisualOverlay[] = [];
  for (const [index, phrase] of phrases.entries()) {
    const start = findOpenSlot(duration, output, clips, [...overlays, ...extras]);
    if (start == null) {
      break;
    }
    extras.push(
      textOverlay(
        {
          timestamp: start,
          searchKeyword: 'phrase',
          media: 'text',
          layout: 'lockup',
          anchor: index % 2 === 0 ? 'top_left' : 'top_right',
          overlayText: phrase,
          textStyle: 'stack',
          accentColor: '#F7F1E1',
        },
        start,
        start + duration,
      ),
    );
    if (extras.length >= 2) {
      break;
    }
  }
  return extras;
}

function remapMotionGraphics(
  graphics: MotionGraphic[],
  timeline: Timeline,
): MotionGraphic[] {
  return graphics
    .map(graphic => {
      const start = timeline.mapSourceToOutputClamped(graphic.start);
      const end = timeline.mapSourceToOutputClamped(graphic.end);
      if (end - start < 0.5 || start < HOOK_GUARD_SEC - 0.3) {
        return null;
      }
      return {
        ...graphic,
        start: round(start),
        end: round(Math.min(timeline.outputDurationSec, Math.max(start + 0.7, end))),
      };
    })
    .filter((graphic): graphic is MotionGraphic => graphic != null)
    .slice(0, 6);
}

function remapMediaContainers(
  containers: MediaContainerMoment[],
  timeline: Timeline,
): MediaContainerMoment[] {
  return containers
    .map(container => {
      const start = timeline.mapSourceToOutputClamped(container.start);
      const end = timeline.mapSourceToOutputClamped(container.end);
      if (end - start < 1.2 || start < HOOK_GUARD_SEC) {
        return null;
      }
      return {
        ...container,
        start: round(start),
        end: round(Math.min(timeline.outputDurationSec, Math.max(start + 1.5, end))),
      };
    })
    .filter((container): container is MediaContainerMoment => container != null)
    .slice(0, 3);
}

function remapSemanticEmphasis(
  emphasis: SemanticEmphasis[],
  timeline: Timeline,
): SemanticEmphasis[] {
  return emphasis
    .map(item => {
      const start = timeline.mapSourceToOutputClamped(item.start);
      const end = timeline.mapSourceToOutputClamped(item.end);
      if (end - start < 0.4 || start < HOOK_GUARD_SEC - 0.3) {
        return null;
      }
      return {
        ...item,
        start: round(start),
        end: round(Math.min(timeline.outputDurationSec, Math.max(start + 0.6, end))),
      };
    })
    .filter((item): item is SemanticEmphasis => item != null)
    .slice(0, 5);
}
