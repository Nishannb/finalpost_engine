/**
 * Render one caption-demo MP4 per package *-theme id into assets/caption-demos/.
 *
 * Usage (from ai-video-engine/remotion):
 *   node scripts/render-package-theme-demos.mjs
 */

import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const remotionRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(remotionRoot, '../..');
const demoPropsPath = path.join(remotionRoot, 'props/caption-demo.json');
const outDir = path.join(repoRoot, 'assets/caption-demos');
const tmpPropsDir = path.join(remotionRoot, 'props/.theme-demo-tmp');

const THEME_IDS = [
  'pop-theme',
  'karaoke-theme',
  'hustle-theme',
  'grape-theme',
  'beast-theme',
  'poppin-theme',
  'aarit-theme',
  'soft-ai-theme',
  'gaming-stream-theme',
  'simple-one-word-theme',
  'kinetic-01-theme',
];

const baseProps = JSON.parse(fs.readFileSync(demoPropsPath, 'utf8'));
fs.mkdirSync(outDir, {recursive: true});
fs.mkdirSync(tmpPropsDir, {recursive: true});

const remotionBin = path.join(
  remotionRoot,
  '../node_modules/@remotion/cli/remotion-cli.js',
);

for (const id of THEME_IDS) {
  const props = structuredClone(baseProps);
  props.style = {...props.style, captionTemplate: id};
  if (props.blueprint?.captionDirection) {
    props.blueprint.captionDirection = {
      ...props.blueprint.captionDirection,
      template: id,
    };
  }
  const propsFile = path.join(tmpPropsDir, `${id}.json`);
  const outFile = path.join(outDir, `${id}.mp4`);
  fs.writeFileSync(propsFile, JSON.stringify(props, null, 2));
  console.log(`\n→ Rendering ${id} → ${outFile}`);
  const result = spawnSync(
    process.execPath,
    [
      remotionBin,
      'render',
      'ShortVideo',
      outFile,
      `--props=${propsFile}`,
      '--log=info',
    ],
    {
      cwd: remotionRoot,
      stdio: 'inherit',
      env: process.env,
    },
  );
  if (result.status !== 0) {
    console.error(`Failed rendering ${id} (exit ${result.status})`);
    process.exit(result.status || 1);
  }
}

console.log(`\nDone. Wrote ${THEME_IDS.length} demos to ${outDir}`);
