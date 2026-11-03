/**
 * End-to-end test of generated motion graphics through the production
 * interfaces: analyzeVideo (transcription → existing Director/B-roll →
 * Gemini motion-graphics direction → Claude worker → R2) → renderLocally.
 *
 *   npm run mg:e2e -- <source.mp4> [--broll=a.mp4,b.mp4] [--language=en]
 *     [--edits=cutaway,hook_title] [--captions=karaoke] [--out=dir]
 *
 * Everything lands in --out (default remotion/out/phase5-e2e):
 *   final.mp4               the rendered video (also uploaded to R2)
 *   blueprint.json          the full blueprint
 *   props.json              ShortVideo props (for a Lambda render of the same blueprint)
 *   director/               Director dumps; 05-motion-graphics.json = Gemini briefs + Claude ledger
 *   director/motion-graphics/<id>.tsx and stills from the one-frame validation
 *   cost.json               per-call and per-video cost report
 *
 * `--render-only --out=dir` re-renders dir/props.json (same blueprint, current
 * renderer) into dir/final.mp4 without re-running analysis.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import {DEFAULT_RENDER_STYLE} from '../http/schemas.ts';
import {mergeDeliveryShapingAllowlist, parseCaptionTemplateFlag, parseEditAllowlist, resolvePipelineEdits} from '../lib/editToolkits.ts';
import {closeRuntimeCheck} from '../motionWorker/runtimeCheck.ts';
import {analyzeVideo} from '../pipeline/analyzeVideo.ts';
import {renderLocally} from '../stages/render/localRender.ts';
import type {LanguageCode, RenderStyle, TimelineBlueprint} from '../types/blueprint.ts';
import {remotionRoot} from './mgShared.ts';

/** R2 list prices: class A (writes) per million, storage per GB-month. */
const R2_CLASS_A_PER_M = 4.5;
const R2_STORAGE_PER_GB_MONTH = 0.015;

