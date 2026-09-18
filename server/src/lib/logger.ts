import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import pino from 'pino';

import {env, isProduction} from '../config/env.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
/** ai-video-engine/logs — works for both `src/` and compiled `dist/`. */
const logDir = path.resolve(here, '../../../logs');
mkdirSync(logDir, {recursive: true});
const logFile = path.join(logDir, 'engine.log');

const streams: pino.StreamEntry[] = [
  // Always stdout so `journalctl` / foreground npm can see lines.
  {level: (env.LOG_LEVEL || 'info') as pino.Level, stream: process.stdout},
  // Persistent file on the droplet: `tail -f logs/engine.log`
  {
    level: (env.LOG_LEVEL || 'info') as pino.Level,
    stream: pino.destination({dest: logFile, sync: false, mkdir: true}),
  },
];

export const logger = pino(
  {
    level: env.LOG_LEVEL || 'info',
    base: {service: 'video-engine'},
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers["x-engine-key"]',
        'apiKey',
        'key',
        'token',
        'accessToken',
      ],
      censor: '[redacted]',
    },
  },
  pino.multistream(streams),
);

if (!isProduction) {
  logger.info({logFile}, 'video-engine file logging enabled');
}

export type Logger = typeof logger;

/** Child logger stamped with the pipeline stage for grep-able traces. */
export function stageLogger(stage: string, jobId?: string): Logger {
  return logger.child(jobId ? {stage, jobId} : {stage});
}

export function getEngineLogFilePath(): string {
  return logFile;
}
