/**
 * WP8H: run a whole `VisualDirection` (the v1 / fallback shape the planner consumes) through an Edit Look. PURE: no env, no logger, no I/O; the only imports are types and the look rules.
 * `enforceEditLook` (stages/directorV2/editLooks.ts) judges element kinds; a VisualDirection holds its elements in typed lists (moments, zooms, depth overlays, ...), so each item is mapped to
 * the Director v2 element kind it stands for, enforced in time order (so the graphic cap keeps the EARLIEST graphics), and removed from its list when dropped. A dropped hook title blanks
 * the hook. Nothing is added and nothing is moved in time. `ensureLookMinimumBeats` then guarantees a floor for a non-minimal look: at least one zoom when the look allows zooms.
 */
import type {DirectedZoom, VisualDirection} from './geminiDirector.ts';
import {enforceEditLook, type EditLook, type EditLookDrop} from '../directorV2/editLooks.ts';

type Item = {id: string; kind: string; time: number};

const MOMENT_KIND: Record<string, string> = {
  cutaway: 'cutaway',
  composite: 'cutaway',
  pip: 'media_container',
  sticker: 'card',
  card: 'card',
  lockup: 'lockup',
  chip: 'card',
  banner: 'card',
  split: 'split',
  stat: 'card',
  cutout: 'cutout',
  bubble: 'bubble',
};

/** The element kind a moment layout stands for (unknown layouts count as a card, never as something the look would not know). */
export function kindForMomentLayout(layout: string): string {
  return MOMENT_KIND[layout] ?? 'card';
}

export function applyEditLookToDirection(direction: VisualDirection, look: EditLook, context: {matteUsable?: boolean} = {}): {direction: VisualDirection; dropped: EditLookDrop[]} {
  const items: Item[] = [];
  const add = (group: string, list: ReadonlyArray<unknown> | undefined, kind: (entry: never) => string, time: (entry: never) => number) =>
    (list ?? []).forEach((entry, index) => items.push({id: `${group}:${index}`, kind: kind(entry as never), time: time(entry as never)}));
  add('moments', direction.moments, (moment: {layout: string}) => kindForMomentLayout(moment.layout), (moment: {timestamp: number}) => moment.timestamp);
  add('zooms', direction.zooms, () => 'zoom', (zoom: {timestamp: number}) => zoom.timestamp);
  add('transitions', direction.transitions, () => 'transition', (entry: {start: number}) => entry.start);
  add('depthOverlays', direction.depthOverlays, () => 'depth_overlay', (entry: {start: number}) => entry.start);
  add('insetReveals', direction.insetReveals, () => 'inset_reveal', (entry: {start: number}) => entry.start);
  add('motionGraphics', direction.motionGraphics, () => 'kinetic_text', (entry: {start: number}) => entry.start);
  add('mediaContainers', direction.mediaContainers, () => 'media_container', (entry: {start: number}) => entry.start);
  add('frameInsets', direction.frameInsets, () => 'frame_inset', (entry: {start: number}) => entry.start);
  add('semanticEmphasis', direction.semanticEmphasis, () => 'emphasis', (entry: {start: number}) => entry.start);
  const hasHook = Boolean(direction.hookTitle?.trim());
  if (hasHook) items.push({id: 'hook:0', kind: 'hook_title', time: direction.hookStartSec ?? 0});
  items.sort((a, b) => a.time - b.time);

  const {kept, dropped} = enforceEditLook(items, look, context);
  const keep = new Set(kept.map(item => item.id));
  const filter = <T>(group: string, list: readonly T[] | undefined): T[] => (list ?? []).filter((_, index) => keep.has(`${group}:${index}`));
  const next: VisualDirection = {
    ...direction,
    moments: filter('moments', direction.moments),
    zooms: filter('zooms', direction.zooms),
    depthOverlays: filter('depthOverlays', direction.depthOverlays),
    insetReveals: filter('insetReveals', direction.insetReveals),
    motionGraphics: filter('motionGraphics', direction.motionGraphics),
    mediaContainers: filter('mediaContainers', direction.mediaContainers),
    frameInsets: filter('frameInsets', direction.frameInsets),
    semanticEmphasis: filter('semanticEmphasis', direction.semanticEmphasis),
    ...(direction.transitions ? {transitions: filter('transitions', direction.transitions)} : {}),
    ...(hasHook && !keep.has('hook:0') ? {hookTitle: '', hookSubtitle: ''} : {}),
  };
  return {direction: next, dropped};
}

/**
 * The floor for a non-minimal look: when the direction has no zoom at all and the look allows zooms, the given deterministic stubs (the engine's own fallback zoom positions, computed by the
 * caller) are added, at most two. Returns how many were added. The planner does not call it for the minimal look (its zooms are whatever survived the enforcement).
 */
export function ensureLookMinimumBeats(direction: VisualDirection, look: EditLook, stubZooms: readonly DirectedZoom[]): {direction: VisualDirection; addedZooms: number} {
  if (!look.allowedElementKinds.includes('zoom') || direction.zooms.length > 0 || stubZooms.length === 0) return {direction, addedZooms: 0};
  const added = stubZooms.slice(0, 2).map(zoom => ({...zoom}));
  return {direction: {...direction, zooms: added}, addedZooms: added.length};
}
