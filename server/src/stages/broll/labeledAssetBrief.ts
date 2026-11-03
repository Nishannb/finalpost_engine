/**
 * WP15: LABELED ASSET BRIEF — after speech cleanup, propose what the creator should upload
 * so the edit can use real logos / headshots / product shots / screenshots (not scraped web).
 * Pure: no I/O. The app shows each slot; user uploads; next pass binds `userAssetId` by label.
 */

import {contentTokens, wordsInWindow, type CaptionWordLike} from './klipyContextQuery.ts';

export type LabeledAssetKind = 'logo' | 'person' | 'product' | 'screenshot' | 'broll_clip' | 'other';

export type LabeledAssetSlot = {
  /** Stable id for the upload UI (`asset_logo_1`). */
  id: string;
  /** Human label shown in the app ("Acme logo", "Your face photo"). */
  label: string;
  kind: LabeledAssetKind;
  /** Why the edit wants this asset (from the spoken line). */
  reason: string;
  /** Suggested on-screen window (output time) after cleanup. */
  startSec: number;
  endSec: number;
  /** What the uploader may provide. */
  accept: Array<'image' | 'video'>;
  /** Spoken grounding (truncated). */
  spokenHint: string;
  /** Filled later when the user uploads. */
  status: 'needed' | 'uploaded' | 'skipped';
  userAssetId?: string;
  /** WP26: how many uploads the whole group wants (default 1). Every sibling slot of a group repeats it, so the app can say "Upload 3 Acme logos". */
  quantity?: number;
  /** WP26: slots that share a groupId are ONE ask (e.g. three logo variants of one brand for a logo-cloud beat). Concrete sibling slots keep the app UI simple: one upload per slot. */
  groupId?: string;
  /** WP26: placement hint inside a group: the hero is in front, cloud items sit behind it. */
  role?: 'hero' | 'cloud' | 'variant' | 'primary';
  /** WP26: true = the edit is not "ready" until this slot is uploaded or explicitly skipped. */
  required?: boolean;
  /** WP26: why the edit wants it, for the UI: `logo_cloud`, `image_run_sequence`, `card_tilt`. */
  motionIntent?: string;
};

export type LabeledAssetBrief = {
  version: 1;
  /** Output duration after jump-cuts / umm cleanup. */
  outputDurationSec: number;
  slots: LabeledAssetSlot[];
};

/** WP26: brands the brief treats as strong enough for a multi-upload logo group (an open logo cloud): a well-known brand, or any brand named at least twice. */
const KNOWN_BRAND =
  /^(google|meta|facebook|instagram|tiktok|youtube|amazon|apple|microsoft|openai|chatgpt|figma|notion|stripe|shopify|nike|tesla)$/i;
/** Logo groups per brief, and the uploads each asks for (first group 3, second 2). */
export const MAX_LOGO_GROUPS = 2;
export const LOGO_GROUP_QUANTITIES = [3, 2] as const;
export const DEFAULT_MAX_SLOTS = 12;

const slugOf = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'brand';

/** Capitalised multi-word brands only — do NOT add the `i` flag (it would make `[A-Z]` match every word). */
const BRANDISH_CAP = /\b([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+){0,2})\b/g;
/** Known brands, case-insensitive, listed separately so CAP stays case-sensitive. */
const BRANDISH_KNOWN =
  /\b(google|meta|facebook|instagram|tiktok|youtube|amazon|apple|microsoft|openai|chatgpt|figma|notion|stripe|shopify|nike|tesla)\b/gi;

const STOP_BRAND =
  /^(I|We|The|A|An|This|That|These|Those|They|Them|He|She|You|It|Who|What|How|Why|All|Some|Most|Many|Few|Each|Every|My|Your|Then|And|But|So|When|While|After|Before|Today|Everyone|Someone|People|Here|There|Now|Next|Also|Just|Only|Even|Still|Very|Really|New|Old|Our|Their|His|Her|Its|Not|Yes|No|Ok|Okay)$/i;

const PERSONISH =
  /\b(?:elon\s+musk|steve\s+jobs|mark\s+zuckerberg|jeff\s+bezos|[A-Z][a-z]+\s+[A-Z][a-z]+)\b/g;

