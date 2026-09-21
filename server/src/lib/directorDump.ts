import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';

/** Opt-in JSON traces for diagnosing director vs engine. Set DIRECTOR_DUMP_DIR. */
export function dumpDirectorTrace(name: string, payload: unknown): void {
  const dir = process.env.DIRECTOR_DUMP_DIR?.trim();
  if (!dir) {
    return;
  }
  mkdirSync(dir, {recursive: true});
  writeFileSync(path.join(dir, `${name}.json`), `${JSON.stringify(payload, null, 2)}\n`);
}
