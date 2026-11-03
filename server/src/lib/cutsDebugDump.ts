/**
 * WP7G: replayable dump of what the cuts-path Stage B saw and decided, so a real run can become an offline fixture without a paid re-run.
 * `buildCutsDebugDump` is pure; `writeCutsDebugDump` writes `<dir>/<blueprintId>.json` and never throws (a debug aid must not fail a job).
 * Default directory: <repo>/remotion/out/cuts-debug (override with CUTS_DEBUG_DIR).
 */
import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import type {TimeRange, WordToken} from '../types/blueprint.ts';

export type CutsDebugInput = {
  blueprintId: string;
  editProfile: string;
  sourceDurationSec: number;
  words: readonly WordToken[];
  trimExclusions: readonly TimeRange[];
  droppedTakes: number;
  restarts: number;
  echoes: number;
  captionWords: ReadonlyArray<{text: string}>;
  warnings?: readonly string[];
  /** WP7I: what the AI keep-plan returned and what the engine made of it. */
  aiKeepPlan?: {
    model: string;
    applied: boolean;
    skipped?: string;
    raw: string;
    normalizedKeep: ReadonlyArray<{start: number; end: number}>;
    exclusions: ReadonlyArray<{start: number; end: number}>;
  };
};

export function buildCutsDebugDump(input: CutsDebugInput) {
  return {
    blueprintId: input.blueprintId,
    editProfile: input.editProfile,
    sourceDurationSec: input.sourceDurationSec,
    counts: {droppedTakes: input.droppedTakes, restarts: input.restarts, echoes: input.echoes},
    warnings: [...(input.warnings ?? [])],
    words: input.words.map(word => ({text: word.text, start: word.start, end: word.end})),
    trimExclusions: input.trimExclusions.map(range => ({start: range.start, end: range.end})),
    captionTexts: input.captionWords.map(word => word.text),
    ...(input.aiKeepPlan ? {aiKeepPlan: input.aiKeepPlan} : {}),
  };
}

export function cutsDebugDir(override?: string): string {
  if (override) return override;
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'remotion', 'out', 'cuts-debug');
}

export function writeCutsDebugDump(input: CutsDebugInput, dir?: string): string | null {
  try {
    const target = cutsDebugDir(dir ?? process.env.CUTS_DEBUG_DIR);
    mkdirSync(target, {recursive: true});
    const file = join(target, `${input.blueprintId.replace(/[^\w.-]/g, '_')}.json`);
    writeFileSync(file, JSON.stringify(buildCutsDebugDump(input), null, 1));
    return file;
  } catch {
    return null;
  }
}