/** Collect brand labels from a spoken window (known brands + capitalised names). */
function brandLabelsIn(spoken: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const label = raw.trim();
    if (label.length < 2) return;
    // Reject pronouns / glue words even inside multi-word caps like "Then They".
    if (label.split(/\s+/).some(part => STOP_BRAND.test(part))) return;
    const key = label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    found.push(label);
  };
  for (const match of spoken.matchAll(BRANDISH_KNOWN)) push(match[1] || match[0] || '');
  for (const match of spoken.matchAll(BRANDISH_CAP)) push(match[1] || match[0] || '');
  return found;
}

/**
 * Build upload slots from the cleaned transcript timeline.
 * Brands → logo; capitalized full names → person; "screenshot/app/dashboard" → screenshot; product nouns → product.
 * Caps at `maxSlots` (default 12; WP26: a strong brand asks for a GROUP of 2-3 logo slots, one per upload). Does not invent stock URLs.
 */
export function buildLabeledAssetBrief(input: {
  words: readonly CaptionWordLike[];
  outputDurationSec: number;
  maxSlots?: number;
  windowSec?: number;
}): LabeledAssetBrief {
  const maxSlots = input.maxSlots ?? DEFAULT_MAX_SLOTS;
  const windowSec = input.windowSec ?? 12;
  const slots: LabeledAssetSlot[] = [];
  const seen = new Set<string>();

  const push = (slot: Omit<LabeledAssetSlot, 'status'>) => {
    const key = `${slot.kind}:${slot.label.toLowerCase()}`;
    if (seen.has(key) || slots.length >= maxSlots) return;
    seen.add(key);
    slots.push({...slot, status: 'needed'});
  };
  const fullSpoken = input.words.map(word => word.text).join(' ').toLowerCase();
  const mentions = (label: string) => fullSpoken.split(label.toLowerCase()).length - 1;
  const brandGroups = new Set<string>();

  const windows = Math.max(1, Math.floor(input.outputDurationSec / windowSec));
  for (let index = 0; index < windows && slots.length < maxSlots; index++) {
    const start = index * windowSec;
    const end = Math.min(input.outputDurationSec, start + windowSec);
    const spoken = wordsInWindow(input.words, start, end)
      .map(w => w.text)
      .join(' ');
    if (spoken.length < 12) continue;

    for (const label of brandLabelsIn(spoken)) {
      const groupIndex = brandGroups.size;
      const strong =
        groupIndex < MAX_LOGO_GROUPS &&
        !brandGroups.has(label.toLowerCase()) &&
        (KNOWN_BRAND.test(label) || mentions(label) >= 2);
      if (
        strong &&
        slots.length + LOGO_GROUP_QUANTITIES[groupIndex]! <= maxSlots &&
        !seen.has(`logo:${label.toLowerCase()} logo 1 of ${LOGO_GROUP_QUANTITIES[groupIndex]}`)
      ) {
        // WP26: ONE group of sibling slots (one upload each) so the edit can run a logo-cloud motion beat.
        brandGroups.add(label.toLowerCase());
        const quantity = LOGO_GROUP_QUANTITIES[groupIndex]!;
        const needle = label.toLowerCase().replace(/[^a-z0-9]/g, '');
        const spokenAt = wordsInWindow(input.words, start, end).find(
          word => word.text.toLowerCase().replace(/[^a-z0-9]/g, '') === needle,
        );
        const from = Math.max(start, Math.min(spokenAt?.start ?? start, Math.max(0, input.outputDurationSec - 2)));
        for (let n = 1; n <= quantity; n++) {
          push({
            id: `asset_logo_${slugOf(label)}_${n}`,
            label: `${label} logo ${n} of ${quantity}`,
            kind: 'logo',
            reason: `Need ${quantity} logo variants / crops of ${label} for a logo-cloud motion beat around ${from.toFixed(1)}s (full logo, icon, wordmark, or the same logo on different backgrounds).`,
            startSec: from,
            endSec: Math.min(input.outputDurationSec, Math.max(end, from + 4), from + 4),
            accept: ['image'],
            spokenHint: spoken.slice(0, 120),
            quantity,
            groupId: `logo_${slugOf(label)}`,
            role: n === 1 ? 'hero' : 'cloud',
            required: true,
            motionIntent: 'logo_cloud',
          });
        }
        continue;
      }
      push({
        id: `asset_logo_${slots.length + 1}`,
        label: `${label} logo`,
        kind: 'logo',
        reason: `Brand/product mentioned around ${start.toFixed(1)}s — upload the official logo for a lockup/PiP.`,
        startSec: start,
        endSec: Math.min(end, start + 4),
        accept: ['image'],
        spokenHint: spoken.slice(0, 120),
        required: false,
        motionIntent: 'logo_pip',
      });
    }

    for (const match of spoken.matchAll(PERSONISH)) {
      const name = match[0]?.trim();
      if (!name || name.split(/\s+/).length < 2) continue;
      const first = name.split(/\s+/)[0] ?? '';
      if (STOP_BRAND.test(first)) continue; // "Then Google" is not a person
      push({
        id: `asset_person_${slots.length + 1}`,
        label: `${name} photo`,
        kind: 'person',
        reason: `Person named around ${start.toFixed(1)}s — upload a licensed / owned headshot (not a random web scrape).`,
        startSec: start,
        endSec: Math.min(end, start + 3.5),
        accept: ['image'],
        spokenHint: spoken.slice(0, 120),
      });
    }

    if (/\b(screenshot|dashboard|app|ui|interface|phone)\b/i.test(spoken)) {
      push({
        id: `asset_screen_${slots.length + 1}`,
        label: 'App / dashboard screenshot',
        kind: 'screenshot',
        reason: `UI/app referenced around ${start.toFixed(1)}s — upload a clear screenshot for a device frame.`,
        startSec: start,
        endSec: Math.min(end, start + 5),
        accept: ['image'],
        spokenHint: spoken.slice(0, 120),
      });
    }

    if (/\b(product|package|box|bottle|device|gadget)\b/i.test(spoken)) {
      const tokens = contentTokens(spoken).slice(0, 3);
      push({
        id: `asset_product_${slots.length + 1}`,
        label: tokens.length ? `${tokens.join(' ')} product shot` : 'Product photo',
        kind: 'product',
        reason: `Product mention around ${start.toFixed(1)}s — upload a product still for PiP.`,
        startSec: start,
        endSec: Math.min(end, start + 4),
        accept: ['image'],
        spokenHint: spoken.slice(0, 120),
      });
    }
  }

  // Always offer one open slot for creator-chosen B-roll if the edit is long enough.
  if (input.outputDurationSec >= 20 && slots.length < maxSlots) {
    push({
      id: 'asset_broll_1',
      label: 'Optional B-roll clip',
      kind: 'broll_clip',
      reason: 'Optional: any short clip that supports your story (office, product in use, customer).',
      startSec: Math.min(8, input.outputDurationSec * 0.2),
      endSec: Math.min(input.outputDurationSec, Math.min(8, input.outputDurationSec * 0.2) + 4),
      accept: ['video', 'image'],
      spokenHint: '',
    });
  }

  return {version: 1, outputDurationSec: input.outputDurationSec, slots};
}

