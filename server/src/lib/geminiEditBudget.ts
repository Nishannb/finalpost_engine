/**
 * WP3C: per-edit Gemini REQUEST cap for the product analyze path. Same shape as productClaudeBudget.ts: a synchronous reservation before every dispatch, a count that
 * is never given back, and a refusal that stops the call without throwing away the job.
 *
 * Where it bites: `lib/http.ts` `requestWithRetry`, the one place every Gemini request of the analyze job passes (the Director and its model fallbacks, asset descriptions, content
 * profile, occupancy, layout critique, romanization, delivery planner, motion Director, North Star gates: all use `requestJson` or `callDirectorModel`, which uses it). It counts
 * every HTTP ATTEMPT, so the library's own retries and the model-fallback loops are counted. A job runs inside `runWithGeminiBudget`, so concurrent jobs have separate budgets; code
 * outside a scope (the experiment runner, scripts, other routes) is not counted and behaves as before.
 *
 * What a refusal is: an `EngineError` with the caller's own `failureCode` (never `upstream_timeout`, which some callers answer with one more request). The stage's existing
 * catch / fallback therefore runs exactly as for any failed call, and the job continues; the stop is recorded as warnings by `analyzeVideo`.
 *
 * Priority (WP3D): a plain count lets the stages that run first (asset descriptions, up to ~24 attempts) use every slot before the Director runs. So a positive cap first
 * RESERVES one attempt each for the three stages the edit cannot do without, in this order: the v1 Director, speaker occupancy, the content profile. With a cap of 1 the single
 * slot is the Director's; with 2 the Director and occupancy; with 3 all three. Every other call (asset descriptions, layout critique, delivery planner, motion Director,
 * romanization, directorV2, North Star) draws only from what is left. A reserved stage's FIRST attempt uses its reserved slot; its later attempts (retries, model fallbacks)
 * draw from the general pool like everyone else. Classification is by the exact call label the stage passes to `requestJson` (a test pins each label to its call site). An
 * unused reservation stays held for the whole job (the chokepoint cannot know a stage was skipped), so a job that never runs, say, the content profile leaves one slot idle.
 *
 * What it is not: a dollar cap, and not a provider-side guarantee. A request count is the only bound that can be enforced BEFORE dispatch; the engine's Gemini rates are two flat
 * constants copied into three files, not a per-model table, and a call's cost is only known after it returns.
 */
import {AsyncLocalStorage} from 'node:async_hooks';

import {EngineError, type EngineErrorCode} from './errors.ts';
import {isMvpLikeProfile, type ProductEditProfile} from './productEditProfile.ts';

// Built from parts on purpose: eval/callInventory.test.ts greps every source file for the literal host to find call sites, and this helper only RECOGNISES the host, it makes no request.
export const GEMINI_HOST = ['generativelanguage', 'googleapis', 'com'].join('.');

export function isGeminiUrl(url: string): boolean {
  try {
    return new URL(url).hostname === GEMINI_HOST;
  } catch {
    return false;
  }
}


/** The stages that keep one reserved attempt, in the order the slots are handed out when the cap is too small for all of them. */
export const RESERVED_CLASSES = ['director', 'occupancy', 'content_profile'] as const;
export type ReservedClass = (typeof RESERVED_CLASSES)[number];

/** Exact call labels (what the stage passes to requestJson / callDirectorModel). Anything else is "other" and uses only the general pool. */
export const RESERVED_LABELS: Readonly<Record<string, ReservedClass>> = {
  'Gemini visual director': 'director',
  'Gemini speaker occupancy': 'occupancy',
  'content profile': 'content_profile',
};

export function classifyGeminiLabel(label: string): ReservedClass | 'other' {
  return Object.prototype.hasOwnProperty.call(RESERVED_LABELS, label) ? RESERVED_LABELS[label]! : 'other';
}

/**
 * WP8G: which stages keep a reserved slot, in what order the slots are handed out when the cap is too small, which exact call label belongs to which stage, and which stages may NOT draw from
 * the general pool (so a retry of that stage cannot burn a slot another stage needs). The default plan is the WP3D one, byte for byte. Pure data.
 */
