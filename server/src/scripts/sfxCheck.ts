/**
 * npm run sfx:check — validate remotion/public/sfx-library/sfxinfo.json against the files beside it.
 * Read-only: prints suggestions, never edits an audio file or the catalog. Local ffmpeg only.
 * Exit code 1 only when there is an error (missing file, unreadable file, invalid catalog); warnings exit 0.
 */

import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {validateSfxLibrary} from '../lib/sfxCatalog.ts';

async function main(): Promise<void> {
  const report = await validateSfxLibrary();
  console.log(`SFX library: ${report.dir}`);
  console.log(`${report.entries.length} catalog entr${report.entries.length === 1 ? 'y' : 'ies'}, ${report.probed} file${report.probed === 1 ? '' : 's'} measured.`);
  if (report.issues.length === 0) {
    console.log('No problems found.');
    return;
  }
  for (const issue of report.issues) {
    console.log(`${issue.level === 'error' ? 'ERROR' : 'warn '}  ${issue.message}`);
    if (issue.suggestion) console.log(`       suggestion: ${issue.suggestion}`);
  }
  const errors = report.issues.filter(issue => issue.level === 'error').length;
  console.log(`\n${errors} error(s), ${report.issues.length - errors} warning(s). Nothing was changed.`);
  if (errors > 0) process.exitCode = 1;
}

const invokedDirectly = Boolean(process.argv[1]) && path.resolve(process.argv[1]!) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
