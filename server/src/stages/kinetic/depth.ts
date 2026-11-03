/**
 * S4: DepthProvider. Default SubjectBandDepth: inside the matte = near, outside = far, "pocket" = the band between (text sits there when behind).
 * Occlusion is answered from the real alpha grid when the pipeline decoded one, else from a bbox silhouette model (head ellipse + torso). No torch, no weights.
 * Optional DepthAnything adapter: only when DEPTH_MODEL_PATH is set; it is loaded by dynamic import and is a typed stub in this repo.
 */
import type {Box, ShotScene} from './scene.ts';
import {boxAt} from './scene.ts';

export interface DepthProvider {
  readonly id: string;
  readonly version: string;
  /** fraction (0..1) of `rect` (normalised) that the subject covers at `frame` */
  occlusion(scene: ShotScene, rect: Box, frame: number): number;
}

const N = 14; // sampling lattice per axis

function gridCovered(scene: ShotScene, x: number, y: number, frame: number, cache: {bytes: Uint8Array; cols: number; rows: number}): boolean {
  const cx = Math.min(cache.cols - 1, Math.max(0, Math.floor(x * cache.cols)));
  const cy = Math.min(cache.rows - 1, Math.max(0, Math.floor(y * cache.rows)));
  return cache.bytes[cy * cache.cols + cx]! > 127;
}

const decoded = new WeakMap<object, Array<{frame: number; bytes: Uint8Array}>>();
function samplesOf(scene: ShotScene): Array<{frame: number; bytes: Uint8Array}> {
  const grid = scene.grid!;
  let d = decoded.get(grid);
  if (!d) {
    d = grid.samples.map(s => ({frame: s.frame, bytes: Uint8Array.from(Buffer.from(s.bits, 'base64'))})).sort((a, b) => a.frame - b.frame);
    decoded.set(grid, d);
  }
  return d;
}

/** Silhouette model inside a subject box: head ellipse in the upper third + a torso block below the neck. */
export function inSilhouette(b: Box, px: number, py: number): boolean {
  const hx = b.x + b.w / 2, hy = b.y + 0.14 * b.h, rx = 0.2 * b.w, ry = 0.13 * b.h;
  if (((px - hx) / rx) ** 2 + ((py - hy) / ry) ** 2 <= 1) return true;
  return px >= b.x + 0.1 * b.w && px <= b.x + 0.9 * b.w && py >= b.y + 0.27 * b.h && py <= b.y + b.h;
}

export class SubjectBandDepth implements DepthProvider {
  readonly id = 'subject-band';
  readonly version = '1';
  occlusion(scene: ShotScene, rect: Box, frame: number): number {
    if (scene.noMatte || rect.w <= 0 || rect.h <= 0) return 0;
    let hit = 0;
    const samples = scene.grid ? samplesOf(scene) : [];
    let cache: {bytes: Uint8Array; cols: number; rows: number} | null = null;
    if (scene.grid && samples.length) {
      let best = samples[0]!;
      for (const s of samples) if (Math.abs(s.frame - frame) < Math.abs(best.frame - frame)) best = s;
      cache = {bytes: best.bytes, cols: scene.grid.cols, rows: scene.grid.rows};
    }
    const box = boxAt(scene, frame);
    for (let j = 0; j < N; j += 1) {
      for (let i = 0; i < N; i += 1) {
        const px = rect.x + ((i + 0.5) / N) * rect.w;
        const py = rect.y + ((j + 0.5) / N) * rect.h;
        if (px < 0 || px > 1 || py < 0 || py > 1) continue;
        if (cache ? gridCovered(scene, px, py, frame, cache) : inSilhouette(box, px, py)) hit += 1;
      }
    }
    return hit / (N * N);
  }
}

/** Optional adapter (DEPTH_MODEL_PATH): never imported by default; typed stub. */
export async function loadDepthProvider(): Promise<DepthProvider> {
  if (process.env.DEPTH_MODEL_PATH) {
    throw new Error('DepthAnything adapter is a stub in this repo (no torch import); unset DEPTH_MODEL_PATH to use subject-band depth');
  }
  return new SubjectBandDepth();
}
