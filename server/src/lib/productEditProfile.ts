/**
 * WP1: the one named configuration boundary for the improved product editing path. Pure (no env import, no logger): callers pass values in.
 *
 * WP7C: the SHIPPING DEFAULT is `cuts` (the product is messy one-take in, polished cut out). Unset, empty or unrecognized PRODUCT_EDIT_PROFILE resolves to `cuts`; the exact strings `legacy` and `mvp`
 * are explicit opt-outs for the older behaviours. An unrecognized non-empty value (a typo such as "legcy" or "MVP") falls to cuts and `unrecognizedEditProfile` reports it so the caller can warn.
 *
 *   legacy            explicit opt-in (PRODUCT_EDIT_PROFILE=legacy): exactly the pre-WP1 behaviour. Nothing below changes anything.
 *   mvp               explicit opt-in (server env PRODUCT_EDIT_PROFILE=mvp), never settable by an API caller. It switches on, for the product analyze path only:
 *                       - whole-video Director input (the Director sees the footage, not only the transcript);
 *                       - the art-directed opening plan (validated by the existing resolver; a rejected plan falls back to the standard hook);
 *                       - creator-B-roll-only planning (stages/broll/userBrollContract.ts);
 *                       - a mandatory per-edit Claude bound when generated graphics are on (graphics stay off unless MOTION_GRAPHICS_ENABLED already enables them).
 *                     It does NOT enable strictAiDirection or strictProvenance, and it does not turn generated graphics on by itself.
 *   cuts              WP7A, explicit opt-in (server env PRODUCT_EDIT_PROFILE=cuts, never settable by an API caller): the CUTS-FIRST path. Its only job is to turn messy raw talking-head into a
 *                     smooth short by cutting, with no visual polish:
 *                       RUNS     silence + hesitation-filler trim, transcript retake / restart / self-correction trim (WP6A-E), and background-noise reduction on the talking-head audio
 *                                (stages/audio/noiseFilter.ts; a failed denoise warns and keeps the original audio). The trim is forced on: it does not need a teleprompter script and is not
 *                                skipped by the captions-only / template switches.
 *                       SKIPPED  the visual Director, stock / creator B-roll planning, generated graphics and motion graphics (forced off, whatever MOTION_GRAPHICS_ENABLED says), the
 *                                opening art-direction, delivery shaping (it would also skip the trim). Captions still render through the captions-only plan.
 *                     It does not enable strictAiDirection or strictProvenance and changes no default of the other profiles.
 *   polish            WP8A, explicit opt-in (PRODUCT_EDIT_PROFILE=polish, server env only): Stage A THEN Stage B. Stage A is the whole `cuts` speech path (denoise, AI keep-plan, fluency scrub,
 *                     retakes, forced trim); Stage B is the `mvp` visual editor (Director with whole-video input, opening plan, creator-B-roll-only, legibility, mandatory Claude bound for
 *                     generated graphics, which stay off unless MOTION_GRAPHICS_ENABLED is on). The default stays `cuts`; polish is never the default. Delivery shaping is not run automatically on
 *                     polish (it would replace the Stage A trim); only an explicit request runs it, and then Stage A's trim is skipped and a warning says so.
 * Only the exact strings "legacy", "mvp", "cuts" and "polish" select a profile; unset or empty is cuts, and so is any other value (reported by `unrecognizedEditProfile`).
 */

export const PRODUCT_EDIT_PROFILES = ['legacy', 'mvp', 'cuts', 'polish'] as const;
export type ProductEditProfile = (typeof PRODUCT_EDIT_PROFILES)[number];

/** WP8A: profiles that get the mvp visual-editor behaviours (whole-video Director input, opening plan, creator-B-roll-only, legibility, mandatory Claude bound, unmeasured-face rules): `mvp` and `polish`. */
export function isMvpLikeProfile(profile: ProductEditProfile | undefined): boolean {
  return profile === 'mvp' || profile === 'polish';
}

/** WP8A: profiles that run Stage A (the speech cuts: denoise, AI keep-plan, fluency scrub, retakes, forced trim): `cuts` and `polish`. */
export function runsSpeechCuts(profile: ProductEditProfile | undefined): boolean {
  return profile === 'cuts' || profile === 'polish';
}

