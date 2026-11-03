/**
 * Phase 36C: Claude request/spend budget for one capped experiment, safe under concurrent callers.
 *
 * ACCOUNTING SEMANTICS (the only guarantees this module makes):
 *  - `reserve()` is SYNCHRONOUS. JavaScript runs it to completion before any other callback, so the check "is there room?" and the update "take that room" can
 *    never interleave: two overlapping callers cannot both be granted the same last slot or the same remaining dollars. No lock is involved.
 *  - A reservation holds a conservative MAXIMUM cost for one call (estimated input upper bound + max_tokens x output price) and one request slot.
 *    `available = cap - committed - reserved`; a call whose maximum does not fit gets a smaller max_tokens, and below the minimum it is refused.
 *  - `commit(actual)` replaces the reservation by the reported cost. `fail({dispatched:false})` releases it (the request provably never left the process).
 *    `fail({dispatched:true})` (timeout, abort, network or provider error after dispatch) KEEPS the full reservation as spent, because a request the provider
 *    accepted may be billed and its usage is invisible to us. A request slot is never returned once dispatched.
 *  - Price, token or cap values that are missing/non-finite/non-positive refuse the call before dispatch (`unknown_cost`).
 *  - Any refusal and any commit that reaches the cap call `stop(reason)`, the shared terminal stop. `isStopped()` is also honoured, so a 402 or cap hit on
 *    another provider blocks the next reservation.
 *
 * WHAT THIS IS NOT: a monetary guarantee against the provider's bill. It bounds what THIS process will start, in the engine's own price units. A request
 * already accepted by the provider when a stop fires still completes and bills (nothing here cancels charges). Rates are engine assumptions, and the SDK's own
 * retries are visible only through the spend guard's request counter (same-body retries are refused there).
 */

export type BudgetRefusalReason = 'stopped' | 'request_cap' | 'unknown_cost' | 'budget_exhausted';

export type Reservation = {readonly id: number; readonly maxTokens: number; readonly reservedUsd: number; readonly inputUsd: number};

export type ReserveResult = {ok: true; reservation: Reservation} | {ok: false; reason: BudgetRefusalReason; detail: string};

export type ClaudeBudgetOptions = {
  capUsd: number;
  maxRequests: number;
  outputUsdPerToken: number;
  maxTokensPerCall: number;
  minTokensPerCall: number;
  isStopped: () => boolean;
  stop: (reason: string) => void;
};

const positive = (value: number) => Number.isFinite(value) && value > 0;

export function createClaudeBudget(options: ClaudeBudgetOptions) {
  let requests = 0;
  let committedUsd = 0;
  let reservedUsd = 0;
  let nextId = 0;
  const open = new Map<number, Reservation>();
  const refusals: Array<{reason: BudgetRefusalReason; detail: string}> = [];

  const refuse = (reason: BudgetRefusalReason, detail: string): ReserveResult => {
    refusals.push({reason, detail});
    if (reason !== 'stopped') options.stop(`anthropic budget refused a request (${reason}: ${detail})`);
    return {ok: false, reason, detail};
  };
  const money = (x: number) => x.toFixed(4);

  const settle = (reservation: Reservation): boolean => {
    if (!open.has(reservation.id)) return false; // already settled: idempotent
    open.delete(reservation.id);
    reservedUsd -= reservation.reservedUsd;
    return true;
  };

  return {
    reserve(inputUsdUpper: number): ReserveResult {
      if (options.isStopped()) return refuse('stopped', 'a billing or spend stop is already in effect');
      if (!positive(options.capUsd) || !positive(options.outputUsdPerToken) || !positive(options.maxTokensPerCall) || !Number.isFinite(inputUsdUpper) || inputUsdUpper < 0) {
        return refuse('unknown_cost', 'a price, token estimate or cap is missing or not a positive finite number');
      }
      if (requests >= options.maxRequests) return refuse('request_cap', `request cap ${options.maxRequests} reached`);
      const available = options.capUsd - committedUsd - reservedUsd;
      const tokens = Math.min(options.maxTokensPerCall, Math.floor((available - inputUsdUpper) / options.outputUsdPerToken));
      if (!(tokens >= options.minTokensPerCall)) {
        return refuse('budget_exhausted', `only $${money(Math.max(0, available))} of $${money(options.capUsd)} is unreserved; a call needs at least ${options.minTokensPerCall} output tokens plus its input`);
      }
      requests += 1;
      nextId += 1;
      const reservation: Reservation = {id: nextId, maxTokens: tokens, inputUsd: inputUsdUpper, reservedUsd: inputUsdUpper + tokens * options.outputUsdPerToken};
      reservedUsd += reservation.reservedUsd;
      open.set(reservation.id, reservation);
      return {ok: true, reservation};
    },
    /** The call returned. A non-finite reported cost is treated as the full reservation (fail closed). */
    commit(reservation: Reservation, actualUsd: number): void {
      if (!settle(reservation)) return;
      committedUsd += Number.isFinite(actualUsd) && actualUsd >= 0 ? actualUsd : reservation.reservedUsd;
      if (committedUsd >= options.capUsd) options.stop(`anthropic spend cap reached ($${money(committedUsd)} of $${money(options.capUsd)} estimated)`);
    },
    fail(reservation: Reservation, outcome: {dispatched: boolean}): void {
      if (!settle(reservation)) return;
      if (outcome.dispatched) {
        committedUsd += reservation.reservedUsd; // possibly billed, usage unknown: count the maximum
        if (committedUsd >= options.capUsd) options.stop(`anthropic spend cap reached ($${money(committedUsd)} of $${money(options.capUsd)} estimated)`);
      } else {
        requests -= 1; // never left the process: give the slot back
      }
    },
    report: () => ({capUsd: options.capUsd, maxRequests: options.maxRequests, requests, committedUsd, reservedUsd, openReservations: open.size, refusals: [...refusals]}),
  };
}

