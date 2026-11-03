/**
 * Offline proof that the pool resolver returns a pooled bed without spawning Python or touching Runware.
 *   cd server && MUSIC_SPECIALIST=dry POLISH_MUSIC_BED_URL= node --experimental-strip-types src/scripts/musicPoolProof.ts
 */
import {resolveBedSource} from '../stages/music/flags.ts';
import {resolveMusicBed} from '../stages/music/resolveMusicBed.ts';
import {awaitMusicPlan, startMusicPlan} from '../stages/music/musicSpecialist.ts';
import {toAudioDesign} from '../stages/music/toAudioDesign.ts';

if (process.env.MUSIC_SPECIALIST !== 'dry') throw new Error('run this proof with MUSIC_SPECIALIST=dry');
const plan = await awaitMusicPlan(startMusicPlan({
  transcript_segments: [],
  visual_cuts: [],
  emotional_tone: 'high-energy',
  canvas_sec: 30,
  video_id: 'proof-video-0001',
}));
const resolved = resolveMusicBed({
  licensed: null,
  generated: plan?.url ? {url: plan.url, bpm: plan.bpm, key: plan.musicalKey, seed: plan.seed, cacheKey: plan.cacheKey, integratedLufs: plan.integratedLufs, costUsd: plan.costUsd} : null,
  source: resolveBedSource(),
});
const design = toAudioDesign({resolved, mood: plan?.mood});
console.log(JSON.stringify({
  fromPool: plan?.fromPool ?? false,
  host: plan?.url ? new URL(plan.url).host : null,
  path: plan?.url ? new URL(plan.url).pathname : null,
  musicSource: design.musicSource ?? null,
  bpm: design.musicBpm ?? null,
  cacheKey: plan?.cacheKey ?? null,
}));
process.exit(0);