export type BudgetPlan = {
  order: readonly string[];
  labels: Readonly<Record<string, string>>;
  /** Stages limited to their own reserved slot: one attempt, then their fallback. */
  noPool?: readonly string[];
};

export const DEFAULT_BUDGET_PLAN: BudgetPlan = {order: RESERVED_CLASSES, labels: RESERVED_LABELS};

/**
 * WP8G, polish: with a small cap (Gate 1 ran with 8) the stages polish exists for must not starve. Priority: the speech keep-plan, the Director v2 story and creative calls, the motion
 * Director, then occupancy (one attempt only, then the fallback box: it never draws from the pool) and the content profile. Repairs and retries use whatever pool is left.
 */
export const POLISH_BUDGET_PLAN: BudgetPlan = {
  order: ['keep_plan', 'director_story', 'director_creative', 'motion_director', 'occupancy', 'content_profile'],
  labels: {
    'cuts ai keep plan': 'keep_plan',
    'Director v2 story analyst': 'director_story',
    'Director v2 creative director': 'director_creative',
    'Gemini visual director': 'director_creative',
    'motion graphics director': 'motion_director',
    'Gemini speaker occupancy': 'occupancy',
    'content profile': 'content_profile',
  },
  noPool: ['occupancy'],
};

/** The budget plan for a profile: polish gets the polish plan, every other profile the default one. */
export function geminiBudgetPlanFor(profile: ProductEditProfile | undefined): BudgetPlan {
  return profile === 'polish' ? POLISH_BUDGET_PLAN : DEFAULT_BUDGET_PLAN;
}

export type GeminiBudgetReport = {
  maxRequests: number;
  /** Attempts that were allowed to leave the process (each one counts, whether or not it succeeded). */
  attempted: number;
  /** Attempts refused because nothing was left for that call. They never left the process. */
  refused: number;
  stopped: boolean;
  /** Attempts per call label (labels are short stage names, never prompts or keys). */
  byLabel: Record<string, number>;
  /** Slots handed to each reserved stage at the start, and the general pool that was left. */
  reservedAtStart: Record<string, number>;
  /** Reserved slots that were never used (still held back from everyone else). */
  reservedUnused: Record<string, number>;
  poolAtStart: number;
};

/**
 * `reservations` lists the classes that get a reserved slot (default: all of the plan's; `[]` is a plain counter, used only by tests of the counting itself). `plan` (WP8G) names the classes, the
 * labels and the no-pool classes; the default plan is the original three-class one.
 */
export function createGeminiEditBudget(maxRequests: number, options: {reservations?: readonly string[]; plan?: BudgetPlan} = {}) {
  const cap = Number.isFinite(maxRequests) && maxRequests > 0 ? Math.floor(maxRequests) : 0;
  const plan = options.plan ?? DEFAULT_BUDGET_PLAN;
  const noPool = new Set(plan.noPool ?? []);
  const wanted = new Set(options.reservations ?? plan.order);
  const reservedAtStart: Record<string, number> = Object.fromEntries(plan.order.map(cls => [cls, 0]));
  let left = cap;
  for (const cls of plan.order) {
    if (wanted.has(cls) && left > 0) {
      reservedAtStart[cls] = 1;
      left -= 1;
    }
  }
  const poolAtStart = left;
  const reserved = {...reservedAtStart};
  let pool = poolAtStart;
  let attempted = 0;
  let refused = 0;
  const byLabel: Record<string, number> = {};
  const take = (label: string) => {
    attempted += 1;
    byLabel[label] = (byLabel[label] ?? 0) + 1;
  };
  return {
    /** Synchronous: JavaScript runs it to completion before any other callback, so concurrent callers cannot both take the last slot. */
    reserve(label: string): {ok: true} | {ok: false} {
      const cls = Object.prototype.hasOwnProperty.call(plan.labels, label) ? plan.labels[label]! : 'other';
      if (cls !== 'other' && (reserved[cls] ?? 0) > 0) {
        reserved[cls]! -= 1; // the stage's first attempt: its own reserved slot
        take(label);
        return {ok: true};
      }
      if (cls !== 'other' && noPool.has(cls)) {
        refused += 1; // WP8G: a no-pool stage (occupancy) gets one attempt, then its fallback
        return {ok: false};
      }
      if (pool > 0) {
        pool -= 1;
        take(label);
        return {ok: true};
      }
      refused += 1;
      return {ok: false};
    },
    report(): GeminiBudgetReport {
      return {maxRequests: cap, attempted, refused, stopped: refused > 0, byLabel: {...byLabel}, reservedAtStart: {...reservedAtStart}, reservedUnused: {...reserved}, poolAtStart};
    },
  };
}

