/**
 * WP1: the creator-supplied B-roll contract. Pure (no imports of the logger, `.env`, stock clients or any SDK), so it can be unit-tested with synthetic assets.
 *
 * Contract when `userBrollOnly` is on (MVP product path; off everywhere else, which leaves today's behaviour unchanged):
 *   1. a placement may use only an asset the creator supplied, referenced by its exact stable id (`ub_<n>`, assigned by input order);
 *   2. an id the Director invented, mistyped or left out never causes a different asset to be chosen (no keyword scoring, no "first clip", no leftovers);
 *   3. a still never drags other unused stills into a slideshow the Director did not ask for;
 *   4. stock footage is never searched or placed;
 *   5. a backstop pass removes any placement that still violates 1 or 4 and reports what it removed.
 * A moment with no valid asset simply has no B-roll (the existing "miss" path); the speaker stays on screen.
 */

export type AssetLike = {id: string; url: string; kind: string};

/** True for the placeholder captions `userBrollDescribe` writes when it could not actually describe an asset (so they are not evidence of what the asset shows). */
export function isGenericAssetDescription(description: string): boolean {
  return /^(Creator-supplied still image|Creator-supplied visual|Creator B-roll clip \(~[0-9.]+s\))$/.test(description.trim());
}

/** Keeps the first asset for each id and reports repeats. Ids come from input order so repeats should not occur; if they ever did, a Map would silently let the last one win. */
export function uniqueAssetsById<T extends {id: string}>(assets: readonly T[]): {assets: T[]; duplicates: string[]} {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  const kept: T[] = [];
  for (const asset of assets) {
    if (seen.has(asset.id)) {
      duplicates.push(asset.id);
      continue;
    }
    seen.add(asset.id);
    kept.push(asset);
  }
  return {assets: kept, duplicates};
}

/** Exact-id lookup only. Anything else (missing, unknown, empty, different case) returns null: no substitute is ever offered. */
export function pickTaggedUserAsset<T extends AssetLike>(taggedId: string | null | undefined, byId: ReadonlyMap<string, T>): T | null {
  if (typeof taggedId !== 'string' || taggedId === '') return null;
  return byId.get(taggedId) ?? null;
}

/** The stills shown together with `seed`: only the seed itself under the contract (the legacy behaviour adds up to three other unused stills). */
export function stillsForSlideshow<T extends AssetLike>(seed: T, byId: ReadonlyMap<string, T>, used: ReadonlySet<string>, options: {userBrollOnly?: boolean}): T[] {
  const isStill = (asset: AssetLike) => asset.kind === 'photo' || asset.kind === 'document';
  const photos: T[] = isStill(seed) ? [seed] : [];
  if (options.userBrollOnly) return photos;
  for (const asset of byId.values()) {
    if (used.has(asset.id) || asset.id === seed.id || !isStill(asset)) continue;
    photos.push(asset);
    if (photos.length >= 4) break;
  }
  return photos;
}

/**
 * Assets the Director may be told about. Under the contract an asset whose description could not be produced is withheld (the Director cannot match what it cannot see,
 * and a generic caption invites arbitrary placement). Ids are NOT renumbered: the withheld asset's id simply never appears, so every id stays stable.
 */
export function assetsOfferedToDirector<T extends {described?: boolean}>(assets: readonly T[], options: {userBrollOnly?: boolean}): T[] {
  return options.userBrollOnly ? assets.filter(asset => asset.described !== false) : [...assets];
}

export type ContractClip = {assetUrl: string; provider?: string};
export type ContractOverlay = {assetUrl: string; provider?: string; layout?: string; slides?: Array<{assetUrl: string; provider?: string}>};
export type ContractDropped = {kind: 'clip' | 'overlay' | 'depth_overlay' | 'slide'; reason: 'stock_provider' | 'unsupplied_asset'; assetUrl: string};

const STOCK = new Set(['pexels', 'pixabay']);

