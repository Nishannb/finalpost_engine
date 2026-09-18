/**
 * Minimal KV abstraction for blueprints, render jobs, quotas and rate limits.
 *
 * Memory is the default so local dev and single-instance deploys need no extra
 * service; pointing REDIS_URL at the existing Kinmel Redis makes the same data
 * survive restarts and shard across instances.
 */

import {env} from '../config/env.ts';
import {logger} from '../lib/logger.ts';

export type Kv = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, ttlSec?: number) => Promise<void>;
  del: (key: string) => Promise<void>;
  /** Returns the value after increment; sets the TTL on first write only. */
  increment: (key: string, by: number, ttlSec: number) => Promise<number>;
  kind: 'memory' | 'redis';
};

function createMemoryKv(): Kv {
  const entries = new Map<string, {value: string; expiresAt: number}>();

  const alive = (key: string): string | null => {
    const entry = entries.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt > 0 && entry.expiresAt <= Date.now()) {
      entries.delete(key);
      return null;
    }
    return entry.value;
  };

  // Bounded sweep so a long-lived process cannot leak expired blueprints.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of entries) {
      if (entry.expiresAt > 0 && entry.expiresAt <= now) {
        entries.delete(key);
      }
    }
  }, 60_000);
  sweep.unref();

  return {
    kind: 'memory',
    get: async key => alive(key),
    set: async (key, value, ttlSec) => {
      entries.set(key, {
        value,
        expiresAt: ttlSec && ttlSec > 0 ? Date.now() + ttlSec * 1000 : 0,
      });
    },
    del: async key => {
      entries.delete(key);
    },
    increment: async (key, by, ttlSec) => {
      const current = Number(alive(key) ?? 0);
      const next = current + by;
      const existing = entries.get(key);
      entries.set(key, {
        value: String(next),
        expiresAt: existing?.expiresAt || Date.now() + ttlSec * 1000,
      });
      return next;
    },
  };
}

async function createRedisKv(url: string): Promise<Kv> {
  const {createClient} = await import('redis');
  const client = createClient({url});
  client.on('error', error => logger.error({error}, 'redis error'));
  await client.connect();
  logger.info('kv store: redis');

  return {
    kind: 'redis',
    get: key => client.get(key) as Promise<string | null>,
    set: async (key, value, ttlSec) => {
      if (ttlSec && ttlSec > 0) {
        await client.set(key, value, {EX: Math.round(ttlSec)});
        return;
      }
      await client.set(key, value);
    },
    del: async key => {
      await client.del(key);
    },
    increment: async (key, by, ttlSec) => {
      const next = await client.incrBy(key, by);
      if (next === by) {
        await client.expire(key, Math.round(ttlSec));
      }
      return next;
    },
  };
}

let instance: Kv | null = null;

export async function getKv(): Promise<Kv> {
  if (instance) {
    return instance;
  }
  if (env.REDIS_URL) {
    try {
      instance = await createRedisKv(env.REDIS_URL);
      return instance;
    } catch (error) {
      logger.error({error}, 'redis unavailable; falling back to memory kv');
    }
  }
  logger.info('kv store: memory');
  instance = createMemoryKv();
  return instance;
}