function flag(args: string[], name: string): string | undefined {
  return args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function renderOnly(outDir: string): Promise<void> {
  const props = JSON.parse(await fs.readFile(path.join(outDir, 'props.json'), 'utf8')) as {blueprint: TimelineBlueprint; style: RenderStyle};
  const started = Date.now();
  const {outputUrl} = await renderLocally({...props, renderJobId: `mge2e_${props.blueprint.blueprintId}_${Date.now()}`});
  const video = await fetch(outputUrl);
  await fs.writeFile(path.join(outDir, 'final.mp4'), Buffer.from(await video.arrayBuffer()));
  console.log(`final video  ${path.join(outDir, 'final.mp4')}\nR2           ${outputUrl}\nrender       ${Date.now() - started} ms`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--render-only')) {
    return renderOnly(path.resolve(flag(args, 'out') ?? path.join(remotionRoot, 'out/phase5-e2e')));
  }
  const source = args.find(arg => !arg.startsWith('--'));
  if (!source) {
    throw new Error('usage: mgE2E.ts <source.mp4> [--broll=a,b] [--language=en] [--edits=…] [--captions=…] [--out=dir]');
  }
  const outDir = path.resolve(flag(args, 'out') ?? path.join(remotionRoot, 'out/phase5-e2e'));
  await fs.rm(outDir, {recursive: true, force: true});
  await fs.mkdir(path.join(outDir, 'director'), {recursive: true});
  process.env.DIRECTOR_DUMP_DIR = path.join(outDir, 'director');

  const editTokens = flag(args, 'edits') ? [flag(args, 'edits')!] : [];
  const requestedEdits = mergeDeliveryShapingAllowlist(
    resolvePipelineEdits({...parseEditAllowlist(editTokens), fullEdits: false, pipelineMode: 'lean'}),
    false,
  );
  const captionTemplate = parseCaptionTemplateFlag(flag(args, 'captions') ?? '');
  const brollUrls = (flag(args, 'broll') ?? '').split(',').map(item => item.trim()).filter(Boolean);

  const started = Date.now();
  const blueprint = await analyzeVideo({
    videoUrl: source,
    languageCode: (flag(args, 'language') ?? 'auto') as LanguageCode,
    userId: 'dev-user',
    userBrollUrls: brollUrls,
    requestedEdits,
    forceDeliveryShaping: false,
    captionTemplate,
    generatedGraphicsEnabled: true,
  });
  const analysisMs = Date.now() - started;
  await fs.writeFile(path.join(outDir, 'blueprint.json'), JSON.stringify(blueprint, null, 2));

  const style: RenderStyle = {
    ...DEFAULT_RENDER_STYLE,
    captionTemplate: blueprint.captionDirection?.template ?? DEFAULT_RENDER_STYLE.captionTemplate,
    captionBottomFrac: blueprint.captionDirection?.bottomFrac ?? DEFAULT_RENDER_STYLE.captionBottomFrac,
    colorGradeLut: '',
  };
  await fs.writeFile(path.join(outDir, 'props.json'), JSON.stringify({blueprint, style}, null, 2));

  const renderStarted = Date.now();
  const {outputUrl} = await renderLocally({blueprint, style, renderJobId: `mge2e_${blueprint.blueprintId}`});
  const renderMs = Date.now() - renderStarted;
  const video = await fetch(outputUrl);
  await fs.writeFile(path.join(outDir, 'final.mp4'), Buffer.from(await video.arrayBuffer()));

  const motion = JSON.parse(await fs.readFile(path.join(outDir, 'director/05-motion-graphics.json'), 'utf8').catch(() => '{}')) as {
    claudeLedger?: Array<{costUsd: number}>;
  };
  const graphics = blueprint.generatedGraphics ?? [];
  const moduleBytes = await Promise.all(
    graphics.map(async graphic => (await fetch(graphic.module.url, {method: 'HEAD'})).headers.get('content-length')),
  );
  const finalBytes = (await fs.stat(path.join(outDir, 'final.mp4'))).size;
  const r2Writes = graphics.length + 1 /* render */ + 1 /* source upload */ + brollUrls.length;
  const r2StoredBytes = finalBytes + moduleBytes.reduce((sum, bytes) => sum + Number(bytes ?? 0), 0);
  const breakdown = blueprint.stats.costBreakdownUsd;
  const cost = {
    perClaudeCall: motion.claudeLedger ?? [],
    video: {
      transcriptionUsd: breakdown?.transcription ?? null,
      geminiUsd: breakdown?.gemini ?? null,
      geminiMotionDirectorUsd: breakdown?.geminiMotionDirector ?? null,
      claudeMotionGraphicsUsd: breakdown?.claude ?? null,
      renderUsd: {local: 0, lambda: 'see lambda render log (renderMediaOnLambda estimate)'},
      r2Usd: Number((r2Writes * (R2_CLASS_A_PER_M / 1e6) + (r2StoredBytes / 1e9) * R2_STORAGE_PER_GB_MONTH).toFixed(6)),
      r2Detail: {writes: r2Writes, storedBytes: r2StoredBytes, note: 'class A writes + one month of storage; egress is free on R2'},
      analysisTotalUsd: blueprint.stats.estimatedCostUsd,
    },
    timingsMs: {analysis: analysisMs, localRender: renderMs, ...blueprint.stats.timings},
  };
  await fs.writeFile(path.join(outDir, 'cost.json'), JSON.stringify(cost, null, 2));

  console.log(
    [
      `final video  ${path.join(outDir, 'final.mp4')}`,
      `R2           ${outputUrl}`,
      `graphics     ${graphics.map(item => `${item.id}@${item.start}-${item.end}:${item.placement.mode}`).join(', ') || 'none'}`,
      `B-roll       ${blueprint.brollClips.length} cutaway(s), ${blueprint.visualOverlays.length} overlay(s)`,
      `cost         ${JSON.stringify(cost.video)}`,
      `artifacts    ${outDir}`,
    ].join('\n'),
  );
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  })
  .finally(closeRuntimeCheck);
