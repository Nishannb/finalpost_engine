/**
 * Stage A→D endpoints.
 *
 *   POST /v1/analyze              start (or reuse) an analysis
 *   GET  /v1/analyze/:id          poll job state; carries the blueprint on done
 *   GET  /v1/blueprints/:id       re-fetch a blueprint after app restart
 */

import {Router} from 'express';

import {assertPublicHttpUrl} from '../../lib/addressGuard.ts';
import {EngineError} from '../../lib/errors.ts';
import {startAnalysis} from '../../pipeline/analysisRunner.ts';
import {
  assertBlueprintAccess,
  hitRateLimit,
  loadAnalysisJob,
  loadBlueprint,
} from '../../store/engineStore.ts';
import {readQuota} from '../../stages/render/renderBudget.ts';
import {getAuth} from '../auth.ts';
import {requireFullEdit} from '../entitlementGuard.ts';
import {
  analyzeRequestSchema,
  bindLabeledAssetsRequestSchema,
} from '../schemas.ts';
import {parseEditAllowlist, resolvePipelineEdits} from '../../lib/editToolkits.ts';
import {env} from '../../config/env.ts';
import {
  applyLabeledAssetBindings,
  computeEditReadiness,
  buildLabeledAssetBrief,
} from '../../stages/broll/labeledAssetBrief.ts';
import {saveBlueprint} from '../../store/engineStore.ts';

/** A creator cannot legitimately start more than a handful of edits a minute. */
const ANALYZE_RATE_LIMIT = 8;
const ANALYZE_RATE_WINDOW_SEC = 60;

export const analyzeRoutes = Router();

analyzeRoutes.post('/analyze', requireFullEdit, async (req, res) => {
  const auth = getAuth(res);
  const parsed = analyzeRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new EngineError('bad_request', firstIssue(parsed.error.issues), {
      issues: parsed.error.issues.map(issue => issue.message),
    });
  }

  const hits = await hitRateLimit(`analyze:${auth.userId}`, ANALYZE_RATE_WINDOW_SEC);
  if (hits > ANALYZE_RATE_LIMIT && auth.via !== 'dev') {
    throw new EngineError('rate_limited', 'Too many AI edits started; slow down');
  }

  const parsedEdits = parseEditAllowlist(parsed.data.requestedEdits);
  if (parsedEdits.unknown.length > 0) {
    throw new EngineError(
      'bad_request',
      `Unknown edit toolkit: ${parsedEdits.unknown.join(', ')}`,
    );
  }

  if (parsed.data.subjectCutoutUrl) {
    // same public-address guard the source URL gets when it is fetched: no private hosts, no file:
    const allowHosts = env.INGEST_ALLOWED_PRIVATE_HOSTS.split(',').map(item => item.trim()).filter(Boolean);
    await assertPublicHttpUrl(parsed.data.subjectCutoutUrl, {allowHosts}).catch(() => {
      throw new EngineError('bad_request', 'subjectCutoutUrl must be a public http(s) URL');
    });
  }

  const job = await startAnalysis({
    userId: auth.userId,
    videoUrl: parsed.data.videoUrl,
    subjectCutoutUrl: parsed.data.subjectCutoutUrl,
    languageCode: parsed.data.languageCode,
    useCache: parsed.data.useCache,
    colorGradeLut: parsed.data.colorGradeLut,
    styleRecipe: parsed.data.styleRecipe,
    userBrollUrls: parsed.data.userBrollUrls,
    labeledAssetBindings: parsed.data.labeledAssetBindings,
    brandName: parsed.data.brandName,
    captionStyleGuide: parsed.data.captionStyleGuide,
    forceSpeakerCutout: parsed.data.forceSpeakerCutout,
    directorV2: parsed.data.directorV2,
    northStar: parsed.data.northStar,
    requestedEdits: resolvePipelineEdits({
      ...parsedEdits,
      pipelineMode: env.PIPELINE_MODE,
    }),
    captionTemplate: parsed.data.captionTemplate,
  });

  res.status(202).json({ok: true, job});
});

analyzeRoutes.get('/analyze/:analysisJobId', async (req, res) => {
  const auth = getAuth(res);
  const job = await loadAnalysisJob(String(req.params.analysisJobId));
  if (!job || job.userId !== auth.userId) {
    throw new EngineError('not_found', 'Analysis job not found');
  }
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.json({ok: true, job});
});

analyzeRoutes.get('/blueprints/:blueprintId', async (req, res) => {
  const auth = getAuth(res);
  await assertBlueprintAccess(String(req.params.blueprintId), auth.userId);
  const blueprint = await loadBlueprint(String(req.params.blueprintId));
  if (!blueprint) {
    throw new EngineError('not_found', 'Blueprint not found or expired');
  }
  res.json({ok: true, blueprint});
});

/**
 * Bind uploaded / skipped labeled assets onto an existing blueprint's assetBrief
 * without a full re-analyze. Prefer re-analyze with labeledAssetBindings when the
 * edit should place the new assets; this endpoint persists the map for resume.
 */
analyzeRoutes.post('/blueprints/:blueprintId/labeled-assets', requireFullEdit, async (req, res) => {
  const auth = getAuth(res);
  await assertBlueprintAccess(String(req.params.blueprintId), auth.userId);
  const parsed = bindLabeledAssetsRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new EngineError('bad_request', firstIssue(parsed.error.issues), {
      issues: parsed.error.issues.map(issue => issue.message),
    });
  }
  const blueprintId = String(req.params.blueprintId);
  const blueprint = await loadBlueprint(blueprintId);
  if (!blueprint) {
    throw new EngineError('not_found', 'Blueprint not found or expired');
  }
  const baseBrief =
    blueprint.assetBrief ??
    buildLabeledAssetBrief({
      words: blueprint.captionWords ?? [],
      outputDurationSec: blueprint.outputDurationSec,
    });
  const urlToAssetId = new Map<string, string>();
  for (const binding of parsed.data.bindings) {
    if (binding.assetUrl && binding.userAssetId) {
      urlToAssetId.set(binding.assetUrl.trim(), binding.userAssetId);
    }
  }
  const assetBrief = applyLabeledAssetBindings(
    baseBrief,
    parsed.data.bindings,
    urlToAssetId,
  );
  const next = {...blueprint, assetBrief, editReadiness: computeEditReadiness(assetBrief)};
  await saveBlueprint(next, `bind:${blueprintId}:${Date.now()}`);
  res.json({ok: true, blueprint: next});
});

analyzeRoutes.get('/quota', async (_req, res) => {
  const auth = getAuth(res);
  res.json({ok: true, quota: await readQuota(auth.userId)});
});

function firstIssue(issues: Array<{message: string}>): string {
  return issues[0]?.message ?? 'Invalid request';
}
