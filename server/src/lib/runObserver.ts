/**
 * Optional, explicit run observation. Inert unless a caller wraps execution in `withObserver`: with no observer active,
 * `observe` does nothing and never even builds its event (events are passed as thunks). Nothing is enabled by a flag or by the
 * environment, so default production behaviour is unchanged.
 *
 * Production code reports FACTS about what it is actually doing (an HTTP attempt, an occupancy measurement it consumed, the pack it
 * built, the effective configuration it resolved, the blueprint it returned). An observer must not mutate or retain the objects it is
 * handed, and must never receive secrets: callers pass only URLs without their query string, never headers.
 */
import {AsyncLocalStorage} from 'node:async_hooks';

import {logger} from './logger.ts';

export type RunEvent = {type: string; [key: string]: unknown};
export type RunObserver = (event: RunEvent) => void;

const store = new AsyncLocalStorage<RunObserver>();

export function withObserver<T>(observer: RunObserver, fn: () => Promise<T>): Promise<T> {
  return store.run(observer, fn);
}

export function isObserved(): boolean {
  return store.getStore() !== undefined;
}

/** Report an event to the active observer, if any. An observer that throws never affects the pipeline. */
export function observe(event: () => RunEvent): void {
  const observer = store.getStore();
  if (!observer) {
    return;
  }
  try {
    observer(event());
  } catch (error) {
    logger.warn({error}, 'run observer threw; ignored');
  }
}
