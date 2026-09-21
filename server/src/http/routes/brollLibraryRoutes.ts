/**
 * Describe creator B-roll so the library can store what each clip shows.
 */

import {Router} from 'express';

import {EngineError} from '../../lib/errors.ts';
import {withWorkspace} from '../../lib/tempFiles.ts';
import {describeUserBrollAssets} from '../../stages/broll/userBrollDescribe.ts';
import {getAuth} from '../auth.ts';
import {z} from 'zod';

const describeSchema = z.object({
  urls: z.array(z.string().url()).min(1).max(12),
});

export const brollLibraryRoutes = Router();

brollLibraryRoutes.post('/broll/describe', async (req, res) => {
  getAuth(res);
  const parsed = describeSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new EngineError('bad_request', 'Provide 1–12 https B-roll URLs');
  }
  const assets = await withWorkspace('broll-describe', workspace =>
    describeUserBrollAssets(parsed.data.urls, workspace),
  );
  res.json({ok: true, assets});
});
