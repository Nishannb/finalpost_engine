/**
 * Phase 5.25 (Subject Stage): decode a person-cutout's ALPHA on a small source-aspect grid, every frame (the libvpx-vp9 decoder: the native one drops WebM alpha; alphaextract before the
 * scale). The result feeds `compositionMatte` (stages/kinetic/matteMap.ts), which maps it into the composition through the keep segments, the cover crop and the zooms. Same command as the
 * Kinetic V2 matte stage's private decoder (kept separate so the Kinetic V2 pipeline is untouched). Never throws: null when it cannot be decoded.
 */
import {spawn} from 'node:child_process';

import {env} from '../config/env.ts';
import type {SourceAlphaFrames} from '../stages/kinetic/matteMap.ts';

export const ALPHA_GRID_LONG_SIDE = 128;

export function decodeMatteAlphaGrid(matte: string, srcW: number, srcH: number, timeoutMs = 180_000): Promise<SourceAlphaFrames | null> {
  const long = ALPHA_GRID_LONG_SIDE;
  const cols = srcW >= srcH ? long : Math.max(8, Math.round((long * srcW) / srcH));
  const rows = srcW >= srcH ? Math.max(8, Math.round((long * srcH) / srcW)) : long;
  return new Promise(resolve => {
    const chunks: Buffer[] = [];
    let done = false;
    const finish = (v: SourceAlphaFrames | null) => { if (!done) { done = true; resolve(v); } };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(env.FFMPEG_PATH, ['-v', 'error', '-c:v', 'libvpx-vp9', '-i', matte, '-vf', `alphaextract,scale=${cols}:${rows}:flags=area,format=gray`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], {stdio: ['ignore', 'pipe', 'ignore']});
    } catch {
      finish(null);
      return;
    }
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(null); }, timeoutMs);
    child.stdout?.on('data', d => chunks.push(d as Buffer));
    child.on('error', () => { clearTimeout(timer); finish(null); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return finish(null);
      const buf = Buffer.concat(chunks);
      const per = cols * rows;
      const frames: Uint8Array[] = [];
      for (let i = 0; i + per <= buf.length; i += per) frames.push(new Uint8Array(buf.subarray(i, i + per)));
      finish(frames.length > 0 ? {cols, rows, frames} : null);
    });
  });
}
