/**
 * Phase 2.1 D: write the final blueprint to out/blueprints/{videoId}.json so a human can re-render it for free
 * (`npm run render-blueprint`). Pure disk I/O: no network, no LLM, no Runware.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import type {TimelineBlueprint} from '../../types/blueprint.ts';

export type SavedBlueprintEnvelope = {
  videoId: string;
  sourceVideoPath: string | null;
  voLufs: number | null;
  savedAt: string;
  blueprint: TimelineBlueprint;
};

/** Repo root (the directory that holds server/ and remotion/). */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

export function blueprintsDir(root: string = REPO_ROOT): string {
  return path.join(root, 'out', 'blueprints');
}

/** Atomic write (tmp + rename). `root` is injectable so tests never touch the real out/. Returns the final path. */
export async function saveBlueprintForReplay(envelope: SavedBlueprintEnvelope, root: string = REPO_ROOT): Promise<string> {
  if (!/^[A-Za-z0-9_-]+$/.test(envelope.videoId)) throw new Error('invalid videoId');
  const dir = blueprintsDir(root);
  await fs.mkdir(dir, {recursive: true});
  const finalPath = path.join(dir, `${envelope.videoId}.json`);
  const tmpPath = `${finalPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(tmpPath, JSON.stringify(envelope, null, 2));
    await fs.rename(tmpPath, finalPath);
  } catch (error) {
    await fs.unlink(tmpPath).catch(() => undefined);
    throw error;
  }
  return finalPath;
}
