/**
 * The RVM process slot: at most `limit` python/RVM processes run at once in this process (default MATTING_MAX_CONCURRENT = 1).
 *
 * ONE shared instance (`rvmSlots`) is used by the matting job runner (POST /v1/matting/jobs, which waits for its turn and stays `queued`) and by the
 * analyze-side person matte (media/personMatte.ts, which waits a bounded time and then skips with reason `busy` so an analyze never hangs behind a long job).
 * `createRvmSlots` makes an independent instance (tests, and runners built with their own concurrency).
 */
import {env} from '../config/env.ts';

export type RvmSlots = {
  /** Resolves with a release function once a slot is free. With `waitMs`, resolves null when no slot freed up in time (the waiter is removed; nothing leaks). */
  acquire: (options?: {waitMs?: number}) => Promise<(() => void) | null>;
  stats: () => {active: number; waiting: number};
};

export function createRvmSlots(limit: () => number): RvmSlots {
  let active = 0;
  const waiting: Array<() => void> = [];
  const cap = () => Math.max(1, Math.floor(limit()) || 1);

  const take = (): (() => void) => {
    active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active -= 1;
      waiting.shift()?.();
    };
  };

  return {
    async acquire(options = {}) {
      if (active < cap() && waiting.length === 0) return take();
      return new Promise<(() => void) | null>(resolve => {
        let timer: NodeJS.Timeout | undefined;
        const wake = () => {
          if (active < cap()) {
            if (timer) clearTimeout(timer);
            resolve(take());
          } else {
            waiting.unshift(wake); // lost the race: keep the place in line and keep the timeout armed
          }
        };
        waiting.push(wake);
        if (options.waitMs !== undefined) {
          timer = setTimeout(() => {
            const at = waiting.indexOf(wake);
            if (at >= 0) {
              waiting.splice(at, 1);
              resolve(null);
            }
          }, Math.max(0, options.waitMs));
          timer.unref();
        }
      });
    },
    stats: () => ({active, waiting: waiting.length}),
  };
}

/** The process-wide slot shared by the matting job runner and the analyze person matte. */
export const rvmSlots: RvmSlots = createRvmSlots(() => env.MATTING_MAX_CONCURRENT);
