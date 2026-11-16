/**
 * Who may start Kinetic Typography while V1_KINETIC_RELEASE is on. FAIL CLOSED, in every environment.
 *
 *   V1_KINETIC_ACCESS            `allowlist` (the only mode permitted in production) or `all` (refused in production: it is never a production default).
 *                                Unset, empty, misspelled or unknown: nobody.
 *   V1_KINETIC_ALLOWED_USER_IDS  comma-separated account UUIDs (server-side configuration only). Used by `allowlist`. Unset or empty: nobody. ONE malformed entry
 *                                (not a UUID, an empty segment from a stray comma) invalidates the WHOLE list: nobody.
 *
 * This is an ADDITIONAL condition. Pro entitlement is still required (the plan always comes from the Creators API, never from here): a Nepal-verified or purchased
 * Pro account that is not on the list is refused, and being on the list never grants Pro. There is no exemption for any auth path (service key, dev bypass): the
 * account id the request is made for must be on the list. Free Basic Captions never reach this module.
 *
 * Account ids come only from the environment. They are never hardcoded, never logged and never returned to a client: reasons are fixed codes, and the public error
 * for a refusal is the same generic `kinetic_unavailable` whether the configuration is invalid or the account is simply not on the list.
 */

import {EngineError} from './errors.ts';

export type KineticAccessProblem = 'mode_unset' | 'mode_unknown' | 'all_not_permitted_in_production' | 'allowlist_empty' | 'allowlist_malformed';

export type KineticAccessConfig =
  | {ok: true; mode: 'all'}
  | {ok: true; mode: 'allowlist'; ids: ReadonlySet<string>}
  | {ok: false; problem: KineticAccessProblem};

export type KineticAccessDecision = {allowed: true} | {allowed: false; reason: 'not_allowlisted' | `config_${KineticAccessProblem}` | 'invalid_user'};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The canonical (lower-case) form of a UUID, or null when the value is not a UUID. */
export function normalizeUuid(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase();
  return UUID.test(value) ? value : null;
}

/** Pure: the access configuration for these settings. Never throws. `nodeEnv === 'production'` forbids `all`. */
export function parseKineticAccess(input: {mode?: string | undefined; ids?: string | undefined; nodeEnv?: string | undefined}): KineticAccessConfig {
  const production = (input.nodeEnv ?? '').trim().toLowerCase() === 'production';
  const mode = (input.mode ?? '').trim().toLowerCase();
  if (mode === '') return {ok: false, problem: 'mode_unset'};
  if (mode === 'all') return production ? {ok: false, problem: 'all_not_permitted_in_production'} : {ok: true, mode: 'all'};
  if (mode !== 'allowlist') return {ok: false, problem: 'mode_unknown'};
  const text = (input.ids ?? '').trim();
  if (text === '') return {ok: false, problem: 'allowlist_empty'};
  const ids = new Set<string>();
  for (const segment of text.split(',')) {
    const id = normalizeUuid(segment);
    if (!id) return {ok: false, problem: 'allowlist_malformed'}; // one bad entry: the whole list is void
    ids.add(id);
  }
  return {ok: true, mode: 'allowlist', ids};
}

/** Pure: may this account start Kinetic under this configuration? */
export function decideKineticAccess(config: KineticAccessConfig, user: {userId: unknown}): KineticAccessDecision {
  if (!config.ok) return {allowed: false, reason: `config_${config.problem}`};
  if (config.mode === 'all') return {allowed: true};
  const id = normalizeUuid(user.userId);
  if (!id) return {allowed: false, reason: 'invalid_user'};
  return config.ids.has(id) ? {allowed: true} : {allowed: false, reason: 'not_allowlisted'};
}

type EnvLike = {NODE_ENV?: string | undefined; V1_KINETIC_ACCESS?: string | undefined; V1_KINETIC_ALLOWED_USER_IDS?: string | undefined};

export const kineticAccessFromEnv = (env: EnvLike): KineticAccessConfig =>
  parseKineticAccess({mode: env.V1_KINETIC_ACCESS, ids: env.V1_KINETIC_ALLOWED_USER_IDS, nodeEnv: env.NODE_ENV});

type LoggerLike = {info: (obj: Record<string, unknown>, msg: string) => void; warn: (obj: Record<string, unknown>, msg: string) => void; error: (obj: Record<string, unknown>, msg: string) => void};

/** A refusal, as the client sees it. One generic message for every reason (the reason is logged by the caller as a fixed code, never with an account id). */
export function kineticAccessRefusal(): EngineError {
  return new EngineError('kinetic_unavailable', 'Kinetic Typography is not available right now. Please try again later.', {reason: 'kinetic_access'});
}

/**
 * Throws the generic refusal unless this account may start Kinetic. Call it only when V1_KINETIC_RELEASE is on.
 * `where` is a fixed route label for the log; the account id is never logged.
 */
export function assertKineticAccess(env: EnvLike, auth: {userId: unknown}, logger: LoggerLike, where: string): void {
  const decision = decideKineticAccess(kineticAccessFromEnv(env), auth);
  if (decision.allowed) return;
  logger.warn({where, reason: decision.reason}, 'kinetic access refused');
  throw kineticAccessRefusal();
}

/** The same decision without throwing (the style catalog uses it to mark Kinetic unavailable for an account). */
export const kineticAccessAllowed = (env: EnvLike, auth: {userId: unknown}): boolean => decideKineticAccess(kineticAccessFromEnv(env), auth).allowed;

/**
 * Retry / asset submission of an EXISTING job: a job created while its owner had access must not outlive that access. Applies only to the caller's own Kinetic job
 * (anything else falls through to the route's normal not-found / ownership handling, unchanged) and only while the release is on.
 */
export function assertKineticJobAccess(env: EnvLike & {V1_KINETIC_RELEASE?: boolean | undefined}, auth: {userId: unknown}, job: {userId?: unknown; style?: unknown} | null | undefined, logger: LoggerLike, where: string): void {
  if (!env.V1_KINETIC_RELEASE || !job || job.style !== 'kinetic_typography' || job.userId !== auth.userId) return;
  assertKineticAccess(env, auth, logger, where);
}

/** What the startup log says. Never contains an account id; the allowlist is reported by count only. */
export type KineticAccessSummary = {state: 'allowlist'; allowlistCount: number} | {state: 'all'} | {state: 'unavailable'; problem: KineticAccessProblem};

export function describeKineticAccess(config: KineticAccessConfig): KineticAccessSummary {
  if (!config.ok) return {state: 'unavailable', problem: config.problem};
  return config.mode === 'all' ? {state: 'all'} : {state: 'allowlist', allowlistCount: config.ids.size};
}

/** Startup report. Reports only while the release is on; an invalid configuration is an ERROR line (Kinetic refused for everyone, Free captions unaffected). */
export function logKineticAccessAtStartup(env: EnvLike & {V1_KINETIC_RELEASE?: boolean | undefined}, logger: LoggerLike): KineticAccessSummary | null {
  if (!env.V1_KINETIC_RELEASE) return null;
  const summary = describeKineticAccess(kineticAccessFromEnv(env));
  if (summary.state === 'unavailable') {
    logger.error({problem: summary.problem}, 'V1 Kinetic release is ON but its access configuration is invalid: Kinetic Typography is refused for every account (Free Basic Captions are unaffected)');
  } else if (summary.state === 'all') {
    logger.warn({}, 'V1 Kinetic access is GLOBAL (V1_KINETIC_ACCESS=all): permitted outside production only');
  } else {
    logger.info({allowlistCount: summary.allowlistCount}, 'V1 Kinetic access: allowlist');
  }
  return summary;
}
