/**
 * Completion callbacks to the Creators Flask API (`POST /creator/internal/edit-done`), which owns remote push. The engine never talks to APNs/FCM itself.
 *
 * Delivery is bounded and idempotent:
 *   - every event carries a stable `eventId` (`<type>:<editJobId>:<attempt>`) and `occurredAt`; the receiver deduplicates by it, so a retry or replay is safe
 *   - attempt 1 is awaited; a transient failure (connection error / timeout / 408 / 425 / 429 / 5xx) schedules the remaining attempts in the background with exponential
 *     backoff (base * 2^n, capped), at most `CALLBACK_MAX_ATTEMPTS` in total; a permanent failure (any other 4xx: bad payload, authentication) stops at once
 *   - the event counts as `delivered` only when the receiver acknowledged it with a 2xx; the receiver also reports what happened to the PUSH (`pushStatus`), which is
 *     recorded separately, and a `failed` / `partial` push is re-attempted through the same bounded redelivery (the receiver deduplicates everything else)
 *   - a record of every attempt is handed to `onRecord` (the runner persists it on the job); it never contains the key
 * Limit: pending retries live in this process. A restart loses them; the persisted record then still reads `pending`.
 */

import {env} from '../config/env.ts';
import {logger} from '../lib/logger.ts';
import type {CallbackDeliveryRecord} from '../types/blueprint.ts';

/** Notification kinds. Captions jobs keep sending `edit_done` (status done | failed) exactly as before. */
export type EditNotificationType =
  | 'assets_needed'
  | 'broll_needed'
  | 'edit_done'
  | 'edit_failed';

export type CreatorCallback = {
  userId: string;
  editJobId: string;
  status: 'done' | 'failed' | 'awaiting_assets';
  /** Omitted = the original captions behavior (`edit_done`). */
  type?: EditNotificationType;
  blueprintId?: string;
  outputUrl?: string;
  errorMessage?: string;
  /** Pro edit minutes: `true` on the `done` event of a paid (non Basic Captions) edit; the Creators API charges it once per editJobId. */
  billable?: boolean;
  /** Finished video length (seconds) the charge is computed from. */
  outputDurationSec?: number;
  /** Raw upload length (seconds): what the edit-minutes charge is computed from (the Creators API falls back to outputDurationSec). */
  sourceDurationSec?: number;
  /** Stable event identity; derived when absent. */
  eventId?: string;
  occurredAt?: string;
};

type Options = {
  /** Persist the record after EVERY attempt (the runner saves it on the job; that is the outbox). */
  onRecord?: (eventId: string, record: CallbackDeliveryRecord) => Promise<void> | void;
  /** Continue a persisted event (after a restart / operator re-drive) instead of creating one. */
  resume?: {eventId: string; record: CallbackDeliveryRecord};
  /** Resolve after the first attempt (default) or return immediately and let everything run in the background (boot-time resume). */
  background?: boolean;
};

const inFlight = new Set<Promise<void>>();
const active = new Set<string>();
const sleepers = new Set<{timer: NodeJS.Timeout; resolve: (ok: boolean) => void}>();
const sleepMs = (ms: number) => new Promise<boolean>(resolve => {
  const entry = {timer: setTimeout(() => { sleepers.delete(entry); resolve(true); }, Math.max(0, ms)), resolve};
  sleepers.add(entry);
});

/** Simulates the end of the process for the tests and stops delivery loops on shutdown: nothing more is sent; persisted records are untouched. */
let halted = false;
export function stopCallbackDelivery(): void {
  halted = true; // an attempt still in flight records nothing when it returns (the process is ending)
  for (const entry of sleepers) { clearTimeout(entry.timer); entry.resolve(false); }
  sleepers.clear();
}

export function callbackEventId(input: Pick<CreatorCallback, 'editJobId' | 'type' | 'status'>, attempt = 0): string {
  return `${input.type ?? 'edit_done'}:${input.editJobId}:${attempt}`;
}

/** Test / shutdown helper: resolves when no background retry is pending. */
export async function waitForCallbackRetries(): Promise<void> {
  while (inFlight.size > 0) {
    await Promise.allSettled([...inFlight]);
  }
}

export function callbackBackoffMs(attemptsMade: number): number {
  return Math.min(env.CALLBACK_BACKOFF_MAX_MS, env.CALLBACK_BACKOFF_BASE_MS * 2 ** Math.max(0, attemptsMade - 1));
}

