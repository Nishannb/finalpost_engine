/**
 * WP18: place the creator's BOUND labeled assets (the mobile upload loop: assetBrief slot -> upload -> bind -> re-analyze). PURE: it reads the brief plus a map of resolved upload URLs and returns overlays; no env, no I/O,
 * no model, no web. A slot that is not `uploaded`, or whose `userAssetId` has no resolved URL, places nothing (skipped / needed slots stay empty). The overlay shapes reuse the existing hosts:
 *   logo       -> small pip in a top corner (never full-screen, never text; `overlayText` is empty so captions are not muted)
 *   person     -> framed portrait card, top right
 *   screenshot -> larger framed card (the device-ish host does not exist, so a framed still)
 *   product    -> pip, bottom left
 *   broll_clip -> a short cutaway when the upload is a video; a pip when it is a still
 * Two or more STILLS whose windows sit close together become ONE image run (the `ImageRun` composition: `runs` carries its props, resolvable by the library registry). Until a run can be published as a module the
 * same cluster is delivered by the existing slideshow overlay (`overlays`, treatment `slideshow`), so the edit changes today. One upload is placed alone and never forced into a run.
 */
import type {OverlaySlide, VisualAnchor, VisualOverlay} from '../../types/blueprint.ts';
import {isSolidFixtureUrl} from './solidStill.ts';
import type {LabeledAssetBrief, LabeledAssetKind, LabeledAssetSlot} from './labeledAssetBrief.ts';

/** WP29: `solidLike` = a flat / near-solid still (pixel analysis in the describe path). Only a logo may use one (pip / logo cloud); never a full-frame world. */
export type ResolvedLabeledAsset = {url: string; mediaKind: 'image' | 'video'; solidLike?: boolean};
export type TimeRange = {start: number; end: number};

/** WP39: how far a full-bleed still pushes in (1.00 -> 1.04 / 1.06 / 1.08); mirrors remotion/src/lib/imageRunTiming.ts. */
export type MotionSpeed = 'slow' | 'normal' | 'fast';

export type ImageRunPlan = {
  start: number;
  end: number;
  mode: 'sequence' | 'logo_cloud';
  /** WP39: `motionSpeed` = this still's push-in speed (full-bleed stills only; absent = the run's, then slow). */
  items: Array<{src: string; label?: string; recipeId?: string; motionSpeed?: MotionSpeed}>;
  slotIds: string[];
  /** WP22: the visual changes INSIDE the run (output seconds): each item cut of a sequence run, the hero re-pops of a long logo cloud. Beats for the density metric; the pops also get a forced transition. */
  cutAts: number[];
  /** WP30: `cover` for editorial stock photos (fill the frame); labeled uploads keep `contain` (absent). */
  fit?: 'cover';
  /** WP32: `blur_self` = the photo is the world (each still's own blurred bleed behind the sharp framed one). Editorial stock runs set it; labeled logo / screenshot runs keep the dim veil (absent). */
  backdrop?: 'blur_self';
  /** WP35: the Metromedia framed card: a white 5 px border around each still and a 3D fly-out exit (tilt 12 deg, slide bottom-right, motion blur, 6 frames) over the next still. Editorial stock runs set it; labeled runs keep the plain card (absent). */
  framed?: true;
  /** WP36: one hold per item (seconds, sequence mode): each still lasts exactly as long as its VO caption group. Absent = the window is split evenly. */
  holdsSec?: number[];
  /** WP36: per item, true = framed card (white border + fly-out), false = full-bleed cover still with push-in (the faceless documentary lane). Absent = the run-level `framed` / plain card. */
  framedItems?: boolean[];
  /** WP39: run-level push-in speed of the full-bleed stills (an item's own `motionSpeed` wins). Absent = slow. */
  motionSpeed?: MotionSpeed;
};

/** A logo cloud holds at most this long before its hero pops again (the ImageRun composition repeats the pop at the same period). */
export const CLOUD_POP_SEC = 1.5;
export const RUN_MAX_STATIC_SEC = 2.5;

