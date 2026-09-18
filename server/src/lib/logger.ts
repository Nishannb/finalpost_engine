import pino from 'pino';

import {env, isProduction} from '../config/env.ts';

export const logger = pino({
  level: env.LOG_LEVEL || 'info',
  base: {service: 'video-engine'},
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-engine-key"]',
      'apiKey',
      'key',
    ],
    censor: '[redacted]',
  },
  ...(isProduction
    ? {}
    : {transport: {target: 'pino/file', options: {destination: 1}}}),
});

export type Logger = typeof logger;

/** Child logger stamped with the pipeline stage for grep-able traces. */
export function stageLogger(stage: string, jobId?: string): Logger {
  return logger.child(jobId ? {stage, jobId} : {stage});
}