export type GeminiEditBudget = ReturnType<typeof createGeminiEditBudget>;

/**
 * The env value -> a budget or none. 0 or unset: none (today's behaviour, unbounded). A positive number: that many attempts. A negative, NaN or sub-one value is a
 * misconfiguration and fails closed: a budget of zero, so no Gemini request is sent and every stage uses its fallback.
 */
export function geminiBudgetFromLimit(raw: number, plan?: BudgetPlan): GeminiEditBudget | undefined {
  if (raw === 0) return undefined;
  if (!Number.isFinite(raw) || raw < 0) return createGeminiEditBudget(0, {plan});
  return createGeminiEditBudget(raw, {plan});
}

/** WP5D: the warning recorded when an mvp edit runs with no Gemini attempt cap. */
export const GEMINI_BUDGET_UNCONFIGURED_WARNING = 'gemini_edit_budget_unconfigured';

/**
 * WP5D: `gemini_edit_budget_unconfigured` when the profile is `mvp` and `GEMINI_EDIT_MAX_REQUESTS` is unset or 0, i.e. exactly the case where `geminiBudgetFromLimit` returns no budget
 * (unbounded Gemini attempts), else null. Follows `geminiBudgetFromLimit`'s own reading and adds no policy: a positive cap is a budget (null); a negative, NaN or sub-one value is a
 * misconfiguration that already FAILS CLOSED (a budget of zero, no Gemini request at all), so it is a configured budget and gives null too. Legacy never warns. Pure.
 */
export function geminiBudgetUnconfiguredWarning(profile: ProductEditProfile | undefined, rawMaxRequests: number): string | null {
  return isMvpLikeProfile(profile) && geminiBudgetFromLimit(rawMaxRequests) === undefined ? GEMINI_BUDGET_UNCONFIGURED_WARNING : null;
}

const scope = new AsyncLocalStorage<GeminiEditBudget>();

/** Runs `fn` with `budget` in force for every awaited continuation. With no budget it just runs `fn` (nothing changes). */
export function withGeminiBudget<T>(budget: GeminiEditBudget | undefined, fn: () => Promise<T>): Promise<T> {
  return budget ? scope.run(budget, fn) : fn();
}

export function currentGeminiBudget(): GeminiEditBudget | undefined {
  return scope.getStore();
}

export class GeminiBudgetError extends EngineError {
  constructor(label: string, code: EngineErrorCode) {
    // No URL, key, prompt or provider body; no billing wording (a refusal is not a billing failure).
    super(code === 'upstream_timeout' ? 'internal' : code, `${label} was not sent: this edit's request limit was reached`, {reason: 'edit_request_limit'});
  }
}

/**
 * Called by `requestWithRetry` before EVERY attempt. Outside a scope, or for a non-Gemini host, it does nothing. Inside a scope it takes a slot or throws `GeminiBudgetError`.
 */
export function reserveGeminiAttempt(url: string, label: string, failureCode: EngineErrorCode): void {
  const budget = scope.getStore();
  if (!budget || !isGeminiUrl(url)) return;
  if (!budget.reserve(label).ok) throw new GeminiBudgetError(label, failureCode);
}
