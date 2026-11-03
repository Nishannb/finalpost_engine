/**
 * WP42: MOUNT PLAN for Explainer Skill B in the production blueprint. `planExplainerMount` is PURE (the WP40 pacing + WP41 claim plan in, the blueprint fields out): the hard-cut layout track, the normalised claim
 * beats (with the spoken line the article plate shows) and the media SLOTS the renderer needs filled (layout B top half, C diagram ground, D cutaway; A needs none, a claim-beat B span is the article plate).
 * `placeExplainerMedia` is ASYNC-INJECTED like the editorial montage / faceless lane (production: `findPhotoAsset`; tests: a fake): one noun-locked still per slot, as a `cutaway` visual overlay tagged
 * `intent: explainer_<b|c|d>`. A slot that finds no photo becomes a TEXT plate (`mediaKind: 'text'`) of its key phrase, never a blank frame and never a crash.
 *
 * Transitions: Skill B changes layouts with HARD cuts only. This module writes no TransitionClip; analyzeVideo clears the soft ones (`polish_explainer_mounted:transitions_cleared`).
 */
import type {VisualOverlay} from '../../types/blueprint.ts';
import {EDITORIAL_FALLBACK_SCENES, editorialStillQueries, isPhotoUrl} from './editorialStillMontage.ts';
import {claimBeatQueries, type ClaimKind, type ClaimVisualPlan, type LayoutSpan} from './explainerClaims.ts';
import type {ExplainerWord} from './explainerPacing.ts';
import type {StockAsset} from './stockTypes.ts';
import {capRepeatedPlateStyle} from './craftMutualExclusion.ts';
import {buildNounLockProfile, isBarePersonNameQuery, isTimepieceCandidate, nounLockFallbacks, nounLockQueries, resolveNounLocked, type NounLockProfile, type NounLockedPhoto} from './nounLock.ts';

export type ExplainerClaimBeatOut = {start: number; end: number; phrase: string; phraseStart: number; phraseEnd: number; kind: string; context: string};
export type ExplainerMediaLayout = 'explainer_b' | 'explainer_c' | 'explainer_d';
export type ExplainerMediaSlot = {
  layout: ExplainerMediaLayout;
  start: number;
  end: number;
  spoken: string;
  /** The key phrase (a claim, else the head noun, else the first spoken words): the text plate / the card label. */
  label: string;
  queries: string[];
  profile: NounLockProfile;
};
export type ExplainerMountPlan = {
  layoutTrack: LayoutSpan[];
  claimBeats: ExplainerClaimBeatOut[];
  slots: ExplainerMediaSlot[];
  warnings: string[];
};

/** Words of context kept either side of the lime phrase on the article plate. */
export const BEAT_CONTEXT_WORDS_BEFORE = 8;
export const BEAT_CONTEXT_WORDS_AFTER = 7;
/** Provider lookups per edit (each may hit one or two libraries); keeps the explainer mount cheap. */
export const EXPLAINER_MEDIA_MAX_LOOKUPS = 16;
const FRAME_SEC = 1 / 30;
const round3 = (value: number) => Math.round(value * 1000) / 1000;
const KIND_STRENGTH: Record<ClaimKind, number> = {money: 4, percent: 3, number: 2, name: 1};

/** Normalise a layout track into a clean hard-cut tiling: sorted, spans > 0 s, each span starts exactly where the previous one ends (no overlap, no gap), the first at 0 and the last at `durationSec`. */
export function hardCutTrack(track: readonly LayoutSpan[], durationSec: number): LayoutSpan[] {
  const sorted = [...track].filter(span => span.end > span.start + 1e-9).sort((a, b) => a.start - b.start);
  const out: LayoutSpan[] = [];
  for (const span of sorted) {
    const prev = out[out.length - 1];
    const start = prev ? prev.end : 0;
    const end = round3(Math.max(span.end, start));
    if (end <= start + 1e-9) continue;
    out.push({start: round3(start), end, layout: span.layout});
  }
  if (out.length > 0 && durationSec > 0) out[out.length - 1]!.end = round3(Math.max(durationSec, out[out.length - 1]!.start + FRAME_SEC));
  return out;
}

/** The spoken line the article plate shows: the words around the lime phrase inside the beat window (<= 15 words), punctuation kept. */
export function beatContext(words: readonly ExplainerWord[], beat: {start: number; end: number}, phrase: {start: number; end: number}): string {
  const inside = words.filter(word => word.end > beat.start - 0.4 && word.start < beat.end + 0.2);
  const first = inside.findIndex(word => word.end > phrase.start - 0.01);
  const lastIndex = inside.map(word => word.start < phrase.end - 0.01).lastIndexOf(true);
  if (first < 0 || lastIndex < first) return inside.slice(0, BEAT_CONTEXT_WORDS_BEFORE + BEAT_CONTEXT_WORDS_AFTER).map(word => word.text).join(' ');
  return inside
    .slice(Math.max(0, first - BEAT_CONTEXT_WORDS_BEFORE), lastIndex + 1 + BEAT_CONTEXT_WORDS_AFTER)
    .map(word => word.text)
    .join(' ');
}