/**
 * Backstop for the contract. A placement survives only if its provider is not stock and, when it claims to be a creator asset (`user`), its URL is one the creator supplied.
 * `generated` overlays (engine-made, no media URL of the creator's) are not B-roll and are left alone. Text-only overlays carry no asset and are left alone.
 */
export function enforceUserBrollContract<C extends ContractClip, O extends ContractOverlay, D extends ContractClip>(input: {
  clips: readonly C[];
  overlays: readonly O[];
  depthOverlays: readonly D[];
  suppliedUrls: readonly string[];
}): {clips: C[]; overlays: O[]; depthOverlays: D[]; dropped: ContractDropped[]} {
  const supplied = new Set(input.suppliedUrls);
  const dropped: ContractDropped[] = [];
  const verdict = (item: ContractClip): ContractDropped['reason'] | null =>
    item.provider && STOCK.has(item.provider) ? 'stock_provider' : item.provider === 'user' && !supplied.has(item.assetUrl) ? 'unsupplied_asset' : null;
  const keep = <T extends ContractClip>(items: readonly T[], kind: 'clip' | 'depth_overlay'): T[] =>
    items.filter(item => {
      const reason = verdict(item);
      if (reason) dropped.push({kind, reason, assetUrl: item.assetUrl});
      return !reason;
    });
  const overlays: O[] = [];
  for (const overlay of input.overlays) {
    const reason = overlay.assetUrl || (overlay.provider && STOCK.has(overlay.provider)) ? verdict(overlay) : null;
    if (reason) {
      dropped.push({kind: 'overlay', reason, assetUrl: overlay.assetUrl});
      continue;
    }
    if (overlay.slides) {
      const slides = overlay.slides.filter(slide => {
        const slideReason = verdict(slide);
        if (slideReason) dropped.push({kind: 'slide', reason: slideReason, assetUrl: slide.assetUrl});
        return !slideReason;
      });
      overlays.push(slides.length === overlay.slides.length ? overlay : ({...overlay, slides: slides.length >= 2 ? slides : undefined} as O));
    } else {
      overlays.push(overlay);
    }
  }
  return {clips: keep(input.clips, 'clip'), overlays, depthOverlays: keep(input.depthOverlays, 'depth_overlay'), dropped};
}

// ---- WP3B: recording the supplied asset id on each placed creator item (mvp only; changes no selection, timing or pixel) ----------------------------------------------------

/** URL -> id of the supplied creator assets. The first asset wins for a repeated URL (ids come from input order, so a repeat would be a duplicate input). */
export function userBrollIdByUrl(assets: ReadonlyArray<{id: string; url: string}>): Map<string, string> {
  const map = new Map<string, string>();
  for (const asset of assets) if (!map.has(asset.url)) map.set(asset.url, asset.id);
  return map;
}

type Stampable = {provider?: string; assetUrl?: string; userBrollId?: string};

/**
 * Adds `userBrollId` to every placed creator item (clips, overlays, overlay slides, depth overlays) whose provider is `user` and whose URL is a supplied asset. Mutates the
 * items in place (so the edit ledger's identity of each item is preserved) and adds only that one property. A creator item whose URL is not supplied is left unstamped and
 * counted: it is what the scorer then reports. Stock and generated items are never stamped.
 */
export function stampUserBrollIds(input: {
  clips: readonly Stampable[];
  overlays: ReadonlyArray<Stampable & {slides?: readonly Stampable[]}>;
  depthOverlays: readonly Stampable[];
  idByUrl: ReadonlyMap<string, string>;
}): {stamped: number; unmatched: number} {
  let stamped = 0;
  let unmatched = 0;
  const stamp = (item: Stampable) => {
    if (item.provider !== 'user' || !item.assetUrl) return;
    const id = input.idByUrl.get(item.assetUrl);
    if (id) {
      item.userBrollId = id;
      stamped += 1;
    } else {
      unmatched += 1;
    }
  };
  input.clips.forEach(stamp);
  input.depthOverlays.forEach(stamp);
  for (const overlay of input.overlays) {
    stamp(overlay);
    overlay.slides?.forEach(stamp);
  }
  return {stamped, unmatched};
}
