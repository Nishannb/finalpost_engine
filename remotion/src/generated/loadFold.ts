/**
 * WP4L: loading generated graphics must never cancel the render. Pure (no Remotion, no React): the fetch, the evaluation and the loader are injected, so every rule here is testable without
 * a network or a browser.
 *
 *  - a module that fails to fetch, fails its sha256 check, or fails to evaluate is SKIPPED (a hash mismatch is never evaluated or rendered);
 *  - the modules that loaded are still used; if every module fails the result is simply empty;
 *  - nothing here throws for a load failure: failures come back as data so the caller can warn.
 */

/** WP4M: a module load (fetch, hash check, evaluation) that has not settled within this many milliseconds is skipped like a failed one. */
export const GRAPHIC_FETCH_TIMEOUT_MS = 10_000;

export type LoadFailure = {sha256: string; url: string; reason: string};

export const describeLoadError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** sha256 of `text` as lower-case hex (Web Crypto, available in the browser and in Node). */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Fetch a module's code, check its sha256 BEFORE anything is evaluated, evaluate it and return its default export (a function). Throws on a bad response, a hash mismatch (the code is never
 * evaluated), an evaluation error, or a missing default export.
 */
export async function fetchVerifyEvaluate<C>(
  deps: {fetchText: (url: string) => Promise<string>; evaluate: (code: string, sha256: string) => unknown},
  url: string,
  sha256: string,
): Promise<C> {
  const code = await deps.fetchText(url);
  const actual = await sha256Hex(code);
  if (actual !== sha256) {
    throw new Error(`Generated graphic hash mismatch for ${url}: expected ${sha256}, got ${actual}`);
  }
  const component = deps.evaluate(code, sha256);
  if (typeof component !== 'function') {
    throw new Error(`Generated graphic ${url} has no default export component`);
  }
  return component as C;
}

/** Folds settled loads into the map of components that loaded (keyed by sha256) and the list of skipped modules. */
export function foldGraphicLoads<C>(
  settled: ReadonlyArray<{sha256: string; url: string; result: PromiseSettledResult<C>}>,
): {components: Record<string, C>; failures: LoadFailure[]} {
  const components: Record<string, C> = {};
  const failures: LoadFailure[] = [];
  for (const item of settled) {
    if (item.result.status === 'fulfilled') components[item.sha256] = item.result.value;
    else failures.push({sha256: item.sha256, url: item.url, reason: describeLoadError(item.result.reason)});
  }
  return {components, failures};
}

/**
 * Rejects with a timeout error if `promise` has not settled within `timeoutMs`; otherwise settles as `promise` does. The timer is always cleared, and a late result of the original promise
 * (after a timeout) is swallowed so it cannot surface as an unhandled rejection. A non-finite or non-positive `timeoutMs` means no timeout.
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms`)), timeoutMs);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Loads every module with `load` (a thrown error, a rejection, a synchronous throw, or no answer within `timeoutMs` all count as a failure) and folds the results. Never rejects and never
 * waits longer than `timeoutMs` for any one module. `timeoutMs` defaults to `GRAPHIC_FETCH_TIMEOUT_MS`; tests pass a few milliseconds.
 */
export async function settleGraphicLoads<C>(
  graphics: ReadonlyArray<{module: {url: string; sha256: string}}>,
  load: (url: string, sha256: string) => Promise<C>,
  options: {timeoutMs?: number} = {},
): Promise<{components: Record<string, C>; failures: LoadFailure[]}> {
  const timeoutMs = options.timeoutMs ?? GRAPHIC_FETCH_TIMEOUT_MS;
  const settled = await Promise.all(
    graphics.map(async graphic => {
      const {url, sha256} = graphic.module;
      const result: PromiseSettledResult<C> = await withTimeout((async () => load(url, sha256))(), timeoutMs, `Generated graphic ${url}`).then(
        value => ({status: 'fulfilled', value}) as const,
        reason => ({status: 'rejected', reason}) as const,
      );
      return {sha256, url, result};
    }),
  );
  return foldGraphicLoads(settled);
}

/** The graphics whose component loaded. While loading (`components` null) every graphic is kept, as before. */
export function graphicsWithComponents<G extends {module: {sha256: string}}>(graphics: readonly G[], components: Record<string, unknown> | null): G[] {
  return components ? graphics.filter(graphic => components[graphic.module.sha256]) : [...graphics];
}
