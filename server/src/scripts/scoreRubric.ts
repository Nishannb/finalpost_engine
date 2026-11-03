/**
 * WP3A: read-only rubric scorer CLI. Reads the JSON files named on the command line and prints one JSON report to stdout. It writes nothing, starts no process, makes no
 * network call and imports no logger, `.env` or SDK (only `node:fs` and `eval/rubricScorer.ts`).
 *
 *   node src/scripts/scoreRubric.ts --blueprint bp.json [--ledger ledger.json] [--inspection output-facts.json]
 *        [--supplied-ids ub_1,ub_2 | --supplied-ids-file ids.json] [--supplied-urls-file urls.json] [--min-gap-sec 4.5] [--transcript-file t.txt] [--expect-audio true|false]
 *
 * Exit status: 0 report printed (read the rows for fail), 2 usage or unreadable input. Row 9 needs --inspection (the JSON `inspectOutput` produced elsewhere). Its audio check uses the
 * blueprint's `sourceHasAudio` when present; --expect-audio is used only when the blueprint has none.
 */
import {readFileSync} from 'node:fs';

import {scoreRubric, type ScoreInput} from '../eval/rubricScorer.ts';

function fail(message: string): never {
  process.stderr.write(`scoreRubric: ${message}\n`);
  process.exit(2);
}

const readJson = (path: string, label: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return fail(`cannot read ${label} (${path}): ${error instanceof Error ? error.message : String(error)}`);
  }
};

const stringList = (value: unknown, label: string): string[] => {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) return fail(`${label} must be a JSON array of strings`);
  return value as string[];
};

const args = process.argv.slice(2);
const options = new Map<string, string>();
for (let i = 0; i < args.length; i += 2) {
  const key = args[i];
  const value = args[i + 1];
  if (!key?.startsWith('--') || value === undefined) fail(`bad argument near "${key ?? ''}"`);
  options.set(key, value);
}
const known = new Set(['--transcript-file', '--blueprint', '--ledger', '--inspection', '--supplied-ids', '--supplied-ids-file', '--supplied-urls-file', '--min-gap-sec', '--expect-audio']);
for (const key of options.keys()) if (!known.has(key)) fail(`unknown option ${key}`);

const blueprintPath = options.get('--blueprint');
if (!blueprintPath) fail('--blueprint is required');

const input: ScoreInput = {blueprint: readJson(blueprintPath, 'blueprint')};
if (options.has('--transcript-file')) {
  try {
    input.transcript = readFileSync(options.get('--transcript-file')!, 'utf8');
  } catch (error) {
    fail(`cannot read transcript (${options.get('--transcript-file')}): ${error instanceof Error ? error.message : String(error)}`);
  }
}
if (options.has('--ledger')) input.ledger = readJson(options.get('--ledger')!, 'ledger');
if (options.has('--inspection')) input.inspection = readJson(options.get('--inspection')!, 'inspection');
if (options.has('--supplied-ids')) input.suppliedIds = options.get('--supplied-ids')!.split(',').map(item => item.trim()).filter(Boolean);
if (options.has('--supplied-ids-file')) input.suppliedIds = stringList(readJson(options.get('--supplied-ids-file')!, 'supplied ids'), 'supplied ids');
if (options.has('--supplied-urls-file')) input.suppliedUrls = stringList(readJson(options.get('--supplied-urls-file')!, 'supplied urls'), 'supplied urls');
if (options.has('--min-gap-sec')) {
  const gap = Number(options.get('--min-gap-sec'));
  if (!Number.isFinite(gap) || gap <= 0) fail('--min-gap-sec must be a positive number');
  input.callerMinGapSec = gap;
}
if (options.has('--expect-audio')) {
  const value = options.get('--expect-audio');
  if (value !== 'true' && value !== 'false') fail('--expect-audio must be true or false');
  input.expectAudio = value === 'true';
}

process.stdout.write(`${JSON.stringify(scoreRubric(input), null, 2)}\n`);
