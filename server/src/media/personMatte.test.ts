/**
 * Person matte (RVM) plumbing: the shared process slot (bounded wait, no leaked waiters), cache eviction (oldest-first, LRU touch, keep-key, stale partials), and that the matting job runner really uses an
 * injected shared slot. No python, no network, no model: the spawn and the KV are stubs.
 */
import {mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it, vi} from 'vitest';

vi.mock('../store/kv.ts', () => {
  const data = new Map<string, string>();
  const kv = {kind: 'memory' as const, get: async (k: string) => data.get(k) ?? null, set: async (k: string, v: string) => void data.set(k, v), del: async (k: string) => void data.delete(k), increment: async (k: string, by: number) => {
    const n = Number(data.get(k) ?? 0) + by;
    data.set(k, String(n));
    return n;
  }};
  return {getKv: async () => kv};
});

import {createMattingRunner} from '../pipeline/mattingRunner.ts';
import {evictPersonMatteCache, extractSubjectMatte, type MatteReport} from './personMatte.ts';
import {createRvmSlots, rvmSlots} from './rvmSlot.ts';
import type {RunPython} from './rvmMatte.ts';

const GOOD: MatteReport = {frames: 100, segmented_frames: 40, fps: 25, width: 720, height: 1280, detected_ratio: 1, mean_area: 0.5, box: null, seconds: 1, model: 'rvm_mobilenetv3', ranges: [[1, 2]]};
/** every temp dir this file makes, removed in afterAll */
const made: string[] = [];
const tmp = (prefix: string) => {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  made.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of made) rmSync(dir, {recursive: true, force: true});
});
const until = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise(r => setTimeout(r, 5));
  }
};

describe('rvmSlots (the shared process slot)', () => {
  it('a bounded wait gives up with null when the slot stays busy, and leaves no waiter behind', async () => {
    const slots = createRvmSlots(() => 1);
    const release = (await slots.acquire())!;
    const started = Date.now();
    expect(await slots.acquire({waitMs: 40})).toBeNull();
    expect(Date.now() - started).toBeGreaterThanOrEqual(30);
    expect(slots.stats()).toEqual({active: 1, waiting: 0});
    release();
    const again = await slots.acquire({waitMs: 40});
    expect(again).not.toBeNull();
    again!();
    expect(slots.stats()).toEqual({active: 0, waiting: 0});
  });

  it('waiters get the slot in order; an unbounded wait resumes when it is released; release is idempotent', async () => {
    const slots = createRvmSlots(() => 1);
    const first = (await slots.acquire())!;
    const order: string[] = [];
    const a = slots.acquire().then(r => (order.push('a'), r!));
    const b = slots.acquire({waitMs: 5000}).then(r => (order.push('b'), r!));
    await until(() => slots.stats().waiting === 2);
    first();
    first(); // a second release must not free a second slot
    const releaseA = await a;
    expect(slots.stats()).toEqual({active: 1, waiting: 1});
    releaseA();
    (await b)();
    expect(order).toEqual(['a', 'b']);
    expect(slots.stats()).toEqual({active: 0, waiting: 0});
  });

  it('the limit is read live (MATTING_MAX_CONCURRENT=2 admits two at once)', async () => {
    let limit = 1;
    const slots = createRvmSlots(() => limit);
    const r1 = (await slots.acquire())!;
    expect(await slots.acquire({waitMs: 10})).toBeNull();
    limit = 2;
    const r2 = await slots.acquire({waitMs: 10});
    expect(r2).not.toBeNull();
    r1();
    r2!();
  });
});

