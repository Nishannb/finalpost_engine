/**
 * Spend guard for a single, capped, AI-directed experiment. Wraps `fetch` (install it as `globalThis.fetch` BEFORE the pipeline runs) and enforces, per run:
 *   - per-host request caps (a runaway loop cannot keep paying),
 *   - NO automatic repeat of a paid request: a second request with an identical JSON body is refused, whether it is an HTTP retry, an SDK retry or a model
 *     fallback (a fallback model gets the same body at another URL). Refused calls are recorded, never sent,
 *   - a Gemini spend cap from the usage each response reports (one call's cost cannot be known beforehand, so a cap can be overshot by at most one call),
 *   - a hard stop after any billing signal (HTTP 402 or billing wording): nothing further is sent. The Gemini spend cap is one of those signals: when a response's
 *     usage brings Gemini to its cap, that response is accounted and returned, and from then on NOTHING is sent to ANY host (Gemini, Claude, Groq alike). A caller
 *     that meters another provider (the runner's Claude generator) calls `stop(reason)` when that provider reaches its own cap. The stop is terminal for the life of
 *     this guard instance (one instance per run; a new run builds a new guard).
 * Every decision is recorded in `report()`. Nothing is sent that the guard does not forward; the guard itself never calls a provider.
 */

import {createHash} from 'node:crypto';

import {looksLikeBillingFailure} from './billingGuard.ts';

export type SpendGuardOptions = {
  fetchImpl: typeof fetch;
  geminiCapUsd: number;
  /**
   * Phase 36E: when true, loopback is no longer a blanket pass-through: only the ports registered with `allowLoopbackPort` are forwarded, so a local proxy that
   * relays to a provider cannot be reached through this guard. Default false (unchanged behaviour).
   */
  restrictLoopback?: boolean;
  /** Maximum forwarded requests per host (hosts not listed are refused). */
  maxRequestsPerHost: Record<string, number>;
  /** Engine's own Gemini estimate (USD per million tokens); thinking tokens count as output. */
  geminiUsdPerMInput?: number;
  geminiUsdPerMOutput?: number;
};

export type SpendEvent = {at: string; host: string; path: string; decision: 'forwarded' | 'refused'; reason?: string; status?: number};

export class SpendGuardError extends Error {
  readonly code: 'repeat_refused' | 'host_cap' | 'host_not_allowed' | 'gemini_cap' | 'billing_stop' | 'loopback_not_allowed';
  constructor(code: SpendGuardError['code'], message: string) {
    super(message);
    this.name = 'SpendGuardError';
    this.code = code;
  }
}

export function createSpendGuard(options: SpendGuardOptions) {
  const rateIn = options.geminiUsdPerMInput ?? 0.075;
  const rateOut = options.geminiUsdPerMOutput ?? 0.3;
  const events: SpendEvent[] = [];
  const perHost = new Map<string, number>();
  const seenBodies = new Set<string>();
  let geminiUsd = 0;
  let billingStop: string | null = null;
  const loopbackPorts = new Set<number>();
  const usage = {promptTokens: 0, outputTokens: 0};

  /** Terminal, shared by every host. Keeps the first reason. */
  const stop = (reason: string) => {
    billingStop ??= reason;
  };

  const guarded = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
    const host = url.hostname;
    const note = (decision: SpendEvent['decision'], reason?: string, status?: number) => events.push({at: new Date().toISOString(), host, path: url.pathname, decision, ...(reason ? {reason} : {}), ...(status !== undefined ? {status} : {})});
    const refuse = (code: SpendGuardError['code'], message: string): never => {
      note('refused', code);
      throw new SpendGuardError(code, message);
    };
    // Local servers (the experiment serves the source video from this process) are not providers.
    if (host === '127.0.0.1' || host === 'localhost') {
      if (options.restrictLoopback) {
        const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
        if (!loopbackPorts.has(port)) {
          refuse('loopback_not_allowed', `spend guard: loopback port ${port} is not a registered local service for this run`);
        }
      }
      return options.fetchImpl(input as never, init);
    }
    if (billingStop) {
      refuse('billing_stop', `spend guard: billing/spend stop (${billingStop}); no further requests are sent to any provider`);
    }
    const cap = options.maxRequestsPerHost[host];
    if (cap === undefined) {
      refuse('host_not_allowed', `spend guard: ${host} is not an allowed host for this run`);
    }
    if ((perHost.get(host) ?? 0) >= cap!) {
      refuse('host_cap', `spend guard: request cap (${cap}) for ${host} reached`);
    }
    if (host === 'generativelanguage.googleapis.com' && geminiUsd >= options.geminiCapUsd) {
      refuse('gemini_cap', `spend guard: Gemini spend $${geminiUsd.toFixed(4)} reached the $${options.geminiCapUsd.toFixed(2)} cap`);
    }
    if (typeof init?.body === 'string') {
      const key = createHash('sha256').update(init.body).digest('hex');
      if (seenBodies.has(key)) {
        refuse('repeat_refused', `spend guard: an identical request body was already sent (retry or model fallback); not repeating a paid request`);
      }
      seenBodies.add(key);
    }
    perHost.set(host, (perHost.get(host) ?? 0) + 1);
    let response: Response;
    try {
      response = await options.fetchImpl(input as never, init);
    } catch (error) {
      note('forwarded', `network_error:${error instanceof Error ? error.message.slice(0, 80) : 'unknown'}`);
      throw error;
    }
    note('forwarded', undefined, response.status);
    if (!response.ok) {
      const text = await response.clone().text().catch(() => '');
      if (looksLikeBillingFailure(response.status, text)) {
        billingStop = `${host} HTTP ${response.status}`;
      }
    } else if (host === 'generativelanguage.googleapis.com') {
      const body = (await response.clone().json().catch(() => null)) as {usageMetadata?: {promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number}} | null;
      const prompt = body?.usageMetadata?.promptTokenCount ?? 0;
      const output = (body?.usageMetadata?.candidatesTokenCount ?? 0) + (body?.usageMetadata?.thoughtsTokenCount ?? 0);
      usage.promptTokens += prompt;
      usage.outputTokens += output;
      geminiUsd += (prompt / 1e6) * rateIn + (output / 1e6) * rateOut;
      if (geminiUsd >= options.geminiCapUsd) {
        stop(`generativelanguage.googleapis.com spend cap reached ($${geminiUsd.toFixed(4)} of $${options.geminiCapUsd.toFixed(2)} estimated)`);
      }
    }
    return response;
  };

  return {
    fetch: guarded as typeof fetch,
    /** Terminal stop for every host (used by the runner when its Claude meter reaches the Claude cap). */
    stop,
    /** Register the one local service (the runner's own video server) that loopback requests may reach when `restrictLoopback` is on. */
    allowLoopbackPort: (port: number) => {
      loopbackPorts.add(port);
    },
    /** True once any billing or spend stop is in effect (terminal). */
    isStopped: () => billingStop !== null,
    report: () => ({
      geminiUsd: Math.round(geminiUsd * 1e6) / 1e6,
      geminiCapUsd: options.geminiCapUsd,
      geminiTokens: {...usage},
      requestsPerHost: Object.fromEntries(perHost),
      billingStop,
      refused: events.filter(event => event.decision === 'refused'),
      events,
    }),
  };
}
