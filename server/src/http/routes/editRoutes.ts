/**
 * Server-owned captions / teleprompter-clean edit:
 *   POST /v1/edits/captions     presign + create job
 *   POST /v1/edits/:id/uploaded phone (or native) says the PUT finished
 *   GET  /v1/edits/:id          poll (read-only; stalled jobs are recovered by the background worker, never by a read)
 *   POST /v1/edits/:id/assets   full_edit: answer the labeled-asset gate (submit / skip)
 *   POST /v1/edits/:id/retry    full_edit: retry a failed job
 */

import {Router} from 'express';
import {z} from 'zod';

import {EngineError} from '../../lib/errors.ts';
import {
  createCaptionsEditJob,
  loadCaptionsEditJob,
  markCaptionsSourceUploaded,
  retryFullEdit,
  submitFullEditAssets,
} from '../../pipeline/captionsEditRunner.ts';
import {labeledAssetBindingSchema} from '../schemas.ts';
import {assertFullEditEntitlement} from '../../lib/entitlement.ts';
import {isCaptionKitPresetId} from '../../lib/captionKitPresets.ts';
import {CAPTION_TEMPLATES, SUPPORTED_LANGUAGES} from '../../types/blueprint.ts';
import {getAuth} from '../auth.ts';

const createSchema = z.object({
  contentType: z
    .enum(['video/mp4', 'video/quicktime', 'video/x-m4v'])
    .default('video/mp4'),
  extension: z.enum(['.mp4', '.mov', '.m4v']).optional(),
  languageCode: z.enum(SUPPORTED_LANGUAGES).default('auto'),
  captionTemplate: z.enum(CAPTION_TEMPLATES).default('karaoke'),
  /**
   * CaptionKit preset id (`presets.json`). When set on mode `captions`, this
   * is the style that gets burned. Unknown ids are rejected.
   */
  captionPreset: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .optional()
    .refine(id => id == null || isCaptionKitPresetId(id), {
      message: 'Unknown caption preset',
    }),
  captionStyleGuide: z.record(z.string(), z.unknown()).optional(),
  /**
   * captions (default, full pipeline) | teleprompter_clean (silence + retakes + captions)
   * | basic_captions (FREE: Groq transcription + caption burn only, no LLM/cuts).
   * TODO(backend): plan is not known to this service yet. Once a server-side plan
   * lookup exists, reject `captions` / `teleprompter_clean` for free users.
   */
  mode: z.enum(['captions', 'teleprompter_clean', 'basic_captions', 'full_edit']).optional(),
  /** `full_edit` only: creator B-roll, a ready cutout, and the render flags the durable job keeps. */
  fullEdit: z
    .object({
      userBrollUrls: z.array(z.string().url()).max(12).optional(),
      subjectCutoutUrl: z.string().url().optional(),
      layoutStyle: z.string().trim().max(40).optional(),
      renderFlags: z
        .object({brollEnabled: z.boolean(), zoomEnabled: z.boolean(), trimEnabled: z.boolean()})
        .optional(),
    })
    .optional(),
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
  // Free creators may only start the lean `basic_captions` job. Every other mode (full_edit, captions with cuts,
  // teleprompter clean) is Pro / Pro Plus, decided from the server-verified plan, never from the request.
  if (parsed.data.mode !== 'basic_captions') {
    await assertFullEditEntitlement(auth);
  }
  const {job, uploadUrl} = await createCaptionsEditJob({
    userId: auth.userId,
    contentType: parsed.data.contentType,
    extension: parsed.data.extension,
    languageCode: parsed.data.languageCode,
    captionTemplate: parsed.data.captionTemplate,
    captionPreset: parsed.data.captionPreset,
    captionStyleGuide: parsed.data.captionStyleGuide,
    mode: parsed.data.mode,
    scriptText: parsed.data.scriptText,
    ...(parsed.data.mode === 'full_edit' && parsed.data.fullEdit ? {fullEdit: parsed.data.fullEdit} : {}),
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

const assetsSchema = z.object({
  bindings: z.array(labeledAssetBindingSchema).max(24).optional(),
  /** Skip every requested slot (what "Skip" in the asset screen sends). */
  skipAll: z.boolean().optional(),
});

editRoutes.post('/edits/:editJobId/assets', async (req, res) => {
  const auth = getAuth(res);
  await assertFullEditEntitlement(auth);
  const parsed = assetsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    throw new EngineError('bad_request', parsed.error.issues[0]?.message ?? 'Invalid assets request');
  }
  if (!parsed.data.skipAll && !(parsed.data.bindings && parsed.data.bindings.length > 0)) {
    throw new EngineError('bad_request', 'Send bindings, or skipAll');
  }
  const job = await submitFullEditAssets({
    editJobId: String(req.params.editJobId),
    userId: auth.userId,
    bindings: parsed.data.bindings,
    skipAll: parsed.data.skipAll,
  });
  res.status(202).json({ok: true, job});
});

editRoutes.post('/edits/:editJobId/retry', async (req, res) => {
  const auth = getAuth(res);
  await assertFullEditEntitlement(auth);
  const job = await retryFullEdit({editJobId: String(req.params.editJobId), userId: auth.userId});
  res.status(202).json({ok: true, job});
});
