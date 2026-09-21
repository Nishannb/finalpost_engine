/**
 * `--edits=` is a hint. Log requested kinds the director omitted.
 * Never fill, retime, or invent placements.
 */

import type {WordToken} from '../../types/blueprint.ts';
import type {VisualDirection} from './geminiDirector.ts';

export function ensureRequestedEditStyles(input: {
  direction: VisualDirection;
  allowed: Set<string> | null;
  words: WordToken[];
  durationSec: number;
  userBrollId?: string | null;
}): {direction: VisualDirection; warnings: string[]} {
  void input.words;
  void input.durationSec;
  void input.userBrollId;
  const warnings: string[] = [];
  if (!input.allowed) {
    return {direction: input.direction, warnings};
  }
  const placed = placedKinds(input.direction);
  for (const id of input.allowed) {
    if (id === 'captions' || id === 'delivery_shaping') {
      continue;
    }
    if (!placed.has(id)) {
      warnings.push(`requested_not_placed:${id}`);
    }
  }
  return {direction: input.direction, warnings};
}

function placedKinds(direction: VisualDirection): Set<string> {
  const kinds = new Set<string>();
  if (direction.hookTitle) {
    kinds.add('hook_title');
  }
  if ((direction.zooms ?? []).length > 0) {
    kinds.add('zoom');
  }
  if ((direction.insetReveals ?? []).length > 0) {
    kinds.add('inset_reveal');
  }
  if ((direction.depthOverlays ?? []).length > 0) {
    kinds.add('depth_overlay');
  }
  for (const moment of direction.moments ?? []) {
    if (moment.layout === 'cutaway') {
      kinds.add('cutaway');
    }
    if (moment.layout === 'split') {
      kinds.add('split');
    }
    if (moment.layout === 'cutout') {
      kinds.add('cutout');
    }
  }
  return kinds;
}