/** Visual changes inside a run window: sequence = every item boundary (the composition splits the window evenly); logo_cloud = a hero pop every CLOUD_POP_SEC (1.5 s since WP26) while the hold would exceed RUN_MAX_STATIC_SEC. */
export function runCutTimes(run: Pick<ImageRunPlan, 'start' | 'end' | 'mode' | 'items'> & {holdsSec?: readonly number[]}): number[] {
  const length = run.end - run.start;
  if (run.mode === 'sequence' && run.holdsSec && run.holdsSec.length >= run.items.length) {
    const times: number[] = [];
    let at = run.start;
    for (const hold of run.holdsSec.slice(0, run.items.length - 1)) {
      at += hold;
      times.push(round(at));
    }
    return times;
  }
  if (run.mode === 'sequence') return run.items.slice(1).map((_, index) => round(run.start + ((index + 1) * length) / run.items.length));
  if (length <= RUN_MAX_STATIC_SEC) return [];
  const times: number[] = [];
  for (let at = run.start + CLOUD_POP_SEC; at < run.end - 0.5; at += CLOUD_POP_SEC) times.push(round(at));
  return times;
}

export type LabeledAssetPlacement = {
  overlays: VisualOverlay[];
  runs: ImageRunPlan[];
  placed: number;
  unresolved: number;
  /** Slots with an upload that sat on a window already taken by a full-screen beat. */
  blocked: number;
  /** WP29: slots whose upload is a solid-color still and not a logo (nothing is placed for them). */
  solidRefused?: number;
};

export const MIN_ASSET_SEC = 1.2;
export const MAX_ASSET_SEC = 4;
/** Stills whose windows are at most this far apart (seconds) form one run. */
export const RUN_GAP_SEC = 2;
export const MAX_RUN_ITEMS = 6;
const MAX_RUN_SEC = 6;

/** The `intent` of the slideshow overlay that stands in for a run until the run is published; the publish step removes the overlay with this intent. */
export const imageRunOverlayIntent = (run: Pick<ImageRunPlan, 'slotIds'>): string => `labeled_asset:image_run:${run.slotIds.join(',')}`;

export const mediaKindOfUrl = (url: string): 'image' | 'video' => (/\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(url) ? 'video' : 'image');

const overlaps = (a: TimeRange, b: TimeRange) => a.start < b.end && a.end > b.start;

/** WP19: the image_story entrance each kind of upload gets (overlay `recipeId` and ImageRun item `recipeId`). */
export const RECIPE_BY_KIND: Readonly<Record<LabeledAssetKind, string | undefined>> = {logo: 'logo_slam', person: 'still_push_in', screenshot: 'card_tilt_in', product: 'sticker_pop', broll_clip: undefined, other: 'nested_scale_in'};

type Host = {layout: VisualOverlay['layout']; anchor: VisualAnchor; weight: 'accent' | 'hero'; radius: number};

function hostFor(kind: LabeledAssetKind, mediaKind: 'image' | 'video'): Host {
  if (kind === 'logo') return {layout: 'pip', anchor: 'top_right', weight: 'accent', radius: 18};
  if (kind === 'person') return {layout: 'card', anchor: 'top_right', weight: 'accent', radius: 28};
  if (kind === 'screenshot') return {layout: 'card', anchor: 'top', weight: 'hero', radius: 28};
  if (kind === 'product') return {layout: 'pip', anchor: 'bottom_left', weight: 'accent', radius: 24};
  if (kind === 'broll_clip' && mediaKind === 'video') return {layout: 'cutaway', anchor: 'top', weight: 'hero', radius: 0};
  return {layout: 'pip', anchor: 'top_left', weight: 'accent', radius: 24};
}

function windowOf(slot: LabeledAssetSlot, durationSec: number): TimeRange | null {
  const start = Math.max(0, slot.startSec);
  const end = Math.min(durationSec, Math.max(slot.endSec, start + MIN_ASSET_SEC), start + MAX_ASSET_SEC);
  return end - start >= 0.8 ? {start: round(start), end: round(end)} : null;
}

const round = (value: number) => Math.round(value * 1000) / 1000;

