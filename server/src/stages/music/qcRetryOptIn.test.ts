/**
 * Phase 1.7.3: the production server never authorises the Music Specialist's paid QC retry. Runtime check on the real code path:
 * startMusicPlan -> runMusicPlan (production default deps) -> spawnMusic -> child stdin, with only node:child_process replaced by a fake child that
 * records the payload. No Python, no network, no R2 (r2Configured false), no files written (the fake agent returns no bed).
 */
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';

import {afterEach, describe, expect, it, vi} from 'vitest';

type Sent = {args: string[]; payload: Record<string, unknown>};

async function load() {
  vi.resetModules();
  const sent: Sent[] = [];
  vi.doMock('node:child_process', () => ({
    spawn: (_command: string, args: string[]) => {
      const child = new EventEmitter() as EventEmitter & {stdout: PassThrough; stderr: PassThrough; stdin: PassThrough; kill: () => void};
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.kill = () => undefined;
      let raw = '';
      child.stdin.on('data', chunk => (raw += String(chunk)));
      child.stdin.on('end', () => {
        sent.push({args, payload: JSON.parse(raw)});
        // A plan answer, then (dry/live) a result with no bed: the job falls back without writing anything.
        child.stdout.end(JSON.stringify({cache_key: 'k'.repeat(64), seed: 3, bpm: 80, key: 'D minor', prompt_version: 4, estimated_cost_usd: 0.0075, mood: 'calm'}));
        setImmediate(() => child.emit('close', 0));
      });
      return child;
    },
  }));
  vi.doMock('../../storage/r2.ts', () => ({r2Configured: () => false, sourceObjectExists: async () => false, uploadPublicFile: async () => { throw new Error('no uploads in this test'); }}));
  const music = await import('./musicSpecialist.ts');
  return {music, sent};
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock('node:child_process');
  vi.doUnmock('../../storage/r2.ts');
});

describe('Phase 1.7.3: the server never opts in to the paid QC retry', () => {
  it('the production entry (startMusicPlan, default dependencies) sends allow_qc_retry: false on every agent invocation', async () => {
    const {music, sent} = await load();
    vi.stubEnv('MUSIC_SPECIALIST', 'dry');
    vi.stubEnv('MUSIC_BED_SOURCE', 'auto');
    vi.stubEnv('POLISH_MUSIC_BED_URL', '');
    vi.stubEnv('MUSIC_BED_FRESH', '0');
    vi.stubEnv('MUSIC_SPECIALIST_MAX_USD', '0.02');
    // A job object carrying a forged opt-in (as any caller could pass at runtime) is still sent with the retry disabled.
    const forged = {transcript_segments: [], visual_cuts: [{at_ms: 1000}], emotional_tone: 'calm', canvas_sec: 30, video_id: 'video-1', include_sfx: true, allow_qc_retry: true};
    await music.startMusicPlan(forged as never);
    expect(sent.map(item => item.args.at(-1))).toEqual(['plan', 'dry']);
    for (const item of sent) {
      expect(item.payload.allow_qc_retry).toBe(false);
      expect(item.payload.max_usd).toBe(0.02); // the global cap is unchanged
    }
    expect(sent[0]!.payload.include_sfx).toBe(true); // SFX settings pass through untouched
  });

  it('spawnMusic forces allow_qc_retry: false for every mode and every truthy forged value', async () => {
    const {music, sent} = await load();
    for (const requested of ['plan', 'dry', 'live'] as const) {
      for (const forgedValue of [true, 'true', 1, {yes: true}]) {
        await music.spawnMusic(requested, {transcript_segments: [], visual_cuts: [], emotional_tone: 'calm', canvas_sec: 10, video_id: 'v', allow_qc_retry: forgedValue} as never, {env: {}});
      }
    }
    expect(sent).toHaveLength(12);
    expect(sent.every(item => item.payload.allow_qc_retry === false)).toBe(true);
  });

  it('no production module mentions allow_qc_retry except the forced false in spawnMusic', async () => {
    // Runtime proof is above; this only guards against a second, unforced writer of agent payloads appearing later.
    const {readdirSync, readFileSync, statSync} = await import('node:fs');
    const path = await import('node:path');
    const root = path.resolve(import.meta.dirname, '../..');
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (full.endsWith('.ts') && !full.endsWith('.test.ts') && readFileSync(full, 'utf8').includes('allow_qc_retry')) hits.push(path.relative(root, full));
      }
    };
    walk(root);
    expect(hits).toEqual([path.join('stages', 'music', 'musicSpecialist.ts')]);
  });
});
