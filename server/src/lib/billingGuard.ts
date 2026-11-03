/**
 * Terminal billing failures (HTTP 402, "credits depleted") during an AI-directed run.
 *
 * The pipeline is built to degrade: a failed Gemini call falls back to a deterministic plan. For production that is right. For an experiment that is
 * meant to measure the AI Director it is wrong: a deterministic plan must never be labelled an AI edit. So an opt-in run (`strictAiDirection`) executes inside
 * a guard that records every terminal billing signal, and the pipeline checks it at stage boundaries and stops with the exact blocker.
 *
 * Signals are collected at the one place every failed provider call passes: the `EngineError` constructor (see errors.ts), plus the Claude worker's failure
 * reasons. Outside a guard nothing is recorded and nothing changes.
 */

import {AsyncLocalStorage} from 'node:async_hooks';

export type BillingBlock = {provider: 'gemini' | 'anthropic' | 'unknown'; status?: number; detail: string; at: string};

const store = new AsyncLocalStorage<{blocks: BillingBlock[]}>();

/** Text that marks a billing/credit failure even when the status is not 402 (a 429/403/400 carrying the provider's own wording). */
const BILLING_TEXT = /prepayment credits? (are )?depleted|credits? (are )?(depleted|exhausted)|credit balance is too low|insufficient (credits|funds|balance)|billing (account )?(is )?(not (active|enabled)|disabled)|payment required|exceeded your current quota.*billing/i;

export function looksLikeBillingFailure(status: number | undefined, text: string): boolean {
  return status === 402 || BILLING_TEXT.test(text);
}

export function runWithBillingGuard<T>(fn: () => Promise<T>): Promise<T> {
  return store.run({blocks: []}, fn);
}

/**
 * True inside a strict AI-direction run. Strict runs never auto-repeat a paid call: a caller that would retry or fail over after a TIMEOUT (a request that may
 * already be billed) must check this and give up instead. Outside a strict run behaviour is unchanged.
 */
export function inStrictRun(): boolean {
  return store.getStore() !== undefined;
}

export function noteBillingFailure(provider: BillingBlock['provider'], status: number | undefined, text: string): void {
  const guard = store.getStore();
  if (!guard || !looksLikeBillingFailure(status, text)) {
    return;
  }
  guard.blocks.push({provider, ...(status !== undefined ? {status} : {}), detail: text.replace(/\s+/g, ' ').slice(0, 240), at: new Date().toISOString()});
}

/** The first recorded billing block of the current guarded run, or null (also null outside a guard). */
export function currentBillingBlock(): BillingBlock | null {
  return store.getStore()?.blocks[0] ?? null;
}
