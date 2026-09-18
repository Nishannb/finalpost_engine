/**
 * Stage A→D endpoints.
 *
 *   POST /v1/analyze              start (or reuse) an analysis
 *   GET  /v1/analyze/:id          poll job state; carries the blueprint on done
 *   GET  /v1/blueprints/:id       re-fetch a blueprint after app restart
 */

import {Router} from 'express';

import {EngineError} from '../../lib/errors.ts';
import {startAnalysis} from '../../pipeline/analysisRunner.ts';
import {
  hitRateLimit,
  loadAnalysisJob,
  loadBlueprint,
} from '../../store/engineStore.ts';
import {readQuota} from '../../stages/render/renderBudget.ts';
import {getAuth} from '../auth.ts';
import {analyzeRequestSchema} from '../schemas.ts';

/** A creator cannot legitimately start more than a handful of edits a minute. */
const ANALYZE_RATE_LIMIT = 8;
const ANALYZE_RATE_WINDOW_SEC = 60;

export const analyzeRoutes = Router();

analyzeRoutes.post('/analyze', async (req, res) => {
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

  const job = await startAnalysis({
    userId: auth.userId,
    videoUrl: parsed.data.videoUrl,
    languageCode: parsed.data.languageCode,
    useCache: parsed.data.useCache,
    colorGradeLut: parsed.data.colorGradeLut,
    styleRecipe: parsed.data.styleRecipe,
    userBrollUrls: parsed.data.userBrollUrls,
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
  getAuth(res);
  const blueprint = await loadBlueprint(String(req.params.blueprintId));
  if (!blueprint) {
    throw new EngineError('not_found', 'Blueprint not found or expired');
  }
  res.json({ok: true, blueprint});
});

analyzeRoutes.get('/quota', async (_req, res) => {
  const auth = getAuth(res);
  res.json({ok: true, quota: await readQuota(auth.userId)});
});

function firstIssue(issues: Array<{message: string}>): string {
  return issues[0]?.message ?? 'Invalid request';
}
