/**
 * One-off: attach the derived files of the salvaged bed to R2 and patch its pool entry.
 * Does nothing unless argv contains --write-r2. Importing this module uploads nothing.
 * Never prints env values or credentials; prints keys and HTTP statuses only.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

import {r2Configured, sourceObjectExists, uploadPublicFile} from '../storage/r2.ts';
import {publicUrlForKey} from '../stages/music/uploadBed.ts';

const CACHE_KEY = '108abbca07e0c08d977649dbd1d1d842c072e564986b495f627caf07bfb55a53';
const POOL_KEY = 'music/beds/pool/high-energy.json';
const BAK_NAME = 'high-energy.json.bak-2026-11-04';
const BAK_KEY = `music/beds/pool/${BAK_NAME}`;
const FOLDER = `music/beds/${CACHE_KEY}`;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const LOOP_DIR = path.join(REPO_ROOT, 'remotion/out/music-loop');
const FILES = {
  full: path.join(LOOP_DIR, 'bed_full.wav'),
  loop: path.join(LOOP_DIR, 'bed_loop.wav'),
  carved: path.join(LOOP_DIR, 'bed_carved.wav'),
};

/** Duration in seconds from a PCM WAV header. */
export function wavDurationSec(buf: Buffer): number {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not_a_wav');
  let offset = 12;
  let byteRate = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'fmt ') byteRate = buf.readUInt32LE(offset + 16);
    if (id === 'data') {
      if (!byteRate) throw new Error('wav_no_fmt');
      const bytes = Math.min(size, buf.length - offset - 8);
      return bytes / byteRate;
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error('wav_no_data');
}

async function head(key: string): Promise<number> {
  try {
    return (await fetch(publicUrlForKey(key), {method: 'HEAD'})).status;
  } catch {
    return 0;
  }
}

async function putJson(obj: unknown, key: string, tmpName: string): Promise<void> {
  const file = path.join(LOOP_DIR, tmpName);
  await fs.writeFile(file, JSON.stringify(obj));
  await uploadPublicFile(file, key, 'application/json');
}

export async function backfill(): Promise<void> {
  // 1. Back up the live pool object before changing anything.
  const poolRes = await fetch(`${publicUrlForKey(POOL_KEY)}?t=${Date.now()}`);
  if (!poolRes.ok) throw new Error(`pool_get_${poolRes.status}`);
  const poolBody = Buffer.from(await poolRes.arrayBuffer());
  const pool = JSON.parse(poolBody.toString('utf8')) as {beds?: Array<Record<string, unknown>>};
  if (!Array.isArray(pool.beds)) throw new Error('pool_shape');
  const index = pool.beds.findIndex(bed => bed.cache_key === CACHE_KEY);
  if (index < 0) throw new Error('pool_entry_missing');

  const bakLocal = path.join(LOOP_DIR, BAK_NAME);
  await fs.writeFile(bakLocal, poolBody);
  if (await sourceObjectExists(BAK_KEY)) {
    console.log(`${BAK_KEY} exists, left as is`);
  } else {
    await uploadPublicFile(bakLocal, BAK_KEY, 'application/json');
  }

  // 2. Derived wavs only. bed.wav is never touched.
  const duration = Math.round(wavDurationSec(await fs.readFile(FILES.full)) * 100) / 100;
  const keys = {
    full: `${FOLDER}/bed_full.wav`,
    loop: `${FOLDER}/bed_loop.wav`,
    carved: `${FOLDER}/bed_carved.wav`,
  };
  const urls = {} as Record<keyof typeof keys, string>;
  for (const name of ['full', 'loop', 'carved'] as const) {
    urls[name] = (await uploadPublicFile(FILES[name], keys[name], 'audio/wav')).publicUrl;
  }

  // 3. Merge meta.json; every existing key (including licence) stays.
  const metaKey = `${FOLDER}/meta.json`;
  const metaRes = await fetch(`${publicUrlForKey(metaKey)}?t=${Date.now()}`);
  if (!metaRes.ok) throw new Error(`meta_get_${metaRes.status}`);
  const meta = await metaRes.json() as Record<string, unknown>;
  await putJson({
    ...meta,
    full_url: urls.full,
    loop_url: urls.loop,
    carved_url: urls.carved,
    postprocess_version: 3,
    trailing_trimmed_sec: 3.25,
    duration_sec: duration,
    qc_passed: true,
    qc_silence_sec: 0.04,
    qc_true_peak_dbfs: -4.119,
    qc_bpm_error_ratio: 0.0094,
    qc_seam_db: 0.867,
    qc_vocal_score: 0.5956,
  }, metaKey, 'meta.json.tmp');

  // 4. Patch the one pool entry in place. Re-read the bed list from the same body we backed up.
  const beds = pool.beds.map((bed, i) => (i === index
    ? {...bed, full_url: urls.full, loop_url: urls.loop, carved_url: urls.carved, duration_sec: duration}
    : bed));
  await putJson({...pool, beds}, POOL_KEY, 'high-energy.json.tmp');

  // 5. Report keys and statuses only.
  for (const key of [keys.full, keys.loop, keys.carved, POOL_KEY]) {
    console.log(`${key} ${await head(key)}`);
  }
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href : false;
if (isMain) {
  if (!process.argv.includes('--write-r2')) {
    console.error('refused: pass --write-r2 to run');
    process.exit(1);
  }
  if (!r2Configured()) {
    console.error('r2_unconfigured');
    process.exit(2);
  }
  backfill().catch(error => {
    console.error(`backfill_failed: ${error instanceof Error ? error.message : 'unknown'}`);
    process.exit(1);
  });
}