const PERMANENT = (code: number) => code >= 400 && code < 500 && ![408, 425, 429].includes(code);

type Attempt = {code: number; body?: Record<string, unknown>; error?: string};

async function post(input: CreatorCallback & {eventId: string; occurredAt: string}): Promise<Attempt> {
  const url = `${env.CREATOR_API_URL.replace(/\/+$/, '')}/creator/internal/edit-done`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {Accept: 'application/json', 'Content-Type': 'application/json', 'x-engine-key': env.ENGINE_API_KEY},
      body: JSON.stringify({
        userId: input.userId,
        editJobId: input.editJobId,
        status: input.status,
        eventId: input.eventId,
        occurredAt: input.occurredAt,
        ...(input.type ? {type: input.type} : {}),
        ...(input.blueprintId ? {blueprintId: input.blueprintId} : {}),
        ...(input.outputUrl ? {outputUrl: input.outputUrl} : {}),
        ...(input.errorMessage ? {errorMessage: input.errorMessage} : {}),
        ...(input.billable ? {billable: true} : {}),
        ...(typeof input.outputDurationSec === 'number' ? {outputDurationSec: input.outputDurationSec} : {}),
    ...(typeof input.sourceDurationSec === 'number' ? {sourceDurationSec: input.sourceDurationSec} : {}),
        ...(typeof input.sourceDurationSec === 'number' ? {sourceDurationSec: input.sourceDurationSec} : {}),
      }),
      signal: AbortSignal.timeout(env.CALLBACK_TIMEOUT_MS),
    });
    const text = await response.text().catch(() => '');
    let body: Record<string, unknown> | undefined;
    try { body = JSON.parse(text) as Record<string, unknown>; } catch { body = undefined; }
    return {code: response.status, body, ...(response.ok ? {} : {error: text.slice(0, 160)})};
  } catch (error) {
    return {code: 0, error: error instanceof Error ? error.message.slice(0, 160) : 'request failed'};
  }
}

function pushStatusOf(body?: Record<string, unknown>): string | undefined {
  const push = body?.push as {status?: unknown} | undefined;
  return typeof push?.status === 'string' ? push.status : undefined;
}

/** A new outbox record for an event, due now. The caller persists it (together with the job state it belongs to) BEFORE the first attempt. */
export function stageCallback(input: CreatorCallback, eventId: string): {eventId: string; record: CallbackDeliveryRecord} {
  const now = new Date().toISOString();
  const payload = {
    userId: input.userId,
    editJobId: input.editJobId,
    status: input.status,
    eventId,
    occurredAt: input.occurredAt ?? now,
    ...(input.type ? {type: input.type} : {}),
    ...(input.blueprintId ? {blueprintId: input.blueprintId} : {}),
    ...(input.outputUrl ? {outputUrl: input.outputUrl} : {}),
    ...(input.errorMessage ? {errorMessage: input.errorMessage} : {}),
    ...(input.billable ? {billable: true} : {}),
    ...(typeof input.outputDurationSec === 'number' ? {outputDurationSec: input.outputDurationSec} : {}),
    ...(typeof input.sourceDurationSec === 'number' ? {sourceDurationSec: input.sourceDurationSec} : {}),
  };
  return {eventId, record: {type: input.type ?? 'edit_done', status: 'pending', attempts: 0, lastCode: 0, firstAt: now, lastAt: now, nextAttemptAt: now, payload}};
}

/** Operator re-drive of an event that ended `exhausted` / `rejected`: pending again with a fresh attempt budget; the history (cycles, last error) stays. */
export function reopenCallback(record: CallbackDeliveryRecord): CallbackDeliveryRecord {
  return {...record, status: 'pending', attempts: 0, nextAttemptAt: new Date().toISOString(), cycles: (record.cycles ?? 0) + 1};
}

/**
 * Sends one completion event from its outbox record. Attempt 1 is awaited (unless `background`); the rest run in the background. The record is persisted after every attempt,
 * including the next due time, so a restart continues from the last persisted attempt count (an attempt whose acknowledgement was not recorded is simply sent again: the receiver
 * deduplicates by event id). Never throws and never changes any job state.
 */
