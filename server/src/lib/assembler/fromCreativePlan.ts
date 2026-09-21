import type {CaptionDirection} from '../../types/blueprint.ts';
import {legalSlots} from '../../stages/layout/occupancy.ts';
import type {CreativeElement, CreativePlan, PerceptionPack} from '../../stages/directorV2/types.ts';
import {
  DEFAULT_USER_SUITABILITY,
  parsePriority,
  type Candidate,
  type FootageCapabilities,
  type MediaContext,
  type Plan,
  type PlanElement,
  type Word,
} from './types.ts';

const CAPTION_BAND = {x: 0, y: 0.76, w: 1, h: 0.24};
const FALLBACK_CAPTION: CaptionDirection = {
  position: 'bottom',
  bottomFrac: 0.16,
  textColor: '#FFFFFF',
  highlightColor: '#F5B942',
  boxColor: null,
  template: 'clean',
};

export function wordsFromPack(pack: PerceptionPack): Word[] {
  return pack.words.map(word => ({
    id: word.id,
    text: word.text,
    start: word.start,
    end: word.end,
  }));
}

export function capabilitiesFromPack(pack: PerceptionPack): FootageCapabilities {
  const occupancy = pack.occupancySlices[0]?.occupancy;
  const slots = occupancy ? legalSlots(occupancy) : [];
  return {
    speakerMask: pack.speakerCutoutAvailable ? 'available' : 'unavailable',
    occupancySource: occupancy?.source === 'vision' ? 'detected' : 'fallback',
    safeRegions: slots.map(slot => slot.rect),
    captionBand: CAPTION_BAND,
  };
}

export function candidatesFromPack(pack: PerceptionPack): Candidate[] {
  return pack.userAssets.map(asset => ({
    assetId: asset.id,
    source: 'user' as const,
    description: asset.description,
    durationSec: asset.durationSec,
    suitability:
      typeof (asset as {suitability?: number}).suitability === 'number'
        ? (asset as {suitability?: number}).suitability
        : DEFAULT_USER_SUITABILITY,
  }));
}

export function mediaContextFromPack(pack: PerceptionPack): MediaContext {
  return {
    durationSec: pack.outputDurationSec,
    words: wordsFromPack(pack),
    capabilities: capabilitiesFromPack(pack),
    candidates: candidatesFromPack(pack),
  };
}

export function fromCreativePlan(plan: CreativePlan, pack: PerceptionPack): Plan {
  const discarded = discardedFromRaw(plan.raw);
  const placedIds = new Set(
    plan.elements
      .map(element => assetIdFromElement(element))
      .filter((id): id is string => Boolean(id)),
  );
  for (const asset of pack.userAssets) {
    if (!placedIds.has(asset.id) && !discarded.some(item => item.assetId === asset.id)) {
      discarded.push({
        assetId: asset.id,
        reason: 'Director did not place this user asset.',
      });
    }
  }
  return {
    thesis: plan.editThesis,
    elements: plan.elements.map(element => toPlanElement(element)),
    captions: plan.caption ?? FALLBACK_CAPTION,
    hookTitle: plan.hookTitle,
    hookStyle: plan.hookStyle,
    coldOpen:
      plan.coldOpen?.use && plan.coldOpen.sourceStartWordId && plan.coldOpen.sourceEndWordId
        ? {
            startWord: plan.coldOpen.sourceStartWordId,
            endWord: plan.coldOpen.sourceEndWordId,
          }
        : undefined,
    discardedAssets: discarded,
    requestedEdits: (pack.requestedEdits ?? []).filter(id => id !== 'captions' && id !== 'delivery_shaping'),
  };
}

export function toPlanElement(element: CreativeElement): PlanElement {
  const assetId = assetIdFromElement(element);
  return {
    id: element.id,
    kind: element.kind,
    anchor: {
      startWord: element.wordRange.startWordId,
      endWord: element.wordRange.endWordId,
    },
    reason: element.intent || '',
    priority: parsePriority(element.zIndex),
    params: {
      ...(element.params ?? {}),
      text: element.text,
      overlayText: element.overlayText,
      searchKeyword: element.searchKeyword,
      queries: element.queries,
      layout: element.layout,
      treatment: element.treatment,
      anchor: element.anchor,
      slotId: element.slotId,
      enter: element.enter,
      exit: element.exit,
      easing: element.easing,
      accentColor: element.accentColor,
      textColor: element.textColor,
      assetId,
      preRollMs: element.wordRange.preRollMs,
      postRollMs: element.wordRange.postRollMs,
    },
    source: element as unknown as Record<string, unknown>,
  };
}

export function assetIdFromElement(element: CreativeElement): string | undefined {
  const id = element.userBrollId;
  return typeof id === 'string' && id.trim() ? id.trim() : undefined;
}

function discardedFromRaw(raw: unknown): Array<{assetId: string; reason: string}> {
  if (!raw || typeof raw !== 'object') {
    return [];
  }
  const record = raw as Record<string, unknown>;
  const rows = record.discarded_assets ?? record.discardedAssets;
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows.flatMap(row => {
    if (!row || typeof row !== 'object') {
      return [];
    }
    const item = row as Record<string, unknown>;
    const assetId = String(item.assetId ?? item.asset_id ?? '').trim();
    const reason = String(item.reason ?? '').trim();
    if (!assetId) {
      return [];
    }
    return [{assetId, reason: reason || 'Director discarded this asset.'}];
  });
}

export function captionSpec(caption: CaptionDirection): CaptionDirection {
  return caption;
}
