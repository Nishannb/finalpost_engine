/**
 * WP15: schedule contextual KLIPY GIF/sticker overlays onto the polish edit.
 * Avoids overlapping existing strong overlays / full-screen graphics.
 */

import {env} from '../../config/env.ts';
import {stageLogger} from '../../lib/logger.ts';
import type {VisualOverlay} from '../../types/blueprint.ts';
import {klipyConfigured, searchKlipy} from './klipyClient.ts';
import {isLiteralEmojiQuery, KLIPY_MAX_BEATS, proposeKlipyBeats, type CaptionWordLike} from './klipyContextQuery.ts';

const log = stageLogger('klipy-overlay-planner');

export type KlipyPlanResult = {
  overlays: VisualOverlay[];
  warnings: string[];
  searches: number;
};

function overlaps(a: {start: number; end: number}, b: {start: number; end: number}): boolean {
  return a.start < b.end && a.end > b.start;
}

/**
 * Resolve contextual KLIPY beats into VisualOverlay stickers/pips.
 * No-ops when KLIPY is not configured. Caps searches via KLIPY_MAX_SEARCHES_PER_EDIT.
 */
export async function planKlipyOverlays(input: {
  words: readonly CaptionWordLike[];
  outputDurationSec: number;
  contentType?: string;
  existingOverlays: readonly VisualOverlay[];
  /** Full/split graphics that already own the frame — skip overlapping KLIPY. */
  blockedRanges?: readonly {start: number; end: number}[];
  customerId?: string;
}): Promise<KlipyPlanResult> {
  const warnings: string[] = [];
  if (!klipyConfigured()) {
    return {overlays: [], warnings: ['klipy:skipped:unconfigured'], searches: 0};
  }

  const maxSearches = Math.max(1, Math.min(KLIPY_MAX_BEATS, env.KLIPY_MAX_SEARCHES_PER_EDIT || KLIPY_MAX_BEATS)); // WP29: stickers are garnish; hard cap
  const beats = proposeKlipyBeats({
    words: input.words,
    outputDurationSec: input.outputDurationSec,
    contentType: input.contentType,
    maxBeats: maxSearches,
  });
  if (beats.length === 0) {
    return {overlays: [], warnings: ['klipy:no_context_beats'], searches: 0};
  }

  const blocked = [
    ...input.existingOverlays.map(o => ({start: o.start, end: o.end})),
    ...(input.blockedRanges ?? []),
  ];
  const excludeSlugs = new Set<string>();
  const overlays: VisualOverlay[] = [];
  let searches = 0;

  for (const beat of beats) {
    if (searches >= maxSearches) break;
    if (isLiteralEmojiQuery(beat.query)) {
      warnings.push(`klipy:miss:gated_literal:${beat.query.slice(0, 40)}`); // WP29: never search a literal heart / emoji for an abstract claim
      continue;
    }
    if (blocked.some(range => overlaps(beat, range))) continue;
    if (overlays.some(existing => overlaps(beat, existing))) continue;

    searches += 1;
    const asset = await searchKlipy({
      kind: beat.kind,
      query: beat.query,
      customerId: input.customerId,
      excludeSlugs,
    });
    if (!asset) {
      warnings.push(`klipy:miss:${beat.kind}:${beat.query.slice(0, 40)}`);
      continue;
    }
    excludeSlugs.add(asset.slug);
    overlays.push({
      start: beat.start,
      end: beat.end,
      layout: beat.layout,
      mediaKind: asset.mediaKind,
      anchor: beat.anchor,
      keyword: beat.query,
      overlayText: '',
      assetUrl: asset.assetUrl,
      provider: 'klipy',
      providerId: asset.providerId,
      width: asset.width,
      height: asset.height,
      credit: asset.credit,
      creditUrl: asset.creditUrl,
      accentColor: '#FFFFFF',
      textStyle: 'chip',
      treatment: 'float',
      cornerRadius: beat.layout === 'sticker' ? 16 : 24,
      glow: false,
      visualWeight: 'accent',
      recipeId: 'sticker_pop',
      intent: `klipy:${beat.reason}`,
      createdByPass: 'wp15_klipy',
    });
  }

  if (overlays.length > 0) {
    warnings.push(`klipy:overlays:${overlays.length}`);
    log.info({overlays: overlays.length, searches}, 'klipy overlays planned');
  } else if (searches > 0) {
    warnings.push(`klipy:searches_no_hit:${searches}`);
  }
  return {overlays, warnings, searches};
}
