/**
 * Serve locally rendered MP4s when R2 upload fails (dev / LAN testing).
 */

import {Router} from 'express';
import fs from 'node:fs';
import {createReadStream} from 'node:fs';

import {localServedRenderPath} from '../../stages/render/localRender.ts';

export const localRenderRoutes = Router();

localRenderRoutes.get('/local-renders/:renderJobId.mp4', (req, res) => {
  const raw = String(req.params.renderJobId || '').replace(/\.mp4$/i, '');
  const renderJobId = raw.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!renderJobId || renderJobId !== raw) {
    res.status(400).json({ok: false, code: 'bad_request', error: 'Invalid id'});
    return;
  }
  const filePath = localServedRenderPath(renderJobId);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ok: false, code: 'not_found', error: 'Render missing'});
    return;
  }
  const stat = fs.statSync(filePath);
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Length', String(stat.size));
  res.setHeader('Cache-Control', 'private, max-age=3600');
  createReadStream(filePath).pipe(res);
});
