/**
 * FULL_EDIT_RECOVERY_ENABLED only decides whether the boot path schedules recovery.
 * The durable job table stays available when the worker is off, and calling the worker
 * (the enabled path) still schedules the same three timers.
 */
import {afterEach, describe, expect, it, vi} from 'vitest';

import {startFullEditRecoveryWorker, stopFullEditRecoveryWorker} from './captionsEditRunner.ts';
import {createMemoryJobStore, getDurableJobStore, setDurableJobStoreForTests} from '../store/durableJobs.ts';
import type {CaptionsEditJob} from '../types/blueprint.ts';

const handles: NodeJS.Timeout[] = [];

afterEach(() => {
  stopFullEditRecoveryWorker();
  for (const handle of handles) {
    clearInterval(handle);
    clearTimeout(handle);
  }
  handles.length = 0;
  setDurableJobStoreForTests(undefined);
  vi.restoreAllMocks();
  vi.resetModules();
});

function job(): CaptionsEditJob {
  const now = new Date().toISOString();
  return {
    editJobId: 'edit_recovery_switch',
    userId: 'user_recovery_switch',
    status: 'awaiting_assets',
    progress: 0,
    sourceKey: 'src',
    sourcePublicUrl: 'https://cdn.example/src.mp4',
    languageCode: 'en',
    captionTemplate: 'bold',
    mode: 'full_edit',
    createdAt: now,
    updatedAt: now,
  };
}

describe('FULL_EDIT_RECOVERY_ENABLED', () => {
  it('defaults off, and only an explicit enabled value turns it on', async () => {
    const previous = process.env.FULL_EDIT_RECOVERY_ENABLED;
    try {
      delete process.env.FULL_EDIT_RECOVERY_ENABLED;
      vi.resetModules();
      expect((await import('../config/env.ts')).env.FULL_EDIT_RECOVERY_ENABLED).toBe(false);

      process.env.FULL_EDIT_RECOVERY_ENABLED = '0';
      vi.resetModules();
      expect((await import('../config/env.ts')).env.FULL_EDIT_RECOVERY_ENABLED).toBe(false);

      process.env.FULL_EDIT_RECOVERY_ENABLED = '1';
      vi.resetModules();
      expect((await import('../config/env.ts')).env.FULL_EDIT_RECOVERY_ENABLED).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.FULL_EDIT_RECOVERY_ENABLED;
      else process.env.FULL_EDIT_RECOVERY_ENABLED = previous;
    }
  });

  it('keeps durable job persistence available while the worker is not running', async () => {
    const store = createMemoryJobStore();
    setDurableJobStoreForTests(store);

    expect(getDurableJobStore()).toBe(store);
    const saved = job();
    await store.upsert(saved);

    const loaded = await getDurableJobStore()?.get(saved.editJobId);
    expect(loaded?.job).toMatchObject({editJobId: saved.editJobId, mode: 'full_edit', status: 'awaiting_assets'});
  });

  it('schedules the boot scan, the minute scan, and the daily purge when started', async () => {
    const store = createMemoryJobStore();
    const listRecoverable = vi.spyOn(store, 'listRecoverable').mockResolvedValue([]);
    const listPendingCallbacks = vi.spyOn(store, 'listPendingCallbacks').mockResolvedValue([]);
    const purge = vi.spyOn(store, 'purge').mockResolvedValue({expired: 0, deleted: 0});
    setDurableJobStoreForTests(store);

    const intervals: Array<{cb: () => void; ms: number}> = [];
    const timeouts: Array<{cb: () => void; ms: number}> = [];
    const realSetInterval = global.setInterval;
    const realSetTimeout = global.setTimeout;
    vi.spyOn(global, 'setInterval').mockImplementation(((cb: () => void, ms?: number) => {
      intervals.push({cb, ms: Number(ms)});
      const handle = realSetInterval(cb, 3_600_000);
      handles.push(handle);
      return handle;
    }) as typeof setInterval);
    vi.spyOn(global, 'setTimeout').mockImplementation(((cb: () => void, ms?: number) => {
      timeouts.push({cb, ms: Number(ms)});
      const handle = realSetTimeout(cb, 3_600_000);
      handles.push(handle);
      return handle;
    }) as typeof setTimeout);

    startFullEditRecoveryWorker();

    expect(intervals.map(timer => timer.ms).sort((a, b) => a - b)).toEqual([60_000, 86_400_000]);
    expect(timeouts.map(timer => timer.ms)).toEqual([5_000]);

    intervals.find(timer => timer.ms === 60_000)?.cb();
    await vi.waitFor(() => expect(listRecoverable).toHaveBeenCalledTimes(1));
    expect(listPendingCallbacks).toHaveBeenCalledTimes(1);
    expect(purge).not.toHaveBeenCalled();

    intervals.find(timer => timer.ms === 86_400_000)?.cb();
    await vi.waitFor(() => expect(purge).toHaveBeenCalledTimes(1));

    timeouts[0]?.cb();
    await vi.waitFor(() => expect(listRecoverable).toHaveBeenCalledTimes(2));
    expect(listPendingCallbacks).toHaveBeenCalledTimes(2);
    expect(getDurableJobStore()).toBe(store);
  });
});
