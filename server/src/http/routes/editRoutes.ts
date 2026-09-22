/**
 * Server-owned captions / teleprompter-clean edit:
 *   POST /v1/edits/captions     presign + create job
 *   POST /v1/edits/:id/uploaded phone (or native) says the PUT finished
 *   GET  /v1/edits/:id          poll
 */

import {Router} from 'express';
import {z} from 'zod';

import {EngineError} from '../../lib/errors.ts';
import {
  createCaptionsEditJob,
  loadCaptionsEditJob,
  markCaptionsSourceUploaded,
} from '../../pipeline/captionsEditRunner.ts';
import {CAPTION_TEMPLATES, SUPPORTED_LANGUAGES} from '../../types/blueprint.ts';
import {getAuth} from '../auth.ts';

const createSchema = z.object({
  contentType: z
    .enum(['video/mp4', 'video/quicktime', 'video/x-m4v'])
    .default('video/mp4'),
  extension: z.enum(['.mp4', '.mov', '.m4v']).optional(),
  languageCode: z.enum(SUPPORTED_LANGUAGES).default('auto'),
  captionTemplate: z.enum(CAPTION_TEMPLATES).default('karaoke'),
  captionStyleGuide: z.record(z.string(), z.unknown()).optional(),
  /** captions (default) | teleprompter_clean (silence + retakes + captions). */
  mode: z.enum(['captions', 'teleprompter_clean']).optional(),
  scriptText: z.string().max(20_000).optional(),
});

export const editRoutes = Router();

editRoutes.post('/edits/captions', async (req, res) => {
  const auth = getAuth(res);
  const parsed = createSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    throw new EngineError(
      'bad_request',
      parsed.error.issues[0]?.message ?? 'Invalid captions edit request',
    );
  }
  const {job, uploadUrl} = await createCaptionsEditJob({
    userId: auth.userId,
    contentType: parsed.data.contentType,
    extension: parsed.data.extension,
    languageCode: parsed.data.languageCode,
    captionTemplate: parsed.data.captionTemplate,
    captionStyleGuide: parsed.data.captionStyleGuide,
    mode: parsed.data.mode,
    scriptText: parsed.data.scriptText,
  });
  res.status(202).json({
    ok: true,
    job,
    uploadUrl,
    publicUrl: job.sourcePublicUrl,
    key: job.sourceKey,
  });
});

editRoutes.post('/edits/:editJobId/uploaded', async (req, res) => {
  const auth = getAuth(res);
  const job = await markCaptionsSourceUploaded(
    String(req.params.editJobId),
    auth.userId,
  );
  res.json({ok: true, job});
});

editRoutes.get('/edits/:editJobId', async (req, res) => {
  const auth = getAuth(res);
  const job = await loadCaptionsEditJob(String(req.params.editJobId));
  if (!job || job.userId !== auth.userId) {
    throw new EngineError('not_found', 'Edit job not found');
  }
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.json({ok: true, job});
});
