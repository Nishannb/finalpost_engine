import {Router} from 'express';
import {z} from 'zod';

import {EngineError} from '../../lib/errors.ts';
import {
  loadSeedanceJob,
  startSeedanceEdit,
} from '../../pipeline/seedanceRunner.ts';
import {hitRateLimit, listTemplateDesignJobs, loadTemplateDesignJob} from '../../store/engineStore.ts';
import {extractTemplateStyle} from '../../stages/templates/extractStyle.ts';
import {extractCaptionStyle} from '../../stages/templates/extractCaptionStyle.ts';
import {
  createTemplateDesignJob,
  markTemplateDesignUploaded,
} from '../../pipeline/templateDesignerRunner.ts';
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
 * POST /v1/templates/extract-caption-style
 * Learn caption colors / placement / animation from one reference video.
 */
templateRoutes.post('/templates/extract-caption-style', async (req, res) => {
  const auth = getAuth(res);
  const parsed = extractStyleRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new EngineError('bad_request', firstIssue(parsed.error.issues), {
      issues: parsed.error.issues.map(issue => issue.message),
    });
  }

  const hits = await hitRateLimit(
    `caption-style:${auth.userId}`,
    RATE_WINDOW_SEC,
  );
  if (hits > RATE_LIMIT && auth.via !== 'dev') {
    throw new EngineError('rate_limited', 'Too many caption-style extracts; slow down');
  }

  const result = await extractCaptionStyle({videoUrl: parsed.data.videoUrl});
  res.status(200).json({
    ok: true,
    guide: result.guide,
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

const designCreateSchema = z.object({
  contentType: z
    .enum(['video/mp4', 'video/quicktime', 'video/x-m4v'])
    .default('video/mp4'),
  extension: z.enum(['.mp4', '.mov', '.m4v']).optional(),
  name: z.string().trim().max(80).optional(),
});

/**
 * POST /v1/templates/design
 * Presign a reference reel for the AI Template Designer (EditSpec, not Director).
 */
templateRoutes.post('/templates/design', async (req, res) => {
  const auth = getAuth(res);
  const parsed = designCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    throw new EngineError('bad_request', firstIssue(parsed.error.issues), {
      issues: parsed.error.issues.map(issue => issue.message),
    });
  }
  const hits = await hitRateLimit(
    `template-design:${auth.userId}`,
    RATE_WINDOW_SEC,
  );
  if (hits > RATE_LIMIT && auth.via !== 'dev') {
    throw new EngineError('rate_limited', 'Too many template designs; slow down');
  }
  const {job, uploadUrl} = await createTemplateDesignJob({
    userId: auth.userId,
    contentType: parsed.data.contentType,
    extension: parsed.data.extension,
    name: parsed.data.name,
  });
  res.status(202).json({
    ok: true,
    job,
    uploadUrl,
    publicUrl: job.sourcePublicUrl,
    key: job.sourceKey,
  });
});

templateRoutes.post('/templates/design/:designJobId/uploaded', async (req, res) => {
  const auth = getAuth(res);
  const job = await markTemplateDesignUploaded(
    String(req.params.designJobId),
    auth.userId,
  );
  res.json({ok: true, job});
});

templateRoutes.get('/templates/design/:designJobId', async (req, res) => {
  const auth = getAuth(res);
  const job = await loadTemplateDesignJob(String(req.params.designJobId));
  if (!job || job.userId !== auth.userId) {
    throw new EngineError('not_found', 'Template design job not found');
  }
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.json({ok: true, job});
});

templateRoutes.get('/templates/design', async (req, res) => {
  const auth = getAuth(res);
  const jobs = await listTemplateDesignJobs(auth.userId);
  res.json({ok: true, jobs});
});