describe('evictPersonMatteCache', () => {
  const entry = (dir: string, key: string, bytes: number, ageSec: number) => {
    for (const ext of ['webm', 'json']) {
      const file = path.join(dir, `${key}.${ext}`);
      writeFileSync(file, Buffer.alloc(bytes / 2, 1));
      const t = new Date(Date.now() - ageSec * 1000);
      utimesSync(file, t, t);
    }
  };

  it('removes the oldest entries first until under the cap, never the keep key, and does nothing when under it', async () => {
    const dir = tmp('pm-evict-');
    entry(dir, 'oldest', 1000, 400);
    entry(dir, 'older', 1000, 300);
    entry(dir, 'newer', 1000, 200);
    entry(dir, 'keepme', 1000, 500); // the OLDEST by mtime, but protected
    expect((await evictPersonMatteCache(dir, 10_000)).removedEntries).toBe(0);
    const out = await evictPersonMatteCache(dir, 2500, 'keepme');
    expect(out.removedEntries).toBe(2);
    expect(out.freedBytes).toBe(2000);
    expect(readdirSync(dir).map(n => n.split('.')[0]).filter((v, i, a) => a.indexOf(v) === i).sort()).toEqual(['keepme', 'newer']);
  });

  it('drops a stale .partial.webm of a killed run but keeps a fresh one; a missing dir never throws', async () => {
    const dir = tmp('pm-evict-');
    writeFileSync(path.join(dir, 'dead.partial.webm'), 'x');
    utimesSync(path.join(dir, 'dead.partial.webm'), new Date(Date.now() - 7_200_000), new Date(Date.now() - 7_200_000));
    writeFileSync(path.join(dir, 'live.partial.webm'), 'x');
    await evictPersonMatteCache(dir, 1_000_000);
    expect(readdirSync(dir)).toEqual(['live.partial.webm']);
    await expect(evictPersonMatteCache(path.join(dir, 'nope'), 1)).resolves.toMatchObject({removedEntries: 0});
  });

  it('extract evicts after a new write and a cache HIT makes the entry the newest (LRU)', async () => {
    const dir = tmp('pm-lru-');
    const src = path.join(dir, 'src.mp4');
    writeFileSync(src, Buffer.alloc(4096, 3));
    const cacheDir = path.join(dir, 'cache');
    const runner: RunPython = async (_c, args) => {
      writeFileSync(args[3]!, Buffer.alloc(1000, 1));
      writeFileSync(args[4]!, JSON.stringify(GOOD));
      return {code: 0, stderr: '', timedOut: false};
    };
    const base = {python: '/fake/python', runner, cacheDir, maxSide: 640, quality: 'fast' as const, inputPath: src};
    const keyFiles = () => readdirSync(cacheDir).map(n => n.split('.')[0]!).filter((v, i, a) => a.indexOf(v) === i);
    await extractSubjectMatte({...base, outputPath: path.join(dir, 'a.webm'), ranges: [[1, 2]], cacheMaxBytes: 1_000_000});
    await extractSubjectMatte({...base, outputPath: path.join(dir, 'b.webm'), ranges: [[3, 4]], cacheMaxBytes: 1_000_000});
    expect(keyFiles().length).toBe(2);
    // age both, then HIT range [1,2] so it becomes the newest
    for (const n of readdirSync(cacheDir)) utimesSync(path.join(cacheDir, n), new Date(Date.now() - 100_000), new Date(Date.now() - 100_000));
    const hit = await extractSubjectMatte({...base, outputPath: path.join(dir, 'a2.webm'), ranges: [[1, 2]], cacheMaxBytes: 1_000_000});
    expect(hit?.cached).toBe(true);
    // a third entry with a cap that fits only two entries (each ~1000 + the report) evicts the entry that was NOT just used: [3,4]
    await extractSubjectMatte({...base, outputPath: path.join(dir, 'c.webm'), ranges: [[5, 6]], cacheMaxBytes: 2 * (1000 + JSON.stringify(GOOD).length) + 100});
    expect(keyFiles().length).toBe(2);
    const survivors = await Promise.all([[1, 2], [3, 4]].map(r => extractSubjectMatte({...base, outputPath: path.join(dir, `s${r[0]}.webm`), ranges: [r as [number, number]], cacheMaxBytes: 1e9}).then(x => x?.cached)));
    expect(survivors).toEqual([true, false]); // [1,2] survived (recently used); [3,4] was evicted (and is re-made here)
  });
});

describe('the matting job runner shares the RVM slot', () => {
  it('a job stays queued while another holder has the shared slot, and runs when it is released', async () => {
    const slots = createRvmSlots(() => 1);
    const held = (await slots.acquire())!; // e.g. an analyze-side person matte is running
    const runPython: RunPython = async (_c, args) => {
      writeFileSync(args[3]!, 'w');
      writeFileSync(args[4]!, JSON.stringify({ok: true, frames_encoded: 3, width: 2, height: 2, fps: 25, duration_sec: 0.1, device: 'cpu'}));
      return {code: 0, stderr: '', timedOut: false};
    };
    const runner = createMattingRunner({
      slots,
      config: {python: '/fake/python', heartbeatMs: 50, progressThrottleMs: 0},
      deps: {
        available: async () => undefined,
        download: async (_u, dest) => (writeFileSync(dest, 'v'), {path: dest, bytes: 1}),
        probe: async () => ({codec: 'h264', width: 720, height: 1280, durationSec: 5, fps: 25}),
        runPython,
        upload: async (_f, key) => ({publicUrl: `https://cdn.example/${key}`, key}),
      },
    });
    const job = await runner.start({userId: 'u', videoUrl: 'https://cdn.example/s.mp4', quality: 'fast', outputFormat: 'transparent', useCache: true});
    await new Promise(r => setTimeout(r, 120));
    expect((await runner.getForUser(job.jobId, 'u')).status).toBe('queued');
    expect(slots.stats()).toEqual({active: 1, waiting: 1});
    held();
    await runner.settled(job.jobId);
    expect((await runner.getForUser(job.jobId, 'u')).status).toBe('done');
  });

  it('the process-wide slot object exists and starts free', () => {
    expect(rvmSlots.stats()).toEqual({active: 0, waiting: 0});
  });
});
