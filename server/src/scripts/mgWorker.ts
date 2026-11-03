/**
 * End-to-end harness for the Claude motion-graphics worker:
 *
 *   npm run mg:worker -- <briefs.json> [--reuse] [--render-local]
 *
 * The briefs file stands in for the Director: a test timeline (source video,
 * captions, style) plus a list of {start, end, brief}. Each brief goes through
 * the real worker (Claude → contract check → typecheck → compile → repair →
 * R2 upload); the results become `generatedGraphics[]` entries and ShortVideo
 * props are written to remotion/out/mg-fixtures/<name>.worker.props.json.
 *
 * Generated sources and a report (attempts, errors, tokens) are saved under
 * remotion/mg-fixtures/generated/<name>/. `--reuse` re-validates and uploads a
 * saved source instead of calling Claude for that brief. `--sequential` runs one
 * graphic at a time (prompt-cache measurement); by default the first graphic
 * runs alone to write the cache and the rest follow in parallel. `--render-local`
 * renders through the real local pipeline.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import type {MotionGraphicBriefInput} from '../motionWorker/brief.ts';
import {closeRuntimeCheck} from '../motionWorker/runtimeCheck.ts';
import {
  generateMotionGraphic,
  MotionWorkerError,
  cacheStatus,
  publishGraphicSource,
  toGeneratedGraphic,
  type MotionGraphicResult,
} from '../motionWorker/worker.ts';
import {fixtureProps, remotionRoot, renderFixtureLocally, writeFixtureProps, type FixtureTimeline} from './mgShared.ts';

type BriefsFile = FixtureTimeline & {
  graphics: Array<{start: number; end: number; brief: Omit<MotionGraphicBriefInput, 'durationSeconds'> & {durationSeconds?: number}}>;
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fileArg = args.find(arg => !arg.startsWith('--'));
  if (!fileArg) {
    throw new Error('usage: mgWorker.ts <briefs.json> [--tag=name] [--sequential] [--reuse] [--render-local]');
  }
  const spec = JSON.parse(await fs.readFile(path.resolve(fileArg), 'utf8')) as BriefsFile;
  // `--tag=x` keeps runs apart (e.g. a Sonnet run never overwrites the Opus artifacts).
  const tag = args.find(arg => arg.startsWith('--tag='))?.slice('--tag='.length);
  const runName = tag ? `${spec.name}.${tag}` : spec.name;
  const genDir = path.join(remotionRoot, 'mg-fixtures/generated', runName);
  await fs.mkdir(genDir, {recursive: true});

  const started = Date.now();
  const produce = async ({start, end, brief: partial}: BriefsFile['graphics'][number]) => {
      const brief = {...partial, durationSeconds: partial.durationSeconds ?? Number((end - start).toFixed(3))};
      const sourcePath = path.join(genDir, `${brief.id}.tsx`);
      const t0 = Date.now();
      try {
        const saved = args.includes('--reuse') ? await fs.readFile(sourcePath, 'utf8').catch(() => null) : null;
        const workerOptions = {artifactsDir: genDir, captionBottomFrac: Number(spec.style?.captionBottomFrac ?? 0.16)};
        const result = saved ? await publishGraphicSource(brief, saved, workerOptions) : await generateMotionGraphic(brief, workerOptions);
        await fs.writeFile(sourcePath, result.source);
        return {id: brief.id, start, end, result, ms: Date.now() - t0, reused: saved !== null};
      } catch (error) {
        if (error instanceof MotionWorkerError && error.lastSource) {
          await fs.writeFile(path.join(genDir, `${brief.id}.failed.tsx`), error.lastSource);
        }
        return {id: brief.id, start, end, error, ms: Date.now() - t0};
      }
  };
  // `--sequential`: one graphic at a time (cache measurement). Default: the first
  // graphic alone (it writes the prompt cache), then the rest in parallel.
  const outcomes: Array<Awaited<ReturnType<typeof produce>>> = [];
  if (args.includes('--sequential')) {
    for (const item of spec.graphics) {
      outcomes.push(await produce(item));
    }
  } else if (spec.graphics.length > 0) {
    outcomes.push(await produce(spec.graphics[0]!));
    outcomes.push(...(await Promise.all(spec.graphics.slice(1).map(produce))));
  }

  const reportPath = path.join(genDir, 'report.json');
  // Reused graphics keep the record of the run that generated them.
  const previous = new Map<string, unknown>(
    ((await fs.readFile(reportPath, 'utf8').then(JSON.parse).catch(() => [])) as Array<{id: string}>).map(item => [item.id, item]),
  );
  const report = outcomes.map(outcome => {
    if ('reused' in outcome && outcome.reused && previous.has(outcome.id)) {
      return previous.get(outcome.id) as {id: string; ok: true; ms: number; bytes: number; costUsd: number; url: string; attempts: unknown[]};
    }
    if ('error' in outcome) {
      const attempts = outcome.error instanceof MotionWorkerError ? outcome.error.attempts : [];
      return {id: outcome.id, ok: false, ms: outcome.ms, error: String(outcome.error), attempts};
    }
    const r: MotionGraphicResult = outcome.result;
    return {
      id: r.id,
      ok: true,
      reused: outcome.reused,
      ms: outcome.ms,
      model: r.model,
      url: r.module.url,
      bytes: r.bytes,
      gzipBytes: r.gzipBytes,
      sourceBytes: Buffer.byteLength(r.source),
      toolkitImports: [...r.source.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]@finalpost\/motion['"]/g)]
        .flatMap(match => match[1]!.split(','))
        .map(name => name.trim().replace(/^type\s+/, ''))
        .filter(Boolean),
      attempts: r.attempts.map(a => ({
        attempt: a.attempt,
        kind: a.kind,
        ok: a.ok,
        ms: a.ms,
        model: a.model,
        inputTokens: a.usage.inputTokens,
        outputTokens: a.usage.outputTokens,
        cacheCreationInputTokens: a.usage.cacheCreationInputTokens,
        cacheReadInputTokens: a.usage.cacheReadInputTokens,
        cache: cacheStatus(a.usage),
        costUsd: a.costUsd,
        runtime: a.runtime,
        report: a.report,
      })),
      usage: r.usage,
      costUsd: r.costUsd,
      previewPath: r.previewPath,
      warnings: r.warnings,
    };
  });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

  for (const item of report) {
    if (item.ok) {
      const tries = 'attempts' in item ? item.attempts.length : 0;
      console.log(
        `${item.id}: ok in ${(item.ms / 1000).toFixed(1)} s, ${tries} attempt(s), ${item.bytes} B module, $${item.costUsd} → ${item.url}`,
      );
    } else {
      console.log(`${item.id}: FAILED after ${(item.ms / 1000).toFixed(1)} s: ${item.error}`);
    }
  }
  console.log(`all graphics: ${((Date.now() - started) / 1000).toFixed(1)} s, report → ${reportPath}`);

  const succeeded = outcomes.flatMap(outcome => ('result' in outcome && outcome.result ? [outcome] : []));
  if (succeeded.length < outcomes.length) {
    process.exitCode = 1;
  }
  const props = fixtureProps(
    spec,
    succeeded.map(outcome => toGeneratedGraphic(outcome.result, {start: outcome.start, end: outcome.end})),
  );
  const propsPath = await writeFixtureProps(`${runName}.worker.props.json`, props);
  console.log(`props → ${propsPath}`);

  if (args.includes('--render-local')) {
    const result = await renderFixtureLocally(runName, props);
    console.log(`local pipeline render: ${result.outputUrl} (${result.ms} ms)`);
  }
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closeRuntimeCheck);
