/**
 * Typed environment for the video engine.
 *
 * Parsed once at import time so a misconfigured deploy fails at boot instead of
 * halfway through a paid pipeline run. Stage-specific credentials are optional
 * here — each stage reports `not_configured` so the app can degrade gracefully.
 */

import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import dotenv from 'dotenv';
import {z} from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
for (const candidate of [
  // Reuse shared infrastructure credentials (R2, local AI keys) from the
  // existing Kinmel server during development. The engine's own .env is loaded
  // last and therefore remains the explicit override.
  path.resolve(here, '../../../../server/.env'),
  path.resolve(here, '../../../.env'),
  path.resolve(here, '../../.env'),
]) {
  if (existsSync(candidate)) {
    dotenv.config({path: candidate, quiet: true, override: true});
  }
}

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform(raw => {
      if (raw === undefined || raw.trim() === '') {
        return fallback;
      }
      return !['0', 'false', 'no', 'off'].includes(raw.trim().toLowerCase());
    });

const num = (fallback: number) =>
  z
    .string()
    .optional()
    .transform(raw => {
      const parsed = Number(raw);
      return raw === undefined || raw.trim() === '' || !Number.isFinite(parsed)
        ? fallback
        : parsed;
    });

const str = (fallback = '') =>
  z
    .string()
    .optional()
    .transform(raw => (raw ?? fallback).trim());

const schema = z.object({
  NODE_ENV: str('development'),
  PORT: num(8090),
  LOG_LEVEL: str('info'),

  ENGINE_API_KEY: str(),
  SUPABASE_JWT_SECRET: str(),
  DEV_AUTH_BYPASS: bool(true),

  R2_ACCOUNT_ID: str(),
  R2_ACCESS_KEY_ID: str(),
  R2_SECRET_ACCESS_KEY: str(),
  R2_BUCKET_NAME: str(),
  R2_PUBLIC_BASE_URL: str(),
  /**
   * Public base URL of THIS engine (phone uses it to download local-fallback
   * renders when R2 upload fails). Example: http://192.168.1.35:8090
   */
  ENGINE_PUBLIC_BASE_URL: str(),

  GROQ_API_KEY: str(),
  GROQ_MODEL: str('whisper-large-v3-turbo'),
  GROQ_MAX_UPLOAD_MB: num(24),
  FFMPEG_PATH: str('ffmpeg'),
  FFPROBE_PATH: str('ffprobe'),

  SILENCE_THRESHOLD_SEC: num(0.4),
  SILENCE_PADDING_SEC: num(0.08),
  ZOOM_SCALE: num(1.25),
  ZOOM_MAX_DURATION_SEC: num(6),

  GEMINI_API_KEY: str(),
  GEMINI_MODEL: str('gemini-3.6-flash'),
  PEXELS_API_KEY: str(),
  PIXABAY_API_KEY: str(),
  /** OpenRouter key — template apply uses Seedance 2.0 Mini video generation. */
  OPENROUTER_API_KEY: str(),
  OPENROUTER_SEEDANCE_MODEL: str('bytedance/seedance-2.0-mini'),
  BROLL_MOMENT_COUNT: num(5),
  BROLL_CLIP_DURATION_SEC: num(2.4),
  BROLL_ENABLED: bool(true),
  HOOK_DURATION_SEC: num(3),

  REMOTION_AWS_REGION: str('us-east-1'),
  REMOTION_FUNCTION_NAME: str(),
  REMOTION_SERVE_URL: str(),
  REMOTION_COMPOSITION_ID: str('ShortVideo'),
  REMOTION_LAMBDA_MEMORY_MB: num(3009),
  REMOTION_LAMBDA_DISK_MB: num(10240),
  REMOTION_LAMBDA_TIMEOUT_SEC: num(240),
  REMOTION_FRAMES_PER_LAMBDA: num(120),
  REMOTION_S3_OUTPUT_BUCKET: str(),

  MAX_ANALYSES_PER_USER_MONTH: num(250),
  MAX_RENDER_MINUTES_PER_USER_MONTH: num(90),
  MAX_SOURCE_DURATION_SEC: num(300),

  REDIS_URL: str(),
  BLUEPRINT_TTL_SEC: num(604800),
});

export const env = schema.parse(process.env);

export type Env = typeof env;

export const isProduction = env.NODE_ENV === 'production';

/** Output canvas is fixed 9:16 short-form; fps drives every frame conversion. */
export const OUTPUT_FPS = 30;
export const OUTPUT_WIDTH = 1080;
export const OUTPUT_HEIGHT = 1920;