/** Bind an uploaded user asset id onto a slot (immutable update). */
export function attachLabeledAsset(
  brief: LabeledAssetBrief,
  slotId: string,
  userAssetId: string,
): LabeledAssetBrief {
  return {
    ...brief,
    slots: brief.slots.map(slot =>
      slot.id === slotId ? {...slot, status: 'uploaded' as const, userAssetId} : slot,
    ),
  };
}

/** Mark a slot skipped (immutable). */
export function skipLabeledAsset(
  brief: LabeledAssetBrief,
  slotId: string,
): LabeledAssetBrief {
  return {
    ...brief,
    slots: brief.slots.map(slot =>
      slot.id === slotId
        ? {...slot, status: 'skipped' as const, userAssetId: undefined}
        : slot,
    ),
  };
}

/**
 * Client → engine handoff after the upload UI.
 * `userAssetId` is the engine id (`ub_n`) when known; otherwise `assetUrl` is
 * resolved via `urlToAssetId` (URL → id from `describeUserBrollAssets`).
 *
 * WP18: bound slots are consumed by `labeledAssetPlacement.ts` (kind + startSec/endSec -> overlay or ImageRun).
 */
export type LabeledAssetBinding = {
  slotId: string;
  status: 'uploaded' | 'skipped';
  userAssetId?: string;
  /** Public HTTPS URL of the upload (same scheme as userBrollUrls). */
  assetUrl?: string;
  kind?: LabeledAssetKind;
  label?: string;
  /**
   * WP26: bind (or skip) a whole GROUP at once. `skipped` + groupId skips every sibling; `uploaded` + groupId fills the group's still-needed slots in order from `userAssetIds` / `assetUrls`. `slotId` is then only a label.
   */
  groupId?: string;
  userAssetIds?: string[];
  assetUrls?: string[];
};