export async function notifyCreatorEditDone(input: CreatorCallback, options: Options = {}): Promise<CallbackDeliveryRecord | null> {
  if (!env.CREATOR_API_URL.replace(/\/+$/, '')) {
    logger.info({editJobId: input.editJobId}, 'skip edit-done notify — CREATOR_API_URL unset');
    return null;
  }
  if (!env.ENGINE_API_KEY) {
    logger.warn({editJobId: input.editJobId}, 'skip edit-done notify — ENGINE_API_KEY unset');
    return null;
  }
  const staged = options.resume ?? stageCallback(input, input.eventId ?? callbackEventId(input));
  const eventId = staged.eventId;
  const record = staged.record;
  const event = {...input, ...(record.payload as Partial<CreatorCallback> | undefined), eventId, occurredAt: (record.payload?.occurredAt as string | undefined) ?? input.occurredAt ?? new Date().toISOString()} as CreatorCallback & {eventId: string; occurredAt: string};
  const maxAttempts = Math.max(1, Math.floor(env.CALLBACK_MAX_ATTEMPTS));
  if (active.has(eventId)) return {...record};
  active.add(eventId);
  const now = () => new Date().toISOString();
  const persist = async () => { await Promise.resolve(options.onRecord?.(eventId, {...record})); };

  const once = async (): Promise<boolean> => {
    record.attempts += 1;
    const result = await post(event);
    if (halted) return true; // stopped while the request was in flight: leave the persisted record exactly as it was
    record.lastCode = result.code;
    record.lastAt = now();
    delete record.lastError;
    if (result.error) record.lastError = result.error;
    const pushStatus = pushStatusOf(result.body);
    if (pushStatus) record.pushStatus = pushStatus;
    if (result.body?.duplicate === true) record.duplicate = true;
    if (typeof result.body?.ignored === 'string') record.ignored = result.body.ignored;
    const acknowledged = result.code >= 200 && result.code < 300;
    const pushIncomplete = acknowledged && (pushStatus === 'failed' || pushStatus === 'partial');
    if (acknowledged && !pushIncomplete) record.status = 'delivered';
    else if (acknowledged) record.status = 'pending'; // acknowledged, but the push did not complete: redeliver (bounded); the receiver re-attempts only the push
    else if (PERMANENT(result.code)) record.status = 'rejected';
    else record.status = 'pending';
    if (record.status === 'pending' && record.attempts >= maxAttempts) {
      // out of attempts: an acknowledged event stays `delivered` (the callback arrived; only the push is incomplete), an unacknowledged one is `exhausted`
      record.status = acknowledged ? 'delivered' : 'exhausted';
    }
    if (record.status === 'pending') record.nextAttemptAt = new Date(Date.now() + callbackBackoffMs(record.attempts)).toISOString();
    else delete record.nextAttemptAt;
    logger.info({editJobId: input.editJobId, eventId, attempt: record.attempts, code: result.code, status: record.status, pushStatus: record.pushStatus, cycles: record.cycles}, 'edit-done callback attempt');
    try { await persist(); } catch (error) { logger.warn({editJobId: input.editJobId, eventId, error}, 'callback record not saved'); }
    return record.status !== 'pending';
  };

  const loop = async (first: boolean): Promise<void> => {
    try {
      if (!first || record.attempts > 0) {
        const due = Date.parse(record.nextAttemptAt ?? '') || Date.now();
        if (!(await sleepMs(due - Date.now()))) return; // stopped
      }
      while (record.status === 'pending') {
        if (await once()) break;
        if (!(await sleepMs(callbackBackoffMs(record.attempts)))) return;
      }
      if (record.status === 'exhausted' || record.status === 'rejected') {
        logger.warn({editJobId: input.editJobId, eventId, attempts: record.attempts, lastCode: record.lastCode, final: record.status}, 'edit-done callback not delivered');
      }
    } finally {
      active.delete(eventId);
    }
  };

  if (options.background) {
    const task = loop(false).catch(error => logger.warn({editJobId: input.editJobId, eventId, error}, 'edit-done callback loop failed'));
    const tracked = task.finally(() => inFlight.delete(tracked));
    inFlight.add(tracked);
    return {...record};
  }
  // first attempt now (awaited), the rest in the background
  const firstDone = await once().catch(error => { logger.warn({editJobId: input.editJobId, eventId, error}, 'edit-done callback attempt failed'); return true; });
  if (firstDone) { active.delete(eventId); return {...record}; }
  const task = loop(false).catch(error => logger.warn({editJobId: input.editJobId, eventId, error}, 'edit-done callback loop failed'));
  const tracked = task.finally(() => inFlight.delete(tracked));
  inFlight.add(tracked);
  return {...record};
}
