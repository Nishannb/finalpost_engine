import {Router} from 'express';

import {EngineError} from '../../lib/errors.ts';
import {
  loadSeedanceJob,
  startSeedanceEdit,
} from '../../pipeline/seedanceRunner.ts';
import {hitRateLimit} from '../../store/engineStore.ts';
import {extractTemplateStyle} from '../../stages/templates/extractStyle.ts';
import {getAuth} from '../auth.ts';
import {
  extractStyleRequestSchema,
  seedanceEditRequestSchema,
} from '../schemas.ts';

const RATE_LIMIT = 6;
const RATE_WINDOW_SEC = 60;
const SEEDANCE_RATE_LIMIT = 4;

export const templateRoutes = Router();

/**
 * POST /v1/templates/extract-style
 * Body: { videoUrl } — reference edit (watermarks OK; we only learn style).
 */
templateRoutes.post('/templates/extract-style', async (req, res) => {
  const auth = getAuth(res);
  const parsed = extractStyleRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new EngineError('bad_request', firstIssue(parsed.error.issues), {
      issues: parsed.error.issues.map(issue => issue.message),
    });
  }

  const hits = await hitRateLimit(
    `template-extract:${auth.userId}`,
    RATE_WINDOW_SEC,
  );
  if (hits > RATE_LIMIT && auth.via !== 'dev') {
    throw new EngineError('rate_limited', 'Too many template extracts; slow down');
  }

  const result = await extractTemplateStyle({videoUrl: parsed.data.videoUrl});
  res.status(200).json({
    ok: true,
    recipe: result.recipe,
    prompt: result.prompt,
    transcriptPreview: result.transcriptPreview,
    sourceDurationSec: result.sourceDurationSec,
    estimatedCostUsd: result.estimatedCostUsd,
  });
});

/**
 * POST /v1/templates/seedance-edit
 * Apply a TemplateRecipe via OpenRouter Seedance 2.0 Mini.
 */
templateRoutes.post('/templates/seedance-edit', async (req, res) => {
  const auth = getAuth(res);
  const parsed = seedanceEditRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new EngineError('bad_request', firstIssue(parsed.error.issues), {
      issues: parsed.error.issues.map(issue => issue.message),
    });
  }

  const hits = await hitRateLimit(
    `template-seedance:${auth.userId}`,
    RATE_WINDOW_SEC,
  );
  if (hits > SEEDANCE_RATE_LIMIT && auth.via !== 'dev') {
    throw new EngineError('rate_limited', 'Too many Seedance edits; slow down');
  }

  const job = await startSeedanceEdit({
    userId: auth.userId,
    videoUrl: parsed.data.videoUrl,
    styleRecipe: parsed.data.styleRecipe,
    styleReferenceVideoUrl: parsed.data.styleReferenceVideoUrl,
  });
  res.status(202).json({ok: true, job});
});

templateRoutes.get('/templates/seedance-edit/:seedanceJobId', async (req, res) => {
  const auth = getAuth(res);
  const job = await loadSeedanceJob(String(req.params.seedanceJobId));
  if (!job || job.userId !== auth.userId) {
    throw new EngineError('not_found', 'Seedance job not found');
  }
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.json({ok: true, job});
});

function firstIssue(issues: Array<{message: string}>): string {
  return issues[0]?.message ?? 'Invalid request';
}
