/**
 * Upload the existing 2026-11-03 smoke bed into the `high-energy` mood pool. No generation, no Runware.
 *   cd server && node --experimental-strip-types src/scripts/seedMusicPool.ts
 */
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {uploadBed} from '../stages/music/uploadBed.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(here, '../../../remotion/out/music-smoke/bed.wav');
const CACHE_KEY = '108abbca07e0c08d977649dbd1d1d842c072e564986b495f627caf07bfb55a53';

const url = await uploadBed({
  filePath: file,
  cacheKey: CACHE_KEY,
  mood: 'high-energy',
  meta: {
    bpm: 128,
    key: 'A minor',
    seed: 1056912958,
    cost: 0.0075,
    integrated_lufs: -16,
    lufs: -16,
    duration_sec: 59.93,
    cache_key: CACHE_KEY,
    prompt_version: 2,
    model: 'runware:ace-step@v1.5-base',
    licence: 'ACE-Step v1.5 instrumental generated via Runware for this project (2026-11-03 smoke). Not a licensed stock cue.',
  },
});
console.log(JSON.stringify({uploaded: true, host: new URL(url).host, key: new URL(url).pathname}));
process.exit(0);
