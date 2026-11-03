import {execFile} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {stageLogger} from '../../lib/logger.ts';
import {resolvePython} from './flags.ts';

const log = stageLogger('music');

export type OutputSegment = {sourceStart: number; sourceEnd: number; outputStart: number};

/** Maps output-timeline word intervals onto the (kept) source audio. Words outside every segment are dropped. */
export function mapWordsToSource(
  words: ReadonlyArray<{start: number; end: number}>,
  segments: ReadonlyArray<OutputSegment>,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const word of words) {
    const segment = segments.find(item => word.start >= item.outputStart - 1e-6 && word.start < item.outputStart + (item.sourceEnd - item.sourceStart));
    if (!segment) continue;
    const start = segment.sourceStart + (word.start - segment.outputStart);
    const end = Math.min(segment.sourceEnd, segment.sourceStart + (word.end - segment.outputStart));
    if (end > start) out.push([Math.round(start * 1000) / 1000, Math.round(end * 1000) / 1000]);
  }
  return out;
}

/**
 * Speech-gated integrated loudness (LUFS) of the creator audio, using only caption-word intervals.
 * Offline (pyloudnorm); never calls Runware. Null when it cannot be measured.
 */
export async function measureVoLufs(input: {
  audioPath: string;
  words: ReadonlyArray<{start: number; end: number}>;
  segments: ReadonlyArray<OutputSegment>;
  agentsDir: string;
}): Promise<number | null> {
  const intervals = mapWordsToSource(input.words, input.segments);
  if (intervals.length === 0) return null;
  const file = path.join(os.tmpdir(), `vo-intervals-${process.pid}-${Date.now()}.json`);
  try {
    await fs.writeFile(file, JSON.stringify(intervals));
    const python = resolvePython(input.agentsDir);
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(python.command, ['-m', 'music_specialist.vo_lufs', input.audioPath, file], {cwd: input.agentsDir, timeout: 60000, maxBuffer: 1 << 20}, (error, out) => {
        if (error) reject(error);
        else resolve(out);
      });
    });
    const parsed = JSON.parse(stdout) as {vo_lufs?: number | null};
    return typeof parsed.vo_lufs === 'number' && Number.isFinite(parsed.vo_lufs) ? parsed.vo_lufs : null;
  } catch (error) {
    log.warn({reason: error instanceof Error ? error.message.slice(0, 200) : 'measure'}, 'music.vo_measure_failed');
    return null;
  } finally {
    await fs.rm(file, {force: true});
  }
}
