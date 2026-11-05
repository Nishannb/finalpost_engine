/**
 * Edit-style registry: the single source of truth for the "Choose a style" picker.
 *
 * Pure (no env import, no I/O): callers pass configuration in, so the HTTP layer, the edit runner and tests all
 * resolve a style the same way. The app renders from GET /v1/edit-styles (which serializes this registry), so a
 * style can be made available or reordered with a server config change, without an app release.
 *
 * Phase 1 boundary: a style only decides the job `mode` the existing runner already understands, plus a pass-through
 * `style` id for the analysis. The pipeline does not read the style yet (Phase 2, docs/ENGINE_STYLE_INTEGRATION.md),
 * so a style whose engine support is `pending` runs as its `degradesTo` style and the job records that as `degraded`.
 *
 * Faceless Documentary and Newsroom are deliberately NOT in this registry: they are not exposed in v1.
 */

export const EDIT_STYLE_IDS = ['basic_captions', 'ai_clean_cut', 'kinetic_typography', 'explainer'] as const;
export type EditStyleId = (typeof EDIT_STYLE_IDS)[number];
export type EditStyleTier = 'free' | 'pro';
/** The existing `CaptionsEditJob.mode` values a style can run as. */
export type EditStyleJobMode = 'basic_captions' | 'full_edit';

export type EditStyleDefinition = {
  id: EditStyleId;
  name: string;
  description: string;
  tier: EditStyleTier;
  /** Default availability; `EDIT_STYLES_AVAILABLE` (server env) overrides it without a code change. */
  available: boolean;
  sortOrder: number;
  /** Key of the preview video the app bundles (assets/edit-style-previews/<key>.mp4). Swapping the file swaps the preview. */
  previewAsset: string;
  /** The job mode existing consumers (runner, durable store, push routing) see. */
  mode: EditStyleJobMode;
  /** `native`: today's pipeline already produces this style. `pending`: needs Phase 2; until then the job runs as `degradesTo`. */
  engineSupport: 'native' | 'pending';
  degradesTo?: EditStyleId;
};

export const EDIT_STYLES: Readonly<Record<EditStyleId, EditStyleDefinition>> = {
  basic_captions: {
    id: 'basic_captions',
    name: 'Basic Captions',
    description: 'Accurate captions timed to your voice. No cuts.',
    tier: 'free',
    available: true,
    sortOrder: 10,
    previewAsset: 'basic_captions',
    mode: 'basic_captions',
    engineSupport: 'native',
  },
  ai_clean_cut: {
    id: 'ai_clean_cut',
    name: 'AI Clean Cut',
    description: 'Removes silences, filler words and retakes, then adds captions.',
    tier: 'pro',
    available: true,
    sortOrder: 20,
    previewAsset: 'ai_clean_cut',
    mode: 'full_edit',
    engineSupport: 'native',
  },
  kinetic_typography: {
    id: 'kinetic_typography',
    name: 'Kinetic Typography',
    description: 'Clean cuts plus bold animated type on your key lines.',
    tier: 'pro',
    available: false,
    sortOrder: 30,
    previewAsset: 'kinetic_typography',
    mode: 'full_edit',
    engineSupport: 'pending',
    degradesTo: 'ai_clean_cut',
  },
  explainer: {
    id: 'explainer',
    name: 'Explainer',
    description: 'Clean cuts plus diagrams and cutaways for talking-head explainers.',
    tier: 'pro',
    available: false,
    sortOrder: 40,
    previewAsset: 'explainer',
    mode: 'full_edit',
    engineSupport: 'pending',
    degradesTo: 'ai_clean_cut',
  },
};

export function isEditStyleId(value: unknown): value is EditStyleId {
  return typeof value === 'string' && (EDIT_STYLE_IDS as readonly string[]).includes(value);
}

