/**
 * Resolve Director depth_overlay decisions to blueprint clips.
 * Separate from B-roll placement: never writes brollClips or visualOverlays.
 */

import {stageLogger} from '../../lib/logger.ts';
import {
  defaultDepthOverlayParams,
  speakerVisibleRanges,
  validateDepthOverlays,
  type DepthOverlayClip,
} from '../../lib/depthOverlay.ts';
import {clamp, round, type Timeline} from '../filters/timeline.ts';
import type {Occupancy} from '../layout/occupancy.ts';
import type {DirectedDepthOverlay} from './geminiDirector.ts';
import {findPhotoAsset, stockAssetKeyOf, stockConfigured} from './stockSearch.ts';
import type {UserBrollAsset} from './userBrollDescribe.ts';
import type {BRollClip, VisualOverlay} from '../../types/blueprint.ts';

const log = stageLogger('depth-overlay-planner');

export async function resolveDepthOverlays(input: {
  directed: DirectedDepthOverlay[] | undefined;
  timeline: Timeline;
  userBrollById: Map<string, UserBrollAsset>;
  usedUserIds: Set<string>;
  usedPhotoKeys: Set<string>;
  clips: BRollClip[];
  overlays: VisualOverlay[];
  occupancy?: Occupancy;
  occupancySlices?: Array<{atSec: number; occupancy: Occupancy}>;
  maskAvailable: boolean;
  allowStock?: boolean;
  alreadyOutput?: boolean;
}): Promise<{clips: DepthOverlayClip[]; warnings: string[]}> {
  const warnings: string[] = [];
  const directed = input.directed ?? [];
  if (directed.length === 0) {
    return {clips: [], warnings};
  }

  const resolved: Array<{
    id?: string;
    start: number;
    end: number;
    direction: 'up' | 'down';
    reason?: string;
    assetId?: string;
    width?: number;
    height?: number;
    params: ReturnType<typeof defaultDepthOverlayParams>;
    assetUrl: string;
    mediaKind: 'video' | 'image';
    keyword?: string;
    provider?: DepthOverlayClip['provider'];
    durationSec?: number;
  }> = [];

  for (const [index, item] of directed.entries()) {
    const start = input.alreadyOutput
      ? clamp(item.start, 0, input.timeline.outputDurationSec)
      : input.timeline.mapSourceToOutputClamped(item.start);
    const end = input.alreadyOutput
      ? clamp(item.end, start, input.timeline.outputDurationSec)
      : input.timeline.mapSourceToOutputClamped(item.end);
    const user = resolveUserDepthAsset(item, input.userBrollById);
    if (user) {
      resolved.push({
        id: item.assetId || item.userBrollId || `depth_${index}`,
        start,
        end,
        direction: item.direction,
        reason: item.reason,
        assetId: user.id,
        width: user.width,
        height: user.height,
        params: defaultDepthOverlayParams({
          direction: item.direction,
          opacity: item.opacity,
          duration: item.duration ?? 0.75,
          exit: item.exit ?? true,
          fit: item.fit,
        }),
        assetUrl: user.url,
        mediaKind: user.kind === 'clip' || user.kind === 'tall' ? 'video' : 'image',
        keyword: item.searchKeyword || user.description.slice(0, 60),
        provider: 'user',
        durationSec: user.durationSec,
      });
      continue;
    }

    if (!input.allowStock || !stockConfigured()) {
      warnings.push(`depth_overlay_no_asset:${item.assetId || index}`);
      continue;
    }
    const query = (item.queries?.[0] || item.searchKeyword || '').trim();
    if (!query) {
      warnings.push(`depth_overlay_no_query:${index}`);
      continue;
    }
    try {
      const photo = await findPhotoAsset(query, {
        excludeKeys: input.usedPhotoKeys,
        orientation: 'portrait',
      });
      if (!photo) {
        warnings.push(`depth_overlay_stock_miss:${query}`);
        continue;
      }
      input.usedPhotoKeys.add(stockAssetKeyOf(photo));
      resolved.push({
        id: item.assetId || `depth_stock_${index}`,
        start,
        end,
        direction: item.direction,
        reason: item.reason,
        assetId: item.assetId || `stock:${photo.provider}:${photo.providerId}`,
        width: photo.width,
        height: photo.height,
        params: defaultDepthOverlayParams({
          direction: item.direction,
          opacity: item.opacity,
          duration: item.duration,
          exit: item.exit,
          fit: item.fit,
        }),
        assetUrl: photo.assetUrl,
        mediaKind: 'image',
        keyword: query,
        provider: photo.provider,
      });
    } catch (error) {
      log.warn({error, query}, 'depth overlay stock lookup failed');
      warnings.push(`depth_overlay_stock_failed:${query}`);
    }
  }

  const brollRanges = [
    ...input.clips.map(clip => ({start: clip.start, end: clip.end})),
    ...input.overlays
      .filter(
        overlay =>
          overlay.layout === 'split' ||
          overlay.layout === 'cutout' ||
          overlay.layout === 'cutaway' ||
          overlay.layout === 'composite',
      )
      .map(overlay => ({start: overlay.start, end: overlay.end})),
  ];
  const slices = input.occupancySlices?.length
    ? input.occupancySlices
    : input.occupancy
      ? [{atSec: 0, occupancy: input.occupancy}]
      : [];
  const gated = validateDepthOverlays({
    clips: resolved,
    outputDurationSec: input.timeline.outputDurationSec,
    maskAvailable: input.maskAvailable,
    brollRanges,
    speakerVisible: speakerVisibleRanges(slices, input.timeline.outputDurationSec),
  });
  warnings.push(...gated.drops);
  const byId = new Map(resolved.map(item => [item.id, item]));
  const clips: DepthOverlayClip[] = gated.clips.flatMap(clip => {
    const raw = byId.get(clip.id);
    if (!raw?.assetUrl) {
      return [];
    }
    return [
      {
        type: 'depth_overlay',
        assetId: raw.assetId || '',
        assetUrl: raw.assetUrl,
        mediaKind: raw.mediaKind,
        start: round(clip.start),
        end: round(clip.end),
        params: clip.params,
        reason: clip.reason,
        keyword: raw.keyword,
        provider: raw.provider,
        width: raw.width,
        height: raw.height,
        durationSec: raw.durationSec,
      },
    ];
  });
  if (clips.length > 0) {
    log.info(
      {
        count: clips.length,
        reasons: clips.map(clip => ({
          assetId: clip.assetId,
          start: clip.start,
          end: clip.end,
          direction: clip.params.animation.direction,
          reason: clip.reason,
        })),
      },
      'depth overlays placed',
    );
  }
  return {clips, warnings};
}

function resolveUserDepthAsset(
  item: DirectedDepthOverlay,
  userBrollById: Map<string, UserBrollAsset>,
): UserBrollAsset | undefined {
  if (item.assetId && userBrollById.has(item.assetId)) {
    return userBrollById.get(item.assetId);
  }
  if (item.userBrollId && userBrollById.has(item.userBrollId)) {
    return userBrollById.get(item.userBrollId);
  }
  const assets = [...userBrollById.values()];
  return (
    assets.find(asset => asset.kind === 'clip' || asset.kind === 'tall') ??
    assets[0]
  );
}
