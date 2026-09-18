/**
 * Liveness and capability reporting.
 *
 * `/capabilities` lets the mobile app hide the AI-edit entry point when a
 * credential is missing, instead of surfacing a failure after the user waits.
 */

import {Router} from 'express';

import {env} from '../../config/env.ts';
import {renderMode} from '../../pipeline/renderRunner.ts';
import {directorConfigured} from '../../stages/broll/geminiDirector.ts';
import {configuredStockProviders, stockConfigured} from '../../stages/broll/stockSearch.ts';
import {transcriptionConfigured} from '../../stages/transcribe/groqTranscribe.ts';
import {getKv} from '../../store/kv.ts';
import {r2Configured} from '../../storage/r2.ts';

export const healthRoutes = Router();

healthRoutes.get('/health', (_req, res) => {
  res.json({ok: true, service: 'video-engine', env: env.NODE_ENV});
});

healthRoutes.get('/ready', async (_req, res) => {
  const kv = await getKv();
  res.json({
    ok: true,
    store: kv.kind,
    transcription: transcriptionConfigured(),
    storage: r2Configured(),
    render: renderMode() !== 'off',
    renderMode: renderMode(),
  });
});

healthRoutes.get('/capabilities', (_req, res) => {
  res.json({
    ok: true,
    transcription: transcriptionConfigured(),
    storage: r2Configured(),
    broll: env.BROLL_ENABLED && stockConfigured(),
    brollProviders: configuredStockProviders(),
    director: directorConfigured(),
    render: renderMode() !== 'off',
    renderMode: renderMode(),
    languages: ['en', 'es', 'hi', 'ta', 'ne', 'auto'],
    maxSourceDurationSec: env.MAX_SOURCE_DURATION_SEC,
    limits: {
      analysesPerMonth: env.MAX_ANALYSES_PER_USER_MONTH,
      renderMinutesPerMonth: env.MAX_RENDER_MINUTES_PER_USER_MONTH,
    },
  });
});
