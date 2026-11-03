/**
 * WP55 phase 2 (pure): creator-provided brand + social data for type_logo_reveal / type_floating_social_proof, read from the labeled asset brief (slots the creator uploaded) and an optional explicit brand
 * name. Nothing is guessed from the transcript and nothing is generated: no brand name -> no title text, no social still -> no phone cards, and metrics only ever come from spoken numbers (binder).
 */
import type {LabeledAssetSlot} from './labeledAssetBrief.ts';

type SlotLike = Pick<LabeledAssetSlot, 'status' | 'kind' | 'label'> & {userAssetId?: string};

const GENERIC = new Set(['your', 'the', 'my', 'our', 'a', 'logo', 'brand', 'company', 'business', 'creator']);

/** Explicit creator-provided brand name wins; else the label of an uploaded logo slot ("Northwind logo" -> "Northwind"). Generic labels ("Your logo") yield nothing. */
export function brandNameFor(explicit: string | undefined, slots: readonly SlotLike[]): string | undefined {
  const given = explicit?.trim();
  if (given && given.length >= 2) return given.slice(0, 60);
  for (const slot of slots) {
    if (slot.kind !== 'logo' || slot.status !== 'uploaded') continue;
    const name = slot.label.replace(/\s+logo(?:\s+\d+\s+of\s+\d+)?\s*$/i, '').replace(/\s+/g, ' ').trim();
    if (name.length >= 2 && !GENERIC.has(name.toLowerCase())) return name.slice(0, 60);
  }
  return undefined;
}

/** Uploaded stills the creator labeled as their own posts / profile / feed (the only images clip_51 may show). Stock or unlabeled uploads never qualify. */
export const SOCIAL_SLOT_LABEL = /\b(posts?|reels?|instagram|tiktok|youtube|facebook|linkedin|social|profile|feed|analytics)\b/i;
export function isSocialSlot(slot: SlotLike): boolean {
  return slot.status === 'uploaded' && (slot.kind === 'screenshot' || slot.kind === 'other') && SOCIAL_SLOT_LABEL.test(slot.label) && Boolean(slot.userAssetId);
}