/** WP8A: only `cuts` forces every visual stage off (Director, B-roll, graphics, delivery shaping). `polish` keeps the visual rules of mvp. */
export function forcesVisualsOff(profile: ProductEditProfile | undefined): boolean {
  return profile === 'cuts';
}

export function normalizeEditProfile(raw: unknown): ProductEditProfile {
  return raw === 'legacy' || raw === 'mvp' || raw === 'polish' ? raw : 'cuts';
}

/** The raw value when it is non-empty and is none of legacy / mvp / cuts (it was resolved to cuts); otherwise null. For a warning at the callers. */
export function unrecognizedEditProfile(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (raw === 'legacy' || raw === 'mvp' || raw === 'cuts' || raw === 'polish') return null;
  return String(raw);
}

/** Options the product analyze path adds to `analyzeVideo`'s input. Empty for legacy. */
export function analyzeOverridesFor(profile: ProductEditProfile): {directorVideoInput?: true; openingDirection?: true; userBrollOnly?: true} {
  return isMvpLikeProfile(profile) ? {directorVideoInput: true, openingDirection: true, userBrollOnly: true} : {};
}

/** Fingerprint fragment: empty only for an EXPLICIT legacy profile (its keys are the pre-WP1 keys); the mvp key is unchanged too. A cuts blueprint can never be served for another profile (or the reverse). */
export function profileFingerprintKey(profile: ProductEditProfile): string {
  return profile === 'mvp' ? 'edit-profile:mvp-v1' : profile === 'cuts' ? 'edit-profile:cuts-v1' : profile === 'polish' ? 'edit-profile:polish-v1' : '';
}

export type ClaudeBoundDecision =
  | {action: 'unbounded'; why: 'no_generated_graphics' | 'caller_supplied_generator' | 'legacy_unconfigured'}
  | {action: 'bounded'; capUsd: number; maxRequests: number; maxTokensPerCall: number; minTokensPerCall: number}
  | {action: 'disabled'; reason: 'claude_budget_unconfigured' | 'claude_budget_invalid'};

const positive = (value: number) => Number.isFinite(value) && value > 0;

export const CLAUDE_MIN_TOKENS_PER_CALL = 4_000;
export const CLAUDE_DEFAULT_MAX_TOKENS_PER_CALL = 12_000;

/**
 * Decide how Claude calls for ONE edit are bounded. There is deliberately no default dollar amount: the cap is deployment configuration
 * (CLAUDE_EDIT_BUDGET_USD). A request-count default is derived by the caller from existing constants (graphics x attempts), not guessed here.
 *   - no generated graphics, or a caller-supplied generator (experiments bound their own): nothing to do;
 *   - cap set to a positive number: bounded;
 *   - cap set but not usable (negative): graphics disabled, in every profile (fail closed);
 *   - cap unset (0): legacy keeps today's unbounded behaviour; mvp refuses to run graphics (fail closed).
 */
export function decideClaudeBound(input: {
  profile: ProductEditProfile;
  graphicsOn: boolean;
  callerSuppliedGenerator: boolean;
  capUsd: number;
  maxRequests: number;
  maxTokensPerCall: number;
  defaultMaxRequests: number;
}): ClaudeBoundDecision {
  if (!input.graphicsOn) return {action: 'unbounded', why: 'no_generated_graphics'};
  if (input.callerSuppliedGenerator) return {action: 'unbounded', why: 'caller_supplied_generator'};
  if (input.capUsd < 0 || Number.isNaN(input.capUsd)) return {action: 'disabled', reason: 'claude_budget_invalid'};
  if (input.capUsd === 0) return isMvpLikeProfile(input.profile) ? {action: 'disabled', reason: 'claude_budget_unconfigured'} : {action: 'unbounded', why: 'legacy_unconfigured'};
  if (!positive(input.capUsd)) return {action: 'disabled', reason: 'claude_budget_invalid'};
  const maxRequests = positive(input.maxRequests) ? Math.floor(input.maxRequests) : input.defaultMaxRequests;
  const maxTokensPerCall = positive(input.maxTokensPerCall) && input.maxTokensPerCall >= CLAUDE_MIN_TOKENS_PER_CALL ? Math.floor(input.maxTokensPerCall) : CLAUDE_DEFAULT_MAX_TOKENS_PER_CALL;
  if (!positive(maxRequests)) return {action: 'disabled', reason: 'claude_budget_invalid'};
  return {action: 'bounded', capUsd: input.capUsd, maxRequests, maxTokensPerCall, minTokensPerCall: CLAUDE_MIN_TOKENS_PER_CALL};
}

