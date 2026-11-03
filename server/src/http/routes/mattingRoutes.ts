/**
 * RVM transparent talking-head job (an explicit job; analyze does not use it).
 *
 *   POST /v1/matting/jobs          start (or reuse) a job            -> 202 {ok, job}
 *   GET  /v1/matting/jobs/:jobId   poll; carries outputUrl when done -> 200 {ok, job}
 *
 * `outputUrl` is the public R2 URL of a silent VP9 yuva420p WebM (person opaque, background transparent). There is no download route.
 * requireAuth is applied where this router is mounted (app.ts).
 */

import {Router} from 'express';
import {z} from 'zod';

import {EngineError} from '../../lib/errors.ts';
import {getMattingRunner, type MattingRunner} from '../../pipeline/mattingRunner.ts';
import {hitRateLimit} from '../../store/engineStore.ts';
import {getAuth} from '../auth.ts';

/** A creator cannot legitimately start more than a handful of these a minute (same budget as analyze). */
export const MATTING_RATE_LIMIT = 8;
export const MATTING_RATE_WINDOW_SEC = 60;

const httpUrl = z
  .string()
  .trim()
  .min(1)
  .refine(
    value => {
      try {
        const url = new URL(value);
        return url.protocol === 'https:' || url.protocol === 'http:';
      } catch {
        return false;
      }
    },
    {message: 'videoUrl must be an http(s) URL'},
  );

export const createMattingJobSchema = z.object({
  videoUrl: httpUrl,
  quality: z.enum(['high', 'fast']).optional().default('high'),
  outputFormat: z.enum(['transparent']).optional().default('transparent'),
  useCache: z.boolean().optional().default(true),
});

export function createMattingRoutes(runnerProvider: () => MattingRunner = getMattingRunner): Router {
  const router = Router();

  router.post('/matting/jobs', async (req, res) => {
    const auth = getAuth(res);
    const parsed = createMattingJobSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new EngineError('bad_request', parsed.error.issues[0]?.message ?? 'Invalid request', {
        issues: parsed.error.issues.map(issue => issue.message),
      });
    }

    const hits = await hitRateLimit(`matting:${auth.userId}`, MATTING_RATE_WINDOW_SEC);
    if (hits > MATTING_RATE_LIMIT && auth.via !== 'dev') {
      throw new EngineError('rate_limited', 'Too many talking-head extractions started; slow down');
    }

    const job = await runnerProvider().start({
      userId: auth.userId,
      videoUrl: parsed.data.videoUrl,
      quality: parsed.data.quality,
      outputFormat: parsed.data.outputFormat,
      useCache: parsed.data.useCache,
    });
    res.status(202).json({ok: true, job});
  });

  router.get('/matting/jobs/:jobId', async (req, res) => {
    const auth = getAuth(res);
    const job = await runnerProvider().getForUser(String(req.params.jobId), auth.userId);
    // Poll endpoints must never 304 (iOS CFNetwork + ETag broke job waits elsewhere).
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.removeHeader('ETag');
    res.json({ok: true, job});
  });

  return router;
}

export const mattingRoutes = createMattingRoutes();
