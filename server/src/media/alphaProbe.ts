/**
 * Mean alpha (0..1) of a transparent WebM, sampled ~1 frame per second. Used as the sanity gate for the chroma-keyed cutout: an (almost) empty or (almost) opaque alpha means the key did not find the person.
 *
 * ffmpeg's native `vp9` decoder ignores WebM alpha, so the file is read with the `libvpx-vp9` decoder. Returns null when it cannot be measured (ffmpeg missing, timeout, unparsable): the caller then
 * falls back to the size check alone. Never throws.
 */
import {spawn} from 'node:child_process';

import {env} from '../config/env.ts';

export function parseMeanAlpha(output: string): number | null {
  const values = [...output.matchAll(/lavfi\.signalstats\.YAVG=([\d.]+)/g)].map(m => Number(m[1])).filter(Number.isFinite);
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length / 255;
}

export function probeMeanAlpha(filePath: string, timeoutMs = 60_000): Promise<number | null> {
  return new Promise(resolve => {
    const args = ['-hide_banner', '-v', 'error', '-c:v', 'libvpx-vp9', '-i', filePath, '-vf', 'fps=1,alphaextract,signalstats,metadata=mode=print:file=-', '-an', '-f', 'null', '-'];
    const child = spawn(env.FFMPEG_PATH, args, {stdio: ['ignore', 'pipe', 'ignore']});
    let out = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', chunk => {
      out = (out + String(chunk)).slice(-200_000);
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve(code === 0 ? parseMeanAlpha(out) : null);
    });
  });
}
