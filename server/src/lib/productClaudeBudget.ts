/**
 * WP1: per-edit Claude spend bound for the product path. Pure: the Anthropic call, the price and the cost function are injected, so nothing here imports the logger,
 * `.env` or an SDK. It REUSES `claudeBudget.ts` (synchronous reservation, conservative maximum, request cap, shared stop); there is no second budget system.
 *
 * Semantics (all inherited from claudeBudget.ts, stated here for the product path):
 *  - a reservation is taken before every call, including repairs: retries are calls, so they are counted and bounded;
 *  - the product path has no HTTP-level spend guard, so it cannot see whether a request left the process. Every call that reaches `generate` is therefore treated as
 *    dispatched: if it fails, the full reservation stays counted as spent (never released). Only a refusal before `generate` costs nothing;
 *  - a missing/invalid price or cap refuses the call before dispatch (`unknown_cost`); a refusal or a cap reached stops every later call of this edit;
 *  - the record holds counts, token usage, cost and refusal reasons only: no prompts, no model output, no keys.
 * It bounds what THIS process starts, in the engine's own price units. It is not a guarantee about the provider's bill.
 */
import {createClaudeBudget, createMeteredGenerator} from './claudeBudget.ts';

export type BoundedGeneratorConfig = {capUsd: number; maxRequests: number; maxTokensPerCall: number; minTokensPerCall: number};

export function createBoundedClaudeGenerator<Req extends {system: string; user: string}, Res>(input: {
  config: BoundedGeneratorConfig;
  /** USD per token, from the engine's price table for the model in use; null/invalid fails closed. */
  price: {input: number; output: number} | null;
  /** The real call. Receives the output-token ceiling the reservation allows. */
  generate: (request: Req, maxTokens: number) => Promise<Res>;
  /** Reported cost of a finished call (may throw: the whole reservation is then charged). */
  costOf: (result: Res) => number;
  describe: (result: Res) => Record<string, unknown>;
}) {
  let stoppedBy: string | null = null;
  let attempted = 0;
  const calls: Array<Record<string, unknown>> = [];
  const price = input.price && Number.isFinite(input.price.input) && Number.isFinite(input.price.output) ? input.price : null;
  const budget = createClaudeBudget({
    capUsd: input.config.capUsd,
    maxRequests: input.config.maxRequests,
    outputUsdPerToken: price ? price.output : Number.NaN, // unknown price -> every reservation is refused as unknown_cost
    maxTokensPerCall: input.config.maxTokensPerCall,
    minTokensPerCall: input.config.minTokensPerCall,
    isStopped: () => stoppedBy !== null,
    stop: reason => {
      stoppedBy ??= reason;
    },
  });
  const generator = createMeteredGenerator<Req, Res>({
    budget,
    calls,
    dispatchedCount: () => attempted,
    // ~3.2 characters per token, doubled: an upper bound on input cost, deliberately pessimistic.
    inputUsdUpperOf: request => Math.ceil((request.system.length + request.user.length) / 3.2) * (price ? price.input : Number.NaN) * 2,
    generate: (request, maxTokens) => {
      attempted += 1; // counted BEFORE the call: if it throws we cannot prove nothing was sent
      return input.generate(request, maxTokens);
    },
    costOf: input.costOf,
    describe: input.describe,
  });
  return {
    generator,
    stoppedBy: () => stoppedBy,
    report: () => ({...budget.report(), stoppedBy, attempted, calls: calls.map(call => ({...call}))}),
  };
}
