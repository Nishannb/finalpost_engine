import {randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import fs from 'node:fs/promises';

import {PutObjectCommand, S3Client} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';

import {env} from '../config/env.ts';
import {EngineError} from '../lib/errors.ts';
import {logger} from '../lib/logger.ts';

let client: S3Client | null = null;

const sleep = (ms: number) =>
  new Promise<void>(resolve => {
    setTimeout(resolve, ms);
  });

export function r2Configured(): boolean {
  return Boolean(
    env.R2_ACCOUNT_ID &&
      env.R2_ACCESS_KEY_ID &&
      env.R2_SECRET_ACCESS_KEY &&
      env.R2_BUCKET_NAME &&
      env.R2_PUBLIC_BASE_URL,
  );
}

function getClient(): S3Client {
  if (!r2Configured()) {
    throw new EngineError(
      'not_configured',
      'Cloudflare R2 storage is not configured',
    );
  }
  client ??= new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });
  return client;
}

export async function presignSourceVideo(input: {
  contentType: string;
  extension?: string;
}): Promise<{uploadUrl: string; publicUrl: string; key: string}> {
  const extension = normalizeExtension(input.extension);
  const key =
    `ai-video/source/${new Date().toISOString().slice(0, 10)}/` +
    `${randomUUID()}${extension}`;
  const command = new PutObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: key,
    ContentType: input.contentType,
  });
  const uploadUrl = await getSignedUrl(getClient(), command, {expiresIn: 900});
  return {
    uploadUrl,
    publicUrl: publicUrlFor(key),
    key,
  };
}

function publicUrlFor(key: string): string {
  return `${env.R2_PUBLIC_BASE_URL.replace(/\/+$/, '')}/${key}`;
}

/** Server-side PUT of a finished render. Phone never sees this file. */
export async function uploadRenderedVideo(
  filePath: string,
  renderJobId: string,
): Promise<{publicUrl: string; key: string}> {
  return uploadPublicFile(
    filePath,
    `ai-video/render/${new Date().toISOString().slice(0, 10)}/${renderJobId}.mp4`,
    'video/mp4',
  );
}

/** Local first-video: Remotion can only fetch http(s), so the source goes to R2. */
export async function uploadSourceVideo(
  filePath: string,
  extension = '.mp4',
): Promise<{publicUrl: string; key: string}> {
  const ext = normalizeExtension(extension);
  const contentType = ext === '.mov' ? 'video/quicktime' : 'video/mp4';
  return uploadPublicFile(
    filePath,
    `ai-video/source/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${ext}`,
    contentType,
  );
}

function isRetryableR2Error(error: unknown): boolean {
  const e = error as {
    name?: string;
    Code?: string;
    code?: string;
    $metadata?: {httpStatusCode?: number};
    message?: string;
  };
  const status = e.$metadata?.httpStatusCode;
  if (status != null && [408, 425, 429, 500, 502, 503, 504].includes(status)) {
    return true;
  }
  const code = (e.Code || e.code || e.name || '').toLowerCase();
  if (
    code.includes('serviceunavailable') ||
    code.includes('slowdown') ||
    code.includes('timeout') ||
    code.includes('networking') ||
    code.includes('econnreset') ||
    code.includes('econnrefused')
  ) {
    return true;
  }
  const msg = (e.message || '').toLowerCase();
  return (
    msg.includes('serviceunavailable') ||
    msg.includes('cloudflarestatus') ||
    msg.includes('econnreset')
  );
}

async function uploadPublicFile(
  filePath: string,
  key: string,
  contentType: string,
): Promise<{publicUrl: string; key: string}> {
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat || stat.size < 1) {
    throw new EngineError('render_failed', 'File to upload was empty');
  }

  const maxAttempts = 5;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await getClient().send(
        new PutObjectCommand({
          Bucket: env.R2_BUCKET_NAME,
          Key: key,
          Body: createReadStream(filePath),
          ContentType: contentType,
          ContentLength: stat.size,
        }),
      );
      return {publicUrl: publicUrlFor(key), key};
    } catch (error) {
      lastError = error;
      if (!isRetryableR2Error(error) || attempt === maxAttempts) {
        break;
      }
      const backoffMs = 400 * 2 ** (attempt - 1) + Math.floor(Math.random() * 200);
      logger.warn(
        {
          key,
          attempt,
          backoffMs,
          status: (error as {$metadata?: {httpStatusCode?: number}}).$metadata
            ?.httpStatusCode,
          name: (error as {name?: string}).name,
        },
        'R2 upload failed; retrying',
      );
      await sleep(backoffMs);
    }
  }

  const status = (lastError as {$metadata?: {httpStatusCode?: number}} | null)
    ?.$metadata?.httpStatusCode;
  throw new EngineError(
    'render_failed',
    status === 503
      ? 'Cloudflare R2 was temporarily unavailable while uploading the edit. Please try again.'
      : 'Could not upload the rendered video to storage.',
    {
      status,
      name: (lastError as {name?: string} | null)?.name,
      detail:
        lastError instanceof Error
          ? lastError.message.slice(0, 300)
          : String(lastError).slice(0, 300),
    },
  );
}

function normalizeExtension(raw?: string): string {
  const extension = String(raw || '.mp4')
    .trim()
    .toLowerCase();
  return ['.mp4', '.mov', '.m4v'].includes(extension) ? extension : '.mp4';
}
