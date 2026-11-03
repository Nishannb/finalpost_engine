import {readdirSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

export type V1Fixture = {
  id: string;
  kind: 'saved_response_replay';
  path: 'v1';
  provenance: Record<string, unknown>;
  requestedEdits: string[] | null;
  captionTemplate: string | null;
  sourceDurationSec: number;
  outputDurationSec: number;
  transcript: string;
  words: Array<{text: string; start: number; end: number}>;
  captionWords: Array<{text: string; start: number; end: number; sentenceIndex: number}>;
  keepSegments: Array<{sourceStart: number; sourceEnd: number; outputStart: number}>;
  rawResponse: string;
  savedParsed: unknown;
};

const here = dirname(fileURLToPath(import.meta.url));

export function loadV1Fixtures(): V1Fixture[] {
  const dir = join(here, 'fixtures');
  return readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .sort()
    .map(name => JSON.parse(readFileSync(join(dir, name), 'utf8')) as V1Fixture);
}

export const GOLDEN_DIR = process.env.EVAL_GOLDEN_DIR ?? join(here, 'golden');