function slotMatchKey(kind: string, label: string): string {
  return `${kind}:${label.trim().toLowerCase()}`;
}

export function applyLabeledAssetBindings(
  brief: LabeledAssetBrief,
  inputBindings: readonly LabeledAssetBinding[],
  urlToAssetId?: ReadonlyMap<string, string>,
): LabeledAssetBrief {
  if (!inputBindings.length) {
    return brief;
  }
  let bindings: readonly LabeledAssetBinding[] = inputBindings;
  // WP26: group bindings expand into one concrete binding per sibling slot first.
  const expanded: LabeledAssetBinding[] = [];
  for (const binding of inputBindings) {
    if (!binding.groupId) {
      expanded.push(binding);
      continue;
    }
    const siblings = brief.slots.filter(slot => slot.groupId === binding.groupId);
    if (binding.status === 'skipped') {
      expanded.push(...siblings.map(slot => ({slotId: slot.id, status: 'skipped' as const})));
      continue;
    }
    const ids = binding.userAssetIds ?? [];
    const urls = binding.assetUrls ?? [];
    const open = siblings.filter(slot => slot.status === 'needed');
    open.forEach((slot, index) => {
      const userAssetId = ids[index] ?? (urls[index] ? urlToAssetId?.get(urls[index]!.trim()) : undefined);
      if (userAssetId) expanded.push({slotId: slot.id, status: 'uploaded', userAssetId});
    });
  }
  bindings = expanded;
  const byId = new Map(bindings.map(b => [b.slotId, b]));
  const byKey = new Map(
    bindings
      .filter(b => b.kind && b.label)
      .map(b => [slotMatchKey(b.kind!, b.label!), b]),
  );

  return {
    ...brief,
    slots: brief.slots.map(slot => {
      const binding = byId.get(slot.id) ?? byKey.get(slotMatchKey(slot.kind, slot.label));
      if (!binding) {
        return slot;
      }
      if (binding.status === 'skipped') {
        return {...slot, status: 'skipped' as const, userAssetId: undefined};
      }
      const fromUrl =
        binding.assetUrl && urlToAssetId
          ? urlToAssetId.get(binding.assetUrl.trim())
          : undefined;
      const userAssetId = (binding.userAssetId || fromUrl || '').trim();
      if (!userAssetId) {
        return slot;
      }
      return {...slot, status: 'uploaded' as const, userAssetId};
    }),
  };
}

/**
 * WP26: is the edit ready to run media-rich? `awaiting_assets` while any REQUIRED slot is still `needed` (an optional slot never blocks; uploaded or explicitly skipped both count as answered).
 * The analyze response carries this next to `assetBrief`; the app shows `requiredRemaining` as the checklist and re-submits with `labeledAssetBindings` before it renders.
 */
export type EditReadiness = {
  status: 'awaiting_assets' | 'ready';
  neededCount: number;
  uploadedCount: number;
  skippedCount: number;
  requiredRemaining: Array<{id: string; label: string; kind: LabeledAssetKind; groupId?: string; quantity?: number; motionIntent?: string; reason: string}>;
};

export function computeEditReadiness(brief: LabeledAssetBrief | undefined): EditReadiness {
  const slots = brief?.slots ?? [];
  const requiredRemaining = slots
    .filter(slot => slot.required === true && slot.status === 'needed')
    .map(slot => ({id: slot.id, label: slot.label, kind: slot.kind, ...(slot.groupId ? {groupId: slot.groupId} : {}), ...(slot.quantity ? {quantity: slot.quantity} : {}), ...(slot.motionIntent ? {motionIntent: slot.motionIntent} : {}), reason: slot.reason}));
  return {
    status: requiredRemaining.length > 0 ? 'awaiting_assets' : 'ready',
    neededCount: slots.filter(slot => slot.status === 'needed').length,
    uploadedCount: slots.filter(slot => slot.status === 'uploaded').length,
    skippedCount: slots.filter(slot => slot.status === 'skipped').length,
    requiredRemaining,
  };
}
