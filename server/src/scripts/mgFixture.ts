/**
 * Dev fixture for generated motion graphics: TSX → compiled module → (R2) → blueprint.
 *
 *   npm run mg:fixture -- <layout.json> [--upload] [--render-local]
 *
 * For every graphic named in the layout, the TSX in remotion/mg-fixtures/graphics
 * is checked against the generated-graphic contract (motionWorker/contract.ts),
 * compiled to the CommonJS module the Remotion loader evaluates, hashed, and
 * either uploaded to R2 (`--upload`) or staged under remotion/public. Writes
 * ShortVideo props to remotion/out/mg-fixtures/<layout>.<r2|local>.props.json.
 * The layout may also carry ordinary blueprint fields (brollClips, captionWords,
 * hookTitle, visualOverlays, …) so graphics are tested alongside existing edits.
 * `--render-local` (with `--upload`) burns through the real local render path
 * (prefetch → Remotion → R2), the same one the API uses.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import {checkSource, compileGraphicSource, MOTION_MODULE_PREFIX} from '../motionWorker/contract.ts';
import {uploadPublicFile} from '../storage/r2.ts';
import type {GeneratedGraphicPlacement} from '../types/blueprint.ts';
import {fixtureOutDir as outDir, fixtureProps, remotionRoot, renderFixtureLocally, writeFixtureProps, type FixtureTimeline} from './mgShared.ts';

const graphicsDir = path.join(remotionRoot, 'mg-fixtures/graphics');
const localModulesDir = path.join(remotionRoot, 'public/mg-fixture-modules');

type Layout = FixtureTimeline & {
  graphics: Array<{
    id: string;
    graphic: string;
    start: number;
    end: number;
    placement: GeneratedGraphicPlacement;
    props?: Record<string, unknown>;
  }>;
};

type CompiledGraphic = {
  name: string;
  sha256: string;
  bytes: number;
  gzipBytes: number;
  url: string;
  compileMs: number;
};

async function compileGraphic(name: string, upload: boolean): Promise<CompiledGraphic> {
  const entry = path.join(graphicsDir, `${name}.tsx`);
  const source = await fs.readFile(entry, 'utf8');
  const problems = checkSource(source);
  if (problems.length > 0) {
    throw new Error(`${name}.tsx failed the contract check:\n  - ${problems.join('\n  - ')}`);
  }

  const {code, sha256, bytes, gzipBytes, compileMs} = await compileGraphicSource(source, `${name}.tsx`);
  const fileName = `${sha256}.js`;

  await fs.mkdir(path.join(outDir, 'modules'), {recursive: true});
  const modulePath = path.join(outDir, 'modules', fileName);
  await fs.writeFile(modulePath, code);

  let url: string;
  if (upload) {
    const uploaded = await uploadPublicFile(
      modulePath,
      `${MOTION_MODULE_PREFIX}${fileName}`,
      'text/javascript; charset=utf-8',
    );
    url = uploaded.publicUrl;
  } else {
    await fs.mkdir(localModulesDir, {recursive: true});
    await fs.copyFile(modulePath, path.join(localModulesDir, fileName));
    url = `staticFile:mg-fixture-modules/${fileName}`;
  }

  return {name, sha256, bytes, gzipBytes, url, compileMs};
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const layoutArg = args.find(arg => !arg.startsWith('--'));
  if (!layoutArg) {
    throw new Error('usage: mgFixture.ts <layout.json> [--upload] [--render-local]');
  }
  const upload = args.includes('--upload');
  const layout = JSON.parse(await fs.readFile(path.resolve(layoutArg), 'utf8')) as Layout;

  const compiled = new Map<string, CompiledGraphic>();
  for (const name of new Set(layout.graphics.map(item => item.graphic))) {
    const graphic = await compileGraphic(name, upload);
    compiled.set(name, graphic);
    console.log(
      `${name}: ${graphic.bytes} B (${graphic.gzipBytes} B gzip) in ${graphic.compileMs} ms → ${graphic.url}`,
    );
  }

  const props = fixtureProps(
    layout,
    layout.graphics.map(item => {
      const graphic = compiled.get(item.graphic)!;
      return {
        id: item.id,
        start: item.start,
        end: item.end,
        placement: item.placement,
        module: {url: graphic.url, sha256: graphic.sha256},
        props: item.props ?? {},
      };
    }),
  );
  const propsPath = await writeFixtureProps(`${layout.name}${upload ? '.r2' : '.local'}.props.json`, props);
  console.log(`props → ${propsPath}`);

  if (args.includes('--render-local')) {
    if (!upload) {
      throw new Error('--render-local needs --upload (the local pipeline prefetches from R2)');
    }
    const result = await renderFixtureLocally(layout.name, props);
    console.log(`local pipeline render: ${result.outputUrl} (${result.ms} ms)`);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