export type ClaudeBudget = ReturnType<typeof createClaudeBudget>;

export type MeteredCallRecord = Record<string, unknown>;

/**
 * Wraps a Claude generator so every call goes through the budget. Calls are also SERIALISED (a promise queue): each call reserves only after the previous one
 * has settled, so the reservation uses real spend instead of a worst case for every overlapping call. Correctness does not depend on the queue; the
 * synchronous `reserve()` above is what bounds concurrent callers.
 */
export function createMeteredGenerator<Request, Result>(input: {
  budget: ClaudeBudget;
  /** Requests that have actually been forwarded to the Anthropic host so far (the spend guard's counter). */
  dispatchedCount: () => number;
  inputUsdUpperOf: (request: Request) => number;
  generate: (request: Request, maxTokens: number) => Promise<Result>;
  costOf: (result: Result) => number;
  describe: (result: Result) => MeteredCallRecord;
  calls: MeteredCallRecord[];
}): (request: Request) => Promise<Result> {
  let tail: Promise<unknown> = Promise.resolve();
  const one = async (request: Request): Promise<Result> => {
    const reserved = input.budget.reserve(input.inputUsdUpperOf(request));
    if (!reserved.ok) {
      input.calls.push({refused: true, reason: reserved.reason, detail: reserved.detail});
      throw new Error(`spend cap: refusing a Claude call (${reserved.reason}: ${reserved.detail})`);
    }
    const {reservation} = reserved;
    const before = input.dispatchedCount();
    const started = Date.now();
    let result: Result;
    try {
      result = await input.generate(request, reservation.maxTokens);
    } catch (error) {
      input.budget.fail(reservation, {dispatched: input.dispatchedCount() > before});
      input.calls.push({failed: true, maxTokensAllowed: reservation.maxTokens, dispatched: input.dispatchedCount() > before, ms: Date.now() - started});
      throw error;
    }
    let cost: number;
    try {
      cost = input.costOf(result);
    } catch {
      cost = Number.NaN; // unpriced or malformed usage: commit() charges the full reservation
    }
    input.budget.commit(reservation, cost);
    input.calls.push({...input.describe(result), costUsd: Number.isFinite(cost) ? cost : null, maxTokensAllowed: reservation.maxTokens, ms: Date.now() - started, cumulativeUsd: Math.round(input.budget.report().committedUsd * 1e6) / 1e6});
    return result;
  };
  return request => {
    const run = tail.then(() => one(request));
    tail = run.then(() => undefined, () => undefined);
    return run;
  };
}
