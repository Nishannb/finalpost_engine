/**
 * Apply a TemplateRecipe via ByteDance Seedance 2.0 Mini (OpenRouter Video API).
 *
 * The recipe is turned into a text prompt; the creator's clean talking-head is
 * passed as video (+ still) references. Platform watermarks are forbidden in
 * the prompt — never redistribute watermarked reference pixels as the output.
 */

import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';

import {env} from '../../config/env.ts';
import {EngineError} from '../../lib/errors.ts';
import {requestJson, requestWithRetry} from '../../lib/http.ts';
import {stageLogger} from '../../lib/logger.ts';
import {
  copyLocalFile,
  downloadToFile,
  isLocalMediaPath,
  withWorkspace,
} from '../../lib/tempFiles.ts';
import {extractStillJpeg, probeMedia} from '../../media/ffmpeg.ts';
import {uploadRenderedVideo} from '../../storage/r2.ts';
import {
  coerceVideoTemplateRecipe,
  type VideoTemplateRecipe,
} from '../../types/templateRecipe.ts';

const log = stageLogger('seedance');

const OPENROUTER_VIDEOS = 'https://openrouter.ai/api/v1/videos';
const MAX_SOURCE_BYTES = 400 * 1024 * 1024;
const POLL_MS = 4_000;
const POLL_TIMEOUT_MS = 8 * 60_000;

type SeedanceSubmit = {
  id?: string;
  polling_url?: string;
  status?: string;
};

type SeedancePoll = {
  id?: string;
  status?: string;
  unsigned_urls?: string[];
  error?: string | {message?: string};
  usage?: {cost?: number};
};

export type SeedanceEditResult = {
  outputUrl: string;
  sourceDurationSec: number;
  outputDurationSec: number;
  estimatedCostUsd: number;
  model: string;
};

export function seedanceConfigured(): boolean {
  return Boolean(env.OPENROUTER_API_KEY.trim());
}

export function buildSeedancePrompt(recipe: VideoTemplateRecipe): string {
  const custom = (recipe.seedancePrompt || '').trim();
  if (custom.length > 40) {
    const ban =
      'Never include Instagram, Facebook, TikTok, or Meta watermarks, logos, or UI chrome.';
    return custom.toLowerCase().includes('watermark')
      ? custom
      : `${custom} ${ban}`;
  }
  const density =
    recipe.brollDensity >= 0.7
      ? 'dense cutaways and overlays'
      : recipe.brollDensity <= 0.25
        ? 'minimal cutaways, mostly talking-head'
        : 'moderate B-roll accents';
  const zoom =
    recipe.zoomDensity >= 0.7
      ? 'punchy zooms on key phrases'
      : recipe.zoomDensity <= 0.25
        ? 'stable framing'
        : 'occasional subtle zooms';
  return [
    `Create a vertical 9:16 social short in this edit style: ${recipe.summary}.`,
    `Energy: ${recipe.energy}.`,
    `Kinetic caption look inspired by "${recipe.captionTemplate}" templates.`,
    `Opening hook title treatment: ${recipe.hookStyle}.`,
    recipe.preferredLutId
      ? `Color grade feel: ${recipe.preferredLutId} cinematic LUT.`
      : 'Natural color grade.',
    `Pacing: ${density}; camera: ${zoom}.`,
    recipe.trimSilence
      ? 'Keep speech tight — cut dead air.'
      : 'Keep natural pauses.',
    recipe.directorNotes || '',
    'Use the attached reference performance as the primary subject.',
    'Ignore and never recreate Instagram, Facebook, TikTok, or Meta watermarks, logos, or UI chrome.',
    'Output a polished vertical social video with readable captions burned in.',
  ]
    .filter(Boolean)
    .join(' ');
}

function clampDurationSec(raw: number): number {
  const n = Math.round(raw);
  if (!Number.isFinite(n)) {
    return 8;
  }
  return Math.max(4, Math.min(15, n));
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://kinmel.shop',
    'X-Title': 'Kinmel Creators',
  };
}

