import {Router} from 'express';
import {z} from 'zod';

import {EngineError} from '../../lib/errors.ts';
import {presignSourceVideo} from '../../storage/r2.ts';

const requestSchema = z.object({
  contentType: z
    .enum(['video/mp4', 'video/quicktime', 'video/x-m4v'])
    .default('video/mp4'),
  extension: z.enum(['.mp4', '.mov', '.m4v']).optional(),
});

export const storageRoutes = Router();

/**
 * The phone uploads bytes straight to R2. The engine only signs the PUT, so a
 * five-minute video never passes through Node memory or the development tunnel.
 */
storageRoutes.post('/storage/presign-video', async (req, res) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new EngineError(
      'bad_request',
      parsed.error.issues[0]?.message ?? 'Invalid upload request',
    );
  }
  const result = await presignSourceVideo(parsed.data);
  res.json({ok: true, ...result});
});