/** Config the server reads from env (passed in; this module never imports env). */
export type EditStyleConfig = {
  /** EDIT_STYLES_ENABLED: off = `style` is ignored everywhere and the catalog route 404s (old mode-only behaviour). */
  enabled: boolean;
  /** EDIT_STYLES_AVAILABLE: comma list of style ids that are available. Empty = registry defaults. */
  availableOverride: string;
  /** EDIT_STYLES_ORDER: comma list of style ids in display order. Ids not listed keep registry order after the listed ones. Empty = registry order. */
  orderOverride: string;
};

const csv = (raw: string) =>
  raw
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);

/** Whether a style can be started right now (registry default, or the env override when it is set). */
export function isStyleAvailable(id: EditStyleId, config: Pick<EditStyleConfig, 'availableOverride'>): boolean {
  const override = csv(config.availableOverride);
  return override.length > 0 ? override.includes(id) : EDIT_STYLES[id].available;
}

export type EditStyleCatalogEntry = {
  id: EditStyleId;
  name: string;
  description: string;
  tier: EditStyleTier;
  available: boolean;
  sortOrder: number;
  previewAsset: string;
  /** True when the current creator's plan does not include this style (fail closed: an unverifiable plan locks Pro). */
  locked: boolean;
};

/** The catalog the app renders, sorted, with each style's lock state for one creator. */
export function buildEditStyleCatalog(input: {config: Pick<EditStyleConfig, 'availableOverride' | 'orderOverride'>; hasPro: boolean}): EditStyleCatalogEntry[] {
  const order = csv(input.config.orderOverride).filter(isEditStyleId);
  const rank = (id: EditStyleId) => {
    const index = order.indexOf(id);
    return index >= 0 ? index : order.length + EDIT_STYLES[id].sortOrder;
  };
  return EDIT_STYLE_IDS.map(id => EDIT_STYLES[id])
    .slice()
    .sort((a, b) => rank(a.id) - rank(b.id))
    .map((style, index) => ({
      id: style.id,
      name: style.name,
      description: style.description,
      tier: style.tier,
      available: isStyleAvailable(style.id, input.config),
      sortOrder: (index + 1) * 10,
      previewAsset: style.previewAsset,
      locked: style.tier === 'pro' && !input.hasPro,
    }));
}

/** Why a job does not (yet) look like the style the creator picked. Recorded on the job so it is visible, never silent. */
export type EditStyleDegradation = {
  reason: 'engine_style_pending';
  /** The style the pipeline actually produced. */
  appliedAs: EditStyleId;
};

export type ResolvedEditStyle = {
  style: EditStyleId;
  tier: EditStyleTier;
  mode: EditStyleJobMode;
  degraded?: EditStyleDegradation;
};

/**
 * Resolve the `style` field of an edit request. Returns null when there is no style to apply (the kill switch is off,
 * or the field is absent): the caller then keeps the request's `mode` exactly as before.
 * Throws a typed reason the route maps to an HTTP error: unknown id (400) or unavailable style (409).
 */
export function resolveRequestedStyle(raw: unknown, config: EditStyleConfig): ResolvedEditStyle | null | {error: 'unknown_style' | 'style_unavailable'; style: string} {
  if (!config.enabled || raw === undefined || raw === null || raw === '') {
    return null;
  }
  if (!isEditStyleId(raw)) {
    return {error: 'unknown_style', style: String(raw).slice(0, 60)};
  }
  if (!isStyleAvailable(raw, config)) {
    return {error: 'style_unavailable', style: raw};
  }
  const def = EDIT_STYLES[raw];
  return {
    style: def.id,
    tier: def.tier,
    mode: def.mode,
    ...(def.engineSupport === 'pending' ? {degraded: {reason: 'engine_style_pending', appliedAs: def.degradesTo ?? 'ai_clean_cut'}} : {}),
  };
}

export function styleTier(id: EditStyleId | undefined): EditStyleTier | undefined {
  return id ? EDIT_STYLES[id]?.tier : undefined;
}