export async function applySeedanceTemplate(input: {
  videoUrl: string;
  styleRecipe: Record<string, unknown>;
  /** Optional style reference (may have watermarks — only used as guidance). */
  styleReferenceVideoUrl?: string | null;
}): Promise<SeedanceEditResult> {
  if (!seedanceConfigured()) {
    throw new EngineError(
      'not_configured',
      'OPENROUTER_API_KEY is required for Seedance template edits',
    );
  }
  const recipe = coerceVideoTemplateRecipe(input.styleRecipe);
  const model = env.OPENROUTER_SEEDANCE_MODEL || 'bytedance/seedance-2.0-mini';

  return withWorkspace('seedance-edit', async workspace => {
    const local = isLocalMediaPath(input.videoUrl);
    const extension = local
      ? input.videoUrl.toLowerCase().includes('.mov')
        ? '.mov'
        : '.mp4'
      : '.mp4';
    const sourcePath = workspace.file(`source${extension}`);
    if (local) {
      await copyLocalFile(input.videoUrl, sourcePath, {
        maxBytes: MAX_SOURCE_BYTES,
      });
    } else {
      await downloadToFile(input.videoUrl, sourcePath, {
        maxBytes: MAX_SOURCE_BYTES,
      });
    }

    const probe = await probeMedia(sourcePath);
    const durationSec = clampDurationSec(probe.durationSec);

    const stillPaths: string[] = [];
    for (const frac of [0.15, 0.5, 0.85]) {
      const at = Math.max(0.2, Math.min(probe.durationSec - 0.2, probe.durationSec * frac));
      const still = workspace.file(`still-${stillPaths.length}.jpg`);
      try {
        await extractStillJpeg(sourcePath, still, at);
        stillPaths.push(still);
      } catch {
        /* one missed still is fine */
      }
    }
    if (stillPaths.length < 1) {
      throw new EngineError('broll_failed', 'Could not sample frames for Seedance');
    }

    const inputReferences: Array<Record<string, unknown>> = [];
    // Seedance 2 supports video refs on OpenRouter; stills are a reliable fallback.
    if (/^https?:\/\//i.test(input.videoUrl)) {
      inputReferences.push({
        type: 'video_url',
        video_url: {url: input.videoUrl},
      });
    }
    for (const still of stillPaths.slice(0, 3)) {
      const buf = await fs.readFile(still);
      const dataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
      inputReferences.push({
        type: 'image_url',
        image_url: {url: dataUrl},
      });
    }
    if (
      input.styleReferenceVideoUrl &&
      /^https?:\/\//i.test(input.styleReferenceVideoUrl)
    ) {
      inputReferences.push({
        type: 'video_url',
        video_url: {url: input.styleReferenceVideoUrl},
      });
    }

    const firstStill = stillPaths[0]!;
    const firstBuf = await fs.readFile(firstStill);
    const firstDataUrl = `data:image/jpeg;base64,${firstBuf.toString('base64')}`;

    const prompt = buildSeedancePrompt(recipe);
    const body = {
      model,
      prompt,
      duration: durationSec,
      resolution: '720p',
      aspect_ratio: '9:16',
      generate_audio: true,
      frame_images: [
        {
          type: 'image_url',
          image_url: {url: firstDataUrl},
          frame_type: 'first_frame',
        },
      ],
      input_references: inputReferences,
    };

    log.info(
      {model, durationSec, refs: inputReferences.length},
      'submitting Seedance job',
    );

    let submit: SeedanceSubmit;
    try {
      submit = await requestJson<SeedanceSubmit>(OPENROUTER_VIDEOS, {
        method: 'POST',
        label: 'OpenRouter Seedance submit',
        failureCode: 'render_failed',
        timeoutMs: 60_000,
        retries: 1,
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
    } catch (firstErr) {
      // Some providers reject video_url refs — retry with images only.
      log.warn({error: firstErr}, 'Seedance submit with video refs failed; retrying images');
      const imageOnly = {
        ...body,
        input_references: inputReferences.filter(ref => ref.type === 'image_url'),
      };
      submit = await requestJson<SeedanceSubmit>(OPENROUTER_VIDEOS, {
        method: 'POST',
        label: 'OpenRouter Seedance submit (images)',
        failureCode: 'render_failed',
        timeoutMs: 60_000,
        retries: 0,
        headers: authHeaders(),
        body: JSON.stringify(imageOnly),
      });
    }

    const jobId = String(submit.id || '').trim();
    if (!jobId) {
      throw new EngineError('render_failed', 'Seedance did not return a job id');
    }

    const pollUrl = submit.polling_url?.startsWith('http')
      ? submit.polling_url
      : `${OPENROUTER_VIDEOS}/${encodeURIComponent(jobId)}`;

    const started = Date.now();
    let poll: SeedancePoll = {status: submit.status || 'pending'};
    while (Date.now() - started < POLL_TIMEOUT_MS) {
      poll = await requestJson<SeedancePoll>(pollUrl, {
        method: 'GET',
        label: 'OpenRouter Seedance poll',
        failureCode: 'render_failed',
        timeoutMs: 30_000,
        retries: 1,
        headers: authHeaders(),
      });
      const status = String(poll.status || '').toLowerCase();
      if (status === 'completed') {
        break;
      }
      if (
        status === 'failed' ||
        status === 'cancelled' ||
        status === 'expired'
      ) {
        const errMsg =
          typeof poll.error === 'string'
            ? poll.error
            : poll.error?.message || `Seedance job ${status}`;
        throw new EngineError('render_failed', errMsg);
      }
      await new Promise<void>(resolve => {
        setTimeout(resolve, POLL_MS);
      });
    }
    if (String(poll.status || '').toLowerCase() !== 'completed') {
      throw new EngineError('upstream_timeout', 'Seedance edit timed out');
    }

    const outPath = workspace.file('seedance-out.mp4');
    const unsigned = (poll.unsigned_urls || []).find(u => /^https?:\/\//i.test(u));
    if (unsigned) {
      await downloadToFile(unsigned, outPath, {maxBytes: MAX_SOURCE_BYTES});
    } else {
      const contentUrl = `${OPENROUTER_VIDEOS}/${encodeURIComponent(jobId)}/content`;
      const response = await requestWithRetry(contentUrl, {
        method: 'GET',
        label: 'OpenRouter Seedance download',
        failureCode: 'render_failed',
        timeoutMs: 120_000,
        retries: 1,
        headers: {
          Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        },
      });
      const buf = Buffer.from(await response.arrayBuffer());
      if (buf.byteLength < 1) {
        throw new EngineError('render_failed', 'Seedance returned an empty video');
      }
      await fs.writeFile(outPath, buf);
    }

    const renderId = `sd_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const uploaded = await uploadRenderedVideo(outPath, renderId);
    const outProbe = await probeMedia(outPath).catch(() => null);

    return {
      outputUrl: uploaded.publicUrl,
      sourceDurationSec: probe.durationSec,
      outputDurationSec: outProbe?.durationSec ?? durationSec,
      estimatedCostUsd: Number(poll.usage?.cost || 0),
      model,
    };
  });
}