/** WP3X: whether generated graphics ran for a job, as the job record reports it. */
export type JobGraphicsStatus = 'off' | 'on' | 'skipped_budget' | 'library_only';

/**
 * WP3X: map the decision the server already makes (analyzeVideo: `motionGraphicsRequested` from the server flag, then `decideClaudeBound`) to the job's `graphics` field.
 *   off             the flag was off, so nothing was requested;
 *   skipped_budget  requested, then turned off because the Claude budget was missing, invalid or refused (`decideClaudeBound` -> disabled);
 *   on              requested and not disabled: the motion stage was allowed to run AND Claude may be called (`claude_allowed`);
 *   library_only    WP8E, polish only: requested, the Claude bound is disabled, and the motion stage runs for LIBRARY hits only: no Claude call is ever made (a brief the library cannot satisfy is dropped).
 * Server-owned: no request field feeds this. `libraryOnly` is the polish opt-in (`libraryOnlyGraphics`); without it a disabled bound stays `skipped_budget`, exactly as before.
 */
export function jobGraphicsStatus(input: {requested: boolean; bound: ClaudeBoundDecision; libraryOnly?: boolean}): JobGraphicsStatus {
  if (!input.requested) return 'off';
  if (input.bound.action === 'disabled') return input.libraryOnly ? 'library_only' : 'skipped_budget';
  return 'on';
}

/** WP8E: only the polish profile may run its graphics from the library alone when no Claude bound allows a call. mvp, legacy and cuts keep the fail-closed behaviour. */
export function libraryOnlyGraphics(profile: ProductEditProfile | undefined, requested: boolean, bound: ClaudeBoundDecision): boolean {
  return profile === 'polish' && requested && bound.action === 'disabled';
}

/** WP3Y: the store key under which the graphics decision of a saved blueprint is kept (next to, not inside, the blueprint). */
export function graphicsStatusKey(blueprintId: string): string {
  return `engine:blueprint-graphics:${blueprintId}`;
}

/**
 * WP3Y: read a stored graphics decision back. Only the four known values are returned; a missing key (an entry saved before this existed), an empty value or anything else is `undefined`,
 * so the job's `graphics` stays absent. Never derived from the current flag or Claude budget.
 */
export function parseStoredGraphicsStatus(raw: unknown): JobGraphicsStatus | undefined {
  return raw === 'off' || raw === 'on' || raw === 'skipped_budget' || raw === 'library_only' ? raw : undefined;
}

/**
 * WP3Z: the graphics decision THIS request would make now, before any lookup: the same `decideClaudeBound` and `jobGraphicsStatus` that `analyzeVideo` uses, fed only server configuration
 * (the job path has no caller-supplied generator and no per-request flag). `defaultMaxRequests` only matters when positive, and the real default (graphics x attempts, at least 1) always is,
 * so a placeholder of 1 gives the same enabled/disabled answer without knowing the video's duration.
 */
export function requestGraphicsStatus(input: {profile: ProductEditProfile; graphicsFlag: boolean; capUsd: number; maxRequests: number; maxTokensPerCall: number}): JobGraphicsStatus {
  const bound = decideClaudeBound({
    profile: input.profile,
    graphicsOn: input.graphicsFlag,
    callerSuppliedGenerator: false,
    capUsd: input.capUsd,
    maxRequests: input.maxRequests,
    maxTokensPerCall: input.maxTokensPerCall,
    defaultMaxRequests: 1,
  });
  return jobGraphicsStatus({requested: input.graphicsFlag, bound, libraryOnly: libraryOnlyGraphics(input.profile, input.graphicsFlag, bound)});
}

/** WP3Z: the cache-key fragment for a graphics decision. Empty for `off`, so every key made while graphics were off (legacy jobs included) is byte-for-byte what it was. */
export function graphicsFingerprintKey(status: JobGraphicsStatus): string {
  return status === 'off' ? '' : `graphics:${status}`;
}
