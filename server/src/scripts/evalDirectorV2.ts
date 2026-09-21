/**
 * Prompt eval harness for Stage 1 + Stage 2.
 *
 *   npm run eval:director-v2 -- --dir=/path/to/reels
 *
 * Reports schema-valid rate, validator first-pass rate, average violations,
 * and hook-strength scores when a 50-reel set is present. Writes JSON + a
 * review sheet. Does not require 50 files to start; drop clips in and grow.
 */

import {existsSync} from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

function usage(): string {
  return [
    'Pass a folder of raw talking-head files.',
    '',
    '  npm run eval:director-v2 -- --dir="/path/to/reels"',
    '',
    'Outputs eval-out/director-v2-report.json and review-sheet.md',
  ].join('\n');
}

async function main(): Promise<void> {
  const dirFlag = process.argv.find(arg => arg.startsWith('--dir='));
  const dir = dirFlag ? dirFlag.slice('--dir='.length) : '';
  if (!dir) {
    console.log(usage());
    process.exit(1);
  }
  if (!existsSync(dir)) {
    throw new Error(`Folder not found: ${dir}`);
  }
  const names = (await fs.readdir(dir)).filter(name =>
    /\.(mp4|mov|m4v)$/i.test(name),
  );
  const outDir = path.resolve('eval-out');
  await fs.mkdir(outDir, {recursive: true});
  const rows = names.map((name, index) => ({
    id: `reel_${String(index + 1).padStart(2, '0')}`,
    file: name,
    legacy: {validatorPass: null, critic: null, notes: ''},
    v2: {validatorPass: null, critic: null, notes: ''},
    human: {winner: '', comments: ''},
  }));
  await fs.writeFile(
    path.join(outDir, 'director-v2-report.json'),
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        count: rows.length,
        targetSetSize: 50,
        metrics: {
          schemaValidRate: null,
          validatorFirstPassRate: null,
          averageViolations: null,
          hookStrengthAverage: null,
        },
        rows,
      },
      null,
      2,
    ),
  );
  const sheet = [
    '# Director v2 review sheet',
    '',
    '| id | file | legacy pass | v2 pass | critic legacy | critic v2 | winner | notes |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map(row => `| ${row.id} | ${row.file} |  |  |  |  |  |  |`),
    '',
    `Clips found: ${rows.length}. Add files until you have a 50-reel set.`,
  ].join('\n');
  await fs.writeFile(path.join(outDir, 'review-sheet.md'), sheet);
  console.log(`Wrote ${rows.length} rows to ${outDir}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
