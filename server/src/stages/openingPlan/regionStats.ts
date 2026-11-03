/**
 * Luminance statistics of the actual footage inside a frame-relative box, at one moment. The legibility check measures text against THIS, not against a
 * global palette average: a white wall behind one corner and a dark jacket behind another are different problems.
 */

import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

import {env} from '../../config/env.ts';
import type {RegionStats} from './colorRoles.ts';

const exec = promisify(execFile);
const GRID = 24;

const channel = (v: number) => {
  const n = v / 255;
  return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
};

/** Stats from an rgb24 buffer (any size; pixels = length / 3). Exported for tests. */
export function statsFromRgb(buffer: Uint8Array): RegionStats {
  const count = Math.floor(buffer.length / 3);
  if (count === 0) {
    return {p10: 0.35, p50: 0.35, p90: 0.35, meanRgb: {r: 90, g: 90, b: 90}, spread: 0};
  }
  const lums = new Float64Array(count);
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < count; i++) {
    const pr = buffer[i * 3]!;
    const pg = buffer[i * 3 + 1]!;
    const pb = buffer[i * 3 + 2]!;
    r += pr;
    g += pg;
    b += pb;
    lums[i] = 0.2126 * channel(pr) + 0.7152 * channel(pg) + 0.0722 * channel(pb);
  }
  const sorted = Array.from(lums).sort((x, y) => x - y);
  const at = (q: number) => sorted[Math.min(count - 1, Math.max(0, Math.round(q * (count - 1))))]!;
  const mean = sorted.reduce((sum, v) => sum + v, 0) / count;
  const spread = Math.sqrt(sorted.reduce((sum, v) => sum + (v - mean) ** 2, 0) / count);
  return {p10: at(0.1), p50: at(0.5), p90: at(0.9), meanRgb: {r: r / count, g: g / count, b: b / count}, spread};
}

export async function sampleRegionStats(videoPath: string, atSec: number, box: {x: number; y: number; w: number; h: number}): Promise<RegionStats> {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const x = clamp(box.x);
  const y = clamp(box.y);
  const w = Math.min(1 - x, Math.max(0.01, box.w));
  const h = Math.min(1 - y, Math.max(0.01, box.h));
  const {stdout} = await exec(
    env.FFMPEG_PATH,
    ['-hide_banner', '-loglevel', 'error', '-ss', Math.max(0, atSec).toFixed(2), '-i', videoPath, '-frames:v', '1', '-vf', `crop=iw*${w}:ih*${h}:iw*${x}:ih*${y},scale=${GRID}:${GRID}:flags=area,format=rgb24`, '-f', 'rawvideo', '-'],
    {encoding: 'buffer', maxBuffer: 4 * 1024 * 1024, timeout: 30_000},
  );
  return statsFromRgb(stdout);
}

/** The worst case over several moments: the box has to read at every one of them. */
export function worstOf(all: RegionStats[]): RegionStats {
  if (all.length === 0) {
    return statsFromRgb(new Uint8Array(0));
  }
  return {
    p10: Math.min(...all.map(s => s.p10)),
    p50: all.reduce((sum, s) => sum + s.p50, 0) / all.length,
    p90: Math.max(...all.map(s => s.p90)),
    meanRgb: {r: all.reduce((s, x) => s + x.meanRgb.r, 0) / all.length, g: all.reduce((s, x) => s + x.meanRgb.g, 0) / all.length, b: all.reduce((s, x) => s + x.meanRgb.b, 0) / all.length},
    spread: Math.max(...all.map(s => s.spread)),
  };
}