function baseOverlay(slot: LabeledAssetSlot, asset: ResolvedLabeledAsset, range: TimeRange, host: Host): VisualOverlay {
  return {
    start: range.start,
    end: range.end,
    layout: host.layout,
    mediaKind: asset.mediaKind,
    anchor: host.anchor,
    keyword: slot.label,
    overlayText: '',
    assetUrl: asset.url,
    provider: 'user',
    providerId: 0,
    ...(slot.userAssetId ? {userBrollId: slot.userAssetId} : {}),
    width: 1080,
    height: 1080,
    credit: '',
    creditUrl: '',
    accentColor: '#FFFFFF',
    textStyle: 'chip',
    treatment: 'float',
    cornerRadius: host.radius,
    glow: false,
    visualWeight: host.weight,
    ...(RECIPE_BY_KIND[slot.kind] && asset.mediaKind === 'image' ? {recipeId: RECIPE_BY_KIND[slot.kind]} : {}),
    intent: `labeled_asset:${slot.kind}:${slot.id}`,
    createdByPass: 'wp18_labeled_assets',
  };
}

const slideOf = (slot: LabeledAssetSlot, asset: ResolvedLabeledAsset): OverlaySlide => ({
  assetUrl: asset.url,
  provider: 'user',
  providerId: 0,
  ...(slot.userAssetId ? {userBrollId: slot.userAssetId} : {}),
  width: 1080,
  height: 1080,
  credit: '',
  creditUrl: '',
});

type Candidate = {slot: LabeledAssetSlot; asset: ResolvedLabeledAsset; range: TimeRange};

/** Groups still candidates (sorted by start) whose gaps are <= RUN_GAP_SEC, at most MAX_RUN_ITEMS and MAX_RUN_SEC long. */
function clusterStills(stills: Candidate[]): Candidate[][] {
  const groups: Candidate[][] = [];
  for (const item of stills) {
    const last = groups[groups.length - 1];
    const head = last?.[0];
    const tail = last?.[last.length - 1];
    if (last && head && tail && item.range.start - tail.range.end <= RUN_GAP_SEC && last.length < MAX_RUN_ITEMS && Math.min(item.range.end, item.range.start + MIN_ASSET_SEC) - head.range.start <= MAX_RUN_SEC) {
      last.push(item);
    } else {
      groups.push([item]);
    }
  }
  return groups;
}

