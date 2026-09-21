import express, {type NextFunction, type Request, type Response} from 'express';

import {isProduction} from './config/env.ts';
import {toEngineError} from './lib/errors.ts';
import {logger} from './lib/logger.ts';
import {requireAuth} from './http/auth.ts';
import {analyzeRoutes} from './http/routes/analyzeRoutes.ts';
import {brollLibraryRoutes} from './http/routes/brollLibraryRoutes.ts';
import {editRoutes} from './http/routes/editRoutes.ts';
import {healthRoutes} from './http/routes/healthRoutes.ts';
import {localRenderRoutes} from './http/routes/localRenderRoutes.ts';
import {renderRoutes} from './http/routes/renderRoutes.ts';
import {storageRoutes} from './http/routes/storageRoutes.ts';
import {templateRoutes} from './http/routes/templateRoutes.ts';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Poll endpoints must never 304 — iOS CFNetwork + ETag broke AI job waits.
  app.set('etag', false);
  // Blueprints are the largest payload (a 5-minute word map is ~200 KB).
  app.use(express.json({limit: '2mb'}));

  app.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      logger.info(
        {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          ms: Date.now() - started,
        },
        'request',
      );
    });
    next();
  });

  app.use(healthRoutes);
  // Unauthenticated MP4 download for LAN fallback after a successful local burn.
  app.use('/v1', localRenderRoutes);
  app.use('/v1', requireAuth, storageRoutes);
  app.use('/v1', requireAuth, editRoutes);
  app.use('/v1', requireAuth, analyzeRoutes);
  app.use('/v1', requireAuth, brollLibraryRoutes);
  app.use('/v1', requireAuth, renderRoutes);
  app.use('/v1', requireAuth, templateRoutes);

  app.use((_req, res) => {
    res.status(404).json({ok: false, code: 'not_found', error: 'Unknown route'});
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const engineError = toEngineError(error);
    if (engineError.status >= 500) {
      logger.error({error}, 'unhandled request failure');
    }
    const payload = engineError.toJSON();
    if (isProduction && engineError.status >= 500) {
      payload.error = 'Something went wrong. Please try again.';
      delete payload.details;
    }
    res.status(engineError.status).json(payload);
  });

  return app;
}
