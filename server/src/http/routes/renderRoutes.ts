/**
 * Stage E endpoints.
 *
 *   POST /v1/render        burn a blueprint (local Remotion in dev, Lambda in prod)
 *   GET  /v1/render/:id    poll progress and get the MP4 URL
 */

import {Router} from 'express';

import {EngineError} from '../../lib/errors.ts';
import {
  loadRenderJob,
  refreshRenderJob,
  renderAvailable,
  startRender,
} from '../../pipeline/renderRunner.ts';
import {getAuth} from '../auth.ts';
import {renderRequestSchema} from '../schemas.ts';

export const renderRoutes = Router();

renderRoutes.post('/render', async (req, res) => {
  const auth = getAuth(res);
  const parsed = renderRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new EngineError('bad_request', parsed.error.issues[0]?.message ?? 'Invalid request');
  }
  if (!renderAvailable()) {
    throw new EngineError('not_configured', 'Rendering is not enabled on this machine');
  }

  const job = await startRender({
    userId: auth.userId,
    blueprintId: parsed.data.blueprintId,
    style: parsed.data.style,
  });
  res.status(202).json({ok: true, job});
});

renderRoutes.get('/render/:renderJobId', async (req, res) => {
  const auth = getAuth(res);
  const existing = await loadRenderJob(String(req.params.renderJobId));
  if (!existing || existing.userId !== auth.userId) {
    throw new EngineError('not_found', 'Render job not found');
  }
  const job = await refreshRenderJob(existing);
  // Prevent CFNetwork/Express ETag 304 empty responses during poll loops.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.removeHeader('ETag');
  res.json({ok: true, job});
});
