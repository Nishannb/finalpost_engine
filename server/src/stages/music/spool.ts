import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export type SpoolMeta = {
  cacheKey: string;
  mood: string;
  dry: boolean;
  /** The `meta` object `uploadBed` takes. */
  meta: Record<string, unknown>;
};

export type SpoolEntry = SpoolMeta & {dir: string; filePath: string};

export type SpoolUpload = (entry: SpoolEntry) => Promise<unknown>;

export function spoolDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = (env.MUSIC_SPOOL_DIR ?? '').trim();
  if (configured) return path.resolve(configured);
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '../../../../agents/music_specialist/spool');
}

const safeKey = (cacheKey: string) => cacheKey.replace(/[^A-Za-z0-9._-]/g, '_');

/** Copies the wav and meta.json into a temp dir, then renames it into place, so a kill never leaves a half entry. */
export async function writeSpool(input: {
  dir: string;
  cacheKey: string;
  filePath: string;
  meta: Omit<SpoolMeta, 'cacheKey'>;
}): Promise<string> {
  const final = path.join(input.dir, safeKey(input.cacheKey));
  const tmp = path.join(input.dir, `.tmp-${safeKey(input.cacheKey)}-${process.pid}-${Date.now()}`);
  await fs.mkdir(tmp, {recursive: true});
  try {
    await fs.copyFile(input.filePath, path.join(tmp, 'bed.wav'));
    const body: SpoolMeta = {...input.meta, cacheKey: input.cacheKey};
    await fs.writeFile(path.join(tmp, 'meta.json'), JSON.stringify(body));
    await fs.rm(final, {recursive: true, force: true});
    await fs.rename(tmp, final);
  } catch (error) {
    await fs.rm(tmp, {recursive: true, force: true}).catch(() => undefined);
    throw error;
  }
  return final;
}

export async function listSpool(dir: string): Promise<SpoolEntry[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const entries: SpoolEntry[] = [];
  for (const name of names.sort()) {
    if (name.startsWith('.tmp-')) continue;
    const entryDir = path.join(dir, name);
    const filePath = path.join(entryDir, 'bed.wav');
    try {
      await fs.access(filePath);
      const parsed = JSON.parse(await fs.readFile(path.join(entryDir, 'meta.json'), 'utf8')) as Partial<SpoolMeta>;
      if (!parsed || typeof parsed.cacheKey !== 'string' || !parsed.cacheKey) continue;
      entries.push({
        cacheKey: parsed.cacheKey,
        mood: typeof parsed.mood === 'string' ? parsed.mood : 'neutral',
        dry: Boolean(parsed.dry),
        meta: parsed.meta && typeof parsed.meta === 'object' ? parsed.meta : {},
        dir: entryDir,
        filePath,
      });
    } catch {
      continue;
    }
  }
  return entries;
}

export async function removeSpool(dir: string, cacheKey: string): Promise<void> {
  await fs.rm(path.join(dir, safeKey(cacheKey)), {recursive: true, force: true});
}

/** Uploads each complete entry; removes it only after `upload` resolves. Returns the number flushed. */
export async function flushSpool(input: {dir: string; upload: SpoolUpload}): Promise<number> {
  let count = 0;
  for (const entry of await listSpool(input.dir)) {
    try {
      await input.upload(entry);
      await removeSpool(input.dir, entry.cacheKey);
      count += 1;
    } catch {
      // Leave the entry for the next flush.
    }
  }
  return count;
}