const spokenIn = (words: readonly ExplainerWord[], start: number, end: number) => words.filter(word => word.start >= start - 0.05 && word.start < end).map(word => word.text).join(' ');
const firstWords = (text: string, count: number) => text.replace(/[^\p{L}\p{N}$%.\s'-]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, count).join(' ');

export function planExplainerMount(input: {claimPlan: ClaimVisualPlan; words: readonly ExplainerWord[]; durationSec: number}): ExplainerMountPlan {
  // WP52: at most one full-bleed dark cutaway (black ground + centred still + top label) per ~12 s; the repeat falls back to the talking-head layout A instead of another identical card.
  const hardCut = hardCutTrack(input.claimPlan.layoutTrack, input.durationSec);
  const repeats = new Set(capRepeatedPlateStyle(hardCut.filter(span => span.layout === 'explainer_d').map((span, index) => ({id: String(index), start: span.start, end: span.end, style: 'explainer_d'}))));
  let darkIndex = -1;
  const layoutTrack = hardCut.map(span => {
    if (span.layout !== 'explainer_d') return span;
    darkIndex += 1;
    return repeats.has(String(darkIndex)) ? {...span, layout: 'explainer_a' as const} : span;
  });
  const claimBeats: ExplainerClaimBeatOut[] = input.claimPlan.beats.map(beat => ({
    start: round3(beat.start),
    end: round3(beat.end),
    phrase: beat.highlight.phrase,
    phraseStart: round3(beat.highlight.start),
    phraseEnd: round3(beat.highlight.end),
    kind: beat.kind,
    context: beatContext(input.words, beat, beat.highlight),
  }));
  const queries = claimBeatQueries(input.claimPlan, input.words).items;
  const slots: ExplainerMediaSlot[] = [];
  for (const span of layoutTrack) {
    if (span.layout === 'explainer_a') continue;
    // a B span that IS a claim beat is the article plate (no stock still)
    if (span.layout === 'explainer_b' && claimBeats.some(beat => Math.abs(beat.start - span.start) < 0.02 && Math.abs(beat.end - span.end) < 0.05)) continue;
    const spoken = spokenIn(input.words, span.start, span.end);
    const inSpan = queries.filter(item => item.claim.start >= span.start - 0.05 && item.claim.start < span.end);
    const top = inSpan.reduce<(typeof inSpan)[number] | null>((best, item) => (!best || KIND_STRENGTH[item.claim.kind] > KIND_STRENGTH[best.claim.kind] ? item : best), null);
    const profile = top ? top.profile : buildNounLockProfile(spoken);
    const queryList = top && top.queries.length > 0 ? top.queries : nounLockQueries(profile, editorialStillQueries(spoken, {sceneRulesOnly: true}));
    slots.push({
      layout: span.layout as ExplainerMediaLayout,
      start: span.start,
      end: span.end,
      spoken,
      label: top?.claim.text || profile.headNoun || firstWords(spoken, 4),
      queries: queryList,
      profile,
    });
  }
  const warnings = [`polish_explainer_mounted:layouts:${layoutTrack.length}`, `polish_explainer_mounted:beats:${claimBeats.length}`, ...(repeats.size > 0 ? [`polish_craft:black_card_capped:${repeats.size}`] : [])];
  return {layoutTrack, claimBeats, slots, warnings};
}

export type ExplainerPhoto = NounLockedPhoto & {width?: number; height?: number; credit?: string; creditUrl?: string};
export type ExplainerPhotoResolver = (query: string, options: {excludeKeys: Set<string>; orientation: 'portrait' | 'landscape'}) => Promise<ExplainerPhoto | null>;

export type ExplainerMediaResult = {overlays: VisualOverlay[]; placed: number; text: number; lookups: number; rejected: number; warnings: string[]};

/** The production resolver: wraps the stock photo search (`findPhotoAsset`) and passes the photo's relevance metadata + credit through (the noun-lock judge reads alt / tags / page slug). */
export function explainerStockResolver(find: (query: string, options: {excludeKeys: Set<string>; orientation: 'portrait' | 'landscape'}) => Promise<StockAsset | null>): ExplainerPhotoResolver {
  return async (query, options) => {
    const asset = await find(query, options);
    if (!asset) return null;
    return {
      assetUrl: asset.assetUrl,
      provider: asset.provider,
      providerId: asset.providerId,
      width: asset.width,
      height: asset.height,
      credit: asset.credit,
      creditUrl: asset.creditUrl,
      ...(asset.alt ? {alt: asset.alt} : {}),
      ...(asset.tags ? {tags: asset.tags} : {}),
      ...(asset.pageUrl ? {pageUrl: asset.pageUrl} : {}),
    };
  };
}

const baseOverlay = (slot: ExplainerMediaSlot): Omit<VisualOverlay, 'mediaKind' | 'assetUrl' | 'provider' | 'providerId' | 'width' | 'height' | 'credit' | 'creditUrl' | 'keyword'> => ({
  start: slot.start,
  end: slot.end,
  layout: 'cutaway',
  anchor: 'top',
  overlayText: slot.label,
  accentColor: '#FFFFFF',
  textStyle: 'bar',
  intent: slot.layout,
});

/** One noun-locked still per media slot (B top / C / D), in order, unique photos. A slot with no photo becomes a text plate of its label. */
export async function placeExplainerMedia(input: {slots: readonly ExplainerMediaSlot[]; resolver: ExplainerPhotoResolver | null; maxLookups?: number}): Promise<ExplainerMediaResult> {
  const maxLookups = input.maxLookups ?? EXPLAINER_MEDIA_MAX_LOOKUPS;
  const excludeKeys = new Set<string>();
  const overlays: VisualOverlay[] = [];
  let lookups = 0;
  let rejected = 0;
  let placed = 0;
  let text = 0;
  for (const slot of input.slots) {
    let overlay: VisualOverlay | null = null;
    if (input.resolver) {
      const orientation = slot.layout === 'explainer_d' ? 'portrait' : 'landscape';
      const fallbacks = nounLockFallbacks(slot.profile, EDITORIAL_FALLBACK_SCENES).slice(0, 1);
      // WP52: a bare personal name has no stock referent (Adam -> clock): no lookup at all, the slot becomes a text plate. Its generic fallback scene is skipped too.
      const nameSlot = slot.queries.some(isBarePersonNameQuery) || isBarePersonNameQuery(slot.label);
      const attempts = nameSlot ? [] : [...slot.queries.slice(0, 2).map(query => ({query, fallback: false})), ...fallbacks.map(query => ({query, fallback: true}))];
      for (const attempt of attempts) {
        if (lookups >= maxLookups) break;
        const resolver = input.resolver;
        const outcome = await resolveNounLocked({
          resolver: (query, options) => resolver(query, {excludeKeys: options.excludeKeys, orientation}),
          query: attempt.query,
          excludeKeys,
          profile: slot.profile,
          bannedOnly: attempt.fallback,
          canLookup: () => lookups < maxLookups,
        });
        lookups += outcome.lookups;
        rejected += outcome.rejected;
        const photo = outcome.photo as ExplainerPhoto | null;
        if (!photo || !isPhotoUrl(photo.assetUrl)) continue;
        if (isTimepieceCandidate(photo) && !/\b(clock|watch|time|hour|deadline)\b/i.test(`${attempt.query} ${slot.label}`)) { rejected += 1; continue; } // WP52
        const key = `${photo.provider}:${photo.providerId}`;
        if (excludeKeys.has(key)) continue;
        excludeKeys.add(key);
        overlay = {
          ...baseOverlay(slot),
          mediaKind: 'image',
          keyword: attempt.query,
          assetUrl: photo.assetUrl,
          provider: (photo.provider === 'pixabay' ? 'pixabay' : 'pexels') as VisualOverlay['provider'],
          providerId: photo.providerId,
          width: photo.width ?? 0,
          height: photo.height ?? 0,
          credit: photo.credit ?? '',
          creditUrl: photo.creditUrl ?? '',
        };
        break;
      }
    }
    if (overlay) placed += 1;
    else {
      text += 1;
      overlay = {...baseOverlay(slot), mediaKind: 'text', keyword: slot.label, assetUrl: '', provider: 'generated', providerId: 0, width: 0, height: 0, credit: '', creditUrl: ''};
    }
    overlays.push(overlay);
  }
  const warnings = [`polish_explainer_mounted:media:${placed}:${input.slots.length}`];
  if (text > 0) warnings.push(`polish_explainer_mounted:media_text_plate:${text}`);
  if (!input.resolver && input.slots.length > 0) warnings.push('polish_explainer_mounted:no_stock');
  if (rejected > 0) warnings.push(`polish_explainer_mounted:noun_lock_rejected:${rejected}`);
  return {overlays, placed, text, lookups, rejected, warnings};
}