export function planLabeledAssetPlacements(input: {
  brief: LabeledAssetBrief | undefined;
  /** userAssetId (`ub_<n>`) -> the resolved upload. */
  assets: ReadonlyMap<string, ResolvedLabeledAsset>;
  outputDurationSec: number;
  /** Windows already owned by full-screen beats (cutaways, split / composite overlays, full / split graphics, media containers). */
  blockedRanges?: readonly TimeRange[];
}): LabeledAssetPlacement {
  const result: LabeledAssetPlacement = {overlays: [], runs: [], placed: 0, unresolved: 0, blocked: 0, solidRefused: 0};
  const uploaded = (input.brief?.slots ?? []).filter(slot => slot.status === 'uploaded');
  const taken: TimeRange[] = [];
  const candidates: Candidate[] = [];
  for (const slot of uploaded) {
    const asset = slot.userAssetId ? input.assets.get(slot.userAssetId) : undefined;
    const range = windowOf(slot, input.outputDurationSec);
    if (!asset || !range) {
      result.unresolved += 1;
      continue;
    }
    // WP29: a solid-color still is only ever a small logo mark; as a person / screenshot / product / b-roll card it would read as a flat-color world.
    if (asset.mediaKind === 'image' && (asset.solidLike || (asset.solidLike === undefined && isSolidFixtureUrl(asset.url))) && slot.kind !== 'logo') {
      result.solidRefused = (result.solidRefused ?? 0) + 1;
      continue;
    }
    if ((input.blockedRanges ?? []).some(blocked => overlaps(range, blocked))) {
      result.blocked += 1;
      continue;
    }
    candidates.push({slot, asset, range});
  }
  candidates.sort((a, b) => a.range.start - b.range.start);

  const stills = candidates.filter(item => item.asset.mediaKind === 'image');
  const clips = candidates.filter(item => item.asset.mediaKind !== 'image');
  const place = (overlay: VisualOverlay, range: TimeRange) => {
    if (taken.some(other => overlaps(range, other))) {
      result.blocked += 1;
      return;
    }
    taken.push(range);
    result.overlays.push(overlay);
    result.placed += 1;
  };

  // WP26: slots that share a groupId are ONE ask (e.g. 3 logo variants of a brand): two or more uploaded siblings always form one run (hero first), whatever their gaps; the other stills cluster by time as before.
  const byGroup = new Map<string, Candidate[]>();
  for (const item of stills) if (item.slot.groupId) byGroup.set(item.slot.groupId, [...(byGroup.get(item.slot.groupId) ?? []), item]);
  const grouped = [...byGroup.values()].filter(items => items.length >= 2).map(items => [...items].sort((a, b) => Number(b.slot.role === 'hero') - Number(a.slot.role === 'hero') || a.range.start - b.range.start).slice(0, MAX_RUN_ITEMS));
  const inGroup = new Set(grouped.flat());
  for (const group of [...grouped, ...clusterStills(stills.filter(item => !inGroup.has(item)))]) {
    if (group.length === 1) {
      const {slot, asset, range} = group[0]!;
      place(baseOverlay(slot, asset, range, hostFor(slot.kind, asset.mediaKind)), range);
      continue;
    }
    // Two or more nearby stills: one run. Each still holds ~1.2 s; the run ends with the last still's window.
    const start = Math.min(...group.map(item => item.range.start));
    const end = round(Math.min(input.outputDurationSec, Math.max(...group.map(item => item.range.end), start + group.length * MIN_ASSET_SEC), start + MAX_RUN_SEC));
    const range = {start, end};
    const logos = group.filter(item => item.slot.kind === 'logo').length;
    const run: ImageRunPlan = {
      start,
      end,
      mode: logos >= 2 ? 'logo_cloud' : 'sequence',
      // logo_cloud: only the hero names its entrance; the background items take the composition's drift / pop defaults
      items: group.map((item, index) => ({src: item.asset.url, label: item.slot.label, ...(RECIPE_BY_KIND[item.slot.kind] && !(logos >= 2 && index > 0) ? {recipeId: RECIPE_BY_KIND[item.slot.kind]} : {})})),
      slotIds: group.map(item => item.slot.id),
      cutAts: [],
    };
    run.cutAts = runCutTimes(run);
    const overlay: VisualOverlay = {
      ...baseOverlay(group[0]!.slot, group[0]!.asset, range, {layout: 'card', anchor: 'top', weight: 'hero', radius: 28}),
      keyword: group.map(item => item.slot.label).join(' / '),
      treatment: 'slideshow',
      slides: group.map(item => slideOf(item.slot, item.asset)),
      slideTransition: 'crossfade',
      intent: imageRunOverlayIntent(run),
    };
    const before = result.overlays.length;
    place(overlay, range);
    if (result.overlays.length > before) {
      result.runs.push(run);
      result.placed += group.length - 1; // `place` counted one; every upload in the run counts
    }
  }

  for (const {slot, asset, range} of clips) {
    place(baseOverlay(slot, asset, range, hostFor(slot.kind, asset.mediaKind)), range);
  }

  // WP29 backstop: a still overlay is a pip / card / slideshow, never a cover layout (cutaway / split / composite would show it full-bleed).
  result.overlays = result.overlays.map(overlay => (overlay.mediaKind === 'image' && (overlay.layout === 'cutaway' || overlay.layout === 'split' || overlay.layout === 'composite') ? {...overlay, layout: 'card' as const} : overlay));
  result.overlays.sort((a, b) => a.start - b.start);
  return result;
}

/** The warnings the analyze path records. */
export function labeledAssetWarnings(placement: Pick<LabeledAssetPlacement, 'placed' | 'unresolved' | 'blocked' | 'solidRefused'>): string[] {
  return [
    ...(placement.placed > 0 ? [`polish_assets:placed:${placement.placed}`] : []),
    ...(placement.unresolved > 0 ? [`polish_assets:unresolved:${placement.unresolved}`] : []),
    ...(placement.blocked > 0 ? [`polish_assets:blocked:${placement.blocked}`] : []),
    ...((placement.solidRefused ?? 0) > 0 ? [`polish_assets:solid_refused:${placement.solidRefused}`] : []),
  ];
}
