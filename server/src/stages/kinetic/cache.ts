/** Stage cache under `.cache/kinetic/<jobHash>/`: one JSON per stage, keyed by the content hash of that stage's inputs. A rerun recomputes only the stages whose key changed. */
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

export const sha256 = (v: unknown): string => createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');

export function fileSha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(file).on('data', d => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}

export class StageCache {
  readonly dir: string;
  readonly hits: Record<string, boolean> = {};
  constructor(dir: string) {
    this.dir = dir;
  }
  file(stage: string): string {
    return path.join(this.dir, `${stage}.json`);
  }
  async run<T>(stage: string, keyParts: unknown, compute: () => Promise<T>, cacheable: (v: T) => boolean = () => true): Promise<T> {
    const key = sha256(keyParts);
    await mkdir(this.dir, {recursive: true});
    try {
      const cached = JSON.parse(await readFile(this.file(stage), 'utf8')) as {key: string; value: T};
      if (cached.key === key) { this.hits[stage] = true; return cached.value; }
    } catch { /* miss */ }
    const value = await compute();
    if (cacheable(value)) await writeFile(this.file(stage), JSON.stringify({key, value}));
    this.hits[stage] = false;
    return value;
  }
}
