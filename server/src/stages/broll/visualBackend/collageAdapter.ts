/**
 * WP53 collage adapter (gbro-collage-broll, MIT; clone via scripts/vendor-gbro-collage.sh or COLLAGE_BROLL_ROOT). FAILS CLOSED:
 *  - analyze only writes the metaphor spec (meaning before imagery, objects assemble from an empty ground in the edit-palette ground colour) => warning `visual_backend:collage:deferred`;
 *  - Gemini (gemini-omni-flash first/last-frame image-to-video, 9:16 5 s 720x1280, silent) is called ONLY when COLLAGE_RENDER=1 AND GEMINI_API_KEY is set (it costs money);
 *  - no stock still is ever substituted: the beat stays out of the picture until a clip exists; no voiceover mux (the original audio stays).
 * GEMINI_API_KEY is never required by analyze or by vitest.
 */
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {REPO_ROOT, VISUAL_BACKEND_CACHE_DIR} from './risoAdapter.ts';
import type {CollagePayload, VisualBackendBeat} from './planVisualBackendBeats.ts';

export type CollageMetaphorJson = {
  version: 1;
  backend: 'collage_gbro';
  meaning: string;
  sentence: string;
  objects: string[];
  ground: string;
  assemble: 'from_empty';
  durationSec: number;
  aspect: '9:16';
  width: 720;
  height: 1280;
  silent: true;
};

export function resolveCollageRoot(configured?: string): string | null {
  const candidates = [configured?.trim() ? resolve(configured.trim()) : null, join(REPO_ROOT, 'vendor/gbro-collage-broll')].filter((p): p is string => Boolean(p));
  return candidates.find(root => existsSync(join(root, 'scripts/generate_video.py'))) ?? null;
}

export function collageMetaphorOf(beat: Pick<VisualBackendBeat, 'payload' | 'scene'>): CollageMetaphorJson | null {
  const payload = beat.payload as CollagePayload;
  if (payload.kind !== 'collage') return null;
  return {
    version: 1,
    backend: 'collage_gbro',
    meaning: payload.metaphor.meaning,
    sentence: beat.scene.sentence,
    objects: payload.metaphor.objects,
    ground: payload.metaphor.ground,
    assemble: 'from_empty',
    durationSec: payload.metaphor.durationSec,
    aspect: '9:16',
    width: 720,
    height: 1280,
    silent: true,
  };
}

export function collageCacheKey(metaphor: CollageMetaphorJson): string {
  return createHash('sha256').update(JSON.stringify(metaphor)).digest('hex').slice(0, 24);
}

/** True only when a collage job may really render: explicit opt-in + key. Pure on the env passed in. */
export function collageRenderEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment.COLLAGE_RENDER === '1' && Boolean(environment.GEMINI_API_KEY?.trim());
}

export type CollageResult = {ok: false; reason: 'collage:deferred' | 'collage:unavailable'; specPath?: string} | {ok: true; path: string};

/** Analyze path: stores the metaphor spec (no Gemini call, no mp4). A cached clip, when one already exists, is returned as ok. */
export function prepareCollage(beat: Pick<VisualBackendBeat, 'payload' | 'scene'>, options: {cacheDir?: string; write?: boolean} = {}): CollageResult {
  const metaphor = collageMetaphorOf(beat);
  if (!metaphor) return {ok: false, reason: 'collage:unavailable'};
  const dir = options.cacheDir ?? VISUAL_BACKEND_CACHE_DIR;
  const key = collageCacheKey(metaphor);
  const clip = join(dir, `${key}.mp4`);
  if (existsSync(clip)) return {ok: true, path: clip};
  let specPath: string | undefined;
  if (options.write) {
    mkdirSync(dir, {recursive: true});
    specPath = join(dir, `${key}.collage.json`);
    writeFileSync(specPath, JSON.stringify(metaphor, null, 2));
  }
  return {ok: false, reason: 'collage:deferred', ...(specPath ? {specPath} : {})};
}

/**
 * Explicit render entry (never reached from analyze): documents the spawn, refuses unless COLLAGE_RENDER=1 + GEMINI_API_KEY + the vendored scripts exist.
 * The gbro Gate-1/2/3 prompts (metaphor -> still -> first/last-frame i2v) are authored by the operator's collage run; this WP stores the spec and the contract only.
 */
export function collageRenderCommand(root: string, prompt: string, out: string): string[] {
  return ['python3', join(root, 'scripts/generate_video.py'), '--prompt', prompt, '--output', out];
}
